// Not in Agrona: tests of what the port adds or changes in the collections: the long hash over two int32 words, the
// number keys of the Long2* maps, the hashCode / equals protocol of the Object2ObjectHashMap, and a seeded model check
// of every map against a JavaScript Map.
import { describe, expect, it } from 'vitest';
import { ArrayListUtil } from '../../../src/agrona/collections/ArrayListUtil.js';
import { ArrayUtil } from '../../../src/agrona/collections/ArrayUtil.js';
import { CollectionUtil } from '../../../src/agrona/collections/CollectionUtil.js';
import { Hashing } from '../../../src/agrona/collections/Hashing.js';
import { Int2NullableObjectHashMap } from '../../../src/agrona/collections/Int2NullableObjectHashMap.js';
import { Int2ObjectHashMap } from '../../../src/agrona/collections/Int2ObjectHashMap.js';
import { Long2LongHashMap } from '../../../src/agrona/collections/Long2LongHashMap.js';
import { Long2ObjectHashMap } from '../../../src/agrona/collections/Long2ObjectHashMap.js';
import { Object2ObjectHashMap } from '../../../src/agrona/collections/Object2ObjectHashMap.js';
import {
    ArrayIndexOutOfBoundsException,
    IllegalArgumentException,
    IndexOutOfBoundsException,
    IllegalStateException,
    Long,
    LongOverflowError,
    NullPointerException,
} from '../../../src/agrona/jdk.js';
import {
    floatToString,
    hashCodeOf,
    longHashCode,
    NoSuchElementException,
    objectsEquals,
    stringHashCode,
} from '../../../src/agrona/jdkUtil.js';
import { assertThrows } from '../../support/Assertions.js';
import { randomJavaLong } from '../../support/Random.js';

/** `Hashing.hash(long)` of Java, over `bigint`s. */
function referenceHashLong(value: bigint): number {
    let x = BigInt.asUintN(64, value);
    x = BigInt.asUintN(64, (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n);
    x = BigInt.asUintN(64, (x ^ (x >> 27n)) * 0x94d049bb133111ebn);
    x = x ^ (x >> 31n);
    return Number(BigInt.asIntN(32, x)) ^ Number(BigInt.asIntN(32, x >> 32n));
}

/** `Hashing.hash(int)` of Java, over `bigint`s. */
function referenceHashInt(value: number): number {
    let x = BigInt.asUintN(32, BigInt(value));
    x = BigInt.asUintN(32, ((x >> 16n) ^ x) * 0x119de1f3n);
    x = BigInt.asUintN(32, ((x >> 16n) ^ x) * 0x119de1f3n);
    x = (x >> 16n) ^ x;
    return Number(BigInt.asIntN(32, x));
}

/** mulberry32, a seeded generator. */
function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Hashing extra', () => {
    it('hashLongMatchesTheBigIntReferenceForTheEdgesOfARange', () => {
        const edges = [
            0n,
            1n,
            -1n,
            2n,
            -2n,
            0x7fffffffn,
            0x80000000n,
            0xffffffffn,
            0x100000000n,
            -0x80000000n,
            -0x80000001n,
            -0x100000000n,
            BigInt(Long.MAX_VALUE),
            BigInt(Long.MIN_VALUE),
            BigInt(Long.MAX_VALUE) - 1n,
            BigInt(Long.MIN_VALUE) + 1n,
            1n << 52n,
            -(1n << 52n),
        ];
        for (const e of edges) {
            expect(Hashing.hashLong(Number(e)), String(e)).toBe(referenceHashLong(e));
        }
    });

    it('hashLongMatchesTheBigIntReferenceForRandomLongs', () => {
        const next = random(12345);
        for (let i = 0; i < 200_000; i++) {
            const bits = Math.floor(next() * 53);
            const magnitude = BigInt(Math.floor(next() * 2 ** Math.min(bits, 52))) + (bits === 53 ? 1n << 52n : 0n);
            const v = next() < 0.5 ? -magnitude : magnitude;
            expect(Hashing.hashLong(Number(v))).toBe(referenceHashLong(v));
        }
    });

    it('hashLongMatchesTheBigIntReferenceForTheLongsInTheSafeRange', () => {
        for (let i = 0; i < 20_000; i++) {
            const v = randomJavaLong(i);
            if (v >= -BigInt(Long.MAX_VALUE) && v <= BigInt(Long.MAX_VALUE)) {
                expect(Hashing.hashLong(Number(v))).toBe(referenceHashLong(v));
            }
        }
    });

    it('hashMatchesTheBigIntReferenceForInts', () => {
        const next = random(99);
        const values = [0, 1, -1, 2, 7, 0x7fffffff, -0x80000000, 0x12345678];
        for (let i = 0; i < 100_000; i++) {
            values.push((next() * 4294967296) | 0);
        }
        for (const v of values) {
            expect(Hashing.hash(v), String(v)).toBe(referenceHashInt(v));
        }
    });

    it('hashWithAMaskIsTheMaskedHash', () => {
        expect(Hashing.hash(12345, 63)).toBe(Hashing.hash(12345) & 63);
        expect(Hashing.hashLong(2 ** 40 + 5, 63)).toBe(Hashing.hashLong(2 ** 40 + 5) & 63);
        expect(Hashing.hashObject('abc', 15)).toBe(Hashing.hash(stringHashCode('abc')) & 15);
    });

    it('evenHashIsAlwaysEven', () => {
        for (let i = -1000; i < 1000; i++) {
            expect(Hashing.evenHash(i, 63) & 1).toBe(0);
            expect(Hashing.evenHashLong(i * 2 ** 33, 63) & 1).toBe(0);
        }
    });

    it('compoundKeyIsThePartsAsOneLong', () => {
        expect(Hashing.compoundKey(0, 7)).toBe(7);
        expect(Hashing.compoundKey(1, 0)).toBe(4294967296);
        expect(Hashing.compoundKey(1, -1)).toBe(8589934591);
        expect(Hashing.compoundKey(-1, 0)).toBe(-4294967296);
        expect(Hashing.compoundKey(-1, -1)).toBe(-1);
        expect(Hashing.compoundKey(0x1fffff, -1)).toBe(Long.MAX_VALUE);
    });

    it('compoundKeyOutsideTheSafeRangeThrowsLongOverflowErrorWithTheExactLong', () => {
        const error = assertThrows(LongOverflowError, () => Hashing.compoundKey(0x200000, 0));
        expect(error.value).toBe(0x200000n << 32n);
        const negative = assertThrows(LongOverflowError, () => Hashing.compoundKey(-0x80000000, 5));
        expect(negative.value).toBe(-(1n << 63n) + 5n);
    });
});

