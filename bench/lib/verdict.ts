// The verdict of the bench gate, pure so that a test can pin every threshold (test/extra/bench/GateVerdict.test.ts).
import { median } from './stats.js';
import type { Result } from './types.js';

/** A base run and a candidate run of one bench, from one pair of the interleaved A B A B runs. */
export interface Pair {
    base: Result;
    cand: Result;
}

/** A metric, and the limit on the median of the per-pair ratios candidate / base. */
export interface Rule {
    metric: 'nsPerOp' | 'p50' | 'p99' | 'p999' | 'opsPerSec';
    /** The label in a failure message. */
    label: string;
    /** `max`: fails when the median ratio is over the limit; `min`: when it is under. */
    kind: 'max' | 'min';
    limit: number;
}

/** The thresholds (plan, Performance gates): a slowdown fails like a red test. */
export const RULES: readonly Rule[] = [
    { metric: 'nsPerOp', label: 'ns/op', kind: 'max', limit: 1.05 },
    { metric: 'p50', label: 'p50', kind: 'max', limit: 1.05 },
    { metric: 'p99', label: 'p99', kind: 'max', limit: 1.1 },
    { metric: 'p999', label: 'p99.9', kind: 'max', limit: 1.1 },
    { metric: 'opsPerSec', label: 'ops/s', kind: 'min', limit: 0.95 },
];

/**
 * The per-pair ratios candidate / base of a metric. A pair is left out when either value is missing (`opsPerSec` of a
 * bench that has none), or the base is not positive, or a value is not finite: no ratio exists.
 */
export function ratios(pairs: readonly Pair[], metric: Rule['metric']): number[] {
    const out: number[] = [];
    for (const { base, cand } of pairs) {
        const b = base[metric];
        const c = cand[metric];
        if (undefined === b || undefined === c || !Number.isFinite(b) || !Number.isFinite(c) || b <= 0) {
            continue;
        }
        out.push(c / b);
    }
    return out;
}

function fixed(value: number): string {
    return value.toFixed(3);
}

/**
 * Compares a candidate with its base. For each metric the verdict is on the median of the per-pair ratios candidate /
 * base (for an even number of pairs, the mean of the two middle ratios): it fails when the median is over 1.10 for p99
 * or p99.9, over 1.05 for p50 or ns/op, or under 0.95 for ops/s. A median exactly on a limit passes. A failure names
 * the metric, the median and every pair's ratio.
 */
export function verdict(pairs: readonly Pair[]): { pass: boolean; failures: string[] } {
    const failures: string[] = [];
    for (const rule of RULES) {
        const r = ratios(pairs, rule.metric);
        if (0 === r.length) {
            continue;
        }
        const m = median(r);
        const failed = 'max' === rule.kind ? m > rule.limit : m < rule.limit;
        if (failed) {
            failures.push(
                rule.label +
                    ': median ratio ' +
                    fixed(m) +
                    ('max' === rule.kind ? ' > ' : ' < ') +
                    rule.limit +
                    ' (pairs: ' +
                    r.map(fixed).join(', ') +
                    ')',
            );
        }
    }
    return { pass: 0 === failures.length, failures };
}
