/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of org/agrona/collections/Hashing.java @ Agrona 2.6.1
import { LongOverflowError } from '../jdk.js';
import { hashCodeOf } from '../jdkUtil.js';

const TWO_POW_32 = 4294967296;

// The product of the last mul64 call, high word then low word. A JS module is single threaded, so this is scratch
// space, not shared state; it lets the 64-bit multiply return two words without allocating (an int32 array element is
// never boxed, where a module variable holding a value above 2^31 would be).
const product = new Int32Array(2);

/**
 * The low 64 bits of (ah:al) * (bh:bl), each operand as two 32-bit words (int32), in {@link product}.
 */
function mul64(ah: number, al: number, bh: number, bl: number): void {
    const a0 = al & 0xffff;
    const a1 = al >>> 16;
    const b0 = bl & 0xffff;
    const b1 = bl >>> 16;
    const p00 = a0 * b0;
    const mid = a0 * b1 + a1 * b0;
    const p11 = a1 * b1;
    const lowSum = p00 + (mid % 65536) * 65536;
    product[1] = lowSum;
    product[0] =
        p11 + Math.floor(mid / 65536) + Math.floor(lowSum / TWO_POW_32) + Math.imul(ah, bl) + Math.imul(al, bh);
}

/**
 * The body of `hash(long, int)` before the mask, on the two int32 words of the value.
 */
function hashHalves(high: number, low: number): number {
    let lo = low;
    let hi = high;

    // x = (x ^ (x >>> 30)) * 0xbf58476d1ce4e5b9L
    lo ^= (lo >>> 30) | (hi << 2);
    hi ^= hi >>> 30;
    mul64(hi, lo, 0xbf58476d | 0, 0x1ce4e5b9);

    // x = (x ^ (x >>> 27)) * 0x94d049bb133111ebL
    let mulHi = product[0]!;
    let mulLo = product[1]!;
    lo = mulLo ^ ((mulLo >>> 27) | (mulHi << 5));
    hi = mulHi ^ (mulHi >>> 27);
    mul64(hi, lo, 0x94d049bb | 0, 0x133111eb);

    // x = x ^ (x >>> 31); return (int)x ^ (int)(x >>> 32)
    mulHi = product[0]!;
    mulLo = product[1]!;
    const x = mulLo ^ ((mulLo >>> 31) | (mulHi << 1));
    const y = mulHi ^ (mulHi >>> 31);

    return x ^ y;
}

/**
 * Hashing functions for applying to integers.
 * <p>
 * Java overloads on `int` and `long` that a `number` cannot tell apart get the Java name with a `Long` suffix
 * (`hashLong`, `evenHashLong`); `hash(Object, int)` is `hashObject`. A `long` is a `number` in +/-(2^53 - 1) (spec D5).
 */
export class Hashing {
    /**
     * Default load factor to be used in open-addressing hashed data structures.
     */
    public static readonly DEFAULT_LOAD_FACTOR: number = Math.fround(0.65);

    private constructor() {}

    /**
     * Generate a hash for an int value, and apply a mask to get the remainder if there is one.
     *
     * @param value to be hashed.
     * @param mask  mask to be applied that must be a power of 2 - 1.
     * @returns the hashed value.
     */
    public static hash(value: number, mask?: number): number {
        let x = value | 0;

        x = Math.imul((x >>> 16) ^ x, 0x119de1f3);
        x = Math.imul((x >>> 16) ^ x, 0x119de1f3);
        x = (x >>> 16) ^ x;

        return undefined === mask ? x : x & mask;
    }

    /**
     * Generate a hash for a long value, and apply a mask to get the remainder if there is one.
     *
     * @param value to be hashed.
     * @param mask  mask to be applied that must be a power of 2 - 1.
     * @returns the hashed value.
     */
    public static hashLong(value: number, mask?: number): number {
        const hash = hashHalves(Math.floor(value / TWO_POW_32) | 0, value | 0);

        return undefined === mask ? hash : hash & mask;
    }

    /**
     * Generate a hash for a 64-bit value given as its two `int` halves, and apply a mask to get the remainder if there
     * is one. It computes what `hash(long, int)` computes for `(hi << 32) | (lo & 0xFFFFFFFF)`, without a `bigint` or
     * a `number` that cannot hold the value.
     * <p>
     * Not in Java (spec D14): the hash of the `(hi, lo)` keyed maps.
     *
     * @param hi   the upper 32 bits of the value.
     * @param lo   the lower 32 bits of the value.
     * @param mask mask to be applied that must be a power of 2 - 1.
     * @returns the hashed value.
     */
    public static hashLongHalves(hi: number, lo: number, mask?: number): number {
        const hash = hashHalves(hi | 0, lo | 0);

        return undefined === mask ? hash : hash & mask;
    }

    /**
     * Generate a hash for an object and apply a mask to get a remainder: the hash of its `hashCode()`.
     *
     * @param value to be hashed.
     * @param mask  mask to be applied that must be a power of 2 - 1.
     * @returns the hash of the value.
     */
    public static hashObject(value: unknown, mask: number): number {
        return Hashing.hash(hashCodeOf(value)) & mask;
    }

    /**
     * Generate an even hash for an int value and apply mask to get a remainder that will be even.
     *
     * @param value to be hashed.
     * @param mask  mask to be applied that must be a power of 2 - 1.
     * @returns the hash of the value which is always even.
     */
    public static evenHash(value: number, mask: number): number {
        const hash = Hashing.hash(value);
        const evenHash = (hash << 1) - (hash << 8);

        return evenHash & mask;
    }

    /**
     * Generate an even hash for a long value and apply mask to get a remainder that will be even.
     *
     * @param value to be hashed.
     * @param mask  mask to be applied that must be a power of 2 - 1.
     * @returns the hash of the value which is always even.
     */
    public static evenHashLong(value: number, mask: number): number {
        const hash = Hashing.hashLong(value);
        const evenHash = (hash << 1) - (hash << 8);

        return evenHash & mask;
    }

    /**
     * Generate an even hash for a 64-bit value given as its two `int` halves and apply mask to get a remainder that
     * will be even: what `evenHash(long, int)` computes for `(hi << 32) | (lo & 0xFFFFFFFF)`.
     * <p>
     * Not in Java (spec D14): the hash of the `(hi, lo)` keyed maps.
     *
     * @param hi   the upper 32 bits of the value.
     * @param lo   the lower 32 bits of the value.
     * @param mask mask to be applied that must be a power of 2 - 1.
     * @returns the hash of the value which is always even.
     */
    public static evenHashLongHalves(hi: number, lo: number, mask: number): number {
        const hash = hashHalves(hi | 0, lo | 0);
        const evenHash = (hash << 1) - (hash << 8);

        return evenHash & mask;
    }

    /**
     * Combined two 32-bit keys into a 64-bit compound. A compound outside +/-(2^53 - 1) throws
     * {@link LongOverflowError} carrying the exact long (spec D5).
     *
     * @param keyPartA to make the upper bits
     * @param keyPartB to make the lower bits.
     * @returns the compound key
     */
    public static compoundKey(keyPartA: number, keyPartB: number): number {
        const value = (keyPartA | 0) * TWO_POW_32 + (keyPartB >>> 0);
        if (!Number.isSafeInteger(value)) {
            throw new LongOverflowError(BigInt.asIntN(64, (BigInt(keyPartA | 0) << 32n) | BigInt(keyPartB >>> 0)));
        }

        return value;
    }
}
