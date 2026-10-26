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
// Port of io/aeron/driver/status/DutyCycleStallTracker.java @ 1.53.3
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { requireNonNull } from '../../agrona/jdkLang.js';
import { DutyCycleTracker } from '../DutyCycleTracker.js';

/**
 * Duty cycle tracker that detects when a cycle exceeds a threshold and tracks max cycle time reporting both through
 * counters.
 */
export class DutyCycleStallTracker extends DutyCycleTracker {
    private readonly _maxCycleTime: AtomicCounter;
    private readonly _cycleTimeThresholdExceededCount: AtomicCounter;
    private readonly _cycleTimeThresholdNs: number = 0;

    /**
     * Create a tracker to track max cycle time and excesses of a threshold.
     *
     * @param maxCycleTime                    counter for tracking.
     * @param cycleTimeThresholdExceededCount counter for tracking.
     * @param cycleTimeThresholdNs            to use for tracking excesses.
     */
    public constructor(
        maxCycleTime: AtomicCounter,
        cycleTimeThresholdExceededCount: AtomicCounter,
        cycleTimeThresholdNs: number,
    ) {
        super();
        this._maxCycleTime = requireNonNull(maxCycleTime);
        this._cycleTimeThresholdExceededCount = requireNonNull(cycleTimeThresholdExceededCount);
        this._cycleTimeThresholdNs = cycleTimeThresholdNs;
    }

    /**
     * Get max cycle time counter.
     *
     * @return max cycle time counter.
     */
    public maxCycleTime(): AtomicCounter {
        return this._maxCycleTime;
    }

    /**
     * Get threshold exceeded counter.
     *
     * @return threshold exceeded counter.
     */
    public cycleTimeThresholdExceededCount(): AtomicCounter {
        return this._cycleTimeThresholdExceededCount;
    }

    /**
     * Get threshold value.
     *
     * @return threshold value.
     */
    public cycleTimeThresholdNs(): number {
        return this._cycleTimeThresholdNs;
    }

    public override reportMeasurement(durationNs: number): void {
        if (!this._maxCycleTime.isClosed()) {
            this._maxCycleTime.proposeMaxRelease(durationNs);

            if (durationNs > this._cycleTimeThresholdNs) {
                this._cycleTimeThresholdExceededCount.incrementRelease();
            }
        }
    }

    public override toString(): string {
        return (
            'DutyCycleStallTracker{maxCycleTime=' +
            this._maxCycleTime.toString() +
            ', cycleTimeThresholdExceededCount=' +
            this._cycleTimeThresholdExceededCount.toString() +
            ', cycleTimeThresholdNs=' +
            this._cycleTimeThresholdNs +
            '}'
        );
    }
}
