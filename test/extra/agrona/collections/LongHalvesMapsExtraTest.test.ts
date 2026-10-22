// Not in Agrona: the (hi, lo) keyed maps of spec D14 (LongHalves2ObjectHashMap, LongHalves2LongHashMap) and
// Hashing.hashLongHalves. The maps are compared with a Map<bigint> model over seeded random 64-bit keys, with the
// Long2* maps they were generated from (same slots, so the same iteration order for a key in +/-(2^53 - 1)), and the
// hash with a bigint reference of Agrona's hash(long, int).
import { describe, expect, it } from 'vitest';
import { Hashing } from '../../../../src/agrona/collections/Hashing.js';
import { Long2LongHashMap } from '../../../../src/agrona/collections/Long2LongHashMap.js';
import { Long2ObjectHashMap } from '../../../../src/agrona/collections/Long2ObjectHashMap.js';
import { LongHalves2LongHashMap } from '../../../../src/agrona/collections/LongHalves2LongHashMap.js';
import { LongHalves2ObjectHashMap } from '../../../../src/agrona/collections/LongHalves2ObjectHashMap.js';
import { ITERATIONS, expectNoAllocation } from '../../../support/Allocation.js';
import { mulberry32 } from '../../../support/Random.js';

const MASK64 = (1n << 64n) - 1n;

/** Agrona's Hashing.hash(long value) on a bigint. */
function referenceHash(value: bigint): number {
    let x = BigInt.asUintN(64, value);
    x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    x = x ^ (x >> 31n);
    return Number(BigInt.asIntN(32, x)) ^ Number(BigInt.asIntN(32, x >> 32n));
}

function keyOf(hi: number, lo: number): bigint {
    return (BigInt(hi | 0) << 32n) | BigInt(lo >>> 0);
}

function randomInt(random: () => number): number {
    return (random() * 4294967296) | 0;
}

/** A pool of keys that collide on one half or the other, plus the extremes. */
function keyPool(random: () => number, size: number): [number, number][] {
    const pool: [number, number][] = [
        [0, 0],
        [-1, -1],
        [0, -1],
        [-1, 0],
        [-2147483648, 2147483647],
        [2147483647, -2147483648],
    ];
    while (pool.length < size) {
        const kind = pool.length % 4;
        const hi = randomInt(random);
        const lo = randomInt(random);
        pool.push(kind === 0 ? [hi, lo] : kind === 1 ? [hi & 7, lo] : kind === 2 ? [hi, lo & 7] : [hi & 3, lo & 3]);
    }
    return pool;
}

describe('Hashing.hashLongHalves', () => {
    it('equals Agrona hash(long, int) over 10k random keys', () => {
        const random = mulberry32(1);
        for (let i = 0; i < 10_000; i++) {
            const hi = randomInt(random);
            const lo = randomInt(random);
            const expected = referenceHash(keyOf(hi, lo));
            expect(Hashing.hashLongHalves(hi, lo), `${hi},${lo}`).toBe(expected);
            for (const mask of [7, 1023, 0x3fffffff]) {
                expect(Hashing.hashLongHalves(hi, lo, mask)).toBe(expected & mask);
            }
            const even = (expected << 1) - (expected << 8);
            expect(Hashing.evenHashLongHalves(hi, lo, 4095)).toBe(even & 4095);
        }
    });

    it('equals the reference at the extremes and equals hashLong for a number key', () => {
        for (const [hi, lo] of [
            [0, 0],
            [-1, -1],
            [0, -1],
            [-1, 0],
            [-2147483648, 0],
            [2147483647, -1],
        ] as const) {
            expect(Hashing.hashLongHalves(hi, lo)).toBe(referenceHash(keyOf(hi, lo)));
        }

        const random = mulberry32(2);
        for (let i = 0; i < 10_000; i++) {
            const hi = (randomInt(random) >> 11) | 0; // 21 bits, signed: hi * 2^32 + lo is a safe integer
            const lo = randomInt(random);
            const value = hi * 4294967296 + (lo >>> 0);
            expect(Hashing.hashLongHalves(hi, lo, 1023)).toBe(Hashing.hashLong(value, 1023));
        }
    });

    it('coerces the halves with | 0', () => {
        expect(Hashing.hashLongHalves(4294967295, 4294967295)).toBe(Hashing.hashLongHalves(-1, -1));
        expect(Hashing.hashLongHalves(2 ** 32 + 5, 7)).toBe(Hashing.hashLongHalves(5, 7));
    });
});

