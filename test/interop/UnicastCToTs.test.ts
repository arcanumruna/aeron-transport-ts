// Interop tests of T23 (spec 8.3, unicast rows, TS side subscription): a publisher of a C client on the Aeron C 1.53.3
// media driver (`aeronmd`) sends to a TS subscription on the TS media driver, over real UDP on the loopback. The C
// publisher (test/interop/c/interop_publisher.c) makes messages whose bytes are derived from their sequence number; the
// TS consumer checks every byte, the lengths and the order. In every case what was produced equals what was consumed:
// the same messages, in order, no loss and no duplicate. Data loss on this path is made by a loopback relay between the
// C driver and the TS driver (the C driver's own loss interceptor drops what the C driver receives: the status messages
// and NAKs that the TS side sends). Skipped, with a message, when the C build is missing (see InteropRig.ts).
import { afterEach, describe, expect, it } from 'vitest';
import type { Image } from '../../src/client/Image.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { Consumed, SystemNode, sequences } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';
import { InteropEnv, driveUntil, LossyRelay, interopAvailable, interopSkipReason } from './InteropRig.js';
import type { ChildHandle, PublisherSummary } from './InteropRig.js';

const STREAM_ID = 1001;
const TERM_LENGTH = 65536;
const MTU = 1408;
const HEADER_LENGTH = 32;
const MAX_MESSAGE = TERM_LENGTH / 8;
const LONG_CAP_MS = 90_000;
const QUIET_MS = 300;
const INT32_MAX = 2147483647;

/** The message sizes of spec 8.3: 1 B, MTU - 32, MTU - 31, 2 x MTU, term length / 8 (the maximum message). */
const SIZES = [1, MTU - HEADER_LENGTH, MTU - HEADER_LENGTH + 1, 2 * MTU, MAX_MESSAGE];

/** `1 << type` of the status messages (3) and the NAKs (2): what the C driver receives from the TS subscriber. */
const SM_AND_NAK = (1 << 0x03) | (1 << 0x02);
const SM = 1 << 0x03;

function counter(driver: MediaDriver, descriptor: SystemCounterDescriptor): number {
    return (driver.context().systemCounters() as SystemCounters).get(descriptor).get();
}

interface ImageEnd {
    readonly sessionId: number;
    readonly endOfStream: boolean;
}

