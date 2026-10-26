// A sender with everything real except the kernel (T15 extra tests and the micro bench): a concluded
// `MediaDriver.Context` with its counters, a `SendChannelEndpoint` over a socket that records the datagrams, the
// `ControlTransportPoller`, the `Sender`, a `NetworkPublication` over an in-memory log (`MemoryLogFactory`, on a
// `SharedArrayBuffer`) with the position counters of the driver, a `UnicastFlowControl` and a `RetransmitHandler`.
// The clock is a `CachedNanoClock` that the test advances, as every driver test does. A producer (`TestLogProducer`)
// writes the log as `Publication.offer` does.
import type { Socket } from 'node:dgram';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { Position } from '../../src/agrona/concurrent/status/Position.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../src/client/protocol/NakFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { MemoryLogFactory } from '../../src/driver/buffer/MemoryLogFactory.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../src/driver/media/ControlTransportPoller.js';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import { NetworkPublicationThreadLocals } from '../../src/driver/NetworkPublicationThreadLocals.js';
import { PublicationParams } from '../../src/driver/PublicationParams.js';
import { RetransmitHandler } from '../../src/driver/RetransmitHandler.js';
import { Sender } from '../../src/driver/Sender.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';
import { PublisherLimit } from '../../src/driver/status/PublisherLimit.js';
import { PublisherPos } from '../../src/driver/status/PublisherPos.js';
import { SenderBpe } from '../../src/driver/status/SenderBpe.js';
import { SenderLimit } from '../../src/driver/status/SenderLimit.js';
import { SenderNaksReceived } from '../../src/driver/status/SenderNaksReceived.js';
import { SenderPos } from '../../src/driver/status/SenderPos.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { UnicastFlowControl } from '../../src/driver/UnicastFlowControl.js';
import { mockConductorProxy, type ConductorProxyFake } from './PublicationFakes.js';
import { TestLogProducer } from './TestLogProducer.js';
import { parseSendArgs } from './SendArgs.js';

/**
 * A datagram socket that records what it is given. `block` is the number of send attempts that find the send queue
 * not empty (libuv holds the send slot), which `UdpChannelTransport` turns into a short send (spec 4.2, D2).
 */
export class CaptureSocket {
    public readonly datagrams: Uint8Array[] = [];
    public block = 0;
    public attempts = 0;

    public getSendQueueCount(): number {
        this.attempts++;
        if (this.block > 0) {
            this.block--;
            return 1;
        }

        return 0;
    }

    public send(slot: Uint8Array, ...args: unknown[]): void {
        const { offset, length } = parseSendArgs(slot, args);
        this.datagrams.push(slot.slice(offset, offset + length));
    }

    public close(): void {}
}

export interface RigOptions {
    readonly termLength?: number;
    readonly mtuLength?: number;
    readonly initialTermId?: number;
    /** The term count and offset the stream starts at (the position of a publication that was added with a position). */
    readonly startTermCount?: number;
    readonly startTermOffset?: number;
    readonly sessionId?: number;
    readonly streamId?: number;
    readonly signalEos?: boolean;
    readonly uri?: string;
    /** `MediaDriver.Context.retransmitUnicastDelayNs`: 0 (the default) retransmits at once, in `onNak`. */
    readonly retransmitDelayNs?: number;
    readonly retransmitLingerNs?: number;
    readonly spiesSimulateConnection?: boolean;
}

export class SenderRig {
    public static readonly REGISTRATION_ID = 77;

    public readonly clock = new CachedNanoClock();
    public readonly errors: Error[] = [];
    public readonly termLength: number;
    public readonly mtuLength: number;
    public readonly initialTermId: number;
    public readonly sessionId: number;
    public readonly streamId: number;
    public readonly positionBitsToShift: number;
    public readonly socket = new CaptureSocket();
    public readonly conductorProxy: ConductorProxyFake = mockConductorProxy();
    public readonly context: MediaDriver.Context;
    public readonly endpoint: SendChannelEndpoint;
    public readonly poller: ControlTransportPoller;
    public readonly sender: Sender;
    public readonly rawLog: RawLog;
    public readonly publication: NetworkPublication;
    public readonly producer: TestLogProducer;
    public readonly publisherPos: Position;
    public readonly publisherLimit: Position;
    public readonly senderPosition: Position;
    public readonly senderLimit: Position;
    public readonly shortSends: AtomicCounter;
    public readonly retransmitsSent: AtomicCounter;
    public readonly retransmittedBytes: AtomicCounter;
    public readonly heartbeatsSent: AtomicCounter;
    public readonly senderNaksReceived: AtomicCounter;
    public readonly retransmitHandler: RetransmitHandler;
    public readonly logFactory: MemoryLogFactory;
    public readonly rcvAddress: InetSocketAddress;
    public readonly flowControl = new UnicastFlowControl();
    public readonly windowLength: number;

