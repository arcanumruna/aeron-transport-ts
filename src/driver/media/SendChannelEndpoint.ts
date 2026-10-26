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
// Port of io/aeron/driver/media/SendChannelEndpoint.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { CloseHelper } from '../../agrona/CloseHelper.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import { ArrayUtil } from '../../agrona/collections/ArrayUtil.js';
import { LongHalves2ObjectHashMap } from '../../agrona/collections/LongHalves2ObjectHashMap.js';
import type { CachedNanoClock } from '../../agrona/concurrent/CachedNanoClock.js';
import type { EpochNanoClock } from '../../agrona/concurrent/EpochNanoClock.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { ByteOrder, IllegalStateException, TimeUnit } from '../../agrona/jdk.js';
import { requireNonNull } from '../../agrona/jdkLang.js';
import type { MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { Aeron } from '../../client/Aeron.js';
import type { ChannelUri } from '../../client/ChannelUri.js';
import { CommonContext } from '../../client/CommonContext.js';
import { ErrorCode } from '../../client/ErrorCode.js';
import { ControlProtocolException } from '../../client/exceptions/ControlProtocolException.js';
import { FrameDescriptor } from '../../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../client/protocol/DataHeaderFlyweight.js';
import type { ErrorFlyweight } from '../../client/protocol/ErrorFlyweight.js';
import type { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import type { ResponseSetupFlyweight } from '../../client/protocol/ResponseSetupFlyweight.js';
import type { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../client/status/LocalSocketAddressStatus.js';
import type { DriverConductorProxy } from '../DriverConductorProxy.js';
import type { InetAddress, InetSocketAddress } from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import type { NetworkPublication } from '../NetworkPublication.js';
import { MdcDestinations } from '../status/MdcDestinations.js';
import { SystemCounterDescriptor } from '../status/SystemCounterDescriptor.js';
import type { UdpChannel } from './UdpChannel.js';
import { UdpChannelTransport } from './UdpChannelTransport.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { SIZE_OF_LONG } = BitUtil;
const { SEND_SETUP_FLAG } = StatusMessageFlyweight;
const { NAK_MESSAGES_RECEIVED, STATUS_MESSAGES_RECEIVED, STATUS_MESSAGES_REJECTED, ERROR_FRAMES_RECEIVED } =
    SystemCounterDescriptor;

const DESTINATION_TIMEOUT: number = TimeUnit.SECONDS.toNanos(5);

/**
 * Aggregator of multiple {@link NetworkPublication}s onto a single transport channel for the
 * sending of data and setup frames plus the receiving of status and NAK frames.
 */
export class SendChannelEndpoint extends UdpChannelTransport {
    public static readonly DESTINATION_TIMEOUT: number = DESTINATION_TIMEOUT;

    private refCount = 0;
    private timeOfLastResolutionNs = 0;
    // keyed by (sessionId, streamId) as the halves of Java's compoundKey (spec D14)
    private readonly publicationBySessionAndStreamId = new LongHalves2ObjectHashMap<NetworkPublication>();
    private readonly multiSndDestination: MultiSndDestination | null;
    private readonly statusMessagesReceived: AtomicCounter;
    private readonly statusMessagesRejected: AtomicCounter;
    private readonly nakMessagesReceived: AtomicCounter;
    private readonly statusIndicator: AtomicCounter;
    private readonly errorMessagesReceived: AtomicCounter;
    private readonly isChannelSendTimestampEnabled: boolean;
    private readonly sendTimestampClock: EpochNanoClock | null;
    private readonly sendTimestampBuffer = new UnsafeBuffer();
    // the halves of the send timestamp (spec D17), written once per packet, never allocated per packet
    private readonly sendTimestampHalves = new Int32Array(2);
    private _localSocketAddressIndicator: AtomicCounter | null = null;
    private mdcDestinationsCounter: AtomicCounter | null = null;

    /**
     * Construct the sender end for data streams.
     *
     * @param udpChannel      configuration for the media.
     * @param statusIndicator to indicate the status of the channel endpoint.
     * @param context         for configuration.
     */
    public constructor(udpChannel: UdpChannel, statusIndicator: AtomicCounter, context: MediaDriverContext) {
        super(
            udpChannel,
            udpChannel.remoteControl(),
            udpChannel.localControl(),
            udpChannel.isMultiDestination() || udpChannel.isResponseControlMode() ? null : udpChannel.remoteData(),
            context.senderPortManager(),
            context,
        );

        const systemCounters = requireNonNull(context.systemCounters());
        this.nakMessagesReceived = systemCounters.get(NAK_MESSAGES_RECEIVED);
        this.statusMessagesReceived = systemCounters.get(STATUS_MESSAGES_RECEIVED);
        this.statusMessagesRejected = systemCounters.get(STATUS_MESSAGES_REJECTED);
        this.errorMessagesReceived = systemCounters.get(ERROR_FRAMES_RECEIVED);
        this.statusIndicator = statusIndicator;

        let multiSndDestination: MultiSndDestination | null = null;
        if (udpChannel.isManualControlMode()) {
            multiSndDestination = new ManualSndMultiDestination(
                context.senderCachedNanoClock() as CachedNanoClock,
                this.errorHandler,
            );
        } else if (udpChannel.isDynamicControlMode()) {
            multiSndDestination = new DynamicSndMultiDestination(
                context.senderCachedNanoClock() as CachedNanoClock,
                this.errorHandler,
            );
        }

        this.multiSndDestination = multiSndDestination;
        this.isChannelSendTimestampEnabled = udpChannel.isChannelSendTimestampEnabled();
        this.sendTimestampClock = context.channelSendTimestampClock();
    }

    /**
     * Set a channel binding status counter.
     *
     * @param counter to be set.
     */
    public localSocketAddressIndicator(counter: AtomicCounter): void {
        this._localSocketAddressIndicator = counter;
    }

    /**
     * Decrement the reference count to the channel.
     */
    public decRef(): void {
        --this.refCount;
    }

    /**
     * Increment the reference count to the channel.
     */
    public incRef(): void {
        ++this.refCount;
    }

    /**
     * Open the underlying sockets for the channel.
     */
    public openChannel(): void {
        this.openDatagramChannel(this.statusIndicator);

        const localSocketAddressIndicator = requireNonNull(
            this._localSocketAddressIndicator,
            'localSocketAddressIndicator not allocated',
        );
        LocalSocketAddressStatus.updateBindAddress(
            localSocketAddressIndicator,
            this.bindAddressAndPort(),
            this.context.countersMetaDataBuffer() as UnsafeBuffer,
        );
        localSocketAddressIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
    }

    /**
     * The original URI String used when a subscription was added.
     *
     * @return the original URI String used when a subscription was added.
     */
    public originalUriString(): string {
        return this.udpChannel().originalUriString();
    }

    /**
     * Counter id of the channel status indicator counter.
     *
     * @return id of the channel status indicator counter.
     */
    public statusIndicatorCounterId(): number {
        return this.statusIndicator.id();
    }

    /**
     * Indicate that the channel as active after successfully opening it.
     */
    public indicateActive(): void {
        const currentStatus = this.statusIndicator.getPlain();
        if (currentStatus !== ChannelEndpointStatus.INITIALIZING) {
            throw new IllegalStateException(
                'channel cannot be registered unless INITIALIZING: status=' +
                    ChannelEndpointStatus.status(currentStatus),
            );
        }

        this.statusIndicator.appendToLabel(this.bindAddressAndPort());
        this.statusIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
    }

    /**
     * Indicate that the channel is closing and should not be used for new publications.
     */
    public indicateClosing(): void {
        this.statusIndicator.setRelease(ChannelEndpointStatus.CLOSING);
    }

    /**
     * The {@link ChannelEndpointStatus} value for the channel.
     *
     * <p>Must not be called after calling {@link close}, as it accesses a counter.</p>
     *
     * @return the {@link ChannelEndpointStatus} value for the channel.
     */
    public status(): number {
        return this.statusIndicator.getAcquire();
    }

    /**
     * {@inheritDoc}
     */
    public override close(): void {
        super.close();
        CloseHelper.close(this.errorHandler, this.statusIndicator);
        CloseHelper.close(this.errorHandler, this._localSocketAddressIndicator);
        CloseHelper.close(this.errorHandler, this.mdcDestinationsCounter);
    }

    /**
     * Called by to determine if the channel endpoint should be closed.
     *
     * @return true if ready to be closed.
     */
    public shouldBeClosed(): boolean {
        return (
            0 === this.refCount &&
            !this.statusIndicator.isClosed() &&
            this.statusIndicator.get() !== ChannelEndpointStatus.CLOSING
        );
    }

    /**
     * Called from the {@link Sender} to add information to the control packet dispatcher.
     *
     * @param publication to add to the dispatcher
     */
    public registerForSend(publication: NetworkPublication): void {
        this.publicationBySessionAndStreamId.put(publication.sessionId(), publication.streamId(), publication);
    }

    /**
     * Called from the {@link Sender} to remove information from the control packet dispatcher.
     *
     * @param publication to remove
     */
    public unregisterForSend(publication: NetworkPublication): void {
        this.publicationBySessionAndStreamId.remove(publication.sessionId(), publication.streamId());
    }

    /**
     * Send `length` bytes of `buffer` from `offset` to the connected address (Java: `send(ByteBuffer)`, with the
     * `ByteBuffer` position and remaining as `offset` and `length`, spec D28). This is used on the sender side for
     * performance over {@link sendTo}.
     *
     * @param buffer to send
     * @param offset of the first byte to send.
     * @param length of the bytes to send.
     * @return number of bytes sent
     */
    public override send(buffer: UnsafeBuffer, offset: number, length: number): number {
        let bytesSent = 0;

        if (this.isChannelSendTimestampEnabled) {
            this.applyChannelSendTimestamp(buffer, offset, length);
        }

        if (null !== this.sendDatagramChannel) {
            if (null === this.multiSndDestination) {
                this.sendHook(buffer, this.connectAddress);
                if (this.isConnected()) {
                    bytesSent = super.send(buffer, offset, length);
                }
            } else {
                bytesSent = this.multiSndDestination.send(this, buffer, offset, length);
            }
        }

        return bytesSent;
    }

    /**
     * Send `length` bytes of `buffer` from `offset` to `endpointAddress` (Java: `send(ByteBuffer, InetSocketAddress)`,
     * named as the transport names it, spec D28).
     *
     * @param buffer          to send
     * @param offset          of the first byte to send.
     * @param length          of the bytes to send.
     * @param endpointAddress to send data to.
     * @return number of bytes sent
     */
    public override sendTo(
        buffer: UnsafeBuffer,
        offset: number,
        length: number,
        endpointAddress: InetSocketAddress,
    ): number {
        let bytesSent = 0;

        if (this.isChannelSendTimestampEnabled) {
            this.applyChannelSendTimestamp(buffer, offset, length);
        }

        if (null !== this.sendDatagramChannel) {
            bytesSent = this.sendToChannel(buffer, offset, length, endpointAddress);
        }

        return bytesSent;
    }

    /**
     * Java's `sendHook` and `DatagramChannel.send(buffer, address)` on the channel of this endpoint: what
     * {@link MultiSndDestination} calls for each destination, without the timestamps that {@link sendTo} applies.
     *
     * @internal package-private in Java (it is Java's direct use of `sendDatagramChannel`)
     */
    public sendToChannel(buffer: UnsafeBuffer, offset: number, length: number, address: InetSocketAddress): number {
        this.sendHook(buffer, address);
        return super.sendTo(buffer, offset, length, address);
    }

    /**
     * Check sockets may need to be re-resolved due to no activity.
     *
     * @param nowNs          to test against for activity.
     * @param conductorProxy to notify of any addresses which may need to be re-resolved.
     */
    public checkForReResolution(nowNs: number, conductorProxy: DriverConductorProxy): void {
        const udpChannel = this._udpChannel;
        if (udpChannel.isManualControlMode()) {
            (this.multiSndDestination as MultiSndDestination).checkForReResolution(this, nowNs, conductorProxy);
        } else if (
            udpChannel.hasExplicitEndpoint() &&
            !udpChannel.isMulticast() &&
            !udpChannel.isResponseControlMode()
        ) {
            if (this.statusMessageTimeout(nowNs) && this.timeOfLastResolutionNs + DESTINATION_TIMEOUT - nowNs < 0) {
                this.timeOfLastResolutionNs = nowNs;
                const endpoint = udpChannel.channelUri().get(CommonContext.ENDPOINT_PARAM_NAME) as string;
                conductorProxy.reResolveEndpoint(endpoint, this, this.connectAddress);
            }
        }
    }

    /**
     * Callback back handler for received status messages.
     *
     * @param msg            flyweight over the status message.
     * @param buffer         containing the message.
     * @param length         of the message.
     * @param srcAddress     of the message.
     * @param conductorProxy to send messages back to the conductor.
     */
    public onStatusMessage(
        msg: StatusMessageFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        srcAddress: InetSocketAddress,
        conductorProxy: DriverConductorProxy,
    ): void {
        const sessionId = msg.sessionId();
        const streamId = msg.streamId();
        const publication = this.publicationBySessionAndStreamId.get(sessionId, streamId);

        if (!msg.isValid(null !== publication ? publication.termBufferLength() : LogBufferDescriptor.TERM_MAX_LENGTH)) {
            this.invalidPackets.increment();
            return;
        }

        this.statusMessagesReceived.incrementRelease();

        if (
            SEND_SETUP_FLAG !== (msg.flags() & SEND_SETUP_FLAG) &&
            null !== publication &&
            !publication.isValidStatusMessage(msg)
        ) {
            this.statusMessagesRejected.incrementRelease();
            return; // drop SM that is out of bounds
        }

        if (null !== this.multiSndDestination) {
            this.multiSndDestination.onStatusMessage(msg, srcAddress);
        }

        if (null !== publication) {
            if (SEND_SETUP_FLAG === (msg.flags() & SEND_SETUP_FLAG)) {
                publication.triggerSendSetupFrame(msg, srcAddress);
            } else {
                publication.onStatusMessage(msg, srcAddress, conductorProxy);
            }
        }
    }

    /**
     * Callback back handler for received error messages.
     *
     * @param msg            flyweight over the status message.
     * @param buffer         containing the message.
     * @param length         of the message.
     * @param srcAddress     of the message.
     * @param conductorProxy to send messages back to the conductor.
     */
    public onError(
        msg: ErrorFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        srcAddress: InetSocketAddress,
        conductorProxy: DriverConductorProxy,
    ): void {
        if (!msg.isValid()) {
            this.invalidPackets.increment();
            return;
        }

        this.errorMessagesReceived.incrementRelease();

        const destinationRegistrationId =
            null !== this.multiSndDestination
                ? this.multiSndDestination.findRegistrationId(msg, srcAddress)
                : Aeron.NULL_VALUE;

        const publication = this.publicationBySessionAndStreamId.get(msg.sessionId(), msg.streamId());
        if (null !== publication) {
            publication.onError(msg, srcAddress, destinationRegistrationId, conductorProxy);
        }
    }

    /**
     * Callback back handler for received NAK messages.
     *
     * @param msg        flyweight over the NAK message.
     * @param buffer     containing the message.
     * @param length     of the message.
     * @param srcAddress of the message.
     */
    public onNakMessage(
        msg: NakFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        _srcAddress: InetSocketAddress,
    ): void {
        // DriverLog.logNakReceived: the logging agents are out of scope (spec section 3)

        const publication = this.publicationBySessionAndStreamId.get(msg.sessionId(), msg.streamId());

        if (null !== publication) {
            if (msg.isValid(publication.termBufferLength())) {
                this.nakMessagesReceived.incrementRelease();
                publication.onNak(msg);
            } else {
                this.invalidPackets.increment();
            }
        }
    }

    /**
     * Callback back handler for received RTT Measurement messages.
     *
     * @param msg        flyweight over the RTT message.
     * @param buffer     containing the message.
     * @param length     of the message.
     * @param srcAddress of the message.
     */
    public onRttMeasurement(
        msg: RttMeasurementFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        srcAddress: InetSocketAddress,
    ): void {
        const publication = this.publicationBySessionAndStreamId.get(msg.sessionId(), msg.streamId());
        if (null !== publication) {
            publication.onRttMeasurement(msg, srcAddress);
        }
    }

    /**
     * Callback to handle a received Response Setup frame.
     *
     * @param msg            of the Response Setup frame.
     * @param unsafeBuffer   containing the Response Setup frame.
     * @param length         of the Response Setup frame.
     * @param srcAddress     the message came from.
     * @param conductorProxy to send messages back to the conductor.
     */
    public onResponseSetup(
        msg: ResponseSetupFlyweight,
        _unsafeBuffer: UnsafeBuffer,
        _length: number,
        _srcAddress: InetSocketAddress,
        conductorProxy: DriverConductorProxy,
    ): void {
        const publication = this.publicationBySessionAndStreamId.get(msg.sessionId(), msg.streamId());

        if (null !== publication) {
            const responseCorrelationId = publication.responseCorrelationId();
            if (Aeron.NULL_VALUE !== responseCorrelationId) {
                conductorProxy.responseSetup(responseCorrelationId, msg.responseSessionId());
            }
        }
    }

    /**
     * Validate that the channel allows manual control for destinations.
     * <p>
     * If not then a {@link ControlProtocolException} will be thrown.
     */
    public validateAllowsManualControl(): void {
        if (!(this.multiSndDestination instanceof ManualSndMultiDestination)) {
            throw new ControlProtocolException(ErrorCode.INVALID_CHANNEL, 'channel does not allow manual control');
        }
    }

    /**
     * Add a destination for an MDC channel.
     *
     * @param channelUri     for the destination to be added.
     * @param address        of the destination to be added.
     * @param registrationId of the destination.
     */
    public addDestination(channelUri: ChannelUri, address: InetSocketAddress, registrationId: number): void {
        (this.multiSndDestination as MultiSndDestination).addDestination(channelUri, address, registrationId);
    }

    /**
     * Remove a destination from an MDC channel, by its channel and address or by the registration id of the
     * destination (Java: two overloads).
     *
     * @param channelUriOrRegistrationId for the destination to be removed, or the registration id of the destination.
     * @param address                    of the destination to be removed (with a channel).
     */
    public removeDestination(destinationRegistrationId: number): void;
    public removeDestination(channelUri: ChannelUri, address: InetSocketAddress): void;
    public removeDestination(channelUriOrRegistrationId: ChannelUri | number, address?: InetSocketAddress): void {
        const multiSndDestination = this.multiSndDestination as MultiSndDestination;
        if (typeof channelUriOrRegistrationId === 'number') {
            multiSndDestination.removeDestinationById(channelUriOrRegistrationId);
        } else {
            multiSndDestination.removeDestination(channelUriOrRegistrationId, address as InetSocketAddress);
        }
    }

    /**
     * Update the endpoint for the channel on address change.
     *
     * @param endpoint   associated with the address.
     * @param newAddress for the endpoint.
     */
    public resolutionChange(endpoint: string, newAddress: InetSocketAddress): void {
        if (null !== this.multiSndDestination) {
            this.multiSndDestination.updateDestination(endpoint, newAddress);
        } else {
            this.updateEndpoint(newAddress, this.statusIndicator);
        }
    }

    /**
     * Allocate a destinations counter if the channel uses multiple destinations.
     *
     * @param tempBuffer        to use for metadata formatting.
     * @param countersManager   for the driver.
     * @param registrationId    of the endpoint.
     * @param originalUriString of the channel.
     */
    public allocateDestinationsCounterForMdc(
        tempBuffer: MutableDirectBuffer,
        countersManager: CountersManager,
        registrationId: number,
        originalUriString: string,
    ): void {
        if (null !== this.multiSndDestination) {
            this.mdcDestinationsCounter = MdcDestinations.allocate(
                tempBuffer,
                countersManager,
                registrationId,
                originalUriString,
            );
            this.multiSndDestination.destinationsCounter(this.mdcDestinationsCounter);
        }
    }

    private statusMessageTimeout(nowNs: number): boolean {
        const iterator = this.publicationBySessionAndStreamId.values().iterator();
        while (iterator.hasNext()) {
            const publication = iterator.next() as NetworkPublication;
            if (publication.timeOfLastStatusMessageNs() + DESTINATION_TIMEOUT - nowNs >= 0) {
                return false;
            }
        }

        return true;
    }

    /**
     * Write the send timestamp in each frame that begins a message in `length` bytes of `buffer` from `offset` (Java: a
     * `ByteBuffer` from its position, `remaining()` long). The timestamp is read from the clock once, as its two `int`
     * halves (spec D17), and written as the two halves of the `long`.
     *
     * @internal package-private in Java
     */
    public applyChannelSendTimestamp(buffer: UnsafeBuffer, offset: number, length: number): void {
        if (length >= DataHeaderFlyweight.HEADER_LENGTH) {
            const sendTimestampBuffer = this.sendTimestampBuffer;
            sendTimestampBuffer.wrap(buffer, offset, length);

            let frameOffset = 0;
            const timestampOffset = DataHeaderFlyweight.DATA_OFFSET + this._udpChannel.channelSendTimestampOffset();
            const halves = this.sendTimestampHalves;
            let isTimestampRead = false;
            do {
                const frameLength = FrameDescriptor.frameLength(sendTimestampBuffer, frameOffset);
                if (frameLength <= 0) {
                    break;
                }

                if (
                    DataHeaderFlyweight.HDR_TYPE_DATA === FrameDescriptor.frameType(sendTimestampBuffer, frameOffset) &&
                    0 !==
                        (DataHeaderFlyweight.BEGIN_FLAG &
                            FrameDescriptor.frameFlags(sendTimestampBuffer, frameOffset)) &&
                    timestampOffset + SIZE_OF_LONG <= frameLength
                ) {
                    if (!isTimestampRead) {
                        (this.sendTimestampClock as EpochNanoClock).nanoTimeHalves(halves);
                        isTimestampRead = true;
                    }
                    sendTimestampBuffer.putInt(frameOffset + timestampOffset, halves[0] as number, LITTLE_ENDIAN);
                    sendTimestampBuffer.putInt(frameOffset + timestampOffset + 4, halves[1] as number, LITTLE_ENDIAN);
                }

                frameOffset += BitUtil.align(frameLength, FrameDescriptor.FRAME_ALIGNMENT);
            } while (frameOffset < length);
        }
    }

    /**
     * Does the channel have a matching tag?
     *
     * @param udpChannel with tag to match against.
     * @return true if the channel matches on tag identity.
     */
    public matchesTag(udpChannel: UdpChannel): boolean {
        return udpChannel.matchesTag(this._udpChannel, null, this.connectAddress);
    }
}

/**
 * The destinations of a multi-destination-cast channel. Java pads the hot field and the destination against false
 * sharing; a JS object has no field layout to control (spec D11, D19), so the padding classes are not ported.
 *
 * @internal package-private in Java
 */
export abstract class MultiSndDestination {
    public static readonly EMPTY_DESTINATIONS: Destination[] = [];

    public roundRobinIndex = 0;
    public destinations: Destination[] = MultiSndDestination.EMPTY_DESTINATIONS;
    public readonly nanoClock: CachedNanoClock;
    public readonly errorHandler: ErrorHandler | null;
    public _destinationsCounter: AtomicCounter | null = null;

    public constructor(nanoClock: CachedNanoClock, errorHandler: ErrorHandler | null) {
        this.nanoClock = nanoClock;
        this.errorHandler = errorHandler;
    }

    /**
     * Send `bytesToSend` bytes of `buffer` from `offset` to the destinations. Java's `DatagramChannel` parameter is the
     * socket of `channelEndpoint` (spec D28).
     */
    public abstract send(
        channelEndpoint: SendChannelEndpoint,
        buffer: UnsafeBuffer,
        offset: number,
        bytesToSend: number,
    ): number;

    public abstract onStatusMessage(msg: StatusMessageFlyweight, address: InetSocketAddress): void;

    public addDestination(_channelUri: ChannelUri, _address: InetSocketAddress, _registrationId: number): void {}

    public removeDestination(_channelUri: ChannelUri, _address: InetSocketAddress): void {}

    /**
     * Java's `removeDestination(long destinationRegistrationId)`.
     */
    public removeDestinationById(_destinationRegistrationId: number): void {}

    public checkForReResolution(
        _channelEndpoint: SendChannelEndpoint,
        _nowNs: number,
        _conductorProxy: DriverConductorProxy,
    ): void {}

    public updateDestination(_endpoint: string, _newAddress: InetSocketAddress): void {}

    public destinationsCounter(destinationsCounter: AtomicCounter): void {
        this._destinationsCounter = destinationsCounter;
    }

    /**
     * Send to one destination. Java's `DatagramChannel` is the socket of `channelEndpoint`; the errors that the send
     * raises are reported by the transport (D28), with the error handler of the endpoint.
     */
    public static send(
        channelEndpoint: SendChannelEndpoint,
        buffer: UnsafeBuffer,
        bytesToSend: number,
        position: number,
        destination: InetSocketAddress,
    ): number {
        if (destination.isUnresolved()) {
            return bytesToSend;
        }

        return channelEndpoint.sendToChannel(buffer, position, bytesToSend, destination);
    }

    public findRegistrationId(_msg: ErrorFlyweight, _srcAddress: InetSocketAddress): number {
        return Aeron.NULL_VALUE;
    }
}

/** @internal package-private in Java */
export class ManualSndMultiDestination extends MultiSndDestination {
    public constructor(nanoClock: CachedNanoClock, errorHandler: ErrorHandler | null) {
        super(nanoClock, errorHandler);
    }

    public onStatusMessage(msg: StatusMessageFlyweight, address: InetSocketAddress): void {
        const receiverIdHigh = msg.receiverIdHigh();
        const receiverIdLow = msg.receiverIdLow();
        const nowNs = this.nanoClock.nanoTime();

        const destinations = this.destinations;
        for (let i = 0, length = destinations.length; i < length; i++) {
            const destination = destinations[i] as Destination;
            if (destination.isMatch(receiverIdHigh, receiverIdLow, address)) {
                if (!destination.isReceiverIdValid) {
                    destination.receiverIdHigh = receiverIdHigh;
                    destination.receiverIdLow = receiverIdLow;
                    destination.isReceiverIdValid = true;
                }

                destination.timeOfLastActivityNs = nowNs;
                break;
            }
        }
    }

    public send(
        channelEndpoint: SendChannelEndpoint,
        buffer: UnsafeBuffer,
        offset: number,
        bytesToSend: number,
    ): number {
        const position = offset;
        const length = this.destinations.length;

        let startingIndex = this.roundRobinIndex++;
        if (startingIndex >= length) {
            startingIndex = 0;
            this.roundRobinIndex = 1;
        }

        let result = bytesToSend;
        for (let i = startingIndex; i < length; i++) {
            const destination = this.destinations[i] as Destination;

            const bytesSent = MultiSndDestination.send(
                channelEndpoint,
                buffer,
                bytesToSend,
                position,
                destination.address,
            );
            if (bytesSent < bytesToSend) {
                result = bytesSent;
            }
        }

        for (let i = 0; i < startingIndex; i++) {
            const destination = this.destinations[i] as Destination;

            const bytesSent = MultiSndDestination.send(
                channelEndpoint,
                buffer,
                bytesToSend,
                position,
                destination.address,
            );
            if (bytesSent < bytesToSend) {
                result = bytesSent;
            }
        }

        return result;
    }

    public override addDestination(channelUri: ChannelUri, address: InetSocketAddress, registrationId: number): void {
        const destination = new Destination(
            this.nanoClock.nanoTime(),
            channelUri.get(CommonContext.ENDPOINT_PARAM_NAME),
            address,
            registrationId,
        );
        this.destinations = ArrayUtil.add(this.destinations, destination);
        (this._destinationsCounter as AtomicCounter).setRelease(this.destinations.length);
    }

    public override removeDestination(_channelUri: ChannelUri, address: InetSocketAddress): void {
        let found = false;
        let index = 0;
        for (const destination of this.destinations) {
            if (destination.address.equals(address)) {
                found = true;
                break;
            }

            index++;
        }

        if (found) {
            if (1 === this.destinations.length) {
                this.destinations = MultiSndDestination.EMPTY_DESTINATIONS;
            } else {
                this.destinations = ArrayUtil.removeAt(this.destinations, index);
            }
        }

        (this._destinationsCounter as AtomicCounter).setRelease(this.destinations.length);
    }

    public override removeDestinationById(destinationRegistrationId: number): void {
        let found = false;
        let index = 0;
        for (const destination of this.destinations) {
            if (destination.registrationId === destinationRegistrationId) {
                found = true;
                break;
            }

            index++;
        }

        if (found) {
            if (1 === this.destinations.length) {
                this.destinations = MultiSndDestination.EMPTY_DESTINATIONS;
            } else {
                this.destinations = ArrayUtil.removeAt(this.destinations, index);
            }
        }

        (this._destinationsCounter as AtomicCounter).setRelease(this.destinations.length);
    }

    public override checkForReResolution(
        channelEndpoint: SendChannelEndpoint,
        nowNs: number,
        conductorProxy: DriverConductorProxy,
    ): void {
        for (const destination of this.destinations) {
            if (destination.timeOfLastActivityNs + DESTINATION_TIMEOUT - nowNs < 0) {
                destination.timeOfLastActivityNs = nowNs;
                conductorProxy.reResolveEndpoint(destination.endpoint as string, channelEndpoint, destination.address);
            }
        }
    }

    public override updateDestination(endpoint: string, newAddress: InetSocketAddress): void {
        for (const destination of this.destinations) {
            if (endpoint === destination.endpoint) {
                destination.address = newAddress;
                destination.port = newAddress.getPort();
            }
        }
    }

    public override findRegistrationId(msg: ErrorFlyweight, address: InetSocketAddress): number {
        const receiverIdHigh = msg.receiverIdHigh();
        const receiverIdLow = msg.receiverIdLow();
        for (const destination of this.destinations) {
            if (destination.isMatch(receiverIdHigh, receiverIdLow, address)) {
                return destination.registrationId;
            }
        }

        return Aeron.NULL_VALUE;
    }
}

/** @internal package-private in Java */
export class DynamicSndMultiDestination extends MultiSndDestination {
    public constructor(nanoClock: CachedNanoClock, errorHandler: ErrorHandler | null) {
        super(nanoClock, errorHandler);
    }

    public onStatusMessage(msg: StatusMessageFlyweight, address: InetSocketAddress): void {
        const receiverIdHigh = msg.receiverIdHigh();
        const receiverIdLow = msg.receiverIdLow();
        const nowNs = this.nanoClock.nanoTime();
        let isExisting = false;

        const destinations = this.destinations;
        for (let i = 0, length = destinations.length; i < length; i++) {
            const destination = destinations[i] as Destination;
            if (
                receiverIdHigh === destination.receiverIdHigh &&
                receiverIdLow === destination.receiverIdLow &&
                address.getPort() === destination.port
            ) {
                destination.timeOfLastActivityNs = nowNs;
                isExisting = true;
                break;
            }
        }

        if (!isExisting) {
            this.add(new Destination(nowNs, receiverIdHigh, receiverIdLow, address));
        }
    }

    public send(
        channelEndpoint: SendChannelEndpoint,
        buffer: UnsafeBuffer,
        offset: number,
        bytesToSend: number,
    ): number {
        const nowNs = this.nanoClock.nanoTime();
        const position = offset;
        const length = this.destinations.length;
        let inactiveDestinationCount = 0;

        let startingIndex = this.roundRobinIndex++;
        if (startingIndex >= length) {
            startingIndex = 0;
            this.roundRobinIndex = 1;
        }

        let result = bytesToSend;

        for (let i = startingIndex; i < length; i++) {
            const destination = this.destinations[i] as Destination;

            if (destination.timeOfLastActivityNs + DESTINATION_TIMEOUT - nowNs >= 0) {
                const bytesSent = MultiSndDestination.send(
                    channelEndpoint,
                    buffer,
                    bytesToSend,
                    position,
                    destination.address,
                );
                if (bytesSent < bytesToSend) {
                    result = bytesSent;
                }
            } else {
                inactiveDestinationCount++;
            }
        }

        for (let i = 0; i < startingIndex; i++) {
            const destination = this.destinations[i] as Destination;

            if (destination.timeOfLastActivityNs + DESTINATION_TIMEOUT - nowNs >= 0) {
                const bytesSent = MultiSndDestination.send(
                    channelEndpoint,
                    buffer,
                    bytesToSend,
                    position,
                    destination.address,
                );
                if (bytesSent < bytesToSend) {
                    result = bytesSent;
                }
            } else {
                inactiveDestinationCount++;
            }
        }

        if (inactiveDestinationCount > 0) {
            this.removeInactiveDestinations(nowNs);
        }

        return result;
    }

    private add(destination: Destination): void {
        this.destinations = ArrayUtil.add(this.destinations, destination);
        (this._destinationsCounter as AtomicCounter).setRelease(this.destinations.length);
    }

    private truncateDestinations(removedCount: number): void {
        const length = this.destinations.length;
        const newLength = length - removedCount;

        if (0 === newLength) {
            this.destinations = MultiSndDestination.EMPTY_DESTINATIONS;
        } else {
            this.destinations = this.destinations.slice(0, newLength);
        }

        (this._destinationsCounter as AtomicCounter).setRelease(this.destinations.length);
    }

    private removeInactiveDestinations(nowNs: number): void {
        let removedCount = 0;

        for (let lastIndex = this.destinations.length - 1, i = lastIndex; i >= 0; i--) {
            const destination = this.destinations[i] as Destination;
            if (destination.timeOfLastActivityNs + DESTINATION_TIMEOUT - nowNs < 0) {
                this.destinations[i] = this.destinations[lastIndex--] as Destination;
                removedCount++;
            }
        }

        if (removedCount > 0) {
            this.truncateDestinations(removedCount);
        }
    }
}

/**
 * A destination of a multi-destination-cast channel. The receiver id is the two `int` halves of the `long`, so that a
 * status message is matched without a `bigint` (spec D14).
 *
 * @internal package-private in Java
 */
export class Destination {
    public timeOfLastActivityNs: number;
    public receiverIdHigh = 0;
    public receiverIdLow = 0;
    public readonly registrationId: number;
    public isReceiverIdValid: boolean;
    public port: number;
    public address: InetSocketAddress;
    public readonly endpoint: string | null;

    public constructor(nowNs: number, receiverIdHigh: number, receiverIdLow: number, address: InetSocketAddress);
    public constructor(nowNs: number, endpoint: string | null, address: InetSocketAddress, registrationId: number);
    public constructor(
        nowNs: number,
        receiverIdHighOrEndpoint: number | string | null,
        receiverIdLowOrAddress: number | InetSocketAddress,
        addressOrRegistrationId: InetSocketAddress | number,
    ) {
        if (typeof receiverIdLowOrAddress === 'number') {
            this.timeOfLastActivityNs = nowNs;
            this.receiverIdHigh = receiverIdHighOrEndpoint as number;
            this.receiverIdLow = receiverIdLowOrAddress;
            this.isReceiverIdValid = true;
            this.endpoint = null;
            this.address = addressOrRegistrationId as InetSocketAddress;
            this.port = this.address.getPort();
            this.registrationId = Aeron.NULL_VALUE;
        } else {
            this.timeOfLastActivityNs = nowNs;
            this.receiverIdHigh = 0;
            this.receiverIdLow = 0;
            this.isReceiverIdValid = false;
            this.endpoint = receiverIdHighOrEndpoint as string | null;
            this.address = receiverIdLowOrAddress;
            this.port = receiverIdLowOrAddress.getPort();
            this.registrationId = addressOrRegistrationId as number;
        }
    }

    /**
     * The receiver id as a `long`: a `bigint`, for logging and tests, not for the status message path.
     */
    public receiverId(): bigint {
        return (BigInt(this.receiverIdHigh) << 32n) | BigInt(this.receiverIdLow >>> 0);
    }

    public isMatch(receiverIdHigh: number, receiverIdLow: number, address: InetSocketAddress): boolean {
        return (
            (this.isReceiverIdValid &&
                receiverIdHigh === this.receiverIdHigh &&
                receiverIdLow === this.receiverIdLow &&
                address.getPort() === this.port) ||
            (!this.isReceiverIdValid &&
                address.getPort() === this.port &&
                (address.getAddress() as InetAddress).equals(this.address.getAddress()))
        );
    }
}
