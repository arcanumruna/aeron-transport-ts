// Not in Agrona: get, put and remove of the maps allocate nothing per call, except what a JS `number` forces (see
// HotPathAllocationTest for the method: the minor collections over a long loop are counted, against a control loop that
// allocates one heap number per iteration). A map keyed by an int, or by an object, must not allocate; the long keys and
// values above 2^31 may allocate the heap numbers that V8 boxes when it passes them to a call that is not inlined.
import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Hashing } from '../../../src/agrona/collections/Hashing.js';
import { Int2ObjectHashMap } from '../../../src/agrona/collections/Int2ObjectHashMap.js';
import { Long2LongHashMap } from '../../../src/agrona/collections/Long2LongHashMap.js';
import { Long2ObjectHashMap } from '../../../src/agrona/collections/Long2ObjectHashMap.js';
import { Object2ObjectHashMap } from '../../../src/agrona/collections/Object2ObjectHashMap.js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const ITERATIONS = 2_000_000;
const WARM_UP = 100_000;

type Collection = { detail?: { kind: number } };

async function minorCollections(run: (iterations: number) => void, iterations: number): Promise<number> {
    run(WARM_UP);
    run(WARM_UP);

    const observer = new PerformanceObserver(() => {});
    observer.observe({ entryTypes: ['gc'] });
    gc();
    await new Promise((resolve) => setImmediate(resolve));
    observer.takeRecords();

    run(iterations);

    await new Promise((resolve) => setImmediate(resolve));
    const collections = observer
        .takeRecords()
        .filter((e) => (e as unknown as Collection).detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR).length;
    observer.disconnect();
    return collections;
}

let boxed = 0;

/** A loop that allocates exactly one heap number per iteration (a double stored in a closure variable). */
function control(n: number): number {
    for (let i = 0; i < n; i++) {
        boxed = i + 0.5;
    }
    return boxed;
}

async function expectNoAllocation(run: (iterations: number) => void, heapNumbers = 0): Promise<void> {
    const collections = await minorCollections(run, ITERATIONS);
    if (0 === heapNumbers) {
        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    } else {
        const controlCollections = await minorCollections(control, ITERATIONS);
        expect(controlCollections, 'minor collections of the control').toBeGreaterThan(0);
        expect(collections, `minor collections (control ${controlCollections})`).toBeLessThanOrEqual(
            heapNumbers * controlCollections + 1,
        );
    }
}

class Key {
    public readonly id: number;
    public constructor(id: number) {
        this.id = id;
    }

    public equals(o: unknown): boolean {
        return o instanceof Key && o.id === this.id;
    }

    public hashCode(): number {
        return this.id;
    }
}

describe('CollectionsHotPathAllocationTest', () => {
    const sum = new Float64Array(1);
    const values = ['a', 'b', 'c', 'd'];

    it('int2ObjectPutGetRemoveAllocateNothing', async () => {
        const map = new Int2ObjectHashMap<string>();
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = i & 1023;
                map.put(key, values[i & 3]!);
                sum[0] = sum[0]! + map.get(key)!.length;
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        });
    });

    it('int2ObjectIterationAllocatesNothing', async () => {
        const map = new Int2ObjectHashMap<string>();
        for (let i = 0; i < 64; i++) {
            map.put(i, values[i & 3]!);
        }
        // Created once (see HashSetsHotPathAllocationTest): a closure per pass allocates unless V8 inlines forEachInt.
        const consumer = (k: number, v: string): void => {
            sum[0] = sum[0]! + k + v.length;
        };
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i += 64) {
                for (const it = map.keySet().iterator(); it.hasNext();) {
                    sum[0] = sum[0]! + it.nextInt();
                }
                for (const it = map.entrySet().iterator(); it.hasNext();) {
                    sum[0] = sum[0]! + it.next().getKey();
                }
                map.forEachInt(consumer);
            }
        });
    });

    it('object2ObjectPutGetRemoveAllocateNothing', async () => {
        const keys: Key[] = [];
        for (let i = 0; i < 1024; i++) {
            keys.push(new Key(i));
        }
        const map = new Object2ObjectHashMap<Key, string>();
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = keys[i & 1023]!;
                map.put(key, values[i & 3]!);
                sum[0] = sum[0]! + map.get(key)!.length;
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        });
    });

    it('long2ObjectPutGetRemoveWithIntSizedKeysAllocateNothing', async () => {
        const map = new Long2ObjectHashMap<string>();
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = i & 1023;
                map.put(key, values[i & 3]!);
                sum[0] = sum[0]! + map.get(key)!.length;
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        });
    });

    it('long2ObjectPutGetRemoveWithLongKeysAllocateOnlyTheBoxedKeys', async () => {
        const map = new Long2ObjectHashMap<string>();
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = (i & 1023) * 4294967296 + 7;
                map.put(key, values[i & 3]!);
                sum[0] = sum[0]! + map.get(key)!.length;
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        }, 4);
    });

    it('long2LongPutGetRemoveWithIntSizedKeysAndValuesAllocateNothing', async () => {
        const map = new Long2LongHashMap(-1);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = i & 1023;
                map.put(key, i & 255);
                sum[0] = sum[0]! + map.get(key);
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        });
    });

    it('long2LongPutGetRemoveWithLongKeysAllocateOnlyTheBoxedKeysAndValues', async () => {
        const map = new Long2LongHashMap(-1);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const key = (i & 1023) * 4294967296 + 7;
                map.put(key, key + 1);
                sum[0] = sum[0]! + map.get(key);
                if ((i & 3) === 0) {
                    map.remove(key);
                }
            }
        }, 6);
    });

    it('hashingAllocatesNothingForIntSizedValues', async () => {
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sum[0] = sum[0]! + Hashing.hash(i, 1023) + Hashing.hashLong(i, 1023) + Hashing.evenHashLong(-i, 1023);
            }
        });
    });
});
