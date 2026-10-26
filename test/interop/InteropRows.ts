// The rows of spec 8.3 that every multicast-like channel type shares (T13, D108): fragmentation sizes and term rotation
// (more than eight terms with a non-zero `init-term-id` near `Integer.MAX_VALUE`, so the term id wraps), in both
// directions. `describeStreamRows('mdcDynamic' | 'mdcManual' | 'multicast')` registers them for one channel type:
//
// - a TS publication and two C subscribers, each in a C driver of its own (the TS side sends, two receivers read);
// - a C publication and a TS subscription (one receiver).
//
// Every row asserts that what was produced equals what was consumed: the same messages, in order, no loss and no
// duplicate, at every receiver.
import { afterEach, describe, expect, it } from 'vitest';
import { SystemNode } from '../support/SystemRig.js';
import { InteropEnv, interopAvailable, interopSkipReason } from './InteropRig.js';
import {
    FromPublisher,
    HEADER_LENGTH,
    MAX_MESSAGE,
    MIXED,
    MTU,
    SIZES,
    TERM_LENGTH,
    TERM_PARAMS,
    ToReceivers,
    consume,
    consumerFor,
    expectConsumed,
    expectConsumedByC,
    expectNoErrors,
    produce,
    wrappingTermParams,
} from './InteropStreams.js';
import type { PublicationKind } from './InteropStreams.js';

const TITLES: Record<PublicationKind, string> = {
    mdcDynamic: 'MDC dynamic',
    mdcManual: 'MDC manual',
    multicast: 'Multicast',
};

export function describeStreamRows(kind: PublicationKind): void {
    describe.skipIf(!interopAvailable)(
        TITLES[kind] + ' interop: sizes and term rotation' + (interopSkipReason ?? ''),
        () => {
            const env = new InteropEnv();
            const nodes: SystemNode[] = [];

            afterEach((context) => {
                for (const node of nodes.splice(0)) {
                    node.close();
                }
                env.dispose(context.task.result?.state === 'fail');
            });

            const sizeCases: Array<[string, number]> = [
                ['1 byte', 1],
                ['MTU - 32 (one full frame)', MTU - HEADER_LENGTH],
                ['MTU - 31 (two frames)', MTU - HEADER_LENGTH + 1],
                ['2 x MTU', 2 * MTU],
                ['term length / 8 (the maximum message)', MAX_MESSAGE],
            ];

            describe('TS publication, two C subscribers', () => {
                it.each(sizeCases)('aMessageOf %s is read by both C subscribers', async (_name, size) => {
                    const count = size === MAX_MESSAGE ? 100 : 600;
                    const stream = await new ToReceivers(env, nodes).open(kind, { sizes: [size], count });

                    await produce(stream.publication, [size], 0, count);
                    for (const receiver of stream.receivers) {
                        expectConsumedByC(
                            await env.subscriberSummary(receiver.sub),
                            stream.publication.sessionId(),
                            0,
                            count,
                        );
                    }
                    expectNoErrors(stream.node);
                });

                it('messagesOfAllSizesInOneStreamKeepTheirOrder', async () => {
                    const count = 1500;
                    const stream = await new ToReceivers(env, nodes).open(kind, { sizes: SIZES, count });

                    await produce(stream.publication, SIZES, 0, count);
                    for (const receiver of stream.receivers) {
                        expectConsumedByC(
                            await env.subscriberSummary(receiver.sub),
                            stream.publication.sessionId(),
                            0,
                            count,
                        );
                    }
                    expectNoErrors(stream.node);
                });

                it('messagesOfAllSizesRotateTheTermsWithAWrappingTermId', async () => {
                    const count = 1500;
                    const stream = await new ToReceivers(env, nodes).open(kind, {
                        sizes: SIZES,
                        count,
                        params: wrappingTermParams(2),
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

                    expect(stream.publication.initialTermId()).not.toBe(0);
                    expect(stream.publication.position()).toBeGreaterThan(8 * TERM_LENGTH);
                    expect(stream.publication.termBufferLength()).toBe(TERM_LENGTH);
                    expectNoErrors(stream.node);
                });
            });

            describe('C publication, TS subscription', () => {
                it.each(sizeCases)('aMessageOf %s is read by the TS subscriber', async (_name, size) => {
                    const count = size === MAX_MESSAGE ? 100 : 600;
                    const from = new FromPublisher(env, nodes);
                    const stream = await from.open(kind, TERM_PARAMS);
                    const pub = from.publish(stream, [size], count);

                    const consumed = consumerFor([size]);
                    await consume(stream.subscription, consumed, count);
                    const sent = await env.publisherSent(pub);

                    expect(sent.sent).toBe(count);
                    expectConsumed(consumed, [size], 0, count, sent.sessionId);
                    expectNoErrors(stream.side.node);
                });

                it('messagesOfAllSizesInOneStreamKeepTheirOrder', async () => {
                    const count = 1500;
                    const from = new FromPublisher(env, nodes);
                    const stream = await from.open(kind, TERM_PARAMS);
                    const pub = from.publish(stream, SIZES, count);

                    const consumed = consumerFor(SIZES);
                    await consume(stream.subscription, consumed, count);
                    const sent = await env.publisherSent(pub);

                    expectConsumed(consumed, SIZES, 0, count, sent.sessionId);
                    expectNoErrors(stream.side.node);
                });

                it('messagesOfAllSizesRotateTheTermsWithAWrappingTermId', async () => {
                    const count = 1500;
                    const from = new FromPublisher(env, nodes);
                    const stream = await from.open(kind, wrappingTermParams(2));
                    const pub = from.publish(stream, SIZES, count);

                    const consumed = consumerFor(SIZES);
                    await consume(stream.subscription, consumed, count);
                    const sent = await env.publisherSent(pub);

                    expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
                    expectConsumed(consumed, SIZES, 0, count, sent.sessionId);
                    const image = stream.subscription.imageAtIndex(0);
                    expect(image.initialTermId()).not.toBe(0);
                    expect(image.termBufferLength()).toBe(TERM_LENGTH);
                    expectNoErrors(stream.side.node);
                });

                it('smallMessagesRotateTheTermsManyTimes', async () => {
                    const count = 6000;
                    const from = new FromPublisher(env, nodes);
                    const stream = await from.open(kind, TERM_PARAMS);
                    const pub = from.publish(stream, MIXED.slice(0, 1), count);

                    const consumed = consumerFor(MIXED.slice(0, 1));
                    await consume(stream.subscription, consumed, count);
                    const sent = await env.publisherSent(pub);

                    expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
                    expectConsumed(consumed, MIXED.slice(0, 1), 0, count, sent.sessionId);
                    expectNoErrors(stream.side.node);
                });
            });
        },
    );
}