describe('LongHalves2ObjectHashMap', () => {
    it('matches a Map<bigint> model over 10k seeded random mixed operations', () => {
        const random = mulberry32(3);
        const pool = keyPool(random, 400);
        const map = new LongHalves2ObjectHashMap<string>();
        const model = new Map<bigint, string>();

        for (let i = 0; i < 10_000; i++) {
            const [hi, lo] =
                random() < 0.8 ? pool[(random() * pool.length) | 0]! : [randomInt(random), randomInt(random)];
            const key = keyOf(hi, lo);
            const value = 'v' + i;
            switch ((random() * 5) | 0) {
                case 0:
                    expect(map.put(hi, lo, value)).toBe(model.get(key) ?? null);
                    model.set(key, value);
                    break;
                case 1:
                    expect(map.get(hi, lo)).toBe(model.get(key) ?? null);
                    break;
                case 2:
                    expect(map.remove(hi, lo)).toBe(model.get(key) ?? null);
                    model.delete(key);
                    break;
                case 3:
                    expect(map.containsKey(hi, lo)).toBe(model.has(key));
                    break;
                default:
                    expect(map.computeIfAbsent(hi, lo, () => value)).toBe(model.get(key) ?? value);
                    if (!model.has(key)) {
                        model.set(key, value);
                    }
            }
            expect(map.size()).toBe(model.size);
        }

        const seen = new Map<bigint, string>();
        map.forEach((hi, lo, value) => seen.set(keyOf(hi, lo), value));
        expect(seen).toEqual(model);
    });

    it('keys that collide on the low half (and on the high half) stay distinct', () => {
        const map = new LongHalves2ObjectHashMap<number>();
        for (let i = 0; i < 200; i++) {
            map.put(i, 7, i);
            map.put(7, i, 1000 + i);
        }
        // (7, 7) was put twice: by the first loop as (7, 7) = 7 and then replaced by the second as 1007
        expect(map.size()).toBe(399);
        for (let i = 0; i < 200; i++) {
            expect(map.get(i, 7)).toBe(i === 7 ? 1007 : i);
            expect(map.get(7, i)).toBe(1000 + i);
        }
        for (let i = 0; i < 200; i += 2) {
            map.remove(i, 7);
        }
        for (let i = 0; i < 200; i++) {
            expect(map.containsKey(i, 7)).toBe(i % 2 === 1 || i === 7);
            expect(map.get(7, i)).toBe(1000 + i);
        }
    });

    it('resizes past the initial capacity and keeps every key', () => {
        const map = new LongHalves2ObjectHashMap<number>();
        expect(map.capacity()).toBe(8);
        const random = mulberry32(4);
        const keys: [number, number][] = [];
        for (let i = 0; i < 5000; i++) {
            const k: [number, number] = [randomInt(random), randomInt(random)];
            keys.push(k);
            map.put(k[0], k[1], i);
        }
        expect(map.capacity()).toBeGreaterThanOrEqual(8192);
        expect(map.size()).toBe(5000);
        keys.forEach((k, i) => expect(map.get(k[0], k[1])).toBe(i));
        keys.slice(0, 4900).forEach((k) => map.remove(k[0], k[1]));
        map.compact();
        expect(map.capacity()).toBeLessThan(8192);
        keys.slice(4900).forEach((k, i) => expect(map.get(k[0], k[1])).toBe(4900 + i));
    });

    it('holds (0, 0) and (-1, -1), which differ from the empty slot and from each other', () => {
        const map = new LongHalves2ObjectHashMap<string>();
        expect(map.get(0, 0)).toBeNull();
        expect(map.containsKey(0, 0)).toBe(false);
        map.put(0, 0, 'zero');
        map.put(-1, -1, 'minus one');
        expect(map.get(0, 0)).toBe('zero');
        expect(map.get(-1, -1)).toBe('minus one');
        expect(map.get(4294967295, 4294967295)).toBe('minus one');
        expect(map.get(0, -1)).toBeNull();
        expect(map.get(-1, 0)).toBeNull();
        expect(map.remove(0, 0)).toBe('zero');
        expect(map.containsKey(0, 0)).toBe(false);
        expect(map.get(-1, -1)).toBe('minus one');
        expect(map.remove(-1, -1, 'other')).toBe(false);
        expect(map.remove(-1, -1, 'minus one')).toBe(true);
        expect(map.isEmpty()).toBe(true);
    });

    it('iterates in the order of Long2ObjectHashMap for a key in +/-(2^53 - 1), with removal during iteration', () => {
        const random = mulberry32(5);
        const halves = new LongHalves2ObjectHashMap<number>();
        const longs = new Long2ObjectHashMap<number>();
        for (let i = 0; i < 2000; i++) {
            const hi = (randomInt(random) >> 11) | 0;
            const lo = randomInt(random);
            const value = hi * 4294967296 + (lo >>> 0);
            if (random() < 0.3) {
                halves.remove(hi, lo);
                longs.remove(value);
            } else {
                halves.put(hi, lo, i);
                longs.put(value, i);
            }
        }
        expect(halves.size()).toBe(longs.size());
        expect(halves.capacity()).toBe(longs.capacity());

        const orderHalves: number[] = [];
        const keyIterator = halves.keySet().iterator();
        while (keyIterator.hasNext()) {
            keyIterator.nextKey();
            orderHalves.push(keyIterator.getKeyHigh() * 4294967296 + (keyIterator.getKeyLow() >>> 0));
        }
        const orderLongs: number[] = [];
        const longIterator = longs.keySet().iterator();
        while (longIterator.hasNext()) {
            orderLongs.push(longIterator.nextLong());
        }
        expect(orderHalves).toEqual(orderLongs);

        expect(halves.keySet().removeIfLongHalves((hi, lo) => (lo & 1) === 1)).toBe(true);
        expect(longs.keySet().removeIfLong((key) => 0 !== key % 2)).toBe(true);
        expect(halves.size()).toBe(longs.size());
        const remaining: number[] = [];
        halves.forEach((hi, lo, value) => {
            expect(lo & 1).toBe(0);
            expect(longs.get(hi * 4294967296 + (lo >>> 0))).toBe(value);
            remaining.push(value);
        });
        expect(remaining.length).toBe(halves.size());
    });

    it('computeIfPresent, compute, merge, putIfAbsent and replace follow Long2ObjectHashMap', () => {
        const map = new LongHalves2ObjectHashMap<number>();
        expect(map.putIfAbsent(1, 2, 10)).toBeNull();
        expect(map.putIfAbsent(1, 2, 11)).toBe(10);
        expect(map.computeIfPresent(1, 2, (hi, lo, v) => v + hi + lo)).toBe(13);
        expect(map.computeIfPresent(9, 9, () => 1)).toBeNull();
        expect(map.compute(5, 6, (hi, lo, v) => (v ?? 0) + 1)).toBe(1);
        expect(map.merge(5, 6, 4, (a, b) => a + b)).toBe(5);
        expect(map.merge(5, 6, 4, () => null)).toBeNull();
        expect(map.containsKey(5, 6)).toBe(false);
        expect(map.replace(1, 2, 99)).toBe(13);
        expect(map.replace(7, 7, 99)).toBeNull();
        expect(map.replace(1, 2, 98, 1)).toBe(false);
        expect(map.replace(1, 2, 99, 1)).toBe(true);
        expect(map.getOrDefault(1, 2, -1)).toBe(1);
        expect(map.getOrDefault(3, 3, -1)).toBe(-1);
        expect(map.computeIfPresent(1, 2, () => null)).toBeNull();
        expect(map.isEmpty()).toBe(true);
        expect(() => map.put(1, 1, null)).toThrow();
    });

    it('does not allocate in get and in put over existing keys', async () => {
        const map = new LongHalves2ObjectHashMap<object>();
        const value = {};
        const KEYS = 64;
        for (let i = 0; i < KEYS; i++) {
            map.put(i * 7919, -i * 104729, value);
        }
        let sink = 0;

        await expectNoAllocation((n) => {
            let found = 0;
            for (let i = 0; i < n; i++) {
                const k = i & (KEYS - 1);
                if (null !== map.get(k * 7919, -k * 104729)) {
                    found++;
                }
                if (map.containsKey(k, k)) {
                    found++;
                }
            }
            sink = found;
        }, ITERATIONS);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const k = i & (KEYS - 1);
                map.put(k * 7919, -k * 104729, value);
            }
        }, ITERATIONS);
        expect(sink).toBeGreaterThan(0);
        expect(map.size()).toBe(KEYS);
    });
});

