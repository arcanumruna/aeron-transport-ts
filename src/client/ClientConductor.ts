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
// Port of io/aeron/ClientConductor.java @ 1.53.3
import { ArrayListUtil } from '../agrona/collections/ArrayListUtil.js';
import { Long2ObjectHashMap } from '../agrona/collections/Long2ObjectHashMap.js';
import { LongHashSet } from '../agrona/collections/LongHashSet.js';
import { BitUtil } from '../agrona/BitUtil.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { Agent } from '../agrona/concurrent/Agent.js';
import { AgentTerminationException } from '../agrona/concurrent/AgentTerminationException.js';
import type { AgentInvoker } from '../agrona/concurrent/AgentInvoker.js';
import type { EpochClock } from '../agrona/concurrent/EpochClock.js';
import type { IdleStrategy } from '../agrona/concurrent/IdleStrategy.js';
import type { Lock } from '../agrona/concurrent/NoOpLock.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../agrona/concurrent/status/UnsafeBufferPosition.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { IllegalStateException, TimeUnit } from '../agrona/jdk.js';
import { JavaError, StandardCharsets, Thread } from '../agrona/jdkLang.js';
import { SemanticVersion } from '../agrona/SemanticVersion.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { hostsToLookUp, lookUpHost } from '../driver/HostNameLookup.js';
import type { Aeron, AeronContext } from './Aeron.js';
import { AeronCounters } from './AeronCounters.js';
import { AeronVersion } from './AeronVersion.js';
import type { AvailableImageHandler } from './AvailableImageHandler.js';
import { ConcurrentPublication } from './ConcurrentPublication.js';
import type { PublicationErrorFrameFlyweight } from './command/PublicationErrorFrameFlyweight.js';
import { DriverEventsAdapter } from './DriverEventsAdapter.js';
import type { DriverProxy } from './DriverProxy.js';
import { ErrorCode } from './ErrorCode.js';
import { AeronException } from './exceptions/AeronException.js';
import { ChannelEndpointException } from './exceptions/ChannelEndpointException.js';
import { ClientTimeoutException } from './exceptions/ClientTimeoutException.js';
import { ConductorServiceTimeoutException } from './exceptions/ConductorServiceTimeoutException.js';
import { DriverTimeoutException } from './exceptions/DriverTimeoutException.js';
import { RegistrationException } from './exceptions/RegistrationException.js';
import { ExclusivePublication } from './ExclusivePublication.js';
import { Image } from './Image.js';
import type { LogBuffers } from './LogBuffers.js';
import type { LogBuffersFactory } from './LogBuffersFactory.js';
import { NULL_VALUE } from './NullValue.js';
import { Publication } from './Publication.js';
import { ChannelEndpointStatus } from './status/ChannelEndpointStatus.js';
import { HeartbeatTimestamp } from './status/HeartbeatTimestamp.js';
import { PublicationErrorFrame } from './status/PublicationErrorFrame.js';
import { Subscription } from './Subscription.js';
import type { UnavailableImageHandler } from './UnavailableImageHandler.js';

const { SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION, DRIVER_SYSTEM_COUNTER_TYPE_ID, appendToLabel, formatVersionInfo } =
    AeronCounters;
const { CHANNEL_ENDPOINT_ERROR, GENERIC_ERROR } = ErrorCode;
const { HEARTBEAT_TYPE_ID } = HeartbeatTimestamp;
const { NULL_COUNTER_ID, RECORD_ALLOCATED } = CountersReader;

const NO_CORRELATION_ID = NULL_VALUE;
const EXPLICIT_CLOSE_LINGER_NS = TimeUnit.SECONDS.toNanos(1);

/**
 * `Class.getSimpleName()` of a resource that is not what the call expects: the name of the constructor of a JS value
 * (`String` for a string, as Java names it).
 */
function simpleName(resource: unknown): string {
    return (resource as { constructor?: { name?: string } } | null)?.constructor?.name ?? typeof resource;
}

/**
 * The subscription of an `asyncAddSubscription` that the driver has not answered yet. Nested in Java, private
 * constructor; here a class of its own, also reachable as `ClientConductor.PendingSubscription`.
 */
export class PendingSubscription {
    public readonly subscription: Subscription;

    /** @internal private in Java */
    public constructor(subscription: Subscription) {
        this.subscription = subscription;
    }
}

/**
 * A command that waits for the host names of its channel to resolve before it is written to the driver (spec D92).
 */
const NO_HOSTS: readonly string[] = [];

interface PendingCommand {
    readonly registrationId: number;
    readonly send: (registrationId: number) => void;
    remaining: number;
}

/**
 * Client conductor takes responses and notifications from the media driver and processes commands from the
 * application API. It lets the media driver know that the client is alive, and detects when the media driver is not.
 * <p>
 * Application API calls are queued to the driver by the {@link DriverProxy}, and the responses read from the to
 * client broadcast buffer by the {@link DriverEventsAdapter}. Calls that wait for the driver (`addPublication`,
 * `addSubscription`, ...) run the duty cycle of the driver (the {@link AgentInvoker} of the context) until its reply
 * is in, and never wait on the clock otherwise (spec D94).
 * <p>
 * The counters API and `nextAvailableSessionId` are not ported (spec D95). The lock of the client is a no-op on the one
 * JS thread, kept for the `Context.clientLock` option (spec D93).
 */
export class ClientConductor implements Agent {
    /**
     * The nested class {@link PendingSubscription}.
     */
    public static readonly PendingSubscription = PendingSubscription;

    public static readonly CONTROL_PROTOCOL_VERSION_WITH_NEXT_AVAILABLE_SESSION_ID_COMMAND = SemanticVersion.compose(
        1,
        0,
        0,
    );

    /** @internal package-private in Java */
    public readonly controlProtocolVersion: number;

    private readonly idleSleepDurationNs: number;
    private readonly keepAliveIntervalNs: number;
    private readonly driverTimeoutMs: number;
    private readonly driverTimeoutNs: number;
    private readonly interServiceTimeoutNs: number;
    private timeOfLastKeepAliveNs: number;
    private timeOfLastServiceNs: number;
    private _isClosed = false;
    private isInCallback = false;
    private _isTerminating = false;
    private driverException: RegistrationException | null = null;

