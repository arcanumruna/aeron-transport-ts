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
// Port of io/aeron/driver/DriverConductor.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { ArrayListUtil } from '../agrona/collections/ArrayListUtil.js';
import { Object2ObjectHashMap } from '../agrona/collections/Object2ObjectHashMap.js';
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { CachedEpochClock } from '../agrona/concurrent/CachedEpochClock.js';
import type { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import type { EpochClock } from '../agrona/concurrent/EpochClock.js';
import type { ManyToOneConcurrentLinkedQueue } from '../agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { RingBuffer } from '../agrona/concurrent/ringbuffer/RingBuffer.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import type { UnsafeBufferPosition } from '../agrona/concurrent/status/UnsafeBufferPosition.js';
import { IllegalArgumentException, IllegalStateException } from '../agrona/jdk.js';
import { Aeron } from '../client/Aeron.js';
import { ChannelUri } from '../client/ChannelUri.js';
import { CommonContext, InferableBoolean } from '../client/CommonContext.js';
import { ErrorCode } from '../client/ErrorCode.js';
import { AeronEvent } from '../client/exceptions/AeronEvent.js';
import { AeronException } from '../client/exceptions/AeronException.js';
import { ControlProtocolException } from '../client/exceptions/ControlProtocolException.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import { SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { ChannelEndpointStatus } from '../client/status/ChannelEndpointStatus.js';
import type { RawLog } from './buffer/RawLog.js';
import { AeronClient } from './AeronClient.js';
import { ClientCommandAdapter } from './ClientCommandAdapter.js';
import type { FlowControlSupplier } from './FlowControlSupplier.js';
import type { ReceiveChannelEndpointSupplier } from './ReceiveChannelEndpointSupplier.js';
import type { Receiver } from './Receiver.js';
import type { SendChannelEndpointSupplier } from './SendChannelEndpointSupplier.js';
import type { TerminationValidator } from './TerminationValidator.js';
import type { ClientProxy } from './ClientProxy.js';
import type { CommandResult } from './CommandResult.js';
import { Configuration } from './Configuration.js';
import type { CongestionControl } from './CongestionControl.js';
import { DataPacketDispatcher } from './DataPacketDispatcher.js';
import type { DriverConductorProxy } from './DriverConductorProxy.js';
import type { DriverManagedResource } from './DriverManagedResource.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import type { FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';
import type { FlowControl } from './FlowControl.js';
import { InvalidChannelException } from './exceptions/InvalidChannelException.js';
import { UnknownSubscriptionException } from './exceptions/UnknownSubscriptionException.js';
import { type InetSocketAddress } from './jdkNet.js';
import { MediaDriver, type MediaDriverContext } from './MediaDriver.js';
import { ControlMode } from './media/ControlMode.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import { ReceiveDestinationTransport } from './media/ReceiveDestinationTransport.js';
import type { SendChannelEndpoint } from './media/SendChannelEndpoint.js';
import type { UdpChannel } from './media/UdpChannel.js';
import { NativeResourceAgentProxy } from './NativeResourceAgentProxy.js';
import { NetworkPublication } from './NetworkPublication.js';
import { NetworkPublicationThreadLocals } from './NetworkPublicationThreadLocals.js';
import { NetworkSubscriptionLink } from './NetworkSubscriptionLink.js';
import { PublicationImage } from './PublicationImage.js';
import { PublicationLink } from './PublicationLink.js';
import { PublicationParams, type PublicationLike } from './PublicationParams.js';
import type { ReceiverProxy } from './ReceiverProxy.js';
import { RetransmitHandler } from './RetransmitHandler.js';
import type { SenderProxy } from './SenderProxy.js';
import { SessionKey } from './SessionKey.js';
import { StaticDelayGenerator } from './StaticDelayGenerator.js';
import { ClientHeartbeatTimestamp } from './status/ClientHeartbeatTimestamp.js';
import { PublisherLimit } from './status/PublisherLimit.js';
import { PublisherPos } from './status/PublisherPos.js';
import { ReceiveChannelStatus } from './status/ReceiveChannelStatus.js';
import { ReceiveLocalSocketAddress } from './status/ReceiveLocalSocketAddress.js';
import { ReceiverHwm } from './status/ReceiverHwm.js';
import { ReceiverNaksSent } from './status/ReceiverNaksSent.js';
import { ReceiverPos } from './status/ReceiverPos.js';
import { SendChannelStatus } from './status/SendChannelStatus.js';
import { SendLocalSocketAddress } from './status/SendLocalSocketAddress.js';
import { SenderBpe } from './status/SenderBpe.js';
import { SenderLimit } from './status/SenderLimit.js';
import { SenderNaksReceived } from './status/SenderNaksReceived.js';
import { SenderPos } from './status/SenderPos.js';
import { SubscriberPos } from './status/SubscriberPos.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import type { SystemCounters } from './status/SystemCounters.js';
import { SubscriberPosition } from './SubscriberPosition.js';
import type { SubscriptionLink } from './SubscriptionLink.js';
import { SubscriptionParams } from './SubscriptionParams.js';

const CLOCK_UPDATE_INTERNAL_NS = 1_000_000;
const NULL_VALUE = Aeron.NULL_VALUE;

const {
    MTU_LENGTH_PARAM_NAME,
    RECEIVER_WINDOW_LENGTH_PARAM_NAME,
    SOCKET_RCVBUF_PARAM_NAME,
    SOCKET_SNDBUF_PARAM_NAME,
    RESPONSE_CORRELATION_ID_PARAM_NAME,
    CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME,
    CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME,
    CONTROL_MODE_RESPONSE,
    ENDPOINT_PARAM_NAME,
    MDC_CONTROL_MODE_PARAM_NAME,
    MDC_CONTROL_PARAM_NAME,
    MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME,
    NULL_SESSION_ID,
    IPC_CHANNEL,
} = CommonContext;
const { SPY_QUALIFIER } = ChannelUri;
const { PROTOTYPE_VALUE_CORRELATION_ID } = PublicationParams;
const {
    LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION,
    LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION,
    LOG_BUFFER_TYPE_PUBLICATION_IMAGE,
    PARTITION_COUNT,
    TERM_MIN_LENGTH,
} = LogBufferDescriptor;
const { computePosition } = LogBufferDescriptor;

const INVALID_DESTINATION_KEYS: readonly string[] = [
    MTU_LENGTH_PARAM_NAME,
    RECEIVER_WINDOW_LENGTH_PARAM_NAME,
    SOCKET_RCVBUF_PARAM_NAME,
    SOCKET_SNDBUF_PARAM_NAME,
    RESPONSE_CORRELATION_ID_PARAM_NAME,
];

/** The queue of a proxy: only the free space is asked for. A queue that is not set (a test) has room for anything. */
interface QueueCapacity {
    remainingCapacity(): number;
}

function hasRoom(queue: QueueCapacity | null, commands: number): boolean {
    return null === queue || queue.remainingCapacity() >= commands;
}

interface StreamInterest {
    readonly sparse: boolean;
    readonly reliable: boolean;
    readonly multicastSemantics: boolean;
}

/**
 * A command that the conductor executes over several duty cycles, in the state machine of its own: it returns true
 * when it is done. Java's `Command implements AutoCloseable`.
 */
abstract class Command {
    public abstract execute(): boolean;

    public close(): void {}
}

abstract class ClientCommand extends Command {
    public readonly correlationId: number;

    protected constructor(correlationId: number) {
        super();
        this.correlationId = correlationId;
    }
}

/**
 * Driver Conductor that takes commands from publishers and subscribers, and orchestrates the media driver.
 * <p>
 * Only the network (UDP) commands are ported. Not ported (plan decision 8, spec section 3): IPC publications and
 * subscriptions (`IpcPublication`, `IpcSubscriptionLink`: the commands that name them are an `InvalidChannelException`),
 * spy subscriptions (`SpySubscriptionLink`), the counter commands (`CounterLink`, `onAddCounter`, `onAddStaticCounter`,
 * `onRemoveCounter`, `onNextAvailableSessionId`) and `DriverLog`.
 * <p>
 * The inner classes of Java reach the private members of the conductor. The members they use are public and
 * `@internal` here.
 */
export class DriverConductor implements Agent {
    private nextSessionId: number = BitUtil.generateRandomisedId();
    private readonly timerIntervalNs: number;
    private readonly clientLivenessTimeoutNs: number;
    private timeOfLastToDriverPositionChangeNs = 0;
    private lastCommandConsumerPosition: number;
    private timerCheckDeadlineNs = 0;
    private clockUpdateDeadlineNs = 0;

    /** @internal */
    public readonly ctx: MediaDriverContext;
    /** @internal */
    public readonly receiverProxy: ReceiverProxy;
    /** @internal */
    public readonly senderProxy: SenderProxy;
    /** @internal */
    public readonly nativeResourceAgentProxy: NativeResourceAgentProxy;
    /** @internal */
    public readonly clientProxy: ClientProxy;
    /** @internal */
    public readonly toDriverCommands: RingBuffer;
    private readonly clientCommandAdapter: ClientCommandAdapter;
    private readonly driverCmdQueue: ManyToOneConcurrentLinkedQueue<() => void>;
    private readonly sendChannelEndpointByChannelMap = new Map<string, SendChannelEndpoint>();
    private readonly receiveChannelEndpointByChannelMap = new Map<string, ReceiveChannelEndpoint>();
    /** @internal */
    public readonly networkPublications: NetworkPublication[] = [];
    /** @internal */
    public readonly publicationImages: PublicationImage[] = [];
    /** @internal */
    public readonly publicationLinks: PublicationLink[] = [];
    /** @internal */
    public readonly subscriptionLinks: SubscriptionLink[] = [];
    private readonly clients: AeronClient[] = [];
    private readonly activeSessionSet = new Object2ObjectHashMap<SessionKey, SessionKey>();
    private readonly epochClock: EpochClock;
    private readonly nanoClock: NanoClock;
    private readonly cachedEpochClock: CachedEpochClock;
    /** @internal */
    public readonly cachedNanoClock: CachedNanoClock;
    /** @internal */
    public readonly countersManager: CountersManager;
    private readonly networkPublicationThreadLocals = new NetworkPublicationThreadLocals();
    /** @internal */
    public readonly tempBuffer: MutableDirectBuffer;
    private readonly imagesRejected: AtomicCounter;
    private readonly dutyCycleTracker: DutyCycleTracker;
    private readonly defaultDataHeader = new DataHeaderFlyweight(DataHeaderFlyweight.createDefaultHeader(0, 0, 0));
    private clientCommand: ClientCommand | null = null;
    private driverCommand: Command | null = null;
    private readonly _roleName: string;
    // The queues behind the proxies: a command that registers a resource with the sender or the receiver first checks
    // that the proxy has room, because offering to a full queue is an error here (spec D42) and must not leave a
    // resource registered that the agent was never told of (D55).
    private readonly senderCommandQueue: QueueCapacity | null;
    private readonly receiverCommandQueue: QueueCapacity | null;
    // Cleanups that the timer-driven state machines asked for while a queue was full (spec D55, issue #44). Their
    // state has already moved on, so nothing would ask again: they are retried in every duty cycle until the queue has
    // room. The lists only grow when a queue is full, so the steady state allocates nothing.
    private readonly pendingPublicationCleanups: NetworkPublication[] = [];
    private readonly pendingReceiveEndpointCloses: ReceiveChannelEndpoint[] = [];

    public constructor(ctx: MediaDriverContext) {
        this.ctx = ctx;
        this.timerIntervalNs = ctx.timerIntervalNs();
        this.clientLivenessTimeoutNs = ctx.clientLivenessTimeoutNs();
        this.driverCmdQueue = ctx.driverCommandQueue() as ManyToOneConcurrentLinkedQueue<() => void>;
        this.receiverProxy = ctx.receiverProxy() as ReceiverProxy;
        this.senderProxy = ctx.senderProxy() as SenderProxy;
        this.senderCommandQueue = ctx.senderCommandQueue();
        this.receiverCommandQueue = ctx.receiverCommandQueue();
        this.epochClock = ctx.epochClock() as EpochClock;
        this.nanoClock = ctx.nanoClock() as NanoClock;
        this.cachedEpochClock = ctx.cachedEpochClock() as CachedEpochClock;
        this.cachedNanoClock = ctx.cachedNanoClock() as CachedNanoClock;
        this.toDriverCommands = ctx.toDriverCommands() as RingBuffer;
        this.clientProxy = ctx.clientProxy() as ClientProxy;
        this.tempBuffer = ctx.tempBuffer() as MutableDirectBuffer;
        this.imagesRejected = (ctx.systemCounters() as SystemCounters).get(SystemCounterDescriptor.IMAGES_REJECTED);
        this.dutyCycleTracker = ctx.conductorDutyCycleTracker() as DutyCycleTracker;

        this.countersManager = ctx.countersManager() as CountersManager;

        this.nativeResourceAgentProxy = ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy;

        this.clientCommandAdapter = new ClientCommandAdapter(
            ctx.countedErrorHandler() as { onError(ex: Error): void },
            this.toDriverCommands,
            this.clientProxy,
            this,
        );

        this.lastCommandConsumerPosition = this.toDriverCommands.consumerPosition();
        this._roleName = CommonContext.threadName(
            MediaDriver.AERON_DRIVER_CONDUCTOR_THREAD_NAME,
            MediaDriver.AERON_DRIVER_CONDUCTOR_THREAD_NAME_CLASSIC,
        );
    }

    /**
     * {@inheritDoc}
     */
    public onStart(): void {
        // DriverLog.logStart(MediaDriverVersion.VERSION): the logging agents are out of scope (spec section 3)

        const nowNs = this.nanoClock.nanoTime();
        this.cachedNanoClock.update(nowNs);
        this.cachedEpochClock.update(this.epochClock.time());
        this.dutyCycleTracker.update(nowNs);
        this.timerCheckDeadlineNs = nowNs + this.timerIntervalNs;
        this.clockUpdateDeadlineNs = nowNs + CLOCK_UPDATE_INTERNAL_NS;
        this.timeOfLastToDriverPositionChangeNs = nowNs;

        const systemCounters = this.ctx.systemCounters() as SystemCounters;
        systemCounters
            .get(SystemCounterDescriptor.RESOLUTION_CHANGES)
            .appendToLabel(': driverName=' + this.ctx.resolverName());
    }

    /**
     * {@inheritDoc}
     */
    public onClose(): void {
        CloseHelper.closeAll([...this.receiveChannelEndpointByChannelMap.values()]);
        CloseHelper.closeAll([...this.sendChannelEndpointByChannelMap.values()]);
        for (const publicationImage of this.publicationImages) {
            publicationImage.rawLog().free();
        }
        for (const networkPublication of this.networkPublications) {
            networkPublication.rawLog().free();
        }
        this.toDriverCommands.consumerHeartbeatTime(NULL_VALUE);
        // ctx.cncByteBuffer().force(): the CnC is a SharedArrayBuffer, there is no file to force (spec D4, D56)
        this.ctx.close();
    }

    /**
     * {@inheritDoc}
     */
    public roleName(): string {
        return this._roleName;
    }

    /**
     * {@inheritDoc}
     */
    public doWork(): number {
        const nowNs = this.nanoClock.nanoTime();
        this.trackTime(nowNs);

        let workCount = 0;
        workCount += this.processTimers(nowNs);
        if (0 !== this.pendingPublicationCleanups.length || 0 !== this.pendingReceiveEndpointCloses.length) {
            workCount += this.retryPendingCleanups();
        }
        workCount += this.processClientCommands();
        workCount += this.drainCommandQueue();
        workCount += this.trackStreamPositions(workCount, nowNs);

        return workCount;
    }

    public notAcceptingClientCommands(): boolean {
        return (
            this.senderProxy.isApplyingBackpressure() ||
            this.receiverProxy.isApplyingBackpressure() ||
            this.nativeResourceAgentProxy.isApplyingBackpressure()
        );
    }

    public onCreatePublicationImage(
        sessionId: number,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        termBufferLength: number,
        senderMtuLength: number,
        transportIndex: number,
        flags: number,
        controlAddress: InetSocketAddress,
        sourceAddress: InetSocketAddress,
        channelEndpoint: ReceiveChannelEndpoint,
    ): void {
        this.scheduleDriverCommand(
            new CreatePublicationImageCommand(
                this,
                sessionId,
                streamId,
                initialTermId,
                activeTermId,
                termOffset,
                termBufferLength,
                senderMtuLength,
                transportIndex,
                flags,
                controlAddress,
                sourceAddress,
                channelEndpoint,
            ),
        );
    }

    /**
     * The receiver id and the group id are the 64-bit wire values as `bigint`s (spec D33).
     */
    public onPublicationError(
        registrationId: number,
        destinationRegistrationId: number,
        sessionId: number,
        streamId: number,
        receiverId: bigint,
        groupId: bigint | null,
        srcAddress: InetSocketAddress,
        errorCode: number,
        errorMessage: string,
    ): void {
        this.recordError(
            new AeronEvent(
                'onPublicationError: ' +
                    'registrationId=' +
                    registrationId +
                    ', destinationRegistrationId=' +
                    destinationRegistrationId +
                    ', sessionId=' +
                    sessionId +
                    ', streamId=' +
                    streamId +
                    ', receiverId=' +
                    receiverId +
                    ', groupId=' +
                    (null === groupId ? NULL_VALUE : groupId) +
                    ', errorCode=' +
                    errorCode +
                    ', errorMessage=' +
                    errorMessage,
                AeronException.Category.WARN,
            ),
        );
        this.clientProxy.onPublicationErrorFrame(
            registrationId,
            destinationRegistrationId,
            sessionId,
            streamId,
            receiverId,
            groupId,
            srcAddress,
            errorCode,
            errorMessage,
        );
    }

    public onReResolveEndpoint(
        endpoint: string,
        channelEndpoint: SendChannelEndpoint,
        address: InetSocketAddress | null,
    ): void {
        if (ChannelEndpointStatus.ACTIVE === channelEndpoint.status()) {
            this.scheduleDriverCommand(new ReResolveEndpointAddress(this, endpoint, channelEndpoint, address));
        }
    }

    public onReResolveControl(
        control: string,
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
        address: InetSocketAddress | null,
    ): void {
        if (ChannelEndpointStatus.ACTIVE === channelEndpoint.status()) {
            this.scheduleDriverCommand(
                new ReResolveControlAddress(this, control, udpChannel, channelEndpoint, address),
            );
        }
    }

    /**
     * IPC publications are not ported (they are never found).
     */
    public findIpcPublicationByTag(_tag: number): PublicationLike | null {
        return null;
    }

    public findNetworkPublicationByTag(tag: number): NetworkPublication | null {
        for (let i = 0, size = this.networkPublications.length; i < size; i++) {
            const publication = this.networkPublications[i] as NetworkPublication;
            const publicationTag = publication.tag();
            if (publicationTag === tag && publicationTag !== ChannelUri.INVALID_TAG) {
                return publication;
            }
        }

        return null;
    }

    public onAddNetworkPublication(
        channel: string,
        streamId: number,
        correlationId: number,
        clientId: number,
        isExclusive: boolean,
    ): void {
        this.scheduleClientCommand(
            new AddNetworkPublicationCommand(this, channel, streamId, correlationId, clientId, isExclusive),
        );
    }

    private findPublicationImage(correlationId: number): PublicationImage | null {
        for (const publicationImage of this.publicationImages) {
            if (correlationId === publicationImage.correlationId()) {
                return publicationImage;
            }
        }

        return null;
    }

    public responseSetup(responseCorrelationId: number, responseSessionId: number): void {
        for (const subscriptionLink of this.subscriptionLinks) {
            if (
                subscriptionLink.registrationId() === responseCorrelationId &&
                subscriptionLink instanceof NetworkSubscriptionLink &&
                NetworkSubscriptionLink.ResponseSetupState.ERROR !== subscriptionLink.responseSetupState()
            ) {
                const link = subscriptionLink;
                if (NetworkSubscriptionLink.ResponseSetupState.COMPLETE === link.responseSetupState()) {
                    this.receiverProxy.requestSetup(
                        subscriptionLink.channelEndpoint() as ReceiveChannelEndpoint,
                        subscriptionLink.streamId(),
                        subscriptionLink.sessionId(),
                    );
                } else {
                    if (link.hasSessionId() && link.sessionId() !== responseSessionId) {
                        this.recordError(
                            new AeronEvent(
                                'failed to setup response subscription (' +
                                    'registrationId=' +
                                    link.registrationId() +
                                    ', channel=' +
                                    link.channel() +
                                    '), because it contains ' +
                                    '`session-id` parameter that does not match `session-id=' +
                                    responseSessionId +
                                    '` of the response publication',
                                AeronException.Category.ERROR,
                            ),
                        );
                        link.sessionId(NULL_SESSION_ID, false);
                        link.responseSetupState(NetworkSubscriptionLink.ResponseSetupState.ERROR);
                        break;
                    }

                    link.sessionId(responseSessionId, true);
                    link.responseSetupState(NetworkSubscriptionLink.ResponseSetupState.COMPLETE);
                    this.addNetworkSubscriptionToReceiver(link);
                    link.channelEndpoint().decResponseRefToStream(subscriptionLink.streamId());
                }

                break;
            }
        }
    }

    public responseConnected(responseCorrelationId: number): void {
        for (const publicationImage of this.publicationImages) {
            if (publicationImage.correlationId() === responseCorrelationId) {
                if (publicationImage.hasSendResponseSetup()) {
                    publicationImage.responseSessionId(null);
                }
            }
        }
    }

    /** @internal */
    public validateResponseSubscription(params: PublicationParams): void {
        if (!params.isResponse && NULL_VALUE !== params.responseCorrelationId) {
            for (const subscriptionLink of this.subscriptionLinks) {
                if (params.responseCorrelationId === subscriptionLink.registrationId()) {
                    return;
                }
            }

            throw new IllegalArgumentException(
                'unable to find response subscription for response-correlation-id=' + params.responseCorrelationId,
            );
        }
    }

    public cleanupSpies(publication: NetworkPublication): void {
        for (let i = 0, size = this.subscriptionLinks.length; i < size; i++) {
            const link = this.subscriptionLinks[i] as SubscriptionLink;
            if (link.isLinked(publication)) {
                this.notifyUnavailableImageLink(publication.registrationId(), link);
                link.unlink(publication);
            }
        }
    }

    public notifyUnavailableImageLink(resourceId: number, link: SubscriptionLink): void {
        this.clientProxy.onUnavailableImage(resourceId, link.registrationId(), link.streamId(), link.channel());
    }

    public notifyAvailableImageLink(
        resourceId: number,
        sessionId: number,
        link: SubscriptionLink,
        positionCounterId: number,
        joinPosition: number,
        logFileName: string,
        sourceIdentity: string,
    ): void {
        this.countersManager.setCounterValue(positionCounterId, joinPosition);

        const streamId = link.streamId();
        this.clientProxy.onAvailableImage(
            resourceId,
            streamId,
            sessionId,
            link.registrationId(),
            positionCounterId,
            logFileName,
            sourceIdentity,
        );
    }

    public cleanupPublication(publication: NetworkPublication): void {
        if (!this.tryCleanupPublication(publication)) {
            // The sender queue is full (spec D42, D55): retry in a later duty cycle (issue #44)
            this.pendingPublicationCleanups.push(publication);
        }
    }

    /** @return false, having done nothing, if the sender queue cannot hold the commands of the cleanup. */
    private tryCleanupPublication(publication: NetworkPublication): boolean {
        // DriverLog.logPublicationRemoval: out of scope

        const channelEndpoint = publication.channelEndpoint();
        const shouldCloseEndpoint = channelEndpoint.shouldBeClosed();
        if (!hasRoom(this.senderCommandQueue, shouldCloseEndpoint ? 2 : 1)) {
            return false;
        }

        this.senderProxy.removeNetworkPublication(publication);

        if (shouldCloseEndpoint) {
            this.senderProxy.closeSendChannelEndpoint(channelEndpoint);
            channelEndpoint.indicateClosing();
        }

        const channel = channelEndpoint.udpChannel().canonicalForm();
        this.activeSessionSet.remove(new SessionKey(publication.sessionId(), publication.streamId(), channel));
        return true;
    }

    private retryPendingCleanups(): number {
        let workCount = 0;

        const publications = this.pendingPublicationCleanups;
        for (let i = publications.length - 1; i >= 0; i--) {
            if (this.tryCleanupPublication(publications[i] as NetworkPublication)) {
                ArrayListUtil.fastUnorderedRemove(publications, i);
                workCount++;
            }
        }

        const endpoints = this.pendingReceiveEndpointCloses;
        for (let i = endpoints.length - 1; i >= 0; i--) {
            const endpoint = endpoints[i] as ReceiveChannelEndpoint;
            if (!endpoint.shouldBeClosed()) {
                // referenced again, or already closing: its next removal asks again
                ArrayListUtil.fastUnorderedRemove(endpoints, i);
            } else if (hasRoom(this.receiverCommandQueue, 1)) {
                endpoint.indicateClosing();
                this.receiverProxy.closeReceiveChannelEndpoint(endpoint);
                ArrayListUtil.fastUnorderedRemove(endpoints, i);
                workCount++;
            }
        }

        return workCount;
    }

    // TODO (Java) rename, as it isn't closed yet
    public sendChannelEndpointClosed(channelEndpoint: SendChannelEndpoint): void {
        const channel = channelEndpoint.udpChannel().canonicalForm();
        this.sendChannelEndpointByChannelMap.delete(channel);
        channelEndpoint.close();
    }

    public cleanupSubscriptionLink(subscription: SubscriptionLink): void {
        // DriverLog.logSubscriptionRemoval: out of scope

        const channelEndpoint = subscription.channelEndpoint();
        if (null !== channelEndpoint) {
            if (subscription.hasSessionId()) {
                if (0 === channelEndpoint.decRefToStreamAndSession(subscription.streamId(), subscription.sessionId())) {
                    this.receiverProxy.removeSubscription(
                        channelEndpoint,
                        subscription.streamId(),
                        subscription.sessionId(),
                    );
                }
            } else if (subscription.isResponse()) {
                channelEndpoint.decResponseRefToStream(subscription.streamId());
            } else {
                if (0 === channelEndpoint.decRefToStream(subscription.streamId())) {
                    this.receiverProxy.removeSubscription(channelEndpoint, subscription.streamId());
                }
            }

            this.tryCloseReceiveChannelEndpoint(channelEndpoint);
        }
    }

    public transitionToLinger(image: PublicationImage): void {
        let rejoin = true;

        for (let i = 0, size = this.subscriptionLinks.length; i < size; i++) {
            const link = this.subscriptionLinks[i] as SubscriptionLink;
            if (link.isLinked(image)) {
                rejoin = link.isRejoin();
                this.notifyUnavailableImageLink(image.correlationId(), link);
            }
        }

        if (rejoin) {
            this.receiverProxy.removeCoolDown(image.channelEndpoint(), image.sessionId(), image.streamId());
        }
    }

    public cleanupImage(image: PublicationImage): void {
        // DriverLog.logImageRemoval: out of scope

        for (let i = 0, size = this.subscriptionLinks.length; i < size; i++) {
            (this.subscriptionLinks[i] as SubscriptionLink).unlink(image);
        }
    }

    public tryCloseReceiveChannelEndpoint(channelEndpoint: ReceiveChannelEndpoint): void {
        if (channelEndpoint.shouldBeClosed()) {
            if (!hasRoom(this.receiverCommandQueue, 1)) {
                // Not closed, and not marked CLOSING: retried in a later duty cycle (spec D42, D55, issue #44)
                if (!this.pendingReceiveEndpointCloses.includes(channelEndpoint)) {
                    this.pendingReceiveEndpointCloses.push(channelEndpoint);
                }
                return;
            }
            channelEndpoint.indicateClosing();
            this.receiverProxy.closeReceiveChannelEndpoint(channelEndpoint);
        }
    }

    // TODO (Java) rename, as it isn't closed yet
    public receiveChannelEndpointClosed(channelEndpoint: ReceiveChannelEndpoint): void {
        const channel = channelEndpoint.subscriptionUdpChannel().canonicalForm();
        this.receiveChannelEndpointByChannelMap.delete(channel);
        channelEndpoint.close();
    }

    public clientTimeout(clientId: number): void {
        this.clientProxy.onClientTimeout(clientId);
    }

    /**
     * Java tells the clients that the counter of a timed out client is unavailable (`ClientProxy.onUnavailableCounter`).
     * The counter responses are not ported (plan decision 8), so there is nothing to tell.
     */
    public unavailableCounter(_registrationId: number, _counterId: number): void {}

    /**
     * IPC publications are not ported (spec section 3, D54).
     */
    public onAddIpcPublication(
        channel: string,
        _streamId: number,
        _correlationId: number,
        _clientId: number,
        _isExclusive: boolean,
    ): void {
        throw new InvalidChannelException('IPC publications are not supported: channel=' + channel);
    }

    public onRemovePublication(registrationId: number, correlationId: number, revoke: boolean): void {
        let publicationLink: PublicationLink | null = null;
        const publicationLinks = this.publicationLinks;
        for (let i = 0, size = publicationLinks.length; i < size; i++) {
            const publication = publicationLinks[i] as PublicationLink;
            if (registrationId === publication.registrationId()) {
                publicationLink = publication;
                ArrayListUtil.fastUnorderedRemove(publicationLinks, i);
                break;
            }
        }

        if (null === publicationLink) {
            throw new ControlProtocolException(ErrorCode.UNKNOWN_PUBLICATION, 'unknown publication: ' + registrationId);
        }

        if (revoke) {
            publicationLink.revoke();
        }
        publicationLink.close();
        this.clientProxy.operationSucceeded(correlationId);
    }

    public onAddSendDestination(registrationId: number, destinationChannel: string, correlationId: number): void {
        this.scheduleClientCommand(
            new AddSendDestinationCommand(this, registrationId, destinationChannel, correlationId),
        );
    }

    /**
     * Java's two overloads: by destination channel, and by destination registration id.
     */
    public onRemoveSendDestination(registrationId: number, destinationChannel: string, correlationId: number): void;
    public onRemoveSendDestination(
        publicationRegistrationId: number,
        destinationRegistrationId: number,
        correlationId: number,
    ): void;
    public onRemoveSendDestination(registrationId: number, destination: string | number, correlationId: number): void {
        if (typeof destination === 'string') {
            this.scheduleClientCommand(
                new RemoveSendDestinationCommand(this, registrationId, destination, correlationId),
            );
        } else {
            const sendChannelEndpoint = this.findExistingManualSendChannelEndpoint(registrationId);
            this.senderProxy.removeDestination(sendChannelEndpoint, destination);
            this.clientProxy.operationSucceeded(correlationId);
        }
    }

    public onAddNetworkSubscription(channel: string, streamId: number, registrationId: number, clientId: number): void {
        this.scheduleClientCommand(
            new AddNetworkSubscriptionCommand(this, channel, streamId, registrationId, clientId),
        );
    }

    /** @internal */
    public addNetworkSubscriptionToReceiver(subscription: NetworkSubscriptionLink): void {
        const channelEndpoint = subscription.channelEndpoint();

        if (subscription.hasSessionId()) {
            if (1 === channelEndpoint.incRefToStreamAndSession(subscription.streamId(), subscription.sessionId())) {
                this.receiverProxy.addSubscription(channelEndpoint, subscription.streamId(), subscription.sessionId());
            }
        } else {
            if (1 === channelEndpoint.incRefToStream(subscription.streamId())) {
                this.receiverProxy.addSubscription(channelEndpoint, subscription.streamId());
            }
        }
    }

    /**
     * IPC subscriptions are not ported (spec section 3, D54).
     */
    public onAddIpcSubscription(channel: string, _streamId: number, _registrationId: number, _clientId: number): void {
        throw new InvalidChannelException('IPC subscriptions are not supported: channel=' + channel);
    }

    /**
     * Spy subscriptions are not ported (spec section 3, D54).
     */
    public onAddSpySubscription(channel: string, _streamId: number, _registrationId: number, _clientId: number): void {
        throw new InvalidChannelException('spy subscriptions are not supported: channel=' + channel);
    }

    public onRemoveSubscription(registrationId: number, correlationId: number): void {
        // Check the receiver has room for every command the removal can offer before anything is removed (spec D42, D55)
        let linksToRemove = 0;
        for (const link of this.subscriptionLinks) {
            if (link.registrationId() === registrationId) {
                linksToRemove++;
            }
        }
        if (linksToRemove > 0 && !hasRoom(this.receiverCommandQueue, 2 * linksToRemove)) {
            throw new ControlProtocolException(
                ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
                'receiver command queue is full, please retry',
            );
        }

        let isAnySubscriptionFound = false;
        for (let lastIndex = this.subscriptionLinks.length - 1, i = lastIndex; i >= 0; i--) {
            const subscription = this.subscriptionLinks[i] as SubscriptionLink;
            if (subscription.registrationId() === registrationId) {
                ArrayListUtil.fastUnorderedRemove(this.subscriptionLinks, i, lastIndex--);

                subscription.close();
                this.cleanupSubscriptionLink(subscription);
                isAnySubscriptionFound = true;
            }
        }

        if (!isAnySubscriptionFound) {
            throw new UnknownSubscriptionException('unknown subscription: ' + registrationId);
        }

        this.clientProxy.operationSucceeded(correlationId);
    }

    public onClientKeepalive(clientId: number): void {
        const client = DriverConductor.findClient(this.clients, clientId);
        if (null !== client) {
            client.timeOfLastKeepaliveMs(this.cachedEpochClock.time());
        }
    }

    public onClientClose(clientId: number): void {
        const client = DriverConductor.findClient(this.clients, clientId);
        if (null !== client) {
            client.onClosedByCommand();
        }
    }

    public onAddRcvDestination(registrationId: number, destinationChannel: string, correlationId: number): void {
        if (destinationChannel.startsWith(IPC_CHANNEL) || destinationChannel.startsWith(SPY_QUALIFIER)) {
            throw new InvalidChannelException(
                'IPC and spy destinations are not supported: channel=' + destinationChannel,
            );
        } else {
            this.onAddRcvNetworkDestination(registrationId, destinationChannel, correlationId);
        }
    }

    public onAddRcvNetworkDestination(registrationId: number, destinationChannel: string, correlationId: number): void {
        this.scheduleClientCommand(
            new AddRcvNetworkDestinationCommand(this, registrationId, destinationChannel, correlationId),
        );
    }

    public onRemoveRcvDestination(registrationId: number, destinationChannel: string, correlationId: number): void {
        if (destinationChannel.startsWith(IPC_CHANNEL) || destinationChannel.startsWith(SPY_QUALIFIER)) {
            throw new InvalidChannelException(
                'IPC and spy destinations are not supported: channel=' + destinationChannel,
            );
        } else {
            this.onRemoveRcvNetworkDestination(registrationId, destinationChannel, correlationId);
        }
    }

    public onRemoveRcvNetworkDestination(
        registrationId: number,
        destinationChannel: string,
        correlationId: number,
    ): void {
        this.scheduleClientCommand(
            new RemoveRcvNetworkDestinationCommand(this, registrationId, destinationChannel, correlationId),
        );
    }

    public closeReceiveDestination(destinationTransport: ReceiveDestinationTransport): void {
        destinationTransport.close();
    }

    public onTerminateDriver(tokenBuffer: DirectBuffer, tokenOffset: number, tokenLength: number): void {
        if (
            (this.ctx.terminationValidator() as TerminationValidator).allowTermination(
                tokenBuffer,
                tokenOffset,
                tokenLength,
            )
        ) {
            (this.ctx.terminationHook() as () => void)();
        }
    }

    public onRejectImage(correlationId: number, imageCorrelationId: number, position: number, reason: string): void {
        if (reason.length > ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH) {
            throw new ControlProtocolException(
                ErrorCode.GENERIC_ERROR,
                'Invalidation reason must be ' + ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH + ' bytes or less',
            );
        }

        const publicationImage = this.findPublicationImage(imageCorrelationId);

        if (null === publicationImage) {
            // The IPC publication branch is not ported
            throw new ControlProtocolException(
                ErrorCode.GENERIC_ERROR,
                'Unable to resolve image for correlationId=' + imageCorrelationId,
            );
        } else {
            this.receiverProxy.rejectImage(imageCorrelationId, position, reason);
        }

        this.imagesRejected.incrementRelease();

        this.clientProxy.operationSucceeded(correlationId);
    }

    /**
     * Find a session id for a stream and channel that no active publication uses.
     */
    public nextAvailableSessionId(streamId: number, channel: string): number {
        const sessionKey = new SessionKey(streamId, channel);
        for (;;) {
            const sessionId = this.advanceSessionId();

            sessionKey.sessionId = sessionId;
            if (!this.activeSessionSet.containsKey(sessionKey)) {
                return sessionId;
            }
        }
    }

    private advanceSessionId(): number {
        let sessionId = this.nextSessionId;
        this.nextSessionId = (this.nextSessionId + 1) | 0;

        if (
            this.ctx.publicationReservedSessionIdLow() <= sessionId &&
            sessionId <= this.ctx.publicationReservedSessionIdHigh()
        ) {
            this.nextSessionId = (this.ctx.publicationReservedSessionIdHigh() + 1) | 0;
            sessionId = this.nextSessionId;
            this.nextSessionId = (this.nextSessionId + 1) | 0;
        }
        return sessionId;
    }

    private heartbeatAndCheckTimers(nowNs: number): void {
        const nowMs = this.cachedEpochClock.time();
        this.toDriverCommands.consumerHeartbeatTime(nowMs);

        this.checkManagedResources(this.clients, nowNs, nowMs);
        this.checkManagedResources(this.publicationLinks, nowNs, nowMs);
        this.checkManagedResources(this.networkPublications, nowNs, nowMs);
        this.checkManagedResources(this.subscriptionLinks, nowNs, nowMs);
        this.checkManagedResources(this.publicationImages, nowNs, nowMs);
    }

    private checkForBlockedToDriverCommands(nowNs: number): void {
        const consumerPosition = this.toDriverCommands.consumerPosition();

        if (
            consumerPosition === this.lastCommandConsumerPosition &&
            this.toDriverCommands.producerPosition() > consumerPosition
        ) {
            if (this.timeOfLastToDriverPositionChangeNs + this.clientLivenessTimeoutNs - nowNs < 0) {
                if (this.toDriverCommands.unblock()) {
                    (this.ctx.systemCounters() as SystemCounters)
                        .get(SystemCounterDescriptor.UNBLOCKED_COMMANDS)
                        .incrementRelease();
                }
            }
        } else {
            this.timeOfLastToDriverPositionChangeNs = nowNs;
            this.lastCommandConsumerPosition = consumerPosition;
        }
    }

    /** @internal */
    public static parseUri(channel: string): ChannelUri {
        try {
            return ChannelUri.parse(channel);
        } catch (ex) {
            throw new InvalidChannelException(ex as Error);
        }
    }

    /** @internal */
    public findSubscribers(
        channelEndpoint: ReceiveChannelEndpoint,
        sessionId: number,
        streamId: number,
        flags: number,
    ): StreamInterest | null {
        if (ChannelEndpointStatus.ACTIVE !== channelEndpoint.status()) {
            return null;
        }

        let regId = Number.MAX_SAFE_INTEGER;
        let hasSubscribers = false;
        let sparse = false;
        let reliable = false;
        let multicastSemantics = false;

        for (const subscription of this.subscriptionLinks) {
            if (subscription.matchesSession(channelEndpoint, streamId, sessionId)) {
                if (!hasSubscribers) {
                    reliable = subscription.isReliable();
                    multicastSemantics = DriverConductor.isMulticastSemantics(
                        channelEndpoint.udpChannel(),
                        subscription.group(),
                        flags,
                    );
                }
                hasSubscribers = true;

                if (subscription.registrationId() < regId) {
                    sparse = subscription.isSparse();
                    regId = subscription.registrationId();
                }
            }
        }

        if (hasSubscribers) {
            return { sparse, reliable, multicastSemantics };
        }

        return null;
    }

    /** @internal */
    public createSubscriberPositions(
        sessionId: number,
        streamId: number,
        channelEndpoint: ReceiveChannelEndpoint,
        joinPosition: number,
    ): SubscriberPosition[] {
        if (ChannelEndpointStatus.ACTIVE !== channelEndpoint.status()) {
            return [];
        }

        const subscriberPositions: SubscriberPosition[] = [];
        for (const subscription of this.subscriptionLinks) {
            if (subscription.matchesSession(channelEndpoint, streamId, sessionId)) {
                const position = SubscriberPos.allocate(
                    this.tempBuffer,
                    this.countersManager,
                    subscription.aeronClient().clientId(),
                    subscription.registrationId(),
                    sessionId,
                    streamId,
                    subscription.channel(),
                    joinPosition,
                );

                position.setRelease(joinPosition);
                subscriberPositions.push(new SubscriberPosition(subscription, null, position));
            }
        }

        return subscriberPositions;
    }

    private scheduleClientCommand(cmd: ClientCommand): void {
        if (null !== this.clientCommand) {
            throw new IllegalStateException('Another client command already in progress');
        }

        this.clientCommand = cmd;
    }

    private scheduleDriverCommand(cmd: Command): void {
        if (null !== this.driverCommand) {
            throw new IllegalStateException('Another driver command already in progress');
        }

        this.driverCommand = cmd;
    }

    /** @internal */
    public findPublication(
        streamId: number,
        channelEndpoint: SendChannelEndpoint,
        responseCorrelationId: number,
    ): NetworkPublication | null {
        for (const publication of this.networkPublications) {
            if (
                streamId === publication.streamId() &&
                channelEndpoint === publication.channelEndpoint() &&
                NetworkPublication.State.ACTIVE === publication.state() &&
                !publication.isExclusive() &&
                publication.responseCorrelationId() === responseCorrelationId
            ) {
                return publication;
            }
        }

        return null;
    }

    /** @internal */
    public newNetworkPublication(
        registrationId: number,
        clientId: number,
        streamId: number,
        channel: string,
        udpChannel: UdpChannel,
        channelEndpoint: SendChannelEndpoint,
        rawLog: RawLog,
        params: PublicationParams,
        isExclusive: boolean,
    ): NetworkPublication {
        let publisherPos: UnsafeBufferPosition | null = null;
        let publisherLmt: UnsafeBufferPosition | null = null;
        let senderPos: UnsafeBufferPosition | null = null;
        let senderLmt: UnsafeBufferPosition | null = null;
        let senderBpe: AtomicCounter | null = null;
        let senderNaksReceived: AtomicCounter | null = null;
        const ctx = this.ctx;
        const tempBuffer = this.tempBuffer;
        const countersManager = this.countersManager;
        try {
            const flowControl: FlowControl =
                udpChannel.isMulticast() || udpChannel.isMultiDestination()
                    ? (ctx.multicastFlowControlSupplier() as FlowControlSupplier).newInstance(
                          udpChannel,
                          streamId,
                          registrationId,
                      )
                    : (ctx.unicastFlowControlSupplier() as FlowControlSupplier).newInstance(
                          udpChannel,
                          streamId,
                          registrationId,
                      );
            flowControl.initialize(
                ctx,
                countersManager,
                udpChannel,
                streamId,
                params.sessionId,
                registrationId,
                params.initialTermId,
                params.termLength,
            );

            publisherPos = PublisherPos.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
                isExclusive,
            );
            publisherLmt = PublisherLimit.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
            );
            senderPos = SenderPos.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
            );
            senderLmt = SenderLimit.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
            );
            senderBpe = SenderBpe.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
            );
            senderNaksReceived = SenderNaksReceived.allocate(
                tempBuffer,
                countersManager,
                clientId,
                registrationId,
                params.sessionId,
                streamId,
                channel,
            );

            const retransmitOverflowCounter = (ctx.systemCounters() as SystemCounters).get(
                SystemCounterDescriptor.RETRANSMIT_OVERFLOW,
            );

            if (params.hasPosition) {
                const bits = LogBufferDescriptor.positionBitsToShift(params.termLength);
                const position = computePosition(params.termId, params.termOffset, bits, params.initialTermId);
                publisherPos.setRelease(position);
                publisherLmt.setRelease(position);
                senderPos.setRelease(position);
                senderLmt.setRelease(position);
            }

            const retransmitHandler = new RetransmitHandler(
                ctx.senderCachedNanoClock() as CachedNanoClock,
                ctx.retransmitUnicastDelayGenerator() as FeedbackDelayGenerator,
                ctx.retransmitUnicastLingerGenerator() as FeedbackDelayGenerator,
                udpChannel.hasGroupSemantics(),
                params.maxResend,
                retransmitOverflowCounter,
            );

            const publication = new NetworkPublication(
                registrationId,
                ctx,
                params,
                channelEndpoint,
                rawLog,
                params.publicationWindowLength,
                publisherPos,
                publisherLmt,
                senderPos,
                senderLmt,
                senderBpe,
                senderNaksReceived,
                params.sessionId,
                streamId,
                params.initialTermId,
                flowControl,
                retransmitHandler,
                this.networkPublicationThreadLocals,
                isExclusive,
            );

            // Offer to the sender before anything is registered: if the offer fails (spec D42) nothing is left behind
            this.senderProxy.newNetworkPublication(publication);
            channelEndpoint.incRef();
            this.networkPublications.push(publication);
            {
                const sessionKey = new SessionKey(params.sessionId, streamId, udpChannel.canonicalForm());
                this.activeSessionSet.put(sessionKey, sessionKey);
            }

            return publication;
        } catch (ex) {
            CloseHelper.quietCloseAll(publisherPos, publisherLmt, senderPos, senderLmt, senderBpe, senderNaksReceived);
            throw ex;
        }
    }

    /** @internal */
    public getOrCreateSendChannelEndpoint(
        params: PublicationParams,
        udpChannel: UdpChannel,
        registrationId: number,
    ): SendChannelEndpoint {
        let channelEndpoint = this.findExistingSendChannelEndpoint(udpChannel);
        if (null === channelEndpoint) {
            let statusIndicator: AtomicCounter | null = null;
            let localSocketAddressIndicator: AtomicCounter | null = null;
            try {
                statusIndicator = SendChannelStatus.allocate(
                    this.tempBuffer,
                    this.countersManager,
                    registrationId,
                    udpChannel.originalUriString(),
                );

                channelEndpoint = (this.ctx.sendChannelEndpointSupplier() as SendChannelEndpointSupplier).newInstance(
                    udpChannel,
                    statusIndicator,
                    this.ctx,
                );

                localSocketAddressIndicator = SendLocalSocketAddress.allocate(
                    this.tempBuffer,
                    this.countersManager,
                    registrationId,
                    channelEndpoint.statusIndicatorCounterId(),
                );

                channelEndpoint.localSocketAddressIndicator(localSocketAddressIndicator);
                channelEndpoint.allocateDestinationsCounterForMdc(
                    this.tempBuffer,
                    this.countersManager,
                    registrationId,
                    udpChannel.originalUriString(),
                );

                PublicationParams.validateMtuForSndbuf(
                    params,
                    channelEndpoint.socketSndbufLength(),
                    this.ctx,
                    udpChannel.originalUriString(),
                    null,
                );

                channelEndpoint.openChannel();
                channelEndpoint.indicateActive();

                this.senderProxy.registerSendChannelEndpoint(channelEndpoint);
                this.sendChannelEndpointByChannelMap.set(udpChannel.canonicalForm(), channelEndpoint);
            } catch (ex) {
                CloseHelper.closeAll(statusIndicator, localSocketAddressIndicator, channelEndpoint);
                throw ex;
            }
        } else {
            this.validateUdpChannelAgainstSendChannelEndpoint(params, udpChannel, channelEndpoint);
        }

        return channelEndpoint;
    }

    /** @internal */
    public validateUdpChannelAgainstSendChannelEndpoint(
        params: PublicationParams,
        udpChannel: UdpChannel,
        channelEndpoint: SendChannelEndpoint,
    ): void {
        DriverConductor.validateChannelSendTimestampOffset(udpChannel, channelEndpoint);
        PublicationParams.validateMtuForSndbuf(
            params,
            channelEndpoint.socketSndbufLength(),
            this.ctx,
            udpChannel.originalUriString(),
            channelEndpoint.originalUriString(),
        );
        DriverConductor.validateChannelBufferLength(
            SOCKET_RCVBUF_PARAM_NAME,
            udpChannel.socketRcvbufLength(),
            channelEndpoint.socketRcvbufLength(),
            udpChannel.originalUriString(),
            channelEndpoint.originalUriString(),
        );
        DriverConductor.validateChannelBufferLength(
            SOCKET_SNDBUF_PARAM_NAME,
            udpChannel.socketSndbufLength(),
            channelEndpoint.socketSndbufLength(),
            udpChannel.originalUriString(),
            channelEndpoint.originalUriString(),
        );
    }

    private static validateChannelSendTimestampOffset(
        udpChannel: UdpChannel,
        channelEndpoint: SendChannelEndpoint,
    ): void {
        if (udpChannel.channelSendTimestampOffset() !== channelEndpoint.udpChannel().channelSendTimestampOffset()) {
            throw new InvalidChannelException(
                'option conflicts with existing subscription: ' +
                    CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME +
                    '=' +
                    udpChannel.channelSendTimestampOffset() +
                    ' existingChannel=' +
                    channelEndpoint.originalUriString() +
                    ' channel=' +
                    udpChannel.originalUriString(),
            );
        }
    }

    private static validateReceiveTimestampOffset(
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
    ): void {
        if (
            udpChannel.channelReceiveTimestampOffset() !==
            channelEndpoint.subscriptionUdpChannel().channelReceiveTimestampOffset()
        ) {
            throw new InvalidChannelException(
                'option conflicts with existing subscription: ' +
                    CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME +
                    '=' +
                    udpChannel.channelReceiveTimestampOffset() +
                    ' existingChannel=' +
                    channelEndpoint.originalUriString() +
                    ' channel=' +
                    udpChannel.originalUriString(),
            );
        }
    }

    /** @internal */
    public findExistingManualSendChannelEndpoint(registrationId: number): SendChannelEndpoint {
        let sendChannelEndpoint: SendChannelEndpoint | null = null;

        for (const publication of this.networkPublications) {
            if (registrationId === publication.registrationId()) {
                sendChannelEndpoint = publication.channelEndpoint();
                break;
            }
        }

        if (null === sendChannelEndpoint) {
            throw new ControlProtocolException(ErrorCode.UNKNOWN_PUBLICATION, 'unknown publication: ' + registrationId);
        }

        sendChannelEndpoint.validateAllowsManualControl();

        DriverConductor.throwResourceTemporaryUnavailableIfSendEndpointIsClosing(sendChannelEndpoint);

        return sendChannelEndpoint;
    }

    /** @internal */
    public findExistingSendChannelEndpoint(udpChannel: UdpChannel): SendChannelEndpoint | null {
        if (udpChannel.hasTag()) {
            for (const endpoint of this.sendChannelEndpointByChannelMap.values()) {
                if (endpoint.matchesTag(udpChannel)) {
                    return endpoint;
                }
            }

            if (
                !udpChannel.hasExplicitControl() &&
                !udpChannel.isManualControlMode() &&
                !udpChannel.channelUri().containsKey(ENDPOINT_PARAM_NAME)
            ) {
                throw new InvalidChannelException(
                    'URI must have explicit control, endpoint, or be manual control-mode when original: channel=' +
                        udpChannel.originalUriString(),
                );
            }
        }

        let endpoint = this.sendChannelEndpointByChannelMap.get(udpChannel.canonicalForm()) ?? null;
        if (
            null !== endpoint &&
            endpoint.udpChannel().hasTag() &&
            udpChannel.hasTag() &&
            endpoint.udpChannel().tag() !== udpChannel.tag()
        ) {
            endpoint = null;
        }

        if (null !== endpoint) {
            DriverConductor.throwResourceTemporaryUnavailableIfSendEndpointIsClosing(endpoint);
        }

        return endpoint;
    }

    /** @internal */
    public checkForClashingSubscription(params: SubscriptionParams, udpChannel: UdpChannel, streamId: number): void {
        const channelEndpoint = this.findExistingReceiveChannelEndpoint(udpChannel);
        if (null !== channelEndpoint) {
            this.validateUdpChannelAgainstReceiveChannelEndpoint(params, udpChannel, channelEndpoint);

            for (const subscription of this.subscriptionLinks) {
                const matchesTag = !udpChannel.hasTag() || channelEndpoint.matchesTag(udpChannel);

                if (matchesTag && subscription.matchesParams(channelEndpoint, streamId, params)) {
                    if (params.isReliable !== subscription.isReliable()) {
                        throw new InvalidChannelException(
                            'option conflicts with existing subscription: reliable=' +
                                params.isReliable +
                                ' existingChannel=' +
                                subscription.channel() +
                                ' channel=' +
                                udpChannel.originalUriString(),
                        );
                    }

                    if (params.isRejoin !== subscription.isRejoin()) {
                        throw new InvalidChannelException(
                            'option conflicts with existing subscription: rejoin=' +
                                params.isRejoin +
                                ' existingChannel=' +
                                subscription.channel() +
                                ' channel=' +
                                udpChannel.originalUriString(),
                        );
                    }

                    if (params.isResponse !== subscription.isResponse()) {
                        throw new InvalidChannelException(
                            'option conflicts with existing subscription: isResponse=' +
                                params.isResponse +
                                ' existingChannel=' +
                                subscription.channel() +
                                ' channel=' +
                                udpChannel.originalUriString(),
                        );
                    }
                }
            }
        }
    }

    /** @internal */
    public linkMatchingImages(subscriptionLink: SubscriptionLink): void {
        for (let i = 0, size = this.publicationImages.length; i < size; i++) {
            const image = this.publicationImages[i] as PublicationImage;
            if (subscriptionLink.matchesImage(image) && image.isAcceptingSubscriptions()) {
                const registrationId = subscriptionLink.registrationId();
                const joinPosition = image.joinPosition();
                const sessionId = image.sessionId();
                const streamId = subscriptionLink.streamId();
                const position = SubscriberPos.allocate(
                    this.tempBuffer,
                    this.countersManager,
                    subscriptionLink.aeronClient().clientId(),
                    registrationId,
                    sessionId,
                    streamId,
                    subscriptionLink.channel(),
                    joinPosition,
                );

                this.countersManager.setCounterReferenceId(position.id(), image.correlationId());

                position.setRelease(joinPosition);
                subscriptionLink.link(image, position);
                image.addSubscriber(subscriptionLink, position, this.cachedNanoClock.nanoTime());

                this.clientProxy.onAvailableImage(
                    image.correlationId(),
                    streamId,
                    sessionId,
                    registrationId,
                    position.id(),
                    image.rawLog().fileName(),
                    image.sourceIdentity(),
                );
            }
        }
    }

    /** @internal */
    public getOrCreateReceiveChannelEndpoint(
        params: SubscriptionParams,
        udpChannel: UdpChannel,
        registrationId: number,
    ): ReceiveChannelEndpoint {
        let channelEndpoint = this.findExistingReceiveChannelEndpoint(udpChannel);
        if (null === channelEndpoint) {
            let channelStatus: AtomicCounter | null = null;
            let localSocketAddressIndicator: AtomicCounter | null = null;
            try {
                const channel = udpChannel.originalUriString();
                channelStatus = ReceiveChannelStatus.allocate(
                    this.tempBuffer,
                    this.countersManager,
                    registrationId,
                    channel,
                );

                const dispatcher = new DataPacketDispatcher(
                    this.ctx.driverConductorProxy() as DriverConductorProxy,
                    this.receiverProxy.receiver() as Receiver,
                    this.ctx.streamSessionLimit(),
                );
                channelEndpoint = (
                    this.ctx.receiveChannelEndpointSupplier() as ReceiveChannelEndpointSupplier
                ).newInstance(udpChannel, dispatcher, channelStatus, this.ctx);

                if (!udpChannel.isManualControlMode()) {
                    localSocketAddressIndicator = ReceiveLocalSocketAddress.allocate(
                        this.tempBuffer,
                        this.countersManager,
                        registrationId,
                        channelEndpoint.statusIndicatorCounter().id(),
                    );

                    channelEndpoint.localSocketAddressIndicator(localSocketAddressIndicator);
                }

                SubscriptionParams.validateInitialWindowForRcvBuf(
                    params,
                    channel,
                    channelEndpoint.socketRcvbufLength(),
                    this.ctx,
                    null,
                );

                channelEndpoint.openChannel();
                channelEndpoint.indicateActive();

                this.receiverProxy.registerReceiveChannelEndpoint(channelEndpoint);
                this.receiveChannelEndpointByChannelMap.set(udpChannel.canonicalForm(), channelEndpoint);
            } catch (ex) {
                CloseHelper.closeAll(channelStatus, localSocketAddressIndicator, channelEndpoint);
                throw ex;
            }
        } else {
            this.validateUdpChannelAgainstReceiveChannelEndpoint(params, udpChannel, channelEndpoint);
        }

        return channelEndpoint;
    }

    private validateUdpChannelAgainstReceiveChannelEndpoint(
        params: SubscriptionParams,
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
    ): void {
        DriverConductor.validateReceiveTimestampOffset(udpChannel, channelEndpoint);
        SubscriptionParams.validateInitialWindowForRcvBuf(
            params,
            udpChannel.originalUriString(),
            channelEndpoint.socketRcvbufLength(),
            this.ctx,
            channelEndpoint.originalUriString(),
        );
        DriverConductor.validateChannelBufferLength(
            SOCKET_RCVBUF_PARAM_NAME,
            udpChannel.socketRcvbufLength(),
            channelEndpoint.socketRcvbufLength(),
            udpChannel.originalUriString(),
            channelEndpoint.originalUriString(),
        );
        DriverConductor.validateChannelBufferLength(
            SOCKET_SNDBUF_PARAM_NAME,
            udpChannel.socketSndbufLength(),
            channelEndpoint.socketSndbufLength(),
            udpChannel.originalUriString(),
            channelEndpoint.originalUriString(),
        );
    }

    private findExistingReceiveChannelEndpoint(udpChannel: UdpChannel): ReceiveChannelEndpoint | null {
        if (udpChannel.hasTag()) {
            for (const endpoint of this.receiveChannelEndpointByChannelMap.values()) {
                if (endpoint.matchesTag(udpChannel)) {
                    return endpoint;
                }
            }
        }

        let endpoint = this.receiveChannelEndpointByChannelMap.get(udpChannel.canonicalForm()) ?? null;
        if (null !== endpoint && endpoint.hasTag() && udpChannel.hasTag() && endpoint.tag() !== udpChannel.tag()) {
            endpoint = null;
        }

        if (null !== endpoint) {
            DriverConductor.throwResourceTemporaryUnavailableIfReceiveEndpointIsClosing(endpoint);
        }

        return endpoint;
    }

    /** @internal */
    public getOrAddClient(clientId: number): AeronClient {
        let client = DriverConductor.findClient(this.clients, clientId);
        if (null === client) {
            const counter = ClientHeartbeatTimestamp.allocate(this.tempBuffer, this.countersManager, clientId);
            const counterId = counter.id();

            counter.setRelease(this.cachedEpochClock.time());
            this.countersManager.setCounterRegistrationId(counterId, clientId);
            this.countersManager.setCounterOwnerId(counterId, clientId);

            client = new AeronClient(
                clientId,
                this.clientLivenessTimeoutNs,
                (this.ctx.systemCounters() as SystemCounters).get(SystemCounterDescriptor.CLIENT_TIMEOUTS),
                counter,
            );
            this.clients.push(client);

            // clientProxy.onCounterReady(clientId, counterId): the counter responses are not ported (D57). The client
            // finds its heartbeat counter by type id and registration id, as ClientConductor does.
        }

        return client;
    }

    private static findClient(clients: AeronClient[], clientId: number): AeronClient | null {
        let aeronClient: AeronClient | null = null;

        for (let i = 0, size = clients.length; i < size; i++) {
            const client = clients[i] as AeronClient;
            if (client.clientId() === clientId) {
                aeronClient = client;
                break;
            }
        }

        return aeronClient;
    }

    /** @internal */
    public static findMdsSubscriptionLink(
        subscriptionLinks: SubscriptionLink[],
        registrationId: number,
    ): SubscriptionLink | null {
        let subscriptionLink: SubscriptionLink | null = null;

        for (let i = 0, size = subscriptionLinks.length; i < size; i++) {
            const subscription = subscriptionLinks[i] as SubscriptionLink;
            if (subscription.registrationId() === registrationId && subscription.supportsMds()) {
                subscriptionLink = subscription;
                break;
            }
        }

        return subscriptionLink;
    }

    /** @internal */
    public checkForSessionClash(sessionId: number, streamId: number, channel: string, originalChannel: string): void {
        if (this.activeSessionSet.containsKey(new SessionKey(sessionId, streamId, channel))) {
            throw new InvalidChannelException(
                'existing publication has clashing sessionId=' +
                    sessionId +
                    ' for streamId=' +
                    streamId +
                    ' channel=' +
                    originalChannel,
            );
        }
    }

    private checkManagedResources<T extends DriverManagedResource>(list: T[], nowNs: number, nowMs: number): void {
        for (let lastIndex = list.length - 1, i = lastIndex; i >= 0; i--) {
            const resource = list[i] as T;

            resource.onTimeEvent(nowNs, nowMs, this);

            if (resource.hasReachedEndOfLife()) {
                ArrayListUtil.fastUnorderedRemove(list, i, lastIndex--);

                try {
                    resource.close();
                } catch (ex) {
                    this.recordError(ex as Error);
                }

                if (resource instanceof NetworkPublication) {
                    this.nativeResourceAgentProxy.freeLogBuffer(resource.rawLog());
                } else if (resource instanceof PublicationImage) {
                    this.nativeResourceAgentProxy.freeLogBuffer(resource.rawLog());
                }
            }
        }
    }

    private trackTime(nowNs: number): void {
        this.cachedNanoClock.update(nowNs);
        this.dutyCycleTracker.measureAndUpdate(nowNs);

        if (this.clockUpdateDeadlineNs - nowNs < 0) {
            this.clockUpdateDeadlineNs = nowNs + CLOCK_UPDATE_INTERNAL_NS;
            this.cachedEpochClock.update(this.epochClock.time());
        }
    }

    private processTimers(nowNs: number): number {
        let workCount = 0;

        if (this.timerCheckDeadlineNs - nowNs < 0) {
            this.timerCheckDeadlineNs = nowNs + this.timerIntervalNs;
            this.heartbeatAndCheckTimers(nowNs);
            this.checkForBlockedToDriverCommands(nowNs);
            workCount = 1;
        }

        return workCount;
    }

    private trackStreamPositions(existingWorkCount: number, nowNs: number): number {
        let workCount = existingWorkCount;

        const publicationImages = this.publicationImages;
        for (let i = 0, size = publicationImages.length; i < size; i++) {
            workCount += (publicationImages[i] as PublicationImage).trackRebuild(nowNs);
        }

        const networkPublications = this.networkPublications;
        for (let i = 0, size = networkPublications.length; i < size; i++) {
            workCount += (networkPublications[i] as NetworkPublication).updatePublisherPositionAndLimit();
        }

        return workCount;
    }

    private processClientCommands(): number {
        let workCount = 0;

        if (null === this.clientCommand) {
            workCount += this.clientCommandAdapter.receive();
        }

        const command = this.clientCommand;
        if (null !== command) {
            ++workCount;

            try {
                if (command.execute()) {
                    CloseHelper.quietClose(command);
                    this.clientCommand = null;
                }
            } catch (ex) {
                this.clientCommandAdapter.onError(command.correlationId, ex as Error);
                CloseHelper.quietClose(command);
                this.clientCommand = null;
            }
        }

        return workCount;
    }

    private drainCommandQueue(): number {
        let workCount = 0;

        const command = this.driverCommand;
        if (null === command) {
            const queued = this.driverCmdQueue.poll();
            if (null !== queued) {
                queued();
                workCount++;
            }
        } else {
            try {
                if (command.execute()) {
                    CloseHelper.quietClose(command);
                    this.driverCommand = null;
                }
            } catch (ex) {
                this.recordError(ex as Error);
                CloseHelper.quietClose(command);
                this.driverCommand = null;
            }
            workCount++;
        }

        return workCount;
    }

    /** @internal */
    public initLogMetadata(
        type: number,
        sessionId: number,
        streamId: number,
        initialTermId: number,
        mtuLength: number,
        registrationId: number,
        socketRcvBufLength: number,
        socketSndbufLength: number,
        termOffset: number,
        receiverWindowLength: number,
        tether: boolean,
        rejoin: boolean,
        reliable: boolean,
        sparse: boolean,
        group: boolean,
        isResponse: boolean,
        publicationWindowLength: number,
        untetheredWindowLimitTimeoutNs: number,
        untetheredLingerTimeoutNs: number,
        untetheredRestingTimeoutNs: number,
        maxResend: number,
        lingerTimeoutNs: number,
        signalEos: boolean,
        spiesSimulateConnection: boolean,
        entityTag: number,
        responseCorrelationId: number,
        rawLog: RawLog,
    ): void {
        const logMetaData: UnsafeBuffer = rawLog.metaData();
        const ctx = this.ctx;

        this.defaultDataHeader.sessionId(sessionId).streamId(streamId).termId(initialTermId).termOffset(termOffset);
        LogBufferDescriptor.storeDefaultFrameHeader(logMetaData, this.defaultDataHeader);

        LogBufferDescriptor.correlationId(logMetaData, BigInt(registrationId));
        LogBufferDescriptor.initialTermId(logMetaData, initialTermId);
        LogBufferDescriptor.mtuLength(logMetaData, mtuLength);
        LogBufferDescriptor.termLength(logMetaData, rawLog.termLength());
        LogBufferDescriptor.pageSize(logMetaData, ctx.filePageSize());

        LogBufferDescriptor.publicationWindowLength(logMetaData, publicationWindowLength);
        LogBufferDescriptor.receiverWindowLength(logMetaData, receiverWindowLength);
        LogBufferDescriptor.socketSndbufLength(logMetaData, socketSndbufLength);
        LogBufferDescriptor.osDefaultSocketSndbufLength(logMetaData, ctx.osDefaultSocketSndbufLength());
        LogBufferDescriptor.osMaxSocketSndbufLength(logMetaData, ctx.osMaxSocketSndbufLength());
        LogBufferDescriptor.socketRcvbufLength(logMetaData, socketRcvBufLength);
        LogBufferDescriptor.osDefaultSocketRcvbufLength(logMetaData, ctx.osDefaultSocketRcvbufLength());
        LogBufferDescriptor.osMaxSocketRcvbufLength(logMetaData, ctx.osMaxSocketRcvbufLength());
        LogBufferDescriptor.maxResend(logMetaData, maxResend);

        LogBufferDescriptor.rejoin(logMetaData, rejoin);
        LogBufferDescriptor.reliable(logMetaData, reliable);
        LogBufferDescriptor.sparse(logMetaData, sparse);
        LogBufferDescriptor.signalEos(logMetaData, signalEos);
        LogBufferDescriptor.spiesSimulateConnection(logMetaData, spiesSimulateConnection);
        LogBufferDescriptor.tether(logMetaData, tether);
        LogBufferDescriptor.isPublicationRevoked(logMetaData, false);
        LogBufferDescriptor.group(logMetaData, group);
        LogBufferDescriptor.isResponse(logMetaData, isResponse);
        LogBufferDescriptor.type(logMetaData, type);

        LogBufferDescriptor.entityTag(logMetaData, BigInt(entityTag));
        LogBufferDescriptor.responseCorrelationId(logMetaData, BigInt(responseCorrelationId));
        LogBufferDescriptor.untetheredWindowLimitTimeoutNs(logMetaData, untetheredWindowLimitTimeoutNs);
        LogBufferDescriptor.untetheredLingerTimeoutNs(logMetaData, untetheredLingerTimeoutNs);
        LogBufferDescriptor.untetheredRestingTimeoutNs(logMetaData, untetheredRestingTimeoutNs);
        LogBufferDescriptor.lingerTimeoutNs(logMetaData, lingerTimeoutNs);

        // Acts like a release fence; so this should be the last statement to ensure that all above writes
        // are ordered before the eos-position.
        LogBufferDescriptor.endOfStreamPosition(logMetaData, Number.MAX_SAFE_INTEGER);
    }

    /** @internal */
    public static initialiseLogBufferPosition(
        initialTermId: number,
        params: PublicationParams,
        logMetaData: UnsafeBuffer,
    ): void {
        if (params.hasPosition) {
            const termId = params.termId;
            const termCount = (termId - initialTermId) | 0;
            let activeIndex = LogBufferDescriptor.indexByTerm(initialTermId, termId);

            LogBufferDescriptor.rawTail(
                logMetaData,
                activeIndex,
                LogBufferDescriptor.packTail(termId, params.termOffset),
            );
            for (let i = 1; i < PARTITION_COUNT; i++) {
                const expectedTermId = (termId + i - PARTITION_COUNT) | 0;
                activeIndex = LogBufferDescriptor.nextPartitionIndex(activeIndex);
                LogBufferDescriptor.initialiseTailWithTermId(logMetaData, activeIndex, expectedTermId);
            }

            LogBufferDescriptor.activeTermCount(logMetaData, termCount);
        } else {
            LogBufferDescriptor.initialiseTailWithTermId(logMetaData, 0, initialTermId);
            for (let i = 1; i < PARTITION_COUNT; i++) {
                const expectedTermId = (initialTermId + i - PARTITION_COUNT) | 0;
                LogBufferDescriptor.initialiseTailWithTermId(logMetaData, i, expectedTermId);
            }
        }
    }

    private static validateChannelBufferLength(
        paramName: string,
        newLength: number,
        existingLength: number,
        channel: string,
        existingChannel: string,
    ): void {
        if (0 !== newLength && newLength !== existingLength) {
            const existingValue = 0 === existingLength ? 'OS default' : existingLength;
            throw new InvalidChannelException(
                paramName +
                    '=' +
                    newLength +
                    ' does not match existing value of ' +
                    existingValue +
                    ': existingChannel=' +
                    existingChannel +
                    ' channel=' +
                    channel,
            );
        }
    }

    /** @internal */
    public static validateEndpointForPublication(udpChannel: UdpChannel): void {
        if (
            !udpChannel.isMultiDestination() &&
            udpChannel.hasExplicitEndpoint() &&
            0 === udpChannel.remoteData().getPort()
        ) {
            throw new IllegalArgumentException(
                ENDPOINT_PARAM_NAME + ' has port=0 for publication: channel=' + udpChannel.originalUriString(),
            );
        }
    }

    /** @internal */
    public static validateControlForPublication(udpChannel: UdpChannel): void {
        if (udpChannel.isDynamicControlMode() && !udpChannel.hasExplicitControl()) {
            throw new IllegalArgumentException(
                "'control-mode=dynamic' requires that 'control' parameter is set, channel=" +
                    udpChannel.originalUriString(),
            );
        }

        if (
            udpChannel.hasExplicitControl() &&
            !udpChannel.hasExplicitEndpoint() &&
            ControlMode.NONE === udpChannel.controlMode()
        ) {
            throw new IllegalArgumentException(
                "'control' parameter requires that either 'endpoint' or 'control-mode' is specified, channel=" +
                    udpChannel.originalUriString(),
            );
        }
    }

    /** @internal */
    public static validateControlForSubscription(udpChannel: UdpChannel): void {
        if (udpChannel.hasExplicitControl() && 0 === udpChannel.localControl().getPort()) {
            throw new IllegalArgumentException(
                MDC_CONTROL_PARAM_NAME + ' has port=0 for subscription: channel=' + udpChannel.originalUriString(),
            );
        }
    }

    /** @internal */
    public static validateTimestampConfiguration(udpChannel: UdpChannel): void {
        if (null !== udpChannel.channelUri().get(MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME)) {
            throw new InvalidChannelException(
                "Media timestamps '" +
                    MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME +
                    "' are not supported in the Java driver: channel=" +
                    udpChannel.originalUriString(),
            );
        }
    }

    /** @internal */
    public static validateDestinationUri(uri: ChannelUri, destinationUri: string): void {
        if (SPY_QUALIFIER === uri.prefix()) {
            throw new InvalidChannelException(
                'Aeron spies are invalid as send destinations: channel=' + destinationUri,
            );
        }

        for (const invalidKey of INVALID_DESTINATION_KEYS) {
            if (uri.containsKey(invalidKey)) {
                throw new InvalidChannelException(
                    'destinations must not contain the key: ' + invalidKey + ' channel=' + destinationUri,
                );
            }
        }

        if (CONTROL_MODE_RESPONSE === uri.get(MDC_CONTROL_MODE_PARAM_NAME)) {
            throw new InvalidChannelException(
                'destinations may not specify ' + MDC_CONTROL_MODE_PARAM_NAME + '=' + CONTROL_MODE_RESPONSE,
            );
        }
    }

    /** @internal */
    public static validateSendDestinationUri(uri: ChannelUri, destinationUri: string): void {
        const endpoint = uri.get(ENDPOINT_PARAM_NAME);

        if (null !== endpoint && endpoint.endsWith(':0')) {
            throw new InvalidChannelException(
                ENDPOINT_PARAM_NAME + ' has port=0 for send destination: channel=' + destinationUri,
            );
        }
    }

    /** Java's `validateExperimentalFeatures` has no checks yet: it is here for the call site. */
    /** @internal */
    public static validateExperimentalFeatures(_enableExperimentalFeatures: boolean, _channel: UdpChannel): void {}

    public static resolveDelayGenerator(
        ctx: MediaDriverContext,
        channel: UdpChannel,
        isMulticastSemantics: boolean,
        isReliable: boolean,
    ): FeedbackDelayGenerator {
        if (!isReliable) {
            return StaticDelayGenerator.ZERO_DELAY_GENERATOR;
        }

        if (isMulticastSemantics) {
            return ctx.multicastFeedbackDelayGenerator() as FeedbackDelayGenerator;
        }

        const nakDelayNs = channel.nakDelayNs();
        if (null !== nakDelayNs) {
            const retryDelayNs =
                Math.max(nakDelayNs, Configuration.NAK_UNICAST_DELAY_MIN_VALUE_NS) * ctx.nakUnicastRetryDelayRatio();
            return new StaticDelayGenerator(nakDelayNs, retryDelayNs);
        } else {
            return ctx.unicastFeedbackDelayGenerator() as FeedbackDelayGenerator;
        }
    }

    public static isMulticastSemantics(
        channel: UdpChannel,
        receiverGroupConsideration: InferableBoolean,
        flags: number,
    ): boolean {
        const isGroupFromFlag = SetupFlyweight.GROUP_FLAG === (flags & SetupFlyweight.GROUP_FLAG);

        return InferableBoolean.INFER === receiverGroupConsideration
            ? channel.isMulticast() || isGroupFromFlag
            : InferableBoolean.FORCE_TRUE === receiverGroupConsideration;
    }

    /** @internal */
    public recordError(ex: Error): void {
        (this.ctx.countedErrorHandler() as { onError(ex: Error): void }).onError(ex);
    }

    private static throwResourceTemporaryUnavailableIfSendEndpointIsClosing(endpoint: SendChannelEndpoint): void {
        if (ChannelEndpointStatus.CLOSING === endpoint.status()) {
            throw new ControlProtocolException(
                ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
                'SendChannelEndpoint found in CLOSING state, please retry',
            );
        }
    }

    private static throwResourceTemporaryUnavailableIfReceiveEndpointIsClosing(endpoint: ReceiveChannelEndpoint): void {
        if (ChannelEndpointStatus.CLOSING === endpoint.status()) {
            throw new ControlProtocolException(
                ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
                'ReceiveChannelEndpoint found in CLOSING state, please retry',
            );
        }
    }

    /** @internal Whether a send endpoint exists for the channel (it throws as `getOrCreateSendChannelEndpoint` does). */
    public hasSendChannelEndpoint(udpChannel: UdpChannel): boolean {
        return null !== this.findExistingSendChannelEndpoint(udpChannel);
    }

    /** @internal Whether a receive endpoint exists for the channel (it throws as `getOrCreateReceiveChannelEndpoint` does). */
    public hasReceiveChannelEndpoint(udpChannel: UdpChannel): boolean {
        return null !== this.findExistingReceiveChannelEndpoint(udpChannel);
    }

    /** @internal */
    public senderQueueHasRoom(commands: number): boolean {
        return hasRoom(this.senderCommandQueue, commands);
    }

    /** @internal */
    public receiverQueueHasRoom(commands: number): boolean {
        return hasRoom(this.receiverCommandQueue, commands);
    }

    /** @internal Java's `DriverConductor.this.ctx.enableExperimentalFeatures()`. */
    public enableExperimentalFeatures(): boolean {
        return this.ctx.enableExperimentalFeatures();
    }
}

