// A delay injected into one function of the candidate, for the tests of the gate itself (T24, spec D110): a candidate
// with a slowdown must fail the gate. It is the harness that wraps the function, in the bench process, when the
// environment variable AERON_BENCH_INJECT is set (`bench:gate --inject <spec>` sets it for the candidate runs only);
// nothing in `src/` knows about it, and without the variable this module is not even imported.
//
// spec: `TermReader.read:+<percent>%`. The delay per call is that percentage of the cost of one `TermReader.read` of 16
// fragments of 64 B, measured here (the median of many batches of 1000 calls, on this host, in this process) before the wrapper is
// installed, so that "20%" means 20% of the read on any host. It is a busy loop of integer additions, whose length in
// iterations is calibrated by timing calls of that loop, as the wrapper makes them: a clock read per call (~40 ns)
// would be the size of the delay.
// The wrapper takes the eight arguments of `TermReader.read` by name, so it allocates nothing.
import { median } from './stats.js';
import { TermReader } from '../../src/client/logbuffer/TermReader.js';
import { termReaderBench } from '../micro/termreader.bench.js';

export const INJECT_ENV = 'AERON_BENCH_INJECT';

let sink = 0;

function spin(iterations: number): void {
    let s = sink;
    for (let i = 0; i < iterations; i++) {
        s = (s + i) | 0;
    }
    sink = s;
}

/** The median of `rounds` timings of `batch()` (a batch of `ops` operations), in ns per operation: what the bench's p50 sees. */
function typical(batch: () => void, ops: number, rounds: number): number {
    const times: number[] = [];
    for (let r = 0; r < rounds; r++) {
        const t0 = performance.now();
        batch();
        times.push(((performance.now() - t0) * 1e6) / ops);
    }
    return median(times);
}

/** ns per call of one `TermReader.read` of 16 fragments, as the bench measures it. */
async function readCost(): Promise<number> {
    const bench = termReaderBench('calibration', 16);
    await bench.setup();
    const batch = (): void => {
        for (let i = 0; i < 1000; i++) {
            bench.op(i);
        }
    };
    for (let i = 0; i < 200; i++) {
        batch();
    }
    return typical(batch, 1000, 300);
}

/** ns per call of `spin(iterations)`, called as the wrapper calls it (batches of calls, the fastest batch). */
function spinCost(iterations: number): number {
    const batch = (): void => {
        for (let i = 0; i < 1000; i++) {
            spin(iterations);
        }
    };
    for (let i = 0; i < 100; i++) {
        batch();
    }
    return typical(batch, 1000, 100);
}

/** The iterations of `spin` that take `targetNs` per call: a few rounds of proportional correction of the cost. */
function iterationsFor(targetNs: number): number {
    let iterations = Math.max(1, Math.round(targetNs));
    for (let round = 0; round < 6; round++) {
        const cost = spinCost(iterations);
        iterations = Math.max(1, Math.round((iterations * targetNs) / cost));
    }
    return iterations;
}

/** What the spec says, or an Error. */
export function parseSpec(spec: string): { target: string; percent: number } {
    const m = /^(TermReader\.read):\+(\d+(?:\.\d+)?)%$/.exec(spec);
    if (null === m) {
        throw new Error(INJECT_ENV + ' needs TermReader.read:+<percent>%, not "' + spec + '"');
    }
    return { target: m[1] as string, percent: Number(m[2]) };
}

/** Installs the delay of `spec`; returns the iterations of the loop it added to each call. */
export async function install(spec: string): Promise<number> {
    const { percent } = parseSpec(spec);
    const delayNs = ((await readCost()) * percent) / 100;
    const iterations = iterationsFor(delayNs);
    const original = TermReader.read as (...args: unknown[]) => number;
    const wrapper = (
        termBuffer: unknown,
        termOffset: unknown,
        handler: unknown,
        fragmentsLimit: unknown,
        header: unknown,
        errorHandler: unknown,
        currentPosition: unknown,
        subscriberPosition: unknown,
    ): number => {
        spin(iterations);
        return original.call(
            TermReader,
            termBuffer,
            termOffset,
            handler,
            fragmentsLimit,
            header,
            errorHandler,
            currentPosition,
            subscriberPosition,
        );
    };
    Object.defineProperty(TermReader, 'read', { value: wrapper, writable: true, configurable: true });
    process.stderr.write(
        'inject: ' +
            spec +
            ' = ' +
            delayNs.toFixed(1) +
            ' ns = ' +
            iterations +
            ' iterations (' +
            spinCost(iterations).toFixed(1) +
            ' ns) per call\n',
    );
    return iterations;
}

/** Installs the delay that the environment asks for, if it asks for one. */
export async function installFromEnvironment(): Promise<void> {
    const spec = process.env[INJECT_ENV];
    if (undefined !== spec && '' !== spec) {
        await install(spec);
    }
}
