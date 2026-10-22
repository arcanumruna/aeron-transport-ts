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
// Port of io/aeron/driver/DutyCycleTracker.java @ 1.53.3

/**
 * Tracker to handle tracking the duration of a duty cycle.
 * <p>
 * Java pads the field with 64 bytes on each side against false sharing (the `DutyCycleTrackerLhsPadding` and
 * `DutyCycleTrackerFields` superclasses and the `p064`..`p127` fields); a JavaScript object has no field layout to
 * control, so the padding is not ported (see `docs/mapping.md`).
 */
export class DutyCycleTracker {
    protected timeOfLastUpdateNs = 0;

    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * Update the last known clock time.
     *
     * @param nowNs to update with.
     */
    public update(nowNs: number): void {
        this.timeOfLastUpdateNs = nowNs;
    }

    /**
     * Pass measurement to tracker and report updating last known clock time with time.
     *
     * @param nowNs of the measurement.
     */
    public measureAndUpdate(nowNs: number): void {
        const cycleTimeNs = nowNs - this.timeOfLastUpdateNs;

        this.timeOfLastUpdateNs = nowNs;
        this.reportMeasurement(cycleTimeNs);
    }

    /**
     * Callback called to report duration of cycle.
     *
     * @param durationNs of the duty cycle.
     */
    public reportMeasurement(durationNs: number): void {
        void durationNs;
    }

    public toString(): string {
        return 'DutyCycleTracker{timeOfLastUpdateNs=' + this.timeOfLastUpdateNs + '}';
    }
}
