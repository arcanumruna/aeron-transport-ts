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
// Port of org/agrona/concurrent/BackoffIdleStrategy.java @ Agrona 2.6.1
import { Thread } from '../jdkLang.js';
import type { IdleStrategy } from './IdleStrategy.js';

const NOT_IDLE = 0;
const SPINNING = 1;
const YIELDING = 2;
const PARKING = 3;

/**
 * Idle strategy for use by threads when they do not have work to do.
 * <p>
 * <b>Note regarding SpinWait:</b> a spin does nothing on one JS thread.
 * <p>
 * Idling behavior:
 * <pre>
 * Phases of idling are, in order:
 * <ol>
 *   <li>{@code maxSpins}: spin, no wait</li>
 *   <li>{@code maxYields}: yield to the event loop, no wait</li>
 *   <li>park for {@code minParkPeriodNs}, doubling up to {@code maxParkPeriodNs}</li>
 * </ol>
 * </pre>
 * Spinning, yielding and parking are the Java thread actions. Here {@code idle} returns the park period in
 * nanoseconds, 0 for a spin or a yield, and the {@link AgentRunner} turns it into a timer or a {@code setImmediate}
 * (spec D11). Java pads the class to keep the hot fields on their own cache lines; a JS object has no such layout and
 * the padding is not ported.
 */
export class BackoffIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link BackoffIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'backoff';

    /**
     * Default number of times the strategy will spin without work before going to next state.
     */
    public static readonly DEFAULT_MAX_SPINS = 10;

    /**
     * Default number of times the strategy will yield without work before going to next state.
     */
    public static readonly DEFAULT_MAX_YIELDS = 5;

    /**
     * Default interval the strategy will park the thread on entering the park state.
     */
    public static readonly DEFAULT_MIN_PARK_PERIOD_NS = 1000;

    /**
     * Default interval beyond which the strategy will not park the thread.
     */
    public static readonly DEFAULT_MAX_PARK_PERIOD_NS = 1_000_000;

    private readonly maxSpins: number;
    private readonly maxYields: number;
    private readonly minParkPeriodNs: number;
    private readonly maxParkPeriodNs: number;

    private state = NOT_IDLE;
    private spins = 0;
    private yields = 0;
    private parkPeriodNs = 0;

    /**
     * Default constructor using {@link BackoffIdleStrategy.DEFAULT_MAX_SPINS},
     * {@link BackoffIdleStrategy.DEFAULT_MAX_YIELDS}, {@link BackoffIdleStrategy.DEFAULT_MIN_PARK_PERIOD_NS} and
     * {@link BackoffIdleStrategy.DEFAULT_MAX_PARK_PERIOD_NS}.
     */
    public constructor();

    /**
     * Create a set of state tracking idle behavior
     *
     * @param maxSpins        to perform before moving to {@link Thread.yield}
     * @param maxYields       to perform before moving to {@link LockSupport.parkNanos}
     * @param minParkPeriodNs to use when initiating parking
     * @param maxParkPeriodNs to use when parking
     */
    public constructor(maxSpins: number, maxYields: number, minParkPeriodNs: number, maxParkPeriodNs: number);

    public constructor(maxSpins?: number, maxYields?: number, minParkPeriodNs?: number, maxParkPeriodNs?: number) {
        this.maxSpins = maxSpins ?? BackoffIdleStrategy.DEFAULT_MAX_SPINS;
        this.maxYields = maxYields ?? BackoffIdleStrategy.DEFAULT_MAX_YIELDS;
        this.minParkPeriodNs = minParkPeriodNs ?? BackoffIdleStrategy.DEFAULT_MIN_PARK_PERIOD_NS;
        this.maxParkPeriodNs = maxParkPeriodNs ?? BackoffIdleStrategy.DEFAULT_MAX_PARK_PERIOD_NS;
    }

    /**
     * @param workCount performed in the last duty cycle, or omitted to idle without regard to work done.
     * @return the park period in nanoseconds, or 0 for no wait.
     */
    public idle(workCount?: number): number {
        if (undefined !== workCount && workCount > 0) {
            this.reset();
            return 0;
        }

        let waitNs = 0;
        switch (this.state) {
            case NOT_IDLE:
                this.state = SPINNING;
                this.spins++;
                break;

            case SPINNING:
                Thread.onSpinWait();
                if (++this.spins > this.maxSpins) {
                    this.state = YIELDING;
                    this.yields = 0;
                }
                break;

            case YIELDING:
                if (++this.yields > this.maxYields) {
                    this.state = PARKING;
                    this.parkPeriodNs = this.minParkPeriodNs;
                }
                // else: Thread.yield(), which is the return to the event loop
                break;

            case PARKING:
                waitNs = this.parkPeriodNs;
                this.parkPeriodNs = Math.min(this.parkPeriodNs * 2, this.maxParkPeriodNs);
                break;
        }

        return waitNs;
    }

    public reset(): void {
        this.spins = 0;
        this.yields = 0;
        this.parkPeriodNs = this.minParkPeriodNs;
        this.state = NOT_IDLE;
    }

    public alias(): string {
        return BackoffIdleStrategy.ALIAS;
    }

    public toString(): string {
        return (
            'BackoffIdleStrategy{' +
            'alias=' +
            BackoffIdleStrategy.ALIAS +
            ', maxSpins=' +
            this.maxSpins +
            ', maxYields=' +
            this.maxYields +
            ', minParkPeriodNs=' +
            this.minParkPeriodNs +
            ', maxParkPeriodNs=' +
            this.maxParkPeriodNs +
            '}'
        );
    }
}
