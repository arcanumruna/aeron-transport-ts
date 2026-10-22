// The verdict of the bench gate, pure so that a test can pin every threshold (test/extra/bench/GateVerdict.test.ts).
import { median } from './stats.js';
import { type ErrorLine, NO_VERDICT_PREFIX, type Result } from './types.js';

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
        const message = judge(rule, ratios(pairs, rule.metric));
        if (undefined !== message) {
            failures.push(message);
        }
    }
    return { pass: 0 === failures.length, failures };
}

/** The exit codes of `bench:gate`. */
export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;
export const EXIT_NO_VERDICT = 3;

/** p99 and p99.9 are a verdict only from this many samples in every run; below it they are information. */
export const MIN_TAIL_SAMPLES = 20_000;

/** Pairs a bench needs for a verdict: 5 for a latency bench, 3 for a throughput bench (one that reports ops/s). */
export interface RequiredPairs {
    latency: number;
    throughput: number;
}

export const REQUIRED_PAIRS: RequiredPairs = { latency: 5, throughput: 3 };

export type Status = 'PASS' | 'FAIL' | 'NO_VERDICT';

/** One process run of one side: what it printed, in the order of printing. */
export type Line = Result | ErrorLine;

/** A bench the candidate's bench modules export, and the file it is in. */
export interface Expected {
    name: string;
    file: string;
}

/** The two sides of one pair, each as the lines of every bench file of that pair. */
export interface PairLines {
    base: readonly Line[];
    cand: readonly Line[];
}

export interface MetricSummary {
    label: string;
    /** `INFO`: reported, not a verdict (p99 and p99.9 below MIN_TAIL_SAMPLES). */
    status: Status | 'INFO';
    /** The median of the ratios; NaN when there is none. */
    median: number;
    ratios: number[];
    message?: string;
}

export interface BenchSummary {
    name: string;
    status: Status;
    metrics: MetricSummary[];
    /** The reasons for a status other than a plain pass (an `n/a in base` too). */
    notes: string[];
}

export interface Summary {
    benches: BenchSummary[];
    status: Status;
    exitCode: number;
}

function isError(line: Line): line is ErrorLine {
    return 'error' in line;
}

/** The judgement of one rule over its ratios; `undefined` when there is none or the median is within the limit. */
function judge(rule: Rule, r: readonly number[]): string | undefined {
    if (0 === r.length) {
        return undefined;
    }
    const m = median(r);
    const failed = 'max' === rule.kind ? m > rule.limit : m < rule.limit;
    return failed
        ? rule.label +
              ': median ratio ' +
              fixed(m) +
              ('max' === rule.kind ? ' > ' : ' < ') +
              rule.limit +
              ' (pairs: ' +
              r.map(fixed).join(', ') +
              ')'
        : undefined;
}

function worst(a: Status, b: Status): Status {
    if ('FAIL' === a || 'FAIL' === b) {
        return 'FAIL';
    }
    return 'NO_VERDICT' === a || 'NO_VERDICT' === b ? 'NO_VERDICT' : 'PASS';
}

/**
 * The summary of the interleaved runs, per bench and metric: PASS, FAIL or NO_VERDICT, with the ratios. The gate never
 * passes without a verdict:
 *
 * - the benches expected are the ones the candidate's bench modules export, not the ones a run printed: one that is
 *   missing from any candidate run is a FAIL, as is an error of the candidate (a `no-verdict:` error is NO_VERDICT);
 * - a bench whose file fails to import in the base (`import:`) is `n/a in base`, which passes; any other failure of
 *   the base, or a base that did not run the bench at all, is NO_VERDICT (no base to compare with);
 * - a bench with fewer valid pairs than required is NO_VERDICT;
 * - a metric without a valid ratio (NaN, zero or missing values) is NO_VERDICT;
 * - p99 and p99.9 are a verdict only when every run has MIN_TAIL_SAMPLES samples, otherwise INFO.
 *
 * The exit code is 0 when everything passes, 1 on any FAIL, 3 on a NO_VERDICT without a FAIL.
 */
