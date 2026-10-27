/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/media/UdpChannelTransport.java @ 1.53.3
import dgram from 'node:dgram';
import type { RemoteInfo, Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { CloseHelper } from '../../agrona/CloseHelper.js';
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import type { AutoCloseable } from '../../agrona/jdkLang.js';
import { AeronEvent } from '../../client/exceptions/AeronEvent.js';
import { AeronException } from '../../client/exceptions/AeronException.js';
import { FrameDescriptor } from '../../client/logbuffer/FrameDescriptor.js';
import { DataHeaderFlyweight } from '../../client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import { ResolutionEntryFlyweight } from '../../client/protocol/ResolutionEntryFlyweight.js';
import { ResponseSetupFlyweight } from '../../client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';
import {
    Inet4Address,
    InetAddress,
    InetSocketAddress,
    IOException,
    StandardProtocolFamily,
    type NetworkInterface,
} from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import { SystemCounterDescriptor } from '../status/SystemCounterDescriptor.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';
import { NetworkUtil } from './NetworkUtil.js';
import type { PortManager } from './PortManager.js';
import { ReceiveRing } from './ReceiveRing.js';
import type { UdpChannel } from './UdpChannel.js';

const {
    CURRENT_VERSION,
    HDR_TYPE_DATA,
    HDR_TYPE_ERR,
    HDR_TYPE_NAK,
    HDR_TYPE_PAD,
    HDR_TYPE_RES,
    HDR_TYPE_RSP_SETUP,
    HDR_TYPE_RTTM,
    HDR_TYPE_SETUP,
    HDR_TYPE_SM,
    MIN_HEADER_LENGTH,
} = HeaderFlyweight;

/**
 * The `lookup` of every socket of a transport (spec 4.2, N2, N6): IP literals only, answered synchronously, so that
 * `bind`, `connect`, the socket options and the send hand-off all run inside the call, as they do in Java. A host name
 * never reaches a socket (spec D7); it gets `ENOTFOUND`.
 */
function synchronousLookup(
    hostname: string,
    options: unknown,
    callback?: (err: Error | null, address: string, family: number) => void,
): void {
    const cb = (typeof options === 'function' ? options : callback) as (
        err: Error | null,
        address: string,
        family: number,
    ) => void;
    const family = isIP(hostname);
    if (0 === family) {
        cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname), { code: 'ENOTFOUND' }), '', 0);
        return;
    }

    cb(null, hostname, family);
}

/** The `code` of a node system error, or undefined. */
function codeOf(error: Error): string | undefined {
    return (error as Error & { code?: string }).code;
}

/**
 * Base class for UDP channel transports which is specialised for send or receive endpoints.
 * <p>
 * Node has no synchronous `recvfrom` and `sendto`, so this class differs from Java's in two places, both described in
 * spec 4.2: `receive` pops a datagram from the {@link ReceiveRing} that the socket's `'message'` events fill (D1), and
 * `send` / `sendTo` copy into a preallocated send slot and return 0 while libuv's send queue is not empty (D2).
 */
export abstract class UdpChannelTransport implements AutoCloseable {
    /**
     * Not in Java (spec 4.2). The senders whose `InetSocketAddress` a transport keeps; a transport that hears from more
     * senders than this replaces them round-robin, and allocates one address for each such datagram.
     */
    public static readonly SOURCE_ADDRESS_CAPACITY = 16;

    /**
     * Context for configuration.
     */
    protected readonly context: MediaDriverContext;

    /**
     * {@link ErrorHandler} for logging errors and progressing with throwing.
     */
    protected readonly errorHandler: ErrorHandler | null;

    /**
     * Media configuration for the channel.
     */
    protected readonly _udpChannel: UdpChannel;

    /**
     * Channel to be used for sending frames from the perspective of the endpoint. A node `dgram` socket (Java:
     * `DatagramChannel`). Public so that a test can inject a socket whose send queue it controls.
     *
     * @internal
     */
    public sendDatagramChannel: Socket | null = null;

    /**
     * Channel to be used for receiving frames from the perspective of the endpoint.
     *
     * @internal
     */
    public _receiveDatagramChannel: Socket | null = null;

    /**
     * Address to connect to if appropriate for sending.
     */
    protected connectAddress: InetSocketAddress | null;

