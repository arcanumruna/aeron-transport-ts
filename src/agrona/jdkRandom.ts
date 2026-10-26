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
// Stand-in for java/util/Random.java (spec D61)

/**
 * Stand-in for `java.util.Random`: the same 48 bit linear congruential generator, so a seed replays the sequence that
 * Java produces (spec D61). Only the members the loss generators use are ported: the constructors and `nextDouble`.
 * <p>
 * The 48 bit state is two 24 bit halves in `number` fields, so that the steps need no `bigint` and allocate nothing.
 */
export class Random {
    private static readonly MULTIPLIER_HIGH = 0x5de; // 0x5DEECE66D = 0x5DE * 2^24 + 0xECE66D
    private static readonly MULTIPLIER_LOW = 0xece66d;
    private static readonly ADDEND = 0xb;
    private static readonly TWO_POW_24 = 16777216;
    private static readonly TWO_POW_48 = 281474976710656;
    private static readonly DOUBLE_UNIT = 1 / 9007199254740992; // 0x1.0p-53

    private high = 0;
    private low = 0;

    /**
     * Creates a generator with the given seed, or one seeded from `Math.random` if none is given (Java mixes a seed
     * uniquifier with `System.nanoTime()`).
     *
     * @param seed the initial seed: an integer in +/-(2^53 - 1) (spec D5).
     */
    public constructor(seed?: number) {
        this.setSeed(undefined === seed ? Math.floor(Math.random() * Random.TWO_POW_48) : seed);
    }

    /**
     * Sets the seed as Java does: `(seed ^ 0x5DEECE66DL) & ((1L << 48) - 1)`.
     *
     * @param seed the initial seed.
     */
    public setSeed(seed: number): void {
        // The low 48 bits of the two's complement value, taken by arithmetic, so that no bit operator sees more than 24 bits.
        let value = seed % Random.TWO_POW_48;
        if (value < 0) {
            value += Random.TWO_POW_48;
        }

        const low = value % Random.TWO_POW_24;
        const high = (value - low) / Random.TWO_POW_24;
        this.low = (low ^ Random.MULTIPLIER_LOW) >>> 0;
        this.high = (high ^ Random.MULTIPLIER_HIGH) >>> 0;
    }

    /** Java's `next(bits)` for 25 to 32 bits: steps the state and returns its top `bits` bits as an `int`. */
    private next(bits: number): number {
        const lowProduct = this.low * Random.MULTIPLIER_LOW + Random.ADDEND;
        const newLow = lowProduct % Random.TWO_POW_24;
        const carry = (lowProduct - newLow) / Random.TWO_POW_24;
        const newHigh =
            (this.high * Random.MULTIPLIER_LOW + this.low * Random.MULTIPLIER_HIGH + carry) % Random.TWO_POW_24;
        this.low = newLow;
        this.high = newHigh;

        // seed >>> (48 - bits): the high half shifted left by (bits - 24) over the top bits of the low half.
        return (newHigh * (1 << (bits - 24)) + (newLow >>> (48 - bits))) | 0;
    }

    /**
     * The next pseudorandom, uniformly distributed `double` in [0.0, 1.0): `((next(26) << 27) + next(27)) * 2^-53`.
     *
     * @return the next pseudorandom `double`.
     */
    public nextDouble(): number {
        const a = this.next(26);
        const b = this.next(27);
        return (a * 134217728 + b) * Random.DOUBLE_UNIT;
    }
}
