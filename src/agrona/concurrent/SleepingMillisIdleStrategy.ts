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
// Port of org/agrona/concurrent/SleepingMillisIdleStrategy.java @ Agrona 2.6.1
import type { IdleStrategy } from './IdleStrategy.js';

/**
 * When idle this strategy is to sleep for a specified period time in milliseconds. Java sleeps the thread with
 * {@code Thread.sleep}. Here {@code idle} returns the period in nanoseconds and the {@link AgentRunner} waits on a
 * timer (spec D11), as for {@link SleepingIdleStrategy}.
 */
export class SleepingMillisIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link SleepingMillisIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'sleep-ms';

    /**
     * Default sleep period when the default constructor is used.
     */
    public static readonly DEFAULT_SLEEP_PERIOD_MS = 1;

    private readonly sleepPeriodMs: number = 0;

    /**
     * Constructed a new strategy that will sleep for a given period when idle, or for
     * {@link SleepingMillisIdleStrategy.DEFAULT_SLEEP_PERIOD_MS} if the period is omitted.
     *
     * @param sleepPeriodMs period in milliseconds for which the strategy will sleep when work count is 0.
     */
    public constructor(sleepPeriodMs: number = SleepingMillisIdleStrategy.DEFAULT_SLEEP_PERIOD_MS) {
        this.sleepPeriodMs = sleepPeriodMs;
    }

    /**
     * @param workCount performed in the last duty cycle, or omitted to sleep without regard to work done.
     * @return the sleep period in nanoseconds, or 0 if work was done.
     */
    public idle(workCount?: number): number {
        if (undefined !== workCount && workCount > 0) {
            return 0;
        }

        return this.sleepPeriodMs * 1_000_000;
    }

    public reset(): void {}

    public alias(): string {
        return SleepingMillisIdleStrategy.ALIAS;
    }

    public toString(): string {
        return (
            'SleepingMillisIdleStrategy{' +
            'alias=' +
            SleepingMillisIdleStrategy.ALIAS +
            ', sleepPeriodMs=' +
            this.sleepPeriodMs +
            '}'
        );
    }
}
