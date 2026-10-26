// Deterministic simulation of T22 (port-only, spec 8.2): the unicast transport over an in-memory network with a seeded fault
// model, on a manual clock, with a hard cap on the steps. 200 seeds per scenario; a failing seed is a repro (`seed N: ...`).
// In every run what was produced equals what was consumed: the same messages, in order, no duplicates.
import { describe, expect, it } from 'vitest';
import { lengths, plan, sequences } from '../../support/SystemRig.js';
import { SimWorld } from '../../support/SimWorld.js';
import {
    SEEDS,
    addStats,
    addStream,
    awaitConnected,
    carry,
    emptyStats,
    faultModelOf,
    mixedLengths,
    seedsOf,
} from '../../support/SimScenario.js';

const MAX_MESSAGE = 8192;

/** Run `body` for each seed of the scenario, with the seed in the message of the error it throws. */
function forEachSeed(count: number, body: (seed: number) => void): void {
    for (const seed of seedsOf(count)) {
        try {
            body(seed);
        } catch (ex) {
            throw new Error('seed ' + seed + ': ' + (ex as Error).message, { cause: ex });
        }
    }
}

describe('Netsim unicast', () => {
    const total = emptyStats();

    it('producedEqualsConsumedUnderLossReorderDuplicationAndDelay', () => {
        forEachSeed(SEEDS, (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed));
            try {
                const publisher = world.addNode();
                const subscriber = world.addNode();
                const { publication, subscription } = addStream(world, publisher, subscriber, 0 === seed % 2, {
                    sessionId: 1000 + seed,
                    initialTermId: seed * 1_000_003,
                });
                awaitConnected(world, publication, subscription);

                const sizes = mixedLengths(seed, 150, MAX_MESSAGE);
                const work = plan(0, sizes.length, (sequence) => sizes[sequence] as number);
                const { consumed } = carry(world, publication, subscription, work, MAX_MESSAGE);

                expect(consumed.problems).toEqual([]);
                expect(consumed.sequences).toEqual(sequences(0, sizes.length));
                expect(consumed.lengths).toEqual(lengths(work));
                expect(new Set(consumed.sessionIds)).toEqual(new Set([1000 + seed]));
                expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
                expect(publisher.errors.map(String)).toEqual([]);
                expect(subscriber.errors.map(String)).toEqual([]);
            } finally {
                addStats(total, world.network.stats);
                world.close();
            }
        });
    }, 120_000);

    it('aSmallWindowAndHeavyLossStillDeliversEverything', () => {
        // a window of 4 KiB is full after 20 messages of 200 bytes, so the next status message gates the stream, and a quarter
        // of the datagrams are lost, in bursts: lost status messages, lost naks, lost retransmits, lost heartbeats
        forEachSeed(SEEDS, (seed) => {
            const model = { ...faultModelOf(seed), lossRate: 0.1 + (seed % 5) * 0.03, burstRate: 0.4, burstLength: 3 };
            const world = new SimWorld(seed, model);
            try {
                const publisher = world.addNode();
                const subscriber = world.addNode();
                const { publication, subscription } = addStream(
                    world,
                    publisher,
                    subscriber,
                    0 === seed % 2,
                    { sessionId: 3000 + seed },
                    '|rcv-wnd=4096',
                );
                awaitConnected(world, publication, subscription);

                const work = plan(0, 100, (sequence) => 100 + ((sequence * 13 + seed) % 300));
                const { consumed } = carry(world, publication, subscription, work, 400);

                expect(consumed.problems).toEqual([]);
                expect(consumed.sequences).toEqual(sequences(0, 100));
                expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
                expect(publisher.errors.map(String)).toEqual([]);
                expect(subscriber.errors.map(String)).toEqual([]);
            } finally {
                addStats(total, world.network.stats);
                world.close();
            }
        });
    }, 120_000);

    it('aSendQueueThatIsOftenNonEmptyHoldsDataBackAndLosesNothing', () => {
        // half of the sends leave the send queue of their socket non-empty for 1 to 6 ms: the transport sends nothing meanwhile
        // (a short send, spec D2) and the sender, the receiver's status messages and the naks all wait for the queue
        forEachSeed(SEEDS, (seed) => {
            const model = { ...faultModelOf(seed, 0.5), sendBlockRate: 0.5, sendBlockNs: (1 + (seed % 6)) * 1_000_000 };
            const world = new SimWorld(seed, model);
            try {
                const publisher = world.addNode();
                const subscriber = world.addNode();
                const { publication, subscription } = addStream(world, publisher, subscriber, 1 === seed % 2, {
                    sessionId: 4000 + seed,
                });
                awaitConnected(world, publication, subscription);

                const sizes = mixedLengths(seed, 80, MAX_MESSAGE);
                const work = plan(0, sizes.length, (sequence) => sizes[sequence] as number);
                const { consumed } = carry(world, publication, subscription, work, MAX_MESSAGE);

                expect(consumed.problems).toEqual([]);
                expect(consumed.sequences).toEqual(sequences(0, sizes.length));
                expect(world.network.stats.sendsBlocked).toBeGreaterThan(0);
                expect(publisher.errors.map(String)).toEqual([]);
                expect(subscriber.errors.map(String)).toEqual([]);
            } finally {
                addStats(total, world.network.stats);
                world.close();
            }
        });
    }, 120_000);

    it('theSeedsHadEveryKindOfFault', () => {
        expect(total.lost).toBeGreaterThan(1000);
        expect(total.burstLost).toBeGreaterThan(0);
        expect(total.duplicated).toBeGreaterThan(1000);
        expect(total.reordered).toBeGreaterThan(1000);
        expect(total.sendsBlocked).toBeGreaterThan(0);
        expect(total.delivered).toBeGreaterThan(total.lost);
    });
});
