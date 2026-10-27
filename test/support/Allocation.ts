// Allocation checks for the hot path tests (spec 5.3): counts minor collections over a long loop, since a minor
// collection happens only after something is allocated (the heap growth is not usable: a collection gives the garbage
// back). Used by test/extra/agrona/HotPathAllocationTest and test/extra/client/protocol/FlyweightsHotPathAllocationTest.
// V8 boxes a number outside the 32-bit small integers (a long above 2^31, a double) in a heap number whenever it is
// passed to or returned from a call that is not inlined; no JS code can avoid that, so a loop may be allowed a number
// of heap numbers per iteration, measured against a control loop that allocates exactly one per iteration.
import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';
import { expect, vi } from 'vitest';
import vm from 'node:vm';
import { Session } from 'node:inspector/promises';

// A calibrated test runs the control until it has resolution and then the loop up to MAX_ATTEMPTS times; on a loaded
// host that can pass the 10 s default, which would turn a retry that rescued the test into a timeout. Under full-suite
// load the 32M-iteration LargePosition cases with 6 attempts can pass 60 s, hence 180 s.
vi.setConfig({ testTimeout: 180_000 });

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
v8.setFlagsFromString('--allow-natives-syntax');
const prepareForOptimization = new Function('f', '%PrepareFunctionForOptimization(f);') as (f: unknown) => void;
const optimizeOnNextCall = new Function('f', '%OptimizeFunctionOnNextCall(f);') as (f: unknown) => void;
const optimizationStatus = new Function('f', 'return %GetOptimizationStatus(f);') as (f: unknown) => number;

export const ITERATIONS = 2_000_000;
const WARM_UP = 100_000;
/** The pause after the warm up that lets a starved background compile finish (see measure). */
const SETTLE_MS = 10;

type Collection = { detail?: { kind: number } };

/** The most rounds `settleUntilQuiet` runs. */
const MAX_SETTLE_ROUNDS = 40;

/**
 * Warms the loop up until it is in its steady state (issue #46). On a loaded host the optimizing compiler's background
 * thread can take far longer than SETTLE_MS to install the code of a long loop, and a loop that runs in a lower tier
 * boxes numbers and collects garbage that is not the optimized code's own (the LargePosition cases, whose positions
 * are outside the 31-bit small integers, then counted a constant 4 collections on every attempt). A round of `warmUp`
 * iterations that causes no minor collection means the optimized code is the code that runs. The wait is bounded by
 * rounds, not by time, and a loop that really allocates is never quiet: it goes on to the measurement, which fails it.
 */
async function settleUntilQuiet(run: (iterations: number) => void, warmUp: number): Promise<number> {
    for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        const observer = new PerformanceObserver(() => {});
        observer.observe({ entryTypes: ['gc'] });
        await new Promise((resolve) => setImmediate(resolve));
        observer.takeRecords();
        run(warmUp);
        await new Promise((resolve) => setImmediate(resolve));
        const collections = observer
            .takeRecords()
            .filter((e) => (e as unknown as Collection).detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR).length;
        observer.disconnect();
        if (0 === collections) {
            return round;
        }
    }
    return MAX_SETTLE_ROUNDS;
}

/**
 * The minor collections and the heap growth while `run(iterations)` runs, after a warm up.
 *
 * The warm up scales with the measured iterations (an eighth of them, between 1,000 and WARM_UP): a caller with few,
 * expensive iterations (fragmented or interleaved reassembly) would otherwise spend more time warming up than
 * measuring, while the optimizer needs only a few thousand iterations to compile the loop.
 */
