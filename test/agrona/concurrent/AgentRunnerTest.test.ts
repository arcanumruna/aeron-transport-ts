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
// Port of org/agrona/concurrent/AgentRunnerTest.java @ Agrona 2.6.1
//
// Java starts a thread for the runner and joins it, with latches and sleeps. Here the runner is driven by a
// ManualScheduler: `runner.run()` is Java's `new Thread(runner).start()`, a latch is "run the scheduler until the
// agent has been called", and no test waits on wall time. Every drive loop is capped.
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRunner } from '../../../src/agrona/concurrent/AgentRunner.js';
import { AgentTerminationException } from '../../../src/agrona/concurrent/AgentTerminationException.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { RuntimeException } from '../../../src/agrona/jdk.js';
import { ClosedByInterruptException, Thread } from '../../../src/agrona/jdkLang.js';
import { LangUtil } from '../../../src/agrona/LangUtil.js';
import { ManualScheduler } from '../../support/ManualScheduler.js';
import { mockAgent as createMockAgent, mockErrorHandler as createMockErrorHandler } from '../../support/MockAgent.js';
import type { MockAgent, MockErrorHandler } from '../../support/MockAgent.js';
import { mock } from '../../support/Mockito.js';

/** `when(mock.method()).thenThrow(e)`: an implementation that throws. */
function thenThrow(e: Error): () => never {
    return () => {
        throw e;
    };
}