describe('jdkUtil extra', () => {
    it('hashCodeOfIsJavasForStringsNumbersBooleansAndBigInts', () => {
        expect(hashCodeOf('hello')).toBe(99162322);
        expect(hashCodeOf('')).toBe(0);
        expect(hashCodeOf('你好')).toBe(652829);
        expect(hashCodeOf(42)).toBe(42);
        expect(hashCodeOf(-7)).toBe(-7);
        expect(hashCodeOf(true)).toBe(1231);
        expect(hashCodeOf(false)).toBe(1237);
        expect(hashCodeOf(null)).toBe(0);
        expect(hashCodeOf(1.5)).toBe(1073217536);
        expect(hashCodeOf(-1n)).toBe(0);
        expect(hashCodeOf(0x100000001n)).toBe(0);
        expect(hashCodeOf(0x100000002n)).toBe(3);
        expect(longHashCode(0x100000002)).toBe(3);
        expect(longHashCode(-1)).toBe(0);
    });

    it('hashCodeOfAnObjectIsItsHashCodeOrAStableIdentityHash', () => {
        const withHashCode = { hashCode: () => 17 };
        const plain = {};
        const other = {};
        expect(hashCodeOf(withHashCode)).toBe(17);
        expect(hashCodeOf(plain)).toBe(hashCodeOf(plain));
        expect(hashCodeOf(plain)).not.toBe(hashCodeOf(other));
    });

    it('objectsEqualsUsesEqualsAndIdentity', () => {
        const a = { equals: (o: unknown) => o === 'x' };
        expect(objectsEquals(a, a)).toBe(true);
        expect(objectsEquals(a, 'x')).toBe(true);
        expect(objectsEquals(a, 'y')).toBe(false);
        expect(objectsEquals(null, null)).toBe(true);
        expect(objectsEquals(null, a)).toBe(false);
        expect(objectsEquals('a', 'a')).toBe(true);
        expect(objectsEquals(1, 2)).toBe(false);
    });

    it('floatToStringIsJavasFloatToString', () => {
        expect(floatToString(Math.fround(0.1))).toBe('0.1');
        expect(floatToString(Math.fround(0.05))).toBe('0.05');
        expect(floatToString(Math.fround(0.95))).toBe('0.95');
        expect(floatToString(1)).toBe('1.0');
        expect(floatToString(-2.5)).toBe('-2.5');
        expect(floatToString(0)).toBe('0.0');
        expect(floatToString(1e7)).toBe('1.0E7');
        expect(floatToString(Math.fround(1.5e-5))).toBe('1.5E-5');
        expect(floatToString(Number.NaN)).toBe('NaN');
    });
});

describe('CollectionUtil extra', () => {
    it('validateLoadFactorRejectsOutsideZeroPointOneToZeroPointNine', () => {
        CollectionUtil.validateLoadFactor(Math.fround(0.1));
        CollectionUtil.validateLoadFactor(Math.fround(0.9));
        CollectionUtil.validateLoadFactor(Hashing.DEFAULT_LOAD_FACTOR);
        const error = assertThrows(IllegalArgumentException, () => CollectionUtil.validateLoadFactor(0.05));
        expect(error.message).toBe('load factor must be in the range of 0.1 to 0.9: 0.05');
        expect(() => CollectionUtil.validateLoadFactor(1)).toThrow('0.9: 1.0');
    });

    it('validatePositivePowerOfTwo', () => {
        CollectionUtil.validatePositivePowerOfTwo(64);
        const error = assertThrows(IllegalArgumentException, () => CollectionUtil.validatePositivePowerOfTwo(63));
        expect(error.message).toBe('value must be a positive power of two: 63');
    });

    it('getOrDefaultPutsTheSuppliedValueOnlyWhenAbsent', () => {
        const map = new Int2ObjectHashMap<string>();
        expect(CollectionUtil.getOrDefault(map, 1, (k) => 'v' + k)).toBe('v1');
        expect(CollectionUtil.getOrDefault(map, 1, () => 'other')).toBe('v1');
        expect(map.size()).toBe(1);
    });

    it('sumAndRemoveIf', () => {
        const list = [1, 2, 3, 4, 5, 6];
        expect(CollectionUtil.sum(list, (v) => v * 2)).toBe(42);
        expect(CollectionUtil.removeIf(list, (v) => v % 2 === 0)).toBe(3);
        expect(list).toEqual([1, 3, 5]);
    });

    it('mapsRejectABadLoadFactor', () => {
        expect(() => new Int2ObjectHashMap<string>(8, 0.95)).toThrow(IllegalArgumentException);
        expect(() => new Object2ObjectHashMap<string, string>(8, 0.05)).toThrow(IllegalArgumentException);
        expect(() => new Long2LongHashMap(8, 1, -1)).toThrow(IllegalArgumentException);
    });
});