// Not ported: AddIpcPublicationCommand, AddSpySubscriptionCommand, AddRcvSpyDestinationCommand (spec section 3, D54).

const AddNetworkPublicationState = {
    INIT: 0,
    PARSE_CHANNEL: 1,
    VALIDATE: 2,
    RESOLVE_PUBLICATION: 3,
    AWAIT_LOG_BUFFER: 4,
    CREATE_PUBLICATION: 5,
    DONE: 6,
} as const;

class AddNetworkPublicationCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly channel: string;
    private readonly streamId: number;
    private readonly clientId: number;
    private readonly isExclusive: boolean;
    private state: number = AddNetworkPublicationState.INIT;
    private params: PublicationParams | null = null;
    private udpChannel: UdpChannel | null = null;
    private channelEndpoint: SendChannelEndpoint | null = null;
    private responsePublicationImage: PublicationImage | null = null;
    private publication: NetworkPublication | null = null;
    private isNewPublication = false;
    private parseChannelResult: CommandResult<UdpChannel> | null = null;
    private logBufferResult: CommandResult<RawLog> | null = null;
    private rawLog: RawLog | null = null;
    private socketRcvBufLength = 0;
    private socketSndBufLength = 0;

    public constructor(
        conductor: DriverConductor,
        channel: string,
        streamId: number,
        correlationId: number,
        clientId: number,
        isExclusive: boolean,
    ) {
        super(correlationId);
        this.c = conductor;
        this.channel = channel;
        this.streamId = streamId;
        this.clientId = clientId;
        this.isExclusive = isExclusive;
    }

    public execute(): boolean {
        if (AddNetworkPublicationState.INIT === this.state) {
            this.parseChannelResult = this.c.nativeResourceAgentProxy.parseChannel(this.channel, false);
            this.state = AddNetworkPublicationState.PARSE_CHANNEL;
        }

        if (AddNetworkPublicationState.PARSE_CHANNEL === this.state) {
            this.parseChannel();
        }

        if (AddNetworkPublicationState.VALIDATE === this.state) {
            this.validate();
        }

        if (AddNetworkPublicationState.RESOLVE_PUBLICATION === this.state) {
            this.resolvePublication();
        }

        if (AddNetworkPublicationState.AWAIT_LOG_BUFFER === this.state) {
            this.awaitLogBuffer();
        }

        if (AddNetworkPublicationState.CREATE_PUBLICATION === this.state) {
            this.createPublication();
        }

        return AddNetworkPublicationState.DONE === this.state;
    }

    public override close(): void {
        if (null !== this.rawLog) {
            this.c.nativeResourceAgentProxy.freeLogBuffer(this.rawLog);
        }
    }

    private parseChannel(): void {
        const udpChannel = (this.parseChannelResult as CommandResult<UdpChannel>).get();
        if (null !== udpChannel) {
            this.udpChannel = udpChannel;
            this.state = AddNetworkPublicationState.VALIDATE;
        }
    }

    private validate(): void {
        const udpChannel = this.udpChannel as UdpChannel;
        const channelUri = udpChannel.channelUri();
        const params = PublicationParams.getPublicationParams(
            channelUri,
            this.c.ctx,
            this.c,
            this.streamId,
            udpChannel.canonicalForm(),
        );
        this.params = params;
        DriverConductor.validateExperimentalFeatures(this.c.enableExperimentalFeatures(), udpChannel);
        DriverConductor.validateEndpointForPublication(udpChannel);
        DriverConductor.validateControlForPublication(udpChannel);
        this.c.validateResponseSubscription(params);

        this.state = AddNetworkPublicationState.RESOLVE_PUBLICATION;
    }

    private resolvePublication(): void {
        const udpChannel = this.udpChannel as UdpChannel;
        const params = this.params as PublicationParams;
        const c = this.c;

        this.channelEndpoint = c.findExistingSendChannelEndpoint(udpChannel);
        if (null !== this.channelEndpoint) {
            c.validateUdpChannelAgainstSendChannelEndpoint(params, udpChannel, this.channelEndpoint);

            if (!this.isExclusive) {
                this.publication = c.findPublication(this.streamId, this.channelEndpoint, params.responseCorrelationId);
            }
        }

        if (null === this.publication) {
            c.checkForSessionClash(params.sessionId, this.streamId, udpChannel.canonicalForm(), this.channel);

            if (params.isResponse && PROTOTYPE_VALUE_CORRELATION_ID === params.responseCorrelationId) {
                params.termLength = TERM_MIN_LENGTH;
            }

            if (null !== this.channelEndpoint) {
                this.socketRcvBufLength = this.channelEndpoint.socketRcvbufLength();
                this.socketSndBufLength = this.channelEndpoint.socketSndbufLength();
            } else {
                this.socketRcvBufLength = udpChannel.socketRcvbufLength();
                this.socketSndBufLength = udpChannel.socketSndbufLength();
            }

            this.logBufferResult = c.nativeResourceAgentProxy.newPublicationLog(
                this.correlationId,
                params.termLength,
                params.isSparse,
            );

            this.state = AddNetworkPublicationState.AWAIT_LOG_BUFFER;
        } else {
            const publication = this.publication;
            PublicationParams.confirmMatch(
                udpChannel.channelUri(),
                params,
                publication.rawLog(),
                publication.sessionId(),
                publication.channel(),
                publication.initialTermId(),
                publication.startingTermId(),
                publication.startingTermOffset(),
            );

            PublicationParams.validateSpiesSimulateConnection(
                params,
                publication.spiesSimulateConnection(),
                this.channel,
                publication.channel(),
            );

            this.responsePublicationImage = this.findResponsePublicationImage();

            this.linkPublication();
        }
    }

    private awaitLogBuffer(): void {
        const rawLog = (this.logBufferResult as CommandResult<RawLog>).get();
        if (null !== rawLog) {
            this.rawLog = rawLog;
            this.initializeLogMetadata();
            this.state = AddNetworkPublicationState.CREATE_PUBLICATION;
        }
    }

    private initializeLogMetadata(): void {
        const params = this.params as PublicationParams;
        const receiverWindowLength = 0;
        const tether = false;
        const rejoin = false;
        const reliable = false;
        const initialTermId = params.initialTermId;
        this.c.initLogMetadata(
            this.isExclusive ? LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION : LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION,
            params.sessionId,
            this.streamId,
            initialTermId,
            params.mtuLength,
            this.correlationId,
            this.socketRcvBufLength,
            this.socketSndBufLength,
            params.termOffset,
            receiverWindowLength,
            tether,
            rejoin,
            reliable,
            params.isSparse,
            (this.udpChannel as UdpChannel).hasGroupSemantics(),
            params.isResponse,
            params.publicationWindowLength,
            params.untetheredWindowLimitTimeoutNs,
            params.untetheredLingerTimeoutNs,
            params.untetheredRestingTimeoutNs,
            params.maxResend,
            params.lingerTimeoutNs,
            params.signalEos,
            params.spiesSimulateConnection,
            params.entityTag,
            params.responseCorrelationId,
            this.rawLog as RawLog,
        );
        DriverConductor.initialiseLogBufferPosition(initialTermId, params, (this.rawLog as RawLog).metaData());
    }

    private createPublication(): void {
        // The sender is offered the endpoint and the publication: wait for room in its queue rather than register
        // either half-way (spec D42, D55)
        if (!this.c.senderQueueHasRoom(this.c.hasSendChannelEndpoint(this.udpChannel as UdpChannel) ? 1 : 2)) {
            return;
        }

        this.responsePublicationImage = this.findResponsePublicationImage();

        this.channelEndpoint = this.c.getOrCreateSendChannelEndpoint(
            this.params as PublicationParams,
            this.udpChannel as UdpChannel,
            this.correlationId,
        );

        this.publication = this.c.newNetworkPublication(
            this.correlationId,
            this.clientId,
            this.streamId,
            this.channel,
            this.udpChannel as UdpChannel,
            this.channelEndpoint,
            this.rawLog as RawLog,
            this.params as PublicationParams,
            this.isExclusive,
        );

        this.rawLog = null; // ownership transferred to the NetworkPublication

        this.isNewPublication = true;
        this.linkPublication();
    }

    private linkPublication(): void {
        const c = this.c;
        const publication = this.publication as NetworkPublication;
        c.publicationLinks.push(new PublicationLink(this.correlationId, c.getOrAddClient(this.clientId), publication));

        c.clientProxy.onPublicationReady(
            this.correlationId,
            publication.registrationId(),
            this.streamId,
            publication.sessionId(),
            publication.rawLog().fileName(),
            publication.publisherLimitId(),
            (this.channelEndpoint as SendChannelEndpoint).statusIndicatorCounterId(),
            this.isExclusive,
        );

        // if (isNewPublication) linkSpies(...): spy subscriptions are not ported

        if (null !== this.responsePublicationImage) {
            this.responsePublicationImage.responseSessionId(publication.sessionId());
            this.responsePublicationImage.requestNextSmDeadlineReset();
        }

        this.state = AddNetworkPublicationState.DONE;
    }

    private findResponsePublicationImage(): PublicationImage | null {
        const params = this.params as PublicationParams;
        if (!params.isResponse) {
            return null;
        }

        if (NULL_VALUE === params.responseCorrelationId) {
            throw new IllegalArgumentException(
                'control-mode=response was specified, but no response-correlation-id set',
            );
        }

        if (PROTOTYPE_VALUE_CORRELATION_ID === params.responseCorrelationId) {
            return null;
        }

        for (const publicationImage of this.c.publicationImages) {
            if (publicationImage.correlationId() === params.responseCorrelationId) {
                if (publicationImage.hasSendResponseSetup()) {
                    return publicationImage;
                } else {
                    throw new IllegalArgumentException(
                        'image.correlationId=' + params.responseCorrelationId + ' did not request a response channel',
                    );
                }
            }
        }

        throw new IllegalArgumentException('image.correlationId=' + params.responseCorrelationId + ' not found');
    }

    /** @internal isNewPublication is read by Java's linkSpies only */
    public wasNewPublication(): boolean {
        return this.isNewPublication;
    }
}

