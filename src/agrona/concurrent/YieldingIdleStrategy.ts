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
// Port of org/agrona/concurrent/YieldingIdleStrategy.java @ Agrona 2.6.1
import type { IdleStrategy } from './IdleStrategy.js';

/**
 * {@link IdleStrategy} that will call {@code Thread.yield()} when the work count is zero. On one JS thread a yield is
 * handing the event loop back to I/O: the strategy returns 0 and the {@link AgentRunner} runs the next cycle from
 * {@code setImmediate} (spec D11).
 */
export class YieldingIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link YieldingIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'yield';

    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: YieldingIdleStrategy = new YieldingIdleStrategy();

    /**
     * @param workCount performed in the last duty cycle, or omitted to yield without regard to work done.
     * @return 0: yielding to the event loop is the wait.
     */
    public idle(_workCount?: number): number {
        return 0;
    }

    public reset(): void {}

    public alias(): string {
        return YieldingIdleStrategy.ALIAS;
    }

    public toString(): string {
        return 'YieldingIdleStrategy{alias=' + YieldingIdleStrategy.ALIAS + '}';
    }
}