    private readonly ctx: AeronContext;
    private readonly aeron: Aeron;
    private readonly clientLock: Lock;
    private readonly epochClock: EpochClock;
    private readonly nanoClock: NanoClock;
    private readonly awaitingIdleStrategy: IdleStrategy;
    private readonly driverEventsAdapter: DriverEventsAdapter;
    private readonly logBuffersFactory: LogBuffersFactory;
    private readonly logBuffersByIdMap = new Long2ObjectHashMap<LogBuffers>();
    private readonly lingeringLogBuffers: LogBuffers[] = [];
    /** @internal package-private in Java */
    public readonly resourceByRegIdMap = new Long2ObjectHashMap<unknown>();
    private readonly asyncExceptionByRegIdMap = new Long2ObjectHashMap<RegistrationException>();
    private readonly stashedChannelByRegistrationId = new Long2ObjectHashMap<string>();
    /** @internal package-private in Java */
    public readonly asyncCommandIdSet = new LongHashSet();
    private readonly defaultAvailableImageHandler: AvailableImageHandler | null;
    private readonly defaultUnavailableImageHandler: UnavailableImageHandler | null;
    private readonly closeHandlerByIdMap = new Long2ObjectHashMap<() => void>();
    private readonly driverProxy: DriverProxy;
    private readonly driverAgentInvoker: AgentInvoker | null;
    private readonly counterValuesBuffer: UnsafeBuffer;
    private readonly _countersReader: CountersReader;
    private readonly publicationErrorFrame = new PublicationErrorFrame();
    private heartbeatTimestamp: AtomicCounter | null = null;
    private lastResponseValue = 0;

    // Not in Java (spec D92): the commands that wait for the look-up of a host name, and who to wake when one is done.
    private readonly pendingCommands: PendingCommand[] = [];
    private wakeUp: (() => void) | null = null;

    /** @internal package-private in Java */
    public constructor(ctx: AeronContext, aeron: Aeron) {
        this.ctx = ctx;
        this.aeron = aeron;

        this.clientLock = ctx.clientLock() as Lock;
        this.epochClock = ctx.epochClock() as EpochClock;
        this.nanoClock = ctx.nanoClock() as NanoClock;
        this.awaitingIdleStrategy = ctx.awaitingIdleStrategy() as IdleStrategy;
        this.driverProxy = ctx.driverProxy() as DriverProxy;
        this.logBuffersFactory = ctx.logBuffersFactory() as LogBuffersFactory;
        this.idleSleepDurationNs = ctx.idleSleepDurationNs();
        this.keepAliveIntervalNs = ctx.keepAliveIntervalNs();
        this.driverTimeoutMs = ctx.driverTimeoutMs();
        this.driverTimeoutNs = TimeUnit.MILLISECONDS.toNanos(this.driverTimeoutMs);
        this.interServiceTimeoutNs = ctx.interServiceTimeoutNs();
        this.defaultAvailableImageHandler = ctx.availableImageHandler();
        this.defaultUnavailableImageHandler = ctx.unavailableImageHandler();
        this.driverEventsAdapter = new DriverEventsAdapter(
            ctx.clientId(),
            ctx.toClientBuffer() as never,
            this,
            this.asyncCommandIdSet,
        );
        this.driverAgentInvoker = ctx.driverAgentInvoker();
        this.counterValuesBuffer = ctx.countersValuesBuffer() as UnsafeBuffer;
        this._countersReader = new CountersReader(
            ctx.countersMetaDataBuffer() as UnsafeBuffer,
            ctx.countersValuesBuffer() as UnsafeBuffer,
            StandardCharsets.US_ASCII,
        );

        const closeHandler = ctx.closeHandler();
        if (null !== closeHandler) {
            this.closeHandlerByIdMap.put(aeron.nextCorrelationId(), closeHandler);
        }

        const countersReader = this._countersReader;
        if (
            RECORD_ALLOCATED === countersReader.getCounterState(SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION) &&
            DRIVER_SYSTEM_COUNTER_TYPE_ID ===
                countersReader.getCounterTypeId(SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION) &&
            SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION ===
                countersReader.getCounterRegistrationId(SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION)
        ) {
            this.controlProtocolVersion =
                countersReader.getCounterValue(SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION) | 0;
        } else {
            this.controlProtocolVersion = 0;
        }

        const nowNs = this.nanoClock.nanoTime();
        this.timeOfLastKeepAliveNs = nowNs;
        this.timeOfLastServiceNs = nowNs;
    }

    public onStart(): void {}

    public onClose(): void {
        this.aeron.internalClose();

        this.clientLock.lock();
        try {
            // Java sleeps here: for the idle sleep when it is terminating, so that the threads of the application see
            // it, and for `closeLingerDurationNs` (spec D94). Nothing else runs on the one thread to wait for.
            this._isTerminating = true;
            this.pendingCommands.length = 0;
            this.forceCloseResources();
            this.notifyCloseHandlers();

            for (const lingeringLogBuffer of this.lingeringLogBuffers) {
                CloseHelper.close(this.ctx.errorHandler(), lingeringLogBuffer);
            }

            this.driverProxy.clientClose();
            this.ctx.close();
            (this.ctx.countersMetaDataBuffer() as UnsafeBuffer).wrap(new Uint8Array(0));
            (this.ctx.countersValuesBuffer() as UnsafeBuffer).wrap(new Uint8Array(0));
        } finally {
            this._isClosed = true;
            this.clientLock.unlock();
        }
    }

    public doWork(): number {
        let workCount = 0;

        if (this.clientLock.tryLock()) {
            try {
                if (this._isTerminating) {
                    throw new AgentTerminationException();
                }

                workCount = this.service(NO_CORRELATION_ID);
            } finally {
                this.clientLock.unlock();
            }
        }

        return workCount;
    }

    public roleName(): string {
        return 'aeron-client';
    }

    /**
     * Not in Java (spec D92). Called when a look-up of a host name is over, so that the runner that is idle can be woken
     * (spec D8), as {@link NativeResourceAgent.setWakeUp} does for the driver.
     *
     * @param wakeUp to call, or null for none.
     */
    public setWakeUp(wakeUp: (() => void) | null): void {
        this.wakeUp = wakeUp;
    }

