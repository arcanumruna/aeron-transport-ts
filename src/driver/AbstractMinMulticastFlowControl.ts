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
// Port of io/aeron/driver/AbstractMinMulticastFlowControl.java @ 1.53.3
import { type CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { CloseHelper } from '../agrona/CloseHelper.js';
import { type CountedErrorHandler } from '../agrona/concurrent/CountedErrorHandler.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { AsciiEncoding } from '../agrona/AsciiEncoding.js';
import { Long } from '../agrona/jdk.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { CommonContext } from '../client/CommonContext.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { type ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import { type SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { FlowControl } from './FlowControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { type UdpChannel } from './media/UdpChannel.js';
import type { MediaDriver } from './MediaDriver.js';
import { FlowControlReceivers } from './status/FlowControlReceivers.js';

const { computePosition } = LogBufferDescriptor;
const { END_OF_STREAM_FLAG } = StatusMessageFlyweight;
const TWO_POW_32 = 4294967296;

/**
 * Abstract minimum multicast sender flow control strategy. It supports the concept of only tracking the minimum of a
 * group of receivers, not all possible receivers. However, it is agnostic of how that group is determined.
 * <p>
 * Tracking of receivers is done as long as they continue to send Status Messages. Once SMs stop, the receiver tracking
 * for that receiver will time out after a given number of nanoseconds.
 * <p>
 * The receivers are a growable array of {@link Receiver} and a count (spec D118): the array grows only when a receiver
 * with a new id is added, a status message from a known receiver updates its {@link Receiver} in place, and a
 * removal moves the last receiver into the freed slot and lowers the count. The receiver ids are `(high, low)` halves
 * (spec D14), compared as `int`s.
 */
export abstract class AbstractMinMulticastFlowControl implements FlowControl {
    private readonly isGroupTagAware: boolean;
    private _hasRequiredReceivers: boolean = false;
    private _groupMinSize: number = 0;
    private _groupTag: number = 0;
    private _groupTagHigh: number = 0;
    private _groupTagLow: number = 0;
    private _receiverTimeoutNs: number = 0;
    private receivers: Receiver[] = [];
    private receiversLength: number = 0;
    private channel: string = '';
    private receiverCount: AtomicCounter | null = null;
    private errorHandler: CountedErrorHandler | null = null;
    private retransmitReceiverWindowMultiple: number = 0;
    private lastSetupSenderLimit: number = 0;
    private timeOfLastSetupNs: number = 0;
    private hasTaggedStatusMessageTriggeredSetup: boolean = false;

    /**
     * Base constructor for use by specialised implementations.
     *
     * @param isGroupTagAware true if the group tag is used.
     */
    protected constructor(isGroupTagAware: boolean) {
        this.isGroupTagAware = isGroupTagAware;
    }

    public abstract onStatusMessage(
        flyweight: StatusMessageFlyweight,
        receiverAddress: InetSocketAddress,
        senderLimit: number,
        initialTermId: number,
        positionBitsToShift: number,
        timeNs: number,
    ): number;

    public abstract onTriggerSendSetup(
        flyweight: StatusMessageFlyweight,
        receiverAddress: InetSocketAddress,
        timeNs: number,
    ): void;

    public abstract onError(errorFlyweight: ErrorFlyweight, receiverAddress: InetSocketAddress, timeNs: number): void;

    /**
     * {@inheritDoc}
     */
    public initialize(
        context: MediaDriver.Context,
        countersManager: CountersManager,
        udpChannel: UdpChannel,
        streamId: number,
        sessionId: number,
        registrationId: number,
        _initialTermId: number,
        _termBufferLength: number,
    ): void {
        this._receiverTimeoutNs = context.flowControlReceiverTimeoutNs();
        this.setGroupTag(this.isGroupTagAware ? context.flowControlGroupTag() : 0);
        this._groupMinSize = context.flowControlGroupMinSize();
        this.channel = udpChannel.originalUriString();

        this.parseUriParam(udpChannel.channelUri().get(CommonContext.FLOW_CONTROL_PARAM_NAME));
        this._hasRequiredReceivers = this.receiversLength >= this._groupMinSize;
        this.errorHandler = context.countedErrorHandler();
        this.receiverCount = FlowControlReceivers.allocate(
            context.tempBuffer() as MutableDirectBuffer,
            countersManager,
            registrationId,
            sessionId,
            streamId,
            this.channel,
        );
        this.timeOfLastSetupNs = 0;
        this.lastSetupSenderLimit = -1;
        this.hasTaggedStatusMessageTriggeredSetup = false;
        this.retransmitReceiverWindowMultiple = FlowControl.retransmitReceiverWindowMultiple(
            udpChannel,
            context.multicastFlowControlRetransmitReceiverWindowMultiple(),
        );
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {
        CloseHelper.close(this.errorHandler, this.receiverCount);
    }

    /**
     * {@inheritDoc}
     */
    public onSetup(
        _flyweight: SetupFlyweight,
        senderLimit: number,
        _senderPosition: number,
        _positionBitsToShift: number,
        timeNs: number,
    ): number {
        if (this.hasTaggedStatusMessageTriggeredSetup && this.receiversLength > 0) {
            this.timeOfLastSetupNs = timeNs;
            this.lastSetupSenderLimit = senderLimit;
        }

        this.hasTaggedStatusMessageTriggeredSetup = false;

        return senderLimit;
    }

    /**
     * {@inheritDoc}
     */
    public onIdle(timeNs: number, senderLimit: number, _senderPosition: number, _isEos: boolean): number {
        let minLimitPosition = this.lastSetupSenderLimitAt(timeNs);
        let removed = 0;
        const receivers = this.receivers;
        const length = this.receiversLength;
        const receiverTimeoutNs = this._receiverTimeoutNs;

        for (let lastIndex = length - 1, i = lastIndex; i >= 0; i--) {
            const receiver = receivers[i] as Receiver;
            if (receiver.timeOfLastStatusMessageNs + receiverTimeoutNs - timeNs < 0 || receiver.eosFlagged) {
                receivers[i] = receivers[lastIndex--] as Receiver;
                removed++;
                // Java logs the removal with DriverLog (not ported, spec D54).
            } else {
                minLimitPosition = Math.min(minLimitPosition, receiver.lastPositionPlusWindow);
            }
        }

        let newLength = length;
        if (removed > 0) {
            newLength = length - removed;
            for (let i = newLength; i < length; i++) {
                receivers[i] = undefined as unknown as Receiver;
            }
            this.receiversLength = newLength;
            this._hasRequiredReceivers = newLength >= this._groupMinSize;
            (this.receiverCount as AtomicCounter).setRelease(newLength);
        }

        return newLength < this._groupMinSize || 0 === newLength ? senderLimit : minLimitPosition;
    }

    /**
     * Has the observed receiver count reached the {@link groupMinSize} threshold?
     *
     * @return true if the observed receiver count reached the {@link groupMinSize} threshold?
     */
    public hasRequiredReceivers(): boolean {
        return this._hasRequiredReceivers;
    }

    /**
     * {@inheritDoc}
     */
    public maxRetransmissionLength(
        termOffset: number,
        resendLength: number,
        termBufferLength: number,
        _mtuLength: number,
    ): number {
        return FlowControl.calculateRetransmissionLength(
            resendLength,
            termBufferLength,
            termOffset,
            this.retransmitReceiverWindowMultiple,
        );
    }

    /**
     * Process a received status message.
     *
     * @param flyweight           mapped over the status message.
     * @param senderLimit         the sender is currently limited to for sending.
     * @param initialTermId       for the publication.
     * @param positionBitsToShift when calculating term length with requiring a divide.
     * @param timeNs              current time.
     * @param matchesTag          if the status messages comes from a receiver with a tag matching the group.
     * @return the new position limit to be employed by the sender.
     */
    protected processStatusMessage(
        flyweight: StatusMessageFlyweight,
        senderLimit: number,
        initialTermId: number,
        positionBitsToShift: number,
        timeNs: number,
        matchesTag: boolean,
    ): number {
        const position = computePosition(
            flyweight.consumptionTermId(),
            flyweight.consumptionTermOffset(),
            positionBitsToShift,
            initialTermId,
        );

        const windowLength = flyweight.receiverWindowLength();
        const receiverIdHigh = flyweight.receiverIdHigh();
        const receiverIdLow = flyweight.receiverIdLow();
        const lastPositionPlusWindow = position + windowLength;
        const eosFlagged = END_OF_STREAM_FLAG === (flyweight.flags() & END_OF_STREAM_FLAG);
        let isExisting = false;
        let minPosition = this.lastSetupSenderLimitAt(timeNs);

        const receivers = this.receivers;
        let length = this.receiversLength;

        for (let i = 0; i < length; i++) {
            const receiver = receivers[i] as Receiver;
            if (matchesTag && receiverIdHigh === receiver.receiverIdHigh && receiverIdLow === receiver.receiverIdLow) {
                receiver.eosFlagged = eosFlagged;
                receiver.lastPosition = Math.max(position, receiver.lastPosition);
                receiver.lastPositionPlusWindow = lastPositionPlusWindow;
                receiver.timeOfLastStatusMessageNs = timeNs;
                isExisting = true;
            }

            minPosition = Math.min(minPosition, receiver.lastPositionPlusWindow);
        }

        if (
            !isExisting &&
            !eosFlagged &&
            matchesTag &&
            (0 === length || lastPositionPlusWindow >= minPosition - windowLength)
        ) {
            const receiver = new Receiver(
                receiverIdHigh,
                receiverIdLow,
                flyweight.sessionId(),
                flyweight.streamId(),
                position,
                lastPositionPlusWindow,
                timeNs,
            );
            this.addReceiver(receiver);
            length = this.receiversLength;
            this._hasRequiredReceivers = length >= this._groupMinSize;
            minPosition = Math.min(minPosition, lastPositionPlusWindow);
            // Java logs the addition with DriverLog (not ported, spec D54).
            (this.receiverCount as AtomicCounter).setRelease(length);
            this.lastSetupSenderLimit = -1;
        }

        if (length < this._groupMinSize) {
            return senderLimit;
        } else if (0 === length) {
            return Math.max(senderLimit, lastPositionPlusWindow);
        }

        return Math.max(senderLimit, minPosition);
    }

    /**
     * Process a status message triggering a setup to be sent.
     *
     * @param _flyweight       over the status message receiver.
     * @param _receiverAddress of the receiver.
     * @param _timeNs          current time (in nanoseconds).
     * @param hasMatchingTag   if the status messages comes from a receiver with a tag matching the group.
     */
    protected processSendSetupTrigger(
        _flyweight: StatusMessageFlyweight,
        _receiverAddress: InetSocketAddress,
        _timeNs: number,
        hasMatchingTag: boolean,
    ): void {
        if (!this.hasTaggedStatusMessageTriggeredSetup) {
            this.hasTaggedStatusMessageTriggeredSetup = hasMatchingTag;
        }
    }

    /**
     * Process an error frame from a downstream receiver.
     *
     * @param error            flyweight over the error frame.
     * @param _receiverAddress of the receiver.
     * @param _timeNs          current time in nanoseconds.
     * @param hasMatchingTag   if the error message comes from a receiver with a tag matching the group.
     */
    protected processError(
        error: ErrorFlyweight,
        _receiverAddress: InetSocketAddress,
        _timeNs: number,
        hasMatchingTag: boolean,
    ): void {
        if (hasMatchingTag) {
            const receiverIdHigh = error.receiverIdHigh();
            const receiverIdLow = error.receiverIdLow();
            const receivers = this.receivers;
            for (let i = 0, length = this.receiversLength; i < length; i++) {
                const receiver = receivers[i] as Receiver;
                if (receiverIdHigh === receiver.receiverIdHigh && receiverIdLow === receiver.receiverIdLow) {
                    receiver.eosFlagged = true;
                    break;
                }
            }
        }
    }

    /**
     * Timeout after which an inactive receiver will be dropped.
     *
     * @return timeout after which an inactive receiver will be dropped.
     */
    public receiverTimeoutNs(): number {
        return this._receiverTimeoutNs;
    }

    /**
     * Indicates if the flow control strategy has a group tag it is aware of for tracking membership.
     *
     * @return true if the flow control strategy has a group tag it is aware of for tracking membership.
     */
    public hasGroupTag(): boolean {
        return this.isGroupTagAware;
    }

    /**
     * The tag used to identify members of the group.
     *
     * @return tag used to identify members of the group.
     */
    public groupTag(): number {
        return this._groupTag;
    }

    /**
     * The upper 32 bits of the group tag, as the `int` of its 64 bit two's complement form. Not in Java (spec D118):
     * the status message carries the tag as two halves that are compared without a `bigint`.
     *
     * @return the upper half of the group tag.
     */
    public groupTagHigh(): number {
        return this._groupTagHigh;
    }

    /**
     * The lower 32 bits of the group tag, as the `int` of its 64 bit two's complement form. Not in Java (spec D118).
     *
     * @return the lower half of the group tag.
     */
    public groupTagLow(): number {
        return this._groupTagLow;
    }

    /**
     * The minimum group size required for progress.
     *
     * @return minimum group size required for progress.
     */
    public groupMinSize(): number {
        return this._groupMinSize;
    }

    private setGroupTag(groupTag: number): void {
        this._groupTag = groupTag;
        this._groupTagHigh = Math.floor(groupTag / TWO_POW_32) | 0;
        this._groupTagLow = groupTag | 0;
    }

    private addReceiver(receiver: Receiver): void {
        let receivers = this.receivers;
        const length = this.receiversLength;
        if (length === receivers.length) {
            // The control plane: a receiver with a new id. The array doubles.
            receivers = new Array<Receiver>(Math.max(4, length * 2));
            for (let i = 0; i < length; i++) {
                receivers[i] = this.receivers[i] as Receiver;
            }
            this.receivers = receivers;
        }
        receivers[length] = receiver;
        this.receiversLength = length + 1;
    }

    private parseUriParam(fcValue: string | null): void {
        if (null !== fcValue) {
            for (const arg of fcValue.split(',')) {
                if (arg.startsWith('t:')) {
                    this._receiverTimeoutNs = SystemUtil.parseDuration('fc receiver timeout', arg.substring(2));
                } else if (arg.startsWith('g:')) {
                    const groupMinSizeIndex = arg.indexOf('/');

                    if (2 !== groupMinSizeIndex && this.isGroupTagAware) {
                        const lengthToParse = -1 === groupMinSizeIndex ? arg.length - 2 : groupMinSizeIndex - 2;
                        this.setGroupTag(AsciiEncoding.parseLongAscii(arg, 2, lengthToParse));
                    }

                    if (-1 !== groupMinSizeIndex) {
                        this._groupMinSize = AsciiEncoding.parseIntAscii(
                            arg,
                            groupMinSizeIndex + 1,
                            arg.length - (groupMinSizeIndex + 1),
                        );
                    }
                }
            }
        }
    }

    private lastSetupSenderLimitAt(nowNs: number): number {
        if (-1 !== this.lastSetupSenderLimit) {
            if (this.timeOfLastSetupNs + this._receiverTimeoutNs - nowNs < 0) {
                this.lastSetupSenderLimit = -1;
            } else {
                return this.lastSetupSenderLimit;
            }
        }

        return Long.MAX_VALUE;
    }
}

/**
 * A receiver tracked by the strategy. The id is the `(high, low)` halves of the 64 bit receiver id (spec D14).
 */
export class Receiver {
    public readonly sessionId: number = 0;
    public readonly streamId: number = 0;
    public readonly receiverIdHigh: number = 0;
    public readonly receiverIdLow: number = 0;
    public lastPosition: number = 0;
    public lastPositionPlusWindow: number = 0;
    public timeOfLastStatusMessageNs: number = 0;
    public eosFlagged: boolean;

    public constructor(
        receiverIdHigh: number,
        receiverIdLow: number,
        sessionId: number,
        streamId: number,
        lastPosition: number,
        lastPositionPlusWindow: number,
        timeNs: number,
    ) {
        this.receiverIdHigh = receiverIdHigh;
        this.receiverIdLow = receiverIdLow;
        this.sessionId = sessionId;
        this.streamId = streamId;
        this.lastPosition = lastPosition;
        this.lastPositionPlusWindow = lastPositionPlusWindow;
        this.timeOfLastStatusMessageNs = timeNs;
        this.eosFlagged = false;
    }
}
