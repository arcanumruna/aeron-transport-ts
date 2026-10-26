// Interop tests of T23 (spec 8.3, unicast rows, TS side publication): a TS publication on the TS media driver sends to a
// subscriber of a C client on the Aeron C 1.53.3 media driver (`aeronmd`), over real UDP on the loopback. The C
// subscriber (test/interop/c/interop_subscriber.c) checks every byte and the order against the pattern of the sequence
// number and prints a summary; the tests assert that what was produced equals what was consumed: the same messages, in
// order, no loss and no duplicate. Skipped, with a message, when the C build is missing (see InteropRig.ts).
import { afterEach, describe, expect, it } from 'vitest';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { Producer, SystemNode, plan } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';
import { InteropEnv, driveUntil, interopAvailable, interopSkipReason } from './InteropRig.js';
import type { ChildHandle, SubscriberSummary } from './InteropRig.js';

const STREAM_ID = 1001;
const TERM_LENGTH = 65536;
const MTU = 1408;
const HEADER_LENGTH = 32;
const MAX_MESSAGE = TERM_LENGTH / 8;
const LONG_CAP_MS = 90_000;
const INT32_MAX = 2147483647;

/** The message sizes of spec 8.3: 1 B, MTU - 32, MTU - 31, 2 x MTU, term length / 8 (the maximum message). */
const SIZES = [1, MTU - HEADER_LENGTH, MTU - HEADER_LENGTH + 1, 2 * MTU, MAX_MESSAGE];

/** The data frames and the setup frames: the C driver's loss interceptor drops those it receives (`1 << type`). */
const DATA_AND_SETUP = (1 << 0x01) | (1 << 0x05);

function counter(driver: MediaDriver, descriptor: SystemCounterDescriptor): number {
    return (driver.context().systemCounters() as SystemCounters).get(descriptor).get();
}