    private isClosed = false;
    private readonly statusMessage = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    private readonly nak = new NakFlyweight(new UnsafeBuffer(new Uint8Array(NakFlyweight.HEADER_LENGTH)));

    public constructor(options: RigOptions = {}) {
        this.termLength = options.termLength ?? LogBufferDescriptor.TERM_MIN_LENGTH;
        this.mtuLength = options.mtuLength ?? 1408;
        this.initialTermId = options.initialTermId ?? 1000;
        this.sessionId = options.sessionId ?? 0x1234;
        this.streamId = options.streamId ?? 1001;
        this.positionBitsToShift = LogBufferDescriptor.positionBitsToShift(this.termLength);
        const startTermCount = options.startTermCount ?? 0;
        const startTermOffset = options.startTermOffset ?? 0;

        const handler: ErrorHandler = { onError: (e) => this.errors.push(e) };
        const poller = new ControlTransportPoller(handler, this.conductorProxy as DriverConductorProxy);
        this.poller = poller;
        this.context = new MediaDriver.Context()
            .errorHandler(handler)
            .nanoClock(this.clock)
            .cachedNanoClock(this.clock)
            .senderCachedNanoClock(this.clock)
            .receiverCachedNanoClock(this.clock)
            .controlTransportPoller(poller)
            .driverConductorProxy(this.conductorProxy as DriverConductorProxy)
            .retransmitUnicastDelayNs(options.retransmitDelayNs ?? 0)
            .retransmitUnicastLingerNs(options.retransmitLingerNs ?? Configuration.retransmitUnicastLingerNs())
            .conclude();
        const ctx = this.context;
        const countersManager = ctx.countersManager() as CountersManager;
        const tempBuffer = ctx.tempBuffer() as MutableDirectBuffer;
        const systemCounters = ctx.systemCounters() as SystemCounters;
        this.shortSends = systemCounters.get(SystemCounterDescriptor.SHORT_SENDS);
        this.retransmitsSent = systemCounters.get(SystemCounterDescriptor.RETRANSMITS_SENT);
        this.retransmittedBytes = systemCounters.get(SystemCounterDescriptor.RETRANSMITTED_BYTES);
        this.heartbeatsSent = systemCounters.get(SystemCounterDescriptor.HEARTBEATS_SENT);

        const udpChannel = UdpChannel.parse(options.uri ?? 'aeron:udp?endpoint=127.0.0.1:40123');
        this.rcvAddress = udpChannel.remoteData();
        this.endpoint = new SendChannelEndpoint(udpChannel, countersManager.newCounter('status'), ctx);
        this.endpoint.openDatagramChannel(null);
        const real = this.endpoint.sendDatagramChannel as Socket;
        this.endpoint.sendDatagramChannel = this.socket as unknown as Socket;
        this.endpoint._receiveDatagramChannel = real;
        this.poller.registerForRead(this.endpoint);

        this.logFactory = ctx.logFactory() as MemoryLogFactory;
        this.rawLog = this.logFactory.newPublication(SenderRig.REGISTRATION_ID, this.termLength, false);
        this.producer = new TestLogProducer(this.rawLog, {
            sessionId: this.sessionId,
            streamId: this.streamId,
            initialTermId: this.initialTermId,
            mtuLength: this.mtuLength,
            termCount: startTermCount,
            termOffset: startTermOffset,
        });

        const channel = udpChannel.originalUriString();
        const registrationId = SenderRig.REGISTRATION_ID;
        this.publisherPos = PublisherPos.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
            true,
        );
        this.publisherLimit = PublisherLimit.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.senderPosition = SenderPos.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.senderLimit = SenderLimit.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        const senderBpe = SenderBpe.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.senderNaksReceived = SenderNaksReceived.allocate(
            tempBuffer,
            countersManager,
            registrationId,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );

