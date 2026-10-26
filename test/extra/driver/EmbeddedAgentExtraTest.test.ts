// Extra tests of T22 (port-only, spec 4.1, D8, D11, D100): the agent that the runner of an embedded driver runs (the driver's
// invoker, then the conductors of the clients that are hosted), and what `MediaDriver.launch` and `Aeron.connect` do with it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentInvoker } from '../../../src/agrona/concurrent/AgentInvoker.js';
import { AgentTerminationException } from '../../../src/agrona/concurrent/AgentTerminationException.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { ConfigurationException } from '../../../src/client/exceptions/ConfigurationException.js';
import { EmbeddedAgent } from '../../../src/driver/EmbeddedAgent.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { mockAgent, mockErrorHandler } from '../../support/MockAgent.js';
import type { MockAgent } from '../../support/MockAgent.js';

function started(agent: MockAgent): AgentInvoker {
    const invoker = new AgentInvoker(mockErrorHandler(), null, agent);
    invoker.start();
    return invoker;
}

describe('EmbeddedAgent', () => {
    it('runsTheDriverAndThenEachHostedClientInTheOrderTheyWereHosted', () => {
        const calls: string[] = [];
        const driver = mockAgent('driver');
        const one = mockAgent('one');
        const two = mockAgent('two');
        driver.doWork.mockImplementation(() => (calls.push('driver'), 1));
        one.doWork.mockImplementation(() => (calls.push('one'), 2));
        two.doWork.mockImplementation(() => (calls.push('two'), 4));
        const agent = new EmbeddedAgent(started(driver));

        expect(agent.doWork()).toBe(1);
        agent.host(started(one));
        agent.host(started(two));
        expect(agent.hostedCount()).toBe(2);
        calls.length = 0;

        expect(agent.doWork()).toBe(7);
        expect(calls).toEqual(['driver', 'one', 'two']);
        expect(agent.roleName()).toBe('driver');
    });

    it('hostingTheSameInvokerTwiceRunsItOnce', () => {
        const one = mockAgent('one');
        const invoker = started(one);
        const agent = new EmbeddedAgent(started(mockAgent('driver')));

        agent.host(invoker);
        agent.host(invoker);
        agent.doWork();

        expect(agent.hostedCount()).toBe(1);
        expect(one.doWork).toHaveBeenCalledTimes(1);
    });

    it('anInvokerThatIsNotHostedAnymoreIsNotRunAndRemovingOneThatIsNotThereDoesNothing', () => {
        const one = mockAgent('one');
        const invoker = started(one);
        const agent = new EmbeddedAgent(started(mockAgent('driver')));
        agent.host(invoker);

        agent.unhost(started(mockAgent('other')));
        expect(agent.hostedCount()).toBe(1);
        agent.unhost(invoker);
        agent.unhost(invoker);
        agent.doWork();

        expect(agent.hostedCount()).toBe(0);
        expect(one.doWork).not.toHaveBeenCalled();
    });

    it('aClientThatClosesAnotherDuringTheCycleLeavesTheCycleInProgressWithTheListItStartedWith', () => {
        const agent = new EmbeddedAgent(started(mockAgent('driver')));
        const second = mockAgent('second');
        const secondInvoker = started(second);
        const first = mockAgent('first');
        first.doWork.mockImplementation(() => {
            agent.unhost(secondInvoker);
            return 0;
        });
        agent.host(started(first));
        agent.host(secondInvoker);

        agent.doWork();
        expect(second.doWork).toHaveBeenCalledTimes(1); // the cycle that was in progress
        agent.doWork();
        expect(second.doWork).toHaveBeenCalledTimes(1); // and the next one is without it
        expect(agent.hostedCount()).toBe(1);
    });

    it('endsTheRunnerWhenTheDriverInvokerIsClosed', () => {
        const driver = mockAgent('driver');
        const driverInvoker = started(driver);
        const agent = new EmbeddedAgent(driverInvoker);

        driverInvoker.close();
        const thrown = (() => {
            try {
                agent.doWork();
                return null;
            } catch (ex) {
                return ex;
            }
        })();

        expect(thrown).toBeInstanceOf(AgentTerminationException);
        expect((thrown as AgentTerminationException).isExpected()).toBe(true);
    });

    it('closesTheDriverInvokerAndForgetsTheClientsOnClose', () => {
        const driver = mockAgent('driver');
        const driverInvoker = started(driver);
        const one = mockAgent('one');
        const oneInvoker = started(one);
        const agent = new EmbeddedAgent(driverInvoker);
        agent.host(oneInvoker);

        agent.onStart();
        agent.onClose();

        expect(driverInvoker.isClosed()).toBe(true);
        expect(driver.onClose).toHaveBeenCalledTimes(1);
        // the client is the client's to close: it was only run here
        expect(oneInvoker.isClosed()).toBe(false);
        expect(one.onClose).not.toHaveBeenCalled();
        expect(agent.hostedCount()).toBe(0);
    });
});

