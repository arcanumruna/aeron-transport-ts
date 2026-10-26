// Deterministic simulation of T22 (port-only, spec 8.2, 8.4): the lifecycle of a stream over an in-memory network with a seeded
// fault model, on a manual clock whose seconds cost steps and not time. 200 seeds per scenario: the publication closes with
// messages unread (and in the middle of a fragmented one), the subscriber goes away and comes back, the subscriber's driver
// restarts, two publishers feed one subscription. Produced equals consumed in every run, with no duplicates.
import { describe, expect, it } from 'vitest';
import { Publication } from '../../../src/client/Publication.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { Consumed, Producer, plan, sequences } from '../../support/SystemRig.js';
import { SimWorld } from '../../support/SimWorld.js';
import type { SimNode } from '../../support/SimWorld.js';
import {
    SEEDS,
    STREAM_ID,
    addStream,
    awaitConnected,
    carry,
    faultModelOf,
    mixedLengths,
    publicationChannel,
    seedsOf,
    subscriptionChannel,
} from '../../support/SimScenario.js';

const MAX_MESSAGE = 8192;
const MS = 1_000_000;

/** The publisher's driver notices a missing subscriber in a second, and the subscriber's sends status messages every 50 ms. */
const quickPublisher = (ctx: MediaDriver.Context): void => {
    ctx.publicationConnectionTimeoutNs(1000 * MS).publicationLingerTimeoutNs(100 * MS);
};
const quickSubscriber = (ctx: MediaDriver.Context): void => {
    ctx.statusMessageTimeoutNs(50 * MS).imageLivenessTimeoutNs(1000 * MS);
};

function forEachSeed(body: (seed: number, world: SimWorld) => void, severity = 0.7): void {
    for (const seed of seedsOf(SEEDS)) {
        const world = new SimWorld(seed, faultModelOf(seed, severity));
        try {
            body(seed, world);
        } catch (ex) {
            throw new Error('seed ' + seed + ': ' + (ex as Error).message, { cause: ex });
        } finally {
            world.close();
        }
    }
}

function expectNoErrors(...nodes: SimNode[]): void {
    for (const node of nodes) {
        expect(node.errors.map(String)).toEqual([]);
    }
}

