// Interop tests of T13 (spec 8.3, MDC rows, D108, D116): multi-destination-cast between the TS transport and the Aeron
// C 1.53.3 media driver, over real UDP on the loopback, dynamic (`control-mode=dynamic`: the receivers send their status
// messages to the control endpoint) and manual (`control-mode=manual`: the publication names its destinations).
//
// - sizes and term rotation, both directions: InteropRows.ts;
// - loss (D107): the C driver's interceptor drops what the C driver receives (data and setup at the C subscribers; status
//   messages and NAKs at the C publisher), and a `LossyRelay` drops the data frames that go to the TS subscription;
// - a C subscriber that leaves and rejoins: the connection timeout of the TS publication, the image that the new subscriber
//   creates, and the end of stream that reaches it when the publication closes.
// Every row asserts that what was produced equals what was consumed: the same messages, in order, no loss and no duplicate.
import { afterEach, describe, expect, it } from 'vitest';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { Producer, SystemNode, plan } from '../support/SystemRig.js';
import { describeStreamRows } from './InteropRows.js';
import { InteropEnv, driveUntil, interopAvailable, interopSkipReason } from './InteropRig.js';
import {
    DATA_AND_SETUP,
    FromPublisher,
    LONG_CAP_MS,
    MIXED,
    SIZES,
    SM_AND_NAK,
    TERM_LENGTH,
    ToReceivers,
    consume,
    consumerFor,
    counter,
    expectConsumed,
    expectConsumedByC,
    expectNoErrors,
    produce,
    wrappingTermParams,
} from './InteropStreams.js';
import type { PublicationKind } from './InteropStreams.js';
import type { SubscriberSummary } from './InteropRig.js';

describeStreamRows('mdcDynamic');
describeStreamRows('mdcManual');

