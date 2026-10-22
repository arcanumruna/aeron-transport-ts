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
// Port of org/agrona/concurrent/AgentInvokerTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentInvoker } from '../../../src/agrona/concurrent/AgentInvoker.js';
import { AgentTerminationException } from '../../../src/agrona/concurrent/AgentTerminationException.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { RuntimeException } from '../../../src/agrona/jdk.js';
import { ClosedByInterruptException, Thread } from '../../../src/agrona/jdkLang.js';
import { LangUtil } from '../../../src/agrona/LangUtil.js';
import {
    mockAgent as createMockAgent,
    mockErrorHandler as createMockErrorHandler,
    resetAgent,
} from '../../support/MockAgent.js';
import type { MockAgent, MockErrorHandler } from '../../support/MockAgent.js';
import { mock } from '../../support/Mockito.js';

/** `when(mock.method()).thenThrow(e)`: an implementation that throws. */
function thenThrow(e: Error): () => never {
    return () => {
        throw e;
    };
}

describe('AgentInvokerTest', () => {
    let mockErrorHandler: MockErrorHandler;
    let mockAtomicCounter: AtomicCounter;
    let mockAgent: MockAgent;
    let invoker: AgentInvoker;

    beforeEach(() => {
        mockErrorHandler = createMockErrorHandler();
        const counter = mock(AtomicCounter);
        mockAtomicCounter = counter.mock;
        mockAgent = createMockAgent();
        invoker = new AgentInvoker(mockErrorHandler, mockAtomicCounter, mockAgent);
        Thread.interrupted();
    });

    it('shouldFollowLifecycle', () => {
        invoker.start();
        invoker.start();
        expect(mockAgent.onStart).toHaveBeenCalledTimes(1);
        expect(mockAgent.doWork).toHaveBeenCalledTimes(0); // verifyNoMoreInteractions(mockAgent)
        expect(mockAgent.onClose).toHaveBeenCalledTimes(0);
        expect(mockAgent.roleName).toHaveBeenCalledTimes(0);

        invoker.invoke();
        invoker.invoke();
        expect(mockAgent.doWork).toHaveBeenCalledTimes(2);
        expect(mockAgent.onStart).toHaveBeenCalledTimes(1);
        expect(mockAgent.onClose).toHaveBeenCalledTimes(0);
        expect(mockAgent.roleName).toHaveBeenCalledTimes(0);

        invoker.close();
        invoker.close();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(mockAgent.onStart).toHaveBeenCalledTimes(1);
        expect(mockAgent.doWork).toHaveBeenCalledTimes(2);
        expect(mockAgent.roleName).toHaveBeenCalledTimes(0);
    });

    it('shouldReturnAgent', () => {
        expect(invoker.agent()).toBe(mockAgent);
    });

    it('shouldNotDoWorkOnClosedRunnerButCallOnClose', () => {
        invoker.close();
        invoker.invoke();

        expect(mockAgent.onStart).not.toHaveBeenCalled();
        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
    });

    it('shouldReportExceptionThrownByAgent', () => {
        const expectedException = new RuntimeException();
        mockAgent.doWork.mockImplementation(thenThrow(expectedException));

        invoker.start();
        invoker.invoke();

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.onError).toHaveBeenCalledExactlyOnceWith(expectedException);
        expect(mockAtomicCounter.increment).toHaveBeenCalledTimes(1);
        expect(mockAgent.onClose).not.toHaveBeenCalled();
        resetAgent(mockAgent);

        invoker.invoke();

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        resetAgent(mockAgent);

        invoker.close();

        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
    });

    it('shouldReportExceptionThrownOnStart', () => {
        const expectedException = new RuntimeException();
        mockAgent.onStart.mockImplementation(thenThrow(expectedException));

        invoker.start();
        invoker.invoke();

        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(mockErrorHandler.onError).toHaveBeenCalledExactlyOnceWith(expectedException);
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);

        expect(invoker.isStarted()).toBe(true);
        expect(invoker.isRunning()).toBe(false);
        expect(invoker.isClosed()).toBe(true);
    });

    it('shouldHandleAgentTerminationExceptionThrownByAgent', () => {
        const expectedException = new AgentTerminationException();
        mockAgent.doWork.mockImplementation(thenThrow(expectedException));

        invoker.start();
        invoker.invoke();

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.onError).toHaveBeenCalledExactlyOnceWith(expectedException);
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(invoker.isClosed()).toBe(true);

        resetAgent(mockAgent);
        invoker.invoke();

        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(invoker.isClosed()).toBe(true);
    });

    it('shouldHandleExpectedAgentTerminationExceptionThrownByAgentByNotReportingIt', () => {
        const terminationException = new AgentTerminationException(true);
        mockAgent.doWork.mockImplementation(thenThrow(terminationException));

        invoker.start();
        invoker.invoke();

        expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
        expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
        expect(invoker.isClosed()).toBe(true);

        resetAgent(mockAgent);
        invoker.invoke();

        expect(mockAgent.doWork).not.toHaveBeenCalled();
        expect(invoker.isClosed()).toBe(true);
    });

    it('shouldStopRunningOnRuntimeException', () => {
        try {
            const expectedException = new RuntimeException();
            mockAgent.doWork.mockImplementation(thenThrow(expectedException));
            mockErrorHandler.onError.mockImplementation(() => {
                Thread.currentThread().interrupt();
            });

            invoker.start();
            invoker.invoke();

            expect(mockAgent.doWork).toHaveBeenCalledTimes(1);
            expect(mockErrorHandler.onError).toHaveBeenCalledExactlyOnceWith(expectedException);
            expect(mockAtomicCounter.increment).toHaveBeenCalledTimes(1);
            expect(mockAgent.onClose).toHaveBeenCalledTimes(1);
            expect(invoker.isClosed()).toBe(true);
            expect(invoker.isRunning()).toBe(false);

            resetAgent(mockAgent);
            invoker.invoke();

            expect(mockAgent.doWork).not.toHaveBeenCalled();
            expect(invoker.isClosed()).toBe(true);
        } finally {
            expect(Thread.interrupted()).toBe(true);
        }
    });

    it('shouldNotReportClosedByInterruptException', () => {
        mockAgent.doWork.mockImplementation(thenThrow(new ClosedByInterruptException()));

        assertExceptionNotReported();
        expect(Thread.interrupted()).toBe(true); // by throwing ClosedByInterruptException
    });

    it('shouldNotReportRethrownClosedByInterruptException', () => {
        mockAgent.doWork.mockImplementation(() => {
            try {
                throw new ClosedByInterruptException();
            } catch (ex) {
                LangUtil.rethrowUnchecked(ex as Error);
            }

            return 0;
        });

        assertExceptionNotReported();
        expect(Thread.interrupted()).toBe(true); // by throwing ClosedByInterruptException
    });

    function assertExceptionNotReported(): void {
        invoker.start();
        invoker.invoke();
        invoker.close();

        expect(mockErrorHandler.onError).not.toHaveBeenCalled();
        expect(mockAtomicCounter.increment).not.toHaveBeenCalled();
    }
});
