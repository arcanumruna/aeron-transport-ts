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
// Port of org/agrona/concurrent/ControllableIdleStrategy.java @ Agrona 2.6.1
import { Thread } from '../jdkLang.js';
import type { IdleStrategy } from './IdleStrategy.js';
import type { StatusIndicatorReader } from './status/StatusIndicatorReader.js';

/**
 * {@link IdleStrategy} which can be controlled by a counter so its mode of operation can be switched between
 * doing nothing (NOOP), busy spinning by calling {@code Thread.onSpinWait()}, yielding by calling
 * {@code Thread.yield()}, or sleeping for the minimum period by calling {@code LockSupport.parkNanos(long)} when
 * work count is zero, so it idles.
 * <p>
 * As for the other strategies (spec D11) {@code idle} does not block: it returns 0 for NOOP, BUSY_SPIN and YIELD and
 * the park period in nanoseconds for PARK, and the {@link AgentRunner} waits.
 */
export class ControllableIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link ControllableIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'controllable';

    /**
     * Not controlled so will go with default of {@link ControllableIdleStrategy.PARK}.
     */
    public static readonly NOT_CONTROLLED = 0;

    /**
     * Apply {@link NoOpIdleStrategy}.
     */
    public static readonly NOOP = 1;

    /**
     * Apply {@link BusySpinIdleStrategy}.
     */
    public static readonly BUSY_SPIN = 2;

    /**
     * Apply {@link YieldingIdleStrategy}.
     */
    public static readonly YIELD = 3;

    /**
     * Apply {@link SleepingIdleStrategy} with minimum sleep interval.
     */
    public static readonly PARK = 4;

    private static readonly PARK_PERIOD_NANOSECONDS = 1000;

    private readonly statusIndicator: StatusIndicatorReader;

    /**
     * Configure idle strategy taking an indicator of which strategy should be applied.
     *
     * @param statusIndicator indicator of which strategy should be applied.
     */
    public constructor(statusIndicator: StatusIndicatorReader) {
        this.statusIndicator = statusIndicator;
    }

    /**
     * Idle based on current status indication value. The two Java overloads {@code idle(int)} and {@code idle()} are
     * this one method.
     *
     * @param workCount performed in the last duty cycle, or omitted to idle without regard to work done.
     * @return the time in nanoseconds to wait before the next duty cycle; 0 for none.
     * @see IdleStrategy.idle
     */
    public idle(workCount?: number): number {
        if (undefined !== workCount && workCount > 0) {
            return 0;
        }

        const status = this.statusIndicator.getVolatile() | 0;

        switch (status) {
            case ControllableIdleStrategy.NOOP:
                return 0;

            case ControllableIdleStrategy.BUSY_SPIN:
                Thread.onSpinWait();
                return 0;

            case ControllableIdleStrategy.YIELD:
                // Thread.yield(), which is the return to the event loop
                return 0;

            case ControllableIdleStrategy.PARK:
            default:
                return ControllableIdleStrategy.PARK_PERIOD_NANOSECONDS;
        }
    }

    public reset(): void {}

    public alias(): string {
        return ControllableIdleStrategy.ALIAS;
    }

    public toString(): string {
        return (
            'ControllableIdleStrategy{' +
            'alias=' +
            ControllableIdleStrategy.ALIAS +
            ', statusIndicator=' +
            this.statusIndicator +
            '}'
        );
    }
}