describe.skipIf(!interopAvailable)('MDC interop: loss and rejoin' + (interopSkipReason ?? ''), () => {
    const env = new InteropEnv();
    const nodes: SystemNode[] = [];

    afterEach((context) => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
        env.dispose(context.task.result?.state === 'fail');
    });

    const mdcKinds: Array<[string, 'mdcDynamic' | 'mdcManual']> = [
        ['dynamic MDC', 'mdcDynamic'],
        ['manual MDC', 'mdcManual'],
    ];

    describe('with frames lost by the C drivers of the subscribers', () => {
        it.each(mdcKinds)(
            '%s: data and setup lost at both subscribers are asked for again and sent again',
            async (_n, kind) => {
                const count = 1500;
                const stream = await new ToReceivers(env, nodes).open(kind, {
                    sizes: SIZES,
                    count,
                    loss: [
                        { rate: 0.05, seed: 71, mask: DATA_AND_SETUP },
                        { rate: 0.05, seed: 72, mask: DATA_AND_SETUP },
                    ],
                });

                await produce(stream.publication, SIZES, 0, count);
                for (const receiver of stream.receivers) {
                    expectConsumedByC(
                        await env.subscriberSummary(receiver.sub),
                        stream.publication.sessionId(),
                        0,
                        count,
                    );
                }

                expect(counter(stream.node.driver, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBeGreaterThan(0);
                expect(counter(stream.node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
                expectNoErrors(stream.node);
            },
        );

        it.each(mdcKinds)('%s: loss during the rotation of the terms with a wrapping term id', async (_n, kind) => {
            const count = 1500;
            const stream = await new ToReceivers(env, nodes).open(kind, {
                sizes: SIZES,
                count,
                params: wrappingTermParams(1),
                loss: [
                    { rate: 0.05, seed: 73, mask: DATA_AND_SETUP },
                    { rate: 0.1, seed: 74, mask: DATA_AND_SETUP },
                ],
            });

            await produce(stream.publication, SIZES, 0, count);
            for (const receiver of stream.receivers) {
                expectConsumedByC(await env.subscriberSummary(receiver.sub), stream.publication.sessionId(), 0, count);
            }

            expect(stream.publication.position()).toBeGreaterThan(8 * TERM_LENGTH);
            expect(counter(stream.node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
            expectNoErrors(stream.node);
        });
    });

    describe('with frames lost on the way to the TS subscription and at the C publisher', () => {
        it.each(mdcKinds)(
            '%s: data lost by the relay and status messages and NAKs lost by the C driver',
            async (_n, kind) => {
                const count = 1500;
                const from = new FromPublisher(env, nodes);
                const stream = await from.open(kind, wrappingTermParams(1), {
                    cLoss: { rate: 0.3, seed: 81, mask: SM_AND_NAK },
                    relays: [{ rate: 0.05, seed: 82 }],
                });
                const pub = from.publish(stream, SIZES, count);

                const consumed = consumerFor(SIZES);
                await consume(stream.subscription, consumed, count);
                const sent = await env.publisherSent(pub);

                expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
                expectConsumed(consumed, SIZES, 0, count, sent.sessionId);
                expect(stream.relays[0]?.dropped).toBeGreaterThan(0);
                expect(counter(stream.side.node.driver, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(0);
                expectNoErrors(stream.side.node);
            },
        );

        it.each(mdcKinds)(
            '%s: 20% of the data frames of messages of 100 bytes are asked for again',
            async (_n, kind) => {
                const count = 3000;
                const from = new FromPublisher(env, nodes);
                const stream = await from.open(kind, 'term-length=' + TERM_LENGTH, {
                    relays: [{ rate: 0.2, seed: 83 }],
                });
                const pub = from.publish(stream, [100], count);

                const consumed = consumerFor([100]);
                await consume(stream.subscription, consumed, count);
                const sent = await env.publisherSent(pub);

                expectConsumed(consumed, [100], 0, count, sent.sessionId);
                expect(stream.relays[0]?.dropped).toBeGreaterThan(0);
                expect(counter(stream.side.node.driver, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(0);
                expectNoErrors(stream.side.node);
            },
        );
    });

    describe('a C subscriber that leaves and rejoins', () => {
        /** The publication of the TS side is not connected: an offer answers NOT_CONNECTED. */
        function expectNotConnected(publication: ConcurrentPublication, next: number): void {
            const probe = new Producer(
                publication,
                plan(next, 1, () => 100),
                100,
            );
            probe.offerSome();
            expect(probe.notConnected).toBe(1);
            expect(probe.sent()).toBe(0);
        }

        it.each(mdcKinds)(
            '%s: the connection times out, the new subscriber gets a new image, the end of stream reaches it',
            async (_n, kind: PublicationKind) => {
                const first = 600;
                const second = 600;
                const streams = new ToReceivers(env, nodes);
                // a connection that times out within a second of silence, where the default is five
                const stream = await streams.open(kind, {
                    sizes: MIXED,
                    count: first,
                    receivers: 1,
                    configure: (context) => void context.publicationConnectionTimeoutNs(1_000_000_000),
                });
                const sessionId = stream.publication.sessionId();

                await produce(stream.publication, MIXED, 0, first);
                const before = await env.subscriberSummary(stream.receivers[0]!.sub);
                expectConsumedByC(before, sessionId, 0, first);
                expect(before.available).toBe(1);

                // the subscriber has left: no status message reaches the publication, which times its connection out
                await driveUntil(
                    () => !stream.publication.isConnected(),
                    'the publication to lose its connection',
                    LONG_CAP_MS,
                );
                expectNotConnected(stream.publication, first);

                // a new subscriber on the same channel: a new image, and the publication connects again
                const rejoined = await streams.rejoin(stream, 0, {
                    sizes: MIXED,
                    last: first + second - 1,
                    receiverArgs: ['-E'],
                });
                await driveUntil(
                    () => stream.publication.isConnected(),
                    'the publication to connect again',
                    LONG_CAP_MS,
                );
                await produce(stream.publication, MIXED, first, second);
                // the publication closes after its last message: the end of stream ends the image of the new subscriber
                stream.publication.close();
                const after: SubscriberSummary = await env.subscriberSummary(rejoined);

                expect(after.firstError).toBe('');
                expect(after.errors).toBe(0);
                expect(after.available).toBe(1);
                expect(after.sessions).toEqual([{ sessionId, first, last: first + second - 1, count: second }]);
                expect(after.unavailable).toBe(1);
                expect(after.eos).toBe(1);
                expect(rejoined.ofKind('unavailable')).toEqual([expect.objectContaining({ sessionId, eos: true })]);
                expectNoErrors(stream.node);
            },
        );
    });
});
