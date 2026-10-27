// Not in Agrona: the `long` operations of UnsafeBuffer, written flat for the inlining budget of V8 (issue #19), keep
// their results, their bytes and their exceptions, over an ArrayBuffer and a SharedArrayBuffer. A `BigInt` model gives
// the 8 little-endian bytes of every stored value; the operations are driven over values on both sides of 2^31 and 2^32,
// negative and at +/-(2^53 - 1). A value that is not a safe integer is a `RangeError` with nothing written, a stored word
// outside +/-(2^53 - 1) is a `LongOverflowError` with the exact value, an index outside the buffer is an
// `IndexOutOfBoundsException` before anything else, and the Java aliases are the very functions they alias.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IndexOutOfBoundsException, LongOverflowError } from '../../../src/agrona/jdk.js';
import { BACKINGS } from '../../support/Backing.js';

const INDEX = 16;
const CAPACITY = 64;
const MAX = Number.MAX_SAFE_INTEGER;
const VALUES = [
    0,
    1,
    -1,
    2 ** 31 - 1,
    2 ** 31,
    -(2 ** 31),
    -(2 ** 31) - 1,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 1,
    -(2 ** 32),
    -(2 ** 32) - 1,
    2 ** 40 + 5,
    -(2 ** 40) - 5,
    2 ** 52,
    MAX,
    -MAX,
];
const UNSAFE = [Number.NaN, 1.5, MAX + 1, 2 ** 63, Infinity, -Infinity, -(2 ** 53)];

/** The bytes Java stores for `value`: 8 bytes, little endian, two's complement. */
function modelBytes(value: number): number[] {
    const word = BigInt.asUintN(64, BigInt(value));
    return Array.from({ length: 8 }, (_, i) => Number((word >> BigInt(8 * i)) & 0xffn));
}

function bytesAt(b: UnsafeBuffer): number[] {
    return [...b.byteArray().subarray(INDEX, INDEX + 8)];
}

/** Writes a word of 8 bytes that is outside +/-(2^53 - 1), and returns its exact value. */
function storeOverflow(b: UnsafeBuffer): bigint {
    b.putBytes(INDEX, new Uint8Array([1, 2, 3, 4, 5, 6, 0x7f, 0x01]));
    return 0x017f060504030201n;
}