const AddNetworkSubscriptionState = {
    AWAITING_CHANNEL_PARSE: 0,
    VALIDATING: 1,
    RESOLVING_ENDPOINT: 2,
    CREATING_LINKS: 3,
    DONE: 4,
} as const;

class AddNetworkSubscriptionCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly channel: string;
    private readonly streamId: number;
    private readonly registrationId: number;
    private readonly clientId: number;
    private readonly parseChannelResult: CommandResult<UdpChannel>;
    private state: number;
    private params: SubscriptionParams | null = null;
    private channelEndpoint: ReceiveChannelEndpoint | null = null;
    private udpChannel: UdpChannel | null = null;

    public constructor(
        conductor: DriverConductor,
        channel: string,
        streamId: number,
        registrationId: number,
        clientId: number,
    ) {
        super(registrationId);
        this.c = conductor;
        this.channel = channel;
        this.streamId = streamId;
        this.registrationId = registrationId;
        this.clientId = clientId;
        this.parseChannelResult = conductor.nativeResourceAgentProxy.parseChannel(channel, false);
        this.state = AddNetworkSubscriptionState.AWAITING_CHANNEL_PARSE;
    }

    public execute(): boolean {
        if (AddNetworkSubscriptionState.AWAITING_CHANNEL_PARSE === this.state) {
            const udpChannel = this.parseChannelResult.get();
            if (null !== udpChannel) {
                this.udpChannel = udpChannel;
                this.state = AddNetworkSubscriptionState.VALIDATING;
            }
        }

        if (AddNetworkSubscriptionState.VALIDATING === this.state) {
            this.validating();
        }

        if (AddNetworkSubscriptionState.RESOLVING_ENDPOINT === this.state) {
            this.resolvingEndpoint();
        }

        if (AddNetworkSubscriptionState.CREATING_LINKS === this.state) {
            this.creatingLinks();
        }

        return AddNetworkSubscriptionState.DONE === this.state;
    }

    private validating(): void {
        const udpChannel = this.udpChannel as UdpChannel;
        DriverConductor.validateExperimentalFeatures(this.c.enableExperimentalFeatures(), udpChannel);
        DriverConductor.validateControlForSubscription(udpChannel);
        DriverConductor.validateTimestampConfiguration(udpChannel);

        this.params = SubscriptionParams.getSubscriptionParams(udpChannel.channelUri(), this.c.ctx, 0);
        this.c.checkForClashingSubscription(this.params, udpChannel, this.streamId);

        this.state = AddNetworkSubscriptionState.RESOLVING_ENDPOINT;
    }

    private resolvingEndpoint(): void {
        // The receiver is offered the endpoint and the subscription: wait for room in its queue rather than register
        // either half-way (spec D42, D55)
        if (!this.c.receiverQueueHasRoom(this.c.hasReceiveChannelEndpoint(this.udpChannel as UdpChannel) ? 1 : 2)) {
            return;
        }

        this.channelEndpoint = this.c.getOrCreateReceiveChannelEndpoint(
            this.params as SubscriptionParams,
            this.udpChannel as UdpChannel,
            this.registrationId,
        );
        this.state = AddNetworkSubscriptionState.CREATING_LINKS;
    }

    private creatingLinks(): void {
        const c = this.c;
        if (!c.receiverQueueHasRoom(1)) {
            return;
        }

        const channelEndpoint = this.channelEndpoint as ReceiveChannelEndpoint;
        const subscription = new NetworkSubscriptionLink(
            this.registrationId,
            channelEndpoint,
            this.streamId,
            this.channel,
            c.getOrAddClient(this.clientId),
            this.params as SubscriptionParams,
        );

        c.subscriptionLinks.push(subscription);

        const controlMode = (this.udpChannel as UdpChannel).controlMode();
        if (ControlMode.RESPONSE === controlMode) {
            channelEndpoint.incResponseRefToStream(subscription.streamId());
        } else {
            c.addNetworkSubscriptionToReceiver(subscription);
        }

        c.clientProxy.onSubscriptionReady(this.registrationId, channelEndpoint.statusIndicatorCounter().id());
        c.linkMatchingImages(subscription);

        this.state = AddNetworkSubscriptionState.DONE;
    }
}

