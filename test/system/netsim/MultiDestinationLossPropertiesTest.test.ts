// Deterministic simulation of phase 3, T11 (port-only, D117): multicast, MDC and MDS over the in-memory network with a seeded
// fault model, on a manual clock, with a hard cap on the steps. 200 seeds per scenario; a failing seed is a repro
// (`seed N: ...`) and is added to `REGRESSION_SEEDS` of its scenario as a named case. In every run what was produced equals what
// was consumed, per receiver: the same messages, in order, no duplicates. A multicast datagram has its own draw of loss for
// each receiver (D117).
import { describe, expect, it, vi } from 'vitest';

// the id of a receiver is `crypto.randomBytes(8)`: from the seed of the run, so that a failing seed is a repro
vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    const { randomBytesHook } = await import('../../support/SimRandomness.js');
    return {
        ...actual,
        randomBytes: (size: number, ...rest: unknown[]) =>
            null !== randomBytesHook.fn
                ? randomBytesHook.fn(size)
                : (actual.randomBytes as (size: number, ...rest: unknown[]) => Buffer)(size, ...rest),
    };
});

import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { AeronCounters } from '../../../src/client/AeronCounters.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import type { ConcurrentPublication } from '../../../src/client/ConcurrentPublication.js';
import type { ExclusivePublication } from '../../../src/client/ExclusivePublication.js';
import type { Subscription } from '../../../src/client/Subscription.js';
import { Consumed, Producer, lengths, plan, sequences } from '../../support/SystemRig.js';
import type { Plan } from '../../support/SystemRig.js';
import type { NetworkStats } from '../../support/SimNetwork.js';
import { seedDriverRandomness } from '../../support/SimRandomness.js';
import { SimWorld } from '../../support/SimWorld.js';
import type { SimNode } from '../../support/SimWorld.js';
import {
    SEEDS,
    STREAM_ID,
    TERM_LENGTH,
    addStats,
    emptyStats,
    faultModelOf,
    mixedLengths,
    seedsOf,
} from '../../support/SimScenario.js';

const MAX_MESSAGE = 8192;
const GROUP = '224.20.30.39';
const MS = 1_000_000;

/** Seeds that failed once, kept as named cases of the scenario that found them (none so far). */
const REGRESSION_SEEDS: Record<string, readonly number[]> = {};

/** Run `body` for each seed of the scenario, with the seed in the message of the error it throws. */
function forEachSeed(scenario: string, body: (seed: number) => void): void {
    const seeds = [...seedsOf(SEEDS), ...(REGRESSION_SEEDS[scenario] ?? [])];
    for (const seed of seeds) {
        const restore = seedDriverRandomness(seed);
        try {
            body(seed);
        } catch (ex) {
            throw new Error('scenario ' + scenario + ' seed ' + seed + ': ' + (ex as Error).message, { cause: ex });
        } finally {
            restore();
        }
    }
}

type Publication = ConcurrentPublication | ExclusivePublication;

function addPublication(world: SimWorld, node: SimNode, channel: string, exclusive = false): Publication {
    const id = exclusive
        ? node.aeron.asyncAddExclusivePublication(channel, STREAM_ID)
        : node.aeron.asyncAddPublication(channel, STREAM_ID);
    const get = (): Publication | null =>
        exclusive ? node.aeron.getExclusivePublication(id) : node.aeron.getPublication(id);
    world.run(() => null !== get(), 'publication ' + channel);
    return get() as Publication;
}

function addSubscription(world: SimWorld, node: SimNode, channel: string): Subscription {
    const id = node.aeron.asyncAddSubscription(channel, STREAM_ID);
    world.run(() => null !== node.aeron.getSubscription(id), 'subscription ' + channel);
    return node.aeron.getSubscription(id) as Subscription;
}

/** `addDestination` of a publication or a subscription, stepping until the driver has done it. */
function addDestination(
    world: SimWorld,
    node: SimNode,
    target: { asyncAddDestination(channel: string): number },
    channel: string,
): void {
    const id = target.asyncAddDestination(channel);
    world.run(() => !node.aeron.isCommandActive(id), 'destination ' + channel);
}

/**
 * The receivers that the min flow control of the publication counts. The stream is not started before all of them are in it: a
 * receiver whose first status message was lost does not gate the sender, which then runs on and, once it is more than half a
 * term ahead, rejects that receiver's status messages (`NetworkPublication.isValidStatusMessage`) and has no data left for its
 * naks: the protocol does not promise such a receiver the stream, so the property is for the receivers the sender knows.
 */