        const startPosition = startTermCount * this.termLength + startTermOffset;
        this.publisherPos.set(startPosition);
        this.publisherLimit.set(startPosition);
        this.senderPosition.set(startPosition);
        this.senderLimit.set(startPosition);

        this.flowControl.initialize(
            ctx,
            countersManager,
            udpChannel,
            this.streamId,
            this.sessionId,
            registrationId,
            this.initialTermId,
            this.termLength,
        );
        this.retransmitHandler = new RetransmitHandler(
            this.clock,
            new StaticDelayGenerator(ctx.retransmitUnicastDelayNs()),
            new StaticDelayGenerator(ctx.retransmitUnicastLingerNs()),
            udpChannel.hasGroupSemantics(),
            16,
            systemCounters.get(SystemCounterDescriptor.RETRANSMIT_OVERFLOW),
        );

        const params = new PublicationParams();
        params.entityTag = 0;
        params.mtuLength = this.mtuLength;
        params.lingerTimeoutNs = Configuration.publicationLingerTimeoutNs();
        params.untetheredWindowLimitTimeoutNs = ctx.untetheredWindowLimitTimeoutNs();
        params.untetheredLingerTimeoutNs = ctx.untetheredLingerTimeoutNs();
        params.untetheredRestingTimeoutNs = ctx.untetheredRestingTimeoutNs();
        params.signalEos = options.signalEos ?? true;
        params.spiesSimulateConnection = options.spiesSimulateConnection ?? false;
        params.termId = (this.initialTermId + startTermCount) | 0;
        params.termOffset = startTermOffset;
        this.windowLength = Configuration.producerWindowLength(this.termLength, ctx.publicationTermWindowLength());

