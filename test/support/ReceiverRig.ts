// A receiver with everything real except the kernel and the conductor (T16 extra tests and the micro bench): a
// concluded `MediaDriver.Context` with its counters, a `ReceiveChannelEndpoint` over a socket that records what it
// sends (the status messages, NAKs, error frames), a real `DataPacketDispatcher`, the `DataTransportPoller`, the
// `Receiver`, and a `PublicationImage` over an in-memory log (`MemoryLogFactory`) with the position counters of the
// driver, a `StaticWindowCongestionControl` and a subscriber position that the test advances as a client `Image` would.
// The conductor is a recorder: it holds the request for an image and the calls of the image to it (`transitionToLinger`,
// `cleanupImage`, ...), and the rig does what `DriverConductor.onCreatePublicationImage` does (`createImage`) and what
// its duty cycle does to an image (`conductorCycle`: `trackRebuild`, `onTimeEvent`). The clock is a `CachedNanoClock`
// that the test advances, as every driver test does. A datagram is delivered as the socket's `'message'` event does
// (`endpoint.onMessage`) and is taken by the poller in the next `Receiver.doWork`.
import type { Socket } from 'node:dgram';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import type { EpochNanoClock } from '../../src/agrona/concurrent/EpochNanoClock.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { Position } from '../../src/agrona/concurrent/status/Position.js';
import { ByteOrder } from '../../src/agrona/jdk.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermReader } from '../../src/client/logbuffer/TermReader.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../src/client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../src/client/protocol/NakFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import type { MemoryLogFactory } from '../../src/driver/buffer/MemoryLogFactory.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { DataPacketDispatcher } from '../../src/driver/DataPacketDispatcher.js';
import type { DriverConductor } from '../../src/driver/DriverConductor.js';
import { asConductor } from './ClientCommandConductor.js';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { NetworkSubscriptionLink } from '../../src/driver/NetworkSubscriptionLink.js';
import { AeronClient } from '../../src/driver/AeronClient.js';
import { PublicationImage } from '../../src/driver/PublicationImage.js';
import { Receiver } from '../../src/driver/Receiver.js';
import type { ReceiverProxy } from '../../src/driver/ReceiverProxy.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';
import { StaticWindowCongestionControl } from '../../src/driver/StaticWindowCongestionControl.js';
import { SubscriberPosition } from '../../src/driver/SubscriberPosition.js';
import { SubscriptionParams } from '../../src/driver/SubscriptionParams.js';
import type { SubscriptionLink } from '../../src/driver/SubscriptionLink.js';
import { DataTransportPoller } from '../../src/driver/media/DataTransportPoller.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import type { LossReport } from '../../src/driver/reports/LossReport.js';
import { ReceiverHwm } from '../../src/driver/status/ReceiverHwm.js';
import { ReceiverNaksSent } from '../../src/driver/status/ReceiverNaksSent.js';
import { ReceiverPos } from '../../src/driver/status/ReceiverPos.js';
import { SubscriberPos } from '../../src/driver/status/SubscriberPos.js';
import type { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { CaptureSocket } from './SenderRig.js';
import { TestLogProducer } from './TestLogProducer.js';

const { align } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT } = FrameDescriptor;

/**
 * The recording socket of the receiver: it keeps where each datagram was sent as well (the receiver sends to the control
 * address of the source, with `dgram.send(slot, 0, length, port, host, callback)`).
 */
export class DestinationSocket extends CaptureSocket {
    public readonly destinations: { port: number | undefined; address: string | undefined }[] = [];

    public override send(
        slot: Uint8Array,
        offset: number,
        length: number,
        portOrCallback?: number | (() => void),
        address?: string,
    ): void {
        super.send(slot, offset, length);
        this.destinations.push(
            typeof portOrCallback === 'number'
                ? { port: portOrCallback, address }
                : { port: undefined, address: undefined },
        );
    }
}

