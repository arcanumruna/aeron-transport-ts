// Issue #55: `driveUntil` of the system rig capped the turns (5M, about 9 s of empty turns) before its time cap (20 s), so
// a slow wait on a loaded host failed with a turn cap error that looked like a hang. The turn cap is sized from the time
// cap, so the time cap is the limit that is hit.
import { describe, expect, it } from 'vitest';
import { driveUntil, MAX_TURNS, maxTurnsFor, MIN_TURN_NS, WAIT_CAP_MS } from '../../support/SystemRig.js';

describe('SystemRigDriveUntilRegression', () => {
    it('theDefaultTurnCapIsBeyondWhatTheTimeCapAllowsRegression', async () => {
        // mutation: MAX_TURNS is a constant below the turns of WAIT_CAP_MS
        let turns = 0;
        const started = performance.now();
        await driveUntil(() => ++turns > 20_000, 'turns');
        const nsPerTurn = ((performance.now() - started) * 1e6) / turns;
        expect(nsPerTurn).toBeGreaterThan(MIN_TURN_NS);
        expect(MAX_TURNS).toBe(maxTurnsFor(WAIT_CAP_MS));
        expect(MAX_TURNS * nsPerTurn).toBeGreaterThan(WAIT_CAP_MS * 1e6);
        expect(maxTurnsFor(50) * MIN_TURN_NS).toBeGreaterThanOrEqual(50 * 1e6);
    });

    it('aSlowWaitFailsAtTheTimeCapAndNamesItRegression', async () => {
        await expect(driveUntil(() => false, 'never', 50)).rejects.toThrow(/^no never after 50 ms \(\d+ turns\)$/);
    });

    it('theTurnCapNamesItselfAndTheTimeCapRegression', async () => {
        await expect(driveUntil(() => false, 'never', 10_000, 3)).rejects.toThrow(
            'no never after the cap of 3 turns (10000 ms cap not reached)',
        );
    });
});