    private bindAddress: InetSocketAddress;
    private readonly endPointAddress: InetSocketAddress;
    /** @internal package-private in Java */
    public readonly invalidPackets: AtomicCounter;
    private readonly portManager: PortManager;

    private _multicastTtl = 0;
    private readonly _socketSndbufLength: number = 0;
    private readonly _socketRcvbufLength: number = 0;

    // Not in Java (spec 4.2). Everything below is allocated here, once, or reused: the receive and send paths allocate
    // nothing per datagram.
    private readonly receiveRingDrops: AtomicCounter | null;
    private ring: ReceiveRing | null = null;
    private receivedLength_ = 0;
    // The source address intern table (spec 4.2): parallel arrays of fixed size, scanned linearly (no key is built), with
    // the index of the last hit tried first. A miss replaces the entry at `srcNext`, round-robin, and is the only
    // allocation.
    private readonly srcHosts: string[] = new Array<string>(UdpChannelTransport.SOURCE_ADDRESS_CAPACITY).fill('');
    private readonly srcPorts = new Int32Array(UdpChannelTransport.SOURCE_ADDRESS_CAPACITY).fill(-1);
    private readonly srcAddresses: (InetSocketAddress | null)[] = new Array<InetSocketAddress | null>(
        UdpChannelTransport.SOURCE_ADDRESS_CAPACITY,
    ).fill(null);
    private srcLast = 0;
    private srcNext = 0;
    private readonly sendSlot = new Uint8Array(SetupFlyweight.MAX_UDP_PAYLOAD_LENGTH);
    // views of the first `length` bytes of the send slot, made when a datagram of that length is first sent (spec D113)
    private readonly sendViews = new Map<number, Uint8Array>();
    private sendBlocked = false;
    private pendingReceiveError: Error | null = null;
    private pendingSendError: Error | null = null;
    private openError: Error | null = null;
    private isOpening = false;
    // updateEndpoint has thrown the failure of a connect that node also emits as an 'error' event later: drop that one
    private connectFailureHandled = false;
    private isClosed = false;
    // close() has run: it frees the managed port once. Not isClosed, which a failed open also sets (late socket errors).
    private closeDone = false;
    private connected = false;
    private wakeUp: (() => void) | null;
    private readonly onMessageCallback: (message: Uint8Array, rinfo: RemoteInfo) => void;
    private readonly onSocketErrorCallback: (error: Error) => void;
    private readonly onSendCompleteCallback: (error: Error | null) => void;

    /**
     * Construct transport for a given channel.
     *
     * @param udpChannel         configuration for the media.
     * @param endPointAddress    to which data will be sent.
     * @param bindAddress        for listening on.
     * @param connectAddress     for sending data to.
     * @param portManager        for port binding.
     * @param context            for configuration.
     * @param socketRcvbufLength set SO_RCVBUF for socket, 0 for OS default (when omitted: the channel's, or the
     *                           context's).
     * @param socketSndbufLength set SO_SNDBUF for socket, 0 for OS default (when omitted: the channel's, or the
     *                           context's).
     */
    protected constructor(
        udpChannel: UdpChannel | null,
        endPointAddress: InetSocketAddress | null,
        bindAddress: InetSocketAddress | null,
        connectAddress: InetSocketAddress | null,
        portManager: PortManager | null,
        context: MediaDriverContext,
        socketRcvbufLength?: number,
        socketSndbufLength?: number,
    ) {
        this.context = context;
        this.wakeUp = context.wakeUp();
        this._udpChannel = udpChannel as UdpChannel;
        this.errorHandler = context.countedErrorHandler();
        this.portManager = portManager as PortManager;
        this.endPointAddress = endPointAddress as InetSocketAddress;
        this.bindAddress = bindAddress as InetSocketAddress;
        this.connectAddress = connectAddress;
        const systemCounters = context.systemCounters();
        this.invalidPackets = systemCounters?.get(SystemCounterDescriptor.INVALID_PACKETS) as AtomicCounter;
        this.receiveRingDrops = (systemCounters?.get(SystemCounterDescriptor.RECEIVE_RING_DROPS) ??
            null) as AtomicCounter | null;
        this._socketRcvbufLength =
            socketRcvbufLength ?? (udpChannel as UdpChannel).socketRcvbufLengthOrDefault(context.socketRcvbufLength());
        this._socketSndbufLength =
            socketSndbufLength ?? (udpChannel as UdpChannel).socketSndbufLengthOrDefault(context.socketSndbufLength());

        this.onMessageCallback = (message, rinfo) => this.onMessage(message, rinfo);
        this.onSocketErrorCallback = (error) => this.onSocketError(error);
        this.onSendCompleteCallback = (error) => this.onSendComplete(error);
    }