export interface ReceiverRigOptions {
    /** The subscription channel (default `aeron:udp?endpoint=127.0.0.1:0`; `control=` makes the control address explicit). */
    readonly uri?: string;
    readonly termLength?: number;
    readonly mtuLength?: number;
    readonly initialTermId?: number;
    /** The term count and offset the image joins at (the active term is `initialTermId + activeTermCount`). */
    readonly activeTermCount?: number;
    readonly termOffset?: number;
    readonly sessionId?: number;
    readonly streamId?: number;
    readonly isReliable?: boolean;
    readonly isTether?: boolean;
    readonly isRejoin?: boolean;
    /** The delay before the first NAK of a gap, and between the NAKs that repeat it (`StaticDelayGenerator`). */
    readonly lossDelayNs?: number;
    readonly lossRetryDelayNs?: number;
    readonly statusMessageTimeoutNs?: number;
    readonly imageLivenessTimeoutNs?: number;
    readonly untetheredWindowLimitTimeoutNs?: number;
    readonly untetheredLingerTimeoutNs?: number;
    readonly untetheredRestingTimeoutNs?: number;
    readonly initialWindowLength?: number;
    readonly lossReport?: LossReport | null;
    /** `MediaDriver.Context.channelReceiveTimestampClock` (default: the system clock of the context). */
    readonly channelReceiveTimestampClock?: EpochNanoClock;
    /** The flags of the setup frame / image (`SetupFlyweight.SEND_RESPONSE_SETUP_FLAG`). */
    readonly flags?: number;
}

/** A request for an image that the dispatcher made to the conductor (`DriverConductorProxy.createPublicationImage`). */
export interface ImageRequest {
    readonly sessionId: number;
    readonly streamId: number;
    readonly initialTermId: number;
    readonly activeTermId: number;
    readonly termOffset: number;
    readonly termLength: number;
    readonly mtuLength: number;
    readonly transportIndex: number;
    readonly flags: number;
    readonly controlAddress: InetSocketAddress;
    readonly srcAddress: InetSocketAddress;
}

/** An image that the rig made, with its log and counters. */
export interface ImageParts {
    readonly image: PublicationImage;
    readonly registrationId: number;
    readonly sessionId: number;
    readonly rawLog: RawLog;
    readonly hwmPosition: Position;
    readonly rebuildPosition: Position;
    readonly subscriberPosition: Position;
    readonly naksSent: AtomicCounter;
}

/** What the image told the conductor. */
export interface ConductorCalls {
    readonly transitionToLinger: PublicationImage[];
    readonly tryCloseReceiveChannelEndpoint: ReceiveChannelEndpoint[];
    readonly cleanupImage: PublicationImage[];
    readonly unavailable: { resourceId: number; link: SubscriptionLink }[];
    readonly available: {
        resourceId: number;
        sessionId: number;
        link: SubscriptionLink;
        positionCounterId: number;
        joinPosition: number;
        logFileName: string;
        sourceIdentity: string;
    }[];
}

/** A frame that the rig delivers to the endpoint: the type, the flags and the payload. */
export interface FrameSpec {
    readonly termId: number;
    readonly termOffset: number;
    readonly payload: Uint8Array;
    readonly flags?: number;
    readonly type?: number;
}

export class ReceiverRig {
    public static readonly CLIENT_ID = 117;
    public static readonly REGISTRATION_ID = 4242;
    public static readonly SOURCE = { address: '127.0.0.1', family: 'IPv4' as const, port: 41000, size: 0 };

