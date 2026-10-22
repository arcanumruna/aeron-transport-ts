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
// Port of org/agrona/concurrent/BusySpinIdleStrategy.java @ Agrona 2.6.1
import { Thread } from '../jdkLang.js';
import type { IdleStrategy } from './IdleStrategy.js';

/**
 * Busy spin strategy targeted at lowest possible latency. This strategy will monopolise a thread to achieve the lowest
 * possible latency. Useful for creating bubbles in the execution pipeline of tight busy spin loops with no other logic
 * than status checks on progress.
 * <p>
 * <b>Note regarding use:</b> this class is ported for completeness only. The runtime never selects it: no core is
 * ever spun (phase 2 plan, decision 3), and {@code Thread.onSpinWait} is a no-op on the one JS thread. {@code idle}
 * returns 0 (no wait, spec D11): the {@link AgentRunner} runs the next cycle from {@code setImmediate}.
 */
export class BusySpinIdleStrategy implements IdleStrategy {
    /**
     * Name to be returned from {@link BusySpinIdleStrategy.alias}.
     */
    public static readonly ALIAS = 'spin';

    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: BusySpinIdleStrategy = new BusySpinIdleStrategy();

    /**
     * <b>Note</b>: this implementation will result in no safepoint poll once inlined.
     * <p>
     * The two Java overloads {@code idle(int)} and {@code idle()} are this one method.
     *
     * @param workCount performed in the last duty cycle, or omitted to idle without regard to work done.
     * @return 0: never a wait.
     */
    public idle(workCount?: number): number {
        if (undefined !== workCount && workCount > 0) {
            return 0;
        }

        Thread.onSpinWait();
        return 0;
    }

    public reset(): void {}

    public alias(): string {
        return BusySpinIdleStrategy.ALIAS;
    }

    public toString(): string {
        return 'BusySpinIdleStrategy{alias=' + BusySpinIdleStrategy.ALIAS + '}';
    }
}
