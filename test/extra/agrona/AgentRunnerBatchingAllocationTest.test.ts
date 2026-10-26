// Extra tests of issue #52 (port-only, spec D114): a runner whose agent reports work runs up to
// `AgentRunner.MAX_BATCHED_DUTY_CYCLES` duty cycles in one task before it yields, so that the `Immediate` that node
// allocates for each `setImmediate` (23 bytes a message in the end-to-end bench) is paid once for the batch. The first
// test counts the `setImmediate` calls of a busy agent with a scheduler that runs them on a queue; the second measures
// the allocation of the real event loop with the sampling heap profiler (spec D112). An agent that has no work, or an
// idle strategy that asks for a pause, is never batched; that is the runner's other tests (T22).
import inspector from 'node:inspector/promises';
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/agrona/concurrent/Agent.js';
import { AgentRunner } from '../../../src/agrona/concurrent/AgentRunner.js';
import type { AgentRunnerScheduler } from '../../../src/agrona/concurrent/AgentRunner.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { mockErrorHandler } from '../../support/MockAgent.js';

const CYCLES = 160_000;

/** Counts the calls of `setImmediate`, and runs the tasks from a queue that the test drains. */
class CountingScheduler implements AgentRunnerScheduler {
    public immediates = 0;
    private task: (() => void) | null = null;

    public setImmediate(task: () => void): void {
        this.immediates++;
        this.task = task;
    }

    public setTimeout(): unknown {
        throw new Error('no timer is expected');
    }

    public clearTimeout(): void {}

    /** Runs the pending task, and the one it schedules, up to `tasks` times; returns the tasks run. */
    public drain(tasks: number): number {
        let run = 0;
        while (null !== this.task && run < tasks) {
            const task = this.task;
            this.task = null;
            task();
            run++;
        }
        return run;
    }
}

/** An agent that reports one unit of work for `limit` cycles, then closes its runner from inside the cycle. */
class BusyAgent implements Agent {
    public cycles = 0;
    public closed: Promise<void>;
    public runner: AgentRunner | null = null;
    private onClosed!: () => void;

    private readonly limit: number;
    public constructor(limit: number) {
        this.limit = limit;
        this.closed = new Promise((resolve) => {
            this.onClosed = resolve;
        });
    }

    public onStart(): void {}

    public doWork(): number {
        if (++this.cycles === this.limit) {
            this.runner!.close();
        }
        return 1;
    }

    public onClose(): void {
        this.onClosed();
    }

    public roleName(): string {
        return 'busy';
    }
}

interface ProfileNode {
    selfSize: number;
    children: ProfileNode[];
}

function totalBytes(node: ProfileNode): number {
    let bytes = node.selfSize;
    for (const child of node.children) {
        bytes += totalBytes(child);
    }
    return bytes;
}

describe('AgentRunnerBatchingAllocationTest', () => {
    it('Regression: a busy agent costs one setImmediate for each batch of duty cycles, not for each', () => {
        const scheduler = new CountingScheduler();
        const agent = new BusyAgent(CYCLES);
        const runner = new AgentRunner(new NoOpIdleStrategy(), mockErrorHandler(), null, agent, scheduler);
        agent.runner = runner;
        runner.run();

        const tasks = scheduler.drain(CYCLES);

        expect(agent.cycles).toBe(CYCLES);
        expect(runner.isClosed()).toBe(true);
        expect(AgentRunner.MAX_BATCHED_DUTY_CYCLES).toBeGreaterThan(1);
        expect(tasks).toBe(Math.ceil(CYCLES / AgentRunner.MAX_BATCHED_DUTY_CYCLES));
        // the first immediate is the start, one more for each task that did not end the runner
        expect(scheduler.immediates).toBe(tasks);
    });

    it('Regression: a close from inside a batch ends it at that duty cycle', () => {
        const scheduler = new CountingScheduler();
        const agent = new BusyAgent(AgentRunner.MAX_BATCHED_DUTY_CYCLES + 4);
        const runner = new AgentRunner(new NoOpIdleStrategy(), mockErrorHandler(), null, agent, scheduler);
        agent.runner = runner;
        runner.run();

        expect(scheduler.drain(10)).toBe(2);

        expect(agent.cycles).toBe(AgentRunner.MAX_BATCHED_DUTY_CYCLES + 4);
        expect(runner.isClosed()).toBe(true);
        expect(scheduler.immediates).toBe(2);
    });

    it('Regression: the event loop allocates a fraction of what one setImmediate for each duty cycle does', async () => {
        const batched = async (): Promise<void> => {
            const agent = new BusyAgent(CYCLES);
            const runner = new AgentRunner(new NoOpIdleStrategy(), mockErrorHandler(), null, agent);
            agent.runner = runner;
            runner.run();
            await agent.closed;
            expect(agent.cycles).toBe(CYCLES);
        };
        // what the runner did before: one setImmediate, with one function made once, for each duty cycle
        const unbatched = (): Promise<void> =>
            new Promise((resolve) => {
                let cycles = 0;
                const step = (): void => {
                    if (++cycles < CYCLES) {
                        setImmediate(step);
                    } else {
                        resolve();
                    }
                };
                setImmediate(step);
            });

        await batched();
        await unbatched();
        let batchedBytes = Infinity;
        let unbatchedBytes = Infinity;
        for (let round = 0; round < 3; round++) {
            unbatchedBytes = Math.min(unbatchedBytes, (await bytesAllocated(unbatched)) / CYCLES);
            batchedBytes = Math.min(batchedBytes, (await bytesAllocated(batched)) / CYCLES);
        }

        // one Immediate for each batch of MAX_BATCHED_DUTY_CYCLES: about 1/16 of the other, and fixed costs of the profiler
        expect(batchedBytes, `bytes per duty cycle (one setImmediate for each: ${unbatchedBytes})`).toBeLessThan(
            unbatchedBytes / 4,
        );
    }, 120_000);
});

/** The bytes the sampling heap profiler sees allocated while `run` runs, objects already freed included. */
async function bytesAllocated(run: () => Promise<void>): Promise<number> {
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', {
        samplingInterval: 32,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
    } as never);
    await run();
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    return totalBytes(profile.head as ProfileNode);
}