        this.publication = new NetworkPublication(
            registrationId,
            ctx,
            params,
            this.endpoint,
            this.rawLog,
            this.windowLength,
            this.publisherPos,
            this.publisherLimit,
            this.senderPosition,
            this.senderLimit,
            senderBpe,
            this.senderNaksReceived,
            this.sessionId,
            this.streamId,
            this.initialTermId,
            this.flowControl,
            this.retransmitHandler,
            new NetworkPublicationThreadLocals(),
            true,
        );
        this.publication.incRef();
        this.endpoint.incRef();
        this.sender = new Sender(ctx);
        this.sender.onNewNetworkPublication(this.publication);
    }

    public close(): void {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;
        this.sender.onClose();
        this.endpoint.close();
        this.context.close();
    }

    /** The datagrams since `from`. */
    public datagrams(): Uint8Array[] {
        return this.socket.datagrams;
    }

    /**
     * A status message from the receiver (through the endpoint, so that the validity check runs): it has consumed up to
     * `consumptionPosition` and offers `windowLength` more.
     */
    public sendStatusMessage(consumptionPosition: number, windowLength: number, flags = 0): void {
        const termCount = Math.floor(consumptionPosition / this.termLength);
        const termOffset = consumptionPosition - termCount * this.termLength;
        this.sendStatusMessageAt((this.initialTermId + termCount) | 0, termOffset, windowLength, flags);
    }

    public sendStatusMessageAt(
        consumptionTermId: number,
        consumptionTermOffset: number,
        windowLength: number,
        flags = 0,
    ): void {
        this.sendStatusMessageFrom(42, this.rcvAddress, consumptionTermId, consumptionTermOffset, windowLength, flags);
    }

    /** A status message of the receiver `receiverIdLow` at `address` (a dynamic MDC publication adds it as a destination). */
    public sendStatusMessageFrom(
        receiverIdLow: number,
        address: InetSocketAddress,
        consumptionTermId: number,
        consumptionTermOffset: number,
        windowLength: number,
        flags = 0,
    ): void {
        const sm = this.statusMessage;
        sm.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SM)
            .flags(flags)
            .frameLength(StatusMessageFlyweight.HEADER_LENGTH);
        sm.sessionId(this.sessionId)
            .streamId(this.streamId)
            .consumptionTermId(consumptionTermId)
            .consumptionTermOffset(consumptionTermOffset)
            .receiverWindowLength(windowLength)
            .receiverIdHigh(0)
            .receiverIdLow(receiverIdLow);
        this.endpoint.onStatusMessage(
            sm,
            sm,
            StatusMessageFlyweight.HEADER_LENGTH,
            address,
            this.conductorProxy as DriverConductorProxy,
        );
    }

    /** A NAK from the receiver for `length` bytes at (`termId`, `termOffset`), through the endpoint. */
    public sendNak(termId: number, termOffset: number, length: number): void {
        const nak = this.nak;
        nak.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_NAK)
            .frameLength(NakFlyweight.HEADER_LENGTH);
        nak.sessionId(this.sessionId).streamId(this.streamId).termId(termId).termOffset(termOffset).length(length);
        this.endpoint.onNakMessage(nak, nak, NakFlyweight.HEADER_LENGTH, this.rcvAddress);
    }

    /**
     * Run the sender until `done()` or `maxCycles` cycles, advancing the clock by `stepNs` before each cycle. It fails
     * rather than hangs.
     */
    public drive(done: () => boolean, maxCycles = 1000, stepNs = 1): number {
        for (let cycle = 0; cycle < maxCycles; cycle++) {
            if (done()) {
                return cycle;
            }
            this.clock.advance(stepNs);
            this.sender.doWork();
        }

        if (done()) {
            return maxCycles;
        }

        throw new Error('the sender did not reach the goal in ' + maxCycles + ' cycles');
    }

    /**
     * Run the sender until the sender position is `position`, with the receiver consuming what it is sent: a status
     * message before each cycle that has not got the window to reach it.
     */
    public driveTo(position: number, maxCycles = 1000): number {
        return this.drive(() => {
            if (this.senderPosition.get() >= position) {
                return true;
            }

            if (this.senderLimit.get() < position) {
                this.sendStatusMessage(this.senderPosition.get(), this.termLength >> 1);
            }

            return false;
        }, maxCycles);
    }

    /**
     * What the receiver sees: checks that the data datagrams from index `from` are the bytes of the log, in order and
     * once, and returns the position after the last one (the padding that a datagram ends with included). A heartbeat
     * (a data frame of length 0) and a setup frame carry no data and are skipped.
     */
    public checkWire(fromDatagram: number, fromPosition: number, verifyBytes = true): number {
        let position = fromPosition;
        const datagrams = this.socket.datagrams;
        for (let i = fromDatagram; i < datagrams.length; i++) {
            const datagram = datagrams[i] as Uint8Array;
            const view = new UnsafeBuffer(datagram);
            const type = FrameDescriptor.frameType(view, 0);
            if (
                (HeaderFlyweight.HDR_TYPE_DATA !== type && HeaderFlyweight.HDR_TYPE_PAD !== type) ||
                0 === FrameDescriptor.frameLength(view, 0)
            ) {
                continue;
            }

            const termId = FrameDescriptor.frameTermId(view, 0);
            const termOffset = view.getInt(DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET);
            const expected = LogBufferDescriptor.computePosition(
                termId,
                termOffset,
                this.positionBitsToShift,
                this.initialTermId,
            );
            if (expected !== position) {
                throw new Error('datagram ' + i + ' is at position ' + expected + ', expected ' + position);
            }

            const termBuffer = this.rawLog.termBuffers()[
                LogBufferDescriptor.indexByPosition(position, this.positionBitsToShift)
            ] as UnsafeBuffer;
            const logBytes = new Uint8Array(datagram.length);
            if (verifyBytes) {
                termBuffer.getBytes(termOffset, logBytes);
            }
            if (verifyBytes && !Buffer.from(logBytes).equals(Buffer.from(datagram))) {
                throw new Error('datagram ' + i + ' differs from the log at position ' + position);
            }

            // the frames of the datagram, to find the padding that it ends with: its header is sent, the frame is skipped
            let frameOffset = 0;
            while (frameOffset < datagram.length) {
                const frameLength = FrameDescriptor.frameLength(view, frameOffset);
                if (HeaderFlyweight.HDR_TYPE_PAD === FrameDescriptor.frameType(view, frameOffset)) {
                    position += BitUtil.align(frameLength, FrameDescriptor.FRAME_ALIGNMENT);
                    frameOffset = datagram.length;
                } else {
                    const aligned = BitUtil.align(frameLength, FrameDescriptor.FRAME_ALIGNMENT);
                    position += aligned;
                    frameOffset += aligned;
                }
            }
        }

        return position;
    }
}
