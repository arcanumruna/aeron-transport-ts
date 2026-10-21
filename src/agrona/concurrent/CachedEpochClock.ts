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
// Port of org/agrona/concurrent/CachedEpochClock.java @ Agrona 2.6.1
import type { EpochClock } from './EpochClock.js';

/**
 * An {@link EpochClock} that caches the time value to be returned by an external source. See
 * {@link CachedNanoClock} for what is not ported.
 */
export class CachedEpochClock implements EpochClock {
    protected timeMs = 0;

    public time(): number {
        return this.timeMs;
    }

    /**
     * Update the time in milliseconds.
     *
     * @param timeMs the new time in milliseconds.
     */
    public update(timeMs: number): void {
        this.timeMs = timeMs;
    }

    /**
     * Advance the time by a number of milliseconds.
     *
     * @param millis to advance the time by.
     */
    public advance(millis: number): void {
        this.timeMs = this.timeMs + millis;
    }
}