const AddRcvNetworkDestinationState = {
    INIT: 0,
    AWAITING_CHANNEL_PARSE: 1,
    CREATE_TRANSPORT: 2,
    DONE: 3,
} as const;

class AddRcvNetworkDestinationCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly registrationId: number;
    private readonly destinationChannel: string;
    private state: number = AddRcvNetworkDestinationState.INIT;
    private receiveChannelEndpoint: ReceiveChannelEndpoint | null = null;
    private udpChannel: UdpChannel | null = null;
    private parseChannelResult: CommandResult<UdpChannel> | null = null;

    public constructor(
        conductor: DriverConductor,
        registrationId: number,
        destinationChannel: string,
        correlationId: number,
    ) {
        super(correlationId);
        this.c = conductor;
        this.registrationId = registrationId;
        this.destinationChannel = destinationChannel;
    }

    public execute(): boolean {
        if (AddRcvNetworkDestinationState.INIT === this.state) {
            this.parseChannelResult = this.c.nativeResourceAgentProxy.parseChannel(this.destinationChannel, true);
            this.state = AddRcvNetworkDestinationState.AWAITING_CHANNEL_PARSE;
        }
        if (AddRcvNetworkDestinationState.AWAITING_CHANNEL_PARSE === this.state) {
            const udpChannel = (this.parseChannelResult as CommandResult<UdpChannel>).get();
            if (null !== udpChannel) {
                this.udpChannel = udpChannel;
                this.state = AddRcvNetworkDestinationState.CREATE_TRANSPORT;
            }
        }
        if (AddRcvNetworkDestinationState.CREATE_TRANSPORT === this.state) {
            this.createTransport();
        }

        return AddRcvNetworkDestinationState.DONE === this.state;
    }

    private createTransport(): void {
        const c = this.c;
        const udpChannel = this.udpChannel as UdpChannel;
        DriverConductor.validateDestinationUri(udpChannel.channelUri(), this.destinationChannel);

        const mdsSubscriptionLink = DriverConductor.findMdsSubscriptionLink(c.subscriptionLinks, this.registrationId);

        if (null === mdsSubscriptionLink) {
            throw new UnknownSubscriptionException('unknown MDS subscription: ' + this.registrationId);
        }

        // wait for room in the receiver's queue before a transport is opened (spec D42, D55)
        if (!c.receiverQueueHasRoom(1)) {
            return;
        }

        const receiveChannelEndpoint = mdsSubscriptionLink.channelEndpoint() as ReceiveChannelEndpoint;
        this.receiveChannelEndpoint = receiveChannelEndpoint;

        let localSocketAddressIndicator: AtomicCounter | null = null;
        let transport: ReceiveDestinationTransport | null = null;

        try {
            localSocketAddressIndicator = ReceiveLocalSocketAddress.allocate(
                c.tempBuffer,
                c.countersManager,
                this.registrationId,
                receiveChannelEndpoint.statusIndicatorCounter().id(),
            );

            transport = new ReceiveDestinationTransport(
                udpChannel,
                c.ctx,
                localSocketAddressIndicator,
                receiveChannelEndpoint,
            );

            transport.openChannel(null as unknown as AtomicCounter);
            transport.indicateActive();
        } catch (ex) {
            CloseHelper.closeAll(localSocketAddressIndicator, transport);
            throw ex;
        }

        c.receiverProxy.addDestination(receiveChannelEndpoint, transport);
        c.clientProxy.operationSucceeded(this.correlationId);

        this.state = AddRcvNetworkDestinationState.DONE;
    }
}

