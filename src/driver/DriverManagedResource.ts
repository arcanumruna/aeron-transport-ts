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
// Port of io/aeron/driver/DriverManagedResource.java @ 1.53.3

/**
 * Stand-in for `DriverConductor`, which is ported by a later task (the conductor and its tests). It is an opaque type
 * here so that this file compiles; that task replaces it with `import type { DriverConductor } from './DriverConductor.js'`
 * (see `docs/mapping.md`, "Added files").
 */
export type DriverConductor = object;

/**
 * Common behaviour supported for driver resources such as publications and images.
 */
export interface DriverManagedResource {
    /**
     * Close resources that are not external.
     */
    close(): void;

    /**
     * Inform resource of timeNs passing and pass it DriverConductor to inform of any state transitions.
     *
     * @param timeNs    now in nanoseconds.
     * @param timeMs    now in milliseconds for epoch.
     * @param conductor to inform of any state transitions.
     */
    onTimeEvent(timeNs: number, timeMs: number, conductor: DriverConductor): void;

    /**
     * Has resource reached end of its life and should be reclaimed?
     *
     * @return whether resource has reached end of life or not.
     */
    hasReachedEndOfLife(): boolean;
}
