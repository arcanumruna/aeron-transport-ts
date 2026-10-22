// Not in Agrona: the duty cycle, the counters and the command queue allocate nothing per call (spec 5.3). A minor
// garbage collection happens only after something is allocated, so the test counts the collections over a long loop
// (see test/support/Allocation.ts, which also sets the test timeout). Values are int-sized: a long above 2^31 boxes in
// V8 whatever the code does.
//
// Node itself allocates one Immediate for each setImmediate; the runner's own code allocates nothing, which the test
// shows with a scheduler that only stores the task.
import { describe, expect, it } from 'vitest';
import { AgentInvoker } from '../../../src/agrona/concurrent/AgentInvoker.js';
import { AgentRunner } from '../../../src/agrona/concurrent/AgentRunner.js';
import type { AgentRunnerScheduler } from '../../../src/agrona/concurrent/AgentRunner.js';
import { BackoffIdleStrategy } from '../../../src/agrona/concurrent/BackoffIdleStrategy.js';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { CompositeAgent } from '../../../src/agrona/concurrent/CompositeAgent.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { Agent } from '../../../src/agrona/concurrent/Agent.js';
import { ITERATIONS, expectNoAllocation, measure } from '../../support/Allocation.js';
import { mockErrorHandler } from '../../support/MockAgent.js';

/** A scheduler that holds the one pending task, to run it without a queue or a timer of its own. */
class SingleSlotScheduler implements AgentRunnerScheduler {
    public task: (() => void) | null = null;

    public setImmediate(task: () => void): void {
        this.task = task;
    }

    public setTimeout(task: () => void): unknown {
        this.task = task;
        return 0;
    }

    public clearTimeout(): void {
        this.task = null;
    }
}

describe('AgentAllocation', () => {
    it('theHarnessSeesAnAllocatingLoop', async () => {
        const sink: object[] = [];
        const { collections } = await measure((n) => {
            for (let i = 0; i < n; i++) {
                sink[i & 7] = { i, a: new Array(8).fill(i) };
            }
        }, ITERATIONS);
        expect(collections).toBeGreaterThan(0);
    });

    it('anAtomicCounterAllocatesNothingPerOperation', async () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(16 * CountersReader.COUNTER_LENGTH));
        const counter = new AtomicCounter(buffer, 3);
        const position = new UnsafeBufferPosition(buffer, 4);

        await expectNoAllocation((n) => {
            // only the low bits of the results are kept: a running sum past 2^31 would itself be boxed by V8
            let sum = 0;
            for (let i = 0; i < n; i++) {
                counter.set(i & 0xffff);
                sum += (counter.increment() & 1) + (counter.get() & 1) + (counter.incrementRelease() & 1);
                sum += (counter.getAcquire() & 1) + (counter.getAndAdd(1) & 1) + (counter.decrementOpaque() & 1);
                sum += counter.proposeMax(i & 0xff) ? 1 : 0;
                position.setRelease(i & 0xffff);
                sum += (position.getVolatile() & 1) + (position.proposeMaxRelease(i & 0xfff) ? 1 : 0);
                sum &= 0xffff;
            }
            expect(sum).toBeGreaterThanOrEqual(0);
        });
    });

    it('theCommandQueueAllocatesNothingPerOfferPollAndDrain', async () => {
        const queue = new OneToOneConcurrentArrayQueue<() => void>(64);
        let runs = 0;
        const command = (): void => {
            runs++;
        };
        const consume = (c: () => void): void => c();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                queue.offer(command);
                queue.offer(command);
                queue.offer(command);
                queue.poll()!();
                queue.drain(consume);
            }
        });
        expect(runs).toBeGreaterThan(0);
    });

    it('aCompositeAgentAndAnInvokerAllocateNothingPerDutyCycle', async () => {
        let work = 0;
        const part: Agent = { onStart: () => {}, doWork: () => ++work & 1, onClose: () => {}, roleName: () => 'part' };
        const composite = new CompositeAgent(part, part, part);
        const invoker = new AgentInvoker(mockErrorHandler(), null, composite);
        invoker.start();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                invoker.invoke();
            }
        });
        expect(work).toBeGreaterThan(0);
    });

    it('aRunnerDutyCycleAllocatesNothingBeyondTheSchedulersOwnTask', async () => {
        let work = 0;
        const busyAndIdle: Agent = {
            onStart: () => {},
            doWork: () => ++work % 3,
            onClose: () => {},
            roleName: () => 'cycle',
        };
        const scheduler = new SingleSlotScheduler();
        const runner = new AgentRunner(new BackoffIdleStrategy(), mockErrorHandler(), null, busyAndIdle, scheduler);
        runner.run();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                scheduler.task!();
            }
        });
        expect(work).toBeGreaterThan(0);
        runner.close();
    });

    it('aNoOpRunnerAndTheNanoClocksAllocateNothing', async () => {
        const clock = new CachedNanoClock();
        const scheduler = new SingleSlotScheduler();
        let cycles = 0;
        const agent: Agent = {
            onStart: () => {},
            doWork: () => cycles++ & 1,
            onClose: () => {},
            roleName: () => 'noop',
        };
        new AgentRunner(new NoOpIdleStrategy(), mockErrorHandler(), null, agent, scheduler).run();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                clock.update(i);
                clock.advance(1);
                scheduler.task!();
            }
        });
        expect(clock.nanoTime()).toBeGreaterThan(0);
    });

    it('allocatingAndFreeingCountersStaysOffTheHotPathButNeverGrowsTheFreeListUnbounded', () => {
        const manager = new CountersManager(
            new UnsafeBuffer(new ArrayBuffer(4 * CountersReader.METADATA_LENGTH)),
            new UnsafeBuffer(new ArrayBuffer(4 * CountersReader.COUNTER_LENGTH)),
        );

        for (let i = 0; i < 10_000; i++) {
            const counter = manager.newCounter('c');
            counter.increment();
            counter.close();
        }

        expect(manager.available()).toBe(4);
    });
});