describe('AgentRunnerTest', () => {
    let mockAtomicCounter: AtomicCounter;
    let mockErrorHandler: MockErrorHandler;
    let mockAgent: MockAgent;
    let idleStrategy: NoOpIdleStrategy;
    let scheduler: ManualScheduler;
    let runner: AgentRunner;

    beforeEach(() => {
        mockAtomicCounter = mock(AtomicCounter).mock;
        mockErrorHandler = createMockErrorHandler();
        mockAgent = createMockAgent();
        idleStrategy = new NoOpIdleStrategy();
        scheduler = new ManualScheduler();
        runner = new AgentRunner(idleStrategy, mockErrorHandler, mockAtomicCounter, mockAgent, scheduler);
        Thread.interrupted();
    });

    it('shouldReturnAgent', () => {
        expect(runner.agent()).toBe(mockAgent);
    });

    it('shouldNotDoWorkOnClosedRunner', () => {
        runner.close();
        runner.run();

        expect(mockAgent.onStart).not.toHaveBeenCalled();
        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
    });

    it('shouldHandleAgentTerminationExceptionThrownByAgent', () => {
        const terminationException = new AgentTerminationException();
        mockAgent.doWork.mockImplementation(thenThrow(terminationException));

        runner.run();
        scheduler.runUntil(() => runner.isClosed()); // run() returns when the loop ends in Java

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.onError).toHaveBeenCalledExactlyOnceWith(terminationException);
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
    });

    it('shouldNotErrorWhenAgentTerminationExceptionThrownByAgentAsExpected', () => {
        const terminationException = new AgentTerminationException(true);
        mockAgent.doWork.mockImplementation(thenThrow(terminationException));

        runner.run();
        scheduler.runUntil(() => runner.isClosed()); // run() returns when the loop ends in Java

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(runner.isClosed()).toBe(true);
    });

    it('shouldReportExceptionThrownByAgent', () => {
        const expectedException = new RuntimeException();
        mockAgent.doWork.mockImplementation(thenThrow(expectedException));

        // the latch: counted down by the error handler
        let latch = 1;
        mockErrorHandler.onError.mockImplementation(() => {
            latch--;
        });

        runner.run(); // new Thread(runner).start()

        scheduler.runUntil(() => 0 === latch); // latch.await(3, SECONDS), failing with "Should have called error handler"

        expect(mockAgent.onStart).toHaveBeenCalledTimes(1);
        expect(mockAgent.doWork).toHaveBeenCalled();
        expect(mockErrorHandler.onError).toHaveBeenCalled();
        expect(mockErrorHandler.onError).toHaveBeenCalledWith(expectedException);
        expect(mockAtomicCounter.increment).toHaveBeenCalled();

        runner.close();
    });

    it('shouldNotReportClosedByInterruptException', () => {
        assertExceptionNotReported(() => {
            throw new ClosedByInterruptException();
        });
    });

    it('shouldNotReportRethrownClosedByInterruptException', () => {
        assertExceptionNotReported(() => {
            try {
                throw new ClosedByInterruptException();
            } catch (ex) {
                LangUtil.rethrowUnchecked(ex as Error);
            }
        });
    });

    // The runner thread blocks in doWork (Thread.sleep) and a second thread calls close() and is interrupted while
    // it waits for the join. A duty cycle cannot be pre-empted and close() has nothing to wait for on one JS thread.
    it.skip('shouldInterruptRunnerThreadIfCloseCallIsItselfInterruped', () => {});

    it('shouldNotInterruptRunnerThreadIfCloseCompletesOnTime', () => {
        let finished = false;
        let interrupted = false;
        mockAgent.doWork.mockImplementation(() => {
            // startLatch.countDown(); Thread.sleep(50) is not possible: a cycle is not pre-empted
            if (Thread.currentThread().isInterrupted()) {
                interrupted = true;
            }

            finished = true;
            return 0;
        });

        runner.run(); // new Thread(runner).start()
        const runnerThread = runner.thread()!;

        scheduler.runUntil(() => mockAgent.doWork.mock.calls.length > 0); // startLatch.await()

        let failCount = 0;
        runner.close(300, () => failCount++);

        expect(Thread.interrupted()).toBe(false);
        expect(runnerThread.isAlive()).toBe(false);
        expect(runnerThread.isInterrupted()).toBe(false);
        expect(finished).toBe(true);
        expect(interrupted).toBe(false);
        expect(failCount).toBe(0);
    });

    // The runner thread blocks in doWork for Integer.MAX_VALUE ms, twice, and close() interrupts it after its budget
    // each time. A duty cycle that blocks would block the event loop, and the close timeout cannot expire.
    it.skip('shouldInterruptRunnerThreadIfCloseDoesNotCompleteWithinCloseBudget', () => {});

    it('shouldInterruptRunnerThreadIfCloseCompletesOnTimeWhenMainThreadIsInterruptedBeforeTheCloseCall', () => {
        let finished = false;
        mockAgent.doWork.mockImplementation(() => {
            // startLatch.countDown(); Thread.sleep(50) is not possible: a cycle is not pre-empted
            finished = true;
            return 0;
        });

        runner.run(); // new Thread(runner).start()
        const runnerThread = runner.thread()!;

        scheduler.runUntil(() => mockAgent.doWork.mock.calls.length > 0); // startLatch.await()

        Thread.currentThread().interrupt();
        let failCount = 0;
        runner.close(300, () => failCount++);
        // the Thread.sleep(50) of the agent is interrupted by close(): the runner thread has been interrupted
        const interrupted = runnerThread.isInterrupted();

        expect(Thread.interrupted()).toBe(true);
        expect(runnerThread.isAlive()).toBe(false);
        expect(finished).toBe(true);
        expect(interrupted).toBe(true);
        expect(failCount).toBe(1);
    });

    function assertExceptionNotReported(task: () => void): void {
        // the latch: counted down by the agent before it runs the task
        let latch = 1;
        mockAgent.doWork.mockImplementation(() => {
            latch--;
            task();
            return 0;
        });

        runner.run(); // new Thread(runner).start()

        scheduler.runUntil(() => 0 === latch); // latch.await()

        runner.close();

        expect(mockAgent.onStart).toHaveBeenCalledTimes(1);
        expect(mockAgent.doWork).toHaveBeenCalled();
        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
    }
});