describe('ArrayUtil and ArrayListUtil extra', () => {
    it('addAndEnsureCapacity', () => {
        const a = [1, 2];
        expect(ArrayUtil.add(a, 3)).toEqual([1, 2, 3]);
        expect(a).toEqual([1, 2]);
        expect(ArrayUtil.ensureCapacity(a, 2)).toBe(a);
        const grown = ArrayUtil.ensureCapacity<number | null>(a, 4);
        expect(grown).toEqual([1, 2, null, null]);
        expect(ArrayUtil.newArray(a, 3)).toHaveLength(3);
    });

    it('removeAtOutsideTheArrayThrowsAsJavasArrayStoreDoes', () => {
        expect(ArrayUtil.removeAt([1, 2], ArrayUtil.UNKNOWN_INDEX)).toEqual([1, 2]);
        expect(() => ArrayUtil.removeAt([1, 2], 2)).toThrow(ArrayIndexOutOfBoundsException);
    });

    it('theEmptyArraysAreEmpty', () => {
        expect(ArrayUtil.EMPTY_BYTE_ARRAY).toHaveLength(0);
        expect(ArrayUtil.EMPTY_LONG_ARRAY).toHaveLength(0);
        expect(ArrayUtil.EMPTY_OBJECT_ARRAY).toHaveLength(0);
        expect(ArrayUtil.MAX_CAPACITY).toBe(2147483639);
    });

    it('fastUnorderedRemoveMovesTheLastElementIntoTheSlot', () => {
        const list = ['a', 'b', 'c', 'd'];
        ArrayListUtil.fastUnorderedRemove(list, 1);
        expect(list).toEqual(['a', 'd', 'c']);
        ArrayListUtil.fastUnorderedRemove(list, 2);
        expect(list).toEqual(['a', 'd']);
        ArrayListUtil.fastUnorderedRemove(list, 0, 1);
        expect(list).toEqual(['d']);
    });

    it('fastUnorderedRemoveElementRemovesByIdentity', () => {
        const a = {};
        const b = {};
        const c = {};
        const list = [a, b, c];
        expect(ArrayListUtil.fastUnorderedRemoveElement(list, a)).toBe(true);
        expect(list).toEqual([c, b]);
        expect(list[0]).toBe(c);
        expect(ArrayListUtil.fastUnorderedRemoveElement(list, a)).toBe(false);
        expect(ArrayListUtil.fastUnorderedRemoveElement([1, 2, 3], 3)).toBe(true);
    });

    it('fastUnorderedRemoveOutOfBoundsThrowsIndexOutOfBoundsException', () => {
        expect(() => ArrayListUtil.fastUnorderedRemove([1, 2], 2)).toThrow(IndexOutOfBoundsException);
        expect(() => ArrayListUtil.fastUnorderedRemove([1, 2], -1)).toThrow(IndexOutOfBoundsException);
        expect(() => ArrayListUtil.fastUnorderedRemove([], 0)).toThrow(IndexOutOfBoundsException);
        expect(() => ArrayListUtil.fastUnorderedRemove([1, 2], 0, 5)).toThrow(IndexOutOfBoundsException);
    });
});