export function summarize(
    runs: readonly PairLines[],
    expected: readonly Expected[],
    requiredPairs: RequiredPairs = REQUIRED_PAIRS,
): Summary {
    const benches: BenchSummary[] = [];
    for (const { name, file } of expected) {
        const notes: string[] = [];
        let status = 'PASS' as Status;
        const fail = (note: string): void => {
            status = worst(status, 'FAIL');
            notes.push(note);
        };
        const noVerdict = (note: string): void => {
            status = worst(status, 'NO_VERDICT');
            notes.push(note);
        };

        const pairs: Pair[] = [];
        let baseNotApplicable = false;
        runs.forEach((run, k) => {
            const cand = find(run.cand, name, file);
            const base = find(run.base, name, file);
            if (undefined === cand) {
                fail('pair ' + (k + 1) + ': missing from the candidate run');
                return;
            }
            if (isError(cand)) {
                if (cand.error.startsWith(NO_VERDICT_PREFIX)) {
                    noVerdict('pair ' + (k + 1) + ': ' + cand.error);
                } else {
                    fail('pair ' + (k + 1) + ': the candidate failed: ' + cand.error);
                }
                return;
            }
            if (undefined !== base && isError(base)) {
                if (base.error.startsWith('import:')) {
                    baseNotApplicable = true;
                } else {
                    noVerdict('pair ' + (k + 1) + ': the base failed: ' + base.error);
                }
                return;
            }
            if (undefined === base) {
                noVerdict('pair ' + (k + 1) + ': the base run printed no result for it');
                return;
            }
            pairs.push({ base, cand });
        });

        if ('FAIL' === status) {
            benches.push({ name, status, metrics: [], notes });
            continue;
        }
        if (baseNotApplicable && 0 === pairs.length && 'PASS' === status) {
            benches.push({ name, status, metrics: [], notes: ['n/a in base'] });
            continue;
        }

        const throughput = pairs.some((p) => undefined !== p.cand.opsPerSec);
        const required = throughput ? requiredPairs.throughput : requiredPairs.latency;
        if (pairs.length < required) {
            noVerdict(pairs.length + ' valid pairs, ' + required + ' needed for a verdict');
        }
        const tail = pairs.length > 0 && pairs.every((p) => hasTailSamples(p.base) && hasTailSamples(p.cand));

        const metrics: MetricSummary[] = [];
        for (const rule of RULES) {
            if ('opsPerSec' === rule.metric && !throughput) {
                continue;
            }
            const r = ratios(pairs, rule.metric);
            const isTail = 'p99' === rule.metric || 'p999' === rule.metric;
            const m = median(r);
            if (isTail && !tail) {
                metrics.push({ label: rule.label, status: 'INFO', median: m, ratios: r });
                continue;
            }
            if (0 === r.length) {
                const message = rule.label + ': no valid ratio';
                metrics.push({ label: rule.label, status: 'NO_VERDICT', median: m, ratios: r, message });
                noVerdict(message);
                continue;
            }
            const message = judge(rule, r);
            if (undefined !== message) {
                metrics.push({ label: rule.label, status: 'FAIL', median: m, ratios: r, message });
                fail(message);
            } else {
                metrics.push({ label: rule.label, status: 'PASS', median: m, ratios: r });
            }
        }
        benches.push({ name, status, metrics, notes });
    }

    let overall: Status = 'PASS';
    for (const b of benches) {
        overall = worst(overall, b.status);
    }
    const exitCode = 'FAIL' === overall ? EXIT_FAIL : 'NO_VERDICT' === overall ? EXIT_NO_VERDICT : EXIT_PASS;
    return { benches, status: overall, exitCode };
}

function hasTailSamples(result: Result): boolean {
    return undefined !== result.samples && result.samples >= MIN_TAIL_SAMPLES;
}

/** The line of a bench in a run: its own, or the error line of its file (an import error is named after the file). */
function find(lines: readonly Line[], name: string, file: string): Line | undefined {
    let fileError: Line | undefined;
    for (const line of lines) {
        if (line.name === name) {
            return line;
        }
        if (line.name === file && isError(line)) {
            fileError = line;
        }
    }
    return fileError;
}