describe.skipIf(!interopAvailable)(
    'Unicast interop: TS publication to C subscriber' + (interopSkipReason ?? ''),
    () => {
        const env = new InteropEnv();
        const nodes: SystemNode[] = [];

        afterEach(() => {
            for (const node of nodes.splice(0)) {
                node.close();
            }
            env.dispose();
        });

        function newNode(): SystemNode {
            const node = new SystemNode();
            nodes.push(node);
            return node;
        }

        interface Stream {
            readonly node: SystemNode;
            readonly publication: ConcurrentPublication;
            readonly channel: string;
            readonly subscriberChannel: string;
            readonly cDir: string;
            readonly sub: ChildHandle;
        }

        /** A C driver with a C subscriber on a fresh port, and a TS publication to it (the C side first). */
        async function open(
            args: { sizes: number[]; count: number; first?: number },
            params = 'term-length=' + TERM_LENGTH,
            loss?: { rate: number; seed: number; mask: number },
            last = args.count - 1,
        ): Promise<Stream> {
            const cDir = await env.startDriver({ loss });
            const port = freeUdpPort();
            const subscriberChannel = 'aeron:udp?endpoint=127.0.0.1:' + port;
            const sub = await env.startSubscriber(cDir, subscriberChannel, [
                '-s',
                String(STREAM_ID),
                '-l',
                String(last),
                '-S',
                args.sizes.join(','),
                '-t',
                String(LONG_CAP_MS),
            ]);
            const node = newNode();
            const channel = subscriberChannel + '|' + params;
            const publication = node.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
            return { node, publication, channel, subscriberChannel, cDir, sub };
        }

        /** Offers `count` messages from `first` whose lengths cycle through `sizes`, until all are accepted. */
        async function produce(
            publication: ConcurrentPublication,
            sizes: number[],
            first: number,
            count: number,
        ): Promise<Producer> {
            const producer = new Producer(
                publication,
                plan(first, count, (sequence) => sizes[sequence % sizes.length] as number),
                Math.max(...sizes),
            );
            await driveUntil(
                () => {
                    producer.offerSome();
                    return producer.isDone();
                },
                'the offers of ' + count + ' messages from ' + first + ' (sent ' + producer.sent() + ')',
                LONG_CAP_MS,
            );
            return producer;
        }

        /** The C subscriber read exactly the sequences `first` .. `first + count - 1` of one session, with no error. */
        function expectConsumed(summary: SubscriberSummary, sessionId: number, first: number, count: number): void {
            expect(summary.firstError).toBe('');
            expect(summary.errors).toBe(0);
            expect(summary.sessions).toEqual([{ sessionId, first, last: first + count - 1, count }]);
            expect(summary.count).toBe(count);
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
        ])('aMessageOf %s is read by the C subscriber', async (_name, size) => {
            const count = size === MAX_MESSAGE ? 100 : 1000;
            const { node, publication, sub } = await open({ sizes: [size], count });

            await produce(publication, [size], 0, count);
            const summary = await env.subscriberSummary(sub);

            expectConsumed(summary, publication.sessionId(), 0, count);
            expectNoErrors(node);
        });

        it('messagesOfAllSizesInOneStreamKeepTheirOrder', async () => {
            const count = 1500;
            const { node, publication, sub } = await open({ sizes: SIZES, count });

            await produce(publication, SIZES, 0, count);
            const summary = await env.subscriberSummary(sub);

            expectConsumed(summary, publication.sessionId(), 0, count);
            expectNoErrors(node);
        });

        it('messagesOfAllSizesRotateTheTermsWithAWrappingTermId', async () => {
            const count = 1500;
            const params =
                'term-length=' +
                TERM_LENGTH +
                '|init-term-id=' +
                (INT32_MAX - 2) +
                '|term-id=' +
                (INT32_MAX - 2) +
                '|term-offset=0';
            const { node, publication, sub } = await open({ sizes: SIZES, count }, params);

            await produce(publication, SIZES, 0, count);
            const summary = await env.subscriberSummary(sub);

            expect(publication.initialTermId()).toBe(INT32_MAX - 2);
            expect(publication.position()).toBeGreaterThan(8 * TERM_LENGTH);
            expect(publication.termBufferLength()).toBe(TERM_LENGTH);
            expectConsumed(summary, publication.sessionId(), 0, count);
            expectNoErrors(node);
        });

        it('smallMessagesRotateTheTermsManyTimes', async () => {
            const count = 6000;
            const { node, publication, sub } = await open({ sizes: [100], count });

            await produce(publication, [100], 0, count);
            const summary = await env.subscriberSummary(sub);

            expect(publication.position()).toBeGreaterThan(8 * TERM_LENGTH);
            expectConsumed(summary, publication.sessionId(), 0, count);
            expectNoErrors(node);
        });

        describe('with frames lost by the C driver', () => {
            it.each([
                ['5% of the data and setup frames, messages of all sizes', 0.05, 11, SIZES, 1500],
                ['20% of the data and setup frames, messages of 100 bytes', 0.2, 12, [100], 3000],
            ])('%s are asked for again and sent again', async (_name, rate, seed, sizes, count) => {
                const { node, publication, sub } = await open({ sizes, count }, undefined, {
                    rate,
                    seed,
                    mask: DATA_AND_SETUP,
                });

                await produce(publication, sizes, 0, count);
                const summary = await env.subscriberSummary(sub);

                expectConsumed(summary, publication.sessionId(), 0, count);
                expect(counter(node.driver, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBeGreaterThan(0);
                expect(counter(node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
                expectNoErrors(node);
            });

            it('loss during the rotation of the terms with a wrapping term id', async () => {
                const count = 1500;
                const params =
                    'term-length=' +
                    TERM_LENGTH +
                    '|init-term-id=' +
                    (INT32_MAX - 1) +
                    '|term-id=' +
                    (INT32_MAX - 1) +
                    '|term-offset=0';
                const { node, publication, sub } = await open({ sizes: SIZES, count }, params, {
                    rate: 0.05,
                    seed: 13,
                    mask: DATA_AND_SETUP,
                });

                await produce(publication, SIZES, 0, count);
                const summary = await env.subscriberSummary(sub);

                expectConsumed(summary, publication.sessionId(), 0, count);
                expect(counter(node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
                expectNoErrors(node);
            });
        });

        describe('subscribers and publications that leave', () => {
            const SIZES_HERE = [100, 1400, 3000];

            it('aSubscriberThatLeavesAndAnotherThatJoinsReadTheTailOfTheStream', async () => {
                const first = 1200;
                const second = 1200;
                const { node, publication, subscriberChannel, cDir, sub } = await open(
                    { sizes: SIZES_HERE, count: first },
                    undefined,
                    undefined,
                    first - 1,
                );

                await produce(publication, SIZES_HERE, 0, first);
                const before = await env.subscriberSummary(sub);
                expectConsumed(before, publication.sessionId(), 0, first);

                // the first subscriber is gone; a new one joins the same channel while the publication goes on
                const rejoined = await env.startSubscriber(cDir, subscriberChannel, [
                    '-s',
                    String(STREAM_ID),
                    '-l',
                    String(first + second - 1),
                    '-S',
                    SIZES_HERE.join(','),
                    '-t',
                    String(LONG_CAP_MS),
                ]);
                await produce(publication, SIZES_HERE, first, second);
                const after = await env.subscriberSummary(rejoined);

                expect(after.firstError).toBe('');
                expect(after.errors).toBe(0);
                expect(after.available).toBeGreaterThanOrEqual(1);
                expect(after.sessions).toHaveLength(1);
                const session = after.sessions[0] as SubscriberSummary['sessions'][number];
                expect(session.sessionId).toBe(publication.sessionId());
                expect(session.last).toBe(first + second - 1);
                expect(session.count).toBe(session.last - session.first + 1);
                expect(session.first).toBeGreaterThanOrEqual(first);
                expectNoErrors(node);
            });

            it('aPublicationThatClosesEndsTheImageWithTheEndOfStreamAndANewOneStartsAnother', async () => {
                const first = 800;
                const second = 800;
                const { node, publication, channel, sub } = await open(
                    { sizes: SIZES_HERE, count: first },
                    undefined,
                    undefined,
                    first + second - 1,
                );

                await produce(publication, SIZES_HERE, 0, first);
                const firstSession = publication.sessionId();
                await driveUntil(() => sub.count('available') >= 1, 'the image of the first publication');
                publication.close();
                const ended = await env.waitForEvent(sub, 'unavailable');
                expect(ended).toMatchObject({ sessionId: firstSession, eos: true });

                const next = node.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
                expect(next.sessionId()).not.toBe(firstSession);
                await produce(next, SIZES_HERE, first, second);
                const summary = await env.subscriberSummary(sub);

                expect(summary.firstError).toBe('');
                expect(summary.errors).toBe(0);
                expect(summary.available).toBe(2);
                expect(summary.eos).toBeGreaterThanOrEqual(1);
                expect(summary.sessions).toEqual([
                    { sessionId: firstSession, first: 0, last: first - 1, count: first },
                    { sessionId: next.sessionId(), first, last: first + second - 1, count: second },
                ]);
                expectNoErrors(node);
            });
        });
    },
);