describe('Long2ObjectHashMap extra', () => {
    it('storesKeysAboveTwoToThe32AndNegativeKeys', () => {
        const map = new Long2ObjectHashMap<string>();
        const keys = [
            0,
            1,
            -1,
            2 ** 31,
            -(2 ** 31) - 1,
            2 ** 32,
            2 ** 40 + 3,
            -(2 ** 40) - 3,
            Long.MAX_VALUE,
            Long.MIN_VALUE,
        ];
        keys.forEach((k, i) => map.put(k, 'v' + i));
        expect(map.size()).toBe(keys.length);
        keys.forEach((k, i) => expect(map.get(k), String(k)).toBe('v' + i));
        expect(map.get(2 ** 40 + 4)).toBeNull();
        expect(map.containsKey(Long.MIN_VALUE)).toBe(true);
        for (const k of keys) {
            expect(map.remove(k)).not.toBeNull();
        }
        expect(map.isEmpty()).toBe(true);
    });

    it('aKeyThatIsNotASafeIntegerIsRejectedByEveryMethodThatInserts', () => {
        const map = new Long2ObjectHashMap<string>();
        for (const key of [2 ** 53, -(2 ** 53), 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => map.put(key, 'a')).toThrow(RangeError);
            expect(() => map.putIfAbsent(key, 'a')).toThrow(RangeError);
            expect(() => map.computeIfAbsent(key, () => 'a')).toThrow(RangeError);
            expect(() => map.compute(key, () => 'a')).toThrow(RangeError);
            expect(() => map.merge(key, 'a', () => 'b')).toThrow(RangeError);
        }
        expect(map.size()).toBe(0);
    });

    it('theNestedViewsAndIteratorsWorkWithLongKeys', () => {
        const map = new Long2ObjectHashMap<string>();
        map.put(2 ** 35, 'a');
        map.put(-(2 ** 35), 'b');
        map.put(3, 'c');

        const keys: number[] = [];
        map.forEachLong((k) => keys.push(k));
        expect(keys.sort((x, y) => x - y)).toEqual([-(2 ** 35), 3, 2 ** 35]);

        expect(map.keySet().removeIfLong((k) => k < 0)).toBe(true);
        expect(map.entrySet().removeIfLong((k, v) => v === 'c' && k === 3)).toBe(true);
        expect(map.toString()).toBe('{' + 2 ** 35 + '=a}');
        expect(new Long2ObjectHashMap<string>(map).equals(map)).toBe(true);
        expect(map.hashCode()).toBe((longHashCode(2 ** 35) ^ stringHashCode('a')) | 0);
    });
});

describe('Long2LongHashMap extra', () => {
    it('getReturnsTheMissingValueAndKeysAndValuesAreLongs', () => {
        const map = new Long2LongHashMap(-1);
        expect(map.get(5)).toBe(-1);
        expect(map.put(2 ** 40, 2 ** 45)).toBe(-1);
        expect(map.put(2 ** 40, -(2 ** 45))).toBe(2 ** 45);
        expect(map.get(2 ** 40)).toBe(-(2 ** 45));
        expect(map.containsKey(2 ** 40)).toBe(true);
        expect(map.containsValue(-(2 ** 45))).toBe(true);
        expect(map.containsValue(-1)).toBe(false);
        expect(map.putIfAbsent(2 ** 40, 9)).toBe(-(2 ** 45));
        expect(map.putIfAbsent(7, 9)).toBe(-1);
        expect(map.getOrDefault(8, 100)).toBe(100);
        expect(map.minValue()).toBe(-(2 ** 45));
        expect(map.maxValue()).toBe(9);
        expect(map.remove(2 ** 40)).toBe(-(2 ** 45));
        expect(map.remove(7, 8)).toBe(false);
        expect(map.remove(7, 9)).toBe(true);
        expect(map.isEmpty()).toBe(true);
        expect(map.minValue()).toBe(-1);
        expect(map.maxValue()).toBe(-1);
    });

    it('theMissingValueCannotBePut', () => {
        const map = new Long2LongHashMap(-1);
        expect(() => map.put(1, -1)).toThrow(IllegalArgumentException);
        expect(() => map.putIfAbsent(1, -1)).toThrow(IllegalArgumentException);
        expect(() => map.merge(1, -1, (a, b) => a + b)).toThrow(IllegalArgumentException);
        expect(() => map.replace(1, -1)).toThrow(IllegalArgumentException);
        expect(() => map.replace(1, 2, -1)).toThrow(IllegalArgumentException);
        map.put(1, 5);
        expect(() => map.replaceAllLong(() => -1)).toThrow(IllegalArgumentException);
        expect(() => map.entrySet().iterator().setValue(3)).toThrow(IllegalStateException);
    });

    it('aKeyOrValueThatIsNotASafeIntegerIsRejected', () => {
        const map = new Long2LongHashMap(-1);
        expect(() => map.put(2 ** 53, 1)).toThrow(RangeError);
        expect(() => map.put(1, 2 ** 53)).toThrow(RangeError);
        expect(() => map.putIfAbsent(1, -(2 ** 53))).toThrow(RangeError);
        expect(() => new Long2LongHashMap(2 ** 53)).toThrow(RangeError);
        expect(map.size()).toBe(0);
    });

    it('computeMergeAndReplaceAll', () => {
        const map = new Long2LongHashMap(0);
        expect(map.computeIfAbsent(5, (k) => k * 2)).toBe(10);
        expect(map.computeIfAbsent(5, () => 99)).toBe(10);
        expect(map.computeIfPresent(5, (k, v) => k + v)).toBe(15);
        expect(map.computeIfPresent(6, () => 1)).toBe(0);
        expect(map.compute(6, (k, v) => k + v)).toBe(6);
        expect(map.compute(6, () => 0)).toBe(0);
        expect(map.containsKey(6)).toBe(false);
        expect(map.merge(5, 1, (o, n) => o + n)).toBe(16);
        expect(map.merge(5, 1, () => 0)).toBe(0);
        expect(map.size()).toBe(0);
        map.put(1, 1);
        map.put(2, 2);
        map.replaceAllLong((k, v) => k * 10 + v);
        expect(map.get(1)).toBe(11);
        expect(map.get(2)).toBe(22);
        expect(map.toString()).toMatch(/^\{(1=11, 2=22|2=22, 1=11)\}$/);
    });

    it('copyConstructEqualsAndHashCode', () => {
        const map = new Long2LongHashMap(-1);
        for (let i = 0; i < 100; i++) {
            map.put(i * 2 ** 20, i + 1);
        }
        const copy = new Long2LongHashMap(map);
        expect(copy.equals(map)).toBe(true);
        expect(copy.hashCode()).toBe(map.hashCode());
        copy.put(-5, 7);
        expect(copy.equals(map)).toBe(false);
        const other = new Long2LongHashMap(-1);
        other.putAll(map);
        expect(other.equals(map)).toBe(true);
    });

    it('theIteratorsThrowWhenExhausted', () => {
        const map = new Long2LongHashMap(-1);
        map.put(1, 2);
        const it = map.keySet().iterator();
        expect(it.nextValue()).toBe(1);
        expect(() => it.nextValue()).toThrow(NoSuchElementException);
        it.remove();
        expect(() => it.remove()).toThrow(IllegalStateException);
        expect(map.isEmpty()).toBe(true);
    });
});

