// Not in Aeron: the verdict of the bench gate (bench/lib/verdict.ts) on every threshold, on both sides of it.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { median } from '../../../bench/lib/stats.js';
import { type ErrorLine, NO_VERDICT_PREFIX, type Result } from '../../../bench/lib/types.js';
import {
    EXIT_FAIL,
    EXIT_NO_VERDICT,
    EXIT_PASS,
    EXIT_USAGE,
    type Expected,
    RULES,
    trimmedSpread,
    unsteady,
    MIN_TAIL_SAMPLES,
    type Line,
    type Pair,
    type PairLines,
    ratios,
    REQUIRED_PAIRS,
    summarize,
    verdict,
} from '../../../bench/lib/verdict.js';

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

describe('GateSummarize', () => {
    const FILE = 'x.bench.ts';
    const LATENCY: Expected = { name: 'lat', file: FILE };
    const THROUGHPUT: Expected = { name: 'thr', file: FILE };
    const result = (name: string, extra: Partial<Result> = {}): Result => ({
        name,
        nsPerOp: 100,
        p50: 100,
        p99: 200,
        p999: 400,
        samples: 2000,
        ...extra,
    });
    const error = (name: string, text: string): ErrorLine => ({ name, error: text });
    /** `n` pairs whose base and candidate lines are given by the two functions. */
    const runs = (n: number, base: (k: number) => Line[], cand: (k: number) => Line[]): PairLines[] =>
        Array.from({ length: n }, (_, k) => ({ base: base(k), cand: cand(k) }));
    const good = (): Line[] => [result('lat'), result('thr', { opsPerSec: 1000 })];
    const all = [LATENCY, THROUGHPUT];

    it('everythingThatPassesExitsZero', () => {
        const summary = summarize(runs(5, good, good), all, REQUIRED_PAIRS);
        expect(summary.benches.map((b) => b.status)).toEqual(['PASS', 'PASS']);
        expect(summary.status).toBe('PASS');
        expect(summary.exitCode).toBe(EXIT_PASS);
        expect(EXIT_PASS).toBe(0);
    });

    it('aBenchMissingFromAnyCandidateRunIsAFailEvenIfEveryOtherRunHasIt', () => {
        const summary = summarize(
            runs(5, good, (k) => (2 === k ? [result('thr', { opsPerSec: 1000 })] : good())),
            all,
        );
        expect(summary.benches[0]?.status).toBe('FAIL');
        expect(summary.benches[0]?.notes).toEqual(['pair 3: missing from the candidate run']);
        expect(summary.benches[1]?.status).toBe('PASS');
        expect(summary.exitCode).toBe(EXIT_FAIL);
    });

    it('theExpectedBenchesComeFromTheModulesNotFromWhatARunPrinted', () => {
        // neither side printed "lat" at all: the old summary would have had nothing to compare and passed
        const summary = summarize(
            runs(
                5,
                () => [result('thr', { opsPerSec: 1 })],
                () => [result('thr', { opsPerSec: 1 })],
            ),
            all,
        );
        expect(summary.benches.find((b) => 'lat' === b.name)?.status).toBe('FAIL');
        expect(summary.exitCode).toBe(EXIT_FAIL);
    });

    it('anErrorOfTheCandidateIsAFailAndAnImportErrorOfItsFileToo', () => {
        const failing = summarize(
            runs(5, good, () => [error('lat', 'boom'), result('thr', { opsPerSec: 1000 })]),
            all,
        );
        expect(failing.benches[0]?.status).toBe('FAIL');
        const importing = summarize(
            runs(5, good, () => [error(FILE, 'import: nope')]),
            all,
        );
        expect(importing.benches.map((b) => b.status)).toEqual(['FAIL', 'FAIL']);
    });

    it('aBaseFailureThatIsNotAnImportErrorIsNoVerdictAndAnImportErrorIsNotApplicableAndPasses', () => {
        // a bench new in the candidate whose setup fails in the base
        const failedSetup = summarize(
            runs(
                5,
                () => [error('lat', 'setup: no such method')],
                () => [result('lat')],
            ),
            [LATENCY],
        );
        expect(failedSetup.benches[0]?.status).toBe('NO_VERDICT');
        expect(failedSetup.exitCode).toBe(EXIT_NO_VERDICT);
        // the base printed nothing for it
        expect(
            summarize(
                runs(
                    5,
                    () => [],
                    () => [result('lat')],
                ),
                [LATENCY],
            ).benches[0]?.status,
        ).toBe('NO_VERDICT');
        // the file does not import in the base
        const missingApi = summarize(
            runs(5, () => [error(FILE, 'import: no such module')], good),
            all,
        );
        expect(missingApi.benches.map((b) => b.status)).toEqual(['PASS', 'PASS']);
        expect(missingApi.benches[0]?.notes).toEqual(['n/a in base']);
        expect(missingApi.exitCode).toBe(EXIT_PASS);
        // the process of the base died
        const died = summarize(
            runs(5, () => [error(FILE, 'the process failed (1): x')], good),
            all,
        );
        expect(died.benches.map((b) => b.status)).toEqual(['NO_VERDICT', 'NO_VERDICT']);
    });

    it('aMetricWithoutAValidRatioIsNoVerdictNotAPass', () => {
        const nan = (): Line[] => [result('lat', { nsPerOp: Number.NaN })];
        const summary = summarize(runs(5, nan, nan), [LATENCY]);
        expect(summary.benches[0]?.status).toBe('NO_VERDICT');
        const metric = summary.benches[0]?.metrics.find((m) => 'ns/op' === m.label);
        expect(metric?.status).toBe('NO_VERDICT');
        expect(metric?.ratios).toEqual([]);
        expect(summary.benches[0]?.metrics.find((m) => 'p50' === m.label)?.status).toBe('PASS');
        expect(summary.exitCode).toBe(EXIT_NO_VERDICT);
        // a throughput bench that reports no valid ops/s in a pair
        const zero = (): Line[] => [result('thr', { opsPerSec: 0 })];
        const none = summarize(
            runs(3, zero, () => [result('thr', { opsPerSec: 5 })]),
            [THROUGHPUT],
        );
        expect(none.benches[0]?.metrics.find((m) => 'ops/s' === m.label)?.status).toBe('NO_VERDICT');
        expect(none.exitCode).toBe(EXIT_NO_VERDICT);
    });

    it('aBenchWithFewerPairsThanRequiredIsNoVerdictFiveForLatencyThreeForThroughput', () => {
        const four = summarize(runs(4, good, good), all);
        expect(four.benches.map((b) => b.status)).toEqual(['NO_VERDICT', 'PASS']);
        expect(four.exitCode).toBe(EXIT_NO_VERDICT);
        expect(summarize(runs(5, good, good), all).benches[0]?.status).toBe('PASS');
        const two = summarize(runs(2, good, good), [THROUGHPUT]);
        expect(two.benches[0]?.status).toBe('NO_VERDICT');
        expect(summarize(runs(3, good, good), [THROUGHPUT]).benches[0]?.status).toBe('PASS');
        // the requirement is a parameter
        expect(summarize(runs(2, good, good), [LATENCY], { latency: 2, throughput: 1 }).benches[0]?.status).toBe(
            'PASS',
        );
    });

    it('aFailBeatsANoVerdictInTheExitCodeAndTheThresholdsStillFail', () => {
        const slower = (): Line[] => [result('lat', { nsPerOp: 120 }), result('thr', { opsPerSec: 1000 })];
        const summary = summarize(runs(4, good, slower), all);
        // lat: 4 pairs (NO_VERDICT) and ns/op over the limit (FAIL): FAIL
        expect(summary.benches[0]?.status).toBe('FAIL');
        expect(summary.benches[0]?.metrics.find((m) => 'ns/op' === m.label)?.ratios).toEqual([1.2, 1.2, 1.2, 1.2]);
        expect(summary.exitCode).toBe(EXIT_FAIL);
    });

    it('aNoVerdictErrorOfTheCandidateIsNoVerdictNotAFail', () => {
        const summary = summarize(
            runs(5, good, () => [result('lat'), error('thr', NO_VERDICT_PREFIX + 'the host has 2 cores')]),
            all,
        );
        expect(summary.benches.map((b) => b.status)).toEqual(['PASS', 'NO_VERDICT']);
        expect(summary.exitCode).toBe(EXIT_NO_VERDICT);
    });

    it('p99AndP999AreAVerdictOnlyFromTwentyThousandSamples', () => {
        const slowTail = (samples: number) => (): Line[] => [result('lat', { p99: 400, p999: 800, samples })];
        const few = summarize(runs(5, good, slowTail(MIN_TAIL_SAMPLES - 1)), [LATENCY]);
        const p99 = few.benches[0]?.metrics.find((m) => 'p99' === m.label);
        expect(p99?.status).toBe('INFO');
        expect(p99?.median).toBe(2);
        expect(few.benches[0]?.status).toBe('PASS');
        expect(few.exitCode).toBe(EXIT_PASS);

        const enough = () => [result('lat', { samples: MIN_TAIL_SAMPLES })];
        const many = summarize(runs(5, enough, slowTail(MIN_TAIL_SAMPLES)), [LATENCY]);
        expect(many.benches[0]?.metrics.find((m) => 'p99' === m.label)?.status).toBe('FAIL');
        expect(many.benches[0]?.metrics.find((m) => 'p99.9' === m.label)?.status).toBe('FAIL');
        expect(many.exitCode).toBe(EXIT_FAIL);

        // ns/op and p50 are always a verdict
        const slowMedian = () => [result('lat', { nsPerOp: 200, p50: 200 })];
        expect(summarize(runs(5, good, slowMedian), [LATENCY]).exitCode).toBe(EXIT_FAIL);
    });

    it('theExitCodesAre0Pass1Fail2Usage3NoVerdict', () => {
        expect([EXIT_PASS, EXIT_FAIL, EXIT_USAGE, EXIT_NO_VERDICT]).toEqual([0, 1, 2, 3]);
        expect(summarize([], []).exitCode).toBe(0);
    });

    it('aUsageErrorOfTheGateExits2', () => {
        const run = spawnSync(
            process.execPath,
            ['--import', './test/support/workerRegister.mjs', '--no-warnings', 'bench/lib/gate.ts', '--bogus'],
            { encoding: 'utf8', timeout: 60_000 },
        );
        expect(run.status).toBe(EXIT_USAGE);
        expect(run.stderr).toContain('unknown argument: --bogus');
    });
});

