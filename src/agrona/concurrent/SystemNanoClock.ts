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

/**
 * A {@link NanoClock} that delegates to the system monotonic clock, as {@code System.nanoTime()} does. The value is
 * the nanoseconds since the process started (spec 5.2), from {@code performance.now()}, which allocates no
 * {@code bigint} as {@code process.hrtime.bigint()} does on every call.
 */
export class SystemNanoClock implements NanoClock {
    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: SystemNanoClock = new SystemNanoClock();

    public nanoTime(): number {
        return Math.floor(performance.now() * 1_000_000);
    }
}
