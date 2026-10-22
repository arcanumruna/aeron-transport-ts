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

// A calibrated test runs the control until it has resolution and then the loop up to MAX_ATTEMPTS times; on a loaded
// host that can pass the 10 s default, which would turn a retry that rescued the test into a timeout.
vi.setConfig({ testTimeout: 60_000 });

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

export const ITERATIONS = 2_000_000;
const WARM_UP = 100_000;

type Collection = { detail?: { kind: number } };

/** The minor collections and the heap growth while `run(iterations)` runs, after a warm up. */
export async function measure(
    run: (iterations: number) => void,
    iterations: number,
): Promise<{ collections: number; heapGrowth: number }> {
    run(WARM_UP);
    run(WARM_UP);

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
    return { collections, heapGrowth };
}

let boxed = 0;

/** A loop that allocates exactly one heap number per iteration (a double stored in a closure variable). */
export function control(n: number): number {
    for (let i = 0; i < n; i++) {
        boxed = i + 0.5;
    }
    return boxed;
}

const MAX_CALIBRATED_ITERATIONS = 32_000_000;
const MIN_CONTROL_COLLECTIONS = 16;
const MAX_ATTEMPTS = 3;

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
): Promise<number> {
    let minimum = Infinity;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && minimum > bound; attempt++) {
        const { collections, heapGrowth } = await measure(run, n);
        if (collections > bound && heapGrowth > retainedGrowth) {
            return collections;
        }
        minimum = Math.min(minimum, collections);
    }
    return minimum;
}

/**
 * Runs the loop and expects it to allocate at most `heapNumbers` heap numbers per iteration: none, to within one
 * collection of noise, when 0. Otherwise the iteration count is doubled until the control loop (one heap number per
 * iteration) causes at least 16 minor collections, so that the comparison has resolution, and the loop must cause no
 * more than `heapNumbers` times the control's collections, plus a slack of max(2, control / 8). The loop is measured
 * up to 3 times and the minimum is asserted (see minimumCollections); the control is measured once.
 */
export async function expectNoAllocation(
    run: (iterations: number) => void,
    iterations = ITERATIONS,
    heapNumbers = 0,
): Promise<void> {
    if (0 === heapNumbers) {
        const collections = await minimumCollections(run, iterations, 1, MIN_RETAINED_HEAP_GROWTH);
        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
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
    const collections = await minimumCollections(run, n, bound, Math.max(MIN_RETAINED_HEAP_GROWTH, 2 * controlGrowth));
    expect(collections, `minor collections over ${n} iterations (control ${controlCollections})`).toBeLessThanOrEqual(
        bound,
    );
}