export async function measure(
    run: (iterations: number) => void,
    iterations: number,
    settle = false,
): Promise<{ collections: number; heapGrowth: number; detail: string }> {
    const warmUp = Math.min(WARM_UP, Math.max(1_000, iterations >> 3));
    // Force a synchronous TurboFan compile of `run` before it is measured. Left to the JIT, the loop tiers up through
    // Maglev and on-stack replacement on a background thread: on a loaded host (vitest runs the test files in parallel)
    // the measured call could then run, wholly or partly, in a lower tier that boxes numbers above 2^31 and causes
    // collections that are not the code's own (issues #33, #46). `%OptimizeFunctionOnNextCall` compiles on the calling
    // thread at the next call, so the measured code does not depend on timing.
    prepareForOptimization(run);
    run(warmUp);
    run(warmUp);
    optimizeOnNextCall(run);
    run(warmUp);
    const statusAfterCompile = optimizationStatus(run);
    const settleRounds = settle ? await settleUntilQuiet(run, warmUp) : 0;

    const observer = new PerformanceObserver(() => {});
    observer.observe({ entryTypes: ['gc'] });
    gc();
    // Let the event loop deliver the forced collection (and any other pending work) first, then drop everything seen so
    // far, so that only collections after this point are counted. The second yield flushes what the first one caused.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    observer.takeRecords();
    const before = process.memoryUsage().heapUsed;

    run(iterations);

    const heapGrowth = process.memoryUsage().heapUsed - before;
    await new Promise((resolve) => setImmediate(resolve));
    const collections = observer
        .takeRecords()
        .filter((e) => (e as unknown as Collection).detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR).length;
    observer.disconnect();
    // the optimization status (a %GetOptimizationStatus bit field) after the forced compile and after the measured run,
    // so that a failure under load says which tier the loop ran in (issue #46)
    const detail = `status 0x${statusAfterCompile.toString(16)}/0x${optimizationStatus(run).toString(16)}, settle ${settleRounds}`;
    return { collections, heapGrowth, detail };
}

let boxed = 0;

/** A loop that allocates exactly one heap number per iteration (a double stored in a closure variable). */
export function control(n: number): number {
    for (let i = 0; i < n; i++) {
        boxed = i + 0.5;
    }
    return boxed;
}

type ProfileNode = {
    callFrame: { functionName: string; url: string; lineNumber: number };
    selfSize: number;
    children: ProfileNode[];
};

/** How many allocation sites a failure names. */
const MAX_SITES = 8;

/**
 * The call sites that allocated most while `run(iterations)` ran, from V8's sampling heap profiler, garbage included,
 * so that an allocation failure names where the loop allocates (a failure seen only on CI cannot be profiled locally).
 * Each site is its innermost three frames and the sampled bytes.
 */
