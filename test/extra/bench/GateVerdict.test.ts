// Not in Aeron: the verdict of the bench gate (bench/lib/verdict.ts) on every threshold, on both sides of it.
import { describe, expect, it } from 'vitest';
import { median } from '../../../bench/lib/stats.js';
import type { Result } from '../../../bench/lib/types.js';
import { type Pair, ratios, verdict } from '../../../bench/lib/verdict.js';

const BASE: Result = { name: 'b', nsPerOp: 100, p50: 100, p99: 200, p999: 400 };

function pair(scale: Partial<Record<'nsPerOp' | 'p50' | 'p99' | 'p999' | 'opsPerSec', number>>): Pair {
    const cand: Result = { ...BASE };
    for (const [key, factor] of Object.entries(scale) as [keyof typeof scale, number][]) {
        cand[key] = (BASE[key] ?? 1000) * factor;
    }
    const base: Result = { ...BASE };
    if (undefined !== scale.opsPerSec) {
        base.opsPerSec = 1000;
    }
    return { base, cand };
}

/** Five pairs that all have the same ratio on one metric. */
function same(metric: 'nsPerOp' | 'p50' | 'p99' | 'p999' | 'opsPerSec', factor: number): Pair[] {
    return Array.from({ length: 5 }, () => pair({ [metric]: factor }));
}

describe('GateVerdict', () => {
    it.each([
        ['nsPerOp', 1.05, 'ns/op'],
        ['p50', 1.05, 'p50'],
        ['p99', 1.1, 'p99'],
        ['p999', 1.1, 'p99.9'],
    ] as const)('%s fails just over %d and passes just under', (metric, limit, label) => {
        expect(verdict(same(metric, limit - 0.001))).toEqual({ pass: true, failures: [] });
        expect(verdict(same(metric, limit)).pass).toBe(true);
        const over = verdict(same(metric, limit + 0.001));
        expect(over.pass).toBe(false);
        expect(over.failures).toHaveLength(1);
        expect(over.failures[0]).toContain(label + ': median ratio ' + (limit + 0.001).toFixed(3));
        // every pair's ratio is named
        expect(over.failures[0]?.match(new RegExp((limit + 0.001).toFixed(3), 'g'))).toHaveLength(6);
    });

    it('opsPerSecFailsJustUnder0_95AndPassesJustOver', () => {
        expect(verdict(same('opsPerSec', 0.951)).pass).toBe(true);
        expect(verdict(same('opsPerSec', 0.95)).pass).toBe(true);
        const under = verdict(same('opsPerSec', 0.949));
        expect(under.pass).toBe(false);
        expect(under.failures[0]).toContain('ops/s: median ratio 0.949 < 0.95');
        expect(verdict(same('opsPerSec', 1.5)).pass).toBe(true);
    });

    it('aFasterCandidateAlwaysPasses', () => {
        expect(verdict(same('p99', 0.5)).pass).toBe(true);
        expect(verdict(same('nsPerOp', 0.5)).pass).toBe(true);
    });

    it('theMedianOfAnOddNumberOfPairsIsTheMiddleRatio', () => {
        // sorted 0.9, 1.0, 1.2: the median is 1.0, so one bad pair does not fail p99
        const pairs = [pair({ p99: 1.2 }), pair({ p99: 0.9 }), pair({ p99: 1.0 })];
        expect(median(ratios(pairs, 'p99'))).toBeCloseTo(1.0, 10);
        expect(verdict(pairs).pass).toBe(true);
        // sorted 1.0, 1.2, 1.3: the median is 1.2
        expect(verdict([pair({ p99: 1.3 }), pair({ p99: 1.0 }), pair({ p99: 1.2 })]).pass).toBe(false);
    });

    it('theMedianOfAnEvenNumberOfPairsIsTheMeanOfTheTwoMiddleRatios', () => {
        // sorted 1.0, 1.05, 1.17, 1.3: the middle two are 1.05 and 1.17, whose mean 1.11 is over 1.10
        const over = [pair({ p99: 1.3 }), pair({ p99: 1.0 }), pair({ p99: 1.17 }), pair({ p99: 1.05 })];
        expect(median(ratios(over, 'p99'))).toBeCloseTo(1.11, 10);
        expect(verdict(over).pass).toBe(false);
        // sorted 1.0, 1.02, 1.17, 1.3: the mean of 1.02 and 1.17 is 1.095, under 1.10
        const under = [pair({ p99: 1.3 }), pair({ p99: 1.0 }), pair({ p99: 1.17 }), pair({ p99: 1.02 })];
        expect(median(ratios(under, 'p99'))).toBeCloseTo(1.095, 10);
        expect(verdict(under).pass).toBe(true);
        expect(median([1, 2])).toBe(1.5);
        expect(median([5])).toBe(5);
    });

    it('aMissingOpsPerSecIsIgnored', () => {
        const pairs = same('p50', 1.0);
        expect(pairs[0]?.base.opsPerSec).toBeUndefined();
        expect(ratios(pairs, 'opsPerSec')).toEqual([]);
        expect(verdict(pairs)).toEqual({ pass: true, failures: [] });
        // missing on one side only: that pair is left out
        const mixed = [pair({ opsPerSec: 0.5 }), { base: { ...BASE }, cand: { ...BASE, opsPerSec: 1 } }];
        expect(ratios(mixed, 'opsPerSec')).toEqual([0.5]);
    });

    it('severalMetricsFailTogetherAndAreAllNamed', () => {
        const result = verdict(Array.from({ length: 3 }, () => pair({ nsPerOp: 1.2, p99: 1.5, opsPerSec: 0.5 })));
        expect(result.pass).toBe(false);
        expect(result.failures.map((f) => f.split(':')[0])).toEqual(['ns/op', 'p99', 'ops/s']);
    });

    it('aBaseThatIsNotPositiveHasNoRatio', () => {
        const zero: Pair = { base: { ...BASE, p99: 0 }, cand: { ...BASE, p99: 5 } };
        expect(ratios([zero], 'p99')).toEqual([]);
        expect(verdict([zero]).pass).toBe(true);
    });
});
