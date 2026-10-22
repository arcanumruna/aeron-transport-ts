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
// Port of org/agrona/concurrent/SystemEpochNanoClock.java @ Agrona 2.6.1
import { performance } from 'node:perf_hooks';
import type { EpochNanoClock } from './EpochNanoClock.js';

/**
 * Implementation that calls {@code HighResolutionClock.epochNanos()} in Java. Here the time is the wall-clock origin
 * of the process plus {@code performance.now()}, in nanoseconds, with no {@code bigint} allocated per call as
 * {@code process.hrtime.bigint()} does on every call.
 * <p>
 * The nanoseconds since 1 Jan 1970 are about 1.8e18, above 2^53, so the {@code number} returned is a double rounded
 * to a multiple of 256 ns, and it is not a safe integer (spec D17): do not store it with a {@code long} accessor of
 * a buffer (spec D5 throws {@code RangeError}). {@code performance.timeOrigin} has microsecond resolution, so the
 * clock is no finer than that either. {@code OffsetEpochNanoClock} is not ported.
 */
export class SystemEpochNanoClock implements EpochNanoClock {
    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: SystemEpochNanoClock = new SystemEpochNanoClock();

    private static readonly TIME_ORIGIN_NS = performance.timeOrigin * 1_000_000;

    public nanoTime(): number {
        return Math.floor(SystemEpochNanoClock.TIME_ORIGIN_NS + performance.now() * 1_000_000);
    }
}