function flowControlReceivers(node: SimNode, publication: Publication): number {
    const reader = node.aeron.countersReader();
    const id = reader.findByTypeIdAndRegistrationId(
        AeronCounters.FLOW_CONTROL_RECEIVERS_COUNTER_TYPE_ID,
        publication.registrationId(),
    );
    return CountersReader.NULL_COUNTER_ID === id ? 0 : reader.getCounterValue(id);
}

/** The message lengths of a seed, as a plan of `count` messages. */
function planOf(seed: number, count: number, maxLength = MAX_MESSAGE): Plan {
    const sizes = mixedLengths(seed, count, maxLength);
    return plan(0, sizes.length, (sequence) => sizes[sequence] as number);
}

/**
 * Steps, offering the plan to each producer and polling each consumer, until every consumer has read all of it (`done`
 * says which consumers must), and then for `settleSteps` more steps, so that a duplicate that is still on its way shows.
 */
function carryAll(
    world: SimWorld,
    producers: Producer[],
    consumers: { subscription: Subscription; consumed: Consumed; slow?: (step: number) => boolean }[],
    work: Plan,
    must: (index: number) => boolean,
    settleSteps = 200,
): void {
    world.run(
        () => {
            for (const producer of producers) {
                producer.offerSome(16);
            }
            for (const consumer of consumers) {
                if (undefined === consumer.slow || consumer.slow(world.steps)) {
                    consumer.consumed.poll(consumer.subscription, undefined === consumer.slow ? 16 : 1);
                }
            }
            return consumers.every(
                (consumer, index) => !must(index) || consumer.consumed.sequences.length >= work.count,
            );
        },
        'all ' + work.count + ' messages (read ' + consumers.map((c) => c.consumed.sequences.length) + ')',
    );
    for (let i = 0; i < settleSteps; i++) {
        world.step();
        for (const consumer of consumers) {
            consumer.consumed.poll(consumer.subscription);
        }
    }
}

function expectComplete(consumed: Consumed, work: Plan): void {
    expect(consumed.problems).toEqual([]);
    expect(consumed.sequences).toEqual(sequences(0, work.count));
    expect(consumed.lengths).toEqual(lengths(work));
}

/** What a consumer read is the start of the stream: in order, no duplicates, no gap. */
function expectPrefix(consumed: Consumed, work: Plan): void {
    expect(consumed.problems).toEqual([]);
    expect(consumed.sequences).toEqual(sequences(0, consumed.sequences.length));
    expect(consumed.lengths).toEqual(lengths(work).slice(0, consumed.lengths.length));
}

function expectNoErrors(...nodes: SimNode[]): void {
    for (const node of nodes) {
        expect(node.errors.map(String)).toEqual([]);
    }
}

const total = emptyStats();
/** What the drivers did to repair the loss, over all the seeds. */
const recovered = { retransmits: 0, naks: 0 };

function finish(world: SimWorld): void {
    addStats(total, world.network.stats);
    for (const node of world.allNodes()) {
        const counters = node.driver.context().systemCounters() as SystemCounters;
        recovered.retransmits += counters.get(SystemCounterDescriptor.RETRANSMITS_SENT).get();
        recovered.naks += counters.get(SystemCounterDescriptor.NAK_MESSAGES_SENT).get();
    }
    world.close();
}

