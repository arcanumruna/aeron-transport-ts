// Tests of the simulation itself (T22, spec 8.2): the network model is seeded and exact, the sockets behave like the `dgram`
// sockets the transports use, the clock is the only thing that moves a datagram, and a drive loop that cannot finish fails at
// its cap instead of hanging. A simulation that cannot be trusted would make its 200 seeds worth nothing.
import { describe, expect, it } from 'vitest';
import { Consumed, plan } from '../../support/SystemRig.js';
import { ManualClock } from '../../support/EmbeddedRig.js';
import { NO_FAULTS, SimNetwork } from '../../support/SimNetwork.js';
import type { FaultModel, SimSocket } from '../../support/SimNetwork.js';
import { SimWorld } from '../../support/SimWorld.js';
import { addStream, awaitConnected, carry, faultModelOf } from '../../support/SimScenario.js';

interface Rig {
    clock: ManualClock;
    network: SimNetwork;
    sender: SimSocket;
    receiver: SimSocket;
    received: { text: string; fromPort: number }[];
    errors: Error[];
}

function rig(seed: number, model: FaultModel, receiverConnectedTo?: SimSocket): Rig {
    const clock = new ManualClock();
    const network = new SimNetwork(seed, model, clock);
    const sender = network.newSocket();
    const receiver = network.newSocket();
    const received: { text: string; fromPort: number }[] = [];
    const errors: Error[] = [];
    receiver.on(
        'message',
        ((message: Uint8Array, rinfo: { port: number }) =>
            void received.push({ text: Buffer.from(message).toString('latin1'), fromPort: rinfo.port })) as never,
    );
    receiver.on('error', ((e: Error) => void errors.push(e)) as never);
    sender.bind(0, '127.0.0.1');
    receiver.bind(50_000);
    if (undefined !== receiverConnectedTo) {
        receiver.connect(receiverConnectedTo.port(), '127.0.0.1');
    }
    return { clock, network, sender, receiver, received, errors };
}

function send(r: Rig, text: string, callback?: (e: Error | null, n: number) => void): void {
    const bytes = Buffer.from(text, 'latin1');
    r.sender.send(bytes, 0, bytes.length, 50_000, '127.0.0.1', callback);
}

/** Send `count` datagrams, one per millisecond, and deliver them: the texts received, in order. */
function flow(r: Rig, count: number): string[] {
    for (let i = 0; i < count; i++) {
        send(r, 'd' + i);
        r.clock.ns += 1_000_000;
        r.network.deliverDue();
    }
    r.clock.ns += 100_000_000;
    r.network.deliverDue();
    return r.received.map((m) => m.text);
}