const RemoveRcvNetworkDestinationState = {
    INIT: 0,
    AWAITING_CHANNEL_PARSE: 1,
    REMOVING: 2,
    DONE: 3,
} as const;

class RemoveRcvNetworkDestinationCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly registrationId: number;
    private readonly destinationChannel: string;
    private state: number = RemoveRcvNetworkDestinationState.INIT;
    private udpChannel: UdpChannel | null = null;
    private receiveChannelEndpoint: ReceiveChannelEndpoint | null = null;
    private parseChannelResult: CommandResult<UdpChannel> | null = null;

    public constructor(
        conductor: DriverConductor,
        registrationId: number,
        destinationChannel: string,
        correlationId: number,
    ) {
        super(correlationId);
        this.c = conductor;
        this.registrationId = registrationId;
        this.destinationChannel = destinationChannel;
    }

    public execute(): boolean {
        if (RemoveRcvNetworkDestinationState.INIT === this.state) {
            this.init();
        }
        if (RemoveRcvNetworkDestinationState.AWAITING_CHANNEL_PARSE === this.state) {
            const udpChannel = (this.parseChannelResult as CommandResult<UdpChannel>).get();
            if (null !== udpChannel) {
                this.udpChannel = udpChannel;
                this.state = RemoveRcvNetworkDestinationState.REMOVING;
            }
        }
        if (RemoveRcvNetworkDestinationState.REMOVING === this.state) {
            this.removing();
        }

        return RemoveRcvNetworkDestinationState.DONE === this.state;
    }

    private init(): void {
        const c = this.c;
        for (let i = 0, size = c.subscriptionLinks.length; i < size; i++) {
            const subscriptionLink = c.subscriptionLinks[i] as SubscriptionLink;
            if (this.registrationId === subscriptionLink.registrationId()) {
                this.receiveChannelEndpoint = subscriptionLink.channelEndpoint();
                break;
            }
        }

        if (null === this.receiveChannelEndpoint) {
            throw new UnknownSubscriptionException('unknown subscription: ' + this.registrationId);
        }

        this.receiveChannelEndpoint.validateAllowsDestinationControl();

        this.parseChannelResult = c.nativeResourceAgentProxy.parseChannel(this.destinationChannel, true);

        this.state = RemoveRcvNetworkDestinationState.AWAITING_CHANNEL_PARSE;
    }

    private removing(): void {
        this.c.receiverProxy.removeDestination(
            this.receiveChannelEndpoint as ReceiveChannelEndpoint,
            this.udpChannel as UdpChannel,
        );
        this.c.clientProxy.operationSucceeded(this.correlationId);

        this.state = RemoveRcvNetworkDestinationState.DONE;
    }
}