describe('Object2ObjectHashMap extra', () => {
    class Key {
        public readonly id: number;
        public readonly hash: number;
        public constructor(id: number, hash: number) {
            this.id = id;
            this.hash = hash;
        }

        public equals(o: unknown): boolean {
            return o instanceof Key && o.id === this.id;
        }

        public hashCode(): number {
            return this.hash;
        }
    }

    it('keysAreComparedWithEqualsAndHashedWithHashCode', () => {
        const map = new Object2ObjectHashMap<Key, string>();
        // every key collides
        for (let i = 0; i < 50; i++) {
            map.put(new Key(i, 7), 'v' + i);
        }
        expect(map.size()).toBe(50);
        for (let i = 0; i < 50; i++) {
            expect(map.get(new Key(i, 7))).toBe('v' + i);
        }
        for (let i = 0; i < 50; i += 2) {
            expect(map.remove(new Key(i, 7))).toBe('v' + i);
        }
        for (let i = 0; i < 50; i++) {
            expect(map.containsKey(new Key(i, 7))).toBe(i % 2 === 1);
        }
    });

    it('stringNumberAndBooleanKeysAreHashedAsJavaDoes', () => {
        const map = new Object2ObjectHashMap<unknown, number>();
        map.put('a', 1);
        map.put(1, 2);
        map.put(true, 3);
        map.put(1n, 4);
        map.put(2.5, 5);
        expect([map.get('a'), map.get(1), map.get(true), map.get(1n), map.get(2.5)]).toEqual([1, 2, 3, 4, 5]);
        expect(map.get('b')).toBeNull();
    });

    it('aNullKeyThrowsNullPointerException', () => {
        const map = new Object2ObjectHashMap<string | null, string>();
        expect(() => map.put(null, 'a')).toThrow(NullPointerException);
        expect(() => map.get(null)).toThrow(NullPointerException);
        expect(() => map.remove(null)).toThrow(NullPointerException);
        expect(() => map.put('a', null)).toThrow(NullPointerException);
    });

    it('entriesAreCopiesWhenTheMapDoesNotAvoidAllocation', () => {
        const map = new Object2ObjectHashMap<string, string>(8, Hashing.DEFAULT_LOAD_FACTOR, false);
        map.put('a', 'x');
        map.put('b', 'y');
        const entries = [...map.entrySet()];
        expect(entries.map((e) => e.getKey() + e.getValue()).sort()).toEqual(['ax', 'by']);
        expect(entries[0]).not.toBe(entries[1]);
        const first = entries[0]!;
        first.setValue('z');
        expect(map.get(first.getKey())).toBe('z');
    });

    it('toStringEqualsAndHashCode', () => {
        const a = new Object2ObjectHashMap<string, string>();
        const b = new Object2ObjectHashMap<string, string>();
        expect(a.toString()).toBe('{}');
        for (const k of ['x', 'y', 'z']) {
            a.put(k, k + '!');
        }
        for (const k of ['z', 'y', 'x']) {
            b.put(k, k + '!');
        }
        expect(a.equals(b)).toBe(true);
        expect(a.hashCode()).toBe(b.hashCode());
        b.put('x', 'other');
        expect(a.equals(b)).toBe(false);
        expect(a.equals(null)).toBe(false);
    });
});

describe('Int2NullableObjectHashMap extra', () => {
    it('storesNullValues', () => {
        const map = new Int2NullableObjectHashMap<string>();
        expect(map.put(1, null)).toBeNull();
        expect(map.containsKey(1)).toBe(true);
        expect(map.get(1)).toBeNull();
        expect(map.size()).toBe(1);
        expect(map.put(1, 'a')).toBeNull();
        expect(map.toString()).toBe('{1=a}');
        map.put(2, null);
        expect(map.toString()).toMatch(/^\{(1=a, 2=null|2=null, 1=a)\}$/);
        expect(map.remove(2)).toBeNull();
        expect(map.size()).toBe(1);
    });
});

