// Not in Agrona: the native-order fast path of the `byteOrder` accessors and the inline bounds check of `boundsCheck0`
// keep Java's semantics and exceptions exactly (issue #8): an omitted or `undefined` byte order is the native order, an
// explicit one is honoured, and an index outside the buffer throws the `IndexOutOfBoundsException` of
// `Objects.checkFromIndexSize` with its message, at every edge. Over an ArrayBuffer and a SharedArrayBuffer.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, IndexOutOfBoundsException, LongOverflowError } from '../../../src/agrona/jdk.js';
import { BACKINGS } from '../../support/Backing.js';

const CAPACITY = 32;

describe.each(BACKINGS)('UnsafeBufferIntAccessorRegression %s', (backing) => {
    const newBuffer = (): UnsafeBuffer => new UnsafeBuffer(backing.bytes(CAPACITY));

    it('omittedByteOrderIsNativeAndExplicitIsHonouredForEveryAccessor', () => {
        const b = newBuffer();
        b.putInt(0, 0x01020304);
        expect([...b.byteArray().subarray(0, 4)]).toEqual([4, 3, 2, 1]);
        b.putInt(4, 0x01020304, ByteOrder.BIG_ENDIAN);
        expect([...b.byteArray().subarray(4, 8)]).toEqual([1, 2, 3, 4]);
        b.putInt(8, 0x01020304, undefined);
        expect([...b.byteArray().subarray(8, 12)]).toEqual([4, 3, 2, 1]);
        b.putInt(12, 0x01020304, ByteOrder.LITTLE_ENDIAN);
        expect([...b.byteArray().subarray(12, 16)]).toEqual([4, 3, 2, 1]);
        expect(b.getInt(0)).toBe(0x01020304);
        expect(b.getInt(0, undefined)).toBe(0x01020304);
        expect(b.getInt(0, ByteOrder.nativeOrder())).toBe(0x01020304);
        expect(b.getInt(0, ByteOrder.BIG_ENDIAN)).toBe(0x04030201);
        expect(b.getInt(4, ByteOrder.BIG_ENDIAN)).toBe(0x01020304);

        b.putShort(16, 0x0102);
        b.putShort(18, 0x0102, ByteOrder.BIG_ENDIAN);
        expect([...b.byteArray().subarray(16, 20)]).toEqual([2, 1, 1, 2]);
        expect(b.getShort(16)).toBe(0x0102);
        expect(b.getShort(16, ByteOrder.BIG_ENDIAN)).toBe(0x0201);
        b.putChar(20, 0x0102, ByteOrder.BIG_ENDIAN);
        expect(b.getChar(20)).toBe(0x0201);
        b.putLong(24, 0x0102030405, ByteOrder.BIG_ENDIAN);
        expect(b.getLong(24, ByteOrder.BIG_ENDIAN)).toBe(0x0102030405);
        // the same bytes read in the other order are a long outside +/-(2^53 - 1) (spec D5)
        expect(() => b.getLong(24)).toThrow(LongOverflowError);
        b.putLong(24, 0x0102030405);
        expect(b.getLong(24)).toBe(0x0102030405);
        b.putDouble(16, 1.5);
        expect(b.getDouble(16)).toBe(1.5);
        expect(b.getDouble(16, ByteOrder.BIG_ENDIAN)).not.toBe(1.5);
        b.putFloat(16, 2.5, ByteOrder.BIG_ENDIAN);
        expect(b.getFloat(16, ByteOrder.BIG_ENDIAN)).toBe(2.5);
    });

    // [index, length of the access, throws]: getInt and putInt are 4 bytes, getLong and putLong 8
    const INT_EDGES: [number, boolean][] = [
        [0, false],
        [CAPACITY - 4, false],
        [CAPACITY - 3, true],
        [CAPACITY - 1, true],
        [CAPACITY, true],
        [CAPACITY + 1, true],
        [-1, true],
        [-4, true],
        [Number.MIN_SAFE_INTEGER, true],
        [Number.MAX_SAFE_INTEGER, true],
        [2 ** 31, true],
        [2 ** 31 - 1, true],
        [-(2 ** 31), true],
    ];

    it.each(INT_EDGES)('getIntAndPutIntBoundsAtIndex%d', (index, throws) => {
        const b = newBuffer();
        const message = `Range [${index}, ${index} + 4) out of bounds for length ${CAPACITY}`;
        if (throws) {
            expect(() => b.getInt(index)).toThrow(new IndexOutOfBoundsException(message));
            expect(() => b.getInt(index, ByteOrder.BIG_ENDIAN)).toThrow(IndexOutOfBoundsException);
            expect(() => b.putInt(index, 1)).toThrow(new IndexOutOfBoundsException(message));
            expect(() => b.putInt(index, 1, ByteOrder.BIG_ENDIAN)).toThrow(IndexOutOfBoundsException);
            expect(() => b.getIntVolatile(index)).toThrow(IndexOutOfBoundsException);
        } else {
            b.putInt(index, 7);
            expect(b.getInt(index)).toBe(7);
        }
    });

    it('longBoundsAtTheEdges', () => {
        const b = newBuffer();
        b.putLong(CAPACITY - 8, 5);
        expect(b.getLong(CAPACITY - 8)).toBe(5);
        for (const index of [CAPACITY - 7, CAPACITY, -1]) {
            expect(() => b.getLong(index)).toThrow(
                new IndexOutOfBoundsException(`Range [${index}, ${index} + 8) out of bounds for length ${CAPACITY}`),
            );
            expect(() => b.putLong(index, 1)).toThrow(IndexOutOfBoundsException);
        }
    });

    it('aWindowChecksAgainstItsOwnCapacity', () => {
        const window = new UnsafeBuffer(backing.bytes(CAPACITY), 8, 8);
        window.putInt(4, 9);
        expect(window.getInt(4)).toBe(9);
        expect(() => window.getInt(5)).toThrow(
            new IndexOutOfBoundsException('Range [5, 5 + 4) out of bounds for length 8'),
        );
        expect(() => window.putInt(-1, 1)).toThrow(IndexOutOfBoundsException);
    });
});
