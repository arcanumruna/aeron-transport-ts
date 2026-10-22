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
// Port of org/agrona/concurrent/EpochClock.java @ Agrona 2.6.1
/**
 * Clock that returns time in milliseconds since the Unix epoch.
 */
export interface EpochClock {
    /**
     * Time in milliseconds since 1 Jan 1970 UTC.
     *
     * @return the number of milliseconds since 1 Jan 1970 UTC.
     */
    time(): number;
}