/** One run of the multicast scenario: three receivers, each with its own loss, one publisher. */
function multicastRun(seed: number): { steps: number; stats: NetworkStats } {
    const world = new SimWorld(seed, faultModelOf(seed));
    try {
        const publisher = world.addNode();
        const subscribers = [world.addNode(), world.addNode(), world.addNode()];
        const port = 40_200 + (seed % 50);
        const endpoint = 'aeron:udp?endpoint=' + GROUP + ':' + port + '|interface=127.0.0.1';
        const publicationChannel =
            endpoint + '|term-length=' + TERM_LENGTH + '|session-id=' + (5000 + seed) + '|fc=min';
        let publication: Publication;
        let subscriptions: Subscription[];
        if (0 === seed % 2) {
            publication = addPublication(world, publisher, publicationChannel);
            subscriptions = subscribers.map((node) => addSubscription(world, node, endpoint));
        } else {
            subscriptions = subscribers.map((node) => addSubscription(world, node, endpoint));
            publication = addPublication(world, publisher, publicationChannel);
        }
        world.run(
            () =>
                publication.isConnected() &&
                subscriptions.every((s) => s.imageCount() >= 1) &&
                flowControlReceivers(publisher, publication) >= 3,
            'connected multicast stream with three receivers',
        );

        const work = planOf(seed, 120);
        const consumers = subscriptions.map((subscription) => ({ subscription, consumed: new Consumed() }));
        carryAll(world, [new Producer(publication, work, MAX_MESSAGE)], consumers, work, () => true);

        for (const { subscription, consumed } of consumers) {
            expectComplete(consumed, work);
            expect(new Set(consumed.sessionIds)).toEqual(new Set([5000 + seed]));
            expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        }
        expectNoErrors(publisher, ...subscribers);
        return { steps: world.steps, stats: { ...world.network.stats } };
    } finally {
        finish(world);
    }
}