    public readonly clock = new CachedNanoClock();
    public readonly errors: Error[] = [];
    public readonly termLength: number;
    public readonly mtuLength: number;
    public readonly initialTermId: number;
    /** The join of the next image: a test changes the session, or restarts at a position (`restartAt`). */
    public activeTermId: number;
    public termOffset: number;
    public sessionId: number;
    public readonly streamId: number;
    public readonly positionBitsToShift: number;
    public readonly socket = new DestinationSocket();
    public readonly requests: ImageRequest[] = [];
    public readonly conductorCalls: ConductorCalls = {
        transitionToLinger: [],
        tryCloseReceiveChannelEndpoint: [],
        cleanupImage: [],
        unavailable: [],
        available: [],
    };
    public readonly closedEndpoints: ReceiveChannelEndpoint[] = [];
    public readonly context: MediaDriver.Context;
    public readonly systemCounters: SystemCounters;
    public readonly countersManager: CountersManager;
    public readonly endpoint: ReceiveChannelEndpoint;
    public readonly dispatcher: DataPacketDispatcher;
    public readonly receiver: Receiver;
    public readonly receiverProxy: ReceiverProxy;
    public readonly poller: DataTransportPoller;
    public readonly sourceAddress: InetSocketAddress;
    public readonly udpChannel: UdpChannel;
    public readonly conductor: DriverConductor;
    public readonly subscriptionLink: NetworkSubscriptionLink;
    public readonly logFactory: MemoryLogFactory;
    public readonly lossDelayNs: number;
    public readonly lossRetryDelayNs: number;

    /** The images that `createImage` made, in order; the members below are those of the last one. */
    public readonly images: ImageParts[] = [];
    public image!: PublicationImage;
    public rawLog!: RawLog;
    public hwmPosition!: Position;
    public rebuildPosition!: Position;
    public subscriberPosition!: Position;
    public naksSent!: AtomicCounter;
    public windowLength = 0;

    private isClosed = false;
    private subscribers = 0;
    private readonly client: AeronClient;
    private readonly params = new SubscriptionParams();
    private readonly options: ReceiverRigOptions;
    private readonly header: Header;
    private readonly setupBuffer = new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
    private readonly setup = new SetupFlyweight();

