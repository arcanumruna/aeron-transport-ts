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
// Port of org/agrona/concurrent/IdleStrategy.java @ Agrona 2.6.1
/**
 * Idle strategy for use by threads when they do not have work to do.
 * <p>
 * <b>Note regarding Alias:</b> Java's `default` method {@link IdleStrategy.alias} returns "" for a strategy that does
 * not name itself; here every strategy implements it.
 * <p>
 * <b>Note regarding Backoff:</b> Java's strategies spin, yield and park the thread inside {@code idle}. Node has one
 * thread, which must go back to the event loop to let I/O in, so the strategies here never block: {@code idle} does
 * the strategy's bookkeeping and <i>returns</i> how long the caller must wait before its next duty cycle, in
 * nanoseconds (spec D11). A spin and a yield return 0: the {@link AgentRunner} runs the next cycle from
 * {@code setImmediate}, which is the yield. A park returns the park period: the runner waits on a timer.
 */
export interface IdleStrategy {
    /**
     * Perform current idle action (e.g. nothing/yield/sleep). To be used in conjunction with
     * {@link IdleStrategy.reset} to clear internal state when idle period is over (or before it begins).
     * Callers are expected to call {@link IdleStrategy.idle} with the amount of work done in the duty cycle: the
     * strategy idles only when it is 0, or resets when it is positive.
     * <p>
     * Without an argument, idle unconditionally. It is the Java overload {@code idle()}.
     *
     * @param workCount performed in the last duty cycle, or omitted to idle without regard to work done.
     * @return the time in nanoseconds to wait before the next duty cycle; 0 for none.
     */
    idle(workCount?: number): number;

    /**
     * Reset the internal state in preparation for entering an idle state again.
     */
    reset(): void;

    /**
     * Simple name by which the strategy can be identified.
     *
     * @return simple name by which the strategy can be identified.
     */
    alias(): string;
}