describe.each(BACKINGS)('UnsafeBufferLongOperationsRegression %s', (backing) => {
    const newBuffer = (): UnsafeBuffer => new UnsafeBuffer(backing.bytes(CAPACITY));

    it.each(VALUES)('putAndGetOfEveryFormStoreTheBytesOfJavaAt%d', (value) => {
        const puts: ((b: UnsafeBuffer) => void)[] = [
            (b) => b.putLong(INDEX, value),
            (b) => b.putLongVolatile(INDEX, value),
            (b) => b.putLongOrdered(INDEX, value),
            (b) => b.putLongRelease(INDEX, value),
            (b) => b.putLongOpaque(INDEX, value),
        ];
        const gets: ((b: UnsafeBuffer) => number)[] = [
            (b) => b.getLong(INDEX),
            (b) => b.getLongVolatile(INDEX),
            (b) => b.getLongAcquire(INDEX),
            (b) => b.getLongOpaque(INDEX),
        ];
        for (const put of puts) {
            const b = newBuffer();
            put(b);
            expect(bytesAt(b)).toEqual(modelBytes(value));
            for (const get of gets) {
                expect(get(b)).toBe(value);
            }
        }
    });

    it.each(VALUES)('getAndAddOfEveryFormReturnsTheOldValueAndStoresTheSumAt%d', (value) => {
        const adds: ((b: UnsafeBuffer, delta: number) => number)[] = [
            (b, d) => b.getAndAddLong(INDEX, d),
            (b, d) => b.addLongOrdered(INDEX, d),
            (b, d) => b.addLongRelease(INDEX, d),
            (b, d) => b.addLongOpaque(INDEX, d),
        ];
        for (const add of adds) {
            for (const delta of [0, 1, -1, 2 ** 31, -(2 ** 32) - 3]) {
                const sum = value + delta;
                const b = newBuffer();
                b.putLongVolatile(INDEX, value);
                if (Math.abs(sum) > MAX) {
                    // the shared path says LongOverflowError, the plain one the RangeError of the safe-integer check
                    expect(() => add(b, delta)).toThrow(RangeError);
                    expect(bytesAt(b)).toEqual(modelBytes(value));
                    continue;
                }
                expect(add(b, delta)).toBe(value);
                expect(bytesAt(b)).toEqual(modelBytes(sum));
            }
        }
    });

    it.each(VALUES)('compareAndSetCompareAndExchangeAndGetAndSetAt%d', (value) => {
        const other = value === 7 ? 8 : 7;
        const b = newBuffer();
        b.putLongVolatile(INDEX, value);
        expect(b.compareAndSetLong(INDEX, other, 9)).toBe(false);
        expect(bytesAt(b)).toEqual(modelBytes(value));
        expect(b.compareAndSetLong(INDEX, value, other)).toBe(true);
        expect(bytesAt(b)).toEqual(modelBytes(other));

        b.putLongVolatile(INDEX, value);
        expect(b.compareAndExchangeLong(INDEX, other, 9)).toBe(value);
        expect(bytesAt(b)).toEqual(modelBytes(value));
        expect(b.compareAndExchangeLong(INDEX, value, other)).toBe(value);
        expect(bytesAt(b)).toEqual(modelBytes(other));

        b.putLongVolatile(INDEX, value);
        expect(b.getAndSetLong(INDEX, other)).toBe(value);
        expect(bytesAt(b)).toEqual(modelBytes(other));
    });

    it.each(UNSAFE)('aValueThatIsNotASafeIntegerIsARangeErrorWithNothingWrittenAt%d', (value) => {
        const writes: ((b: UnsafeBuffer) => unknown)[] = [
            (b) => b.putLong(INDEX, value),
            (b) => b.putLongVolatile(INDEX, value),
            (b) => b.putLongRelease(INDEX, value),
            (b) => b.getAndSetLong(INDEX, value),
            // an unsafe delta whose sum is safe (-2^53 + 5) is added by the plain path and refused by the shared one
            ...(value === -(2 ** 53) ? [] : [(b: UnsafeBuffer) => b.getAndAddLong(INDEX, value)]),
            ...(value === -(2 ** 53) ? [] : [(b: UnsafeBuffer) => b.addLongOrdered(INDEX, value)]),
            (b) => b.compareAndSetLong(INDEX, 5, value),
            (b) => b.compareAndSetLong(INDEX, value, 5),
            (b) => b.compareAndExchangeLong(INDEX, 5, value),
        ];
        for (const write of writes) {
            const b = newBuffer();
            b.putLongVolatile(INDEX, 5);
            // a compare that misses never looks at the update value on the plain path, so only a hit is a RangeError there
            const outcome = ((): unknown => {
                try {
                    return write(b);
                } catch (e) {
                    return e;
                }
            })();
            if (outcome instanceof Error) {
                expect(outcome).toBeInstanceOf(RangeError);
                expect(bytesAt(b)).toEqual(modelBytes(5));
            } else {
                // the only calls that return are the compares that missed or whose update value was not looked at
                expect(bytesAt(b)).toEqual(modelBytes(5));
            }
        }
    });

    it('aStoredWordOutsideTheSafeRangeIsALongOverflowErrorWithTheExactValue', () => {
        const reads: ((b: UnsafeBuffer) => unknown)[] = [
            (b) => b.getLong(INDEX),
            (b) => b.getLongVolatile(INDEX),
            (b) => b.getLongAcquire(INDEX),
            (b) => b.getLongOpaque(INDEX),
            (b) => b.getAndAddLong(INDEX, 1),
            (b) => b.getAndSetLong(INDEX, 1),
            (b) => b.compareAndExchangeLong(INDEX, 1, 2),
        ];
        for (const read of reads) {
            const b = newBuffer();
            const exact = storeOverflow(b);
            let error: unknown;
            try {
                read(b);
            } catch (e) {
                error = e;
            }
            expect(error).toBeInstanceOf(LongOverflowError);
            expect((error as LongOverflowError).value).toBe(exact);
            // nothing was written
            expect(bytesAt(b)).toEqual([1, 2, 3, 4, 5, 6, 0x7f, 0x01]);
        }
    });

    it('compareAndSetOfAStoredWordOutsideTheSafeRangeIsAMissOnTheSharedPathAndAnErrorOnThePlainOne', () => {
        // the plain path reads the word as a number, so a word it cannot hold is the error of the read (as before issue
        // #19); the shared path compares the halves, so the same word is a miss (spec D16)
        const b = newBuffer();
        storeOverflow(b);
        if (backing.shared) {
            expect(b.compareAndSetLong(INDEX, 1, 2)).toBe(false);
        } else {
            expect(() => b.compareAndSetLong(INDEX, 1, 2)).toThrow(LongOverflowError);
        }
        expect(bytesAt(b)).toEqual([1, 2, 3, 4, 5, 6, 0x7f, 0x01]);
    });

    it('anIndexOutsideTheBufferIsTheBoundsErrorBeforeAnythingElse', () => {
        for (const index of [-1, -8, CAPACITY - 7, CAPACITY - 1, CAPACITY, CAPACITY + 8, 2 ** 31]) {
            const b = newBuffer();
            const calls: (() => unknown)[] = [
                () => b.getLongVolatile(index),
                () => b.putLongVolatile(index, 1),
                () => b.putLongVolatile(index, Number.NaN),
                () => b.getAndAddLong(index, 1),
                () => b.getAndAddLong(index, Number.NaN),
                () => b.compareAndSetLong(index, 1, 2),
                () => b.compareAndExchangeLong(index, 1, 2),
                () => b.getAndSetLong(index, 1),
                () => b.getLongAcquire(index),
                () => b.putLongOrdered(index, 1),
            ];
            for (const call of calls) {
                expect(call).toThrow(IndexOutOfBoundsException);
            }
        }
    });

    it('anUnalignedIndexIsAnIllegalArgumentExceptionOnlyOverASharedBuffer', () => {
        const b = newBuffer();
        if (backing.shared) {
            expect(() => b.getLongVolatile(INDEX + 4)).toThrow(IllegalArgumentException);
            expect(() => b.putLongVolatile(INDEX + 4, 1)).toThrow(IllegalArgumentException);
            // the alignment is checked before the value
            expect(() => b.putLongVolatile(INDEX + 4, Number.NaN)).toThrow(IllegalArgumentException);
            expect(() => b.getAndAddLong(INDEX + 4, 1)).toThrow(IllegalArgumentException);
        } else {
            b.putLongVolatile(INDEX + 4, 3);
            expect(b.getLongVolatile(INDEX + 4)).toBe(3);
            expect(b.getAndAddLong(INDEX + 4, 4)).toBe(3);
            expect(b.getLongAcquire(INDEX + 4)).toBe(7);
        }
    });
});