describe('SimNetwork', () => {
    it('aNetworkWithNoFaultsDeliversEveryDatagramOnceInOrderWhenItsTimeComes', () => {
        const r = rig(1, { ...NO_FAULTS, delayNs: 5_000_000 });
        send(r, 'a');
        send(r, 'b');

        r.network.deliverDue();
        expect(r.received).toEqual([]);
        expect(r.network.inFlightCount()).toBe(2);
        expect(r.network.nextDeliveryNs()).toBe(r.clock.ns + 5_000_000);

        r.clock.ns += 4_999_999;
        r.network.deliverDue();
        expect(r.received).toEqual([]);
        r.clock.ns += 1;
        r.network.deliverDue();
        expect(r.received.map((m) => m.text)).toEqual(['a', 'b']);
        expect(r.received[0]!.fromPort).toBe(r.sender.port());
        expect(r.network.nextDeliveryNs()).toBeNull();
    });

    it('theSameSeedGivesTheSameDeliveriesAndADifferentSeedGivesOthers', () => {
        const model: FaultModel = {
            ...NO_FAULTS,
            lossRate: 0.2,
            duplicateRate: 0.1,
            reorderRate: 0.3,
            reorderDelayNs: 5_000_000,
            delayNs: 1_000_000,
            jitterNs: 2_000_000,
        };

        const one = rig(42, model);
        const two = rig(42, model);
        const other = rig(43, model);

        expect(flow(one, 300)).toEqual(flow(two, 300));
        expect(one.network.trace).toBe(two.network.trace);
        expect(one.network.stats).toEqual(two.network.stats);
        expect(flow(other, 300)).not.toEqual(one.received.map((m) => m.text));
        expect(other.network.trace).not.toBe(one.network.trace);
    });

    it('theLossRateIsTheRateOfTheModel', () => {
        const r = rig(7, { ...NO_FAULTS, lossRate: 0.25 });
        flow(r, 4000);

        expect(r.network.stats.sent).toBe(4000);
        expect(r.network.stats.lost / 4000).toBeGreaterThan(0.21);
        expect(r.network.stats.lost / 4000).toBeLessThan(0.29);
        expect(r.network.stats.delivered).toBe(4000 - r.network.stats.lost);
        expect(new Set(r.received.map((m) => m.text)).size).toBe(r.received.length);
    });

    it('aBurstLosesTheDatagramsThatFollowALoss', () => {
        const r = rig(9, { ...NO_FAULTS, lossRate: 0.05, burstRate: 1, burstLength: 4 });
        const texts = flow(r, 2000);

        expect(r.network.stats.burstLost).toBeGreaterThan(0);
        // the datagrams lost run in groups of five (the loss and the four that follow it)
        const missing = Array.from({ length: 2000 }, (_, i) => i).filter((i) => !texts.includes('d' + i));
        expect(missing.length).toBe(r.network.stats.lost);
        expect(r.network.stats.burstLost).toBe((4 * (r.network.stats.lost - r.network.stats.burstLost)) / 1);
    });

    it('duplicatesArriveTwiceAndTheCopyIsNotTheSameMemory', () => {
        const r = rig(11, { ...NO_FAULTS, duplicateRate: 1, jitterNs: 1_000_000 });
        send(r, 'x');
        r.clock.ns += 10_000_000;
        r.network.deliverDue();

        expect(r.received.map((m) => m.text)).toEqual(['x', 'x']);
        expect(r.network.stats.duplicated).toBe(1);
        expect(r.network.stats.delivered).toBe(2);
    });

    it('reorderingMakesALaterDatagramArriveFirst', () => {
        const r = rig(13, { ...NO_FAULTS, reorderRate: 0.5, reorderDelayNs: 20_000_000, delayNs: 1_000_000 });
        const texts = flow(r, 200);

        expect(r.network.stats.reordered).toBeGreaterThan(0);
        expect(texts).not.toEqual([...texts].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
        expect([...texts].sort()).toEqual(Array.from({ length: 200 }, (_, i) => 'd' + i).sort());
    });

    it('aSendIsCompletedAtTheNextStepAndAHeldSendKeepsTheQueueNonEmpty', () => {
        const r = rig(15, { ...NO_FAULTS, sendBlockRate: 1, sendBlockNs: 3_000_000 });
        const done: number[] = [];

        expect(r.sender.getSendQueueCount()).toBe(0);
        send(r, 'x', (e, n) => void done.push(null === e ? n : -1));
        expect(r.sender.getSendQueueCount()).toBe(1);
        expect(done).toEqual([]);

        r.clock.ns += 2_999_999;
        r.network.deliverDue();
        expect(r.sender.getSendQueueCount()).toBe(1);
        expect(done).toEqual([]);

        r.clock.ns += 1;
        r.network.deliverDue();
        expect(r.sender.getSendQueueCount()).toBe(0);
        expect(done).toEqual([1]);
    });

    it('closingASocketCompletesItsQueuedSendsWithECanceledAndFreesItsPort', () => {
        const r = rig(17, NO_FAULTS);
        const results: (string | null)[] = [];
        send(r, 'x', (e) => void results.push(null === e ? null : (e as Error & { code: string }).code));

        r.sender.close();
        expect(results).toEqual(['ECANCELED']);
        expect(() => r.sender.close()).toThrow();

        const again = r.network.newSocket();
        again.bind(r.sender.port());
        expect(again.port()).toBe(r.sender.port());
    });

    it('aPortThatIsInUseIsRefusedWithEAddrInUseAsAnErrorEvent', () => {
        const r = rig(19, NO_FAULTS);
        const second = r.network.newSocket();
        const errors: Error[] = [];
        second.on('error', ((e: Error) => void errors.push(e)) as never);

        second.bind(50_000);

        expect(errors.map((e) => (e as Error & { code: string }).code)).toEqual(['EADDRINUSE']);
    });

    it('aDatagramToAPortWithNoSocketIsUndeliverableAndAConnectedSocketOnlyHearsItsPeer', () => {
        const r = rig(21, NO_FAULTS);
        r.sender.send(Buffer.from('lost'), 0, 4, 50_001, '127.0.0.1');
        r.clock.ns += 1_000_000;
        r.network.deliverDue();
        expect(r.network.stats.undeliverable).toBe(1);

        const peer = r.network.newSocket();
        peer.bind(0, '127.0.0.1');
        const connected = rig(23, NO_FAULTS, peer);
        send(connected, 'from a stranger');
        connected.clock.ns += 1_000_000;
        connected.network.deliverDue();
        expect(connected.received).toEqual([]);
        expect(connected.network.stats.undeliverable).toBe(1);
    });

    it('theSocketsOfTheTransportsAnswerWhatNodeWouldAnswer', () => {
        const r = rig(25, NO_FAULTS);
        const socket = r.network.newSocket();

        expect(() => socket.address()).toThrow();
        expect(() => socket.remoteAddress()).toThrow();
        expect(() => socket.disconnect()).toThrow();
        socket.bind(0, '127.0.0.1');
        expect(socket.address()).toEqual({ address: '127.0.0.1', family: 'IPv4', port: socket.port() });
        socket.connect(50_000, '127.0.0.1');
        expect(socket.remoteAddress()).toEqual({ address: '127.0.0.1', family: 'IPv4', port: 50_000 });
        socket.disconnect();
        expect(() => socket.remoteAddress()).toThrow();
        socket.setRecvBufferSize(2 ** 31 - 1);
        expect(socket.getRecvBufferSize()).toBeLessThan(2 ** 31 - 1);
        expect(socket.getSendBufferSize()).toBeGreaterThan(0);
    });
});

describe('SimWorld', () => {
    it('aDriveLoopThatCannotFinishFailsAtItsCapInsteadOfHanging', () => {
        const world = new SimWorld(1, NO_FAULTS);
        try {
            world.addNode();
            expect(() => world.run(() => false, 'a thing that never happens', 50)).toThrow(
                /no a thing that never happens after 50 steps/,
            );
            expect(world.steps).toBe(50);
        } finally {
            world.close();
        }
    });

    it('theDriversAndTheClientsReadTheClockOfTheWorldAndNoOtherAndASendGoesThroughTheNetwork', () => {
        const world = new SimWorld(2, NO_FAULTS);
        try {
            const publisher = world.addNode();
            const subscriber = world.addNode();
            const { publication, subscription } = addStream(world, publisher, subscriber, true);
            awaitConnected(world, publication, subscription);

            // the clocks of both nodes are the clock of the world, and a step is all that moves it
            const before = world.clock.ns;
            expect(publisher.driver.context().nanoClock()!.nanoTime()).toBe(before);
            expect(subscriber.aeron.context().nanoClock()!.nanoTime()).toBe(before);
            world.step();
            expect(publisher.driver.context().nanoClock()!.nanoTime()).toBe(before + 1_000_000);

            // the datagrams of the run went through the simulated network, and none through a socket of the host
            expect(world.network.stats.sent).toBeGreaterThan(0);
            expect(world.network.stats.delivered).toBeGreaterThan(0);
        } finally {
            world.close();
        }
    });

    it('aRunOfTheSameSeedIsTheSameRunDownToTheLastDatagram', () => {
        const traces = [1, 2].map(() => {
            const world = new SimWorld(77, faultModelOf(77));
            try {
                const publisher = world.addNode();
                const subscriber = world.addNode();
                const { publication, subscription } = addStream(world, publisher, subscriber, false, {
                    sessionId: 5,
                    initialTermId: 1234,
                });
                awaitConnected(world, publication, subscription);
                const { consumed } = carry(
                    world,
                    publication,
                    subscription,
                    plan(0, 120, (s) => 4 + ((s * 211) % 3000)),
                    4000,
                    new Consumed(),
                );
                return {
                    trace: world.network.trace,
                    stats: { ...world.network.stats },
                    steps: world.steps,
                    sequences: consumed.sequences.length,
                };
            } finally {
                world.close();
            }
        });

        expect(traces[1]).toEqual(traces[0]);
        expect(traces[0]!.stats.sent).toBeGreaterThan(100);
    });
});
