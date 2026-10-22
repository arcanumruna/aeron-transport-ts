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
// Port of org/agrona/concurrent/EpochNanoClock.java @ Agrona 2.6.1
/**
 * Clock representing the time in nanoseconds since 1 Jan 1970 UTC.
 * <p>
 * The value is a {@code number} (spec D5), but the nanoseconds since the epoch (about 1.8e18) are above 2^53, so a
 * clock cannot return them exactly: see {@link SystemEpochNanoClock} for the granularity (spec D17).
 */
export interface EpochNanoClock {
    /**
     * Time in nanoseconds since 1 Jan 1970 UTC.
     *
     * @return the number of nanoseconds since 1 Jan 1970 UTC.
     */
    nanoTime(): number;
}
