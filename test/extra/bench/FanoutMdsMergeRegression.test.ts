// Regression test of issue #63 (port-only, spec D135): the `mds-merge` fan-out scenario sends one session over both
// transports of one multi-destination subscription, so that the bench measures the merge of two paths in the image.
import { describe, expect, it } from 'vitest';
import { Fanout, FANOUT_SCENARIOS, fanoutLatency, fanoutStream } from '../../../bench/lib/fanout.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../../src/driver/status/SystemCounters.js';

const scenario = FANOUT_SCENARIOS.find((s) => 'mds-merge' === s.kind);

describe('FanoutMdsMergeRegression', () => {
    it('theScenarioIsInTheListOfTheFanOutBenches', () => {
        expect(scenario).toBeDefined();
        expect(scenario?.count).toBe(2);
    });

    it('oneSessionArrivesOverBothTransportsAndTheImageDropsTheDuplicates', async () => {
        const f = await Fanout.create(scenario as NonNullable<typeof scenario>);
        try {
            expect(f.publications).toHaveLength(1);
            expect(f.subscriptions).toHaveLength(1);

            await fanoutLatency(f, 32, new Float64Array(200));
            await fanoutStream(f, 64, 100, new Float64Array(20));

            // every message read once, whichever path it came over: 200 + 2,000
            expect(f.received[0]).toBe(2_200);
            expect(f.subscriptions[0]?.imageCount()).toBe(1);
            const counters = f.subscribers[0]?.driver.context().systemCounters() as SystemCounters;
            // The frames of the 2,200 messages are 64 B (32 B message) and 96 B (64 B message) with their headers: 204,800 B
            // over one path. Over both paths the receiver counts about twice that (the second copy of a frame is
            // dropped by the image, not by the transport), where a scenario with a path of its own for each message
            // counts about once.
            const bytesReceived = counters.get(SystemCounterDescriptor.BYTES_RECEIVED).get();
            expect(bytesReceived).toBeGreaterThanOrEqual(1.8 * 204_800);
            expect(f.errors()).toEqual([]);
        } finally {
            f.close();
        }
    });
});
