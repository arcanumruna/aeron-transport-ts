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
// Port of org/agrona/concurrent/NanoClock.java @ Agrona 2.6.1
/**
 * A clock that returns time in nanoseconds. The value is a `number` (spec D5): exact to 2^53 ns, about 104 days.
 */
export interface NanoClock {
    /**
     * The number of ticks in nanoseconds the clock has advanced since being started.
     *
     * @return the time in nanoseconds.
     */
    nanoTime(): number;
}
