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
// Port of io/aeron/driver/PublicationImage.java @ 1.53.3
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import { ArrayListUtil } from '../agrona/collections/ArrayListUtil.js';
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import type { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import type { EpochClock } from '../agrona/concurrent/EpochClock.js';
import type { EpochNanoClock } from '../agrona/concurrent/EpochNanoClock.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { Position } from '../agrona/concurrent/status/Position.js';
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import { ByteOrder, Long } from '../agrona/jdk.js';
import { arraysCopyOf } from '../agrona/jdkUtil.js';
import { ErrorCode } from '../client/ErrorCode.js';
import { FrameDescriptor } from '../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { TermGapFiller } from '../client/logbuffer/TermGapFiller.js';
import { TermRebuilder } from '../client/logbuffer/TermRebuilder.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import type { RttMeasurementFlyweight } from '../client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { CongestionControl } from './CongestionControl.js';
import type { DriverConductor } from './DriverConductor.js';
import type { DriverManagedResource } from './DriverManagedResource.js';
import type { FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';
import type { InetSocketAddress } from './jdkNet.js';
import { LossDetector } from './LossDetector.js';
import type { LossHandler } from './LossHandler.js';
import type { MediaDriverContext } from './MediaDriver.js';
import type { SubscriberPosition } from './SubscriberPosition.js';
import type { Subscribable } from './Subscribable.js';
import type { SubscriptionLink } from './SubscriptionLink.js';
import { UntetheredSubscription } from './UntetheredSubscription.js';
import type { RawLog } from './buffer/RawLog.js';
import { ImageConnection } from './media/ImageConnection.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from './media/ReceiveDestinationTransport.js';
import type { LossReport, ReportEntry } from './reports/LossReport.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import type { SystemCounters } from './status/SystemCounters.js';

const { lossFound, rebuildOffset } = LossDetector;
const {
    FLOW_CONTROL_OVER_RUNS,
    FLOW_CONTROL_UNDER_RUNS,
    HEARTBEATS_RECEIVED,
    INVALID_PACKETS,
    LOSS_GAP_FILLS,
    NAK_MESSAGES_SENT,
    PUBLICATION_IMAGES_REVOKED,
    STATUS_MESSAGES_SENT,
} = SystemCounterDescriptor;
const {
    LOG_ACTIVE_TRANSPORT_COUNT,
    computePosition,
    computeTermIdFromPosition,
    indexByPosition,
    indexByTerm,
    isPublicationRevoked,
} = LogBufferDescriptor;
const { tryFillGap } = TermGapFiller;
const { SEND_RESPONSE_SETUP_FLAG } = SetupFlyweight;
const { IMAGE_REJECTED } = ErrorCode;
const { LITTLE_ENDIAN } = ByteOrder;

// Java's nested `PublicationImage.State` enum: the ordinals of the constants, as numbers so that a state is an `int`
// (as `NetworkPublication.State`).
const State = {
    INIT: 0,
    ACTIVE: 1,
    DRAINING: 2,
    LINGER: 3,
    DONE: 4,
} as const;

const STATE_NAMES = ['INIT', 'ACTIVE', 'DRAINING', 'LINGER', 'DONE'] as const;

// expected minimum number of SMs with EOS bit set sent during draining.
const SM_EOS_MULTIPLE = 5;

/**
 * State maintained for active sessionIds within a channel for receiver processing.
 * <p>
 * The cache line padding classes of Java (`PublicationImagePadding1` to `3` and the field classes between them) keep
 * the fields of the conductor from those of the receiver, which are two threads. Here the agents share one thread
 * (spec D3), so the fields are declared in one class and the fields that are `volatile` in Java, with their
 * `VarHandle`s (`beginSmChange`, `endSmChange`, `beginLossChange`, `endLossChange`, `isNextSmDeadlineResetRequested`,
 * `timeOfLastStateChangeNs`, `isReceiverReleaseTriggered`, `hasReceiverReleased`, `state` and `responseSessionId`), are
 * plain (D3, D19): no other thread reads them, so the begin / end change numbers of an SM and a loss are always equal
 * when the receiver reads them. A field and a method of one name get a leading `_` on the field (D39).
 */
export class PublicationImage implements LossHandler, DriverManagedResource, Subscribable {
    public static readonly State = State;

    // conductor fields
    public cleanPosition: number = 0;
    public readonly untetheredSubscriptions: UntetheredSubscription[] = [];
    public subscriberPositions: ReadablePosition[];
    public lossReportTermId = 0;
    public lossReportTermOffset = 0;
    public lossReportLength = 0;
    public lossReport: LossReport | null;
    public reportEntry: ReportEntry | null = null;
    private _responseSessionId: number | null = null;

    // receiver fields
    private _isEndOfStream = false;
    public isSendingEosSm = false;
    public timeOfLastPacketNs: number = 0;
    public imageConnections: (ImageConnection | null)[] = [null];
    public rejectionReason: string | null = null;

    private beginSmChange = 0;
    private endSmChange = 0;
    private nextSmPosition: number = 0;
    private nextSmReceiverWindowLength: number = 0;

    private lastSmChangeNumber = 0;
    private lastSmPosition: number = 0;
    private lastOverrunThreshold: number = 0;
    private nextSmDeadlineNs = 0;
    private isNextSmDeadlineResetRequested = false;
    private readonly smTimeoutNs: number = 0;
    private readonly maxReceiverWindowLength: number = 0;

    public beginLossChange = 0;
    public endLossChange = 0;
    public lossTermId = 0;
    public lossTermOffset = 0;
    public lossLength = 0;
    private lastLossChangeNumber = 0;

    private timeOfLastStateChangeNs: number = 0;

    private readonly _correlationId: number = 0;
    private readonly imageLivenessTimeoutNs: number = 0;
    private readonly untetheredWindowLimitTimeoutNs: number = 0;
    private readonly untetheredLingerTimeoutNs: number = 0;
    private readonly untetheredRestingTimeoutNs: number = 0;
    private readonly _sessionId: number = 0;
    private readonly _streamId: number = 0;
    private readonly positionBitsToShift: number = 0;
    private readonly termLengthMask: number = 0;
    private readonly initialTermId: number = 0;
    private readonly flags: number = 0;
    private readonly isReliable: boolean;
    private readonly isReceiveTimestampEnabled: boolean;
    private readonly receiveTimestampOffset: number = 0;
    private smEnabled = true;

    private isRebuilding = true;
    private isReceiverReleaseTriggered = false;
    private hasReceiverReleased = false;
    private _state: number = State.INIT;

    private readonly cachedNanoClock: CachedNanoClock;
    private readonly receiveTimestampClock: EpochNanoClock | null;
    private readonly _channelEndpoint: ReceiveChannelEndpoint;
    private readonly termBuffers: UnsafeBuffer[];
    private readonly hwmPosition: Position;
    private readonly lossDetector: LossDetector;
    private readonly congestionControl: CongestionControl;
    private readonly errorHandler: ErrorHandler | null;
    private readonly rebuildPosition: Position;
    private readonly _sourceIdentity: string;
    private readonly heartbeatsReceived: AtomicCounter;
    private readonly statusMessagesSent: AtomicCounter;
    private readonly nakMessagesSent: AtomicCounter;
    private readonly receiverNaksSent: AtomicCounter;
    private readonly flowControlUnderRuns: AtomicCounter;
    private readonly flowControlOverRuns: AtomicCounter;
    private readonly lossGapFills: AtomicCounter;
    private readonly publicationImagesRevoked: AtomicCounter;
    private readonly invalidPackets: AtomicCounter;
    private readonly epochClock: EpochClock;
    private readonly nanoClock: NanoClock;
    private readonly _rawLog: RawLog;
    // scratch of validatePacket: the two int halves of the receive timestamp (spec D17), read once for each packet
    private readonly receiveTimestampHalves = new Int32Array(2);

    public constructor(
        correlationId: number,
        ctx: MediaDriverContext,
        channelEndpoint: ReceiveChannelEndpoint,
        transportIndex: number,
        controlAddress: InetSocketAddress,
        sessionId: number,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        flags: number,
        isReliable: boolean,
        untetheredWindowLimitTimeoutNs: number,
        untetheredLingerTimeoutNs: number,
        untetheredRestingTimeoutNs: number,
        rawLog: RawLog,
        lossFeedbackDelayGenerator: FeedbackDelayGenerator,
        subscriberPositions: SubscriberPosition[],
        hwmPosition: Position,
        rebuildPosition: Position,
        receiverNaksSent: AtomicCounter,
        sourceIdentity: string,
        congestionControl: CongestionControl,
    ) {
        this._correlationId = correlationId;
        this.imageLivenessTimeoutNs = ctx.imageLivenessTimeoutNs();
        this.receiverNaksSent = receiverNaksSent;
        this.untetheredWindowLimitTimeoutNs = untetheredWindowLimitTimeoutNs;
        this.untetheredLingerTimeoutNs = untetheredLingerTimeoutNs;
        this.untetheredRestingTimeoutNs = untetheredRestingTimeoutNs;
        this.smTimeoutNs = ctx.statusMessageTimeoutNs();
        this._channelEndpoint = channelEndpoint;
        this._sessionId = sessionId;
        this._streamId = streamId;
        this.flags = flags;
        this._rawLog = rawLog;
        this.hwmPosition = hwmPosition;
        this.rebuildPosition = rebuildPosition;
        this._sourceIdentity = sourceIdentity;
        this.initialTermId = initialTermId;
        this.congestionControl = congestionControl;
        this.errorHandler = ctx.countedErrorHandler();
        this.lossReport = ctx.lossReport();

        this.nanoClock = ctx.nanoClock() as NanoClock;
        this.epochClock = ctx.epochClock() as EpochClock;
        this.cachedNanoClock = ctx.receiverCachedNanoClock() as CachedNanoClock;

        const nowNs = this.cachedNanoClock.nanoTime();
        this.timeOfLastStateChangeNs = nowNs;
        this.timeOfLastPacketNs = nowNs;

        this.subscriberPositions = this.positionArray(subscriberPositions, nowNs);
        this.isReliable = isReliable;

        this.receiveTimestampClock = ctx.channelReceiveTimestampClock();
        const udpChannel = channelEndpoint.subscriptionUdpChannel();
        this.isReceiveTimestampEnabled = udpChannel.isChannelReceiveTimestampEnabled();
        this.receiveTimestampOffset = DataHeaderFlyweight.DATA_OFFSET + udpChannel.channelReceiveTimestampOffset();

        const systemCounters = ctx.systemCounters() as SystemCounters;
        this.heartbeatsReceived = systemCounters.get(HEARTBEATS_RECEIVED);
        this.statusMessagesSent = systemCounters.get(STATUS_MESSAGES_SENT);
        this.nakMessagesSent = systemCounters.get(NAK_MESSAGES_SENT);
        this.flowControlUnderRuns = systemCounters.get(FLOW_CONTROL_UNDER_RUNS);
        this.flowControlOverRuns = systemCounters.get(FLOW_CONTROL_OVER_RUNS);
        this.lossGapFills = systemCounters.get(LOSS_GAP_FILLS);
        this.publicationImagesRevoked = systemCounters.get(PUBLICATION_IMAGES_REVOKED);
        this.invalidPackets = systemCounters.get(INVALID_PACKETS);

        this.imageConnections = ArrayUtil.ensureCapacity(this.imageConnections, transportIndex + 1);
        this.imageConnections[transportIndex] = new ImageConnection(nowNs, controlAddress);

        this.termBuffers = rawLog.termBuffers();
        this.lossDetector = new LossDetector(lossFeedbackDelayGenerator, this);

        const termLength = rawLog.termLength();
        this.termLengthMask = termLength - 1;
        this.positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);

        this.nextSmReceiverWindowLength = congestionControl.initialWindowLength();
        this.maxReceiverWindowLength = congestionControl.maxWindowLength();
        const position = computePosition(activeTermId, termOffset, this.positionBitsToShift, initialTermId);
        this.nextSmPosition = position;
        this.lastSmPosition = position;
        this.lastOverrunThreshold = position + (termLength >> 1);
        this.cleanPosition = position;

        hwmPosition.setRelease(position);
        rebuildPosition.setRelease(position);
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {
        const errorHandler = this.errorHandler;
        CloseHelper.close(errorHandler, this.hwmPosition);
        CloseHelper.close(errorHandler, this.rebuildPosition);
        CloseHelper.close(errorHandler, this.receiverNaksSent);
        CloseHelper.closeAllWith(errorHandler, this.subscriberPositions);

        for (let i = 0, size = this.untetheredSubscriptions.length; i < size; i++) {
            const untetheredSubscription = this.untetheredSubscriptions[i] as UntetheredSubscription;
            if (UntetheredSubscription.State.RESTING === untetheredSubscription.state()) {
                CloseHelper.close(errorHandler, untetheredSubscription.position);
            }
        }

        CloseHelper.close(errorHandler, this.congestionControl);
    }

    /**
     * The correlation id assigned by the driver when created.
     *
     * @return the correlation id assigned by the driver when created.
     */
    public correlationId(): number {
        return this._correlationId;
    }

    /**
     * The session id of the channel from a publisher.
     *
     * @return session id of the channel from a publisher.
     */
    public sessionId(): number {
        return this._sessionId;
    }

    /**
     * The stream id of this image within a channel.
     *
     * @return stream id of this image within a channel.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Get the string representation of the channel URI.
     *
     * @return the string representation of the channel URI.
     */
    public channel(): string {
        return this._channelEndpoint.originalUriString();
    }

    /**
     * {@inheritDoc}
     */
    public subscribableRegistrationId(): number {
        return this._correlationId;
    }

    /**
     * {@inheritDoc}
     */
    public addSubscriber(
        subscriptionLink: SubscriptionLink,
        subscriberPosition: ReadablePosition,
        nowNs: number,
    ): void {
        this.subscriberPositions = ArrayUtil.add(this.subscriberPositions, subscriberPosition);
        if (!subscriptionLink.isTether()) {
            this.untetheredSubscriptions.push(new UntetheredSubscription(subscriptionLink, subscriberPosition, nowNs));
        }
    }

    /**
     * {@inheritDoc}
     */
    public removeSubscriber(subscriptionLink: SubscriptionLink, subscriberPosition: ReadablePosition): void {
        this.subscriberPositions = ArrayUtil.remove(this.subscriberPositions, subscriberPosition);
        subscriberPosition.close();

        if (!subscriptionLink.isTether()) {
            for (let lastIndex = this.untetheredSubscriptions.length - 1, i = lastIndex; i >= 0; i--) {
                if ((this.untetheredSubscriptions[i] as UntetheredSubscription).subscriptionLink === subscriptionLink) {
                    ArrayListUtil.fastUnorderedRemove(this.untetheredSubscriptions, i, lastIndex);
                    break;
                }
            }
        }

        if (0 === this.subscriberPositions.length) {
            this.isRebuilding = false;
        }
    }

    /**
     * Called from the {@link LossDetector} when gap is detected by the {@link DriverConductor} thread.
     * <p>
     * {@inheritDoc}
     */
    public onGapDetected(termId: number, termOffset: number, length: number): void {
        const changeNumber = this.beginLossChange + 1;

        this.beginLossChange = changeNumber;

        this.lossTermId = termId;
        this.lossTermOffset = termOffset;
        this.lossLength = length;

        this.endLossChange = changeNumber;

        let lossReportEndOffset: number;
        if (
            termId !== this.lossReportTermId ||
            termOffset >= (lossReportEndOffset = this.lossReportTermOffset + this.lossReportLength)
        ) {
            this.reportLoss(termId, termOffset, length, length);
        } else if (termOffset + length > lossReportEndOffset) {
            this.reportLoss(termId, termOffset, length, length - (lossReportEndOffset - termOffset));
        }
    }

    /**
     * Source identity for this stream.
     *
     * @return source identity for a source address.
     * @see Configuration#sourceIdentity(InetSocketAddress)
     */
    public sourceIdentity(): string {
        return this._sourceIdentity;
    }

    /**
     * Return the {@link ReceiveChannelEndpoint} that the image is attached to.
     *
     * @return {@link ReceiveChannelEndpoint} that the image is attached to.
     */
    public channelEndpoint(): ReceiveChannelEndpoint {
        return this._channelEndpoint;
    }

    /**
     * Remove this image from the {@link DataPacketDispatcher} so it will process no further packets from the network.
     * Called from the {@link Receiver} thread.
     */
    public removeFromDispatcher(): void {
        this._channelEndpoint.dispatcher().removePublicationImage(this);
    }

    /**
     * Get the {@link RawLog} the back this image.
     *
     * @return the {@link RawLog} the back this image.
     */
    public rawLog(): RawLog {
        return this._rawLog;
    }

    /**
     * Activate this image from the {@link Receiver}.
     */
    public activate(): void {
        this.timeOfLastStateChangeNs = this.cachedNanoClock.nanoTime();
        this.state(State.ACTIVE);
    }

    /**
     * Deactivate image by setting state to {@link State#DRAINING} if currently {@link State#ACTIVE} from the
     * {@link Receiver}.
     */
    public deactivate(): void {
        if (State.ACTIVE === this._state) {
            const nowNs = this.cachedNanoClock.nanoTime();

            this.isRebuilding = false;
            this.timeOfLastStateChangeNs = nowNs;

            if (!this.isSendingEosSm) {
                this.isSendingEosSm =
                    !this._isEndOfStream || this.rebuildPosition.get() === this.hwmPosition.getAcquire();
            }

            if (this.isSendingEosSm) {
                this.nextSmDeadlineNs = nowNs - 1;
            }

            this.state(State.DRAINING);
        }
    }

    public receiverRelease(): void {
        this.hasReceiverReleased = true;
    }

    public addDestination(transportIndex: number, transport: ReceiveDestinationTransport): void {
        this.imageConnections = ArrayUtil.ensureCapacity(this.imageConnections, transportIndex + 1);

        if (transport.isMulticast()) {
            this.imageConnections[transportIndex] = new ImageConnection(
                this.cachedNanoClock.nanoTime(),
                transport.udpChannel().remoteControl(),
            );
        } else if (transport.hasExplicitControl()) {
            this.imageConnections[transportIndex] = new ImageConnection(
                this.cachedNanoClock.nanoTime(),
                transport.explicitControlAddress() as InetSocketAddress,
            );
        }
    }

    public removeDestination(transportIndex: number): void {
        this.imageConnections[transportIndex] = null;
        this.updateActiveTransportCount();
    }

    public addDestinationConnectionIfUnknown(transportIndex: number, remoteAddress: InetSocketAddress): void {
        this.trackConnection(transportIndex, remoteAddress, this.cachedNanoClock.nanoTime());
    }

    public trackRebuild(nowNs: number): number {
        let workCount = 0;

        if (this.isRebuilding) {
            const hwmPosition = this.hwmPosition.getAcquire();
            let minSubscriberPosition = Long.MAX_VALUE;
            let maxSubscriberPosition = 0;

            const subscriberPositions = this.subscriberPositions;
            for (let i = 0, size = subscriberPositions.length; i < size; i++) {
                const position = (subscriberPositions[i] as ReadablePosition).getAcquire();
                minSubscriberPosition = Math.min(minSubscriberPosition, position);
                maxSubscriberPosition = Math.max(maxSubscriberPosition, position);
            }

            const rebuildPosition = Math.max(this.rebuildPosition.get(), maxSubscriberPosition);
            const scanOutcome = this.lossDetector.scan(
                this.termBuffers[indexByPosition(rebuildPosition, this.positionBitsToShift)] as UnsafeBuffer,
                rebuildPosition,
                hwmPosition,
                nowNs,
                this.termLengthMask,
                this.positionBitsToShift,
                this.initialTermId,
            );

            const rebuildTermOffset = rebuildPosition & this.termLengthMask;
            const newRebuildPosition = rebuildPosition - rebuildTermOffset + rebuildOffset(scanOutcome);
            this.rebuildPosition.proposeMaxRelease(newRebuildPosition);

            const ccOutcome = this.congestionControl.onTrackRebuild(
                nowNs,
                minSubscriberPosition,
                this.nextSmPosition,
                hwmPosition,
                rebuildPosition,
                newRebuildPosition,
                lossFound(scanOutcome),
            );

            const windowLength = CongestionControl.receiverWindowLength(ccOutcome);
            const threshold = CongestionControl.threshold(windowLength);

            if (
                CongestionControl.shouldForceStatusMessage(ccOutcome) ||
                minSubscriberPosition > this.nextSmPosition + threshold ||
                windowLength !== this.nextSmReceiverWindowLength
            ) {
                this.cleanBufferTo(minSubscriberPosition - (this.termLengthMask + 1));
                this.scheduleStatusMessage(minSubscriberPosition, windowLength);
                workCount += 1;
            }
        }

        return workCount;
    }

    /**
     * Insert frame into term buffer from the {@link Receiver}.
     * <p>
     * A position outside +/-(2^53 - 1) (spec D5) is what Java's `long` arithmetic puts far outside the window: ahead of
     * it (an over run) or behind it (an under run). {@link computePosition} throws for it, so a packet from the network
     * with a hostile term id is counted as that and cannot throw out of the duty cycle of the receiver (spec D36, D52).
     *
     * @param termId         for the data packet to insert into the appropriate term.
     * @param termOffset     for the start of the packet in the term.
     * @param buffer         for the data packet to insert into the appropriate term.
     * @param length         of the data packet.
     * @param transportIndex from which the packet came.
     * @param srcAddress     from which the packet came.
     * @return number of bytes applied as a result of this insertion.
     */
    public insertPacket(
        termId: number,
        termOffset: number,
        buffer: UnsafeBuffer,
        length: number,
        transportIndex: number,
        srcAddress: InetSocketAddress,
    ): number {
        if (null !== this.rejectionReason) {
            return 0;
        }

        const termLength = this.termLengthMask + 1;
        const payloadLength = this.validatePacket(termLength, termOffset, buffer, length);
        if (payloadLength < 0) {
            this.invalidPackets.increment();
            return 0;
        }

        const isHeartbeat = 0 === payloadLength;
        let packetPosition: number;
        try {
            packetPosition = computePosition(termId, termOffset, this.positionBitsToShift, this.initialTermId);
        } catch (ex) {
            if (ex instanceof RangeError) {
                this.countUnrepresentablePosition(termId);
                return length;
            }
            throw ex;
        }
        const proposedPosition = packetPosition + payloadLength;

        if (!this.isFlowControlOverRun(proposedPosition)) {
            if (isHeartbeat) {
                const potentialWindowBottom = this.lastSmPosition - termLength;
                const publicationWindowBottom = potentialWindowBottom < 0 ? 0 : potentialWindowBottom;

                if (packetPosition >= publicationWindowBottom) {
                    const nowNs = this.cachedNanoClock.nanoTime();
                    this.timeOfLastPacketNs = nowNs;
                    const imageConnection = this.trackConnection(transportIndex, srcAddress, nowNs);

                    if (DataHeaderFlyweight.isEndOfStream(buffer)) {
                        imageConnection.eosPosition = packetPosition;
                        imageConnection.isEos = true;

                        if (!this._isEndOfStream && this.isAllConnectedEos()) {
                            const eosPosition = this.findEosPosition();

                            if (DataHeaderFlyweight.isRevoked(buffer)) {
                                isPublicationRevoked(this._rawLog.metaData(), true);

                                // logRevoke(eosPosition, sessionId(), streamId(), channel()): DriverLog is out of
                                // scope (spec section 3)
                                this.publicationImagesRevoked.increment();
                            }

                            LogBufferDescriptor.endOfStreamPosition(this._rawLog.metaData(), eosPosition);
                            this._isEndOfStream = true;
                        }
                    }

                    this.hwmPosition.proposeMaxRelease(proposedPosition);
                    this.heartbeatsReceived.incrementRelease();
                } else {
                    this.flowControlUnderRuns.incrementRelease();
                }
            } else if (!this.isFlowControlUnderRun(packetPosition)) {
                const nowNs = this.cachedNanoClock.nanoTime();
                this.timeOfLastPacketNs = nowNs;
                this.trackConnection(transportIndex, srcAddress, nowNs);

                const termBuffer = this.termBuffers[
                    indexByPosition(packetPosition, this.positionBitsToShift)
                ] as UnsafeBuffer;
                TermRebuilder.insert(termBuffer, termOffset, buffer, length);

                this.hwmPosition.proposeMaxRelease(proposedPosition);
            } else if (packetPosition >= this.lastSmPosition - this.maxReceiverWindowLength) {
                this.trackConnection(transportIndex, srcAddress, this.cachedNanoClock.nanoTime());
            }
        }

        return length;
    }

    /**
     * A position that is not a `number` (spec D5, D36): ahead of the window for a term id after the initial one (an
     * over run), behind it otherwise (an under run), as Java's `long` arithmetic finds it.
     */
    private countUnrepresentablePosition(termId: number): void {
        if (((termId - this.initialTermId) | 0) > 0) {
            this.flowControlOverRuns.incrementRelease();
        } else {
            this.flowControlUnderRuns.incrementRelease();
        }
    }

    private validatePacket(termLength: number, termOffset: number, buffer: UnsafeBuffer, length: number): number {
        if (termOffset < 0 || termOffset >= termLength || !FrameDescriptor.isFrameAligned(termOffset)) {
            return -1;
        }

        if (DataHeaderFlyweight.isHeartbeat(buffer, length)) {
            return 0; // heartbeat
        }

        let offset = 0;
        let frameType = -1;
        let nextTermOffset = termOffset;
        let isReceiveTimestampRead = false;
        const halves = this.receiveTimestampHalves;
        do {
            const frameLength = FrameDescriptor.frameLength(buffer, offset);
            if (frameLength <= 0) {
                break;
            }

            frameType = FrameDescriptor.frameType(buffer, offset);
            if (0 !== (frameType & 0xfffe)) {
                break; // invalid frameType
            }

            if (DataHeaderFlyweight.termOffset(buffer, offset) !== nextTermOffset) {
                break; // invalid termOffset
            }

            // Java: BitUtil.align((long)frameLength, FRAME_ALIGNMENT); `BitUtil.align` of the `int`s is 32-bit (spec D53)
            const alignedFrameLength = ((frameLength + 31) >>> 5) * 32;
            nextTermOffset += alignedFrameLength;
            if (nextTermOffset > termLength) {
                break; // exceeds log buffer length
            }

            // we assume that `sessionId`, `streamId`, `termId`, `version`, `flags` are all sane

            if (
                this.isReceiveTimestampEnabled &&
                DataHeaderFlyweight.HDR_TYPE_DATA === frameType &&
                0 !== (FrameDescriptor.frameFlags(buffer, offset) & DataHeaderFlyweight.BEGIN_FLAG) &&
                offset + frameLength <= length
            ) {
                const timestampOffset = this.receiveTimestampOffset;
                if (timestampOffset + 8 <= frameLength) {
                    // the timestamp is read as its two int halves, once for each packet (spec D17)
                    if (!isReceiveTimestampRead) {
                        (this.receiveTimestampClock as EpochNanoClock).nanoTimeHalves(halves);
                        isReceiveTimestampRead = true;
                    }
                    buffer.putInt(offset + timestampOffset, halves[0] as number, LITTLE_ENDIAN);
                    buffer.putInt(offset + timestampOffset + 4, halves[1] as number, LITTLE_ENDIAN);
                }
            }

            offset += alignedFrameLength;
        } while (offset <= length - DataHeaderFlyweight.HEADER_LENGTH);

        if (length !== offset && (offset < length || DataHeaderFlyweight.HDR_TYPE_PAD !== frameType)) {
            return -1; // invalid packet
        }

        return offset;
    }

    /**
     * To be called from the {@link Receiver} to see if image should be dispatched to.
     *
     * @param nowNs current time to check against for activity.
     * @return true if the image should be retained otherwise false.
     */
    public isConnected(nowNs: number): boolean {
        return this.timeOfLastPacketNs + this.imageLivenessTimeoutNs - nowNs >= 0 && !this.isReceiverReleaseTriggered;
    }

    public isEndOfStream(): boolean {
        return this._isEndOfStream;
    }

    /**
     * Check for EOS from publication and switch to {@link State#DRAINING} if at end of stream position.
     *
     * @param nowNs current time of use.
     */
    public checkEosForDrainTransition(nowNs: number): void {
        if (!this.isSendingEosSm) {
            if (
                this._isEndOfStream &&
                this.rebuildPosition.get() === this.hwmPosition.getAcquire() &&
                State.ACTIVE === this._state
            ) {
                this.isRebuilding = false;
                this.timeOfLastStateChangeNs = nowNs;

                this.isSendingEosSm = true;
                this.nextSmDeadlineNs = nowNs - 1;
                this.state(State.DRAINING);
            }
        }
    }

    /**
     * Called from the {@link Receiver} to send any pending Status Messages.
     *
     * @param nowNs current time.
     * @return number of work items processed.
     */
    public sendPendingStatusMessage(nowNs: number): number {
        let workCount = 0;
        const changeNumber = this.endSmChange;

        if (this.isNextSmDeadlineResetRequested) {
            this.isNextSmDeadlineResetRequested = false;
            this.nextSmDeadlineNs = nowNs - 1;
        }

        const hasSmTimedOut = this.smEnabled && this.nextSmDeadlineNs - nowNs < 0;

        if (null !== this.rejectionReason) {
            if (hasSmTimedOut) {
                this._channelEndpoint.sendErrorFrame(
                    this.imageConnections,
                    this._sessionId,
                    this._streamId,
                    IMAGE_REJECTED.value(),
                    this.rejectionReason,
                );

                this.nextSmDeadlineNs = nowNs + this.smTimeoutNs;
                workCount++;
            }

            return workCount;
        }

        const responseSessionId = this._responseSessionId;
        if (hasSmTimedOut && null !== responseSessionId) {
            this._channelEndpoint.sendResponseSetup(
                this.imageConnections,
                this._sessionId,
                this._streamId,
                responseSessionId,
            );
        }

        if (changeNumber !== this.lastSmChangeNumber || hasSmTimedOut) {
            const smPosition = this.nextSmPosition;
            const receiverWindowLength = this.nextSmReceiverWindowLength;

            if (changeNumber === this.beginSmChange) {
                const termId = computeTermIdFromPosition(smPosition, this.positionBitsToShift, this.initialTermId);
                const termOffset = smPosition & this.termLengthMask;
                const termLength = this.termLengthMask + 1;
                const flags = this.isSendingEosSm ? StatusMessageFlyweight.END_OF_STREAM_FLAG : 0;

                this._channelEndpoint.sendStatusMessage(
                    this.imageConnections,
                    this._sessionId,
                    this._streamId,
                    termId,
                    termOffset,
                    receiverWindowLength,
                    flags,
                );

                this.statusMessagesSent.incrementRelease();

                this.lastSmPosition = smPosition;
                this.lastOverrunThreshold = smPosition + (termLength >> 1);
                this.lastSmChangeNumber = changeNumber;
                this.nextSmDeadlineNs = nowNs + this.smTimeoutNs;

                this.updateActiveTransportCount();
            }

            workCount = 1;
        }

        return workCount;
    }

    /**
     * Called from the {@link Receiver} thread to processing any pending loss of packets.
     *
     * @return number of work items processed.
     */
    public processPendingLoss(): number {
        if (isPublicationRevoked(this._rawLog.metaData())) {
            return 0;
        }

        let workCount = 0;
        const changeNumber = this.endLossChange;

        if (changeNumber !== this.lastLossChangeNumber) {
            const termId = this.lossTermId;
            const termOffset = this.lossTermOffset;
            const length = this.lossLength;

            if (changeNumber === this.beginLossChange) {
                if (this.isReliable) {
                    this._channelEndpoint.sendNakMessage(
                        this.imageConnections,
                        this._sessionId,
                        this._streamId,
                        termId,
                        termOffset,
                        length,
                    );
                    // FIXME: Increment only if sent successfully
                    this.nakMessagesSent.incrementRelease();
                    this.receiverNaksSent.incrementRelease();
                } else {
                    const termBuffer = this.termBuffers[indexByTerm(this.initialTermId, termId)] as UnsafeBuffer;
                    if (tryFillGap(this._rawLog.metaData(), termBuffer, termId, termOffset, length)) {
                        this.lossGapFills.incrementRelease();
                    }
                }

                this.lastLossChangeNumber = changeNumber;
            }

            workCount = 1;
        }

        return workCount;
    }

    /**
     * Called from the {@link Receiver} thread to check for initiating an RTT measurement.
     * <p>
     * The time of the measurement is an opaque 64-bit value on the wire (a `bigint`, spec D33), made once for each
     * measurement, which is not a per-message path.
     *
     * @param nowNs in nanoseconds
     * @return number of work items processed.
     */
    public initiateAnyRttMeasurements(nowNs: number): number {
        let workCount = 0;

        if (this.congestionControl.shouldMeasureRtt(nowNs)) {
            const preciseTimeNs = this.nanoClock.nanoTime();

            this._channelEndpoint.sendRttMeasurement(
                this.imageConnections,
                this._sessionId,
                this._streamId,
                BigInt(preciseTimeNs),
                0n,
                true,
            );
            this.congestionControl.onRttMeasurementSent(preciseTimeNs);

            workCount = 1;
        }

        return workCount;
    }

    /**
     * Called from the {@link Receiver} upon receiving an RTT Measurement that is a reply.
     * <p>
     * The echoed time and the reception delta are `bigint`s on the wire (spec D33): the difference is made in 64 bits,
     * once for each measurement, and wraps as Java's `long` does.
     *
     * @param header         of the measurement message.
     * @param transportIndex that the RTT Measurement came in on.
     * @param srcAddress     from the sender requesting the measurement
     */
    public onRttMeasurement(
        header: RttMeasurementFlyweight,
        _transportIndex: number,
        srcAddress: InetSocketAddress,
    ): void {
        const nowNs = this.nanoClock.nanoTime();
        const rttInNs = Number(BigInt.asIntN(64, BigInt(nowNs) - header.echoTimestampNs() - header.receptionDelta()));

        this.congestionControl.onRttMeasurement(nowNs, rttInNs, srcAddress);
    }

    public isAcceptingSubscriptions(): boolean {
        if (this.subscriberPositions.length > 0) {
            const state = this._state;
            return State.INIT === state || State.ACTIVE === state || (State.DRAINING === state && !this.isDrained());
        }
        return false;
    }

    public joinPosition(): number {
        let position = this.rebuildPosition.get();

        const subscriberPositions = this.subscriberPositions;
        for (let i = 0, size = subscriberPositions.length; i < size; i++) {
            position = Math.min((subscriberPositions[i] as ReadablePosition).getAcquire(), position);
        }

        return position;
    }

    public hasSendResponseSetup(): boolean {
        return 0 !== (SEND_RESPONSE_SETUP_FLAG & this.flags);
    }

    public responseSessionId(responseSessionId: number | null): void {
        this._responseSessionId = responseSessionId;
    }

    /**
     * Request that the status message deadline be expired so frames which ride the status message timer, such as a
     * Response Setup, are sent on the next {@link Receiver} duty cycle rather than waiting out the remainder of the
     * current status message interval.
     * <p>
     * The deadline itself is owned by the {@link Receiver}, so only a request is recorded here and the
     * {@link Receiver} applies it in {@link sendPendingStatusMessage}. In Java the release store publishes any writes
     * made before it, such as {@link responseSessionId}, to the {@link Receiver} which reads this with acquire
     * semantics; the agents share one thread here (spec D3), so the order of the plain stores is the order the
     * receiver sees.
     */
    public requestNextSmDeadlineReset(): void {
        this.isNextSmDeadlineResetRequested = true;
    }

    /**
     * {@inheritDoc}
     */
    public onTimeEvent(timeNs: number, _timeMs: number, conductor: DriverConductor): void {
        switch (this._state) {
            case State.ACTIVE: {
                if (isPublicationRevoked(this._rawLog.metaData())) {
                    this.state(State.DRAINING);
                } else {
                    this.checkUntetheredSubscriptions(timeNs, conductor);
                }
                break;
            }

            case State.DRAINING: {
                if (
                    (this.isDrained() &&
                        this.timeOfLastStateChangeNs + SM_EOS_MULTIPLE * this.smTimeoutNs - timeNs < 0) ||
                    isPublicationRevoked(this._rawLog.metaData())
                ) {
                    // the removal of the cool down and the close of the endpoint: with a full receiver queue (spec D42,
                    // D55) nothing is changed or notified, and the next duty cycle asks again (issue #44)
                    if (!conductor.receiverQueueHasRoom(2)) {
                        break;
                    }

                    if (isPublicationRevoked(this._rawLog.metaData())) {
                        this.isRebuilding = false;
                        this.isSendingEosSm = true;

                        this.requestNextSmDeadlineReset();
                    }

                    conductor.transitionToLinger(this);

                    this.isReceiverReleaseTriggered = true;
                    this._channelEndpoint.decRefImages();
                    conductor.tryCloseReceiveChannelEndpoint(this._channelEndpoint);

                    this.timeOfLastStateChangeNs = timeNs;
                    this.state(State.LINGER);
                }
                break;
            }

            case State.LINGER: {
                if (
                    this.hasNoSubscribers() ||
                    this.timeOfLastStateChangeNs + this.imageLivenessTimeoutNs - timeNs < 0
                ) {
                    conductor.cleanupImage(this);
                    this.timeOfLastStateChangeNs = timeNs;
                    this.state(State.DONE);
                }
                break;
            }

            case State.DONE:
            case State.INIT:
                break;
        }
    }

    /**
     * {@inheritDoc}
     */
    public hasReachedEndOfLife(): boolean {
        return this.hasReceiverReleased && State.DONE === this._state;
    }

    public reject(reason: string): void {
        this.rejectionReason = reason;
    }

    public stopStatusMessagesIfNotActive(): void {
        if (State.ACTIVE !== this._state) {
            this.smEnabled = false;
        }
    }

    private reportLoss(termId: number, termOffset: number, length: number, bytesLost: number): void {
        if (null !== this.reportEntry) {
            this.reportEntry.recordObservation(bytesLost, this.epochClock.time());
        } else if (null !== this.lossReport) {
            this.reportEntry = this.lossReport.createEntry(
                bytesLost,
                this.epochClock.time(),
                this._sessionId,
                this._streamId,
                this.channel(),
                this._sourceIdentity,
            );

            if (null === this.reportEntry) {
                this.lossReport = null;
            }
        }

        this.lossReportTermId = termId;
        this.lossReportTermOffset = termOffset;
        this.lossReportLength = length;
    }

    private state(state: number): void {
        this._state = state;
    }

    private isDrained(): boolean {
        const rebuildPosition = this.rebuildPosition.get();

        const subscriberPositions = this.subscriberPositions;
        for (let i = 0, size = subscriberPositions.length; i < size; i++) {
            if ((subscriberPositions[i] as ReadablePosition).getAcquire() < rebuildPosition) {
                return false;
            }
        }

        return true;
    }

    private hasNoSubscribers(): boolean {
        return this.subscriberPositions.length === 0;
    }

    private isFlowControlUnderRun(packetPosition: number): boolean {
        const isFlowControlUnderRun = packetPosition < this.lastSmPosition;

        if (isFlowControlUnderRun) {
            this.flowControlUnderRuns.incrementRelease();
        }

        return isFlowControlUnderRun;
    }

    private isFlowControlOverRun(proposedPosition: number): boolean {
        const isFlowControlOverRun = proposedPosition > this.lastOverrunThreshold;

        if (isFlowControlOverRun) {
            this.flowControlOverRuns.incrementRelease();
        }

        return isFlowControlOverRun;
    }

    private cleanBufferTo(position: number): void {
        const cleanPosition = this.cleanPosition;
        if (position > cleanPosition) {
            // Java: `(int)(position - cleanPosition)`; `| 0` is the same cast of an exact number
            const bytesForCleaning = (position - cleanPosition) | 0;
            const dirtyTermBuffer = this.termBuffers[
                indexByPosition(cleanPosition, this.positionBitsToShift)
            ] as UnsafeBuffer;
            const termOffset = cleanPosition & this.termLengthMask;
            const length = Math.min(bytesForCleaning, dirtyTermBuffer.capacity() - termOffset);

            dirtyTermBuffer.setMemory(termOffset, length - 8, 0);
            dirtyTermBuffer.putLongRelease(termOffset + (length - 8), 0);
            this.cleanPosition = cleanPosition + length;
        }
    }

    private trackConnection(transportIndex: number, srcAddress: InetSocketAddress, nowNs: number): ImageConnection {
        let imageConnections = this.imageConnections;
        if (transportIndex >= imageConnections.length) {
            this.imageConnections = imageConnections = arraysCopyOf(imageConnections, transportIndex + 1);
        }

        let imageConnection = imageConnections[transportIndex] as ImageConnection | null;
        if (null === imageConnection) {
            imageConnection = new ImageConnection(nowNs, srcAddress);
            imageConnections[transportIndex] = imageConnection;
        }

        imageConnection.timeOfLastActivityNs = nowNs;
        imageConnection.timeOfLastFrameNs = nowNs;
        return imageConnection;
    }

    private isAllConnectedEos(): boolean {
        for (let i = 0, length = this.imageConnections.length; i < length; i++) {
            const imageConnection = this.imageConnections[i] as ImageConnection | null;

            if (null !== imageConnection && !imageConnection.isEos) {
                return false;
            } else if (null === imageConnection && this._channelEndpoint.hasDestination(i)) {
                return false;
            }
        }

        return true;
    }

    private findEosPosition(): number {
        let eosPosition = 0;

        for (const imageConnection of this.imageConnections) {
            if (null !== imageConnection && imageConnection.eosPosition > eosPosition) {
                eosPosition = imageConnection.eosPosition;
            }
        }

        return eosPosition;
    }

    private scheduleStatusMessage(smPosition: number, receiverWindowLength: number): void {
        const changeNumber = this.beginSmChange + 1;

        this.beginSmChange = changeNumber;

        this.nextSmPosition = smPosition;
        this.nextSmReceiverWindowLength = receiverWindowLength;

        this.endSmChange = changeNumber;
    }

    private checkUntetheredSubscriptions(nowNs: number, conductor: DriverConductor): void {
        const untetheredSubscriptions = this.untetheredSubscriptions;
        const untetheredSubscriptionsSize = untetheredSubscriptions.length;
        if (untetheredSubscriptionsSize > 0) {
            const untetheredWindowLimit = this.untetheredWindowLimit();

            for (let lastIndex = untetheredSubscriptionsSize - 1, i = lastIndex; i >= 0; i--) {
                const untethered = untetheredSubscriptions[i] as UntetheredSubscription;
                if (UntetheredSubscription.State.ACTIVE === untethered.state()) {
                    if (untethered.position.getVolatile() > untetheredWindowLimit) {
                        untethered.timeOfLastUpdateNs = nowNs;
                    } else if (untethered.timeOfLastUpdateNs + this.untetheredWindowLimitTimeoutNs - nowNs <= 0) {
                        conductor.notifyUnavailableImageLink(this._correlationId, untethered.subscriptionLink);
                        untethered.state(UntetheredSubscription.State.LINGER, nowNs, this._streamId, this._sessionId);
                    }
                } else if (UntetheredSubscription.State.LINGER === untethered.state()) {
                    if (untethered.timeOfLastUpdateNs + this.untetheredLingerTimeoutNs - nowNs <= 0) {
                        this.subscriberPositions = ArrayUtil.remove(this.subscriberPositions, untethered.position);
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
                } else if (UntetheredSubscription.State.RESTING === untethered.state()) {
                    if (untethered.timeOfLastUpdateNs + this.untetheredRestingTimeoutNs - nowNs <= 0) {
                        const joinPosition = this.joinPosition();
                        this.subscriberPositions = ArrayUtil.add(this.subscriberPositions, untethered.position);
                        conductor.notifyAvailableImageLink(
                            this._correlationId,
                            this._sessionId,
                            untethered.subscriptionLink,
                            untethered.position.id(),
                            joinPosition,
                            this._rawLog.fileName(),
                            this._sourceIdentity,
                        );
                        untethered.state(UntetheredSubscription.State.ACTIVE, nowNs, this._streamId, this._sessionId);
                    }
                }
            }
        }
    }

    private untetheredWindowLimit(): number {
        let maxConsumerPosition = 0;

        for (const subscriberPosition of this.subscriberPositions) {
            const position = subscriberPosition.getVolatile();
            if (position > maxConsumerPosition) {
                maxConsumerPosition = position;
            }
        }

        const windowLength = this.nextSmReceiverWindowLength;

        return maxConsumerPosition - windowLength + (windowLength >> 2);
    }

    private updateActiveTransportCount(): void {
        const nowNs = this.cachedNanoClock.nanoTime();
        let activeTransportCount = 0;

        const imageConnections = this.imageConnections;
        for (let i = 0, size = imageConnections.length; i < size; i++) {
            const imageConnection = imageConnections[i] as ImageConnection | null;
            if (
                null !== imageConnection &&
                imageConnection.timeOfLastFrameNs + this.imageLivenessTimeoutNs - nowNs > 0
            ) {
                activeTransportCount++;
            }
        }

        const metaDataBuffer = this._rawLog.metaData();
        if (metaDataBuffer.getInt(LOG_ACTIVE_TRANSPORT_COUNT) !== activeTransportCount) {
            LogBufferDescriptor.activeTransportCount(metaDataBuffer, activeTransportCount);
        }
    }

    private positionArray(subscriberPositions: SubscriberPosition[], nowNs: number): ReadablePosition[] {
        const size = subscriberPositions.length;
        const positions: ReadablePosition[] = new Array<ReadablePosition>(size);

        for (let i = 0; i < size; i++) {
            const subscriberPosition = subscriberPositions[i] as SubscriberPosition;
            positions[i] = subscriberPosition.position();

            if (!subscriberPosition.subscription().isTether()) {
                this.untetheredSubscriptions.push(
                    new UntetheredSubscription(subscriberPosition.subscription(), subscriberPosition.position(), nowNs),
                );
            }
        }

        return positions;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return (
            'PublicationImage{state=' +
            STATE_NAMES[this._state] +
            ", sourceIdentity='" +
            this._sourceIdentity +
            "'" +
            ', streamId=' +
            this._streamId +
            ', sessionId=' +
            this._sessionId +
            '}'
        );
    }
}
