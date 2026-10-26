// Tests of the support of the ported system tests (phase 3, T5, D115): `drainUntil` and the waits over it fail at their cap
// instead of hanging, a manual clock moves only with the turns, two drivers of one test are told apart, and the teardown
// closes the clients before the drivers.
import { describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { freeUdpPort } from '../support/Udp.js';
import { CYCLE_NS } from '../support/EmbeddedRig.js';
import { SystemTests, systemTests } from '../support/SystemTests.js';

const STREAM_ID = 1001;

describe('SystemTests', () => {
    it('drainUntilReturnsAtOnceForATrueConditionAndFailsAtTheCapOfTurnsForAFalseOne', async () => {
        const tests = systemTests('cap');
        await tests.drainUntil(() => true, 0);

        await expect(
            tests.drainUntil(
                () => false,
                25,
                () => 'never',
            ),
        ).rejects.toThrow(/no never after 25 turns/);
        expect(tests.turns).toBe(25);
    });

    it('drainUntilRunsADutyCycleAndAnEventLoopTurnPerTurnAndNothingElse', async () => {
        const tests = systemTests('turns');
        let turns = 0;
        await tests.drainUntil(() => turns++ === 7, 100);

        expect(tests.turns).toBe(7);
    });

    it('theManualClockOfATestMovesByOneCycleForEachTurnForEveryDriverAndClient', async () => {
        const tests = systemTests('clock', true);
        const one = tests.launch();
        const two = tests.launch();
        const clock = tests.clock as NonNullable<typeof tests.clock>;
        const start = clock.ns;

        await tests.drainUntil(() => tests.turns === 10, 20);

        expect(clock.ns - start).toBe(10 * CYCLE_NS);
        expect(one.driver.context().nanoClock()).toBe(clock);
        expect(two.driver.context().epochClock()).toBe(clock);
        expect(tests.nodes.map((node) => node.name)).toEqual(['clock-driver0', 'clock-driver1']);
    });

    it('theAwaitsConnectAPublicationToASubscriptionAndWaitForAWindowAPositionAndACounterDelta', async () => {
        const tests = systemTests('awaits');
        const node = tests.launch();
        const port = await freeUdpPort();
        const subscription = node.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
        const publication = node.aeron.addPublication('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
        if (null === publication || null === subscription) {
            throw new Error('not added');
        }

        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscription);
        await tests.awaitConnections(subscription, 1);
        await tests.awaitAvailable(publication);

        const counters = node.aeron.countersReader();
        const positionId = subscription.imageAtIndex(0).subscriberPositionId();
        const before = counters.getCounterValue(positionId);
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        await tests.drainUntil(() => publication.offer(buffer, 0, 64) > 0, 1000);

        await tests.drainUntil(() => subscription.poll({ onFragment: () => {} }, 10) > 0, 100_000);
        await tests.awaitPosition(counters, positionId, before + 96);
        await tests.awaitCounterDeltaFrom(counters, positionId, before, 96);
        expect(tests.errors()).toEqual([]);
    });

    it('awaitPositionFailsForACounterThatIsNotAllocatedAndAwaitsFailAtTheirCap', async () => {
        const tests = systemTests('failures');
        const node = tests.launch();
        const counters = node.aeron.countersReader();

        await expect(tests.awaitPosition(counters, 1_000_000_000, 1, 5)).rejects.toThrow();
        await expect(
            tests.awaitConnections(
                node.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + (await freeUdpPort()), 7),
                1,
                10,
            ),
        ).rejects.toThrow(/no 1 images of .* after 10 turns/);
        await expect(tests.awaitCounterDelta(counters, 0, 1 << 30, 10)).rejects.toThrow(/to reach/);
    });

    it('theTeardownClosesTheClientsBeforeTheirDriversInReverseOrder', () => {
        const tests = new SystemTests('close');
        const order: string[] = [];
        const first = tests.launch();
        const second = tests.launch();
        const extra = tests.connect(second);
        for (const [name, node] of [
            ['first', first],
            ['second', second],
        ] as const) {
            const original = node.driver.close.bind(node.driver);
            vi.spyOn(node.driver, 'close').mockImplementation(() => {
                order.push('driver ' + name);
                original();
            });
        }
        const closeOf = (name: string, client: { close(): void }): void => {
            const original = client.close.bind(client);
            client.close = () => {
                order.push('client ' + name);
                original();
            };
        };
        closeOf('first', first.clients[0] as never);
        closeOf('second', second.clients[0] as never);
        closeOf('extra', extra);

        tests.close();

        expect(order).toEqual(['client extra', 'client second', 'driver second', 'client first', 'driver first']);
        expect(tests.nodes).toEqual([]);
        vi.restoreAllMocks();
    });
});
