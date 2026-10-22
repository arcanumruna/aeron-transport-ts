import { ThreadLocalRandom } from '../../src/agrona/jdk.js';

/**
 * A random Java `long` as a bigint: a full 64-bit value every fourth call, otherwise shifted right by a random 0 to 63
 * bits so that every digit count (and the whole +/-(2^53 - 1) range of a `number`) occurs.
 */
export function randomJavaLong(i: number): bigint {
    const random = BigInt.asIntN(
        64,
        (BigInt(ThreadLocalRandom.current().nextInt() >>> 0) << 32n) |
            BigInt(ThreadLocalRandom.current().nextInt() >>> 0),
    );
    return i % 4 === 0 ? random : random >> BigInt(ThreadLocalRandom.current().nextInt() & 63);
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A random long for the round trips whose overflow branch throws (and so is slow): every eighth iteration the full
 * range of `randomJavaLong(i >> 3)`, otherwise `randomJavaLong(i)` folded by `fold` when outside +/-(2^53 - 1).
 */
export function sampledJavaLong(i: number, fold: (value: bigint) => bigint = (v) => BigInt.asIntN(53, v)): bigint {
    if (i % 8 === 0) {
        return randomJavaLong(i >> 3);
    }
    const value = randomJavaLong(i);
    return value >= -MAX_SAFE && value <= MAX_SAFE ? value : fold(value);
}

/** mulberry32: a seeded PRNG returning a double in [0, 1) per call. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
