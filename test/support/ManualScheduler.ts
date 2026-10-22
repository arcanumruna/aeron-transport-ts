// A scheduler for AgentRunner that the test drives: nothing runs until the test asks. It stands in for the thread
// that Agrona's tests start and join, and for wall time: a timer is "waited for" by moving virtual time to its
// deadline. Every drive loop has a hard cap and fails rather than hangs.
import type { AgentRunnerScheduler } from '../../src/agrona/concurrent/AgentRunner.js';

interface Timer {
    readonly id: number;
    readonly task: () => void;
    readonly dueMs: number;
}

export class ManualScheduler implements AgentRunnerScheduler {
    public static readonly DEFAULT_MAX_STEPS = 10_000;

    private readonly immediates: (() => void)[] = [];
    private timers: Timer[] = [];
    private nextTimerId = 1;
    private nowMs = 0;

    /** Virtual time in milliseconds. */
    public now(): number {
        return this.nowMs;
    }

    public pendingImmediates(): number {
        return this.immediates.length;
    }

    public pendingTimers(): number {
        return this.timers.length;
    }

    /** The delays, in milliseconds from now, of the pending timers. */
    public timerDelays(): number[] {
        return this.timers.map((t) => t.dueMs - this.nowMs);
    }

    public setImmediate(task: () => void): void {
        this.immediates.push(task);
    }

    public setTimeout(task: () => void, delayMs: number): unknown {
        const id = this.nextTimerId++;
        this.timers.push({ id, task, dueMs: this.nowMs + delayMs });
        return id;
    }

    public clearTimeout(handle: unknown): void {
        this.timers = this.timers.filter((t) => t.id !== handle);
    }

    /**
     * Run the oldest immediate, else the earliest timer (moving virtual time to its deadline).
     *
     * @return false if there was nothing to run.
     */
    public runNext(): boolean {
        const immediate = this.immediates.shift();
        if (undefined !== immediate) {
            immediate();
            return true;
        }

        let earliest: Timer | undefined;
        for (const timer of this.timers) {
            if (undefined === earliest || timer.dueMs < earliest.dueMs) {
                earliest = timer;
            }
        }

        if (undefined === earliest) {
            return false;
        }

        const due = earliest;
        this.timers = this.timers.filter((t) => t !== due);
        this.nowMs = Math.max(this.nowMs, due.dueMs);
        due.task();
        return true;
    }

    /** Run tasks until the condition holds, failing if it does not within `maxSteps` tasks or nothing is left. */
    public runUntil(condition: () => boolean, maxSteps = ManualScheduler.DEFAULT_MAX_STEPS): number {
        let steps = 0;
        while (!condition()) {
            if (steps >= maxSteps) {
                throw new Error('condition not reached within ' + maxSteps + ' steps');
            }

            if (!this.runNext()) {
                throw new Error('condition not reached: nothing left to run after ' + steps + ' steps');
            }

            steps++;
        }

        return steps;
    }

    /** Run exactly `count` tasks, failing if there are fewer. */
    public runSteps(count: number): void {
        for (let i = 0; i < count; i++) {
            if (!this.runNext()) {
                throw new Error('only ' + i + ' of ' + count + ' tasks to run');
            }
        }
    }

    /** Run tasks until none is left, failing if more than `maxSteps` run. */
    public runAll(maxSteps = ManualScheduler.DEFAULT_MAX_STEPS): number {
        let steps = 0;
        while (this.runNext()) {
            if (++steps > maxSteps) {
                throw new Error('still running after ' + maxSteps + ' steps');
            }
        }

        return steps;
    }
}
