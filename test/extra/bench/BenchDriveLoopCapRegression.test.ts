// Not in Aeron: the drive loops of the bench harness (bench/lib/e2e.ts, bench/lib/fanout.ts) are capped (T15 fix round). A
// loop that turns the event loop until a subscriber has read a message waited for ever when the subscriber had lost its
// image or a datagram was dropped, so the bench and the CI bench job hung. Each loop now throws, naming the scenario and
// the progress, after `MAX_TURNS` turns; the tests give a small cap and a subscriber that is gone.
import { describe, expect, it } from 'vitest';
import { Loopback, oneWay, roundTrips } from '../../../bench/lib/e2e.js';
import {
    FANOUT_SCENARIOS,
    Fanout,
    type FanoutScenario,
    fanoutLatency,
    fanoutStream,
} from '../../../bench/lib/fanout.js';
import { MAX_TURNS, TurnCap } from '../../../bench/lib/turnCap.js';

const CAP = 50;

function scenario(index: number): FanoutScenario {
    const found = FANOUT_SCENARIOS[index];
    if (undefined === found) {
        throw new Error('no fan-out scenario ' + index);
    }
    return found;
}

describe('BenchDriveLoopCapRegression', () => {
    it('defaultCapIsOneMillionTurns', () => {
        expect(MAX_TURNS).toBe(1_000_000);
    });

    it('turnCapThrowsAfterTheCapNamingScenarioAndProgress', () => {
        const cap = new TurnCap('scenario x', () => 'received 3/10', 2);
        cap.tick();
        cap.tick();
        expect(() => cap.tick()).toThrow(/scenario x.*2 turns.*received 3\/10/);
    });

    it('roundTripsFailsInsteadOfHangingWhenTheEchoIsGone', async () => {
        const lb = await Loopback.create(true);
        try {
            lb.b.close();
            await expect(roundTrips(lb, 32, new Float64Array(3), CAP)).rejects.toThrow(
                /round trips of 32 bytes.*received/,
            );
        } finally {
            lb.close();
        }
    });

    it('oneWayFailsInsteadOfHangingWhenTheSubscriberIsGone', async () => {
        const lb = await Loopback.create(false);
        try {
            lb.b.close();
            await expect(oneWay(lb, 32, 10, new Float64Array(3), CAP)).rejects.toThrow(
                /one-way stream.*received 0\/30/,
            );
        } finally {
            lb.close();
        }
    });

    it('fanoutLatencyFailsInsteadOfHangingWhenASubscriberIsGone', async () => {
        const f = await Fanout.create(scenario(2));
        try {
            f.subscribers[0]?.close();
            await expect(fanoutLatency(f, 32, new Float64Array(3), CAP)).rejects.toThrow(/multicast, 3 subscriptions/);
        } finally {
            f.close();
        }
    });

    it('fanoutStreamFailsInsteadOfHangingWhenASubscriberIsGone', async () => {
        const f = await Fanout.create(scenario(0));
        try {
            f.subscribers[0]?.close();
            await expect(fanoutStream(f, 32, 10, new Float64Array(3), CAP)).rejects.toThrow(/stream.*received/);
        } finally {
            f.close();
        }
    });
});
