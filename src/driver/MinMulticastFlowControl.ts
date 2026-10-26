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
// Port of io/aeron/driver/MinMulticastFlowControl.java @ 1.53.3
import { type ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import { type StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { AbstractMinMulticastFlowControl } from './AbstractMinMulticastFlowControl.js';
import { type InetSocketAddress } from './jdkNet.js';

/**
 * Minimum multicast sender flow control strategy. It supports the concept of only tracking the minimum of a group of
 * receivers, not all possible receivers. However, it is agnostic of how that group is determined.
 * <p>
 * Tracking of receivers is done as long as they continue to send Status Messages. Once SMs stop, the receiver tracking
 * for that receiver will time out after a given number of nanoseconds.
 */
export class MinMulticastFlowControl extends AbstractMinMulticastFlowControl {
    /**
     * URI param value to identify this {@link FlowControl} strategy.
     */
    public static readonly FC_PARAM_VALUE: string = 'min';

    /**
     * Default constructor (package-private in Java).
     */
    public constructor() {
        super(false);
    }

    /**
     * {@inheritDoc}
     */
    public onStatusMessage(
        flyweight: StatusMessageFlyweight,
        _receiverAddress: InetSocketAddress,
        senderLimit: number,
        initialTermId: number,
        positionBitsToShift: number,
        timeNs: number,
    ): number {
        return this.processStatusMessage(flyweight, senderLimit, initialTermId, positionBitsToShift, timeNs, true);
    }

    /**
     * {@inheritDoc}
     */
    public onTriggerSendSetup(
        flyweight: StatusMessageFlyweight,
        receiverAddress: InetSocketAddress,
        timeNs: number,
    ): void {
        this.processSendSetupTrigger(flyweight, receiverAddress, timeNs, true);
    }

    /**
     * {@inheritDoc}
     */
    public onError(errorFlyweight: ErrorFlyweight, receiverAddress: InetSocketAddress, timeNs: number): void {
        this.processError(errorFlyweight, receiverAddress, timeNs, true);
    }
}
