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
// Port of org/agrona/concurrent/NoOpIdleStrategy.java @ Agrona 2.6.1
import type { IdleStrategy } from './IdleStrategy.js';

/**
 * Low-latency idle strategy to be employed in loops that do significant work on each iteration such that any work in
 * the idle strategy would be wasteful.
 */
export class NoOpIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link NoOpIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'noop';

    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: NoOpIdleStrategy = new NoOpIdleStrategy();

    /**
     * <b>Note</b>: this implementation will result in no safepoint poll once inlined.
     *
     * @param workCount performed in the last duty cycle.
     * @return 0: never waits.
     */
    public idle(_workCount?: number): number {
        return 0;
    }

    public reset(): void {}

    public alias(): string {
        return NoOpIdleStrategy.ALIAS;
    }

    public toString(): string {
        return 'NoOpIdleStrategy{alias=' + NoOpIdleStrategy.ALIAS + '}';
    }
}