    /**
     * Report an {@link AeronEvent} with a message for a send error.
     *
     * @param ex           experienced.
     * @param destination  to which the send operation was addressed.
     * @param errorHandler to report error to.
     */
    public static onSendError(ex: Error, destination: InetSocketAddress | null, errorHandler: ErrorHandler): void {
        errorHandler.onError(
            new AeronEvent(
                'failed to send datagram to ' + destination + ', cause: ' + ex,
                AeronException.Category.WARN,
            ),
        );
    }

    /**
     * Open the underlying channel for reading and writing.
     *
     * @param statusIndicator to set for {@link ChannelEndpointStatus} which could be
     *                        {@link ChannelEndpointStatus#ERRORED}.
     */
    public openDatagramChannel(statusIndicator: AtomicCounter | null): void {
        this.isOpening = true;
        this.openError = null;
        try {
            const isMulticast = this._udpChannel.isMulticast();
            this.sendDatagramChannel = this.newSocket(isMulticast);
            this._receiveDatagramChannel = this.sendDatagramChannel;

            if (isMulticast) {
                if (null !== this.connectAddress) {
                    this._receiveDatagramChannel = this.newSocket(true);
                }

                // Java: bind(new InetSocketAddress(port)) on a channel with IP_MULTICAST_ALL off (spec D119). A node socket
                // cannot turn the option off, so the socket is bound to the group instead and the kernel gives it that group
                // only; it then no longer receives unicast to the port. This is unconditional except on Windows (which binds
                // the wildcard address) and for an IPv6 link-local group (scope 2 or less) without an interface, which also
                // binds the wildcard address; see multicastBindHost.
                this.bindChecked(
                    this._receiveDatagramChannel,
                    this.endPointAddress.getPort(),
                    UdpChannelTransport.multicastBindHost(
                        this._udpChannel,
                        this.endPointAddress,
                        this.multicastInterface(),
                    ),
                );
                this.join(this._receiveDatagramChannel);
            } else {
                this.bindAddress = this.portManager.getManagedPort(this._udpChannel, this.bindAddress);
                this.bindChecked(
                    this.sendDatagramChannel,
                    this.bindAddress.getPort(),
                    UdpChannelTransport.hostAddress(this.bindAddress),
                );
            }

            if (null !== this.connectAddress) {
                this.connectChecked(this.sendDatagramChannel, this.connectAddress);
            }

            if (isMulticast) {
                // Java sets these before the connect. A node socket takes them once bound, and a connect binds it.
                this.configureMulticastSend(this.sendDatagramChannel);
            }

            if (0 !== this.socketSndbufLength()) {
                this.sendDatagramChannel.setSendBufferSize(this.socketSndbufLength());
            }

            if (0 !== this.socketRcvbufLength()) {
                this._receiveDatagramChannel.setRecvBufferSize(this.socketRcvbufLength());
            }

            // configureBlocking(false): a node socket is never blocking.

            this.ring = new ReceiveRing(
                this.socketRcvbufLength() > 0
                    ? this.socketRcvbufLength()
                    : this._receiveDatagramChannel.getRecvBufferSize(),
            );
            this._receiveDatagramChannel.on('message', this.onMessageCallback);
        } catch (ex) {
            if (null !== statusIndicator) {
                statusIndicator.setRelease(ChannelEndpointStatus.ERRORED);
            }

            // errors that a socket emits after this point belong to a socket nobody uses
            this.isClosed = true;
            CloseHelper.quietClose(UdpChannelTransport.closeable(this.sendDatagramChannel));
            if (this._receiveDatagramChannel !== this.sendDatagramChannel) {
                CloseHelper.quietClose(UdpChannelTransport.closeable(this._receiveDatagramChannel));
            }

            this.sendDatagramChannel = null;
            this._receiveDatagramChannel = null;
            this.ring = null;

            const error = ex as Error;
            const message =
                'channel error - ' +
                error.message +
                ' (at ' +
                UdpChannelTransport.firstFrame(error) +
                '): ' +
                this._udpChannel.originalUriString();

            throw new AeronException(message, error);
        } finally {
            this.isOpening = false;
        }
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {
        // Java has no guard; the flag only keeps a second close from freeing the managed port again (D28). A failed
        // open does not set it, so the conductor's close after the failure frees the port.
        if (this.closeDone) {
            return;
        }

        this.closeDone = true;
        this.isClosed = true;
        const send = this.sendDatagramChannel;
        const receive = this._receiveDatagramChannel;
        try {
            CloseHelper.close(this.errorHandler, UdpChannelTransport.closeable(send));
            if (receive !== send) {
                CloseHelper.close(this.errorHandler, UdpChannelTransport.closeable(receive));
            }
        } finally {
            // closing a Java channel discards unread datagrams
            this.ring?.clear();
            this.ring = null;
            this.portManager.freeManagedPort(this.bindAddress);
        }
    }

    /**
     * Is the send socket connected (Java: `DatagramChannel.isConnected()`)? A connect that node refused is not.
     *
     * @return true if the send socket is open and connected.
     */
    public isConnected(): boolean {
        return this.connected && !this.isClosed;
    }

    /**
     * Return underlying {@link UdpChannel}.
     *
     * @return underlying channel.
     */
    public udpChannel(): UdpChannel {
        return this._udpChannel;
    }

    /**
     * The datagram socket for this transport channel (Java: `receiveDatagramChannel()`).
     *
     * @return the socket for this transport channel, null until opened and after a failed open.
     */
    public receiveDatagramChannel(): Socket | null {
        return this._receiveDatagramChannel;
    }

    /**
     * Get the multicast TTL value for sending datagrams on the channel.
     *
     * @return the multicast TTL value for sending datagrams on the channel.
     */
    public multicastTtl(): number {
        return this._multicastTtl;
    }

    /**
     * Get the bind address and port in endpoint-style format (ip:port).
     * <p>
     * Must be called after the channel is opened.
     *
     * @return the bind address and port in endpoint-style format (ip:port).
     */
    public bindAddressAndPort(): string {
        try {
            const localAddress = (this._receiveDatagramChannel as Socket).address();
            return NetworkUtil.formatAddressAndPort(InetAddress.getByName(localAddress.address), localAddress.port);
        } catch {
            return '';
        }
    }

    /**
     * Is transport representing a multicast media?
     *
     * @return true if transport is multicast media, otherwise false.
     */
    public isMulticast(): boolean {
        return this._udpChannel.isMulticast();
    }

    /**
     * Is the received frame valid. This method will do some basic checks on the header and can be
     * overridden in a subclass for further validation.
     *
     * @param buffer containing the frame.
     * @param length of the frame.
     * @return true if the frame is believed valid otherwise false.
     */
    public isValidFrame(buffer: UnsafeBuffer, length: number): boolean {
        let frameLength: number;
        if (
            length > MIN_HEADER_LENGTH &&
            (frameLength = FrameDescriptor.frameLength(buffer, 0)) >= 0 &&
            CURRENT_VERSION === FrameDescriptor.frameVersion(buffer, 0)
        ) {
            const frameType = FrameDescriptor.frameType(buffer, 0);
            if (HDR_TYPE_DATA === frameType || HDR_TYPE_PAD === frameType) {
                if (length >= DataHeaderFlyweight.HEADER_LENGTH && FrameDescriptor.isFrameAligned(length)) {
                    return true;
                }
            } else {
                let valid: boolean;
                switch (frameType) {
                    case HDR_TYPE_NAK:
                        valid = length >= NakFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    case HDR_TYPE_SM:
                        valid = length >= StatusMessageFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    case HDR_TYPE_ERR:
                        valid = length >= ErrorFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    case HDR_TYPE_SETUP:
                        valid = length >= SetupFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    case HDR_TYPE_RTTM:
                        valid = length >= RttMeasurementFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    case HDR_TYPE_RES:
                        valid =
                            length >= MIN_HEADER_LENGTH + ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH &&
                            frameLength <= length;
                        break;
                    case HDR_TYPE_RSP_SETUP:
                        valid = length >= ResponseSetupFlyweight.HEADER_LENGTH && frameLength <= length;
                        break;
                    default:
                        valid = false;
                }

                if (valid) {
                    return true;
                }
            }
        }

        this.invalidPackets.increment();
        return false;
    }

    /**
     * Send packet hook that can be used for logging. `DriverLog` is not ported (the logging agents are out of scope,
     * spec section 3), so the hook does nothing; a subclass may override it.
     *
     * @param _buffer  containing the packet.
     * @param _address to which the packet will be sent.
     */
    public sendHook(_buffer: DirectBuffer, _address: InetSocketAddress | null): void {}

    /**
     * Receive packet hook that can be useful for logging. `DriverLog` is not ported, so the hook does nothing.
     *
     * @param _buffer  containing the packet.
     * @param _length  length of the packet in bytes.
     * @param _address from which the packet came.
     */
    public receiveHook(_buffer: UnsafeBuffer, _length: number, _address: InetSocketAddress): void {}

    /**
     * Useful hook for logging resend calls. `DriverLog` is not ported, so the hook does nothing.
     *
     * @param _sessionId  to resend
     * @param _streamId   to resend
     * @param _termId     to resend
     * @param _termOffset to resend
     * @param _length     to resend
     */
    public resendHook(
        _sessionId: number,
        _streamId: number,
        _termId: number,
        _termOffset: number,
        _length: number,
    ): void {}

    /**
     * Receive a datagram from the media layer.
     * <p>
     * It pops the oldest datagram of the {@link ReceiveRing} (D1), at most one per call, and copies it to the start of
     * `buffer`, cut to the capacity of `buffer` as a Java `ByteBuffer.receive` cuts it. The length is
     * {@link receivedLength} (Java: `byteBuffer.position()`). First it hands any error that a socket event held to the
     * error handler: this call is made once per duty cycle, so those errors are reported inside the agent's cycle.
     *
     * @param buffer into which the datagram will be received.
     * @return the source address of the datagram if one is available otherwise null.
     */
    public receive(buffer: UnsafeBuffer): InetSocketAddress | null {
        this.reportDeferredErrors();

        this.receivedLength_ = 0;
        const ring = this.ring;
        if (null === ring || ring.isEmpty()) {
            return null;
        }

        let length = ring.headLength();
        const capacity = buffer.capacity();
        if (length > capacity) {
            length = capacity;
        }

        buffer.putBytes(0, ring.headBuffer(), 0, length);
        const address = ring.headAddress();
        ring.advance();
        this.receivedLength_ = length;

        return address;
    }

    /**
     * The length of the datagram that the last call to {@link receive} copied, 0 when it found none. (Java: the
     * `position()` of the `ByteBuffer` after `receive`.)
     *
     * @return the length in bytes.
     */
    public receivedLength(): number {
        return this.receivedLength_;
    }

    /**
     * Send `length` bytes of `buffer` from `offset` on the connected socket (Java: `DatagramChannel.write`).
     * <p>
     * The caller may change `buffer` as soon as this returns (D2): the bytes are copied to the send slot, which is the
     * only buffer that node and libuv ever reference. While libuv still holds a datagram (its send queue is not empty)
     * nothing is copied and the result is 0, which is Java's `EAGAIN`: the caller counts a short send and tries again
     * in its next cycle.
     *
     * @return the number of bytes sent, `length`, or 0 if the datagram was not sent.
     */
    public send(buffer: DirectBuffer, offset: number, length: number): number {
        return this.dispatch(buffer, offset, length, null);
    }

    /**
     * Send `length` bytes of `buffer` from `offset` to `address` on an unconnected socket (Java:
     * `DatagramChannel.send(ByteBuffer, SocketAddress)`). See {@link send}.
     *
     * @return the number of bytes sent, `length`, or 0 if the datagram was not sent.
     */
    public sendTo(buffer: DirectBuffer, offset: number, length: number, address: InetSocketAddress): number {
        return this.dispatch(buffer, offset, length, address);
    }

    /**
     * Endpoint has moved to a new address. Handle this.
     *
     * @param newAddress      to send data to.
     * @param statusIndicator for the channel
     */
    public updateEndpoint(newAddress: InetSocketAddress, statusIndicator: AtomicCounter | null): void {
        try {
            const socket = this.sendDatagramChannel;
            if (null !== socket) {
                this.isOpening = true;
                this.openError = null;
                this.connected = false;
                try {
                    socket.disconnect();
                } catch (ex) {
                    if ('ERR_SOCKET_DGRAM_NOT_CONNECTED' !== codeOf(ex as Error)) {
                        throw ex;
                    }
                }

                this.connectChecked(socket, newAddress);
                this.connectAddress = newAddress;

                if (null !== statusIndicator) {
                    statusIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
                }
            }
        } catch (ex) {
            if (null !== statusIndicator) {
                statusIndicator.setRelease(ChannelEndpointStatus.ERRORED);
            }

            const error = ex as Error;
            const message =
                're-resolve endpoint channel error - ' +
                error.message +
                ' (at ' +
                UdpChannelTransport.firstFrame(error) +
                '): ' +
                this._udpChannel.originalUriString();

            // The failed connect was handled by this throw. Node also emits it as an 'error' event later (Java has no
            // such second error): onSocketError drops one error of the connect, whenever it arrives, instead of
            // reporting it at the next poll.
            if (error instanceof IOException || 'connect' === (error as NodeJS.ErrnoException).syscall) {
                this.connectFailureHandled = true;
            }

            throw new AeronException(message, error);
        } finally {
            this.isOpening = false;
        }
    }

    /**
     * Get the configured OS send socket buffer length (SO_SNDBUF) for the endpoint's socket.
     *
     * @return OS socket send buffer length or 0 if using OS default.
     */
    public socketSndbufLength(): number {
        return this._socketSndbufLength;
    }

    /**
     * Get the configured OS receive socket buffer length (SO_RCVBUF) for the endpoint's socket.
     *
     * @return OS socket receive buffer length or 0 if using OS default.
     */
    public socketRcvbufLength(): number {
        return this._socketRcvbufLength;
    }

    /**
     * Not in Java (spec D8). The function to call, from the event loop, when a datagram has arrived or a full send
     * queue has drained, so that the agent runner cuts short an idle sleep (`AgentRunner.wake`). The owner of the
     * transport sets one preallocated function. A transport starts with the one of its context
     * (`MediaDriver.Context.wakeUp`, which `MediaDriver.launch` sets for its runner).
     */
    public setWakeUp(wakeUp: (() => void) | null): void {
        this.wakeUp = wakeUp;
    }

    /**
     * Not in Java (spec 4.2, D1). The `'message'` handler of the receive socket: puts the datagram in the ring and
     * wakes the agent. The datagram is a reference to the `Buffer` that node allocated for it, which the handler owns
     * (N7). When the ring is full the datagram is dropped and counted, as a full kernel buffer would drop it in Java.
     * <p>
     * Java hands the same `InetSocketAddress` over while the sender stays the same (the JDK reuses the last sender's).
     * This interns the addresses of the last {@link SOURCE_ADDRESS_CAPACITY} senders by (host, port): a sender that is
     * in the table yields the same instance and allocates nothing; a new one, or one evicted (round-robin), builds an
     * address.
     *
     * @internal public for tests
     */
    public onMessage(message: Uint8Array, rinfo: RemoteInfo): void {
        const ring = this.ring;
        if (null === ring) {
            return;
        }

        const host = rinfo.address;
        const port = rinfo.port;
        const hosts = this.srcHosts;
        const ports = this.srcPorts;
        let index = this.srcLast;
        if (port !== ports[index] || host !== hosts[index]) {
            index = -1;
            for (let i = 0; i < hosts.length; i++) {
                if (port === ports[i] && host === hosts[i]) {
                    index = i;
                    break;
                }
            }

            if (-1 === index) {
                index = this.srcNext;
                this.srcNext = index + 1 === hosts.length ? 0 : index + 1;
                hosts[index] = host;
                ports[index] = port;
                this.srcAddresses[index] = new InetSocketAddress(InetAddress.getByName(host), port);
            }

            this.srcLast = index;
        }

        const address = this.srcAddresses[index] as InetSocketAddress;

        if (!ring.offer(message, message.length, address)) {
            this.receiveRingDrops?.increment();
        }

        this.wakeUp?.();
    }

    /**
     * Hands the errors that socket events held to the error handler. Called at the start of every {@link receive}.
     */
    private reportDeferredErrors(): void {
        const receiveError = this.pendingReceiveError;
        if (null !== receiveError) {
            this.pendingReceiveError = null;
            this.errorHandler?.onError(receiveError);
        }

        const sendError = this.pendingSendError;
        if (null !== sendError) {
            this.pendingSendError = null;
            if (null !== this.errorHandler) {
                UdpChannelTransport.onSendError(sendError, this.destinationOf(sendError), this.errorHandler);
            }
        }
    }

    /**
     * The `'error'` event of a socket. An ICMP port unreachable on a connected socket (`ECONNREFUSED`, N5) is ignored,
     * as Java ignores `PortUnreachableException`; anything else is held for the next poll. One error of each kind is
     * held, the first: a repeating error is reported once per duty cycle.
     */
    private onSocketError(error: Error): void {
        if (this.connectFailureHandled && 'connect' === (error as NodeJS.ErrnoException).syscall) {
            this.connectFailureHandled = false;
            return;
        }

        if (this.isOpening) {
            this.openError ??= error;
            return;
        }

        if (this.isClosed || 'ECONNREFUSED' === codeOf(error)) {
            return;
        }

        this.pendingReceiveError ??= error;
    }

    /**
     * The completion callback of a send (N4, D2): the datagram has been given to the kernel, or the send failed.
     * `ECONNREFUSED` (Java: `PortUnreachableException`) and `ECANCELED` (the socket was closed, N8) are ignored; any
     * other error is held for the next poll and counts as a lost datagram. A drained queue wakes the agent.
     */
    private onSendComplete(error: Error | null): void {
        if (null !== error) {
            const code = codeOf(error);
            if (!this.isClosed && 'ECONNREFUSED' !== code && 'ECANCELED' !== code) {
                this.pendingSendError ??= error;
            }
        }

        if (this.sendBlocked && !this.isClosed && 0 === (this.sendDatagramChannel as Socket).getSendQueueCount()) {
            this.sendBlocked = false;
            this.wakeUp?.();
        }
    }

    private dispatch(buffer: DirectBuffer, offset: number, length: number, address: InetSocketAddress | null): number {
        const socket = this.sendDatagramChannel;
        if (null === socket || this.isClosed) {
            return 0;
        }

        // Java's EAGAIN: libuv holds the send slot until it has sent it, so the slot is not touched (D2, N3).
        if (socket.getSendQueueCount() > 0) {
            this.sendBlocked = true;
            return 0;
        }

        try {
            buffer.getBytes(offset, this.sendSlot, 0, length);
            // The call shapes of node's `dgram` that neither slice the buffer (a view per send) nor resolve a host
            // (spec D113): a view of exactly `length` bytes, then the callback on a connected socket, or the port, the
            // address literal and the callback.
            const view = this.sendView(length);
            if (null === address) {
                socket.send(view, this.onSendCompleteCallback);
            } else {
                socket.send(
                    view,
                    address.getPort(),
                    (address.getAddress() as InetAddress).getHostAddress(),
                    this.onSendCompleteCallback,
                );
            }
        } catch (ex) {
            // a send that node refuses before it starts: a datagram that cannot be sent, as Java's IOException
            if (null !== this.errorHandler) {
                UdpChannelTransport.onSendError(ex as Error, address ?? this.connectAddress, this.errorHandler);
            }

            return 0;
        }

        return length;
    }

    /** The view of the first `length` bytes of the send slot: made once for each length, then reused (spec D113). */
    private sendView(length: number): Uint8Array {
        let view = this.sendViews.get(length);
        if (undefined === view) {
            view = this.sendSlot.subarray(0, length);
            this.sendViews.set(length, view);
        }

        return view;
    }

    /**
     * The host a multicast receive socket is bound to: the group of the channel (D119), otherwise the wildcard (null). A
     * group of interface-local or link-local scope (`ffx1`, `ffx2`) is bound with the scope of the channel's interface
     * (`%name`), which the kernel needs for it; without an interface it cannot be bound, and the wildcard is kept.
     */
    private static multicastBindHost(
        udpChannel: UdpChannel,
        endPointAddress: InetSocketAddress,
        multicastInterface: string | undefined,
    ): string | null {
        if ('win32' === process.platform) {
            return null;
        }

        const address = endPointAddress.getAddress() as InetAddress;
        const group = address.getHostAddress();
        if (StandardProtocolFamily.INET !== udpChannel.protocolFamily()) {
            const scope = (address.getAddress()[1] as number) & 0x0f;
            if (scope > 2 || group.includes('%')) {
                return group;
            }

            return undefined !== multicastInterface ? group + multicastInterface.substring(2) : null;
        }

        return group;
    }

    private newSocket(reuseAddress: boolean): Socket {
        const type = StandardProtocolFamily.INET6 === this._udpChannel.protocolFamily() ? 'udp6' : 'udp4';
        const socket = dgram.createSocket({ type, lookup: synchronousLookup, reuseAddr: reuseAddress });
        socket.on('error', this.onSocketErrorCallback);

        return socket;
    }

    /**
     * Bind, which with the synchronous lookup reports a failure as an `'error'` event inside the call (N6): rethrown here.
     */
    private bindChecked(socket: Socket, port: number, host: string | null): void {
        if (null === host) {
            socket.bind(port);
        } else {
            socket.bind(port, host);
        }

        this.throwOpenError();
    }

    /**
     * Connect. A failure that node knows at once (a wrong address family) leaves the socket unconnected, which
     * `remoteAddress` reports, and node also emits it as an `'error'` event on the next tick, which the closed or
     * failed transport ignores.
     */
    private connectChecked(socket: Socket, address: InetSocketAddress): void {
        socket.connect(address.getPort(), UdpChannelTransport.hostAddress(address));
        this.throwOpenError();
        try {
            socket.remoteAddress();
        } catch {
            throw new IOException('connect failed: ' + address);
        }

        this.connected = true;
    }

    private throwOpenError(): void {
        const error = this.openError;
        if (null !== error) {
            this.openError = null;
            throw error;
        }
    }

    private join(socket: Socket): void {
        const group = UdpChannelTransport.hostAddress(this.endPointAddress);
        socket.addMembership(group, this.multicastInterface());
    }

    /**
     * What node calls the interface of a multicast group: the first address of the channel's interface of the
     * channel's family for IPv4, the scope (`::%name`) for IPv6; undefined (the OS chooses) without an interface.
     */
    private multicastInterface(): string | undefined {
        const networkInterface: NetworkInterface | null = this._udpChannel.localInterface();
        if (null === networkInterface) {
            return undefined;
        }

        if (StandardProtocolFamily.INET6 === this._udpChannel.protocolFamily()) {
            return '::%' + networkInterface.getName();
        }

        for (const interfaceAddress of networkInterface.getInterfaceAddresses()) {
            const address = interfaceAddress.getAddress();
            if (address instanceof Inet4Address) {
                return address.getHostAddress();
            }
        }

        return undefined;
    }

    private configureMulticastSend(socket: Socket): void {
        const multicastInterface = this.multicastInterface();
        if (undefined !== multicastInterface) {
            socket.setMulticastInterface(multicastInterface);
        }

        if (this._udpChannel.hasMulticastTtl()) {
            socket.setMulticastTTL(this._udpChannel.multicastTtl());
            this._multicastTtl = this._udpChannel.multicastTtl();
        } else if (this.context.socketMulticastTtl() !== 0) {
            socket.setMulticastTTL(this.context.socketMulticastTtl());
            this._multicastTtl = this.context.socketMulticastTtl();
        }
    }

    /**
     * The destination of a send that failed later: the address node reports with the error, else the address the
     * socket is connected to.
     */
    private destinationOf(error: Error): InetSocketAddress | null {
        const { address, port } = error as Error & { address?: string; port?: number };
        if (undefined !== address && undefined !== port) {
            try {
                return new InetSocketAddress(InetAddress.getByName(address), port);
            } catch {
                // fall through to the connected address
            }
        }

        return this.connectAddress;
    }

    private static hostAddress(address: InetSocketAddress): string {
        return (address.getAddress() as InetAddress).getHostAddress();
    }

    /** Closes a socket once: node throws when it is closed already. */
    private static closeable(socket: Socket | null): AutoCloseable | null {
        if (null === socket) {
            return null;
        }

        return {
            close: () => {
                try {
                    socket.close();
                } catch (ex) {
                    if ('ERR_SOCKET_DGRAM_NOT_RUNNING' !== codeOf(ex as Error)) {
                        throw ex;
                    }
                }
            },
        };
    }

    /** Java's `ex.getStackTrace()[0]`: the first frame of the error, without the "at ". */
    private static firstFrame(error: Error): string {
        const line = (error.stack ?? '').split('\n').find((l) => l.trimStart().startsWith('at '));
        return undefined === line ? 'unknown' : line.trim().substring(3);
    }
}