const SendDestinationState = {
    INIT: 0,
    AWAITING_DESTINATION_ADDRESS: 1,
    DONE: 2,
} as const;

class AddSendDestinationCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly registrationId: number;
    private readonly destinationChannel: string;
    private state: number = SendDestinationState.INIT;
    private channelUri: ChannelUri | null = null;
    private destinationAddressResult: CommandResult<InetSocketAddress> | null = null;

    public constructor(
        conductor: DriverConductor,
        registrationId: number,
        destinationChannel: string,
        correlationId: number,
    ) {
        super(correlationId);
        this.c = conductor;
        this.registrationId = registrationId;
        this.destinationChannel = destinationChannel;
    }

    public execute(): boolean {
        if (SendDestinationState.INIT === this.state) {
            this.init();
        }

        if (SendDestinationState.AWAITING_DESTINATION_ADDRESS === this.state) {
            const address = (this.destinationAddressResult as CommandResult<InetSocketAddress>).get();
            if (null !== address) {
                const sendChannelEndpoint = this.c.findExistingManualSendChannelEndpoint(this.registrationId);
                this.c.senderProxy.addDestination(
                    sendChannelEndpoint,
                    this.channelUri as ChannelUri,
                    address,
                    this.correlationId,
                );
                this.c.clientProxy.operationSucceeded(this.correlationId);
                this.state = SendDestinationState.DONE;
            }
        }

        return SendDestinationState.DONE === this.state;
    }

    private init(): void {
        const channelUri = DriverConductor.parseUri(this.destinationChannel);
        this.channelUri = channelUri;
        DriverConductor.validateDestinationUri(channelUri, this.destinationChannel);
        DriverConductor.validateSendDestinationUri(channelUri, this.destinationChannel);

        this.c.findExistingManualSendChannelEndpoint(this.registrationId);

        this.destinationAddressResult = this.c.nativeResourceAgentProxy.destinationAddress(channelUri);
        this.state = SendDestinationState.AWAITING_DESTINATION_ADDRESS;
    }
}

