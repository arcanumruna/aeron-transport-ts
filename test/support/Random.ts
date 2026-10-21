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
