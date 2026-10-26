// System tests of T22 (port-only, spec 8.4, D100): TS <-> TS on real UDP on the loopback. A publisher node and a subscriber
// node are each a `MediaDriver` and an `Aeron` client of this process, on the default configuration: the drivers run
// themselves on the event loop and the clients' conductors run in their duty cycle (nothing is stepped by hand).
// In every case what was produced equals what was consumed: the same messages (bytes checked), in order, no duplicates.
import { afterEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException } from '../../src/agrona/jdk.js';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { mulberry32 } from '../support/Random.js';
import {
    Consumed,
    Producer,
    SystemNode,
    driveUntil,
    lengths,
    plan,
    sequences,
    transfer,
} from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';

const STREAM_ID = 1001;
const TERM_LENGTH = 65536;
const FRAME_ALIGNMENT = 32;
const HEADER_LENGTH = 32;

/** The length of the frame that a message of `length` bytes takes in the log, as the publication aligns it. */
function frameLength(length: number): number {
    return Math.ceil((length + HEADER_LENGTH) / FRAME_ALIGNMENT) * FRAME_ALIGNMENT;
}

describe('Unicast end to end', () => {
    const nodes: SystemNode[] = [];

    afterEach(() => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
    });

    function newNode(configure?: (ctx: MediaDriver.Context) => void): SystemNode {
        const node = new SystemNode(configure);
        nodes.push(node);
        return node;
    }

    function subscriptionChannel(port: number): string {
        return 'aeron:udp?endpoint=127.0.0.1:' + port;
    }

    function publicationChannel(port: number, params = 'term-length=' + TERM_LENGTH): string {
        return 'aeron:udp?endpoint=127.0.0.1:' + port + ('' === params ? '' : '|' + params);
    }

    /** The two nodes are clean at the end: no error was reported by either driver or client. */
    function expectNoErrors(...of: SystemNode[]): void {
        for (const node of of) {
            expect(node.errors.map(String)).toEqual([]);
        }
    }

    async function connected(publication: ConcurrentPublication, subscription: Subscription, count = 1) {
        await driveUntil(() => publication.isConnected() && subscription.imageCount() >= count, 'connected stream');
    }

    it('publicationFirst', async () => {
        const [publisher, subscriber] = [newNode(), newNode()];
        const port = freeUdpPort();

        const publication = publisher.aeron.addPublication(
            publicationChannel(port),
            STREAM_ID,
        ) as ConcurrentPublication;
        expect(publication.isConnected()).toBe(false);
        expect(publication.offer(new UnsafeBuffer(new Uint8Array(8)), 0, 8)).toBe(Publication.NOT_CONNECTED);

        // the publication is alone for a while: it keeps sending its setup, and the subscription finds it later
        await driveUntil(() => publisher.driver.sharedAgentInvoker().isRunning(), 'running driver');
        const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
        await connected(publication, subscription);

        const work = plan(0, 1000, () => 100);
        const consumed = new Consumed();
        await transfer(publication, subscription, work, consumed, 100, 'all messages');

        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(0, 1000));
        expect(new Set(consumed.sessionIds)).toEqual(new Set([publication.sessionId()]));
        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        expectNoErrors(publisher, subscriber);
    });

    it('subscriptionFirst', async () => {
        const [publisher, subscriber] = [newNode(), newNode()];
        const port = freeUdpPort();

        const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
        expect(subscription.isConnected()).toBe(false);
        const publication = publisher.aeron.addPublication(
            publicationChannel(port),
            STREAM_ID,
        ) as ConcurrentPublication;
        await connected(publication, subscription);

        const work = plan(0, 1000, () => 100);
        const consumed = new Consumed();
        await transfer(publication, subscription, work, consumed, 100, 'all messages');

        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(0, 1000));
        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        expectNoErrors(publisher, subscriber);
    });

    it('theAsyncAddsOfBothSidesGiveTheSameStream', async () => {
        const [publisher, subscriber] = [newNode(), newNode()];
        const port = freeUdpPort();

        const subscriptionId = subscriber.aeron.asyncAddSubscription(subscriptionChannel(port), STREAM_ID);
        const publicationId = publisher.aeron.asyncAddPublication(publicationChannel(port), STREAM_ID);
        expect(publisher.aeron.getPublication(publicationId)).toBeNull();

        await driveUntil(
            () =>
                null !== publisher.aeron.getPublication(publicationId) &&
                null !== subscriber.aeron.getSubscription(subscriptionId),
            'both resources',
        );
        const publication = publisher.aeron.getPublication(publicationId) as ConcurrentPublication;
        const subscription = subscriber.aeron.getSubscription(subscriptionId) as Subscription;
        await connected(publication, subscription);

        const consumed = new Consumed();
        await transfer(
            publication,
            subscription,
            plan(0, 200, () => 64),
            consumed,
            64,
            'all messages',
        );
        expect(consumed.sequences).toEqual(sequences(0, 200));
        expectNoErrors(publisher, subscriber);
    });

    describe('message sizes', () => {
        async function streamOf(length: number, count: number, modulo = 0) {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const consumed = new Consumed(modulo);
            await transfer(
                publication,
                subscription,
                plan(0, count, () => length),
                consumed,
                length,
                'all messages',
            );
            return { publisher, subscriber, publication, subscription, consumed };
        }

        it('theLimitsOfTheChannelAreTheMtuAndAnEighthOfTheTerm', async () => {
            const [publisher] = [newNode()];
            const publication = publisher.aeron.addPublication(
                publicationChannel(freeUdpPort()),
                STREAM_ID,
            ) as ConcurrentPublication;
            expect(publication.maxPayloadLength()).toBe(1408 - HEADER_LENGTH);
            expect(publication.maxMessageLength()).toBe(TERM_LENGTH / 8);
            expect(publication.termBufferLength()).toBe(TERM_LENGTH);
        });

        it('aOneByteMessageSurvives', async () => {
            const { publisher, subscriber, consumed } = await streamOf(1, 200, 256);
            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, 200));
            expect(consumed.lengths.every((length) => 1 === length)).toBe(true);
            expectNoErrors(publisher, subscriber);
        });

        it.each([
            ['4 bytes', (p: number, m: number) => (void p, void m, 4)],
            ['one byte less than a full frame', (p: number) => p - 1],
            ['a full frame', (p: number) => p],
            ['one byte more than a full frame (two frames)', (p: number) => p + 1],
            ['two full frames', (p: number) => 2 * p],
            ['two full frames and a byte', (p: number) => 2 * p + 1],
            ['one byte less than the maximum message', (_p: number, m: number) => m - 1],
            ['the maximum message', (_p: number, m: number) => m],
        ])('aMessageOf %s survives', async (_name, lengthOf) => {
            const p = 1408 - HEADER_LENGTH;
            const m = TERM_LENGTH / 8;
            const length = lengthOf(p, m);
            const { publisher, subscriber, publication, subscription, consumed } = await streamOf(length, 60);

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, 60));
            expect(consumed.lengths.every((l) => l === length)).toBe(true);
            expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
            expectNoErrors(publisher, subscriber);
        });

        it('sizesOfAllClassesInOneStreamKeepTheirOrder', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const random = mulberry32(2210);
            const maxMessage = publication.maxMessageLength();
            const sizeOf = Array.from({ length: 400 }, () => 4 + Math.floor(random() * (maxMessage - 3)));
            const work = plan(0, sizeOf.length, (sequence) => sizeOf[sequence] as number);
            const consumed = new Consumed();
            await transfer(publication, subscription, work, consumed, maxMessage, 'all messages');

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, 400));
            expect(consumed.lengths).toEqual(lengths(work));
            expectNoErrors(publisher, subscriber);
        });

        it('aMessageOverTheMaximumIsRefusedAndTheStreamGoesOn', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const tooLong = new UnsafeBuffer(new Uint8Array(publication.maxMessageLength() + 1));
            expect(() => publication.offer(tooLong, 0, tooLong.capacity())).toThrow(IllegalArgumentException);

            const consumed = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 50, () => 500),
                consumed,
                500,
                'all messages',
            );
            expect(consumed.sequences).toEqual(sequences(0, 50));
            expectNoErrors(publisher, subscriber);
        });
    });

    describe('the default term length', () => {
        it('theMaximumMessageOfADefaultPublicationSurvives', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port, ''),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const length = publication.maxMessageLength();
            expect(length).toBe((16 * 1024 * 1024) / 8);
            const consumed = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 3, () => length),
                consumed,
                length,
                'three messages',
            );

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual([0, 1, 2]);
            expect(consumed.lengths).toEqual([length, length, length]);
            expectNoErrors(publisher, subscriber);
        }, 30_000);
    });

    describe('term rotation', () => {
        async function rotate(initialTermId: number, termId: number, termOffset: number, count: number) {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(
                    port,
                    'term-length=' +
                        TERM_LENGTH +
                        '|init-term-id=' +
                        initialTermId +
                        '|term-id=' +
                        termId +
                        '|term-offset=' +
                        termOffset,
                ),
                STREAM_ID,
            ) as ConcurrentPublication;
            expect(publication.initialTermId()).toBe(initialTermId);
            const startPosition = ((termId - initialTermId) | 0) * TERM_LENGTH + termOffset;
            expect(publication.position()).toBe(startPosition);
            await connected(publication, subscription);
            expect(subscription.imageAtIndex(0).joinPosition()).toBe(startPosition);

            const length = 200;
            const consumed = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, count, () => length),
                consumed,
                length,
                'all messages',
            );

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, count));
            // the position is where the aligned frames end, over every term the stream crossed
            const endPosition = startPosition + count * frameLength(length) + paddingOf(termOffset, count, length);
            expect(publication.position()).toBe(endPosition);
            expect(subscription.imageAtIndex(0).position()).toBe(endPosition);
            expectNoErrors(publisher, subscriber);
            return { publication, endPosition };
        }

        /** The padding frames at the end of the terms the stream crossed, which the aligned frames do not account for. */
        function paddingOf(termOffset: number, count: number, length: number): number {
            let offset = termOffset;
            let padding = 0;
            for (let i = 0; i < count; i++) {
                const frame = frameLength(length);
                if (offset + frame > TERM_LENGTH) {
                    padding += TERM_LENGTH - offset;
                    offset = 0;
                }
                offset += frame;
                if (offset === TERM_LENGTH) {
                    offset = 0;
                }
            }
            return padding;
        }

        it.each([
            ['a non-zero initial term id, from its first term', 100, 100, 0],
            ['a non-zero initial term id, started in a later term at an offset', 100, 103, 1024],
            ['a negative initial term id', -5, -2, 32],
        ])('crossesManyTermsWith %s', async (_name, initialTermId, termId, termOffset) => {
            // 4000 messages of 200 bytes are 960000 bytes: 14 terms
            const { publication, endPosition } = await rotate(initialTermId, termId, termOffset, 4000);
            expect(endPosition).toBeGreaterThan(14 * TERM_LENGTH);
            expect(publication.isClosed()).toBe(false);
        });

        it.each([
            ['the term id wraps from the maximum to the minimum int', 2147483640, 2147483640, 0],
            ['the term id is a few terms from the maximum and the initial term id is not', 2147483000, 2147483645, 64],
            ['the initial term id is the maximum int', 2147483647, 2147483647, 0],
        ])('wrapsTheTermIdWhen %s', async (_name, initialTermId, termId, termOffset) => {
            const { endPosition } = await rotate(initialTermId, termId, termOffset, 4000);
            expect(endPosition).toBeGreaterThan(8 * TERM_LENGTH);
        });
    });

    describe('the publication closes in the middle of a fragmented message', () => {
        it.each([
            ['the default window', ''],
            ['a window of two frames', '|rcv-wnd=4096'],
        ])('whileTheConsumerHasReadPartOfItWith %s', async (_name, window) => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port) + window, STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port, 'term-length=262144'),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            // five messages of 15 frames each
            const length = 15 * publication.maxPayloadLength();
            const work = plan(0, 5, () => length);
            const producer = new Producer(publication, work, length);
            await driveUntil(() => {
                producer.offerSome();
                return producer.isDone();
            }, 'five offers');

            // one fragment at a time: wait for the first one, which is in the middle of the first message
            const consumed = new Consumed();
            let fragments = 0;
            await driveUntil(() => {
                fragments += consumed.poll(subscription, 1);
                return fragments >= 1;
            }, 'a first fragment');
            expect(consumed.sequences).toEqual([]);

            publication.close();
            expect(publication.isClosed()).toBe(true);

            // the log is kept until the stream has been read: the rest of the message comes, and the others
            await driveUntil(() => {
                consumed.poll(subscription, 1);
                return consumed.sequences.length >= 5;
            }, 'all messages after the close');

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual([0, 1, 2, 3, 4]);
            expect(consumed.lengths).toEqual([length, length, length, length, length]);

            // and then the stream ends: the image is told the end of the stream and goes away
            await driveUntil(() => subscription.hasNoImages(), 'the image to end');
            expectNoErrors(publisher, subscriber);
        });
    });

    describe('the subscriber goes away and comes back', () => {
        /** A publisher that notices a missing subscriber within 250 ms, where the default is 5 s. */
        function publisherNode(): SystemNode {
            return newNode((ctx) => void ctx.publicationConnectionTimeoutNs(250_000_000));
        }

        /** Wait for the connection timeout: the publication is not connected, and an offer says so. */
        async function awaitNotConnected(publication: ConcurrentPublication) {
            await driveUntil(() => !publication.isConnected(), 'the connection timeout');
            const message = new UnsafeBuffer(new Uint8Array(100));
            expect(publication.offer(message, 0, 100)).toBe(Publication.NOT_CONNECTED);
        }

        it('theSubscriptionIsRemovedAndAddedAgain', async () => {
            const [publisher, subscriber] = [publisherNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const first = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 300, () => 100),
                first,
                100,
                'the first messages',
            );
            expect(first.sequences).toEqual(sequences(0, 300));
            const firstImageId = subscription.imageAtIndex(0).correlationId();

            // the subscriber is gone: the publication stops being connected, and an offer says so
            subscription.close();
            await awaitNotConnected(publication);
            expect(publication.position()).toBe(300 * frameLength(100));

            // and it is back: a new image, which begins where the publication is
            const back = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            await connected(publication, back);
            const image = back.imageAtIndex(0);
            expect(image.correlationId()).not.toBe(firstImageId);
            expect(image.joinPosition()).toBe(publication.position());

            const second = new Consumed();
            await transfer(
                publication,
                back,
                plan(300, 300, () => 100),
                second,
                100,
                'the messages after the return',
            );
            expect(second.problems).toEqual([]);
            expect(second.sequences).toEqual(sequences(300, 300));
            expect(image.position()).toBe(publication.position());
            expectNoErrors(publisher, subscriber);
        });

        it('theWholeSubscriberDriverRestartsInTheMiddleOfATerm', async () => {
            const [publisher, subscriber] = [publisherNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await connected(publication, subscription);

            const first = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 300, () => 100),
                first,
                100,
                'the first messages',
            );
            expect(first.sequences).toEqual(sequences(0, 300));

            // the subscriber's driver and client end, and the port is free again
            subscriber.close();
            nodes.splice(nodes.indexOf(subscriber), 1);
            await awaitNotConnected(publication);

            const restarted = newNode();
            const back = restarted.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            await connected(publication, back);
            expect(back.imageAtIndex(0).joinPosition()).toBe(publication.position());
            expect(back.imageAtIndex(0).joinPosition() % TERM_LENGTH).not.toBe(0);

            const second = new Consumed();
            await transfer(
                publication,
                back,
                plan(300, 300, () => 100),
                second,
                100,
                'the messages after the restart',
            );
            expect(second.problems).toEqual([]);
            expect(second.sequences).toEqual(sequences(300, 300));
            expectNoErrors(publisher, restarted);
        });
    });

    describe('more than one stream on a channel', () => {
        it('twoImagesOnOneSubscriptionKeepEachSessionInOrder', async () => {
            const [first, second, subscriber] = [newNode(), newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const one = first.aeron.addPublication(publicationChannel(port), STREAM_ID) as ConcurrentPublication;
            const two = second.aeron.addPublication(publicationChannel(port), STREAM_ID) as ConcurrentPublication;
            expect(one.sessionId()).not.toBe(two.sessionId());
            await driveUntil(
                () => one.isConnected() && two.isConnected() && subscription.imageCount() === 2,
                'two images',
            );

            // the first session sends 0.., the second 1000..; the consumer is one handler for both
            const consumed = new Consumed();
            const a = new Producer(
                one,
                plan(0, 500, () => 300),
                300,
            );
            const b = new Producer(
                two,
                plan(1000, 500, () => 700),
                700,
            );
            await driveUntil(() => {
                a.offerSome();
                b.offerSome();
                consumed.poll(subscription);
                return consumed.sequences.length >= 1000;
            }, 'both sessions');

            expect(consumed.problems).toEqual([]);
            for (const [publication, first, count] of [
                [one, 0, 500],
                [two, 1000, 500],
            ] as const) {
                const own = consumed.sequences.filter((_, i) => consumed.sessionIds[i] === publication.sessionId());
                expect(own).toEqual(sequences(first, count));
            }
            expectNoErrors(first, second, subscriber);
        });

        it('twoSubscriptionsOnOneChannelEachReadTheWholeStream', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const one = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const two = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const publication = publisher.aeron.addPublication(
                publicationChannel(port),
                STREAM_ID,
            ) as ConcurrentPublication;
            await driveUntil(
                () => publication.isConnected() && one.imageCount() === 1 && two.imageCount() === 1,
                'both subscriptions',
            );

            const consumedOne = new Consumed();
            const consumedTwo = new Consumed();
            const producer = new Producer(
                publication,
                plan(0, 800, (s) => 50 + (s % 7) * 311),
                50 + 6 * 311,
            );
            await driveUntil(() => {
                producer.offerSome();
                consumedOne.poll(one);
                consumedTwo.poll(two);
                return consumedOne.sequences.length >= 800 && consumedTwo.sequences.length >= 800;
            }, 'both consumers');

            expect(consumedOne.sequences).toEqual(sequences(0, 800));
            expect(consumedTwo.sequences).toEqual(sequences(0, 800));
            expectNoErrors(publisher, subscriber);
        });

        it('twoSharedPublicationsOfOneChannelAndStreamAreOneSession', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const one = publisher.aeron.addPublication(publicationChannel(port), STREAM_ID) as ConcurrentPublication;
            const two = publisher.aeron.addPublication(publicationChannel(port), STREAM_ID) as ConcurrentPublication;
            expect(two.sessionId()).toBe(one.sessionId());
            expect(two.originalRegistrationId()).toBe(one.registrationId());
            expect(two.registrationId()).not.toBe(one.registrationId());
            await connected(one, subscription);

            // one offers the even sequence numbers and the other the odd; the log is one, so the order is the order of the offers
            const consumed = new Consumed();
            const evens = new Producer(
                one,
                plan(0, 400, () => 120),
                120,
            );
            const odds = new Producer(
                two,
                plan(1000, 400, () => 120),
                120,
            );
            await driveUntil(() => {
                evens.offerSome(8);
                odds.offerSome(8);
                consumed.poll(subscription);
                return consumed.sequences.length >= 800;
            }, 'both publications');

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences.filter((s) => s < 1000)).toEqual(sequences(0, 400));
            expect(consumed.sequences.filter((s) => s >= 1000)).toEqual(sequences(1000, 400));
            expect(new Set(consumed.sessionIds).size).toBe(1);
            expectNoErrors(publisher, subscriber);
        });

        it('anExclusivePublicationIsASessionOfItsOwn', async () => {
            const [publisher, subscriber] = [newNode(), newNode()];
            const port = freeUdpPort();
            const subscription = subscriber.aeron.addSubscription(subscriptionChannel(port), STREAM_ID);
            const shared = publisher.aeron.addPublication(publicationChannel(port), STREAM_ID) as ConcurrentPublication;
            const exclusive = publisher.aeron.addExclusivePublication(publicationChannel(port), STREAM_ID)!;
            expect(exclusive.sessionId()).not.toBe(shared.sessionId());
            await driveUntil(
                () => shared.isConnected() && exclusive.isConnected() && subscription.imageCount() === 2,
                'two images',
            );

            const consumed = new Consumed();
            const a = new Producer(
                shared,
                plan(0, 300, () => 90),
                90,
            );
            const b = new Producer(
                exclusive,
                plan(5000, 300, () => 90),
                90,
            );
            await driveUntil(() => {
                a.offerSome();
                b.offerSome();
                consumed.poll(subscription);
                return consumed.sequences.length >= 600;
            }, 'both sessions');

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences.filter((s) => s < 5000)).toEqual(sequences(0, 300));
            expect(consumed.sequences.filter((s) => s >= 5000)).toEqual(sequences(5000, 300));
            expectNoErrors(publisher, subscriber);
        });
    });
});
