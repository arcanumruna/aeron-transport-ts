// The types of the micro bench harness (bench/README.md).

/** One bench result: what `runMicro` prints as a JSON line, and what the gate compares. All times are nanoseconds. */
export interface Result {
    name: string;
    /** Total time / total operations. */
    nsPerOp: number;
    /** Percentiles of the per-sample ns per operation. */
    p50: number;
    p99: number;
    p999: number;
    /** Throughput; only the benches that run workers report one. */
    opsPerSec?: number;
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
    run(options: { samples: number }): Promise<RunSamples>;
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