describe('GateCalibration (issue #29: the A/A run of the base against itself)', () => {
    const FILE = 'x.bench.ts';
    const LATENCY: Expected = { name: 'lat', file: FILE };
    const THROUGHPUT: Expected = { name: 'thr', file: FILE };
    const line = (name: string, scale: number, samples = 2000): Line => ({
        name,
        nsPerOp: 100 * scale,
        p50: 100 * scale,
        p99: 200 * scale,
        p999: 400 * scale,
        samples,
        ...('thr' === name ? { opsPerSec: 1000 * scale } : {}),
    });
    /** Pairs whose candidate (or second) run is the base scaled by each of the ratios, on every metric. */
    const pairsOf = (ratio: readonly number[], samples = 2000): PairLines[] =>
        ratio.map((r) => ({
            base: [line('lat', 1, samples), line('thr', 1, samples)],
            cand: [line('lat', r, samples), line('thr', r, samples)],
        }));
    const STEADY = [1, 1, 1, 1, 1];
    const metricOf = (summary: ReturnType<typeof summarize>, bench: number, label: string) =>
        summary.benches[bench]?.metrics.find((m) => label === m.label);

    it('noCalibrationIsTheVerdictOfBefore', () => {
        const summary = summarize(pairsOf(STEADY), [LATENCY, THROUGHPUT]);
        expect(summary.status).toBe('PASS');
    });

    it('aSteadyHostGivesTheVerdictOfTheABRun', () => {
        const pass = summarize(pairsOf(STEADY), [LATENCY, THROUGHPUT], REQUIRED_PAIRS, pairsOf(STEADY));
        expect(pass.status).toBe('PASS');
        expect(pass.exitCode).toBe(EXIT_PASS);

        const fail = summarize(pairsOf([1.3, 1.3, 1.3, 1.3, 1.3]), [LATENCY], REQUIRED_PAIRS, pairsOf(STEADY));
        expect(fail.status).toBe('FAIL');
        expect(fail.exitCode).toBe(EXIT_FAIL);
    });

    // [name, A/A ratios, label, bench index, expected status of the metric, text of the reason]
    it.each([
        // the median of the A/A ratios beyond the limit of the metric (1.05 for ns/op and p50, 0.95 for ops/s)
        [
            'median over 1.05 on ns/op',
            [1.08, 1.08, 1.08, 1.08, 1.08],
            'ns/op',
            0,
            'NO_VERDICT',
            'A/A median ratio 1.080',
        ],
        ['median over 1.05 on p50', [1.06, 1.06, 1.06, 1.06, 1.06], 'p50', 0, 'NO_VERDICT', 'A/A median ratio 1.060'],
        ['median under 0.95 on ops/s', [0.9, 0.9, 0.9, 0.9, 0.9], 'ops/s', 1, 'NO_VERDICT', 'A/A median ratio 0.900'],
        // a median inside the limit but pair ratios spread wider than the band 1 +/- 0.05: the spread with the lowest and
        // the highest ratio dropped (issue #80) over 0.10
        ['spread 0.40 around 1.0', [0.8, 1.2, 0.8, 1.2, 1.0], 'ns/op', 0, 'NO_VERDICT', 'spread 0.400'],
        ['spread 0.11 just over', [0.94, 0.94, 1.0, 1.05, 1.05], 'ns/op', 0, 'NO_VERDICT', 'spread 0.110'],
        ['spread 0.08 just inside', [0.96, 0.96, 1.0, 1.04, 1.04], 'ns/op', 0, 'PASS', ''],
        ['a median of exactly the limit is steady', [1.05, 1.05, 1.05, 1.05, 1.05], 'ns/op', 0, 'PASS', ''],
        ['ops/s median exactly 0.95 is steady', [0.95, 0.95, 0.95, 0.95, 0.95], 'ops/s', 1, 'PASS', ''],
        ['all ones', STEADY, 'ns/op', 0, 'PASS', ''],
    ] as const)('%s', (_name, aa, label, bench, status, reason) => {
        const summary = summarize(pairsOf(STEADY), [LATENCY, THROUGHPUT], REQUIRED_PAIRS, pairsOf(aa));
        const metric = metricOf(summary, bench, label);
        expect(metric?.status).toBe(status);
        if ('' !== reason) {
            expect(metric?.message).toContain(reason);
            expect(metric?.message).toContain('the host is too noisy');
            expect(summary.benches[bench]?.status).toBe('NO_VERDICT');
            expect(summary.exitCode).toBe(EXIT_NO_VERDICT);
        }
    });

    it('aNoisyMetricIsNoVerdictEvenWhenTheABRunFails', () => {
        const summary = summarize(
            pairsOf([1.5, 1.5, 1.5, 1.5, 1.5]),
            [LATENCY],
            REQUIRED_PAIRS,
            pairsOf([0.7, 1.3, 0.7, 1.3, 1.0]),
        );
        expect(metricOf(summary, 0, 'ns/op')?.status).toBe('NO_VERDICT');
        expect(metricOf(summary, 0, 'p50')?.status).toBe('NO_VERDICT');
        expect(summary.benches[0]?.status).toBe('NO_VERDICT');
        expect(summary.exitCode).toBe(EXIT_NO_VERDICT);
    });

    it('theLimitOfEachMetricIsItsOwn', () => {
        // a spread of 0.15 is over the 0.10 band of ns/op (limit 1.05) but inside the 0.20 band of p99 (limit 1.10)
        const aa = pairsOf([0.93, 0.93, 1.0, 1.08, 1.08], 20_000);
        const summary = summarize(pairsOf(STEADY, 20_000), [LATENCY], REQUIRED_PAIRS, aa);
        expect(metricOf(summary, 0, 'ns/op')?.status).toBe('NO_VERDICT');
        expect(metricOf(summary, 0, 'p99')?.status).toBe('PASS');
        expect(metricOf(summary, 0, 'p99.9')?.status).toBe('PASS');
        // 0.30 is over both
        const wide = summarize(
            pairsOf(STEADY, 20_000),
            [LATENCY],
            REQUIRED_PAIRS,
            pairsOf([0.85, 0.85, 1.0, 1.15, 1.15], 20_000),
        );
        expect(metricOf(wide, 0, 'p99')?.status).toBe('NO_VERDICT');
        expect(metricOf(wide, 0, 'p99.9')?.status).toBe('NO_VERDICT');
    });

    it('theTailMetricsBelowTheSampleCountAreInformationAndAreNotCalibrated', () => {
        const summary = summarize(pairsOf(STEADY), [LATENCY], REQUIRED_PAIRS, pairsOf([0.5, 1.5, 0.5, 1.5, 1.0]));
        expect(metricOf(summary, 0, 'p99')?.status).toBe('INFO');
        expect(metricOf(summary, 0, 'ns/op')?.status).toBe('NO_VERDICT');
    });

    it('anACalibrationWithoutAValidRatioIsNoVerdict', () => {
        for (const aa of [[], [{ base: [line('lat', 1)], cand: [{ name: 'lat', error: 'the process failed' }] }]]) {
            const summary = summarize(pairsOf(STEADY), [LATENCY], REQUIRED_PAIRS, aa as PairLines[]);
            expect(metricOf(summary, 0, 'ns/op')?.status).toBe('NO_VERDICT');
            expect(metricOf(summary, 0, 'ns/op')?.message).toContain('A/A run has no valid ratio');
            expect(summary.exitCode).toBe(EXIT_NO_VERDICT);
        }
    });

    it('aBenchThatIsNotApplicableInTheBaseIsNotCalibrated', () => {
        const runsNa: PairLines[] = Array.from({ length: 5 }, () => ({
            base: [{ name: FILE, error: 'import: no such api' }],
            cand: [line('lat', 1), line('thr', 1)],
        }));
        const summary = summarize(runsNa, [LATENCY], REQUIRED_PAIRS, []);
        expect(summary.benches[0]?.notes).toEqual(['n/a in base']);
        expect(summary.status).toBe('PASS');
    });

    it('unsteadyNamesTheMeasuredSpreadAndEveryRatio', () => {
        const rule = RULES.find((r) => 'ns/op' === r.label)!;
        expect(unsteady(rule, { median: 1, spread: 0.1, ratios: [0.95, 1.05] })).toBeUndefined();
        const reason = unsteady(rule, { median: 1, spread: 0.5, ratios: [0.75, 1.25] });
        expect(reason).toContain('spread 0.500');
        expect(reason).toContain('0.750, 1.250');
    });
});

