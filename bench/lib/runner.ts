// Runs a bench: warms it up, takes the samples and reduces them to a Result (bench/README.md).
import { median, percentile } from './stats.js';
import type { Bench, Result, RunBench, RunSamples, SyncBench } from './types.js';

/** The warm-up is this many operations, or this long, whichever comes first. */
export const WARM_UP_OPS = 200_000;
export const WARM_UP_MS = 1_000;

export const DEFAULT_SAMPLES = 2_000;

/** Each bench is measured this many times in one process, after one warm-up; the result is the median per metric. */
export const REPEATS = 3;

declare const gc: (() => void) | undefined;

/**
 * A full collection, then one turn of the event loop so that the collector's follow-up work finishes before the timed
 * region. Bench processes start with `--expose-gc` (gate.ts, `bench:micro`); without it this only yields.
 */
async function settle(): Promise<void> {
    if ('function' === typeof gc) {
        gc();
    }
    await new Promise((resolve) => setImmediate(resolve));
}

/** The median per metric of the runs of one bench. */
function medianOf(runs: readonly Result[]): Result {
    const pick = (f: (r: Result) => number | undefined): number[] =>
        runs.map(f).filter((v): v is number => undefined !== v);
    const first = runs[0] as Result;
    const result: Result = {
        name: first.name,
        nsPerOp: median(pick((r) => r.nsPerOp)),
        p50: median(pick((r) => r.p50)),
        p99: median(pick((r) => r.p99)),
        p999: median(pick((r) => r.p999)),
        samples: Math.min(...pick((r) => r.samples)),
    };
    const ops = pick((r) => r.opsPerSec);
    if (ops.length > 0) {
        result.opsPerSec = median(ops);
    }
    return result;
}

function reduce(name: string, samplesNsPerOp: ArrayLike<number>, totalNs: number, totalOps: number): Result {
    const sorted = Float64Array.from(samplesNsPerOp).sort();
    return {
        name,
        nsPerOp: totalNs / totalOps,
        p50: percentile(sorted, 0.5),
        p99: percentile(sorted, 0.99),
        p999: percentile(sorted, 0.999),
        samples: sorted.length,
    };
}

async function measureSync(bench: SyncBench, samples: number): Promise<Result> {
    await bench.setup();
    try {
        const ops = bench.opsPerSample;
        let i = 0;

        // warm-up, once: the operations are timed by nothing
        const warmStart = performance.now();
        while (i < WARM_UP_OPS && performance.now() - warmStart < WARM_UP_MS) {
            for (let k = 0; k < ops; k++) {
                bench.op(i++);
            }
        }

        const runs: Result[] = [];
        for (let r = 0; r < REPEATS; r++) {
            await settle();

            // The samples: the clock is read around a batch, never around one operation.
            const perSample = new Float64Array(samples);
            let totalMs = 0;
            for (let s = 0; s < samples; s++) {
                const t0 = performance.now();
                for (let k = 0; k < ops; k++) {
                    bench.op(i++);
                }
                const ms = performance.now() - t0;
                perSample[s] = (ms * 1e6) / ops;
                totalMs += ms;
            }
            runs.push(reduce(bench.name, perSample, totalMs * 1e6, samples * ops));
        }
        return medianOf(runs);
    } finally {
        await bench.teardown?.();
    }
}

async function measureRun(bench: RunBench, samples: number): Promise<Result> {
    await bench.setup?.();
    try {
        const runs: Result[] = [];
        for (let r = 0; r < REPEATS; r++) {
            await settle();
            const run: RunSamples = await bench.run({ samples });
            const result = reduce(bench.name, run.samplesNsPerOp, run.elapsedMs * 1e6, run.totalOps);
            if (false !== bench.throughput) {
                result.opsPerSec = run.totalOps / (run.elapsedMs / 1e3);
            }
            runs.push(result);
        }
        return medianOf(runs);
    } finally {
        await bench.teardown?.();
    }
}

/**
 * Measures one bench: one warm-up, then REPEATS runs of `samples` samples of the batch the bench defines (a worker bench
 * decides its own), and the median per metric.
 */
export function measure(bench: Bench, samples: number = DEFAULT_SAMPLES): Promise<Result> {
    return 'run' in bench ? measureRun(bench, samples) : measureSync(bench, samples);
}
