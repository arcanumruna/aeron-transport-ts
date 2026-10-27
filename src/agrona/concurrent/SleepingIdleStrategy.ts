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
// Port of org/agrona/concurrent/SleepingIdleStrategy.java @ Agrona 2.6.1
import type { TimeUnit } from '../jdk.js';
import type { IdleStrategy } from './IdleStrategy.js';

/**
 * When idle this strategy is to sleep for a specified period of time. Java parks the thread with
 * {@code LockSupport.parkNanos}. Here {@code idle} returns the period and the {@link AgentRunner} waits on a timer
 * (spec D11).
 * <p>
 * This class uses {@code LockSupport.parkNanos(long)} to idle.
 */
export class SleepingIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link SleepingIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'sleep-ns';

    /**
     * Default sleep period when the default constructor is used.
     */
    public static readonly DEFAULT_SLEEP_PERIOD_NS = 1000;

    private readonly sleepPeriodNs: number = 0;

    /**
     * Default constructor that uses {@link SleepingIdleStrategy.DEFAULT_SLEEP_PERIOD_NS}.
     */
    public constructor();

    /**
     * Constructed using specified sleep period.
     *
     * @param sleepPeriodNs period in nanoseconds for which the strategy will sleep when work count is 0.
     */
    public constructor(sleepPeriodNs: number);

    /**
     * Constructed using specified sleep period.
     *
     * @param sleepPeriod period for which the strategy will sleep when work count is 0.
     * @param timeUnit    of the sleep period.
     */
    public constructor(sleepPeriod: number, timeUnit: TimeUnit);

    public constructor(sleepPeriod?: number, timeUnit?: TimeUnit) {
        if (undefined === sleepPeriod) {
            this.sleepPeriodNs = SleepingIdleStrategy.DEFAULT_SLEEP_PERIOD_NS;
        } else if (undefined === timeUnit) {
            this.sleepPeriodNs = sleepPeriod;
        } else {
            this.sleepPeriodNs = timeUnit.toNanos(sleepPeriod);
        }
    }

    /**
     * @param workCount performed in the last duty cycle, or omitted to sleep without regard to work done.
     * @return the sleep period in nanoseconds, or 0 if work was done.
     */
    public idle(workCount?: number): number {
        if (undefined !== workCount && workCount > 0) {
            return 0;
        }

        return this.sleepPeriodNs;
    }

    public reset(): void {}

    public alias(): string {
        return SleepingIdleStrategy.ALIAS;
    }

    public toString(): string {
        return (
            'SleepingIdleStrategy{' +
            'alias=' +
            SleepingIdleStrategy.ALIAS +
            ', sleepPeriodNs=' +
            this.sleepPeriodNs +
            '}'
        );
    }
}