describe('GateCalibrationTrimmedSpreadRegression (issue #80: one outlier pair does not decide the A/A verdict)', () => {
    const FILE = 'x.bench.ts';
    const LATENCY: Expected = { name: 'lat', file: FILE };
    const line = (scale: number): Line => ({
        name: 'lat',
        nsPerOp: 100 * scale,
        p50: 100 * scale,
        p99: 200 * scale,
        p999: 400 * scale,
        samples: 2000,
    });
    const pairsOf = (ratio: readonly number[]): PairLines[] => ratio.map((r) => ({ base: [line(1)], cand: [line(r)] }));
    const ns = (aa: readonly number[]) =>
        summarize(pairsOf(Array(15).fill(1)), [LATENCY], REQUIRED_PAIRS, pairsOf(aa)).benches[0]?.metrics.find(
            (m) => 'ns/op' === m.label,
        );
    const QUIET = Array.from({ length: 15 }, (_, i) => 0.98 + (0.04 * i) / 14);

    // [name, ratios, trimmed spread]
    it.each([
        ['empty', [], Number.NaN],
        ['one', [1.2], 0],
        ['four keep max - min', [0.9, 1.0, 1.0, 1.3], 0.4],
        ['five drop one at each end', [0.5, 1.0, 1.02, 1.04, 2.0], 0.04],
        ['order does not matter', [2.0, 1.04, 0.5, 1.02, 1.0], 0.04],
        ['two outliers on one side still count', [1.0, 1.0, 1.0, 1.5, 1.5], 0.5],
        ['all equal', [1, 1, 1, 1, 1, 1], 0],
    ] as const)('%s', (_name, ratios, expected) => {
        const spread = trimmedSpread(ratios);
        if (Number.isNaN(expected)) {
            expect(spread).toBeNaN();
        } else {
            expect(spread).toBeCloseTo(expected, 12);
        }
    });

    it('oneSlowPairOfFifteenOnAQuietHostIsStillAVerdict', () => {
        expect(ns(QUIET)?.status).toBe('PASS');
        // the issue's repro: one slow pair, which max - min turned into NO_VERDICT
        expect(ns([...QUIET.slice(0, 14), 1.5])?.status).toBe('PASS');
        expect(ns([0.6, ...QUIET.slice(1)])?.status).toBe('PASS');
        expect(ns([0.6, ...QUIET.slice(1, 14), 1.5])?.status).toBe('PASS');
    });

    it('twoSlowPairsAreANoisyHost', () => {
        const metric = ns([...QUIET.slice(0, 13), 1.5, 1.5]);
        expect(metric?.status).toBe('NO_VERDICT');
        expect(metric?.message).toContain('spread 0.517');
    });

    it('theInputIsNotReordered', () => {
        const ratios = [1.3, 1.0, 0.9, 1.0];
        trimmedSpread(ratios);
        expect(ratios).toEqual([1.3, 1.0, 0.9, 1.0]);
    });
});