class RemoveSendDestinationCommand extends ClientCommand {
    private readonly c: DriverConductor;
    private readonly registrationId: number;
    private readonly destinationChannel: string;
    private state: number = SendDestinationState.INIT;
    private channelUri: ChannelUri | null = null;
    private destinationAddressResult: CommandResult<InetSocketAddress> | null = null;

    public constructor(
        conductor: DriverConductor,
        registrationId: number,
        destinationChannel: string,
        correlationId: number,
    ) {
        super(correlationId);
        this.c = conductor;
        this.registrationId = registrationId;
        this.destinationChannel = destinationChannel;
    }

    public execute(): boolean {
        if (SendDestinationState.INIT === this.state) {
            this.init();
        }

        if (SendDestinationState.AWAITING_DESTINATION_ADDRESS === this.state) {
            const address = (this.destinationAddressResult as CommandResult<InetSocketAddress>).get();
            if (null !== address) {
                const sendChannelEndpoint = this.c.findExistingManualSendChannelEndpoint(this.registrationId);
                this.c.senderProxy.removeDestination(sendChannelEndpoint, this.channelUri as ChannelUri, address);
                this.c.clientProxy.operationSucceeded(this.correlationId);
                this.state = SendDestinationState.DONE;
            }
        }

        return SendDestinationState.DONE === this.state;
    }