describe('UnsafeBufferLongOperationsRegression aliases', () => {
    it('theJavaAliasesAreTheFunctionsTheyAlias', () => {
        const proto = UnsafeBuffer.prototype;
        expect(proto.getLongAcquire).toBe(proto.getLongVolatile);
        expect(proto.getLongOpaque).toBe(proto.getLongVolatile);
        expect(proto.putLongOrdered).toBe(proto.putLongVolatile);
        expect(proto.putLongRelease).toBe(proto.putLongVolatile);
        expect(proto.putLongOpaque).toBe(proto.putLongVolatile);
        expect(proto.addLongOrdered).toBe(proto.getAndAddLong);
        expect(proto.addLongRelease).toBe(proto.getAndAddLong);
        expect(proto.addLongOpaque).toBe(proto.getAndAddLong);
    });

    it('theAliasesAreMethodsOfThePrototypeAndNotOwnPropertiesOfAnInstance', () => {
        const b = new UnsafeBuffer(new Uint8Array(16));
        for (const name of [
            'getLongAcquire',
            'getLongOpaque',
            'putLongOrdered',
            'putLongRelease',
            'putLongOpaque',
            'addLongOrdered',
            'addLongRelease',
            'addLongOpaque',
        ] as const) {
            expect(Object.hasOwn(b, name)).toBe(false);
            expect(Object.hasOwn(UnsafeBuffer.prototype, name)).toBe(true);
            expect(Object.keys(b)).not.toContain(name);
        }
    });
});
