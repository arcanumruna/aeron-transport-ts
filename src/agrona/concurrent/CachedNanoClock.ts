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
// Port of org/agrona/concurrent/CachedNanoClock.java @ Agrona 2.6.1
import type { NanoClock } from './NanoClock.js';

/**
 * A {@link NanoClock} that caches the time value to be returned by an external source. A cache line of padding and
 * an atomic field updater keep the value safe to share between threads in Java; on one JS thread (spec D3) neither
 * is needed and the updates are plain stores.
 */
export class CachedNanoClock implements NanoClock {
    protected timeNs = 0;

    public nanoTime(): number {
        return this.timeNs;
    }

    /**
     * Update the time in nanoseconds.
     *
     * @param timeNs the new time in nanoseconds.
     */
    public update(timeNs: number): void {
        this.timeNs = timeNs;
    }

    /**
     * Advance the time by a number of nanoseconds.
     *
     * @param nanos to advance the time by.
     */
    public advance(nanos: number): void {
        this.timeNs = this.timeNs + nanos;
    }
}