    private init(): void {
        this.channelUri = DriverConductor.parseUri(this.destinationChannel);
        this.c.findExistingManualSendChannelEndpoint(this.registrationId);

        this.destinationAddressResult = this.c.nativeResourceAgentProxy.destinationAddress(this.channelUri);
        this.state = SendDestinationState.AWAITING_DESTINATION_ADDRESS;
    }
}

const CreatePublicationImageState = {
    VALIDATE: 0,
    AWAIT_LOG_BUFFER: 1,
    DONE: 2,
} as const;

class CreatePublicationImageCommand extends Command {
    private readonly c: DriverConductor;
    private readonly sessionId: number;
    private readonly streamId: number;
    private readonly initialTermId: number;
    private readonly activeTermId: number;
    private readonly termOffset: number;
    private readonly termBufferLength: number;
    private readonly senderMtuLength: number;
    private readonly transportIndex: number;
    private readonly flags: number;
    private readonly controlAddress: InetSocketAddress;
    private readonly sourceAddress: InetSocketAddress;
    private readonly channelEndpoint: ReceiveChannelEndpoint;
    private subscriptionParams: SubscriptionParams | null = null;
    private imageLogResult: CommandResult<RawLog> | null = null;
    private registrationId = 0;
    private state: number = CreatePublicationImageState.VALIDATE;
    private rawLog: RawLog | null = null;
    private streamInterest: StreamInterest | null = null;

    public constructor(
        conductor: DriverConductor,
        sessionId: number,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        termBufferLength: number,
        senderMtuLength: number,
        transportIndex: number,
        flags: number,
        controlAddress: InetSocketAddress,
        sourceAddress: InetSocketAddress,
        channelEndpoint: ReceiveChannelEndpoint,
    ) {
        super();
        this.c = conductor;
        this.sessionId = sessionId;
        this.streamId = streamId;
        this.initialTermId = initialTermId;
        this.activeTermId = activeTermId;
        this.termOffset = termOffset;
        this.termBufferLength = termBufferLength;
        this.senderMtuLength = senderMtuLength;
        this.transportIndex = transportIndex;
        this.flags = flags;
        this.controlAddress = controlAddress;
        this.sourceAddress = sourceAddress;
        this.channelEndpoint = channelEndpoint;
    }

    public override close(): void {
        if (null !== this.rawLog) {
            this.c.nativeResourceAgentProxy.freeLogBuffer(this.rawLog);
        }
    }

    public execute(): boolean {
        const c = this.c;
        try {
            // The image and the removal of the marker both go to the receiver: wait for room in its queue (D42, D55)
            if (!c.receiverQueueHasRoom(2)) {
                return false;
            }

            if (CreatePublicationImageState.VALIDATE === this.state) {
                Configuration.validateMtuLength(this.senderMtuLength);
                LogBufferDescriptor.checkTermLength(this.termBufferLength);

                const subscriptionParams = SubscriptionParams.getSubscriptionParams(
                    this.channelEndpoint.subscriptionUdpChannel().channelUri(),
                    c.ctx,
                    this.termBufferLength,
                );
                this.subscriptionParams = subscriptionParams;

                Configuration.validateInitialWindowLength(
                    subscriptionParams.receiverWindowLength,
                    this.senderMtuLength,
                );

                this.streamInterest = c.findSubscribers(
                    this.channelEndpoint,
                    this.sessionId,
                    this.streamId,
                    this.flags,
                );
                if (null === this.streamInterest) {
                    c.receiverProxy.removeInitInProgress(this.channelEndpoint, this.sessionId, this.streamId);
                    this.state = CreatePublicationImageState.DONE;
                } else {
                    this.registrationId = c.toDriverCommands.nextCorrelationId();

                    this.imageLogResult = c.nativeResourceAgentProxy.newImageLog(
                        this.registrationId,
                        this.termBufferLength,
                        this.streamInterest.sparse,
                    );
                    this.state = CreatePublicationImageState.AWAIT_LOG_BUFFER;
                }
            }

            if (CreatePublicationImageState.AWAIT_LOG_BUFFER === this.state) {
                const rawLog = (this.imageLogResult as CommandResult<RawLog>).get();
                if (null !== rawLog) {
                    this.rawLog = rawLog;
                    this.initializeLogMetadata();
                    this.newPublicationImage();

                    this.state = CreatePublicationImageState.DONE;
                }
            }

            return CreatePublicationImageState.DONE === this.state;
        } catch (ex) {
            c.receiverProxy.removeInitInProgress(this.channelEndpoint, this.sessionId, this.streamId);
            throw ex;
        }
    }

    private initializeLogMetadata(): void {
        const publicationWindowLength = 0;
        const maxResend = 0;
        const lingerTimeoutNs = 0;
        const signalEos = false;
        const spiesSimulateConnection = false;
        const entityTag = 0;
        const responseCorrelationId = 0;
        const subscriptionParams = this.subscriptionParams as SubscriptionParams;
        const streamInterest = this.streamInterest as StreamInterest;
        this.c.initLogMetadata(
            LOG_BUFFER_TYPE_PUBLICATION_IMAGE,
            this.sessionId,
            this.streamId,
            this.initialTermId,
            this.senderMtuLength,
            this.registrationId,
            this.channelEndpoint.socketRcvbufLength(),
            this.channelEndpoint.socketSndbufLength(),
            this.termOffset,
            subscriptionParams.receiverWindowLength,
            subscriptionParams.isTether,
            subscriptionParams.isRejoin,
            streamInterest.reliable,
            streamInterest.reliable,
            streamInterest.multicastSemantics,
            subscriptionParams.isResponse,
            publicationWindowLength,
            subscriptionParams.untetheredWindowLimitTimeoutNs,
            subscriptionParams.untetheredLingerTimeoutNs,
            subscriptionParams.untetheredRestingTimeoutNs,
            maxResend,
            lingerTimeoutNs,
            signalEos,
            spiesSimulateConnection,
            entityTag,
            responseCorrelationId,
            this.rawLog as RawLog,
        );
    }

    private newPublicationImage(): void {
        const c = this.c;
        const ctx = c.ctx;
        const sessionId = this.sessionId;
        const streamId = this.streamId;
        const channelEndpoint = this.channelEndpoint;
        const registrationId = this.registrationId;
        const subscriptionParams = this.subscriptionParams as SubscriptionParams;
        const joinPosition = computePosition(
            this.activeTermId,
            this.termOffset,
            LogBufferDescriptor.positionBitsToShift(this.termBufferLength),
            this.initialTermId,
        );
        const subscriberPositions = c.createSubscriberPositions(sessionId, streamId, channelEndpoint, joinPosition);
        if (0 === subscriberPositions.length) {
            c.receiverProxy.removeInitInProgress(channelEndpoint, sessionId, streamId);
            return;
        }

        const subscriptionChannel = channelEndpoint.subscriptionUdpChannel();
        const subscription = (subscriberPositions[0] as SubscriberPosition).subscription();
        const isMulticastSemantics = DriverConductor.isMulticastSemantics(
            subscriptionChannel,
            subscription.group(),
            this.flags,
        );
        const isReliable = subscription.isReliable();

        let congestionControl: CongestionControl | null = null;
        let hwmPos: UnsafeBufferPosition | null = null;
        let rcvPos: UnsafeBufferPosition | null = null;
        let rcvNaksSent: AtomicCounter | null = null;
        try {
            congestionControl = (
                ctx.congestionControlSupplier() as NonNullable<
                    ReturnType<MediaDriverContext['congestionControlSupplier']>
                >
            ).newInstance(
                registrationId,
                subscriptionChannel,
                streamId,
                sessionId,
                this.termBufferLength,
                this.senderMtuLength,
                this.controlAddress,
                this.sourceAddress,
                ctx.receiverCachedNanoClock() as CachedNanoClock,
                ctx,
                c.countersManager,
            );

            const uri = subscription.channel();
            const clientId = subscription.aeronClient().clientId();
            hwmPos = ReceiverHwm.allocate(
                c.tempBuffer,
                c.countersManager,
                clientId,
                registrationId,
                sessionId,
                streamId,
                uri,
            );
            rcvPos = ReceiverPos.allocate(
                c.tempBuffer,
                c.countersManager,
                clientId,
                registrationId,
                sessionId,
                streamId,
                uri,
            );
            rcvNaksSent = ReceiverNaksSent.allocate(
                c.tempBuffer,
                c.countersManager,
                clientId,
                registrationId,
                sessionId,
                streamId,
                uri,
            );

            const sourceIdentity = Configuration.sourceIdentity(this.sourceAddress);

            const image = new PublicationImage(
                registrationId,
                ctx,
                channelEndpoint,
                this.transportIndex,
                this.controlAddress,
                sessionId,
                streamId,
                this.initialTermId,
                this.activeTermId,
                this.termOffset,
                this.flags,
                isReliable,
                subscriptionParams.untetheredWindowLimitTimeoutNs,
                subscriptionParams.untetheredLingerTimeoutNs,
                subscriptionParams.untetheredRestingTimeoutNs,
                this.rawLog as RawLog,
                DriverConductor.resolveDelayGenerator(ctx, subscriptionChannel, isMulticastSemantics, isReliable),
                subscriberPositions,
                hwmPos,
                rcvPos,
                rcvNaksSent,
                sourceIdentity,
                congestionControl,
            );

            // Offer to the receiver before anything is registered (spec D42, D55)
            c.receiverProxy.newPublicationImage(channelEndpoint, image);
            this.rawLog = null; // transfer ownership

            channelEndpoint.incRefImages();
            c.publicationImages.push(image);

            for (const position of subscriberPositions) {
                position.addLink(image);

                const positionCounterId = position.positionCounterId();
                c.countersManager.setCounterReferenceId(positionCounterId, registrationId);

                c.clientProxy.onAvailableImage(
                    registrationId,
                    streamId,
                    sessionId,
                    position.subscription().registrationId(),
                    positionCounterId,
                    image.rawLog().fileName(),
                    sourceIdentity,
                );
            }
        } catch (ex) {
            c.recordError(ex as Error);
            subscriberPositions.forEach((subscriberPosition) => subscriberPosition.position().close());
            CloseHelper.quietCloseAll(congestionControl, hwmPos, rcvPos, rcvNaksSent);
        }
    }
}

class ReResolveControlAddress extends Command {
    private readonly c: DriverConductor;
    private readonly control: string;
    private readonly udpChannel: UdpChannel;
    private readonly channelEndpoint: ReceiveChannelEndpoint;
    private readonly address: InetSocketAddress | null;
    private readonly resolvedAddressResult: CommandResult<InetSocketAddress>;

    public constructor(
        conductor: DriverConductor,
        control: string,
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
        address: InetSocketAddress | null,
    ) {
        super();
        this.c = conductor;
        this.resolvedAddressResult = conductor.nativeResourceAgentProxy.reResolveAddress(
            control,
            MDC_CONTROL_PARAM_NAME,
        );
        this.control = control;
        this.udpChannel = udpChannel;
        this.channelEndpoint = channelEndpoint;
        this.address = address;
    }

    public execute(): boolean {
        const newAddress = this.resolvedAddressResult.get();
        if (null !== newAddress) {
            if (newAddress.isUnresolved()) {
                throw new AeronEvent('could not re-resolve: ' + MDC_CONTROL_PARAM_NAME + '=' + this.control);
            }

            if (ChannelEndpointStatus.ACTIVE === this.channelEndpoint.status()) {
                if (!(this.address?.equals(newAddress) ?? false)) {
                    this.c.receiverProxy.onResolutionChange(this.channelEndpoint, this.udpChannel, newAddress);
                }
            }
            return true;
        }
        return false;
    }
}

class ReResolveEndpointAddress extends Command {
    private readonly c: DriverConductor;
    private readonly endpoint: string;
    private readonly channelEndpoint: SendChannelEndpoint;
    private readonly address: InetSocketAddress | null;
    private readonly resolvedAddressResult: CommandResult<InetSocketAddress>;

    public constructor(
        conductor: DriverConductor,
        endpoint: string,
        channelEndpoint: SendChannelEndpoint,
        address: InetSocketAddress | null,
    ) {
        super();
        this.c = conductor;
        this.endpoint = endpoint;
        this.channelEndpoint = channelEndpoint;
        this.address = address;
        this.resolvedAddressResult = conductor.nativeResourceAgentProxy.reResolveAddress(endpoint, ENDPOINT_PARAM_NAME);
    }

    public execute(): boolean {
        const newAddress = this.resolvedAddressResult.get();
        if (null !== newAddress) {
            if (newAddress.isUnresolved()) {
                throw new AeronEvent('could not re-resolve: ' + ENDPOINT_PARAM_NAME + '=' + this.endpoint);
            }

            if (ChannelEndpointStatus.ACTIVE === this.channelEndpoint.status()) {
                if (!(this.address?.equals(newAddress) ?? false)) {
                    this.c.senderProxy.onResolutionChange(this.channelEndpoint, this.endpoint, newAddress);
                }
            }
            return true;
        }
        return false;
    }
}