describe('T4 review fixes', () => {
    it('int2ObjectHashMapNormalisesAKeyThatIsNotAnInt32LikeJavasIntCastRegression', () => {
        for (const map of [new Int2ObjectHashMap<string>(), new Int2NullableObjectHashMap<string>()]) {
            expect(map.put(2 ** 31, 'a')).toBeNull();
            expect(map.put(2 ** 31, 'b')).toBe('a');
            expect(map.size()).toBe(1);
            expect(map.get(2 ** 31)).toBe('b');
            expect(map.get(-(2 ** 31))).toBe('b'); // (int) 2^31 is Integer.MIN_VALUE
            expect(map.containsKey(2 ** 31)).toBe(true);
            expect(map.containsKey(-(2 ** 31))).toBe(true);
            expect(map.putIfAbsent(2 ** 32 + 5, 'c')).toBeNull();
            expect(map.putIfAbsent(5, 'd')).toBe('c');
            expect(map.computeIfAbsent(2 ** 32 + 5, () => 'x')).toBe('c');
            expect(map.compute(5, (_k, v) => v + '!')).toBe('c!');
            expect(map.merge(2 ** 32 + 5, '?', (o, n) => o + n)).toBe('c!?');
            expect(map.replace(5, 'e')).toBe('c!?');
            expect(map.size()).toBe(2);
            expect(map.remove(2 ** 31, 'zzz')).toBe(false);
            expect(map.remove(2 ** 31)).toBe('b');
            expect(map.remove(-(2 ** 31))).toBeNull();
            expect(map.remove(2 ** 32 + 5, 'e')).toBe(true);
            expect(map.size()).toBe(0);
        }
    });

    it('aMappingFunctionResultOfUndefinedIsNullNotAnEntryRegression', () => {
        const undef = (): never => undefined as never;
        const maps: [
            {
                computeIfAbsent(k: never, f: () => never): unknown;
                compute(k: never, f: () => never): unknown;
                computeIfPresent(k: never, f: () => never): unknown;
                put(k: never, v: never): unknown;
                size(): number;
                get(k: never): unknown;
            },
            unknown,
        ][] = [
            [new Int2ObjectHashMap<string>() as never, 1],
            [new Long2ObjectHashMap<string>() as never, 1],
            [new Object2ObjectHashMap<string, string>() as never, 'a'],
        ];
        for (const [map, key] of maps) {
            const k = key as never;
            expect(map.computeIfAbsent(k, undef)).toBeNull();
            expect(map.size()).toBe(0);
            expect(map.compute(k, undef)).toBeNull();
            expect(map.size()).toBe(0);
            expect(map.computeIfPresent(k, undef)).toBeNull();
            expect(map.size()).toBe(0);

            map.put(k, 'v' as never);
            expect(map.computeIfPresent(k, undef)).toBeNull();
            expect(map.size()).toBe(0);
            expect(map.get(k)).toBeNull();

            map.put(k, 'v' as never);
            expect(map.compute(k, undef)).toBeNull();
            expect(map.size()).toBe(0);
            expect(map.get(k)).toBeNull();
        }

        for (const map of [new Int2ObjectHashMap<string>(), new Long2ObjectHashMap<string>()]) {
            map.put(1, 'v');
            expect(map.merge(1, 'w', undef)).toBeNull();
            expect(map.size()).toBe(0);

            map.put(1, 'v');
            expect(() => map.replaceAll(undef)).toThrow(NullPointerException);
        }
    });

    it('longMapsCheckTheirFunctionsForNullBeforeTheKeyRegression', () => {
        const nothing = null as never;
        const objects = new Long2ObjectHashMap<string>();
        expect(() => objects.computeIfAbsent(2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => objects.compute(2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => objects.merge(2 ** 53, 'a', nothing)).toThrow(NullPointerException);
        expect(() => objects.merge(2 ** 53, null, () => 'b')).toThrow(NullPointerException);
        expect(() => objects.put(2 ** 53, null)).toThrow(NullPointerException);
        expect(() => objects.putIfAbsent(2 ** 53, null)).toThrow(NullPointerException);
        expect(() => objects.computeIfAbsent(2 ** 53, () => 'a')).toThrow(RangeError);

        const longs = new Long2LongHashMap(-1);
        expect(() => longs.computeIfAbsent(2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => longs.computeIfPresent(2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => longs.compute(2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => longs.merge(2 ** 53, 2 ** 53, nothing)).toThrow(NullPointerException);
        expect(() => longs.merge(2 ** 53, 1, () => 1)).toThrow(RangeError);
    });

    it('longKeysAndValuesAreStoredAsPositiveZeroRegression', () => {
        const objects = new Long2ObjectHashMap<string>();
        objects.put(-0, 'a');
        expect(objects.size()).toBe(1);
        expect(objects.putIfAbsent(0, 'b')).toBe('a');
        expect(Object.is(objects.keySet().iterator().nextLong(), 0)).toBe(true);
        expect(objects.remove(0)).toBe('a');
        objects.computeIfAbsent(-0, () => 'c');
        expect(Object.is(objects.keySet().iterator().nextLong(), 0)).toBe(true);
        objects.clear();
        objects.compute(-0, () => 'd');
        expect(Object.is(objects.keySet().iterator().nextLong(), 0)).toBe(true);
        objects.clear();
        objects.merge(-0, 'e', () => 'f');
        expect(Object.is(objects.keySet().iterator().nextLong(), 0)).toBe(true);

        const longs = new Long2LongHashMap(-1);
        longs.put(-0, -0);
        expect(Object.is(longs.get(0), 0)).toBe(true);
        expect(Object.is(longs.keySet().iterator().nextValue(), 0)).toBe(true);
        expect(Object.is(longs.values().iterator().nextValue(), 0)).toBe(true);
        longs.clear();
        longs.putIfAbsent(-0, -0);
        expect(Object.is(longs.values().iterator().nextValue(), 0)).toBe(true);
        longs.clear();
        longs.computeIfAbsent(-0, () => -0);
        expect(Object.is(longs.keySet().iterator().nextValue(), 0)).toBe(true);
        expect(Object.is(longs.values().iterator().nextValue(), 0)).toBe(true);
        longs.clear();
        longs.compute(-0, () => -0);
        expect(Object.is(longs.values().iterator().nextValue(), 0)).toBe(true);
        longs.put(5, 1);
        longs.computeIfPresent(5, () => -0);
        longs.replace(5, -0);
        expect(longs.values().contains(0)).toBe(true);
        longs.replaceAll(() => -0);
        for (const v of longs.values()) {
            expect(Object.is(v, 0)).toBe(true);
        }
        longs.clear();
        longs.merge(-0, -0, () => -0);
        expect(Object.is(longs.keySet().iterator().nextValue(), 0)).toBe(true);
        expect(Object.is(new Long2LongHashMap(-0).missingValue(), 0)).toBe(true);
    });

    it('theKeySetAndTheValueCollectionOfALong2LongHashMapRemoveAndClearRegression', () => {
        const map = new Long2LongHashMap(-1);
        for (let i = 0; i < 50; i++) {
            map.put(i, i * 10);
        }

        expect(map.keySet().remove(3)).toBe(true);
        expect(map.keySet().remove(3)).toBe(false);
        expect(map.keySet().remove(1000)).toBe(false);
        expect(map.containsKey(3)).toBe(false);
        expect(map.values().remove(40)).toBe(true);
        expect(map.values().remove(40)).toBe(false);
        expect(map.containsKey(4)).toBe(false);
        expect(map.size()).toBe(48);
        for (let i = 0; i < 50; i++) {
            expect(map.get(i)).toBe(i === 3 || i === 4 ? -1 : i * 10);
        }

        for (let i = 0; i < 50; i += 2) {
            map.keySet().remove(i);
        }
        expect(map.size()).toBe(25 - 1);
        for (let i = 0; i < 50; i++) {
            expect(map.get(i)).toBe(i % 2 === 0 || i === 3 ? -1 : i * 10);
        }

        map.values().clear();
        expect(map.size()).toBe(0);
        expect(map.get(5)).toBe(-1);

        map.put(1, 1);
        map.put(2, 2);
        map.keySet().clear();
        expect(map.isEmpty()).toBe(true);
    });

    it('theValueCollectionsOfTheObjectMapsRemoveByIterator', () => {
        const ints = new Int2ObjectHashMap<string>();
        ints.put(1, 'a');
        ints.put(2, 'b');
        expect(ints.values().remove('a')).toBe(true);
        expect(ints.values().remove('a')).toBe(false);
        expect(ints.containsKey(1)).toBe(false);
        expect(ints.size()).toBe(1);

        const objects = new Object2ObjectHashMap<string, string>();
        objects.put('x', 'a');
        objects.put('y', 'b');
        expect(objects.keySet().remove('x')).toBe(true);
        expect(objects.values().remove('b')).toBe(true);
        expect(objects.isEmpty()).toBe(true);
    });

    it('explicitUndefinedIsNotAnOmittedArgumentOfRemoveAndReplaceRegression', () => {
        const ints = new Int2ObjectHashMap<string>();
        ints.put(1, 'a');
        expect(ints.remove(1, undefined as unknown as string)).toBe(false);
        expect(ints.get(1)).toBe('a');
        expect(() => ints.replace(1, 'a', undefined as unknown as string)).toThrow(NullPointerException);
        expect(ints.get(1)).toBe('a');

        const longs = new Long2ObjectHashMap<string>();
        longs.put(1, 'a');
        expect(longs.remove(1, undefined as unknown as string)).toBe(false);
        expect(longs.get(1)).toBe('a');
        expect(() => longs.replace(1, 'a', undefined as unknown as string)).toThrow(NullPointerException);
        expect(longs.get(1)).toBe('a');

        const primitive = new Long2LongHashMap(-1);
        primitive.put(1, 2);
        expect(primitive.remove(1, undefined as unknown as number)).toBe(false);
        expect(primitive.get(1)).toBe(2);
        expect(() => primitive.replace(1, 2, undefined as unknown as number)).toThrow(RangeError);
        expect(primitive.get(1)).toBe(2);

        // the omitted arguments still select the shorter overloads
        expect(ints.remove(1)).toBe('a');
        expect(longs.replace(1, 'b')).toBe('a');
        expect(primitive.replace(1, 3)).toBe(2);
    });
});

describe('model check', () => {
    // A small key space makes the chains long and the removals compact them.
    const OPERATIONS = 40_000;

    /** The pairs of an entry set, read while iterating: the iterator is the entry. */
    function pairs<K, V>(entries: Iterable<{ getKey(): K; getValue(): V }>): [K, V][] {
        const out: [K, V][] = [];
        for (const e of entries) {
            out.push([e.getKey(), e.getValue()]);
        }
        return out;
    }

    type Adaptor = {
        put(k: number, v: number): void;
        remove(k: number): void;
        has(k: number): boolean;
        get(k: number): number | null;
        size(): number;
        entries(): [number, number][];
        removeWhere(pred: (k: number, v: number) => boolean): void;
        compact(): void;
    };

    function run(newAdaptor: () => Adaptor, keyOf: (n: number) => number, seed: number): void {
        const next = random(seed);
        const adaptor = newAdaptor();
        const model = new Map<number, number>();
        for (let i = 0; i < OPERATIONS; i++) {
            const key = keyOf(Math.floor(next() * 300));
            const op = next();
            if (op < 0.45) {
                const v = 1 + Math.floor(next() * 1000);
                adaptor.put(key, v);
                model.set(key, v);
            } else if (op < 0.85) {
                adaptor.remove(key);
                model.delete(key);
            } else if (op < 0.88) {
                const bit = Math.floor(next() * 3);
                const pred = (k: number): boolean => Math.abs(k) % 3 === bit;
                adaptor.removeWhere((k) => pred(k));
                for (const k of [...model.keys()]) {
                    if (pred(k)) {
                        model.delete(k);
                    }
                }
            } else if (op < 0.89) {
                adaptor.compact();
            } else {
                expect(adaptor.get(key)).toBe(model.get(key) ?? null);
                expect(adaptor.has(key)).toBe(model.has(key));
            }
            if (i % 997 === 0) {
                expect(adaptor.size()).toBe(model.size);
                const entries = adaptor.entries().sort((x, y) => x[0] - y[0]);
                expect(entries).toEqual([...model.entries()].sort((x, y) => x[0] - y[0]));
            }
        }
        expect(adaptor.size()).toBe(model.size);
        const entries = adaptor.entries().sort((x, y) => x[0] - y[0]);
        expect(entries).toEqual([...model.entries()].sort((x, y) => x[0] - y[0]));
    }

    const intKey = (n: number): number => (n % 2 === 0 ? n : -n) * 8;
    const longKey = (n: number): number => (n % 2 === 0 ? n * 2 ** 33 : -n * 2 ** 33 + n);

    for (const seed of [1, 2, 3]) {
        it(`Int2ObjectHashMapAgreesWithAMap seed ${seed}`, () => {
            run(
                () => {
                    const map = new Int2ObjectHashMap<number>();
                    return {
                        put: (k, v) => void map.put(k, v),
                        remove: (k) => void map.remove(k),
                        has: (k) => map.containsKey(k),
                        get: (k) => map.get(k),
                        size: () => map.size(),
                        entries: () => pairs(map.entrySet()) as [number, number][],
                        removeWhere: (p) => void map.entrySet().removeIfInt((k, v) => p(k, v)),
                        compact: () => map.compact(),
                    };
                },
                intKey,
                seed,
            );
        });

        it(`Long2ObjectHashMapAgreesWithAMap seed ${seed}`, () => {
            run(
                () => {
                    const map = new Long2ObjectHashMap<number>();
                    return {
                        put: (k, v) => void map.put(k, v),
                        remove: (k) => void map.remove(k),
                        has: (k) => map.containsKey(k),
                        get: (k) => map.get(k),
                        size: () => map.size(),
                        entries: () => pairs(map.entrySet()) as [number, number][],
                        removeWhere: (p) => void map.entrySet().removeIfLong((k, v) => p(k, v)),
                        compact: () => map.compact(),
                    };
                },
                longKey,
                seed,
            );
        });

        it(`Long2LongHashMapAgreesWithAMap seed ${seed}`, () => {
            run(
                () => {
                    const map = new Long2LongHashMap(-1);
                    return {
                        put: (k, v) => void map.put(k, v),
                        remove: (k) => void map.remove(k),
                        has: (k) => map.containsKey(k),
                        get: (k) => {
                            const v = map.get(k);
                            return v === -1 ? null : v;
                        },
                        size: () => map.size(),
                        entries: () => pairs(map.entrySet()),
                        removeWhere: (p) => void map.entrySet().removeIfLong((k, v) => p(k, v)),
                        compact: () => map.compact(),
                    };
                },
                longKey,
                seed,
            );
        });

        it(`Object2ObjectHashMapAgreesWithAMap seed ${seed}`, () => {
            run(
                () => {
                    const map = new Object2ObjectHashMap<string, number>();
                    const toKey = (k: number): string => 'k' + k;
                    const fromKey = (s: string): number => Number(s.slice(1));
                    return {
                        put: (k, v) => void map.put(toKey(k), v),
                        remove: (k) => void map.remove(toKey(k)),
                        has: (k) => map.containsKey(toKey(k)),
                        get: (k) => map.get(toKey(k)),
                        size: () => map.size(),
                        entries: () => pairs(map.entrySet()).map(([k, v]) => [fromKey(k), v!] as [number, number]),
                        removeWhere: (p) => {
                            const it = map.entrySet().iterator();
                            for (let n = 0; it.hasNext(); n++) {
                                if (n > 100_000) throw new Error('iterator does not terminate');
                                it.next();
                                if (p(fromKey(it.getKey()), it.getValue()!)) {
                                    it.remove();
                                }
                            }
                        },
                        compact: () => map.compact(),
                    };
                },
                intKey,
                seed,
            );
        });
    }
});