    /** @internal package-private in Java */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /** @internal package-private in Java */
    public isTerminating(): boolean {
        return this._isTerminating;
    }

    /** @internal package-private in Java */
    public onError(correlationId: number, codeValue: number, errorCode: ErrorCode, message: string): void {
        this.driverException = new RegistrationException(BigInt(correlationId), codeValue, errorCode, message);

        const resource = this.resourceByRegIdMap.get(correlationId);
        if (resource instanceof Subscription) {
            resource.internalClose(NULL_VALUE);
            this.resourceByRegIdMap.remove(correlationId);
        }
    }

    /** @internal package-private in Java */
    public onAsyncError(correlationId: number, codeValue: number, errorCode: ErrorCode, message: string): void {
        this.stashedChannelByRegistrationId.remove(correlationId);
        const ex = new RegistrationException(BigInt(correlationId), codeValue, errorCode, message);
        this.asyncExceptionByRegIdMap.put(correlationId, ex);
    }

    /** @internal package-private in Java */
    public onChannelEndpointError(correlationId: number, message: string): void {
        const statusIndicatorId = correlationId | 0;

        this.resourceByRegIdMap.values().forEach((resource) => {
            if (resource instanceof Subscription) {
                if (resource.channelStatusId() === statusIndicatorId) {
                    this.handleError(new ChannelEndpointException(statusIndicatorId, message));
                }
            } else if (resource instanceof Publication) {
                if (resource.channelStatusId() === statusIndicatorId) {
                    this.handleError(new ChannelEndpointException(statusIndicatorId, message));
                }
            }
        });

        if (this.asyncCommandIdSet.remove(correlationId)) {
            this.stashedChannelByRegistrationId.remove(correlationId);
            this.handleError(
                new RegistrationException(
                    BigInt(correlationId),
                    CHANNEL_ENDPOINT_ERROR.value(),
                    CHANNEL_ENDPOINT_ERROR,
                    message,
                ),
            );
        }
    }

    /** @internal package-private in Java */
    public onPublicationError(errorFrameFlyweight: PublicationErrorFrameFlyweight): void {
        this.resourceByRegIdMap.values().forEach((resource) => {
            if (resource instanceof Publication) {
                if (resource.originalRegistrationId() === errorFrameFlyweight.registrationId()) {
                    this.publicationErrorFrame.set(errorFrameFlyweight);
                    this.ctx.publicationErrorFrameHandler().onPublicationError(this.publicationErrorFrame);
                }
            }
        });
    }

    /** @internal package-private in Java */
    public onNewPublication(
        correlationId: number,
        registrationId: number,
        streamId: number,
        sessionId: number,
        publicationLimitId: number,
        statusIndicatorId: number,
        logFileName: string,
    ): void {
        const stashedChannel = this.stashedChannelByRegistrationId.remove(correlationId) as string;
        const publication = new ConcurrentPublication(
            this,
            stashedChannel,
            streamId,
            sessionId,
            new UnsafeBufferPosition(this.counterValuesBuffer, publicationLimitId),
            statusIndicatorId,
            this.logBuffers(registrationId, logFileName, stashedChannel),
            registrationId,
            correlationId,
        );

        this.resourceByRegIdMap.put(correlationId, publication);
    }

    /** @internal package-private in Java */
    public onNewExclusivePublication(
        correlationId: number,
        registrationId: number,
        streamId: number,
        sessionId: number,
        publicationLimitId: number,
        statusIndicatorId: number,
        logFileName: string,
    ): void {
        if (correlationId !== registrationId) {
            this.handleError(
                new IllegalStateException('correlationId=' + correlationId + ' registrationId=' + registrationId),
            );
        }

        const stashedChannel = this.stashedChannelByRegistrationId.remove(correlationId) as string;
        const publication = new ExclusivePublication(
            this,
            stashedChannel,
            streamId,
            sessionId,
            new UnsafeBufferPosition(this.counterValuesBuffer, publicationLimitId),
            statusIndicatorId,
            this.logBuffers(registrationId, logFileName, stashedChannel),
            registrationId,
            correlationId,
        );

        this.resourceByRegIdMap.put(correlationId, publication);
    }

    /** @internal package-private in Java */
    public onNewSubscription(correlationId: number, statusIndicatorId: number): void {
        const resource = this.resourceByRegIdMap.get(correlationId);
        let subscription: Subscription;

        if (resource instanceof PendingSubscription) {
            subscription = resource.subscription;
            this.resourceByRegIdMap.put(correlationId, subscription);
        } else {
            subscription = resource as Subscription;
        }

        subscription.channelStatusId(statusIndicatorId);
    }

    /** @internal package-private in Java */
    public onAvailableImage(
        correlationId: number,
        sessionId: number,
        subscriptionRegistrationId: number,
        subscriberPositionId: number,
        logFileName: string,
        sourceIdentity: string,
    ): void {
        const subscription = this.resourceByRegIdMap.get(subscriptionRegistrationId) as Subscription | null;
        if (null !== subscription) {
            const image = new Image(
                subscription,
                sessionId,
                new UnsafeBufferPosition(this.counterValuesBuffer, subscriberPositionId),
                this.logBuffers(correlationId, logFileName, subscription.channel()),
                this.ctx.subscriberErrorHandler() as never,
                sourceIdentity,
                correlationId,
            );

            subscription.addImage(image);

            const handler = subscription.availableImageHandler();
            if (null !== handler) {
                this.isInCallback = true;
                try {
                    handler.onAvailableImage(image);
                } catch (ex) {
                    this.handleError(ex as Error);
                } finally {
                    this.isInCallback = false;
                }
            }
        }
    }

    /** @internal package-private in Java */
    public onUnavailableImage(correlationId: number, subscriptionRegistrationId: number): void {
        const subscription = this.resourceByRegIdMap.get(subscriptionRegistrationId) as Subscription | null;
        if (null !== subscription) {
            const image = subscription.removeImage(correlationId);
            if (null !== image) {
                const handler = subscription.unavailableImageHandler();
                if (null !== handler) {
                    this.notifyImageUnavailable(handler, image);
                }
            }
        }
    }

