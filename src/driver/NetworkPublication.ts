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
// Port of io/aeron/driver/NetworkPublication.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import { ArrayListUtil } from '../agrona/collections/ArrayListUtil.js';
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import type { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { Position } from '../agrona/concurrent/status/Position.js';
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import { Aeron } from '../client/Aeron.js';
import { CommonContext } from '../client/CommonContext.js';
import { FrameDescriptor } from '../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { LogBufferUnblocker } from '../client/logbuffer/LogBufferUnblocker.js';
import { TermScanner } from '../client/logbuffer/TermScanner.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import type { ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import type { NakFlyweight } from '../client/protocol/NakFlyweight.js';
import { RttMeasurementFlyweight } from '../client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { Configuration } from './Configuration.js';
import type { DriverConductor } from './DriverConductor.js';
import type { DriverManagedResource } from './DriverManagedResource.js';
import type { FlowControl } from './FlowControl.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { MediaDriverContext } from './MediaDriver.js';
import type { NetworkPublicationThreadLocals } from './NetworkPublicationThreadLocals.js';
import type { PublicationParams } from './PublicationParams.js';
import { ReceiverLivenessTracker } from './ReceiverLivenessTracker.js';
import type { RetransmitHandler } from './RetransmitHandler.js';
import type { RetransmitSender } from './RetransmitSender.js';
import type { Subscribable } from './Subscribable.js';
import type { SubscriptionLink } from './SubscriptionLink.js';
import { UntetheredSubscription } from './UntetheredSubscription.js';
import type { RawLog } from './buffer/RawLog.js';
import type { DriverConductorProxy } from './DriverConductorProxy.js';
import type { SendChannelEndpoint } from './media/SendChannelEndpoint.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import type { SystemCounters } from './status/SystemCounters.js';

const { PUBLICATION_HEARTBEAT_TIMEOUT_NS, PUBLICATION_SETUP_TIMEOUT_NS } = Configuration;
const {
    HEARTBEATS_SENT,
    RETRANSMITS_SENT,
    RETRANSMITTED_BYTES,
    SENDER_FLOW_CONTROL_LIMITS,
    SHORT_SENDS,
    UNBLOCKED_PUBLICATIONS,
    PUBLICATIONS_REVOKED,
} = SystemCounterDescriptor;
const {
    activeTermCount,
    computePosition,
    computeTermIdFromPosition,
    endOfStreamPosition,
    indexByPosition,
    indexByTermCount,
    TERM_TAIL_COUNTERS_OFFSET,
} = LogBufferDescriptor;
const { available, padding, scanForAvailability } = TermScanner;
const { BEGIN_AND_END_FLAGS, BEGIN_END_AND_EOS_FLAGS, BEGIN_END_EOS_AND_REVOKED_FLAGS } = DataHeaderFlyweight;
const { END_OF_STREAM_FLAG } = StatusMessageFlyweight;
const { SIZE_OF_LONG } = BitUtil;

// Java's nested `NetworkPublication.State` enum: the ordinals of the constants, as numbers so that a state is an `int`.
const State = {
    ACTIVE: 0,
    DRAINING: 1,
    LINGER: 2,
    DONE: 3,
} as const;

const EMPTY_POSITIONS: ReadablePosition[] = [];

/**
 * Publication to be sent to connected subscribers.
 * <p>
 * The cache line padding classes of Java (`NetworkPublicationPadding1` to `3`) separate the fields of the conductor
 * from those of the sender, which are two threads. Here the agents share one thread (spec D3), so the fields are
 * declared in one class. The fields that are `volatile` in Java are plain: no other thread reads them (D3, D19).
 */
export class NetworkPublication implements RetransmitSender, DriverManagedResource, Subscribable {
    public static readonly State = State;

    // conductor fields
    public cleanPosition: number = 0;
    public timeOfLastActivityNs: number = 0;
    public lastSenderPosition: number = 0;
    public refCount = 0;
    public spyPositions: ReadablePosition[] = EMPTY_POSITIONS;
    public maxSpyPosition = 0;
    private readonly untetheredSubscriptions: UntetheredSubscription[] = [];

    // sender fields
    private timeOfLastDataOrHeartbeatNs: number = 0;
    private timeOfLastSetupNs: number = 0;
    private _timeOfLastStatusMessageNs = 0;
    private timeOfLastUpdateReceivers = 0;
    private trackSenderLimits = false;
    private isSetupElicited = false;
    private hasInitialConnection = false;
    private endpointAddress: InetSocketAddress | null = null;

    private readonly _registrationId: number = 0;
    private readonly unblockTimeoutNs: number = 0;
    private readonly connectionTimeoutNs: number = 0;
    private readonly lingerTimeoutNs: number = 0;
    private readonly untetheredWindowLimitTimeoutNs: number = 0;
    private readonly untetheredLingerTimeoutNs: number = 0;
    private readonly untetheredRestingTimeoutNs: number = 0;
    private readonly _tag: number = 0;
    private readonly _responseCorrelationId: number = 0;
    private readonly positionBitsToShift: number = 0;
    private readonly _initialTermId: number = 0;
    private readonly _startingTermId: number = 0;
    private readonly _startingTermOffset: number = 0;
    private readonly _termBufferLength: number = 0;
    private readonly termLengthMask: number = 0;
    private readonly _mtuLength: number = 0;
    private readonly termWindowLength: number = 0;
    private readonly _sessionId: number = 0;
    private readonly _streamId: number = 0;
    private readonly _isExclusive: boolean;
    private readonly signalEos: boolean;
    private readonly isResponse: boolean;
    private readonly _spiesSimulateConnection: boolean;
    private _hasSpies = false;
    private hasReceivers = false;
    private isConnected = false;
    private isEndOfStream = false;
    private hasSenderReleased = false;
    private hasReceivedUnicastEos = false;
    private _state: number = State.ACTIVE;

    private readonly flowControl: FlowControl;
    private readonly termBuffers: UnsafeBuffer[];
    private readonly errorHandler: ErrorHandler | null;
    private readonly publisherPos: Position;
    private readonly publisherLimit: Position;
    private readonly senderPosition: Position;
    private readonly senderLimit: Position;
    private readonly _channelEndpoint: SendChannelEndpoint;
    private readonly heartbeatBuffer: UnsafeBuffer;
    private readonly heartbeatDataHeader: DataHeaderFlyweight;
    private readonly setupBuffer: UnsafeBuffer;
    private readonly setupHeader: SetupFlyweight;
    private readonly rttMeasurementBuffer: UnsafeBuffer;
    private readonly rttMeasurementHeader: RttMeasurementFlyweight;
    private readonly cachedNanoClock: CachedNanoClock;
    private readonly retransmitHandler: RetransmitHandler;
    private readonly metaDataBuffer: UnsafeBuffer;
    private readonly _rawLog: RawLog;
    private readonly heartbeatsSent: AtomicCounter;
    private readonly retransmitsSent: AtomicCounter;
    private readonly retransmittedBytes: AtomicCounter;
    private readonly senderFlowControlLimits: AtomicCounter;
    private readonly senderBpe: AtomicCounter;
    private readonly senderNaksReceived: AtomicCounter;
    private readonly shortSends: AtomicCounter;
    private readonly unblockedPublications: AtomicCounter;
    private readonly publicationsRevoked: AtomicCounter;
    private readonly livenessTracker = new ReceiverLivenessTracker();
    // scratch of producerPosition: the two halves of the raw tail (offset in [0], term id in [1], spec D12)
    private readonly rawTailHalves = new Int32Array(2);

    public constructor(
        registrationId: number,
        ctx: MediaDriverContext,
        params: PublicationParams,
        channelEndpoint: SendChannelEndpoint,
        rawLog: RawLog,
        termWindowLength: number,
        publisherPos: Position,
        publisherLimit: Position,
        senderPosition: Position,
        senderLimit: Position,
        senderBpe: AtomicCounter,
        senderNaksReceived: AtomicCounter,
        sessionId: number,
        streamId: number,
        initialTermId: number,
        flowControl: FlowControl,
        retransmitHandler: RetransmitHandler,
        threadLocals: NetworkPublicationThreadLocals,
        isExclusive: boolean,
    ) {
        this._registrationId = registrationId;
        this.unblockTimeoutNs = ctx.publicationUnblockTimeoutNs();
        this.connectionTimeoutNs = ctx.publicationConnectionTimeoutNs();
        this.lingerTimeoutNs = params.lingerTimeoutNs;
        this.untetheredWindowLimitTimeoutNs = params.untetheredWindowLimitTimeoutNs;
        this.untetheredLingerTimeoutNs = params.untetheredLingerTimeoutNs;
        this.untetheredRestingTimeoutNs = params.untetheredRestingTimeoutNs;
        this._tag = params.entityTag;
        this._channelEndpoint = channelEndpoint;
        this._rawLog = rawLog;
        this.cachedNanoClock = ctx.senderCachedNanoClock() as CachedNanoClock;
        this.senderPosition = senderPosition;
        this.senderLimit = senderLimit;
        this.senderNaksReceived = senderNaksReceived;
        this.flowControl = flowControl;
        this.retransmitHandler = retransmitHandler;
        this.publisherPos = publisherPos;
        this.publisherLimit = publisherLimit;
        this._mtuLength = params.mtuLength;
        this._initialTermId = initialTermId;
        this._sessionId = sessionId;
        this._streamId = streamId;
        this._spiesSimulateConnection = params.spiesSimulateConnection;
        this.signalEos = params.signalEos;
        this._isExclusive = isExclusive;
        this._startingTermId = params.termId;
        this._startingTermOffset = params.termOffset;
        this.isResponse = params.isResponse;
        this._responseCorrelationId = params.responseCorrelationId;

        this.metaDataBuffer = rawLog.metaData();
        this.setupBuffer = threadLocals.setupBuffer();
        this.setupHeader = threadLocals.setupHeader();
        this.heartbeatBuffer = threadLocals.heartbeatBuffer();
        this.heartbeatDataHeader = threadLocals.heartbeatDataHeader();
        this.rttMeasurementBuffer = threadLocals.rttMeasurementBuffer();
        this.rttMeasurementHeader = threadLocals.rttMeasurementHeader();

        const systemCounters = ctx.systemCounters() as SystemCounters;
        this.heartbeatsSent = systemCounters.get(HEARTBEATS_SENT);
        this.shortSends = systemCounters.get(SHORT_SENDS);
        this.retransmitsSent = systemCounters.get(RETRANSMITS_SENT);
        this.retransmittedBytes = systemCounters.get(RETRANSMITTED_BYTES);
        this.senderFlowControlLimits = systemCounters.get(SENDER_FLOW_CONTROL_LIMITS);
        this.unblockedPublications = systemCounters.get(UNBLOCKED_PUBLICATIONS);
        this.publicationsRevoked = systemCounters.get(PUBLICATIONS_REVOKED);
        this.senderBpe = senderBpe;

        this.termBuffers = rawLog.termBuffers();
        for (const termBuffer of this.termBuffers) {
            termBuffer.verifyAlignment();
        }

        // sendBuffers = rawLog.sliceTerms(): the sender sends from the term buffers (spec D9, D32)
        this.errorHandler = ctx.countedErrorHandler();

        const termLength = rawLog.termLength();
        this._termBufferLength = termLength;
        this.termLengthMask = termLength - 1;

        const nowNs = this.cachedNanoClock.nanoTime();
        this.timeOfLastDataOrHeartbeatNs = nowNs - PUBLICATION_HEARTBEAT_TIMEOUT_NS - 1;
        this.timeOfLastSetupNs = nowNs - PUBLICATION_SETUP_TIMEOUT_NS - 1;

        this.positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        this.termWindowLength = termWindowLength;

        this.lastSenderPosition = senderPosition.get();
        this.cleanPosition = this.lastSenderPosition;
        this.timeOfLastActivityNs = nowNs;
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {
        const errorHandler = this.errorHandler;
        CloseHelper.close(errorHandler, this.publisherPos);
        CloseHelper.close(errorHandler, this.publisherLimit);
        CloseHelper.close(errorHandler, this.senderPosition);
        CloseHelper.close(errorHandler, this.senderLimit);
        CloseHelper.close(errorHandler, this.senderBpe);
        CloseHelper.close(errorHandler, this.senderNaksReceived);
        CloseHelper.closeAll(errorHandler, this.spyPositions);

        for (const untetheredSubscription of this.untetheredSubscriptions) {
            if (UntetheredSubscription.State.RESTING === untetheredSubscription.state()) {
                CloseHelper.close(errorHandler, untetheredSubscription.position);
            }
        }

        CloseHelper.close(this.flowControl);
    }

    /**
     * Time of the last status message a from a receiver.
     *
     * @return this of the last status message a from a receiver.
     */
    public timeOfLastStatusMessageNs(): number {
        return this._timeOfLastStatusMessageNs;
    }

    /**
     * Channel URI string for this publication.
     *
     * @return channel URI string for this publication.
     */
    public channel(): string {
        return this._channelEndpoint.originalUriString();
    }

    /**
     * Session id allocated to this stream.
     *
     * @return session id allocated to this stream.
     */
    public sessionId(): number {
        return this._sessionId;
    }

    /**
     * Stream id within the channel.
     *
     * @return stream id within the channel.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Term buffer length.
     *
     * @return term buffer length.
     */
    public termBufferLength(): number {
        return this._termBufferLength;
    }

    /**
     * Trigger the sending of a SETUP frame so a connection can be established.
     *
     * @param msg        that triggers the SETUP.
     * @param srcAddress of the source that triggers the SETUP.
     */
    public triggerSendSetupFrame(msg: StatusMessageFlyweight, srcAddress: InetSocketAddress): void {
        if (!this.isEndOfStream) {
            this._timeOfLastStatusMessageNs = this.cachedNanoClock.nanoTime();
            this.isSetupElicited = true;
            this.flowControl.onTriggerSendSetup(msg, srcAddress, this._timeOfLastStatusMessageNs);

            if (this.isResponse) {
                this.endpointAddress = srcAddress;
            }
        }
    }

    /**
     * Registration ID that is in use by the subscribable (`Subscribable.subscribableRegistrationId`).
     *
     * @return registration ID for subscribable.
     */
    public subscribableRegistrationId(): number {
        return this._registrationId;
    }

    /**
     * {@inheritDoc}
     */
    public addSubscriber(subscriptionLink: SubscriptionLink, position: ReadablePosition, nowNs: number): void {
        this.addSpyPosition(position);

        if (!subscriptionLink.isTether()) {
            this.untetheredSubscriptions.push(new UntetheredSubscription(subscriptionLink, position, nowNs));
        }

        if (this._spiesSimulateConnection) {
            this.updateConnectedState(true);
        }
    }

    /**
     * {@inheritDoc}
     */
    public removeSubscriber(subscriptionLink: SubscriptionLink, position: ReadablePosition): void {
        this.removeSpyPosition(position);
        position.close();

        if (!subscriptionLink.isTether()) {
            const untetheredSubscriptions = this.untetheredSubscriptions;
            for (let lastIndex = untetheredSubscriptions.length - 1, i = lastIndex; i >= 0; i--) {
                if ((untetheredSubscriptions[i] as UntetheredSubscription).subscriptionLink === subscriptionLink) {
                    ArrayListUtil.fastUnorderedRemove(untetheredSubscriptions, i, lastIndex);
                    break;
                }
            }
        }

        if (this._spiesSimulateConnection) {
            this.updateConnectedState(this.hasSubscribers());
        }
    }

    /**
     * Process a NAK message so a retransmit can occur.
     *
     * @param msg flyweight over the network packet.
     */
    public onNak(msg: NakFlyweight): void {
        this.senderNaksReceived.incrementRelease();
        this.retransmitHandler.onNak(
            msg.termId(),
            msg.termOffset(),
            msg.length(),
            this._termBufferLength,
            this._mtuLength,
            this.flowControl,
            this,
        );
    }

    /**
     * Process a status message to track connectivity and apply flow control.
     *
     * @param msg            flyweight over the network packet.
     * @param srcAddress     that the setup message has come from.
     * @param conductorProxy to send messages back to the conductor.
     */
    public onStatusMessage(
        msg: StatusMessageFlyweight,
        srcAddress: InetSocketAddress,
        conductorProxy: DriverConductorProxy,
    ): void {
        const isEos = END_OF_STREAM_FLAG === (msg.flags() & END_OF_STREAM_FLAG);
        const timeNs = this.cachedNanoClock.nanoTime();

        if (isEos) {
            this.livenessTracker.onRemoteClose(msg.receiverIdHigh(), msg.receiverIdLow());

            const udpChannel = this._channelEndpoint.udpChannel();
            if (!udpChannel.isMulticast() && !udpChannel.isMultiDestination()) {
                this.hasReceivedUnicastEos = true;
            }
        } else {
            this.livenessTracker.onStatusMessage(msg.receiverIdHigh(), msg.receiverIdLow(), timeNs);
        }

        const isLive = this.livenessTracker.hasReceivers();
        const existingHasReceivers = this.hasReceivers;

        if (!existingHasReceivers && isLive) {
            conductorProxy.responseConnected(this._responseCorrelationId);
        }

        if (existingHasReceivers !== isLive) {
            this.hasReceivers = isLive;
        }

        if (!this.hasInitialConnection) {
            this.hasInitialConnection = true;
        }

        this._timeOfLastStatusMessageNs = timeNs;

        this.senderLimit.setRelease(
            this.flowControl.onStatusMessage(
                msg,
                srcAddress,
                this.senderLimit.get(),
                this._initialTermId,
                this.positionBitsToShift,
                timeNs,
            ),
        );

        this.updateConnectedState(this.hasSubscribers());
    }

    /**
     * Check if the SM should be accepted or not.
     * <p>
     * A position outside +/-(2^53 - 1) (spec D5) cannot be in the window around the sender position, which is the
     * answer Java's `long` arithmetic gives for it: the SM is not accepted. {@link computePosition} throws for it, so
     * a status message from the network cannot throw out of the duty cycle (spec D36).
     *
     * @param msg SM to check.
     * @return {@code true} if the SM is accepted.
     */
    public isValidStatusMessage(msg: StatusMessageFlyweight): boolean {
        let smPos: number;
        try {
            smPos = computePosition(
                msg.consumptionTermId(),
                msg.consumptionTermOffset(),
                this.positionBitsToShift,
                this._initialTermId,
            );
        } catch (ex) {
            if (ex instanceof RangeError) {
                return false;
            }
            throw ex;
        }

        const sndPos = this.senderPosition.get();
        const halfTerm = this._termBufferLength >> 1;
        return smPos >= sndPos - halfTerm && smPos <= sndPos + this._termBufferLength + halfTerm;
    }

    /**
     * Process an error message from a receiver.
     *
     * @param msg                       flyweight over the network packet.
     * @param srcAddress                that the setup message has come from.
     * @param destinationRegistrationId registrationId of the relevant MDC destination or {@link Aeron.NULL_VALUE}
     * @param conductorProxy            to send messages back to the conductor.
     */
    public onError(
        msg: ErrorFlyweight,
        srcAddress: InetSocketAddress,
        destinationRegistrationId: number,
        conductorProxy: DriverConductorProxy,
    ): void {
        this.flowControl.onError(msg, srcAddress, this.cachedNanoClock.nanoTime());
        if (this.livenessTracker.onRemoteClose(msg.receiverIdHigh(), msg.receiverIdLow())) {
            conductorProxy.onPublicationError(
                this._registrationId,
                destinationRegistrationId,
                msg.sessionId(),
                msg.streamId(),
                msg.receiverId(),
                msg.groupTag(),
                srcAddress,
                msg.errorCode(),
                msg.errorMessage(),
            );
        }
    }

    /**
     * Process RTT (Round Trip Timing) message from a receiver.
     *
     * @param msg        flyweight over the network packet.
     * @param srcAddress that the RTT message has come from.
     */
    public onRttMeasurement(msg: RttMeasurementFlyweight, _srcAddress: InetSocketAddress): void {
        if (RttMeasurementFlyweight.REPLY_FLAG === (msg.flags() & RttMeasurementFlyweight.REPLY_FLAG)) {
            // rttMeasurementBuffer.clear(): the window is the whole frame
            this.rttMeasurementHeader
                .receiverIdHigh(msg.receiverIdHigh())
                .receiverIdLow(msg.receiverIdLow())
                .echoTimestampNs(msg.echoTimestampNs())
                .receptionDelta(0n)
                .sessionId(this._sessionId)
                .streamId(this._streamId)
                .flags(0x0);

            const bytesSent = this.doSend(this.rttMeasurementBuffer, 0, RttMeasurementFlyweight.HEADER_LENGTH);
            if (RttMeasurementFlyweight.HEADER_LENGTH !== bytesSent) {
                this.shortSends.increment();
            }
        }

        // handling of RTT measurements would be done in an else clause here.
    }

    private doSend(buffer: UnsafeBuffer, offset: number, length: number): number {
        if (this.isResponse) {
            if (null !== this.endpointAddress) {
                return this._channelEndpoint.sendTo(buffer, offset, length, this.endpointAddress);
            } else {
                return 0;
            }
        } else {
            return this._channelEndpoint.send(buffer, offset, length);
        }
    }

    /**
     * {@inheritDoc}
     * <p>
     * A resend position outside +/-(2^53 - 1) (spec D5) is outside the window, as Java's `long` arithmetic finds it: the
     * NAK is ignored and {@link computePosition} cannot throw out of the duty cycle for a NAK from the network (spec
     * D36).
     */
    public resend(termId: number, termOffset: number, length: number): void {
        this._channelEndpoint.resendHook(this._sessionId, this._streamId, termId, termOffset, length);

        const senderPosition = this.senderPosition.get();
        let resendPosition: number;
        try {
            resendPosition = computePosition(termId, termOffset, this.positionBitsToShift, this._initialTermId);
        } catch (ex) {
            if (ex instanceof RangeError) {
                return;
            }
            throw ex;
        }
        const bottomResendWindow =
            senderPosition -
            (this._termBufferLength >> 1) -
            FrameDescriptor.computeMaxMessageLength(this._termBufferLength);

        if (bottomResendWindow <= resendPosition && resendPosition < senderPosition) {
            const activeIndex = indexByPosition(resendPosition, this.positionBitsToShift);
            const termBuffer = this.termBuffers[activeIndex] as UnsafeBuffer;

            let remainingBytes = length;
            let totalBytesSent = 0;
            let bytesSent = 0;
            let offset = termOffset;
            do {
                offset += bytesSent;

                const scanOutcome = scanForAvailability(termBuffer, offset, Math.min(this._mtuLength, remainingBytes));
                const availableBytes = available(scanOutcome);
                if (availableBytes <= 0) {
                    break;
                }

                if (availableBytes !== this.doSend(termBuffer, offset, availableBytes)) {
                    this.shortSends.increment();
                    break;
                }

                bytesSent = availableBytes + padding(scanOutcome);
                remainingBytes -= bytesSent;
                totalBytesSent += bytesSent;
            } while (remainingBytes > 0);

            if (totalBytesSent > 0) {
                this.retransmitsSent.incrementRelease();
                this.retransmittedBytes.getAndAddRelease(totalBytesSent);
            }
        }
    }

    /**
     * @internal package-private in Java
     */
    public send(nowNs: number): number {
        const senderPosition = this.senderPosition.get();
        const activeTermId = computeTermIdFromPosition(senderPosition, this.positionBitsToShift, this._initialTermId);
        const termOffset = (senderPosition | 0) & this.termLengthMask;

        if (!this.hasInitialConnection || this.isSetupElicited) {
            this.setupMessageCheck(nowNs, activeTermId, termOffset);
        }

        let bytesSent = this.sendData(nowNs, senderPosition, termOffset);

        if (0 === bytesSent) {
            bytesSent = this.heartbeatMessageCheck(nowNs, activeTermId, termOffset);

            if (this._spiesSimulateConnection && this._hasSpies && !this.hasReceivers) {
                const newSenderPosition = Math.max(this.maxSpyPosition, senderPosition);
                this.senderPosition.setRelease(newSenderPosition);
                this.senderLimit.setRelease(
                    this.flowControl.onIdle(nowNs, newSenderPosition, newSenderPosition, this.isEndOfStream),
                );
            } else {
                this.senderLimit.setRelease(
                    this.flowControl.onIdle(nowNs, this.senderLimit.get(), senderPosition, this.isEndOfStream),
                );
            }

            this.updateHasReceivers(nowNs);
        }

        this.retransmitHandler.processTimeouts(nowNs, this);

        return bytesSent;
    }

    /**
     * @internal package-private in Java
     */
    public channelEndpoint(): SendChannelEndpoint {
        return this._channelEndpoint;
    }

    /**
     * @internal package-private in Java
     */
    public rawLog(): RawLog {
        return this._rawLog;
    }

    /**
     * @internal package-private in Java
     */
    public publisherLimitId(): number {
        return this.publisherLimit.id();
    }

    /**
     * @internal package-private in Java
     */
    public tag(): number {
        return this._tag;
    }

    /**
     * @internal package-private in Java
     */
    public mtuLength(): number {
        return this._mtuLength;
    }

    /**
     * @internal package-private in Java
     */
    public registrationId(): number {
        return this._registrationId;
    }

    /**
     * @internal package-private in Java
     */
    public isExclusive(): boolean {
        return this._isExclusive;
    }

    /**
     * @internal package-private in Java
     */
    public spiesSimulateConnection(): boolean {
        return this._spiesSimulateConnection;
    }

    /**
     * @internal package-private in Java
     */
    public initialTermId(): number {
        return this._initialTermId;
    }

    /**
     * @internal package-private in Java
     */
    public startingTermId(): number {
        return this._startingTermId;
    }

    /**
     * @internal package-private in Java
     */
    public startingTermOffset(): number {
        return this._startingTermOffset;
    }

    /**
     * @internal package-private in Java
     */
    public isAcceptingSubscriptions(): boolean {
        return (
            State.ACTIVE === this._state ||
            (State.DRAINING === this._state &&
                this._hasSpies &&
                this.producerPosition() > this.senderPosition.getVolatile())
        );
    }

    /**
     * Update the publisher position and limit for flow control as part of the conductor duty cycle.
     *
     * @return 1 if the limit has been updated otherwise 0.
     * @internal package-private in Java
     */
    public updatePublisherPositionAndLimit(): number {
        let workCount = 0;

        if (State.ACTIVE === this._state) {
            const producerPosition = this.producerPosition();
            const senderPosition = this.senderPosition.getVolatile();

            this.publisherPos.setRelease(producerPosition);

            if (this.hasSubscribers()) {
                let minConsumerPosition = senderPosition;
                const spyPositions = this.spyPositions;
                if (spyPositions.length > 0) {
                    let maxConsumerPosition = senderPosition;
                    for (const spyPosition of spyPositions) {
                        const position = spyPosition.getAcquire();
                        minConsumerPosition = Math.min(minConsumerPosition, position);
                        maxConsumerPosition = Math.max(maxConsumerPosition, position);
                    }
                    if (maxConsumerPosition > this.maxSpyPosition) {
                        this.maxSpyPosition = maxConsumerPosition;
                    }
                }

                const newLimitPosition = minConsumerPosition + this.termWindowLength;
                if (newLimitPosition > this.publisherLimit.get()) {
                    this.cleanBufferTo(minConsumerPosition - this._termBufferLength);
                    const cleanPosition = this.cleanPosition;
                    const dirtyTermId = computeTermIdFromPosition(
                        cleanPosition,
                        this.positionBitsToShift,
                        this._initialTermId,
                    );
                    const activeTermId = computeTermIdFromPosition(
                        newLimitPosition,
                        this.positionBitsToShift,
                        this._initialTermId,
                    );
                    const termGap = (activeTermId - dirtyTermId) | 0;
                    if (termGap < 2 || (2 === termGap && 0 !== ((cleanPosition | 0) & this.termLengthMask))) {
                        this.publisherLimit.setRelease(newLimitPosition);
                    }
                    workCount = 1;
                }
            } else if (this.publisherLimit.get() > senderPosition) {
                this.updateConnectedState(false);
                this.publisherLimit.setRelease(senderPosition);
                this.cleanBufferTo(senderPosition - this._termBufferLength);
                workCount = 1;
            }
        }

        return workCount;
    }

    /**
     * @internal package-private in Java
     */
    public hasSpies(): boolean {
        return this._hasSpies;
    }

    /**
     * @internal package-private in Java
     */
    public updateHasReceivers(timeNs: number): void {
        this.livenessTracker.onIdle(timeNs, this.connectionTimeoutNs);
        const isLive = this.livenessTracker.hasReceivers();

        if (this.hasReceivers !== isLive) {
            this.hasReceivers = isLive;
        }

        this.timeOfLastUpdateReceivers = timeNs;
    }

    private sendData(nowNs: number, senderPosition: number, termOffset: number): number {
        let bytesSent = 0;
        const availableWindow = this.senderLimit.get() - senderPosition;
        if (availableWindow > 0) {
            const scanLimit = Math.min(availableWindow, this._mtuLength) | 0;
            const activeIndex = indexByPosition(senderPosition, this.positionBitsToShift);

            const termBuffer = this.termBuffers[activeIndex] as UnsafeBuffer;
            const scanOutcome = scanForAvailability(termBuffer, termOffset, scanLimit);
            const availableBytes = available(scanOutcome);
            if (availableBytes > 0) {
                if (availableBytes === this.doSend(termBuffer, termOffset, availableBytes)) {
                    this.timeOfLastDataOrHeartbeatNs = nowNs;
                    this.trackSenderLimits = true;

                    bytesSent = availableBytes + padding(scanOutcome);
                    this.senderPosition.setRelease(senderPosition + bytesSent);
                } else {
                    this.shortSends.increment();
                }
            } else if (availableBytes < 0) {
                if (this.trackSenderLimits) {
                    this.trackSenderLimits = false;
                    this.senderBpe.incrementRelease();
                    this.senderFlowControlLimits.incrementRelease();
                }
            }
        } else if (this.trackSenderLimits) {
            this.trackSenderLimits = false;
            this.senderBpe.incrementRelease();
            this.senderFlowControlLimits.incrementRelease();
        }

        return bytesSent;
    }

    private setupMessageCheck(nowNs: number, activeTermId: number, termOffset: number): void {
        if (this.timeOfLastSetupNs + PUBLICATION_SETUP_TIMEOUT_NS - nowNs < 0) {
            this.timeOfLastSetupNs = nowNs;

            const flags =
                (this.isSendResponseSetupFlag() ? SetupFlyweight.SEND_RESPONSE_SETUP_FLAG : 0) |
                (this.hasGroupSemantics() ? SetupFlyweight.GROUP_FLAG : 0);

            // setupBuffer.clear(): the window is the whole frame
            this.setupHeader
                .activeTermId(activeTermId)
                .termOffset(termOffset)
                .sessionId(this._sessionId)
                .streamId(this._streamId)
                .initialTermId(this._initialTermId)
                .termLength(this._termBufferLength)
                .mtuLength(this._mtuLength)
                .ttl(this._channelEndpoint.multicastTtl())
                .flags(flags & 0xffff);

            if (this.isSetupElicited) {
                this.flowControl.onSetup(
                    this.setupHeader,
                    this.senderLimit.get(),
                    this.senderPosition.get(),
                    this.positionBitsToShift,
                    nowNs,
                );
            }

            if (SetupFlyweight.HEADER_LENGTH !== this.doSend(this.setupBuffer, 0, SetupFlyweight.HEADER_LENGTH)) {
                this.shortSends.increment();
            }

            if (this.isSetupElicited && this.hasReceivers) {
                this.isSetupElicited = false;
            }
        }
    }

    private heartbeatMessageCheck(nowNs: number, activeTermId: number, termOffset: number): number {
        let bytesSent = 0;

        if (
            this.hasInitialConnection &&
            this.timeOfLastDataOrHeartbeatNs + PUBLICATION_HEARTBEAT_TIMEOUT_NS - nowNs < 0
        ) {
            let flags: number;

            if (LogBufferDescriptor.isPublicationRevoked(this.metaDataBuffer)) {
                flags = BEGIN_END_EOS_AND_REVOKED_FLAGS;
            } else if (this.signalEos && this.isEndOfStream) {
                flags = BEGIN_END_AND_EOS_FLAGS;
            } else {
                flags = BEGIN_AND_END_FLAGS;
            }

            // heartbeatBuffer.clear(): the window is the whole frame
            this.heartbeatDataHeader
                .sessionId(this._sessionId)
                .streamId(this._streamId)
                .termId(activeTermId)
                .termOffset(termOffset)
                .flags(flags);

            bytesSent = this.doSend(this.heartbeatBuffer, 0, DataHeaderFlyweight.HEADER_LENGTH);
            if (DataHeaderFlyweight.HEADER_LENGTH !== bytesSent) {
                this.shortSends.increment();
            }

            this.timeOfLastDataOrHeartbeatNs = nowNs;
            this.heartbeatsSent.incrementRelease();
        }

        return bytesSent;
    }

    private cleanBufferTo(position: number): void {
        const cleanPosition = this.cleanPosition;
        if (position > cleanPosition) {
            const dirtyTermBuffer = this.termBuffers[
                indexByPosition(cleanPosition, this.positionBitsToShift)
            ] as UnsafeBuffer;
            const bytesForCleaning = (position - cleanPosition) | 0;
            const termOffset = (cleanPosition | 0) & this.termLengthMask;
            const length = Math.min(bytesForCleaning, this._termBufferLength - termOffset);

            dirtyTermBuffer.setMemory(termOffset + SIZE_OF_LONG, length - SIZE_OF_LONG, 0);
            dirtyTermBuffer.putLongRelease(termOffset, 0);
            this.cleanPosition = cleanPosition + length;
        }
    }

    private checkForBlockedPublisher(producerPosition: number, senderPosition: number, nowNs: number): void {
        if (senderPosition === this.lastSenderPosition && this.isPossiblyBlocked(producerPosition, senderPosition)) {
            if (this.timeOfLastActivityNs + this.unblockTimeoutNs - nowNs < 0) {
                if (
                    LogBufferUnblocker.unblock(
                        this.termBuffers,
                        this.metaDataBuffer,
                        senderPosition,
                        this._termBufferLength,
                    )
                ) {
                    this.unblockedPublications.incrementRelease();
                }
            }
        } else {
            this.timeOfLastActivityNs = nowNs;
            this.lastSenderPosition = senderPosition;
        }
    }

    private isPossiblyBlocked(producerPosition: number, consumerPosition: number): boolean {
        const producerTermCount = activeTermCount(this.metaDataBuffer);
        const expectedTermCount = Math.floor(consumerPosition / 2 ** this.positionBitsToShift) | 0;

        if (producerTermCount !== expectedTermCount) {
            return true;
        }

        return producerPosition > consumerPosition;
    }

    private spiesFinishedConsuming(conductor: DriverConductor, eosPosition: number): boolean {
        if (this._hasSpies) {
            for (const spyPosition of this.spyPositions) {
                if (spyPosition.getVolatile() < eosPosition) {
                    return false;
                }
            }

            this._hasSpies = false;
            conductor.cleanupSpies(this);
        }

        return true;
    }

    private updateConnectedState(newConnectedState: boolean): void {
        if (newConnectedState !== this.isConnected) {
            LogBufferDescriptor.isConnected(this.metaDataBuffer, newConnectedState);
            this.isConnected = newConnectedState;
        }
    }

    private hasSubscribers(): boolean {
        return (
            (this._spiesSimulateConnection && this._hasSpies) ||
            (this.hasReceivers && this.flowControl.hasRequiredReceivers())
        );
    }

    private checkUntetheredSubscriptions(nowNs: number, conductor: DriverConductor): void {
        const untetheredSubscriptions = this.untetheredSubscriptions;
        const untetheredSubscriptionsSize = untetheredSubscriptions.length;
        if (untetheredSubscriptionsSize > 0) {
            const senderPosition = this.senderPosition.getVolatile();
            const untetheredWindowLimit = senderPosition - this.termWindowLength + (this.termWindowLength >> 2);

            for (let lastIndex = untetheredSubscriptionsSize - 1, i = lastIndex; i >= 0; i--) {
                const untethered = untetheredSubscriptions[i] as UntetheredSubscription;
                const state = untethered.state();
                if (UntetheredSubscription.State.ACTIVE === state) {
                    if (untethered.position.getVolatile() > untetheredWindowLimit) {
                        untethered.timeOfLastUpdateNs = nowNs;
                    } else if (untethered.timeOfLastUpdateNs + this.untetheredWindowLimitTimeoutNs - nowNs <= 0) {
                        conductor.notifyUnavailableImageLink(this._registrationId, untethered.subscriptionLink);
                        untethered.state(UntetheredSubscription.State.LINGER, nowNs, this._streamId, this._sessionId);
                    }
                } else if (UntetheredSubscription.State.LINGER === state) {
                    if (untethered.timeOfLastUpdateNs + this.untetheredLingerTimeoutNs - nowNs <= 0) {
                        this.removeSpyPosition(untethered.position);
                        if (untethered.subscriptionLink.isRejoin()) {
                            untethered.state(
                                UntetheredSubscription.State.RESTING,
                                nowNs,
                                this._streamId,
                                this._sessionId,
                            );
                        } else {
                            ArrayListUtil.fastUnorderedRemove(untetheredSubscriptions, i, lastIndex--);
                            untethered.position.close();
                        }
                    }
                } else if (UntetheredSubscription.State.RESTING === state) {
                    if (untethered.timeOfLastUpdateNs + this.untetheredRestingTimeoutNs - nowNs <= 0) {
                        this.addSpyPosition(untethered.position);
                        conductor.notifyAvailableImageLink(
                            this._registrationId,
                            this._sessionId,
                            untethered.subscriptionLink,
                            untethered.position.id(),
                            senderPosition,
                            this._rawLog.fileName(),
                            CommonContext.IPC_CHANNEL,
                        );
                        untethered.state(UntetheredSubscription.State.ACTIVE, nowNs, this._streamId, this._sessionId);
                    }
                }
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public onTimeEvent(timeNs: number, _timeMs: number, conductor: DriverConductor): void {
        switch (this._state) {
            case State.ACTIVE: {
                if (LogBufferDescriptor.isPublicationRevoked(this.metaDataBuffer)) {
                    const revokedPos = this.producerPosition();
                    this.publisherLimit.setRelease(revokedPos);
                    endOfStreamPosition(this.metaDataBuffer, revokedPos);
                    this.updateConnectedState(false);
                    this.isConnected = false;

                    this.isEndOfStream = true;

                    conductor.cleanupSpies(this);

                    this._state = State.LINGER;

                    // logRevoke(revokedPos, sessionId(), streamId(), channel()): DriverLog is out of scope (spec section 3)
                    this.publicationsRevoked.increment();
                } else {
                    this.checkUntetheredSubscriptions(timeNs, conductor);
                    this.updateConnectedState(this.hasSubscribers());
                    const producerPosition = this.producerPosition();
                    this.publisherPos.setRelease(producerPosition);
                    if (!this._isExclusive) {
                        this.checkForBlockedPublisher(producerPosition, this.senderPosition.getVolatile(), timeNs);
                    }
                }
                break;
            }

            case State.DRAINING: {
                const producerPosition = this.producerPosition();
                this.publisherPos.setRelease(producerPosition);
                const senderPosition = this.senderPosition.getVolatile();
                if (producerPosition > senderPosition) {
                    if (
                        LogBufferUnblocker.unblock(
                            this.termBuffers,
                            this.metaDataBuffer,
                            senderPosition,
                            this._termBufferLength,
                        )
                    ) {
                        this.unblockedPublications.incrementRelease();
                        break;
                    }

                    if (this.hasReceivers) {
                        break;
                    }
                } else {
                    this.isEndOfStream = true;
                }

                if (this.spiesFinishedConsuming(conductor, producerPosition)) {
                    this.timeOfLastActivityNs = timeNs;
                    this._state = State.LINGER;
                }
                break;
            }

            case State.LINGER:
                if (
                    0 === this.refCount &&
                    (this.hasReceivedUnicastEos || this.timeOfLastActivityNs + this.lingerTimeoutNs - timeNs < 0)
                ) {
                    this._channelEndpoint.decRef();
                    conductor.cleanupPublication(this);
                    this.timeOfLastActivityNs = timeNs;
                    this._state = State.DONE;
                }
                break;

            case State.DONE:
                break;
        }
    }

    /**
     * {@inheritDoc}
     */
    public hasReachedEndOfLife(): boolean {
        return this.hasSenderReleased;
    }

    /**
     * Get the response correlation id for the publication.
     *
     * @return the response correlation id for the publication.
     */
    public responseCorrelationId(): number {
        return this._responseCorrelationId;
    }

    /**
     * @internal package-private in Java
     */
    public revoke(): void {
        LogBufferDescriptor.isPublicationRevoked(this.metaDataBuffer, true);
    }

    /**
     * @internal package-private in Java
     */
    public decRef(): void {
        if (0 === --this.refCount) {
            const producerPosition = this.producerPosition();
            this.publisherLimit.setRelease(producerPosition);
            endOfStreamPosition(this.metaDataBuffer, producerPosition);

            if (!LogBufferDescriptor.isPublicationRevoked(this.metaDataBuffer)) {
                if (this.senderPosition.getVolatile() >= producerPosition) {
                    this.isEndOfStream = true;
                }

                this._state = State.DRAINING;
            }
        }
    }

    /**
     * @internal package-private in Java
     */
    public incRef(): void {
        ++this.refCount;
    }

    /**
     * @internal package-private in Java
     */
    public state(): number {
        return this._state;
    }

    /**
     * @internal package-private in Java
     */
    public senderRelease(): void {
        this.hasSenderReleased = true;
    }

    /**
     * The position of the producers: the position of the raw tail of the active term. Java reads
     * `rawTailVolatile(metaDataBuffer)`; the two halves of the 64-bit tail are read as one atomic snapshot (spec D12,
     * D16), so that no `bigint` is made.
     *
     * @internal package-private in Java
     */
    public producerPosition(): number {
        const metaDataBuffer = this.metaDataBuffer;
        const rawTailHalves = this.rawTailHalves;
        metaDataBuffer.getLongVolatileHalves(
            TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * indexByTermCount(activeTermCount(metaDataBuffer)),
            rawTailHalves,
        );
        const termOffset = Math.min(rawTailHalves[0]! >>> 0, this._termBufferLength) | 0;

        return computePosition(rawTailHalves[1]!, termOffset, this.positionBitsToShift, this._initialTermId);
    }

    /**
     * @internal package-private in Java
     */
    public consumerPosition(): number {
        return this.senderPosition.getVolatile();
    }

    private addSpyPosition(position: ReadablePosition): void {
        this.spyPositions = ArrayUtil.add(this.spyPositions, position);
        this._hasSpies = true;
    }

    private removeSpyPosition(position: ReadablePosition): void {
        this.spyPositions = ArrayUtil.remove(this.spyPositions, position);
        this._hasSpies = 0 !== this.spyPositions.length;
    }

    private isSendResponseSetupFlag(): boolean {
        return !this.isResponse && Aeron.NULL_VALUE !== this._responseCorrelationId;
    }

    private hasGroupSemantics(): boolean {
        return this.channelEndpoint().udpChannel().hasGroupSemantics();
    }
}