describe.skipIf(!interopAvailable)(
    'Unicast interop: C publication to TS subscription' + (interopSkipReason ?? ''),
    () => {
        const env = new InteropEnv();

        afterEach(() => {
            env.dispose();
        });

        class Side {
            public readonly node = new SystemNode();
            public readonly available: number[] = [];
            public readonly ended: ImageEnd[] = [];
            public readonly port = freeUdpPort();
            public readonly endpoint = 'aeron:udp?endpoint=127.0.0.1:' + this.port;

            public constructor() {
                env.onDispose(() => this.node.close());
            }

            public subscribe(): Subscription {
                return this.node.aeron.addSubscription(
                    this.endpoint,
                    STREAM_ID,
                    { onAvailableImage: (image: Image) => void this.available.push(image.sessionId()) },
                    {
                        onUnavailableImage: (image: Image) =>
                            void this.ended.push({ sessionId: image.sessionId(), endOfStream: image.isEndOfStream() }),
                    },
                );
            }
        }

        interface Stream {
            readonly side: Side;
            readonly subscription: Subscription;
            readonly cDir: string;
            /** where the C publisher sends: the endpoint of the subscription, or the front of the relay */
            readonly publisherChannel: string;
            readonly relay: LossyRelay | null;
        }

        /** A TS subscription, a C driver, and, when `relayLoss` is given, a lossy relay between the two. */
        async function open(
            params = 'term-length=' + TERM_LENGTH,
            cLoss?: { rate: number; seed: number; mask: number },
            relayLoss?: { rate: number; seed: number },
        ): Promise<Stream> {
            const cDir = await env.startDriver({ loss: cLoss });
            const side = new Side();
            const subscription = side.subscribe();
            let relay: LossyRelay | null = null;
            let to = side.port;
            if (relayLoss) {
                to = freeUdpPort();
                relay = await LossyRelay.open(to, side.port, relayLoss.rate, relayLoss.seed);
                env.onDispose(() => relay?.close());
            }

            return {
                side,
                subscription,
                cDir,
                publisherChannel: 'aeron:udp?endpoint=127.0.0.1:' + to + '|' + params,
                relay,
            };
        }

        function publish(
            stream: Stream,
            sizes: number[],
            count: number,
            first = 0,
            channel = stream.publisherChannel,
        ): ChildHandle {
            return env.startPublisher(stream.cDir, channel, [
                '-s',
                String(STREAM_ID),
                '-n',
                String(count),
                '-f',
                String(first),
                '-S',
                sizes.join(','),
                '-t',
                String(LONG_CAP_MS),
                '-w',
                String(LONG_CAP_MS),
            ]);
        }

        /** Polls until the consumer has read `count` messages, then for a quiet time more (to find extra messages). */
        async function consume(subscription: Subscription, consumed: Consumed, count: number): Promise<void> {
            await driveUntil(
                () => {
                    consumed.poll(subscription);
                    expect(consumed.problems).toEqual([]);
                    return consumed.sequences.length >= count;
                },
                'all ' + count + ' messages (read ' + consumed.sequences.length + ')',
                LONG_CAP_MS,
            );
            const until = performance.now() + QUIET_MS;
            await driveUntil(() => {
                consumed.poll(subscription);
                return performance.now() >= until;
            }, 'the quiet time');
        }

        /** What was produced equals what was consumed: the same messages, same lengths, in order, no duplicate. */
        function expectConsumed(
            consumed: Consumed,
            sizes: number[],
            first: number,
            count: number,
            sessionId: number,
            modulo = 0,
        ): void {
            expect(consumed.problems).toEqual([]);
            const wanted = sequences(first, count);
            expect(consumed.sequences).toEqual(modulo > 0 ? wanted.map((s) => s % modulo) : wanted);
            expect(consumed.lengths).toEqual(wanted.map((s) => sizes[s % sizes.length] as number));
            expect(new Set(consumed.sessionIds)).toEqual(new Set([sessionId]));
        }

        function expectNoErrors(...of: SystemNode[]): void {
            for (const node of of) {
                expect(node.errors.map(String)).toEqual([]);
            }
        }

        it.each([
            ['1 byte', 1],
            ['MTU - 32 (one full frame)', MTU - HEADER_LENGTH],
            ['MTU - 31 (two frames)', MTU - HEADER_LENGTH + 1],
            ['2 x MTU', 2 * MTU],
            ['term length / 8 (the maximum message)', MAX_MESSAGE],
        ])('aMessageOf %s is read by the TS subscriber', async (_name, size) => {
            const count = size === MAX_MESSAGE ? 100 : 1000;
            const stream = await open();
            const pub = publish(stream, [size], count);

            // a message of 1 byte holds the low byte of its sequence only
            const consumed = new Consumed(size === 1 ? 256 : 0);
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expect(sent.sent).toBe(count);
            expectConsumed(consumed, [size], 0, count, sent.sessionId, size === 1 ? 256 : 0);
            expectNoErrors(stream.side.node);
        });

        it('messagesOfAllSizesInOneStreamKeepTheirOrder', async () => {
            const count = 1500;
            const stream = await open();
            const pub = publish(stream, SIZES, count);

            const consumed = new Consumed(256);
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            // the 1 byte messages repeat the low byte of the sequence; the others carry all of it
            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, count).map((s) => s % 256));
            expect(consumed.lengths).toEqual(sequences(0, count).map((s) => SIZES[s % SIZES.length] as number));
            expect(new Set(consumed.sessionIds)).toEqual(new Set([sent.sessionId]));
            expectNoErrors(stream.side.node);
        });

        it('messagesOfAllSizesRotateTheTermsWithAWrappingTermId', async () => {
            const count = 1500;
            const params = `term-length=${TERM_LENGTH}|init-term-id=${INT32_MAX - 2}|term-id=${INT32_MAX - 2}|term-offset=0`;
            const stream = await open(params);
            const pub = publish(stream, SIZES, count);

            const consumed = new Consumed(256);
            await consume(stream.subscription, consumed, count);
            const sent: PublisherSummary = await env.publisherSent(pub);

            expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, count).map((s) => s % 256));
            expect(consumed.lengths).toEqual(sequences(0, count).map((s) => SIZES[s % SIZES.length] as number));
            const image = stream.subscription.imageAtIndex(0);
            expect(image.initialTermId()).toBe(INT32_MAX - 2);
            expect(image.termBufferLength()).toBe(TERM_LENGTH);
            expectNoErrors(stream.side.node);
        });

        it('smallMessagesRotateTheTermsManyTimes', async () => {
            const count = 6000;
            const stream = await open();
            const pub = publish(stream, [100], count);

            const consumed = new Consumed();
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
            expectConsumed(consumed, [100], 0, count, sent.sessionId);
            expectNoErrors(stream.side.node);
        });

        it('slowTsSubscriberBackPressuresTheCPublisher', async () => {
            // the TS side does not poll while the C publisher offers flat out; the C publisher prints its counts only at
            // the end, so the stall is found from the TS driver: the bytes it received stop growing (the window of the
            // receiver is full) while the C publisher has not offered all its messages
            const sizes = [100, 1400, 3000];
            const count = 1500;
            const stream = await open();
            const pub = publish(stream, sizes, count);
            const received = (): number => counter(stream.side.node.driver, SystemCounterDescriptor.BYTES_RECEIVED);

            let last = -1;
            let still = 0;
            await driveUntil(
                () => {
                    const bytes = received();
                    still = bytes === last ? still + 1 : 0;
                    last = bytes;
                    return bytes > 0 && still >= 5000;
                },
                'a stalled C publisher (bytes received ' + received() + ')',
            );
            expect(pub.count('sent')).toBe(0);
            expect(stream.subscription.imageCount()).toBe(1);
            expect(stream.subscription.imageAtIndex(0).position()).toBe(0);
            // the receiver took at most its window: half a term
            expect(last).toBeLessThanOrEqual(TERM_LENGTH / 2 + MTU);
            expect(last).toBeGreaterThan(0);

            const consumed = new Consumed();
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expect(sent.backPressured).toBeGreaterThan(0);
            expect(sent.sent).toBe(count);
            expectConsumed(consumed, sizes, 0, count, sent.sessionId);
            expectNoErrors(stream.side.node);
        });

        describe('with frames lost', () => {
            it('statusMessagesAndNaksLostByTheCDriverDoNotLoseOrReorderMessages', async () => {
                const count = 1500;
                const stream = await open(undefined, { rate: 0.3, seed: 21, mask: SM_AND_NAK });
                const pub = publish(stream, [100, 1400, 3000], count);

                const consumed = new Consumed();
                await consume(stream.subscription, consumed, count);
                const sent = await env.publisherSent(pub);

                expectConsumed(consumed, [100, 1400, 3000], 0, count, sent.sessionId);
                expectNoErrors(stream.side.node);
            });

            it.each([
                ['5% of the data frames, messages of all sizes', 0.05, 31, SIZES, 1500],
                ['20% of the data frames, messages of 100 bytes', 0.2, 32, [100], 3000],
            ])(
                '%s are asked for again (NAK) and sent again by the C driver',
                async (_name, rate, seed, sizes, count) => {
                    const stream = await open(undefined, undefined, { rate, seed });
                    const pub = publish(stream, sizes, count);

                    const consumed = new Consumed(256);
                    await consume(stream.subscription, consumed, count);
                    const sent = await env.publisherSent(pub);

                    expect(consumed.problems).toEqual([]);
                    expect(consumed.sequences).toEqual(sequences(0, count).map((s) => s % 256));
                    expect(consumed.lengths).toEqual(sequences(0, count).map((s) => sizes[s % sizes.length] as number));
                    expect(new Set(consumed.sessionIds)).toEqual(new Set([sent.sessionId]));
                    expect(stream.relay?.dropped).toBeGreaterThan(0);
                    expect(counter(stream.side.node.driver, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(
                        0,
                    );
                    expectNoErrors(stream.side.node);
                },
            );

            it('dataLostDuringTheRotationOfTheTermsWithAWrappingTermIdAndTheirNaksLostToo', async () => {
                const count = 1500;
                const params = `term-length=${TERM_LENGTH}|init-term-id=${INT32_MAX - 1}|term-id=${INT32_MAX - 1}|term-offset=0`;
                const stream = await open(params, { rate: 0.15, seed: 41, mask: SM_AND_NAK }, { rate: 0.05, seed: 42 });
                const pub = publish(stream, SIZES, count);

                const consumed = new Consumed(256);
                await consume(stream.subscription, consumed, count);
                const sent = await env.publisherSent(pub);

                expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
                expect(consumed.problems).toEqual([]);
                expect(consumed.sequences).toEqual(sequences(0, count).map((s) => s % 256));
                expect(consumed.lengths).toEqual(sequences(0, count).map((s) => SIZES[s % SIZES.length] as number));
                expect(stream.relay?.dropped).toBeGreaterThan(0);
                expect(counter(stream.side.node.driver, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(0);
                expectNoErrors(stream.side.node);
            });

            it('statusMessagesLostToAFullWindowAreRepeated', async () => {
                // nearly all status messages are lost: the receiver's heartbeat path has to carry the window forward
                const count = 800;
                const stream = await open(undefined, { rate: 0.7, seed: 51, mask: SM });
                const pub = publish(stream, [1400], count);

                const consumed = new Consumed();
                await consume(stream.subscription, consumed, count);
                const sent = await env.publisherSent(pub);

                expectConsumed(consumed, [1400], 0, count, sent.sessionId);
                expectNoErrors(stream.side.node);
            });
        });

        describe('subscribers and publications that leave', () => {
            const SIZES_HERE = [100, 1400, 3000];

            it('aSubscriptionThatIsClosedAndAddedAgainReadsTheTailOfTheStream', async () => {
                const count = 6000;
                const stream = await open();
                const pub = publish(stream, SIZES_HERE, count);

                const firstRead = new Consumed();
                await driveUntil(() => {
                    firstRead.poll(stream.subscription);
                    return firstRead.sequences.length >= 1000;
                }, 'the first 1000 messages');
                const sessionId = stream.subscription.imageAtIndex(0).sessionId();
                stream.subscription.close();
                expect(firstRead.problems).toEqual([]);
                expect(firstRead.sequences).toEqual(sequences(0, firstRead.sequences.length));

                const subscription = stream.side.subscribe();
                const tail = new Consumed();
                await driveUntil(
                    () => {
                        tail.poll(subscription);
                        return tail.sequences.length > 0 && tail.sequences[tail.sequences.length - 1] === count - 1;
                    },
                    'the end of the stream (read ' + tail.sequences.length + ')',
                    LONG_CAP_MS,
                );
                const sent = await env.publisherSent(pub);

                expect(sent.sessionId).toBe(sessionId);
                expect(tail.problems).toEqual([]);
                const from = tail.sequences[0] as number;
                expect(from).toBeGreaterThan(0);
                expect(tail.sequences).toEqual(sequences(from, count - from));
                expect(tail.lengths).toEqual(tail.sequences.map((s) => SIZES_HERE[s % SIZES_HERE.length] as number));
                expect(stream.side.available).toEqual([sessionId, sessionId]);
                expectNoErrors(stream.side.node);
            });

            it('aPublicationThatClosesEndsTheImageWithTheEndOfStreamAndANewOneStartsAnother', async () => {
                const first = 800;
                const second = 800;
                const stream = await open();
                const pub = publish(stream, SIZES_HERE, first);

                const consumed = new Consumed();
                await consume(stream.subscription, consumed, first);
                const sent = await env.publisherSent(pub);
                expectConsumed(consumed, SIZES_HERE, 0, first, sent.sessionId);

                // the publisher closes its publication (stdin of the helper): the end of stream reaches the image
                pub.closeInput();
                await driveUntil(
                    () => {
                        consumed.poll(stream.subscription);
                        return stream.side.ended.length >= 1;
                    },
                    'the end of the first image',
                    LONG_CAP_MS,
                );
                expect(stream.side.ended).toEqual([{ sessionId: sent.sessionId, endOfStream: true }]);

                const next = publish(stream, SIZES_HERE, second, first);
                const more = new Consumed();
                await consume(stream.subscription, more, second);
                const sentNext = await env.publisherSent(next);

                expect(sentNext.sessionId).not.toBe(sent.sessionId);
                expectConsumed(more, SIZES_HERE, first, second, sentNext.sessionId);
                expect(stream.side.available).toEqual([sent.sessionId, sentNext.sessionId]);
                expectNoErrors(stream.side.node);
            });
        });
    },
);
