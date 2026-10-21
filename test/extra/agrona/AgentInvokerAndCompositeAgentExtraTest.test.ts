// Not in Agrona: the AgentInvoker and CompositeAgent paths that the ported tests do not reach.
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentInvoker } from '../../../src/agrona/concurrent/AgentInvoker.js';
import { CompositeAgent } from '../../../src/agrona/concurrent/CompositeAgent.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { NullPointerException, RuntimeException } from '../../../src/agrona/jdk.js';
import { InterruptedException, JavaError, Thread } from '../../../src/agrona/jdkLang.js';
import { assertThrows } from '../../support/Assertions.js';
import { mockAgent as createMockAgent, mockErrorHandler as createMockErrorHandler } from '../../support/MockAgent.js';
import type { MockAgent, MockErrorHandler } from '../../support/MockAgent.js';
import { mock } from '../../support/Mockito.js';

describe('AgentInvokerExtra', () => {
    let errorHandler: MockErrorHandler;
    let counter: AtomicCounter;
    let agent: MockAgent;
    let invoker: AgentInvoker;

    beforeEach(() => {
        errorHandler = createMockErrorHandler();
        counter = mock(AtomicCounter).mock;
        agent = createMockAgent();
        invoker = new AgentInvoker(errorHandler, counter, agent);
        Thread.interrupted();
    });

    it('theConstructorRequiresAnErrorHandlerAndAnAgent', () => {
        assertThrows(NullPointerException, () => new AgentInvoker(null as never, null, agent));
        assertThrows(NullPointerException, () => new AgentInvoker(errorHandler, null, null as never));
        expect(() => new AgentInvoker(errorHandler, null, agent)).not.toThrow();
    });

    it('invokeBeforeStartDoesNothingAndReturnsZero', () => {
        agent.doWork.mockImplementation(() => 5);

        expect(invoker.invoke()).toBe(0);
        expect(agent.doWork).not.toHaveBeenCalled();
        expect(invoker.isStarted()).toBe(false);
        expect(invoker.isRunning()).toBe(false);
    });

    it('invokeReturnsTheWorkCountAndTheLifecycleFlagsFollow', () => {
        agent.doWork.mockImplementation(() => 7);

        invoker.start();
        expect(invoker.isStarted() && invoker.isRunning() && !invoker.isClosed()).toBe(true);
        expect(invoker.invoke()).toBe(7);
        invoker.close();
        expect(invoker.isRunning()).toBe(false);
        expect(invoker.isClosed()).toBe(true);
        expect(invoker.invoke()).toBe(0);
    });

    it('anErrorFromDoWorkIsReportedCountedAndRethrown', () => {
        const error = new JavaError('work');
        agent.doWork.mockImplementation(() => {
            throw error;
        });

        invoker.start();
        expect(() => invoker.invoke()).toThrow(error);

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(counter.increment).toHaveBeenCalledTimes(1);
        expect(agent.onClose).not.toHaveBeenCalled();
    });

    it('anErrorFromOnStartIsReportedAndRethrownWithoutClosing', () => {
        const error = new JavaError('start');
        agent.onStart.mockImplementation(() => {
            throw error;
        });

        expect(() => invoker.start()).toThrow(error);

        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(agent.onClose).not.toHaveBeenCalled();
        expect(invoker.isClosed()).toBe(false);
    });

    it('anExceptionFromOnCloseIsReportedAndAnErrorIsRethrown', () => {
        const exception = new RuntimeException('close');
        agent.onClose.mockImplementation(() => {
            throw exception;
        });
        invoker.close();
        expect(errorHandler.onError).toHaveBeenCalledExactlyOnceWith(exception);

        const other = new AgentInvoker(errorHandler, null, agent);
        const error = new JavaError('close');
        agent.onClose.mockImplementation(() => {
            throw error;
        });
        expect(() => other.close()).toThrow(error);
        expect(other.isClosed()).toBe(true);
    });

    it('anInterruptedThreadWithNoWorkStopsRunningButStaysOpen', () => {
        invoker.start();
        Thread.currentThread().interrupt();

        expect(invoker.invoke()).toBe(0);

        expect(invoker.isRunning()).toBe(false);
        expect(invoker.isClosed()).toBe(false);
        expect(Thread.interrupted()).toBe(true);
    });

    it('anInterruptedThreadThatDidWorkKeepsRunning', () => {
        agent.doWork.mockImplementation(() => 1);
        invoker.start();
        Thread.currentThread().interrupt();

        expect(invoker.invoke()).toBe(1);

        expect(invoker.isRunning()).toBe(true);
        Thread.interrupted();
    });

    it('anInterruptedExceptionClosesTheInvokerAndInterruptsTheThread', () => {
        agent.doWork.mockImplementation(() => {
            throw new InterruptedException();
        });
        invoker.start();

        invoker.invoke();

        expect(errorHandler.onError).not.toHaveBeenCalled();
        expect(invoker.isClosed()).toBe(true);
        expect(Thread.interrupted()).toBe(true);
    });

    it('aRuntimeExceptionIsReportedAndCountedAndTheInvokerKeepsRunning', () => {
        agent.doWork.mockImplementation(() => {
            throw new RuntimeException();
        });
        invoker.start();

        invoker.invoke();
        invoker.invoke();

        expect(errorHandler.onError).toHaveBeenCalledTimes(2);
        expect(counter.increment).toHaveBeenCalledTimes(2);
        expect(invoker.isRunning()).toBe(true);
    });

    it('aNullErrorCounterIsAllowed', () => {
        const noCounter = new AgentInvoker(errorHandler, null, agent);
        agent.doWork.mockImplementation(() => {
            throw new RuntimeException();
        });
        noCounter.start();

        noCounter.invoke();

        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
    });
});

