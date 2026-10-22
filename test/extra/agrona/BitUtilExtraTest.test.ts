// Not in Agrona: cases the Java BitUtilTest does not have (sign, width, wrap and bound mutations of each helper).
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import {
    ArrayIndexOutOfBoundsException,
    IllegalArgumentException,
    Integer,
    Long,
    NegativeArraySizeException,
    StringIndexOutOfBoundsException,
} from '../../../src/agrona/jdk.js';
import { assertThrows } from '../../support/Assertions.js';

describe('BitUtilExtra', () => {
    it('sizes', () => {
        expect([
            BitUtil.SIZE_OF_BYTE,
            BitUtil.SIZE_OF_BOOLEAN,
            BitUtil.SIZE_OF_CHAR,
            BitUtil.SIZE_OF_SHORT,
            BitUtil.SIZE_OF_INT,
            BitUtil.SIZE_OF_FLOAT,
            BitUtil.SIZE_OF_LONG,
            BitUtil.SIZE_OF_DOUBLE,
            BitUtil.CACHE_LINE_LENGTH,
        ]).toEqual([1, 1, 2, 2, 4, 4, 8, 8, 64]);
    });

    it('findNextPositivePowerOfTwoLong', () => {
        const f = BitUtil.findNextPositivePowerOfTwoLong;
        expect([f(-5), f(0), f(1), f(2), f(3), f(4), f(5)]).toEqual([1, 1, 1, 2, 4, 4, 8]);
        expect(f(2 ** 31)).toBe(2 ** 31);
        expect(f(2 ** 31 + 1)).toBe(2 ** 32);
        expect(f(2 ** 40)).toBe(2 ** 40);
        expect(f(2 ** 40 + 1)).toBe(2 ** 41);
        expect(f(2 ** 52)).toBe(2 ** 52);
        // the next power of two, 2^53, is not a safe integer
        expect(() => f(2 ** 52 + 1)).toThrow(RangeError);
        expect(() => f(Long.MAX_VALUE)).toThrow(RangeError);
        expect(() => f(2 ** 53)).toThrow(RangeError);
    });

    it('findNextPositivePowerOfTwoOfAnInt', () => {
        const f = BitUtil.findNextPositivePowerOfTwo;
        expect([f(5), f(1 << 29), f((1 << 29) + 1), f(1 << 30)]).toEqual([8, 1 << 29, 1 << 30, 1 << 30]);
    });

    it('alignLong', () => {
        const a = BitUtil.alignLong;
        expect(a(0, 8)).toBe(0);
        expect(a(1, 8)).toBe(8);
        expect(a(8, 8)).toBe(8);
        expect(a(2 ** 40 + 1, 64)).toBe(2 ** 40 + 64);
        expect(a(2 ** 32 - 1, 2 ** 32)).toBe(2 ** 32);
        expect(a(2 ** 32 + 1, 2 ** 32)).toBe(2 ** 33);
        expect(a(2 ** 52, 2 ** 40)).toBe(2 ** 52);
        expect(a(2 ** 53 - 64, 64)).toBe(2 ** 53 - 64);
        expect(() => a(2 ** 53 - 1, 64)).toThrow(RangeError);
        expect(() => a(2 ** 53, 64)).toThrow(RangeError);
        expect(() => a(1, 2 ** 53)).toThrow(RangeError);
    });

    it('alignOfAnInt', () => {
        expect(BitUtil.align(1, 4)).toBe(4);
        expect(BitUtil.align(4, 4)).toBe(4);
        expect(BitUtil.align(5, 4)).toBe(8);
        expect(BitUtil.align(Integer.MAX_VALUE, 64)).toBe(Integer.MIN_VALUE);
    });

    it('isEven', () => {
        expect([BitUtil.isEven(2), BitUtil.isEven(3), BitUtil.isEven(-2), BitUtil.isEven(-3)]).toEqual([
            true,
            false,
            true,
            false,
        ]);
        const e = BitUtil.isEvenLong;
        expect(e(0)).toBe(true);
        expect(e(2 ** 40)).toBe(true);
        expect(e(2 ** 40 + 1)).toBe(false);
        expect(e(-(2 ** 40))).toBe(true);
        expect(e(-(2 ** 40) - 1)).toBe(false);
        expect(e(-3)).toBe(false);
        expect(e(Long.MAX_VALUE)).toBe(false);
        expect(e(Long.MIN_VALUE)).toBe(false);
    });

    it('isPowerOfTwo', () => {
        const p = BitUtil.isPowerOfTwo;
        expect([p(0), p(1), p(2), p(3), p(-8), p(Integer.MIN_VALUE), p(1 << 30), p((1 << 30) + 1)]).toEqual([
            false,
            true,
            true,
            false,
            false,
            false,
            true,
            false,
        ]);
        const l = BitUtil.isPowerOfTwoLong;
        expect([l(0), l(1), l(3), l(-(2 ** 40)), l(2 ** 40), l(2 ** 40 + 1), l(2 ** 52), l(Long.MAX_VALUE)]).toEqual([
            false,
            true,
            false,
            false,
            true,
            false,
            true,
            false,
        ]);
    });

    it('nextAndPreviousWrapLikeAnInt', () => {
        expect(BitUtil.next(0, 4)).toBe(1);
        expect(BitUtil.next(3, 4)).toBe(0);
        expect(BitUtil.next(Integer.MAX_VALUE, 0)).toBe(Integer.MIN_VALUE);
        expect(BitUtil.previous(2, 4)).toBe(1);
        expect(BitUtil.previous(0, 4)).toBe(3);
        expect(BitUtil.previous(0, Integer.MIN_VALUE)).toBe(Integer.MAX_VALUE);
        expect(BitUtil.previous(Integer.MIN_VALUE, 4)).toBe(Integer.MAX_VALUE);
    });

    it('calculateShiftForScale', () => {
        expect(BitUtil.calculateShiftForScale(4)).toBe(2);
        expect(BitUtil.calculateShiftForScale(8)).toBe(3);
        const error = assertThrows(IllegalArgumentException, () => BitUtil.calculateShiftForScale(16));
        expect(error.message).toBe('unknown pointer size for scale=16');
    });

    it('generateRandomisedIdIsAnInt', () => {
        const ids = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const id = BitUtil.generateRandomisedId();
            expect(id | 0).toBe(id);
            ids.add(id);
        }
        expect(ids.size).toBeGreaterThan(190);
    });

    it('isAligned', () => {
        expect(BitUtil.isAligned(0, 8)).toBe(true);
        expect(BitUtil.isAligned(16, 8)).toBe(true);
        expect(BitUtil.isAligned(12, 8)).toBe(false);
        expect(BitUtil.isAligned(2 ** 40 + 8, 8)).toBe(true);
        expect(BitUtil.isAligned(2 ** 40 + 4, 8)).toBe(false);
        expect(BitUtil.isAligned(2 ** 33 + 1, 1)).toBe(true);
        const error = assertThrows(IllegalArgumentException, () => BitUtil.isAligned(8, 6));
        expect(error.message).toBe('alignment must be a power of 2: alignment=6');
    });

    it('hexConversionsWithOffsetLengthAndCase', () => {
        const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x0a]);
        expect(BitUtil.toHex(bytes)).toBe('00ff807f0a');
        expect(BitUtil.toHex(bytes, 1, 3)).toBe('ff807f');
        expect(BitUtil.toHex(bytes, 5, 0)).toBe('');
        expect(BitUtil.toHexByteArray('AB', 0, 2)).toEqual(new Uint8Array([0x34, 0x31, 0x34, 0x32]));
        expect(BitUtil.toHexByteArray('ÿz', 0, 2)).toEqual(new Uint8Array([0x66, 0x66, 0x37, 0x61]));
        expect(BitUtil.fromHex('00FF807f0A')).toEqual(bytes);
        expect(BitUtil.fromHex('abc')).toEqual(new Uint8Array([0xab]));
        expect(BitUtil.fromHex('')).toEqual(new Uint8Array(0));
    });

    it('fromHexByteArrayThrowsForAByteOutsideTheTable', () => {
        const error = assertThrows(ArrayIndexOutOfBoundsException, () =>
            BitUtil.fromHexByteArray(new Uint8Array([0x30, 0x80])),
        );
        expect(error.message).toBe('Index -128 out of bounds for length 128');
        expect(() => BitUtil.fromHexByteArray(new Uint8Array([0xff, 0x30]))).toThrow(ArrayIndexOutOfBoundsException);
    });

    it('toHexThrowsWhereJavaThrows', () => {
        const bytes = new Uint8Array([1, 2]);
        expect(assertThrows(ArrayIndexOutOfBoundsException, () => BitUtil.toHexByteArray(bytes, 1, 5)).message).toBe(
            'Index 2 out of bounds for length 2',
        );
        expect(() => BitUtil.toHexByteArray(bytes, -1, 1)).toThrow(ArrayIndexOutOfBoundsException);
        expect(() => BitUtil.toHex(bytes, 0, 3)).toThrow(ArrayIndexOutOfBoundsException);
        expect(() => BitUtil.toHexByteArray(bytes, 3, 0)).not.toThrow();
        expect(() => BitUtil.toHexByteArray(bytes, 3, 1)).toThrow(ArrayIndexOutOfBoundsException);
        expect(() => BitUtil.toHexByteArray(bytes, 0, -1)).toThrow(NegativeArraySizeException);
        expect(assertThrows(StringIndexOutOfBoundsException, () => BitUtil.toHexByteArray('ab', 1, 5)).message).toBe(
            'Index 2 out of bounds for length 2',
        );
        expect(() => BitUtil.toHexByteArray('ab', -1, 1)).toThrow(StringIndexOutOfBoundsException);
    });
});
