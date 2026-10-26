// The types of the micro bench harness (bench/README.md).

/** One bench result: what `runMicro` prints as a JSON line, and what the gate compares. All times are nanoseconds. */
export interface Result {
    name: string;
    /** Total time / total operations. */
    nsPerOp: number;
    /** Percentiles of the per-sample ns per operation (a sample is the mean of a batch); the median of the runs. */
    p50: number;
    p99: number;
    p999: number;
    /** Throughput; only the benches that run workers report one. */
    opsPerSec?: number;
    /** The samples of one run: p99 and p99.9 are a verdict only from MIN_TAIL_SAMPLES of them (bench/lib/verdict.ts). */
    samples?: number;
}

/** A bench that times batches of `op` calls in this thread. */
export interface SyncBench {
    name: string;
    setup(): void | Promise<void>;
    /** One operation; `i` counts up from 0 over the warm-up and the samples. */
    op(i: number): void;
    /** Operations in one timed sample: `performance.now()` is read around the batch, never around one operation. */
    opsPerSample: number;
    teardown?(): void | Promise<void>;
}

/** What a worker bench measured: per-sample ns per operation, and the totals for the throughput. */
export interface RunSamples {
    samplesNsPerOp: number[];
    totalOps: number;
    elapsedMs: number;
}

/** A bench that runs workers and returns its own samples. */
export interface RunBench {
    name: string;
    /** Called once before the first run (the end-to-end benches start their drivers here). */
    setup?(): void | Promise<void>;
    run(options: { samples: number }): Promise<RunSamples>;
    /** Called once after the last run, also after a failure. */
    teardown?(): void | Promise<void>;
    /**
     * `false` for a latency bench: the result has no ops/s, so the gate judges it as a latency bench (5 pairs, no
     * throughput rule). Throughput benches leave it out.
     */
    throughput?: boolean;
}

export type Bench = SyncBench | RunBench;

/** What a bench file exports. */
export interface BenchModule {
    benches: Bench[];
}

/** A line `runMicro` prints when a bench or a bench file fails: the gate reports a bench that fails in the base as n/a. */
export interface ErrorLine {
    name: string;
    error: string;
}

/** The start of the error text of a bench that cannot give a verdict on this host (too few cores): NO_VERDICT, not FAIL. */
export const NO_VERDICT_PREFIX = 'no-verdict: ';