describe('Netsim lifecycle', () => {
    it('thePublicationClosesWithMessagesUnreadAndTheStreamEndsAfterThem', () => {
        forEachSeed((seed, world) => {
            const publisher = world.addNode(quickPublisher);
            const subscriber = world.addNode(quickSubscriber);
            const { publication, subscription } = addStream(world, publisher, subscriber, 0 === seed % 2, {
                sessionId: 5 + seed,
            });
            awaitConnected(world, publication, subscription);

            // everything is offered and the publication closes at once: the reader has most of it still to read
            const sizes = mixedLengths(seed, 120, MAX_MESSAGE);
            const work = plan(0, sizes.length, (sequence) => sizes[sequence] as number);
            const producer = new Producer(publication, work, MAX_MESSAGE);
            const consumed = new Consumed();
            world.run(() => {
                producer.offerSome(16);
                consumed.poll(subscription, 1);
                return producer.isDone();
            }, 'all offers');
            publication.close();

            world.run(() => {
                consumed.poll(subscription);
                return consumed.sequences.length >= sizes.length;
            }, 'all messages after the close');
            expect(consumed.sequences).toEqual(sequences(0, sizes.length));
            expect(consumed.problems).toEqual([]);

            // and the stream ends: the image is told, and goes
            world.run(() => subscription.hasNoImages(), 'the end of the image');
            expectNoErrors(publisher, subscriber);
        });
    }, 120_000);

    it('thePublicationClosesInTheMiddleOfAFragmentedMessage', () => {
        forEachSeed((seed, world) => {
            const publisher = world.addNode(quickPublisher);
            const subscriber = world.addNode(quickSubscriber);
            const { publication, subscription } = addStream(
                world,
                publisher,
                subscriber,
                1 === seed % 2,
                { sessionId: 9 + seed, termLength: 262144 },
                '|rcv-wnd=' + (seed % 3 === 0 ? 4096 : 16384),
            );
            awaitConnected(world, publication, subscription);

            const length = 12 * publication.maxPayloadLength() + (seed % 100);
            const work = plan(0, 4, () => length);
            const producer = new Producer(publication, work, length);
            world.run(() => {
                producer.offerSome();
                return producer.isDone();
            }, 'four offers');

            // read one fragment of the first message, and close with the rest of it, and of the others, to come
            const consumed = new Consumed();
            let fragments = 0;
            world.run(() => {
                fragments += consumed.poll(subscription, 1);
                return fragments >= 1;
            }, 'a first fragment');
            expect(consumed.sequences).toEqual([]);
            publication.close();

            world.run(() => {
                consumed.poll(subscription, 1);
                return consumed.sequences.length >= 4;
            }, 'all messages after the close');
            expect(consumed.sequences).toEqual([0, 1, 2, 3]);
            expect(consumed.lengths).toEqual([length, length, length, length]);
            expect(consumed.problems).toEqual([]);
            world.run(() => subscription.hasNoImages(), 'the end of the image');
            expectNoErrors(publisher, subscriber);
        });
    }, 120_000);

    it('theSubscriberGoesAwayTheOfferSaysNotConnectedAndANewImageBeginsWhereThePublicationIs', () => {
        forEachSeed((seed, world) => {
            const publisher = world.addNode(quickPublisher);
            const subscriber = world.addNode(quickSubscriber);
            const { publication, subscription } = addStream(world, publisher, subscriber, 0 === seed % 2, {
                sessionId: 21 + seed,
            });
            awaitConnected(world, publication, subscription);

            const first = plan(0, 60, (sequence) => 8 + ((sequence * 37 + seed) % 900));
            const { consumed: before } = carry(world, publication, subscription, first, 1000);
            expect(before.sequences).toEqual(sequences(0, 60));
            const firstImage = subscription.imageAtIndex(0).correlationId();

            // gone: no status message reaches the publication until its connection timeout, then an offer says not connected
            subscription.close();
            world.run(() => !publication.isConnected(), 'the connection timeout');
            const probe = new UnsafeBuffer(new Uint8Array(16));
            expect(publication.offer(probe, 0, 16)).toBe(Publication.NOT_CONNECTED);
            const positionWhenGone = publication.position();

            // back: a new image, which begins at the position of the publication, and carries only what is offered after it
            const again = (() => {
                let subscriptionAgain = null as typeof subscription | null;
                const id = subscriber.aeron.asyncAddSubscription(subscriptionChannel(), STREAM_ID);
                world.run(() => {
                    subscriptionAgain = subscriber.aeron.getSubscription(id);
                    return null !== subscriptionAgain;
                }, 'the new subscription');
                return subscriptionAgain as typeof subscription;
            })();
            awaitConnected(world, publication, again);
            const image = again.imageAtIndex(0);
            expect(image.correlationId()).not.toBe(firstImage);
            expect(image.joinPosition()).toBe(positionWhenGone);

            const second = plan(1000, 80, (sequence) => 16 + ((sequence * 53 + seed) % 1500));
            const { consumed: after } = carry(world, publication, again, second, 2000);
            expect(after.problems).toEqual([]);
            expect(after.sequences).toEqual(sequences(1000, 80));
            expect(image.position()).toBe(publication.position());
            expectNoErrors(publisher, subscriber);
        });
    }, 120_000);

    it('theSubscribersWholeDriverRestartsInTheMiddleOfATerm', () => {
        forEachSeed((seed, world) => {
            const publisher = world.addNode(quickPublisher);
            const subscriber = world.addNode(quickSubscriber);
            const { publication, subscription } = addStream(world, publisher, subscriber, 1 === seed % 2, {
                sessionId: 31 + seed,
            });
            awaitConnected(world, publication, subscription);

            const first = plan(0, 50, (sequence) => 20 + ((sequence * 29 + seed) % 700));
            const { consumed: before } = carry(world, publication, subscription, first, 1000);
            expect(before.sequences).toEqual(sequences(0, 50));

            world.removeNode(subscriber);
            world.run(() => !publication.isConnected(), 'the connection timeout');
            const positionWhenGone = publication.position();
            expect(positionWhenGone % 65536).not.toBe(0);

            const restarted = world.addNode(quickSubscriber);
            const id = restarted.aeron.asyncAddSubscription(subscriptionChannel(), STREAM_ID);
            let again = null as typeof subscription | null;
            world.run(() => {
                again = restarted.aeron.getSubscription(id);
                return null !== again;
            }, 'the new subscription');
            awaitConnected(world, publication, again as typeof subscription);
            expect((again as typeof subscription).imageAtIndex(0).joinPosition()).toBe(positionWhenGone);

            const second = plan(500, 70, (sequence) => 30 + ((sequence * 41 + seed) % 1800));
            const { consumed: after } = carry(world, publication, again as typeof subscription, second, 2000);
            expect(after.problems).toEqual([]);
            expect(after.sequences).toEqual(sequences(500, 70));
            expectNoErrors(publisher, restarted);
        });
    }, 120_000);

    it('twoPublishersToOneSubscriptionKeepEachSessionInOrder', () => {
        forEachSeed((seed, world) => {
            const first = world.addNode();
            const second = world.addNode();
            const subscriber = world.addNode();

            const subscriptionId = subscriber.aeron.asyncAddSubscription(subscriptionChannel(), STREAM_ID);
            const oneId = first.aeron.asyncAddPublication(publicationChannel({ sessionId: 100 + seed }), STREAM_ID);
            const twoId = second.aeron.asyncAddPublication(publicationChannel({ sessionId: 200 + seed }), STREAM_ID);
            world.run(
                () =>
                    null !== subscriber.aeron.getSubscription(subscriptionId) &&
                    null !== first.aeron.getPublication(oneId) &&
                    null !== second.aeron.getPublication(twoId),
                'all resources',
            );
            const subscription = subscriber.aeron.getSubscription(subscriptionId)!;
            const one = first.aeron.getPublication(oneId)!;
            const two = second.aeron.getPublication(twoId)!;
            world.run(() => one.isConnected() && two.isConnected() && subscription.imageCount() === 2, 'both images');

            const sizesOne = mixedLengths(seed, 60, 4000);
            const sizesTwo = mixedLengths(seed + 1000, 60, 4000);
            const a = new Producer(
                one,
                plan(0, 60, (s) => sizesOne[s] as number),
                4000,
            );
            const b = new Producer(
                two,
                plan(1000, 60, (s) => sizesTwo[s - 1000] as number),
                4000,
            );
            const consumed = new Consumed();
            world.run(() => {
                a.offerSome(8);
                b.offerSome(8);
                consumed.poll(subscription);
                return consumed.sequences.length >= 120;
            }, 'both streams');

            expect(consumed.problems).toEqual([]);
            const own = (sessionId: number): number[] =>
                consumed.sequences.filter((_, i) => consumed.sessionIds[i] === sessionId);
            expect(own(100 + seed)).toEqual(sequences(0, 60));
            expect(own(200 + seed)).toEqual(sequences(1000, 60));
            expectNoErrors(first, second, subscriber);
        });
    }, 120_000);
});
