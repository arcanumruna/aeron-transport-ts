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
// Port of org/agrona/concurrent/SystemNanoClock.java @ Agrona 2.6.1
import { performance } from 'node:perf_hooks';
import type { NanoClock } from './NanoClock.js';

/** `performance.now()` when this module was loaded: the origin of the clock (D5). */
const BASELINE_MS = performance.now();

/**
 * A {@link NanoClock} that delegates to the system monotonic clock, as {@code System.nanoTime()} does. The value is
 * the nanoseconds since this module was loaded (spec 5.2, D5), from {@code performance.now()}, which allocates no
 * {@code bigint} as {@code process.hrtime.bigint()} does on every call. The origin of {@code System.nanoTime()} is
 * arbitrary, so the value starts near 0 and saturates at 2^53 - 1 (about 104 days after the load) instead of passing
 * the safe integer limit, where every `putLong` of it would throw (D5).
 */
export class SystemNanoClock implements NanoClock {
    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: SystemNanoClock = new SystemNanoClock();

    public nanoTime(): number {
        const ns = Math.floor((performance.now() - BASELINE_MS) * 1_000_000);
        return ns < Number.MAX_SAFE_INTEGER ? ns : Number.MAX_SAFE_INTEGER;
    }
}
