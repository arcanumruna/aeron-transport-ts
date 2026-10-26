// Interop tests of T13 (spec 8.3, MDS row, D108, D116): a TS multi-destination subscription (`control-mode=manual` and
// `addDestination`) with two destinations, and a C publication that sends the same stream to both (manual MDC with two
// destinations: `interop_publisher -D <destination> -D <destination>`), over real UDP on the loopback. The subscription
// merges the two copies of every frame into one image: each message is read once, in order. A `LossyRelay` on each
// destination counts what went through it and drops some of the data frames, so that the two destinations are lossy at
// different points. Every row asserts that what was produced equals what was consumed: the same messages, in order, no
// loss and no duplicate.
import { afterEach, describe, expect, it } from 'vitest';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemNode } from '../support/SystemRig.js';
import { InteropEnv, driveUntil, interopAvailable, interopSkipReason } from './InteropRig.js';
import {
    FromPublisher,
    LONG_CAP_MS,
    MIXED,
    SIZES,
    TERM_LENGTH,
    TERM_PARAMS,
    awaitCommand,
    consume,
    consumerFor,
    counter,
    expectConsumed,
    expectNoErrors,
    wrappingTermParams,
} from './InteropStreams.js';
import { Consumed, sequences } from '../support/SystemRig.js';

describe.skipIf(!interopAvailable)(
    'MDS interop: C publication to a TS subscription with two destinations' + (interopSkipReason ?? ''),
    () => {
        const env = new InteropEnv();
        const nodes: SystemNode[] = [];

        afterEach((context) => {
            for (const node of nodes.splice(0)) {
                node.close();
            }
            env.dispose(context.task.result?.state === 'fail');
        });

        it('theSameStreamOnTwoDestinationsIsReadOnceInOrder', async () => {
            const count = 1500;
            const from = new FromPublisher(env, nodes);
            // relays that drop nothing, to count what each destination carried
            const stream = await from.open('mds', TERM_PARAMS, {
                relays: [
                    { rate: 0, seed: 91 },
                    { rate: 0, seed: 92 },
                ],
            });
            const pub = from.publish(stream, MIXED, count);

            const consumed = consumerFor(MIXED);
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expectConsumed(consumed, MIXED, 0, count, sent.sessionId);
            expect(stream.subscription.imageCount()).toBe(1);
            expect(stream.side.available).toEqual([sent.sessionId]);
            // both destinations carried the stream
            expect(stream.relays[0]?.forwarded).toBeGreaterThan(0);
            expect(stream.relays[1]?.forwarded).toBeGreaterThan(0);
            expectNoErrors(stream.side.node);
        });

        it('messagesOfAllSizesRotateTheTermsWithAWrappingTermIdOnTwoDestinations', async () => {
            const count = 1500;
            const from = new FromPublisher(env, nodes);
            const stream = await from.open('mds', wrappingTermParams(2));
            const pub = from.publish(stream, SIZES, count);

            const consumed = consumerFor(SIZES);
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expect(sent.position).toBeGreaterThan(8 * TERM_LENGTH);
            expectConsumed(consumed, SIZES, 0, count, sent.sessionId);
            expect(stream.subscription.imageAtIndex(0).initialTermId()).not.toBe(0);
            expectNoErrors(stream.side.node);
        });

        it('bothDestinationsLossyAtDifferentPointsStillGiveTheWholeStreamOnce', async () => {
            const count = 3000;
            const from = new FromPublisher(env, nodes);
            const stream = await from.open('mds', TERM_PARAMS, {
                relays: [
                    { rate: 0.2, seed: 93 },
                    { rate: 0.2, seed: 94 },
                ],
            });
            const pub = from.publish(stream, [100], count);

            const consumed = consumerFor([100]);
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expectConsumed(consumed, [100], 0, count, sent.sessionId);
            expect(stream.relays[0]?.dropped).toBeGreaterThan(0);
            expect(stream.relays[1]?.dropped).toBeGreaterThan(0);
            expectNoErrors(stream.side.node);
        });

        it('aDestinationRemovedMidStreamLeavesTheOtherToCarryTheRest', async () => {
            const count = 6000;
            const from = new FromPublisher(env, nodes);
            const stream = await from.open('mds', TERM_PARAMS);
            const pub = from.publish(stream, MIXED, count);

            const consumed = new Consumed();
            await driveUntil(
                () => {
                    consumed.poll(stream.subscription);
                    return consumed.sequences.length >= 1000;
                },
                'the first 1000 messages',
                LONG_CAP_MS,
            );
            // the destination that was added first goes; the second has carried the same stream all along
            const removed = stream.publisherDestinations[0] as string;
            await awaitCommand(
                stream.side.node,
                stream.subscription.asyncRemoveDestination(removed),
                'the removal of the destination ' + removed,
            );
            await consume(stream.subscription, consumed, count);
            const sent = await env.publisherSent(pub);

            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, count));
            expect(new Set(consumed.sessionIds)).toEqual(new Set([sent.sessionId]));
            expect(counter(stream.side.node.driver, SystemCounterDescriptor.BYTES_RECEIVED)).toBeGreaterThan(0);
            expectNoErrors(stream.side.node);
        });
    },
);