describe('MediaDriver runner', () => {
    const drivers: MediaDriver[] = [];

    afterEach(() => {
        for (const driver of drivers.splice(0)) {
            driver.close();
        }
        vi.restoreAllMocks();
    });

    function launch(mode: ThreadingMode): MediaDriver {
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(mode));
        drivers.push(driver);
        return driver;
    }

    it('aDriverWithAnyModeButInvokerHasARunnerThatRunsTheInvokerAgent', () => {
        for (const mode of ThreadingMode.values()) {
            const driver = launch(mode);
            const runner = driver.runner();

            if (ThreadingMode.INVOKER === mode) {
                expect(runner).toBeNull();
            } else {
                expect(runner).not.toBeNull();
                expect(runner!.agent()).toBeInstanceOf(EmbeddedAgent);
                expect(runner!.thread()).not.toBeNull();
                expect(runner!.isClosed()).toBe(false);
            }
        }
    });

    it('theRunnerUsesTheSharedIdleStrategyOfTheContextOrTheDefault', () => {
        const idle = { idle: vi.fn(() => 0), reset: vi.fn(), alias: () => 'test' };
        const driver = MediaDriver.launch(new MediaDriver.Context().sharedIdleStrategy(idle));
        drivers.push(driver);

        expect(driver.context().sharedIdleStrategy()).toBe(idle);
        // the runner schedules its first duty cycle on the event loop: nothing has run in this turn
        expect(idle.idle).not.toHaveBeenCalled();
    });

    it('closeEndsTheRunnerAndTheInvokerAndIsRepeatable', () => {
        const driver = launch(ThreadingMode.DEDICATED);
        const runner = driver.runner()!;

        driver.close();
        driver.close();

        expect(runner.isClosed()).toBe(true);
        expect(driver.sharedAgentInvoker().isClosed()).toBe(true);
    });

    it('theRunnerOfAClosedInvokerEndsToo', () => {
        const driver = launch(ThreadingMode.SHARED);
        const runner = driver.runner()!;

        // the invoker ends by itself (a termination request does it): the next cycle of the runner ends the runner
        driver.sharedAgentInvoker().close();
        expect(() => runner.agent().doWork()).toThrow(AgentTerminationException);
    });

    it('theWakeUpOfTheContextIsTheRunnersAndKeepsTheOneTheApplicationSet', () => {
        const application = vi.fn();
        const driver = MediaDriver.launch(new MediaDriver.Context().wakeUp(application));
        drivers.push(driver);

        expect(driver.context().wakeUp()).not.toBe(application);
        driver.context().wakeUp()!();
        driver.wake();
        expect(application).toHaveBeenCalledTimes(2);
    });

    it('anInvokerDriverKeepsTheWakeUpOfTheApplicationAndWakeDoesNothing', () => {
        const application = vi.fn();
        const driver = MediaDriver.launch(
            new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER).wakeUp(application),
        );
        drivers.push(driver);

        expect(driver.context().wakeUp()).toBe(application);
        expect(() => driver.wake()).not.toThrow();
        expect(application).not.toHaveBeenCalled();
    });
});

describe('Aeron client of a driver that runs itself', () => {
    const drivers: MediaDriver[] = [];
    const clients: Aeron[] = [];

    afterEach(() => {
        for (const client of clients.splice(0)) {
            client.close();
        }
        for (const driver of drivers.splice(0)) {
            driver.close();
        }
    });

    function launch(mode = ThreadingMode.DEDICATED): MediaDriver {
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(mode));
        drivers.push(driver);
        return driver;
    }

    function connect(driver: MediaDriver, configure: (ctx: Aeron.Context) => void = () => {}): Aeron {
        const ctx = new Aeron.Context().mediaDriver(driver);
        configure(ctx);
        const client = Aeron.connect(ctx);
        clients.push(client);
        return client;
    }

    it('theConductorIsRunByTheRunnerOfTheDriverAndTheClientHasNoInvokerOfItsOwn', () => {
        const driver = launch();
        const client = connect(driver);

        expect(client.conductorAgentInvoker()).toBeNull();
        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(1);

        client.close();
        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(0);
    });

    it('everyClientOfTheDriverIsHosted', () => {
        const driver = launch();
        const one = connect(driver);
        const two = connect(driver);

        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(2);
        one.close();
        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(1);
        two.close();
        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(0);
    });

    it('aClientWithAnInvokerIsNotHostedAndGetsItsInvoker', () => {
        const driver = launch();
        const client = connect(driver, (ctx) => void ctx.useConductorAgentInvoker(true));

        expect(client.conductorAgentInvoker()).not.toBeNull();
        expect((driver.runner()!.agent() as EmbeddedAgent).hostedCount()).toBe(0);
    });

    it('aClientOfAnInvokerDriverGetsTheConductorRunnerOfJavaAndIsNotHosted', () => {
        const driver = launch(ThreadingMode.INVOKER);
        const client = connect(driver);

        expect(client.conductorAgentInvoker()).toBeNull();
        expect(driver.runner()).toBeNull();
        expect(driver.host(driver.sharedAgentInvoker())).toBe(false);
    });

    it('theRuleOfJavaForAnExplicitDriverAgentInvokerStandsAndTheOneOfTheDriverNeedsNoInvoker', () => {
        const driver = launch();

        // set by hand, the invoker needs useConductorAgentInvoker (Aeron.Context rule of Java)
        expect(() =>
            Aeron.connect(new Aeron.Context().mediaDriver(driver).driverAgentInvoker(driver.sharedAgentInvoker())),
        ).toThrow(ConfigurationException);

        // taken from the driver by mediaDriver(...), it does not
        expect(() => connect(driver)).not.toThrow();
    });

    it('theCommandsOfTheClientWakeTheRunnerOfTheDriver', () => {
        const wake = vi.fn();
        const driver = MediaDriver.launch(new MediaDriver.Context().wakeUp(wake));
        drivers.push(driver);
        const client = connect(driver);
        wake.mockClear();

        client.asyncAddPublication('aeron:udp?endpoint=127.0.0.1:40123', 1001);

        expect(wake).toHaveBeenCalledTimes(1);
    });
});