    public constructor(options: ReceiverRigOptions = {}) {
        this.options = options;
        this.termLength = options.termLength ?? LogBufferDescriptor.TERM_MIN_LENGTH;
        this.mtuLength = options.mtuLength ?? 1408;
        this.initialTermId = options.initialTermId ?? 1000;
        this.activeTermId = (this.initialTermId + (options.activeTermCount ?? 0)) | 0;
        this.termOffset = options.termOffset ?? 0;
        this.sessionId = options.sessionId ?? 0x1234;
        this.streamId = options.streamId ?? 1001;
        this.positionBitsToShift = LogBufferDescriptor.positionBitsToShift(this.termLength);
        this.lossDelayNs = options.lossDelayNs ?? 0;
        this.lossRetryDelayNs = options.lossRetryDelayNs ?? 1_000_000;
        this.header = new Header(this.initialTermId, this.positionBitsToShift);
        this.sourceAddress = new InetSocketAddress(ReceiverRig.SOURCE.address, ReceiverRig.SOURCE.port);

        const handler: ErrorHandler = { onError: (e) => this.errors.push(e) };
        let context = new MediaDriver.Context()
            .errorHandler(handler)
            .nanoClock(this.clock)
            .cachedNanoClock(this.clock)
            .senderCachedNanoClock(this.clock)
            .receiverCachedNanoClock(this.clock)
            .lossReport(options.lossReport ?? null);
        if (undefined !== options.channelReceiveTimestampClock) {
            context = context.channelReceiveTimestampClock(options.channelReceiveTimestampClock);
        }
        if (undefined !== options.statusMessageTimeoutNs) {
            context = context.statusMessageTimeoutNs(options.statusMessageTimeoutNs);
        }
        if (undefined !== options.imageLivenessTimeoutNs) {
            context = context.imageLivenessTimeoutNs(options.imageLivenessTimeoutNs);
        }
        if (undefined !== options.initialWindowLength) {
            context = context.initialWindowLength(options.initialWindowLength);
        }
        this.context = context.conclude();
        const ctx = this.context;
        this.systemCounters = ctx.systemCounters() as SystemCounters;
        this.countersManager = ctx.countersManager() as CountersManager;
        this.logFactory = ctx.logFactory() as MemoryLogFactory;

        // the conductor: it records the request for an image and what the images say to it
        const conductorProxy = ctx.driverConductorProxy() as DriverConductorProxy;
        const target: Partial<DriverConductor> = {
            onCreatePublicationImage: (
                sessionId,
                streamId,
                initialTermId,
                activeTermId,
                termOffset,
                termLength,
                mtuLength,
                transportIndex,
                flags,
                controlAddress,
                srcAddress,
            ) => {
                this.requests.push({
                    sessionId,
                    streamId,
                    initialTermId,
                    activeTermId,
                    termOffset,
                    termLength,
                    mtuLength,
                    transportIndex,
                    flags,
                    controlAddress,
                    srcAddress,
                });
            },
            receiveChannelEndpointClosed: (channelEndpoint) => {
                this.closedEndpoints.push(channelEndpoint);
            },
        };
        conductorProxy.driverConductor(target as DriverConductor);
        const conductorFake: Partial<DriverConductor> = {
            transitionToLinger: (image) => {
                this.conductorCalls.transitionToLinger.push(image);
            },
            tryCloseReceiveChannelEndpoint: (channelEndpoint) => {
                this.conductorCalls.tryCloseReceiveChannelEndpoint.push(channelEndpoint);
            },
            cleanupImage: (image) => {
                this.conductorCalls.cleanupImage.push(image);
            },
            notifyUnavailableImageLink: (resourceId, link) => {
                this.conductorCalls.unavailable.push({ resourceId, link });
            },
            notifyAvailableImageLink: (
                resourceId,
                sessionId,
                link,
                positionCounterId,
                joinPosition,
                logFileName,
                sourceIdentity,
            ) => {
                this.conductorCalls.available.push({
                    resourceId,
                    sessionId,
                    link,
                    positionCounterId,
                    joinPosition,
                    logFileName,
                    sourceIdentity,
                });
            },
        };
        this.conductor = asConductor(conductorFake);

        this.udpChannel = UdpChannel.parse(options.uri ?? 'aeron:udp?endpoint=127.0.0.1:0');
        this.receiver = new Receiver(ctx);
        this.dispatcher = new DataPacketDispatcher(conductorProxy, this.receiver, ctx.streamSessionLimit());
        this.receiverProxy = ctx.receiverProxy() as ReceiverProxy;
        this.receiverProxy.receiver(this.receiver);
        this.endpoint = new ReceiveChannelEndpoint(
            this.udpChannel,
            this.dispatcher,
            this.countersManager.newCounter('status'),
            ctx,
        );
        this.endpoint.openDatagramChannel(null);
        const real = this.endpoint.sendDatagramChannel as Socket;
        this.endpoint.sendDatagramChannel = this.socket as unknown as Socket;
        this.endpoint._receiveDatagramChannel = real;
        this.poller = ctx.dataTransportPoller() as DataTransportPoller;

        const params = this.params;
        params.isReliable = options.isReliable ?? true;
        params.isTether = options.isTether ?? true;
        params.isRejoin = options.isRejoin ?? true;
        params.untetheredWindowLimitTimeoutNs =
            options.untetheredWindowLimitTimeoutNs ?? ctx.untetheredWindowLimitTimeoutNs();
        params.untetheredLingerTimeoutNs = options.untetheredLingerTimeoutNs ?? ctx.untetheredLingerTimeoutNs();
        params.untetheredRestingTimeoutNs = options.untetheredRestingTimeoutNs ?? ctx.untetheredRestingTimeoutNs();
        const client = (this.client = new AeronClient(
            ReceiverRig.CLIENT_ID,
            ctx.clientLivenessTimeoutNs(),
            this.countersManager.newCounter('client-timeouts'),
            this.countersManager.newCounter('heartbeat'),
        ));
        this.subscriptionLink = new NetworkSubscriptionLink(
            ReceiverRig.REGISTRATION_ID,
            this.endpoint,
            this.streamId,
            this.udpChannel.originalUriString(),
            client,
            params,
        );
    }

