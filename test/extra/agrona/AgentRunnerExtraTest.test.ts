// Not in Agrona: how the AgentRunner puts duty cycles on the event loop (spec D3, D8, D11), and the paths of the Java
// run loop that the ported AgentRunnerTest does not reach. All of it is driven by a ManualScheduler, so nothing waits
// on wall time and every drive loop is capped; the one test on the real event loop ends by itself.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/agrona/concurrent/Agent.js';
import { AgentRunner, NODE_SCHEDULER } from '../../../src/agrona/concurrent/AgentRunner.js';
import { AgentTerminationException } from '../../../src/agrona/concurrent/AgentTerminationException.js';
import { BackoffIdleStrategy } from '../../../src/agrona/concurrent/BackoffIdleStrategy.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { SleepingIdleStrategy } from '../../../src/agrona/concurrent/SleepingIdleStrategy.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { RuntimeException } from '../../../src/agrona/jdk.js';
import { InterruptedException, JavaError, Thread } from '../../../src/agrona/jdkLang.js';
import { ManualScheduler } from '../../support/ManualScheduler.js';
import { mockAgent as createMockAgent, mockErrorHandler as createMockErrorHandler } from '../../support/MockAgent.js';
import type { MockAgent, MockErrorHandler } from '../../support/MockAgent.js';
import { mock } from '../../support/Mockito.js';

