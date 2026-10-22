// Allocation checks for the hot path tests (spec 5.3): counts minor collections over a long loop, since a minor
// collection happens only after something is allocated (the heap growth is not usable: a collection gives the garbage
// back). Used by test/extra/agrona/HotPathAllocationTest and test/extra/client/protocol/FlyweightsHotPathAllocationTest.
// V8 boxes a number outside the 32-bit small integers (a long above 2^31, a double) in a heap number whenever it is
// passed to or returned from a call that is not inlined; no JS code can avoid that, so a loop may be allowed a number
// of heap numbers per iteration, measured against a control loop that allocates exactly one per iteration.
import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';
import { expect } from 'vitest';
import vm from 'node:vm';

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

/**
 * Runs the loop and expects it to allocate at most `heapNumbers` heap numbers per iteration: none, to within one
 * collection of noise, when 0. Otherwise the iteration count is doubled until the control loop (one heap number per
 * iteration) causes at least 16 minor collections, so that the comparison has resolution, and the loop must cause no
 * more than `heapNumbers` times the control's collections, plus a slack of max(2, control / 8).
 */
export async function expectNoAllocation(
    run: (iterations: number) => void,
    iterations = ITERATIONS,
    heapNumbers = 0,
): Promise<void> {
    if (0 === heapNumbers) {
        const { collections } = await measure(run, iterations);
        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
        return;
    }

    let n = iterations;
    let controlCollections = (await measure(control, n)).collections;
    while (controlCollections < MIN_CONTROL_COLLECTIONS && n < MAX_CALIBRATED_ITERATIONS) {
        n = Math.min(n * 2, MAX_CALIBRATED_ITERATIONS);
        controlCollections = (await measure(control, n)).collections;
    }
    expect(controlCollections, 'minor collections of the control').toBeGreaterThan(0);

    const { collections } = await measure(run, n);
    expect(collections, `minor collections over ${n} iterations (control ${controlCollections})`).toBeLessThanOrEqual(
        heapNumbers * controlCollections + Math.max(2, controlCollections >> 3),
    );
}
