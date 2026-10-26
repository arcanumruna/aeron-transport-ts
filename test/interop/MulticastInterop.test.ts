// Interop tests of T13 (spec 8.3, multicast rows, D108, D116): multicast on the loopback interface (group 224.20.30.39,
// `interface=localhost`, plan decision 2) between the TS transport and the Aeron C 1.53.3 media driver, over real UDP.
// A TS publication to two C subscribers (each in a C driver of its own, so each is a receiver with an id of its own, and
// the TS flow control is `min` with two receivers), and a C publication to a TS subscription. Sizes and term rotation
// are in InteropRows.ts; the rows here are those that need a lossy receiver. Every row asserts that what was produced
// equals what was consumed at every receiver: the same messages, in order, no loss and no duplicate.
import { afterEach, describe, expect, it } from 'vitest';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemNode } from '../support/SystemRig.js';
import { describeStreamRows } from './InteropRows.js';
import { InteropEnv, interopAvailable, interopSkipReason } from './InteropRig.js';
import {
    DATA_AND_SETUP,
    SIZES,
    ToReceivers,
    counter,
    expectConsumedByC,
    expectNoErrors,
    produce,
    wrappingTermParams,
} from './InteropStreams.js';

describeStreamRows('multicast');

describe.skipIf(!interopAvailable)('Multicast interop: loss' + (interopSkipReason ?? ''), () => {
    const env = new InteropEnv();
    const nodes: SystemNode[] = [];

    afterEach((context) => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
        env.dispose(context.task.result?.state === 'fail');
    });

    it('dataAndSetupLostBySeparateReceiversAreAskedForAgainAndSentAgainToTheMulticastGroup', async () => {
        // each receiver's C driver drops 5% of the data and setup frames it receives, with a seed of its own
        const count = 1500;
        const stream = await new ToReceivers(env, nodes).open('multicast', {
            sizes: SIZES,
            count,
            loss: [
                { rate: 0.05, seed: 61, mask: DATA_AND_SETUP },
                { rate: 0.05, seed: 62, mask: DATA_AND_SETUP },
            ],
        });

        await produce(stream.publication, SIZES, 0, count);
        for (const receiver of stream.receivers) {
            expectConsumedByC(await env.subscriberSummary(receiver.sub), stream.publication.sessionId(), 0, count);
        }

        expect(counter(stream.node.driver, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBeGreaterThan(0);
        expect(counter(stream.node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
        expectNoErrors(stream.node);
    });

    it('lossDuringTheRotationOfTheTermsWithAWrappingTermIdOnTheMulticastGroup', async () => {
        const count = 1500;
        const stream = await new ToReceivers(env, nodes).open('multicast', {
            sizes: SIZES,
            count,
            params: wrappingTermParams(1),
            loss: [
                { rate: 0.05, seed: 63, mask: DATA_AND_SETUP },
                { rate: 0.1, seed: 64, mask: DATA_AND_SETUP },
            ],
        });

        await produce(stream.publication, SIZES, 0, count);
        for (const receiver of stream.receivers) {
            expectConsumedByC(await env.subscriberSummary(receiver.sub), stream.publication.sessionId(), 0, count);
        }

        expect(counter(stream.node.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
        expectNoErrors(stream.node);
    });
});