async function allocationSites(run: (iterations: number) => void, iterations: number): Promise<string> {
    const session = new Session();
    session.connect();
    try {
        await session.post('HeapProfiler.enable');
        await session.post('HeapProfiler.startSampling', {
            samplingInterval: 512,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        });
        run(iterations);
        const { profile } = (await session.post('HeapProfiler.stopSampling')) as { profile: { head: ProfileNode } };
        const sites = new Map<string, number>();
        const walk = (node: ProfileNode, stack: string[]): void => {
            const f = node.callFrame;
            const frame = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop() ?? ''}:${f.lineNumber + 1}`;
            const frames = [...stack, frame];
            if (node.selfSize > 0) {
                const site = frames.slice(-3).reverse().join(' < ');
                sites.set(site, (sites.get(site) ?? 0) + node.selfSize);
            }
            for (const child of node.children) {
                walk(child, frames);
            }
        };
        walk(profile.head, []);
        return [...sites]
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_SITES)
            .map(([site, bytes]) => `${bytes} B at ${site}`)
            .join('; ');
    } finally {
        await session.post('HeapProfiler.disable');
        session.disconnect();
    }
}

const MAX_CALIBRATED_ITERATIONS = 32_000_000;
const MIN_CONTROL_COLLECTIONS = 16;
export const MAX_ATTEMPTS = 6;

/** A failed attempt that grew the heap by more than this (or twice the control's growth) retained what it allocated. */
const MIN_RETAINED_HEAP_GROWTH = 4 * 1024 * 1024;

/**
 * Measures `run(n)` up to MAX_ATTEMPTS times, stopping at the first measurement within `bound`, and returns the
 * minimum collection count seen.
 *
 * Why the minimum is sound: the count is the loop's own collections plus noise from outside it (a scavenge triggered
 * by vitest's worker RPC, the observer's own delivery, the gaps around the loop, a loaded host). Noise can only add
 * collections, never remove them, so the minimum over attempts is the closest estimate of the loop's own. A loop that
 * allocates garbage causes many collections on every attempt (its minimum stays far above the bound), so repeating
 * cannot hide it; the bound itself is not loosened.
 *
 * A loop that RETAINS what it allocates is the exception: once the young generation has grown around the retained
 * objects, a repeat can see fewer or no minor collections. So an attempt over the bound whose heap growth exceeds
 * `retainedGrowth` (the garbage a clean loop could leave is far below it) is final, and is never repeated.
 */
async function minimumCollections(
    run: (iterations: number) => void,
    n: number,
    bound: number,
    retainedGrowth: number,
    attempts: string[],
): Promise<number> {
    let minimum = Infinity;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && minimum > bound; attempt++) {
        const { collections, heapGrowth, detail } = await measure(run, n, bound <= 1);
        // the detail of every attempt goes into the failure message (issue #42): a flake under load names its numbers
        attempts.push(`#${attempt + 1}: ${collections} collections, heap growth ${heapGrowth} B, ${detail}`);
        if (collections > bound && heapGrowth > retainedGrowth) {
            attempts.push(`allocation sites: ${await allocationSites(run, n)}`);
            return collections;
        }
        minimum = Math.min(minimum, collections);
    }
    if (minimum > bound) {
        attempts.push(`allocation sites: ${await allocationSites(run, n)}`);
    }
    return minimum;
}

/**
 * Runs the loop and expects it to allocate at most `heapNumbers` heap numbers per iteration: none, to within one
 * collection of noise, when 0. Otherwise the iteration count is doubled until the control loop (one heap number per
 * iteration) causes at least 16 minor collections, so that the comparison has resolution, and the loop must cause no
 * more than `heapNumbers` times the control's collections, plus a slack of max(2, control / 8). The loop is measured
 * up to 6 times and the minimum is asserted (see minimumCollections); the control is measured once.
 */
export async function expectNoAllocation(
    run: (iterations: number) => void,
    iterations = ITERATIONS,
    heapNumbers = 0,
): Promise<void> {
    if (0 === heapNumbers) {
        const attempts: string[] = [];
        const collections = await minimumCollections(run, iterations, 1, MIN_RETAINED_HEAP_GROWTH, attempts);
        expect(
            collections,
            `minor collections over ${iterations} iterations; attempts ${attempts.join('; ')}`,
        ).toBeLessThanOrEqual(1);
        return;
    }

    let n = iterations;
    let { collections: controlCollections, heapGrowth: controlGrowth } = await measure(control, n);
    while (controlCollections < MIN_CONTROL_COLLECTIONS && n < MAX_CALIBRATED_ITERATIONS) {
        n = Math.min(n * 2, MAX_CALIBRATED_ITERATIONS);
        ({ collections: controlCollections, heapGrowth: controlGrowth } = await measure(control, n));
    }
    expect(controlCollections, 'minor collections of the control').toBeGreaterThan(0);

    const bound = heapNumbers * controlCollections + Math.max(2, controlCollections >> 3);
    const attempts: string[] = [];
    const collections = await minimumCollections(
        run,
        n,
        bound,
        Math.max(MIN_RETAINED_HEAP_GROWTH, 2 * controlGrowth),
        attempts,
    );
    expect(
        collections,
        `minor collections over ${n} iterations (control ${controlCollections}, bound ${bound}); attempts ${attempts.join('; ')}`,
    ).toBeLessThanOrEqual(bound);
}