describe('Netsim multicast, MDC and MDS', () => {
    it('multicastWithThreeReceiversEachWithItsOwnLossProducedEqualsConsumed', () => {
        forEachSeed('multicast', (seed) => {
            multicastRun(seed);
        });
    }, 600_000);

    it('theSameSeedGivesTheSameRunTheDriversIncluded', () => {
        // the ids and the nak delays of the drivers come from the seed as well (`seedDriverRandomness`), so that a failing seed
        // is a repro: the run ends at the same step with the same traffic
        for (const seed of [3, 71, 191]) {
            const digests = [1, 2].map(() => {
                const restore = seedDriverRandomness(seed);
                try {
                    return multicastRun(seed);
                } finally {
                    restore();
                }
            });
            expect(digests[1]).toEqual(digests[0]);
        }
    }, 120_000);

    it('dynamicMdcWithThreeDestinationsProducedEqualsConsumed', () => {
        forEachSeed('dynamic-mdc', (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed));
            try {
                const publisher = world.addNode();
                const subscribers = [world.addNode(), world.addNode(), world.addNode()];
                const control = '127.0.0.1:' + (40_300 + (seed % 50));
                const publicationChannel =
                    'aeron:udp?control=' +
                    control +
                    '|control-mode=dynamic|fc=min|term-length=' +
                    TERM_LENGTH +
                    '|session-id=' +
                    (6000 + seed);
                const subscriptionChannel = 'aeron:udp?control=' + control + '|group=true';
                let publication: Publication;
                let subscriptions: Subscription[];
                if (0 === seed % 2) {
                    publication = addPublication(world, publisher, publicationChannel);
                    subscriptions = subscribers.map((node) => addSubscription(world, node, subscriptionChannel));
                } else {
                    subscriptions = subscribers.map((node) => addSubscription(world, node, subscriptionChannel));
                    publication = addPublication(world, publisher, publicationChannel);
                }
                world.run(
                    () =>
                        publication.isConnected() &&
                        subscriptions.every((s) => s.imageCount() >= 1) &&
                        flowControlReceivers(publisher, publication) >= 3,
                    'connected dynamic MDC stream with three destinations',
                );

                const work = planOf(seed, 120);
                const consumers = subscriptions.map((subscription) => ({ subscription, consumed: new Consumed() }));
                carryAll(world, [new Producer(publication, work, MAX_MESSAGE)], consumers, work, () => true);

                for (const { subscription, consumed } of consumers) {
                    expectComplete(consumed, work);
                    expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
                }
                expectNoErrors(publisher, ...subscribers);
            } finally {
                finish(world);
            }
        });
    }, 600_000);

    it('manualMdcWithThreeDestinationsProducedEqualsConsumed', () => {
        forEachSeed('manual-mdc', (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed));
            try {
                const publisher = world.addNode();
                const subscribers = [world.addNode(), world.addNode(), world.addNode()];
                const base = 40_400 + (seed % 20) * 4;
                const destinations = subscribers.map(
                    (_, i) => 'aeron:udp?endpoint=127.0.0.1:' + (base + i) + '|group=true',
                );
                const publicationChannel =
                    'aeron:udp?control-mode=manual|fc=min|term-length=' + TERM_LENGTH + '|session-id=' + (7000 + seed);
                const subscriptions = subscribers.map((node, i) =>
                    addSubscription(world, node, destinations[i] as string),
                );
                const publication = addPublication(world, publisher, publicationChannel);
                // the destinations are added before the first offer
                const work = planOf(seed, 120);
                const producer = new Producer(publication, work, MAX_MESSAGE);
                const consumers = subscriptions.map((subscription) => ({ subscription, consumed: new Consumed() }));
                for (const destination of destinations) {
                    addDestination(world, publisher, publication, destination);
                }
                world.run(
                    () =>
                        publication.isConnected() &&
                        subscriptions.every((s) => s.imageCount() >= 1) &&
                        flowControlReceivers(publisher, publication) >= 3,
                    'connected manual MDC stream with three destinations',
                );
                carryAll(world, [producer], consumers, work, () => true);

                for (const { subscription, consumed } of consumers) {
                    expectComplete(consumed, work);
                    expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
                }
                expectNoErrors(publisher, ...subscribers);
            } finally {
                finish(world);
            }
        });
    }, 600_000);

    it('mdsWithTwoDestinationsCarryingTheSameStreamProducedEqualsConsumedOnce', () => {
        forEachSeed('mds', (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed));
            try {
                const publisherA = world.addNode();
                const publisherB = world.addNode();
                const subscriber = world.addNode();
                const port = 40_500 + (seed % 50) * 2;
                const initialTermId = seed * 1_000_003;
                const common =
                    '|term-length=' +
                    TERM_LENGTH +
                    '|session-id=' +
                    (8000 + seed) +
                    '|init-term-id=' +
                    initialTermId +
                    '|term-id=' +
                    initialTermId +
                    '|term-offset=0';
                const destinationA = 'aeron:udp?endpoint=127.0.0.1:' + port;
                const destinationB = 'aeron:udp?endpoint=127.0.0.1:' + (port + 1);

                const subscription = addSubscription(world, subscriber, 'aeron:udp?control-mode=manual');
                addDestination(world, subscriber, subscription, destinationA);
                addDestination(world, subscriber, subscription, destinationB);
                const publicationA = addPublication(world, publisherA, destinationA + common, true);
                const publicationB = addPublication(world, publisherB, destinationB + common, true);
                world.run(
                    () => publicationA.isConnected() && publicationB.isConnected() && subscription.imageCount() >= 1,
                    'connected MDS stream',
                );

                const work = planOf(seed, 100);
                const consumed = new Consumed();
                carryAll(
                    world,
                    [new Producer(publicationA, work, MAX_MESSAGE), new Producer(publicationB, work, MAX_MESSAGE)],
                    [{ subscription, consumed }],
                    work,
                    () => true,
                    400,
                );

                expectComplete(consumed, work);
                expect(new Set(consumed.sessionIds)).toEqual(new Set([8000 + seed]));
                expect(subscription.imageCount()).toBe(1);
                expectNoErrors(publisherA, publisherB, subscriber);
            } finally {
                finish(world);
            }
        });
    }, 600_000);

    it('minFlowControlWithASlowReceiverThatTimesOutAndIsDroppedFinishesForTheOthers', () => {
        forEachSeed('min-fc', (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed, 0.5));
            try {
                const publisher = world.addNode((ctx) => ctx.flowControlReceiverTimeoutNs(500 * MS));
                const fast = world.addNode();
                const slow = world.addNode();
                const port = 40_600 + (seed % 50);
                const endpoint = 'aeron:udp?endpoint=' + GROUP + ':' + port + '|interface=127.0.0.1';
                // a window of 16 KiB: the slow receiver holds the sender back after a few messages
                const subscriptionChannel = endpoint + '|rcv-wnd=16384';
                const publicationChannel =
                    endpoint + '|term-length=' + TERM_LENGTH + '|session-id=' + (9000 + seed) + '|fc=min';
                const fastSubscription = addSubscription(world, fast, subscriptionChannel);
                const slowSubscription = addSubscription(world, slow, subscriptionChannel);
                const publication = addPublication(world, publisher, publicationChannel);
                world.run(
                    () =>
                        publication.isConnected() &&
                        fastSubscription.imageCount() >= 1 &&
                        slowSubscription.imageCount() >= 1 &&
                        flowControlReceivers(publisher, publication) >= 2,
                    'connected stream with two receivers',
                );

                // 150 messages of 100 to 1300 bytes: 105 KB, far more than the window and what the slow one reads
                const work = plan(0, 150, (sequence) => 100 + ((sequence * 13 + seed) % 1200));
                const producer = new Producer(publication, work, 1400);
                const fastConsumed = new Consumed();
                const slowConsumed = new Consumed();
                const slowReads = 5 + (seed % 36);
                let slowAlive = true;
                world.run(
                    () => {
                        producer.offerSome(16);
                        fastConsumed.poll(fastSubscription);
                        // the slow one reads one fragment every seventh step, until it has read `slowReads`, and then it dies
                        if (slowAlive) {
                            if (slowConsumed.sequences.length >= slowReads) {
                                world.removeNode(slow);
                                slowAlive = false;
                            } else if (world.steps % 7 === 0) {
                                slowConsumed.poll(slowSubscription, 1);
                            }
                        }
                        return fastConsumed.sequences.length >= work.count;
                    },
                    'all ' +
                        work.count +
                        ' messages for the fast receiver (read ' +
                        fastConsumed.sequences.length +
                        ')',
                );

                expectComplete(fastConsumed, work);
                expectPrefix(slowConsumed, work);
                expect(fastSubscription.imageAtIndex(0).position()).toBe(publication.position());
                expectNoErrors(publisher, fast);
            } finally {
                finish(world);
            }
        });
    }, 600_000);

    it('taggedFlowControlTheTaggedGroupGatesAndAnUntaggedReceiverDoesNot', () => {
        forEachSeed('tagged-fc', (seed) => {
            const world = new SimWorld(seed, faultModelOf(seed, 0.5));
            try {
                const publisher = world.addNode();
                const taggedA = world.addNode();
                const taggedB = world.addNode();
                const untagged = world.addNode();
                const port = 40_700 + (seed % 50);
                const endpoint = 'aeron:udp?endpoint=' + GROUP + ':' + port + '|interface=127.0.0.1';
                const publicationChannel =
                    endpoint + '|term-length=' + TERM_LENGTH + '|session-id=' + (9500 + seed) + '|fc=tagged,g:123/2';
                const taggedChannel = endpoint + '|gtag=123|rcv-wnd=16384';
                const untaggedChannel = endpoint + '|rcv-wnd=16384';
                const subscriptionA = addSubscription(world, taggedA, taggedChannel);
                const subscriptionB = addSubscription(world, taggedB, taggedChannel);
                const subscriptionU = addSubscription(world, untagged, untaggedChannel);
                const publication = addPublication(world, publisher, publicationChannel);
                world.run(
                    () =>
                        publication.isConnected() &&
                        subscriptionA.imageCount() >= 1 &&
                        subscriptionB.imageCount() >= 1 &&
                        subscriptionU.imageCount() >= 1,
                    'connected stream',
                );

                // the untagged receiver never reads: its window is full after a few messages, and if it gated the sender the
                // stream would stop there; the tagged receivers read all of it
                const work = plan(0, 150, (sequence) => 100 + ((sequence * 17 + seed) % 1200));
                const consumedA = new Consumed();
                const consumedB = new Consumed();
                const consumedU = new Consumed();
                const slowU = (step: number): boolean => step % 400 === 0;
                carryAll(
                    world,
                    [new Producer(publication, work, 1400)],
                    [
                        { subscription: subscriptionA, consumed: consumedA },
                        { subscription: subscriptionB, consumed: consumedB },
                        { subscription: subscriptionU, consumed: consumedU, slow: slowU },
                    ],
                    work,
                    (index) => index < 2,
                );

                expectComplete(consumedA, work);
                expectComplete(consumedB, work);
                expectPrefix(consumedU, work);
                expect(subscriptionA.imageAtIndex(0).position()).toBe(publication.position());
                expect(subscriptionB.imageAtIndex(0).position()).toBe(publication.position());
                expectNoErrors(publisher, taggedA, taggedB);
            } finally {
                finish(world);
            }
        });
    }, 600_000);

    it('theSeedsHadEveryKindOfFault', () => {
        expect(total.lost).toBeGreaterThan(1000);
        expect(total.burstLost).toBeGreaterThan(0);
        expect(total.duplicated).toBeGreaterThan(1000);
        expect(total.reordered).toBeGreaterThan(1000);
        expect(total.delivered).toBeGreaterThan(total.lost);
        // and the drivers repaired it
        expect(recovered.naks).toBeGreaterThan(1000);
        expect(recovered.retransmits).toBeGreaterThan(1000);
    });
});