    /** @internal package-private in Java */
    public onClientTimeout(): void {
        if (!this._isClosed) {
            this.terminateConductor();
            this.handleError(new ClientTimeoutException('client timeout from driver'));
        }
    }

    /** @internal package-private in Java */
    public countersReader(): CountersReader {
        return this._countersReader;
    }

    /** @internal package-private in Java */
    public handleError(ex: Error): void {
        if (!this._isClosed) {
            (this.ctx.errorHandler() as { onError(error: Error): void }).onError(ex);
        }
    }

    /**
     * The next session id for a stream. The driver command for it is not ported (spec D95): a random id, as Java
     * answers for a driver that does not know the command.
     *
     * @param _streamId of the stream.
     * @return a randomised session id.
     */
    public nextSessionId(_streamId: number): number {
        return BitUtil.generateRandomisedId();
    }

    /** @internal package-private in Java */
    public addPublication(channel: string, streamId: number): ConcurrentPublication | null {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            const registrationId = this.driverProxy.addPublication(channel, streamId);
            this.stashedChannelByRegistrationId.put(registrationId, channel);
            this.awaitResponse(registrationId);

            return this.resourceByRegIdMap.get(registrationId) as ConcurrentPublication | null;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public addExclusivePublication(channel: string, streamId: number): ExclusivePublication | null {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            const registrationId = this.driverProxy.addExclusivePublication(channel, streamId);
            this.stashedChannelByRegistrationId.put(registrationId, channel);
            this.awaitResponse(registrationId);

            return this.resourceByRegIdMap.get(registrationId) as ExclusivePublication | null;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncAddPublication(channel: string, streamId: number): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const registrationId = this.sendOrQueue(channel, (id) =>
                undefined === id
                    ? this.driverProxy.addPublication(channel, streamId)
                    : this.driverProxy.addPublication(channel, streamId, id),
            );
            this.stashedChannelByRegistrationId.put(registrationId, channel);
            this.asyncCommandIdSet.add(registrationId);

            return registrationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncAddExclusivePublication(channel: string, streamId: number): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const registrationId = this.sendOrQueue(channel, (id) =>
                undefined === id
                    ? this.driverProxy.addExclusivePublication(channel, streamId)
                    : this.driverProxy.addExclusivePublication(channel, streamId, id),
            );
            this.stashedChannelByRegistrationId.put(registrationId, channel);
            this.asyncCommandIdSet.add(registrationId);

            return registrationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public getPublication(registrationId: number): ConcurrentPublication | null {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            if (this.asyncCommandIdSet.contains(registrationId)) {
                this.service(NO_CORRELATION_ID);
            }

            return this.resourceOrThrow(registrationId, ConcurrentPublication);
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public getExclusivePublication(registrationId: number): ExclusivePublication | null {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            if (this.asyncCommandIdSet.contains(registrationId)) {
                this.service(NO_CORRELATION_ID);
            }

            return this.resourceOrThrow(registrationId, ExclusivePublication);
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Remove a publication: by the publication itself (Java's `removePublication(Publication)`), or by the
     * registration id that adding it returned (`removePublication(long)`).
     *
     * @param publicationOrRegistrationId the publication, or its registration id.
     */
    public removePublication(publicationOrRegistrationId: Publication | number): void {
        if ('number' === typeof publicationOrRegistrationId) {
            this.removePublicationById(publicationOrRegistrationId);
            return;
        }

        const publication = publicationOrRegistrationId;
        this.clientLock.lock();
        try {
            if (this._isTerminating || this._isClosed) {
                return;
            }

            this.ensureNotReentrant();

            if (!publication.isClosed()) {
                publication.internalClose();

                if (publication === this.resourceByRegIdMap.remove(publication.registrationId())) {
                    this.releaseLogBuffers(
                        publication.logBuffers(),
                        publication.originalRegistrationId(),
                        EXPLICIT_CLOSE_LINGER_NS,
                    );
                    const registrationId = publication.registrationId();
                    const revoke = publication._revokeOnClose;
                    this.asyncCommandIdSet.add(
                        this.sendOrQueue(null, (id) =>
                            undefined === id
                                ? this.driverProxy.removePublication(registrationId, revoke)
                                : this.driverProxy.removePublication(registrationId, revoke, id),
                        ),
                    );
                }
            }
        } finally {
            this.clientLock.unlock();
        }
    }

    private removePublicationById(publicationRegistrationId: number): void {
        this.clientLock.lock();
        try {
            if (NULL_VALUE === publicationRegistrationId || this._isTerminating || this._isClosed) {
                return;
            }

            this.ensureNotReentrant();

            const resource = this.resourceByRegIdMap.get(publicationRegistrationId);
            if (null !== resource && !(resource instanceof Publication)) {
                throw new AeronException('registration id is not a Publication: ' + simpleName(resource));
            }

            const publication = resource as Publication | null;
            let revokeOnClose = false;
            if (null !== publication) {
                this.resourceByRegIdMap.remove(publicationRegistrationId);
                publication.internalClose();
                this.releaseLogBuffers(
                    publication.logBuffers(),
                    publication.originalRegistrationId(),
                    EXPLICIT_CLOSE_LINGER_NS,
                );
                revokeOnClose = publication._revokeOnClose;
            }

            if (this.cancelPendingCommand(publicationRegistrationId)) {
                // the add was never written, so there is nothing for the driver to remove (spec D92)
                this.asyncCommandIdSet.remove(publicationRegistrationId);
                this.stashedChannelByRegistrationId.remove(publicationRegistrationId);
                return;
            }

            if (this.asyncCommandIdSet.remove(publicationRegistrationId) || null !== publication) {
                this.asyncCommandIdSet.add(
                    this.sendOrQueue(null, (id) =>
                        undefined === id
                            ? this.driverProxy.removePublication(publicationRegistrationId, revokeOnClose)
                            : this.driverProxy.removePublication(publicationRegistrationId, revokeOnClose, id),
                    ),
                );
                this.stashedChannelByRegistrationId.remove(publicationRegistrationId);
            }
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public addSubscription(
        channel: string,
        streamId: number,
        availableImageHandler: AvailableImageHandler | null = this.defaultAvailableImageHandler,
        unavailableImageHandler: UnavailableImageHandler | null = this.defaultUnavailableImageHandler,
    ): Subscription {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            const correlationId = this.driverProxy.addSubscription(channel, streamId);
            const subscription = new Subscription(
                this,
                channel,
                streamId,
                correlationId,
                availableImageHandler,
                unavailableImageHandler,
            );

            this.resourceByRegIdMap.put(correlationId, subscription);
            this.awaitResponse(correlationId);

            return subscription;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncAddSubscription(
        channel: string,
        streamId: number,
        availableImageHandler: AvailableImageHandler | null = this.defaultAvailableImageHandler,
        unavailableImageHandler: UnavailableImageHandler | null = this.defaultUnavailableImageHandler,
    ): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const registrationId = this.sendOrQueue(channel, (id) =>
                undefined === id
                    ? this.driverProxy.addSubscription(channel, streamId)
                    : this.driverProxy.addSubscription(channel, streamId, id),
            );
            const subscription = new PendingSubscription(
                new Subscription(
                    this,
                    channel,
                    streamId,
                    registrationId,
                    availableImageHandler,
                    unavailableImageHandler,
                ),
            );

            this.resourceByRegIdMap.put(registrationId, subscription);
            this.asyncCommandIdSet.add(registrationId);

            return registrationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public getSubscription(registrationId: number): Subscription | null {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            if (this.asyncCommandIdSet.contains(registrationId)) {
                this.service(NO_CORRELATION_ID);
            }

            return this.resourceOrThrow(registrationId, Subscription);
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Remove a subscription: by the subscription itself (Java's `removeSubscription(Subscription)`), or by the
     * registration id that adding it returned (`removeSubscription(long)`).
     *
     * @param subscriptionOrRegistrationId the subscription, or its registration id.
     */
    public removeSubscription(subscriptionOrRegistrationId: Subscription | number): void {
        if ('number' === typeof subscriptionOrRegistrationId) {
            this.removeSubscriptionById(subscriptionOrRegistrationId);
            return;
        }

        const subscription = subscriptionOrRegistrationId;
        this.clientLock.lock();
        try {
            if (this._isTerminating || this._isClosed) {
                return;
            }

            this.ensureNotReentrant();

            if (!subscription.isClosed()) {
                subscription.internalClose(EXPLICIT_CLOSE_LINGER_NS);

                const registrationId = subscription.registrationId();
                if (subscription === this.resourceByRegIdMap.remove(registrationId)) {
                    this.asyncCommandIdSet.add(
                        this.sendOrQueue(null, (id) =>
                            undefined === id
                                ? this.driverProxy.removeSubscription(registrationId)
                                : this.driverProxy.removeSubscription(registrationId, id),
                        ),
                    );
                }
            }
        } finally {
            this.clientLock.unlock();
        }
    }

    private removeSubscriptionById(subscriptionRegistrationId: number): void {
        this.clientLock.lock();
        try {
            if (NULL_VALUE === subscriptionRegistrationId || this._isTerminating || this._isClosed) {
                return;
            }

            this.ensureNotReentrant();

            const resource = this.resourceByRegIdMap.get(subscriptionRegistrationId);
            if (null !== resource && !(resource instanceof PendingSubscription || resource instanceof Subscription)) {
                throw new AeronException('registration id is not a Subscription: ' + simpleName(resource));
            }

            const subscription =
                resource instanceof PendingSubscription ? resource.subscription : (resource as Subscription | null);

            if (null !== subscription) {
                this.resourceByRegIdMap.remove(subscriptionRegistrationId);
                subscription.internalClose(EXPLICIT_CLOSE_LINGER_NS);
            }

            if (this.cancelPendingCommand(subscriptionRegistrationId)) {
                // the add was never written, so there is nothing for the driver to remove (spec D92)
                this.asyncCommandIdSet.remove(subscriptionRegistrationId);
                return;
            }

            if (this.asyncCommandIdSet.remove(subscriptionRegistrationId) || null !== subscription) {
                this.asyncCommandIdSet.add(
                    this.sendOrQueue(null, (id) =>
                        undefined === id
                            ? this.driverProxy.removeSubscription(subscriptionRegistrationId)
                            : this.driverProxy.removeSubscription(subscriptionRegistrationId, id),
                    ),
                );
            }
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public addDestination(registrationId: number, endpointChannel: string): void {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            this.awaitResponse(this.driverProxy.addDestination(registrationId, endpointChannel));
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public addDestinationWithId(registrationId: number, endpointChannel: string): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            const correlationId = this.driverProxy.addDestination(registrationId, endpointChannel);
            this.awaitResponse(correlationId);

            return correlationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Remove a destination by the channel of its endpoint, or (Java's second overload) by the registration id that
     * adding it returned.
     *
     * @param registrationId of the publication.
     * @param destination    the channel of the endpoint, or the registration id of the destination.
     */
    public removeDestination(registrationId: number, destination: string | number): void {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            this.awaitResponse(this.driverProxy.removeDestination(registrationId, destination));
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public addRcvDestination(registrationId: number, endpointChannel: string): void {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            this.awaitResponse(this.driverProxy.addRcvDestination(registrationId, endpointChannel));
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public removeRcvDestination(registrationId: number, endpointChannel: string): void {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            this.awaitResponse(this.driverProxy.removeRcvDestination(registrationId, endpointChannel));
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncAddDestination(registrationId: number, endpointChannel: string): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const correlationId = this.sendOrQueue(endpointChannel, (id) =>
                undefined === id
                    ? this.driverProxy.addDestination(registrationId, endpointChannel)
                    : this.driverProxy.addDestination(registrationId, endpointChannel, id),
            );
            this.asyncCommandIdSet.add(correlationId);

            return correlationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Remove a destination without waiting for the reply, by the channel of its endpoint or by its registration id.
     *
     * @param registrationId of the publication.
     * @param destination    the channel of the endpoint, or the registration id of the destination.
     * @return the correlation id of the command.
     */
    public asyncRemoveDestination(registrationId: number, destination: string | number): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const correlationId =
                'string' === typeof destination
                    ? this.sendOrQueue(destination, (id) =>
                          undefined === id
                              ? this.driverProxy.removeDestination(registrationId, destination)
                              : this.driverProxy.removeDestination(registrationId, destination, id),
                      )
                    : this.sendOrQueue(null, (id) =>
                          undefined === id
                              ? this.driverProxy.removeDestination(registrationId, destination)
                              : this.driverProxy.removeDestination(registrationId, destination, id),
                      );
            this.asyncCommandIdSet.add(correlationId);

            return correlationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncAddRcvDestination(registrationId: number, endpointChannel: string): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const correlationId = this.sendOrQueue(endpointChannel, (id) =>
                undefined === id
                    ? this.driverProxy.addRcvDestination(registrationId, endpointChannel)
                    : this.driverProxy.addRcvDestination(registrationId, endpointChannel, id),
            );
            this.asyncCommandIdSet.add(correlationId);

            return correlationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public asyncRemoveRcvDestination(registrationId: number, endpointChannel: string): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const correlationId = this.sendOrQueue(endpointChannel, (id) =>
                undefined === id
                    ? this.driverProxy.removeRcvDestination(registrationId, endpointChannel)
                    : this.driverProxy.removeRcvDestination(registrationId, endpointChannel, id),
            );
            this.asyncCommandIdSet.add(correlationId);

            return correlationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public isCommandActive(correlationId: number): boolean {
        this.clientLock.lock();
        try {
            if (this._isClosed) {
                return false;
            }

            this.ensureActive();

            if (this.asyncCommandIdSet.contains(correlationId)) {
                this.service(NO_CORRELATION_ID);
            }

            return this.asyncCommandIdSet.contains(correlationId);
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public hasActiveCommands(): boolean {
        this.clientLock.lock();
        try {
            if (this._isClosed) {
                return false;
            }

            this.ensureActive();

            return !this.asyncCommandIdSet.isEmpty();
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Add a handler that is called when the client closes.
     *
     * @param handler to call.
     * @return the registration id to remove it with.
     */
    public addCloseHandler(handler: () => void): number {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            const registrationId = this.aeron.nextCorrelationId();
            this.closeHandlerByIdMap.put(registrationId, handler);

            return registrationId;
        } finally {
            this.clientLock.unlock();
        }
    }

    /**
     * Remove a close handler, by the registration id that adding it returned, or (Java's deprecated overload) by the
     * handler itself.
     *
     * @param registrationIdOrHandler to remove.
     * @return true if it was removed.
     */
    public removeCloseHandler(registrationIdOrHandler: number | (() => void)): boolean {
        this.clientLock.lock();
        try {
            if ('number' === typeof registrationIdOrHandler) {
                return null !== this.closeHandlerByIdMap.remove(registrationIdOrHandler);
            }

            if (this._isTerminating || this._isClosed) {
                return false;
            }

            this.ensureNotReentrant();

            const iterator = this.closeHandlerByIdMap.values().iterator();
            while (iterator.hasNext()) {
                if (registrationIdOrHandler === iterator.next()) {
                    iterator.remove();
                    return true;
                }
            }

            return false;
        } finally {
            this.clientLock.unlock();
        }
    }

    /** @internal package-private in Java */
    public releaseLogBuffers(logBuffers: LogBuffers, registrationId: number, lingerDurationNs: number): void {
        if (logBuffers.decRef() === 0) {
            this.lingeringLogBuffers.push(logBuffers);
            this.logBuffersByIdMap.remove(registrationId);

            const lingerNs = NULL_VALUE === lingerDurationNs ? this.ctx.resourceLingerDurationNs() : lingerDurationNs;
            logBuffers.lingerDeadlineNs(this.nanoClock.nanoTime() + lingerNs);
        }
    }

    /** @internal package-private in Java */
    public driverListenerAdapter(): DriverEventsAdapter {
        return this.driverEventsAdapter;
    }

    /** @internal package-private in Java */
    public channelStatus(channelStatusId: number): number {
        switch (channelStatusId) {
            case 0:
                return ChannelEndpointStatus.INITIALIZING;

            case ChannelEndpointStatus.NO_ID_ALLOCATED:
                return ChannelEndpointStatus.ACTIVE;

            default:
                return this._countersReader.getCounterValue(channelStatusId);
        }
    }

    /** @internal package-private in Java */
    public closeImages(
        images: readonly Image[],
        unavailableImageHandler: UnavailableImageHandler | null,
        lingerNs: number,
    ): void {
        for (const image of images) {
            image.close();
        }

        for (const image of images) {
            this.releaseLogBuffers(image.logBuffers(), image.correlationId(), lingerNs);
        }

        if (null !== unavailableImageHandler) {
            for (const image of images) {
                this.notifyImageUnavailable(unavailableImageHandler, image);
            }
        }
    }

    /** @internal package-private in Java */
    public rejectImage(correlationId: number, position: number, reason: string): void {
        this.clientLock.lock();
        try {
            this.ensureActive();
            this.ensureNotReentrant();

            this.flushPendingCommands();
            const registrationId = this.driverProxy.rejectImage(correlationId, position, reason);
            this.awaitResponse(registrationId);
        } finally {
            this.clientLock.unlock();
        }
    }

    private ensureActive(): void {
        if (this._isClosed) {
            throw new AeronException('Aeron client is closed');
        }

        if (this._isTerminating) {
            throw new AeronException('Aeron client is terminating');
        }
    }

    private ensureNotReentrant(): void {
        if (this.isInCallback) {
            throw new AeronException('reentrant calls not permitted during callbacks');
        }
    }

    private logBuffers(registrationId: number, logFileName: string, channel: string): LogBuffers {
        let logBuffers = this.logBuffersByIdMap.get(registrationId);
        if (null === logBuffers) {
            try {
                logBuffers = this.logBuffersFactory.map(logFileName);
                if (this.ctx.preTouchMappedMemory()) {
                    logBuffers.preTouch();
                }

                this.logBuffersByIdMap.put(registrationId, logBuffers);
            } catch (ex) {
                throw new AeronException(
                    '[clientId=' +
                        this.ctx.clientId() +
                        ', clientName=' +
                        this.ctx.clientName() +
                        '] Failed to map log buffer with registrationId=' +
                        registrationId +
                        ', channel=' +
                        channel,
                    ex as Error,
                );
            }
        }

        logBuffers.incRef();

        return logBuffers;
    }

    private service(correlationId: number): number {
        let workCount = 0;

        try {
            workCount += this.checkTimeouts(this.nanoClock.nanoTime());
            if (this.pendingCommands.length > 0) {
                workCount += this.sendPendingCommands();
            }
            workCount += this.driverEventsAdapter.receive(correlationId);
        } catch (ex) {
            if (ex instanceof AgentTerminationException) {
                if (ClientConductor.isClientApiCall(correlationId)) {
                    this.terminateConductor();
                }

                throw ex;
            }

            if (ex instanceof JavaError) {
                // Java's `catch (Exception)` does not catch an `Error`
                throw ex;
            }

            if (this.driverEventsAdapter.isInvalid()) {
                this.terminateConductor();
                if (!ClientConductor.isClientApiCall(correlationId)) {
                    throw new AeronException('Driver events adapter is invalid', ex as Error);
                }
            }

            if (ClientConductor.isClientApiCall(correlationId)) {
                throw ex;
            }

            this.handleError(ex as Error);
        }

        return workCount;
    }

    private terminateConductor(): void {
        this._isTerminating = true;
        this.forceCloseResources();
    }

    private awaitResponse(correlationId: number): void {
        const nowNs = this.nanoClock.nanoTime();
        const deadlineNs = nowNs + this.driverTimeoutNs;

        this.checkTimeouts(nowNs);

        this.awaitingIdleStrategy.reset();
        do {
            if (null === this.driverAgentInvoker) {
                // Java parks the thread here. On the one JS thread nothing else can run to give the reply: the idle
                // strategy has nothing to wait for, so the loop only checks the clock (spec D94).
                this.awaitingIdleStrategy.idle();
            } else {
                this.driverAgentInvoker.invoke();
                // this wait holds the thread: no `dns.lookup` of the driver can complete (spec D126), so a parse that
                // waits for one is answered now with the cache as it is, as the unknown host error (D102)
                this.ctx.mediaDriver()?.context().nativeResourceAgentProxy()?.failPendingLookups();
            }

            this.service(correlationId);

            if (this.driverEventsAdapter.receivedCorrelationId() === correlationId) {
                this.stashedChannelByRegistrationId.remove(correlationId);
                const ex = this.driverException;
                if (null !== ex) {
                    this.driverException = null;
                    throw ex;
                }

                return;
            }

            if (Thread.currentThread().isInterrupted()) {
                this.terminateConductor();
                throw new AeronException('unexpected interrupt');
            }
        } while (deadlineNs - this.nanoClock.nanoTime() > 0);

        throw new DriverTimeoutException(
            'no response from MediaDriver within ' + SystemUtil.formatDuration(this.driverTimeoutNs),
        );
    }

    private checkTimeouts(nowNs: number): number {
        let workCount = 0;

        if (this.timeOfLastServiceNs + this.idleSleepDurationNs - nowNs < 0) {
            this.checkServiceInterval(nowNs);
            this.timeOfLastServiceNs = nowNs;

            workCount += this.checkLiveness(nowNs);
            workCount += this.checkLingeringResources(nowNs);
        }

        return workCount;
    }

    private checkServiceInterval(nowNs: number): void {
        if (this.timeOfLastServiceNs + this.interServiceTimeoutNs - nowNs < 0) {
            this.terminateConductor();

            throw new ConductorServiceTimeoutException(
                'service interval exceeded: timeout=' +
                    SystemUtil.formatDuration(this.interServiceTimeoutNs) +
                    ', interval=' +
                    SystemUtil.formatDuration(nowNs - this.timeOfLastServiceNs),
            );
        }
    }

    private checkLiveness(nowNs: number): number {
        if (this.timeOfLastKeepAliveNs + this.keepAliveIntervalNs - nowNs < 0) {
            const nowMs = this.epochClock.time();
            const lastKeepAliveMs = this.driverProxy.timeOfLastDriverKeepaliveMs();
            if (nowMs > lastKeepAliveMs + this.driverTimeoutMs) {
                this.terminateConductor();

                if (NULL_VALUE === lastKeepAliveMs) {
                    throw new DriverTimeoutException('MediaDriver has been shutdown');
                }

                throw new DriverTimeoutException(
                    'MediaDriver keepalive: age=' +
                        (nowMs - lastKeepAliveMs) +
                        'ms > timeout=' +
                        this.driverTimeoutMs +
                        'ms',
                );
            }

            if (null === this.heartbeatTimestamp) {
                const counterId = HeartbeatTimestamp.findCounterIdByRegistrationId(
                    this._countersReader,
                    HEARTBEAT_TYPE_ID,
                    this.ctx.clientId(),
                );

                if (NULL_COUNTER_ID !== counterId) {
                    try {
                        this.heartbeatTimestamp = new AtomicCounter(this.counterValuesBuffer, counterId);
                        this.heartbeatTimestamp.setRelease(nowMs);
                        appendToLabel(
                            this._countersReader.metaDataBuffer(),
                            counterId,
                            ' name=' +
                                this.ctx.clientName() +
                                ' ' +
                                formatVersionInfo(AeronVersion.VERSION, AeronVersion.GIT_SHA),
                        );
                        this.timeOfLastKeepAliveNs = nowNs;
                    } catch (ex) {
                        // a race caused by the driver timing out the client
                        this.terminateConductor();
                        throw new AeronException(
                            'unexpected close of heartbeat timestamp counter: ' + counterId,
                            ex as Error,
                        );
                    }
                }
            } else {
                const counterId = this.heartbeatTimestamp.id();

                if (
                    !HeartbeatTimestamp.isActive(
                        this._countersReader,
                        counterId,
                        HEARTBEAT_TYPE_ID,
                        this.ctx.clientId(),
                    )
                ) {
                    this.terminateConductor();
                    throw new AeronException('unexpected close of heartbeat timestamp counter: ' + counterId);
                }

                this.heartbeatTimestamp.setRelease(nowMs);
                this.timeOfLastKeepAliveNs = nowNs;
            }

            return 1;
        }

        return 0;
    }

    private checkLingeringResources(nowNs: number): number {
        let workCount = 0;

        for (let lastIndex = this.lingeringLogBuffers.length - 1, i = lastIndex; i >= 0; i--) {
            const logBuffers = this.lingeringLogBuffers[i] as LogBuffers;

            if (logBuffers.lingerDeadlineNs() - nowNs < 0) {
                ArrayListUtil.fastUnorderedRemove(this.lingeringLogBuffers, i, lastIndex--);
                CloseHelper.close(this.ctx.errorHandler(), logBuffers);
                workCount += 1;
            }
        }

        return workCount;
    }

    private forceCloseResources(): void {
        this.resourceByRegIdMap.values().forEach((resource) => {
            if (resource instanceof Subscription) {
                resource.internalClose(NULL_VALUE);
            } else if (resource instanceof Publication) {
                resource.internalClose();
                this.releaseLogBuffers(resource.logBuffers(), resource.originalRegistrationId(), NULL_VALUE);
            }
        });

        this.resourceByRegIdMap.clear();
    }

    private notifyImageUnavailable(handler: UnavailableImageHandler, image: Image): void {
        this.isInCallback = true;
        try {
            handler.onUnavailableImage(image);
        } catch (ex) {
            if (ex instanceof AgentTerminationException || ex instanceof JavaError) {
                if (ex instanceof JavaError || !this._isTerminating) {
                    throw ex;
                }
            }

            this.handleError(ex as Error);
        } finally {
            this.isInCallback = false;
        }
    }

    private notifyCloseHandlers(): void {
        this.closeHandlerByIdMap.values().forEach((closeHandler) => {
            this.isInCallback = true;
            try {
                (closeHandler as () => void)();
            } catch (ex) {
                this.handleError(ex as Error);
            } finally {
                this.isInCallback = false;
            }
        });
    }

    private resourceOrThrow<T extends object>(
        registrationId: number,
        resourceClass: new (...args: never[]) => T,
    ): T | null {
        const resource = this.resourceByRegIdMap.get(registrationId);
        if (resource instanceof resourceClass) {
            return resource;
        }

        const ex = this.asyncExceptionByRegIdMap.remove(registrationId);
        if (null !== ex) {
            throw new RegistrationException(ex);
        }

        return null;
    }

    private static isClientApiCall(correlationId: number): boolean {
        return correlationId !== NO_CORRELATION_ID;
    }

    // Not in Java (spec D7, D92): a command with a DNS name in its channel is written to the driver after the name is in
    // the cache of the driver's resolver, which `dns.lookup` fills asynchronously.

    /**
     * Write a command to the driver now (the registration id is the one the proxy allocates, as Java does) when its
     * channel has no host name to look up and no earlier command is waiting. Otherwise allocate the registration id now,
     * start the look-ups, and queue the command: it is written, in the order the commands were made, from the duty cycle
     * of the conductor when it is at the head of the queue and its look-ups are all done. The conductor never waits for
     * them. Every command that reaches the driver through an `async` call goes through here, so that none overtakes a
     * command that is waiting (spec D92).
     *
     * @param channel to look the host names of up, or null for a command that has none.
     * @param send    writes the command: with no registration id, the proxy allocates one; with one, it uses it.
     * @return the registration id of the command.
     */
    private sendOrQueue(channel: string | null, send: (registrationId: number | undefined) => number): number {
        const hosts = null === channel ? NO_HOSTS : hostsToLookUp(channel);
        if (0 === hosts.length && 0 === this.pendingCommands.length) {
            return send(undefined);
        }

        const command: PendingCommand = {
            registrationId: this.aeron.nextCorrelationId(),
            send: (registrationId) => void send(registrationId),
            remaining: hosts.length,
        };
        this.pendingCommands.push(command);

        for (const host of hosts) {
            const done = (): void => {
                if (this._isClosed) {
                    return;
                }
                command.remaining--;
                this.wakeUp?.();
            };
            try {
                lookUpHost(host, done);
            } catch (ex) {
                // an argument that dns refuses: the name stays unresolved and the driver answers the command
                void ex;
                done();
            }
        }

        return command.registrationId;
    }

    /**
     * Write the queued commands from the head, in order, and stop at the first one that still waits for a look-up.
     *
     * @return the number of commands written.
     */
    private sendPendingCommands(): number {
        let workCount = 0;

        while (this.pendingCommands.length > 0 && (this.pendingCommands[0] as PendingCommand).remaining <= 0) {
            this.sendQueued(this.pendingCommands.shift() as PendingCommand);
            workCount++;
        }

        return workCount;
    }

    /**
     * Write every queued command now, in order, without waiting for its look-ups, before a synchronous call writes its
     * own: the call cannot wait for the event loop, so a name that is not in the cache by now is answered by the driver
     * with its unknown host error, as for a synchronous call (spec D92). The command of the call stays behind them.
     */
    private flushPendingCommands(): void {
        while (this.pendingCommands.length > 0) {
            this.sendQueued(this.pendingCommands.shift() as PendingCommand);
        }
    }

    private sendQueued(command: PendingCommand): void {
        try {
            command.send(command.registrationId);
        } catch (ex) {
            // the ring is full (or the command is too long): the command is answered with the error
            this.asyncCommandIdSet.remove(command.registrationId);
            this.stashedChannelByRegistrationId.remove(command.registrationId);
            this.resourceByRegIdMap.remove(command.registrationId);
            this.asyncExceptionByRegIdMap.put(
                command.registrationId,
                new RegistrationException(
                    BigInt(command.registrationId),
                    GENERIC_ERROR.value(),
                    GENERIC_ERROR,
                    (ex as Error).message,
                ),
            );
            this.handleError(ex as Error);
        }
    }

    private cancelPendingCommand(registrationId: number): boolean {
        for (let i = 0, length = this.pendingCommands.length; i < length; i++) {
            if ((this.pendingCommands[i] as PendingCommand).registrationId === registrationId) {
                this.pendingCommands.splice(i, 1);
                return true;
            }
        }

        return false;
    }
}

type PendingSubscriptionType = PendingSubscription;

// Declaration merging: `ClientConductor.PendingSubscription` is a type as well as a value, as the nested Java class is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ClientConductor {
    export type PendingSubscription = PendingSubscriptionType;
}