describe('AgentRunnerExtra', () => {
    let errorHandler: MockErrorHandler;
    let agent: MockAgent;
    let scheduler: ManualScheduler;

    beforeEach(() => {
        errorHandler = createMockErrorHandler();
        agent = createMockAgent('role');
        scheduler = new ManualScheduler();
        Thread.interrupted();
    });

    function newRunner(idleStrategy = new NoOpIdleStrategy(), counter: AtomicCounter | null = null): AgentRunner {
        return new AgentRunner(idleStrategy, errorHandler, counter, agent, scheduler);
    }

    it('runStartsTheAgentAndSchedulesTheFirstCycleOnImmediate', () => {
        const runner = newRunner();

        runner.run();

        expect(agent.onStart).toHaveBeenCalledTimes(1);
        expect(agent.doWork).not.toHaveBeenCalled();
        expect(scheduler.pendingImmediates()).toBe(1);
        expect(scheduler.pendingTimers()).toBe(0);
        expect(runner.thread()).not.toBeNull();
        expect(runner.thread()!.isAlive()).toBe(true);
        expect(runner.thread()!.getName()).toBe('role');
        expect(runner.isClosed()).toBe(false);
    });

    it('aBusyAgentRunsABatchOfDutyCyclesPerImmediateAndNeverUsesATimer', () => {
        agent.doWork.mockImplementation(() => 1);
        const runner = newRunner(new BackoffIdleStrategy());

        runner.run();
        for (let i = 1; i <= 50; i++) {
            scheduler.runSteps(1);
            expect(agent.doWork).toHaveBeenCalledTimes(i * AgentRunner.MAX_BATCHED_DUTY_CYCLES);
            expect(scheduler.pendingImmediates()).toBe(1);
            expect(scheduler.pendingTimers()).toBe(0);
        }

        runner.close();
    });

    it('anIdleAgentBacksOffThroughSpinsAndYieldsOnImmediatesThenParksOnDoublingTimers', () => {
        // 2 spins, 1 yield, then parks of 1 ms doubling up to 4 ms
        const runner = newRunner(new BackoffIdleStrategy(2, 1, 1_000_000, 4_000_000));

        runner.run();
        // idle() calls 1 to 5 spin and yield: the next cycle is on an immediate
        for (let i = 1; i <= 5; i++) {
            scheduler.runSteps(1);
            expect(agent.doWork).toHaveBeenCalledTimes(i);
            expect(scheduler.pendingImmediates()).toBe(1);
            expect(scheduler.pendingTimers()).toBe(0);
        }

        // the parks: 1, 2, 4, 4 ms. A timer runs the next duty cycle itself, which parks again.
        scheduler.runSteps(1);
        expect(scheduler.pendingImmediates()).toBe(0);
        expect(scheduler.timerDelays()).toEqual([1]);
        let previousDelayMs = 1;
        for (const delayMs of [2, 4, 4]) {
            const before = scheduler.now();
            scheduler.runSteps(1);
            expect(scheduler.now() - before).toBe(previousDelayMs);
            expect(scheduler.pendingImmediates()).toBe(0);
            expect(scheduler.timerDelays()).toEqual([delayMs]);
            previousDelayMs = delayMs;
        }

        // work resets the back-off
        agent.doWork.mockImplementation(() => 1);
        scheduler.runSteps(1);
        expect(scheduler.pendingImmediates()).toBe(1);
        expect(scheduler.pendingTimers()).toBe(0);

        runner.close();
    });

    it('aParkShorterThanOneMillisecondIsOneMillisecond', () => {
        const runner = newRunner(new SleepingIdleStrategy(1000)); // 1 us

        runner.run();
        scheduler.runSteps(1);

        expect(scheduler.timerDelays()).toEqual([1]);
        runner.close();
    });

    it('aParkRoundsUpToWholeMilliseconds', () => {
        const runner = newRunner(new SleepingIdleStrategy(2_500_000)); // 2.5 ms

        runner.run();
        scheduler.runSteps(1);

        expect(scheduler.timerDelays()).toEqual([3]);
        runner.close();
    });

    it('wakeCancelsThePendingParkAndSchedulesExactlyOneImmediate', () => {
        const runner = newRunner(new SleepingIdleStrategy(5_000_000));

        runner.run();
        scheduler.runSteps(1); // first cycle: now parked
        expect(scheduler.pendingTimers()).toBe(1);
        expect(agent.doWork).toHaveBeenCalledTimes(1);

        runner.wake();
        runner.wake();
        runner.wake();

        expect(scheduler.pendingTimers()).toBe(0);
        expect(scheduler.pendingImmediates()).toBe(1);

        scheduler.runSteps(1);
        expect(agent.doWork).toHaveBeenCalledTimes(2);
        expect(scheduler.now()).toBe(0); // it did not wait for the park
        expect(scheduler.pendingTimers()).toBe(1); // idle again: parked again

        runner.close();
    });

    it('wakeDoesNothingUnlessTheRunnerIsParked', () => {
        const runner = newRunner(new SleepingIdleStrategy(5_000_000));

        runner.wake(); // not started
        expect(scheduler.pendingImmediates()).toBe(0);
        expect(scheduler.pendingTimers()).toBe(0);

        runner.run();
        runner.wake(); // an immediate is pending
        expect(scheduler.pendingImmediates()).toBe(1);

        runner.close();
        runner.wake(); // closed
        expect(scheduler.pendingImmediates()).toBe(1); // the one that was pending, now a no-op
        expect(scheduler.pendingTimers()).toBe(0);
        scheduler.runAll();
        expect(agent.doWork).not.toHaveBeenCalled();
    });

    it('closeCancelsAPendingParkAndCallsOnCloseOnce', () => {
        const runner = newRunner(new SleepingIdleStrategy(5_000_000));

        runner.run();
        scheduler.runSteps(1);
        expect(scheduler.pendingTimers()).toBe(1);

        runner.close();

        expect(scheduler.pendingTimers()).toBe(0);
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
        expect(runner.thread()!.isAlive()).toBe(false);

        runner.close();
        scheduler.runAll();
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(agent.doWork).toHaveBeenCalledTimes(1);
    });

    it('closeBeforeRunCallsOnCloseOnceAndRunDoesNothing', () => {
        const runner = newRunner();

        runner.close();
        runner.close();
        runner.run();

        expect(runner.thread()).toBe(AgentRunner.TOMBSTONE);
        expect(agent.onStart).not.toHaveBeenCalled();
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(scheduler.pendingImmediates()).toBe(0);
    });

    it('aSecondRunDoesNotStartTheAgentAgain', () => {
        const runner = newRunner();

        runner.run();
        const thread = runner.thread();
        runner.run();

        expect(agent.onStart).toHaveBeenCalledTimes(1);
        expect(runner.thread()).toBe(thread);
        expect(scheduler.pendingImmediates()).toBe(1);
        runner.close();
    });

    it('startOnThreadRunsTheRunnerAndReturnsItsThread', () => {
        const runner = newRunner();

        const thread = AgentRunner.startOnThread(runner);

        expect(thread).toBe(runner.thread());
        expect(thread.getName()).toBe('role');
        expect(agent.onStart).toHaveBeenCalledTimes(1);
        runner.close();
    });

    it('closeFromInsideTheAgentEndsTheLoopAfterTheCycle', () => {
        const runner = newRunner();
        let closedInCycle: boolean | undefined;
        agent.doWork.mockImplementation(() => {
            runner.close();
            closedInCycle = runner.isClosed();
            return 1;
        });

        runner.run();
        scheduler.runSteps(1);

        expect(closedInCycle).toBe(false); // the cycle in progress is not abandoned
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
        expect(scheduler.runAll()).toBe(0);
        expect(agent.doWork).toHaveBeenCalledTimes(1);
    });

    it('closeFromInsideOnStartStopsTheRunnerWithoutADutyCycle', () => {
        const runner = newRunner();
        agent.onStart.mockImplementation(() => runner.close());

        runner.run();

        expect(agent.doWork).not.toHaveBeenCalled();
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
        expect(scheduler.runAll()).toBe(0);
    });

    it('anExceptionFromOnStartIsReportedAndTheRunnerClosesWithoutADutyCycle', () => {
        const error = new RuntimeException('start');
        agent.onStart.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner();

        runner.run();

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(agent.doWork).not.toHaveBeenCalled();
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
        expect(runner.thread()!.isAlive()).toBe(false);
        expect(scheduler.pendingImmediates()).toBe(0);
    });

    it('anErrorFromOnStartIsReportedAndRethrownAndOnCloseIsNotCalled', () => {
        const error = new JavaError('start');
        agent.onStart.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner();

        expect(() => runner.run()).toThrow(error);

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(agent.onClose).not.toHaveBeenCalled();
        expect(runner.isClosed()).toBe(true);
        expect(runner.thread()!.isAlive()).toBe(false);
        expect(Thread.currentThread().getName()).toBe('main');
    });

    it('anErrorFromDoWorkIsReportedAndRethrownAndTheThreadEndsWithoutOnClose', () => {
        const error = new JavaError('work');
        agent.doWork.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner(new NoOpIdleStrategy(), mock(AtomicCounter).mock);

        runner.run();
        expect(() => scheduler.runSteps(1)).toThrow(error);

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(agent.onClose).not.toHaveBeenCalled();
        expect(runner.isClosed()).toBe(true);
        expect(runner.thread()!.isAlive()).toBe(false);
        expect(Thread.currentThread().getName()).toBe('main');
        expect(scheduler.runAll()).toBe(0);
    });

    it('aRuntimeExceptionFromDoWorkIsReportedAndCountedAndTheLoopGoesOn', () => {
        const error = new RuntimeException('work');
        const counter = mock(AtomicCounter).mock;
        agent.doWork.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner(new NoOpIdleStrategy(), counter);

        runner.run();
        scheduler.runSteps(3);

        expect(errorHandler.onError).toHaveBeenCalledTimes(3);
        expect(counter.increment).toHaveBeenCalledTimes(3);
        expect(runner.isClosed()).toBe(false);
        expect(scheduler.pendingImmediates()).toBe(1);
        runner.close();
    });

    it('aClosedErrorCounterIsNotIncremented', () => {
        const counter = mock(AtomicCounter).mock;
        (counter.isClosed as unknown as { mockReturnValue(v: boolean): void }).mockReturnValue(true);
        agent.doWork.mockImplementation(() => {
            throw new RuntimeException();
        });
        const runner = newRunner(new NoOpIdleStrategy(), counter);

        runner.run();
        scheduler.runSteps(2);

        expect(errorHandler.onError).toHaveBeenCalledTimes(2);
        expect(counter.increment).not.toHaveBeenCalled();
        runner.close();
    });

    it('anExceptionFromOnCloseIsReportedAndTheRunnerIsClosed', () => {
        const error = new RuntimeException('close');
        agent.onClose.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner();

        runner.run();
        runner.close();

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(runner.isClosed()).toBe(true);
    });

    it('anExceptionFromOnCloseOfARunnerThatNeverRanIsReported', () => {
        const error = new RuntimeException('close');
        agent.onClose.mockImplementation(() => {
            throw error;
        });
        const runner = newRunner();

        runner.close();

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(runner.isClosed()).toBe(true);
    });

    it('anInterruptedThreadWithNoWorkStopsTheLoop', () => {
        agent.doWork.mockImplementation(() => {
            Thread.currentThread().interrupt();
            return 0;
        });
        const runner = newRunner();

        runner.run();
        scheduler.runUntil(() => runner.isClosed());

        expect(agent.doWork).toHaveBeenCalledTimes(1);
        expect(agent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.thread()!.isInterrupted()).toBe(true);
        expect(Thread.currentThread().isInterrupted()).toBe(false); // the main thread's flag is its own
    });

    it('anInterruptedThreadThatDidWorkKeepsGoingUntilItHasNone', () => {
        let work = 3;
        agent.doWork.mockImplementation(() => {
            Thread.currentThread().interrupt();
            return work-- > 0 ? 1 : 0;
        });
        const runner = newRunner();

        runner.run();
        scheduler.runUntil(() => runner.isClosed());

        expect(agent.doWork).toHaveBeenCalledTimes(4);
    });

    it('anInterruptedExceptionStopsTheLoopWithoutReportingAndInterruptsTheThread', () => {
        agent.doWork.mockImplementation(() => {
            throw new InterruptedException();
        });
        const runner = newRunner();

        runner.run();
        scheduler.runUntil(() => runner.isClosed());

        expect(errorHandler.onError).not.toHaveBeenCalled();
        expect(runner.thread()!.isInterrupted()).toBe(true);
        expect(agent.onClose).toHaveBeenCalledTimes(1);
    });

    it('aRuntimeExceptionThatInterruptsTheThreadStopsTheLoop', () => {
        agent.doWork.mockImplementation(() => {
            Thread.currentThread().interrupt();
            throw new RuntimeException();
        });
        const runner = newRunner();

        runner.run();
        scheduler.runUntil(() => runner.isClosed());

        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
        expect(agent.doWork).toHaveBeenCalledTimes(1);
    });

    it('theCurrentThreadIsTheRunnersDuringAnAgentCallAndTheCallersOtherwise', () => {
        const seen: (Thread | undefined)[] = [];
        const runner = newRunner();
        agent.onStart.mockImplementation(() => void seen.push(Thread.currentThread()));
        agent.doWork.mockImplementation(() => {
            seen.push(Thread.currentThread());
            throw new AgentTerminationException(true);
        });
        agent.onClose.mockImplementation(() => void seen.push(Thread.currentThread()));

        runner.run();
        expect(Thread.currentThread().getName()).toBe('main');
        scheduler.runUntil(() => runner.isClosed());

        expect(seen).toEqual([runner.thread(), runner.thread(), runner.thread()]);
        expect(Thread.currentThread().getName()).toBe('main');
    });

    it('closeFromAnInterruptedCallerInterruptsTheRunnerAndRestoresTheCallersFlag', () => {
        const runner = newRunner();
        const failed: Thread[] = [];
        runner.run();
        scheduler.runSteps(1);

        const runnerThread = runner.thread()!;
        Thread.currentThread().interrupt();
        runner.close(100, (t) => failed.push(t));

        expect(failed).toEqual([runnerThread]);
        expect(runnerThread.isInterrupted()).toBe(true);
        expect(Thread.interrupted()).toBe(true);
        expect(runner.isClosed()).toBe(true);
    });

    it('closeFromAnInterruptedCallerDoesNotCallTheFailActionIfTheRunnerThreadIsAlreadyInterruptedRegression', () => {
        const runner = newRunner();
        const failed: Thread[] = [];
        runner.run();
        scheduler.runSteps(1);

        runner.thread()!.interrupt();
        Thread.currentThread().interrupt();
        runner.close(100, (t) => failed.push(t));

        expect(failed).toEqual([]); // Java: wasInterrupted && !thread.isInterrupted()
        expect(Thread.interrupted()).toBe(true); // the restore is keyed on wasInterrupted
        expect(runner.isClosed()).toBe(true);
    });

    it('closeRestoresTheCallersInterruptFlagWhenOnCloseThrowsAnErrorRegression', () => {
        const runner = newRunner();
        const error = new JavaError('close');
        agent.onClose.mockImplementation(() => {
            throw error;
        });
        runner.run();
        scheduler.runSteps(1);

        Thread.currentThread().interrupt();
        let thrown: unknown;
        try {
            runner.close(100, () => {});
        } catch (t) {
            thrown = t;
        }

        expect(thrown).toBe(error); // spec D11: reaches the caller, in Java it stays on the runner thread
        expect(errorHandler.onError).toHaveBeenCalledWith(error);
        expect(Thread.interrupted()).toBe(true);
        expect(runner.isClosed()).toBe(true);
    });

    it('startOnThreadReturnsTheRunnerThreadWhenTheAgentClosesItselfInOnStartRegression', () => {
        const runner = newRunner();
        agent.onStart.mockImplementation(() => runner.close());

        const thread = AgentRunner.startOnThread(runner);

        expect(thread).not.toBe(AgentRunner.TOMBSTONE);
        expect(thread.getName()).toBe('role');
        expect(thread.isAlive()).toBe(false);
        expect(runner.isClosed()).toBe(true);
    });

    it('closeFromAnInterruptedCallerWithNoFailActionWritesToStderr', () => {
        const runner = newRunner();
        runner.run();
        const lines: unknown[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => void lines.push(args.join(' '));
        try {
            Thread.currentThread().interrupt();
            runner.close();
        } finally {
            console.error = original;
            Thread.interrupted();
        }

        expect(lines).toEqual(['role failed to close due to close interrupted, retrying...']);
    });

    it('theNodeSchedulerRunsADutyCyclePerImmediateUntilTheAgentTerminates', async () => {
        let cycles = 0;
        const done = new Promise<void>((resolve) => {
            const testAgent: Agent = {
                onStart: () => {},
                doWork: () => {
                    if (++cycles === 20) {
                        throw new AgentTerminationException(true);
                    }
                    return 1;
                },
                onClose: () => resolve(),
                roleName: () => 'node',
            };
            AgentRunner.startOnThread(new AgentRunner(new NoOpIdleStrategy(), errorHandler, null, testAgent));
        });

        await done;

        expect(cycles).toBe(20);
        expect(errorHandler.onError).not.toHaveBeenCalled();
    });

    it('theNodeSchedulerParksOnATimerAndWakeSkipsThePark', async () => {
        const events: string[] = [];
        let runner: AgentRunner;
        const done = new Promise<void>((resolve) => {
            let cycles = 0;
            const testAgent: Agent = {
                onStart: () => {},
                doWork: () => {
                    cycles++;
                    events.push('cycle ' + cycles);
                    if (cycles === 3) {
                        throw new AgentTerminationException(true);
                    }
                    return 0;
                },
                onClose: () => resolve(),
                roleName: () => 'node',
            };
            // a park of 1 hour that only wake() ends
            runner = new AgentRunner(new SleepingIdleStrategy(3_600_000_000_000), errorHandler, null, testAgent);
        });
        runner!.run();

        // an immediate runs cycle 1, which parks on a timer; wake from a later macrotask
        await new Promise<void>((resolve) => NODE_SCHEDULER.setImmediate(resolve));
        await new Promise<void>((resolve) => NODE_SCHEDULER.setImmediate(resolve));
        expect(events).toEqual(['cycle 1']);
        runner!.wake();
        await new Promise<void>((resolve) => NODE_SCHEDULER.setImmediate(resolve));
        expect(events).toEqual(['cycle 1', 'cycle 2']);
        runner!.wake();
        await done;

        expect(events).toEqual(['cycle 1', 'cycle 2', 'cycle 3']);
    });
});