describe('CompositeAgentExtra', () => {
    it('theRoleNameListsTheSubAgents', () => {
        const composite = new CompositeAgent(createMockAgent('conductor'), createMockAgent('sender'));

        expect(composite.roleName()).toBe('[conductor,sender]');
        expect(new CompositeAgent([createMockAgent('only')]).roleName()).toBe('[only]');
    });

    it('anArrayAndTheSameAgentsGiveTheSameComposite', () => {
        const a = createMockAgent('a');
        const b = createMockAgent('b');
        a.doWork.mockImplementation(() => 2);
        b.doWork.mockImplementation(() => 3);

        expect(new CompositeAgent([a, b]).doWork()).toBe(5);
        expect(new CompositeAgent(a, b).doWork()).toBe(5);
    });

    it('doWorkSumsTheWorkAndRunsTheSubAgentsInOrder', () => {
        const order: string[] = [];
        const agents = ['a', 'b', 'c'].map((name, i) => {
            const agent = createMockAgent(name);
            agent.doWork.mockImplementation(() => {
                order.push(name);
                return i + 1;
            });
            return agent;
        });
        const composite = new CompositeAgent(agents);

        expect(composite.doWork()).toBe(6);
        expect(composite.doWork()).toBe(6);
        expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    });

    it('afterAnExceptionTheNextDutyCycleContinuesWithTheNextSubAgent', () => {
        const order: string[] = [];
        const agents = ['a', 'b', 'c'].map((name) => {
            const agent = createMockAgent(name);
            agent.doWork.mockImplementation(() => {
                order.push(name);
                return 1;
            });
            return agent;
        });
        const error = new RuntimeException('b');
        let failB = true;
        const original = agents[1]!.doWork.getMockImplementation()!;
        agents[1]!.doWork.mockImplementation(() => {
            if (failB) {
                failB = false;
                throw error;
            }
            return original();
        });
        const composite = new CompositeAgent(agents);

        expect(() => composite.doWork()).toThrow(error);
        expect(order).toEqual(['a']);
        expect(composite.doWork()).toBe(1); // c, the rest of the interrupted cycle
        expect(composite.doWork()).toBe(3); // a full cycle again
        expect(order).toEqual(['a', 'c', 'a', 'b', 'c']);
    });

    it('onStartAndOnCloseAttemptEverySubAgentAndSuppressTheirExceptionsInOrder', () => {
        const agents = [createMockAgent('a'), createMockAgent('b'), createMockAgent('c')];
        const errors = [new RuntimeException('0'), new RuntimeException('1'), new RuntimeException('2')];
        agents[0]!.onStart.mockImplementation(() => {
            throw errors[0];
        });
        agents[2]!.onStart.mockImplementation(() => {
            throw errors[2];
        });
        agents[1]!.onClose.mockImplementation(() => {
            throw errors[1];
        });
        const composite = new CompositeAgent(agents);

        const onStartError = assertThrows(RuntimeException, () => composite.onStart());
        expect(onStartError.message).toBe('CompositeAgent: underlying agent error on start');
        expect(onStartError.getSuppressed()).toEqual([errors[0], errors[2]]);
        const onCloseError = assertThrows(RuntimeException, () => composite.onClose());
        expect(onCloseError.message).toBe('CompositeAgent: underlying agent error on close');
        expect(onCloseError.getSuppressed()).toEqual([errors[1]]);
        for (const agent of agents) {
            expect(agent.onStart).toHaveBeenCalledTimes(1);
            expect(agent.onClose).toHaveBeenCalledTimes(1);
        }
    });
});