describe('LongHalves2LongHashMap', () => {
    const MISSING = -1;

    it('matches a Map<bigint> model over 10k seeded random mixed operations', () => {
        const random = mulberry32(6);
        const pool = keyPool(random, 400);
        const map = new LongHalves2LongHashMap(MISSING);
        const model = new Map<bigint, number>();

        for (let i = 0; i < 10_000; i++) {
            const [hi, lo] =
                random() < 0.8 ? pool[(random() * pool.length) | 0]! : [randomInt(random), randomInt(random)];
            const key = keyOf(hi, lo);
            const value = i + (random() < 0.2 ? 2 ** 50 : 0);
            switch ((random() * 5) | 0) {
                case 0:
                    expect(map.put(hi, lo, value)).toBe(model.get(key) ?? MISSING);
                    model.set(key, value);
                    break;
                case 1:
                    expect(map.get(hi, lo)).toBe(model.get(key) ?? MISSING);
                    break;
                case 2:
                    expect(map.remove(hi, lo)).toBe(model.get(key) ?? MISSING);
                    model.delete(key);
                    break;
                case 3:
                    expect(map.containsKey(hi, lo)).toBe(model.has(key));
                    break;
                default:
                    expect(map.computeIfAbsent(hi, lo, () => value)).toBe(model.get(key) ?? value);
                    if (!model.has(key)) {
                        model.set(key, value);
                    }
            }
            expect(map.size()).toBe(model.size);
        }

        const seen = new Map<bigint, number>();
        map.forEach((hi, lo, value) => seen.set(keyOf(hi, lo), value));
        expect(seen).toEqual(model);
    });

    it('keys that collide on the low half (and on the high half) stay distinct', () => {
        const map = new LongHalves2LongHashMap(MISSING);
        for (let i = 0; i < 200; i++) {
            map.put(i, 7, i);
            map.put(7, i, 1000 + i);
        }
        expect(map.size()).toBe(399);
        for (let i = 0; i < 200; i++) {
            expect(map.get(i, 7)).toBe(i === 7 ? 1007 : i);
            expect(map.get(7, i)).toBe(1000 + i);
        }
        for (let i = 0; i < 200; i += 2) {
            map.remove(i, 7);
        }
        for (let i = 0; i < 200; i++) {
            expect(map.containsKey(i, 7)).toBe(i % 2 === 1 || i === 7);
            expect(map.get(7, i)).toBe(1000 + i);
        }
    });

    it('resizes past the initial capacity and keeps every key', () => {
        const map = new LongHalves2LongHashMap(MISSING);
        expect(map.capacity()).toBe(8);
        const random = mulberry32(7);
        const keys: [number, number][] = [];
        for (let i = 0; i < 5000; i++) {
            const k: [number, number] = [randomInt(random), randomInt(random)];
            keys.push(k);
            map.put(k[0], k[1], i);
        }
        expect(map.capacity()).toBeGreaterThanOrEqual(8192);
        keys.forEach((k, i) => expect(map.get(k[0], k[1])).toBe(i));
        keys.slice(0, 4900).forEach((k) => map.remove(k[0], k[1]));
        map.compact();
        expect(map.capacity()).toBeLessThan(8192);
        keys.slice(4900).forEach((k, i) => expect(map.get(k[0], k[1])).toBe(4900 + i));
        expect(map.minValue()).toBe(4900);
        expect(map.maxValue()).toBe(4999);
    });

    it('holds (0, 0) and (-1, -1), and a value of 0, which differ from the missing value', () => {
        const map = new LongHalves2LongHashMap(MISSING);
        expect(map.get(0, 0)).toBe(MISSING);
        map.put(0, 0, 0);
        map.put(-1, -1, 5);
        expect(map.get(0, 0)).toBe(0);
        expect(map.containsKey(0, 0)).toBe(true);
        expect(map.get(-1, -1)).toBe(5);
        expect(map.get(4294967295, 4294967295)).toBe(5);
        expect(map.get(0, -1)).toBe(MISSING);
        expect(map.remove(0, 0)).toBe(0);
        expect(map.containsKey(0, 0)).toBe(false);
        expect(map.remove(-1, -1, 4)).toBe(false);
        expect(map.remove(-1, -1, 5)).toBe(true);
        expect(map.isEmpty()).toBe(true);
        expect(() => map.put(1, 1, MISSING)).toThrow();
    });

    it('iterates in the order of Long2LongHashMap for a key in +/-(2^53 - 1), with removal during iteration', () => {
        const random = mulberry32(8);
        const halves = new LongHalves2LongHashMap(MISSING);
        const longs = new Long2LongHashMap(MISSING);
        for (let i = 0; i < 2000; i++) {
            const hi = (randomInt(random) >> 11) | 0;
            const lo = randomInt(random);
            const value = hi * 4294967296 + (lo >>> 0);
            if (random() < 0.3) {
                halves.remove(hi, lo);
                longs.remove(value);
            } else {
                halves.put(hi, lo, i);
                longs.put(value, i);
            }
        }
        expect(halves.size()).toBe(longs.size());
        expect(halves.capacity()).toBe(longs.capacity());

        const orderHalves: number[] = [];
        const keyIterator = halves.keySet().iterator();
        while (keyIterator.hasNext()) {
            keyIterator.nextKey();
            orderHalves.push(keyIterator.getKeyHigh() * 4294967296 + (keyIterator.getKeyLow() >>> 0));
        }
        const orderLongs: number[] = [];
        const longIterator = longs.keySet().iterator();
        while (longIterator.hasNext()) {
            orderLongs.push(longIterator.nextValue());
        }
        expect(orderHalves).toEqual(orderLongs);

        const valuesHalves: number[] = [];
        const valueIterator = halves.values().iterator();
        while (valueIterator.hasNext()) {
            valuesHalves.push(valueIterator.nextValue());
        }
        const valuesLongs: number[] = [];
        const longValueIterator = longs.values().iterator();
        while (longValueIterator.hasNext()) {
            valuesLongs.push(longValueIterator.nextValue());
        }
        expect(valuesHalves).toEqual(valuesLongs);

        expect(halves.entrySet().removeIfLongHalves((hi, lo, v) => v % 3 === 0)).toBe(true);
        longs.entrySet().removeIfLong((k, v) => v % 3 === 0);
        expect(halves.size()).toBe(longs.size());
        halves.forEach((hi, lo, v) => {
            expect(v % 3).not.toBe(0);
            expect(longs.get(hi * 4294967296 + (lo >>> 0))).toBe(v);
        });
    });

    it('computeIfPresent, compute, merge, putIfAbsent and replace follow Long2LongHashMap', () => {
        const map = new LongHalves2LongHashMap(MISSING);
        expect(map.putIfAbsent(1, 2, 10)).toBe(MISSING);
        expect(map.putIfAbsent(1, 2, 11)).toBe(10);
        expect(map.computeIfPresent(1, 2, (hi, lo, v) => v + hi + lo)).toBe(13);
        expect(map.computeIfPresent(9, 9, () => 1)).toBe(MISSING);
        expect(map.compute(5, 6, (hi, lo, v) => (v === MISSING ? 0 : v) + 1)).toBe(1);
        expect(map.merge(5, 6, 4, (a, b) => a + b)).toBe(5);
        expect(map.merge(5, 6, 4, () => MISSING)).toBe(MISSING);
        expect(map.containsKey(5, 6)).toBe(false);
        expect(map.replace(1, 2, 99)).toBe(13);
        expect(map.replace(7, 7, 99)).toBe(MISSING);
        expect(map.replace(1, 2, 98, 1)).toBe(false);
        expect(map.replace(1, 2, 99, 1)).toBe(true);
        expect(map.getOrDefault(1, 2, -5)).toBe(1);
        expect(map.getOrDefault(3, 3, -5)).toBe(-5);
        expect(map.computeIfPresent(1, 2, () => MISSING)).toBe(MISSING);
        expect(map.isEmpty()).toBe(true);
        expect(() => map.put(1, 1, 2 ** 53)).toThrow(RangeError);
    });

    it('does not allocate in get and in put over existing keys', async () => {
        const map = new LongHalves2LongHashMap(MISSING);
        const KEYS = 64;
        for (let i = 0; i < KEYS; i++) {
            map.put(i * 7919, -i * 104729, i);
        }
        let sink = 0;

        await expectNoAllocation((n) => {
            let found = 0;
            for (let i = 0; i < n; i++) {
                const k = i & (KEYS - 1);
                found += map.get(k * 7919, -k * 104729) & 1;
                if (map.containsKey(k, k)) {
                    found++;
                }
            }
            sink = found;
        }, ITERATIONS);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const k = i & (KEYS - 1);
                map.put(k * 7919, -k * 104729, k);
            }
        }, ITERATIONS);
        expect(sink).toBeGreaterThan(0);
        expect(map.size()).toBe(KEYS);
    });
});
