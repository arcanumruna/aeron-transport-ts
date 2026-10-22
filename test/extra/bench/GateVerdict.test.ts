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
