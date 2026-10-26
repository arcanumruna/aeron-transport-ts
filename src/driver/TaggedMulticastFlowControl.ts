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
// Port of io/aeron/driver/TaggedMulticastFlowControl.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { type ErrorFlyweight } from '../client/protocol/ErrorFlyweight.js';
import { StatusMessageFlyweight } from '../client/protocol/StatusMessageFlyweight.js';
import { AbstractMinMulticastFlowControl } from './AbstractMinMulticastFlowControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { PREFERRED_ASF_BYTES } from './PreferredMulticastFlowControlAsf.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;

/**
 * Tagged multicast sender flow control strategy. It supports the concept of only tracking the minimum of a group of
 * receivers, not all possible receivers. The group is determined by a tag carried in the Status Messages: a receiver
 * that sends a different tag, or none, is not tracked.
 * <p>
 * Tracking of receivers is done as long as they continue to send Status Messages. Once SMs stop, the receiver tracking
 * for that receiver will time out after a given number of nanoseconds.
 */
export class TaggedMulticastFlowControl extends AbstractMinMulticastFlowControl {
    /**
     * URI param value to identify this {@link FlowControl} strategy.
     */
    public static readonly FC_PARAM_VALUE: string = 'tagged';

    /**
     * Default constructor (package-private in Java).
     */
    public constructor() {
        super(true);
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
        return this.processStatusMessage(
            flyweight,
            senderLimit,
            initialTermId,
            positionBitsToShift,
            timeNs,
            this.matchesTagOfStatusMessage(flyweight),
        );
    }

    /**
     * {@inheritDoc}
     */
    public onTriggerSendSetup(
        flyweight: StatusMessageFlyweight,
        receiverAddress: InetSocketAddress,
        timeNs: number,
    ): void {
        this.processSendSetupTrigger(flyweight, receiverAddress, timeNs, this.matchesTagOfStatusMessage(flyweight));
    }

    /**
     * {@inheritDoc}
     */
    public onError(errorFlyweight: ErrorFlyweight, receiverAddress: InetSocketAddress, timeNs: number): void {
        this.processError(
            errorFlyweight,
            receiverAddress,
            timeNs,
            errorFlyweight.hasGroupTag() &&
                errorFlyweight.groupTagHigh() === this.groupTagHigh() &&
                errorFlyweight.groupTagLow() === this.groupTagLow(),
        );
    }

    /**
     * Java's `matchesTag(StatusMessageFlyweight)`; the two overloads of Java are told apart by name. The 64 bit group
     * tag is compared as two `int` halves (spec D118).
     */
    private matchesTagOfStatusMessage(flyweight: StatusMessageFlyweight): boolean {
        const asfLength = flyweight.asfLength();
        let result = false;

        if (asfLength === SIZE_OF_LONG) {
            if (flyweight.groupTagHigh() === this.groupTagHigh() && flyweight.groupTagLow() === this.groupTagLow()) {
                result = true;
            }
        } else if (asfLength >= SIZE_OF_INT) {
            // compatible check for ASF of first 4 bytes
            const offset = StatusMessageFlyweight.groupTagFieldOffset();

            if (
                flyweight.getByte(offset) === PREFERRED_ASF_BYTES[0] &&
                flyweight.getByte(offset + 1) === PREFERRED_ASF_BYTES[1] &&
                flyweight.getByte(offset + 2) === PREFERRED_ASF_BYTES[2] &&
                flyweight.getByte(offset + 3) === PREFERRED_ASF_BYTES[3]
            ) {
                result = true;
            }
        }

        return result;
    }
}
