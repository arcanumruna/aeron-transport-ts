// Runs a bench: warms it up, takes the samples and reduces them to a Result (bench/README.md).
import { percentile } from './stats.js';
import type { Bench, Result, RunBench, RunSamples, SyncBench } from './types.js';

/** The warm-up is this many operations, or this long, whichever comes first. */
export const WARM_UP_OPS = 200_000;
export const WARM_UP_MS = 1_000;

export const DEFAULT_SAMPLES = 2_000;

function reduce(name: string, samplesNsPerOp: ArrayLike<number>, totalNs: number, totalOps: number): Result {
    const sorted = Float64Array.from(samplesNsPerOp).sort();
    return {
        name,
        nsPerOp: totalNs / totalOps,
        p50: percentile(sorted, 0.5),
        p99: percentile(sorted, 0.99),
        p999: percentile(sorted, 0.999),
    };
}

async function measureSync(bench: SyncBench, samples: number): Promise<Result> {
    await bench.setup();
    try {
        const ops = bench.opsPerSample;
        let i = 0;

        // warm-up: the operations are timed by nothing
        const warmStart = performance.now();
        while (i < WARM_UP_OPS && performance.now() - warmStart < WARM_UP_MS) {
            for (let k = 0; k < ops; k++) {
                bench.op(i++);
            }
        }

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

        return reduce(bench.name, perSample, totalMs * 1e6, samples * ops);
    } finally {
        await bench.teardown?.();
    }
}

async function measureRun(bench: RunBench, samples: number): Promise<Result> {
    const run: RunSamples = await bench.run({ samples });
    const result = reduce(bench.name, run.samplesNsPerOp, run.elapsedMs * 1e6, run.totalOps);
    result.opsPerSec = run.totalOps / (run.elapsedMs / 1e3);
    return result;
}

/** Measures one bench: `samples` samples of the batch the bench defines (a worker bench decides its own). */
export function measure(bench: Bench, samples: number = DEFAULT_SAMPLES): Promise<Result> {
    return 'run' in bench ? measureRun(bench, samples) : measureSync(bench, samples);
}
