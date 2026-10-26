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
// Port of io/aeron/driver/ReceiverLivenessTracker.java @ 1.53.3
import { LongHalves2LongHashMap } from '../agrona/collections/LongHalves2LongHashMap.js';

const MISSING_VALUE = -1;

/**
 * Tracks the receivers of a publication by the time of their last status message. A receiver id is the two `int`
 * halves of the 64-bit `long` (`receiverIdHigh`, `receiverIdLow`), so that a status message does not make a `bigint`
 * (spec D14, D33); the time is a `number` of nanoseconds (spec 5.2).
 */
export class ReceiverLivenessTracker {
    private readonly lastSmTimestampNsByReceiverIdMap = new LongHalves2LongHashMap(MISSING_VALUE);

    public hasReceivers(): boolean {
        return !this.lastSmTimestampNsByReceiverIdMap.isEmpty();
    }

    public onStatusMessage(receiverIdHigh: number, receiverIdLow: number, nowNs: number): void {
        this.lastSmTimestampNsByReceiverIdMap.put(receiverIdHigh, receiverIdLow, nowNs);
    }

    public onRemoteClose(receiverIdHigh: number, receiverIdLow: number): boolean {
        return MISSING_VALUE !== this.lastSmTimestampNsByReceiverIdMap.remove(receiverIdHigh, receiverIdLow);
    }

    public onIdle(nowNs: number, timeoutNs: number): void {
        const timeoutThresholdNs = nowNs - timeoutNs;
        const iterator = this.lastSmTimestampNsByReceiverIdMap.entrySet().iterator();
        while (iterator.hasNext()) {
            iterator.next();
            if (iterator.getLongValue() <= timeoutThresholdNs) {
                iterator.remove();
            }
        }
    }
}
