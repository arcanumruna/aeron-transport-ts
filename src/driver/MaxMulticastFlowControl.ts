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
// Port of io/aeron/driver/MaxMulticastFlowControl.java @ 1.53.3
import { type CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { type ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import { type SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { type StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { FlowControl } from './FlowControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { type UdpChannel } from './media/UdpChannel.js';
import type { MediaDriver } from './MediaDriver.js';

const { computePosition } = LogBufferDescriptor;

/**
 * Default multicast sender flow control strategy.
 * <p>
 * Max of right edges. No tracking of receivers.
 */
export class MaxMulticastFlowControl implements FlowControl {
    /**
     * URI param value to identify this {@link FlowControl} strategy.
     */
    public static readonly FC_PARAM_VALUE: string = 'max';

    /**
     * Multiple of receiver window to allow for a retransmit action.
     */
    private retransmitReceiverWindowMultiple: number = 0;

    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * {@inheritDoc}
     */
    public initialize(
        context: MediaDriver.Context,
        _countersManager: CountersManager,
        udpChannel: UdpChannel,
        _streamId: number,
        _sessionId: number,
        _registrationId: number,
        _initialTermId: number,
        _termBufferLength: number,
    ): void {
        this.retransmitReceiverWindowMultiple = FlowControl.retransmitReceiverWindowMultiple(
            udpChannel,
            context.multicastFlowControlRetransmitReceiverWindowMultiple(),
        );
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {}

    /**
     * {@inheritDoc}
     */
    public onStatusMessage(
        flyweight: StatusMessageFlyweight,
        _receiverAddress: InetSocketAddress,
        senderLimit: number,
        initialTermId: number,
        positionBitsToShift: number,
        _timeNs: number,
    ): number {
        const position = computePosition(
            flyweight.consumptionTermId(),
            flyweight.consumptionTermOffset(),
            positionBitsToShift,
            initialTermId,
        );

        return Math.max(senderLimit, position + flyweight.receiverWindowLength());
    }

    /**
     * {@inheritDoc}
     */
    public onTriggerSendSetup(
        _flyweight: StatusMessageFlyweight,
        _receiverAddress: InetSocketAddress,
        _timeNs: number,
    ): void {}

    /**
     * {@inheritDoc}
     */
    public onSetup(
        _flyweight: SetupFlyweight,
        senderLimit: number,
        _senderPosition: number,
        _positionBitsToShift: number,
        _timeNs: number,
    ): number {
        return senderLimit;
    }

    /**
     * {@inheritDoc}
     */
    public onIdle(_timeNs: number, senderLimit: number, _senderPosition: number, _isEos: boolean): number {
        return senderLimit;
    }

    /**
     * {@inheritDoc}
     */
    public onError(_errorFlyweight: ErrorFlyweight, _receiverAddress: InetSocketAddress, _timeNs: number): void {}

    /**
     * {@inheritDoc}
     */
    public hasRequiredReceivers(): boolean {
        return true;
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
}