    /** The receiver registers the endpoint and the stream is subscribed to, as the conductor's commands do. */
    public subscribe(): void {
        this.receiverProxy.registerReceiveChannelEndpoint(this.endpoint);
        this.receiverProxy.addSubscription(this.endpoint, this.streamId);
        this.receiver.doWork();
        this.receiver.doWork();
    }

    /** A setup frame from the source, through the endpoint, as the poller takes it from the ring. */
    public sendSetup(): void {
        const setup = this.setup;
        setup.wrap(this.setupBuffer);
        setup
            .streamId(this.streamId)
            .sessionId(this.sessionId)
            .initialTermId(this.initialTermId)
            .activeTermId(this.activeTermId)
            .termOffset(this.termOffset)
            .termLength(this.termLength)
            .mtuLength(this.mtuLength)
            .frameLength(SetupFlyweight.HEADER_LENGTH)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
            .flags(this.options.flags ?? 0)
            .version(HeaderFlyweight.CURRENT_VERSION);
        this.deliver(Uint8Array.from(this.setupBuffer.byteArray()));
    }

    /**
     * What `DriverConductor.onCreatePublicationImage` does for the request: the log, the position counters, the
     * subscriber position and the image, which the receiver is then given by the proxy and takes in its next cycle.
     */
    public createImage(): PublicationImage {
        const ctx = this.context;
        const tempBuffer = ctx.tempBuffer() as MutableDirectBuffer;
        const channel = this.udpChannel.originalUriString();
        const registrationId = ReceiverRig.REGISTRATION_ID + this.images.length;
        const positionBitsToShift = this.positionBitsToShift;
        const joinPosition = LogBufferDescriptor.computePosition(
            this.activeTermId,
            this.termOffset,
            positionBitsToShift,
            this.initialTermId,
        );

        this.rawLog = this.logFactory.newImage(registrationId, this.termLength, false);
        TestLogProducer.initialiseLog(this.rawLog, {
            sessionId: this.sessionId,
            streamId: this.streamId,
            initialTermId: this.initialTermId,
            mtuLength: this.mtuLength,
            termCount: (this.activeTermId - this.initialTermId) | 0,
            termOffset: this.termOffset,
        });
        LogBufferDescriptor.storeDefaultFrameHeader(
            this.rawLog.metaData(),
            DataHeaderFlyweight.createDefaultHeader(this.sessionId, this.streamId, this.initialTermId),
        );

        this.hwmPosition = ReceiverHwm.allocate(
            tempBuffer,
            this.countersManager,
            ReceiverRig.CLIENT_ID,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.rebuildPosition = ReceiverPos.allocate(
            tempBuffer,
            this.countersManager,
            ReceiverRig.CLIENT_ID,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.naksSent = ReceiverNaksSent.allocate(
            tempBuffer,
            this.countersManager,
            ReceiverRig.CLIENT_ID,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
        );
        this.subscriberPosition = SubscriberPos.allocate(
            tempBuffer,
            this.countersManager,
            ReceiverRig.CLIENT_ID,
            registrationId,
            this.sessionId,
            this.streamId,
            channel,
            joinPosition,
        );
        this.subscriberPosition.setRelease(joinPosition);

        const congestionControl = new StaticWindowCongestionControl(
            registrationId,
            this.udpChannel,
            this.streamId,
            this.sessionId,
            this.termLength,
            this.mtuLength,
            this.sourceAddress,
            this.sourceAddress,
            this.clock,
            ctx,
            this.countersManager,
        );
        this.windowLength = congestionControl.initialWindowLength();

        const subscriberPosition = new SubscriberPosition(this.subscriptionLink, null, this.subscriberPosition);
        const image = new PublicationImage(
            registrationId,
            ctx,
            this.endpoint,
            0,
            this.sourceAddress,
            this.sessionId,
            this.streamId,
            this.initialTermId,
            this.activeTermId,
            this.termOffset,
            this.options.flags ?? 0,
            this.options.isReliable ?? true,
            this.params.untetheredWindowLimitTimeoutNs,
            this.params.untetheredLingerTimeoutNs,
            this.params.untetheredRestingTimeoutNs,
            this.rawLog,
            new StaticDelayGenerator(this.lossDelayNs, this.lossRetryDelayNs),
            [subscriberPosition],
            this.hwmPosition,
            this.rebuildPosition,
            this.naksSent,
            'aeron:udp?endpoint=127.0.0.1:41000',
            congestionControl,
        );
        subscriberPosition.addLink(image);
        this.image = image;
        this.images.push({
            image,
            registrationId,
            sessionId: this.sessionId,
            rawLog: this.rawLog,
            hwmPosition: this.hwmPosition,
            rebuildPosition: this.rebuildPosition,
            subscriberPosition: this.subscriberPosition,
            naksSent: this.naksSent,
        });
        this.endpoint.incRefImages();
        this.receiverProxy.newPublicationImage(this.endpoint, image);
        this.receiver.doWork();

        return image;
    }

    /** The next image joins at `position` (a receiver that restarts mid-term, or a stream that is joined late). */
    public restartAt(position: number): void {
        const { termId, termOffset } = this.at(position);
        this.activeTermId = termId;
        this.termOffset = termOffset;
    }

    /**
     * A second subscription to the stream on the last image, as the conductor adds it: a link, a position counter at the
     * position of the image, and `image.addSubscriber`.
     */
    public addSubscriber(isTether: boolean, isRejoin = true): { link: NetworkSubscriptionLink; position: Position } {
        const params = new SubscriptionParams();
        params.isTether = isTether;
        params.isRejoin = isRejoin;
        const link = new NetworkSubscriptionLink(
            ReceiverRig.REGISTRATION_ID + 1000 + this.subscribers,
            this.endpoint,
            this.streamId,
            this.udpChannel.originalUriString(),
            this.client,
            params,
        );
        this.subscribers++;
        const position = SubscriberPos.allocate(
            this.context.tempBuffer() as MutableDirectBuffer,
            this.countersManager,
            ReceiverRig.CLIENT_ID,
            link.registrationId(),
            this.sessionId,
            this.streamId,
            this.udpChannel.originalUriString(),
            this.image.joinPosition(),
        );
        position.setRelease(this.image.joinPosition());
        link.link(this.image, position);
        this.image.addSubscriber(link, position, this.clock.nanoTime());
        return { link, position };
    }

    /** Subscribe, the setup frame, the conductor's image: the stream is joined and the image is active. */
    public join(): PublicationImage {
        this.subscribe();
        this.sendSetup();
        this.runConductorCommands();
        return this.createImage();
    }

    /** Run the commands that the receiver gave the conductor (the request for an image is recorded by the target). */
    public runConductorCommands(): void {
        const queue = this.context.driverCommandQueue();
        for (let i = 0; i < 1000; i++) {
            const command = queue?.poll() ?? null;
            if (null === command) {
                return;
            }
            command();
        }
        throw new Error('the conductor queue did not drain in 1000 commands');
    }

    /** A datagram, as the socket's `'message'` event hands it over, and one cycle of the receiver to take it. */
    public deliver(datagram: Uint8Array): number {
        this.endpoint.onMessage(datagram, ReceiverRig.SOURCE);
        return this.receiver.doWork();
    }

    /** A datagram into the ring without a cycle (to queue several, a cycle takes one per transport). */
    public enqueue(datagram: Uint8Array): void {
        this.endpoint.onMessage(datagram, ReceiverRig.SOURCE);
    }

    /** Cycles of the receiver until its command queue is empty (a cycle runs one command), `stepNs` apart. */
    public processCommands(stepNs = 0): void {
        const queue = this.context.receiverCommandQueue();
        for (let i = 0; i < 1000; i++) {
            if (0 === (queue?.size() ?? 0)) {
                return;
            }
            this.cycle(stepNs);
        }
        throw new Error('the receiver command queue did not drain in 1000 cycles');
    }

    /** One cycle of the receiver, `stepNs` after the last. */
    public cycle(stepNs = 0): number {
        this.clock.advance(stepNs);
        return this.receiver.doWork();
    }

    /** The conductor's duty cycle for the image: `trackRebuild`, then `onTimeEvent`. */
    public conductorCycle(stepNs = 0): number {
        this.clock.advance(stepNs);
        const nowNs = this.clock.nanoTime();
        const work = this.image.trackRebuild(nowNs);
        this.image.onTimeEvent(nowNs, Math.floor(nowNs / 1_000_000), this.conductor);
        return work;
    }

    /** The conductor's `trackRebuild` alone. */
    public trackRebuild(stepNs = 0): number {
        this.clock.advance(stepNs);
        return this.image.trackRebuild(this.clock.nanoTime());
    }

    /**
     * A conductor cycle then a receiver cycle, `n` times, `stepNs` apart: the SMs, NAKs and gap fills that follow from
     * the data, in the order the agents run. It fails rather than hangs.
     */
    public run(n = 1, stepNs = 0): void {
        for (let i = 0; i < n; i++) {
            this.conductorCycle(stepNs);
            this.cycle();
        }
    }

    /** A frame as the sender sends it: the header and the payload, padded with zeros to the frame alignment. */
    public frame(spec: FrameSpec): Uint8Array {
        const frameLength = HEADER_LENGTH + spec.payload.length;
        const bytes = new Uint8Array(align(frameLength, FRAME_ALIGNMENT));
        const buffer = new UnsafeBuffer(bytes);
        const header = new DataHeaderFlyweight(buffer);
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(spec.flags ?? DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(spec.type ?? HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(frameLength);
        header.termOffset(spec.termOffset).sessionId(this.sessionId).streamId(this.streamId).termId(spec.termId);
        buffer.putBytes(HEADER_LENGTH, spec.payload, 0, spec.payload.length);
        return bytes;
    }

    /**
     * The padding frame at the end of a term, as the sender sends it: the header only, with the frame length of the whole
     * padding (`frameLength` bytes of the term), which is longer than the datagram.
     */
    public padding(termId: number, termOffset: number, frameLength: number): Uint8Array {
        const bytes = new Uint8Array(HEADER_LENGTH);
        const header = new DataHeaderFlyweight(new UnsafeBuffer(bytes));
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_PAD)
            .frameLength(frameLength);
        header.termOffset(termOffset).sessionId(this.sessionId).streamId(this.streamId).termId(termId);
        return bytes;
    }

    /** A heartbeat: a data header with a frame length of 0 (`flags` may carry the EOS flag). */
    public heartbeat(termId: number, termOffset: number, flags = DataHeaderFlyweight.BEGIN_AND_END_FLAGS): Uint8Array {
        const bytes = new Uint8Array(HEADER_LENGTH);
        const header = new DataHeaderFlyweight(new UnsafeBuffer(bytes));
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(flags)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(0);
        header.termOffset(termOffset).sessionId(this.sessionId).streamId(this.streamId).termId(termId);
        return bytes;
    }

    /** The term id and the term offset of a position. */
    public at(position: number): { termId: number; termOffset: number } {
        const termId = LogBufferDescriptor.computeTermIdFromPosition(
            position,
            this.positionBitsToShift,
            this.initialTermId,
        );
        return { termId, termOffset: position & (this.termLength - 1) };
    }

    /** The position of the term id and the term offset. */
    public positionOf(termId: number, termOffset: number): number {
        return LogBufferDescriptor.computePosition(termId, termOffset, this.positionBitsToShift, this.initialTermId);
    }

    /**
     * What the source would send for `payload` at `position`: one datagram per frame (the frames of a message that
     * is fragmented). It returns the datagrams and the position after them.
     */
    public frames(position: number, payload: Uint8Array): { datagrams: Uint8Array[]; position: number } {
        const maxPayload = this.mtuLength - HEADER_LENGTH;
        const datagrams: Uint8Array[] = [];
        let remaining = payload.length;
        let sourceOffset = 0;
        let flags = FrameDescriptor.BEGIN_FRAG_FLAG;
        let current = position;
        do {
            const bytes = Math.min(remaining, maxPayload);
            if (remaining <= maxPayload) {
                flags |= FrameDescriptor.END_FRAG_FLAG;
            }
            const { termId, termOffset } = this.at(current);
            datagrams.push(
                this.frame({
                    termId,
                    termOffset,
                    payload: payload.subarray(sourceOffset, sourceOffset + bytes),
                    flags,
                }),
            );
            current += align(HEADER_LENGTH + bytes, FRAME_ALIGNMENT);
            sourceOffset += bytes;
            remaining -= bytes;
            flags = 0;
        } while (remaining > 0);

        return { datagrams, position: current };
    }

    /** The datagrams sent so far, by type: status messages. */
    public statusMessages(): StatusMessageFlyweight[] {
        return this.sent(HeaderFlyweight.HDR_TYPE_SM).map(
            (bytes) => new StatusMessageFlyweight(new UnsafeBuffer(bytes)),
        );
    }

    /** The NAKs sent so far. */
    public naks(): NakFlyweight[] {
        return this.sent(HeaderFlyweight.HDR_TYPE_NAK).map((bytes) => new NakFlyweight(new UnsafeBuffer(bytes)));
    }

    /** The error frames sent so far. */
    public errorFrames(): ErrorFlyweight[] {
        return this.sent(HeaderFlyweight.HDR_TYPE_ERR).map((bytes) => new ErrorFlyweight(new UnsafeBuffer(bytes)));
    }

    /** The datagrams sent so far of a frame type. */
    public sent(type: number): Uint8Array[] {
        return this.socket.datagrams.filter(
            (bytes) =>
                new UnsafeBuffer(bytes).getShort(HeaderFlyweight.TYPE_FIELD_OFFSET, ByteOrder.LITTLE_ENDIAN) === type,
        );
    }

    /**
     * What a client `Image` does: read the frames from the subscriber position to the rebuild position (all of them,
     * `fragmentsLimit` at most), return the payloads in order and advance the subscriber position past them.
     */
    public read(fragmentsLimit = 1000): Uint8Array[] {
        const payloads: Uint8Array[] = [];
        const rebuild = this.rebuildPosition.get();
        let position = this.subscriberPosition.get();
        const termBuffers = this.rawLog.termBuffers();
        for (let guard = 0; guard < 1000 && position < rebuild && payloads.length < fragmentsLimit; guard++) {
            const index = LogBufferDescriptor.indexByPosition(position, this.positionBitsToShift);
            const termOffset = position & (this.termLength - 1);
            const termBuffer = termBuffers[index] as UnsafeBuffer;
            const before = payloads.length;
            const outcome = TermReader.read(
                termBuffer,
                termOffset,
                {
                    onFragment: (buffer, offset, length) => {
                        const bytes = new Uint8Array(length);
                        (buffer as UnsafeBuffer).getBytes(offset, bytes, 0, length);
                        payloads.push(bytes);
                    },
                },
                fragmentsLimit - payloads.length,
                this.header,
                { onError: (e) => this.errors.push(e) },
            );
            const newOffset = TermReader.offset(outcome);
            const consumed = newOffset - termOffset;
            if (consumed <= 0 && payloads.length === before) {
                break;
            }
            position += consumed;
        }
        this.subscriberPosition.setRelease(position);
        return payloads;
    }

    public counter(descriptor: SystemCounterDescriptor): number {
        return this.systemCounters.get(descriptor).get();
    }

    public close(): void {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;
        this.receiver.onClose();
        this.endpoint.close();
        this.context.close();
    }
}
