// Not in Agrona: cases the Java buffer tests do not have (sign, byte order, width and bound mutations of each
// accessor), and the port-only behaviour of UnsafeBuffer.
import { describe, expect, it } from 'vitest';
import { BufferUtil } from '../../../src/agrona/BufferUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import {
    ByteOrder,
    IllegalArgumentException,
    IllegalStateException,
    IndexOutOfBoundsException,
    Long,
    LongOverflowError,
    NumberFormatException,
} from '../../../src/agrona/jdk.js';
import { assertThrows } from '../../support/Assertions.js';

const { BIG_ENDIAN, LITTLE_ENDIAN } = ByteOrder;

function bytesOf(buffer: UnsafeBuffer, index: number, length: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < length; i++) {
        out.push(buffer.getByte(index + i) & 0xff);
    }
    return out;
}

/** The JDK's `hashCode` of a buffer's content, with the longs hashed through bigint. */
function referenceHashCode(bytes: Uint8Array): number {
    let hash = 19;
    let i = 0;
    for (const end = bytes.length & ~7; i < end; i += 8) {
        let l = 0n;
        for (let j = 7; j >= 0; j--) {
            l = (l << 8n) | BigInt(bytes[i + j]!);
        }
        l = BigInt.asIntN(64, l);
        const h = Number(BigInt.asIntN(32, l ^ (BigInt.asUintN(64, l) >> 32n)));
        hash = (Math.imul(31, hash) + h) | 0;
    }
    for (; i < bytes.length; i++) {
        hash = (Math.imul(31, hash) + ((bytes[i]! << 24) >> 24)) | 0;
    }
    return hash;
}

/** `Long.compare` of little-endian longs, then `Byte.compare` of the tail, then the capacities. */
function referenceCompare(a: Uint8Array, b: Uint8Array): number {
    const length = Math.min(a.length, b.length);
    let i = 0;
    const long = (bytes: Uint8Array, at: number): bigint => {
        let l = 0n;
        for (let j = 7; j >= 0; j--) {
            l = (l << 8n) | BigInt(bytes[at + j]!);
        }
        return BigInt.asIntN(64, l);
    };
    for (const end = length & ~7; i < end; i += 8) {
        const x = long(a, i);
        const y = long(b, i);
        if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    for (; i < length; i++) {
        const cmp = ((a[i]! << 24) >> 24) - ((b[i]! << 24) >> 24);
        if (cmp !== 0) {
            return cmp;
        }
    }
    return a.length < b.length ? -1 : a.length === b.length ? 0 : 1;
}

function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}

describe('UnsafeBufferExtra', () => {
    it('byteShortAndCharAreSignedOrUnsignedAsInJava', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));

        buffer.putByte(0, 0xff);
        buffer.putByte(1, 0x80);
        buffer.putByte(2, 0x7f);
        expect([buffer.getByte(0), buffer.getByte(1), buffer.getByte(2)]).toEqual([-1, -128, 127]);
        buffer.putByteVolatile(3, 0x80);
        expect(buffer.getByteVolatile(3)).toBe(-128);

        for (const order of [LITTLE_ENDIAN, BIG_ENDIAN]) {
            buffer.putShort(4, 0xffff, order);
            expect(buffer.getShort(4, order)).toBe(-1);
            buffer.putShort(4, 0x8000, order);
            expect(buffer.getShort(4, order)).toBe(-32768);
            buffer.putShort(4, 0x7fff, order);
            expect(buffer.getShort(4, order)).toBe(32767);
            buffer.putChar(4, 0xffff, order);
            expect(buffer.getChar(4, order)).toBe(65535);
            buffer.putChar(4, 0x8000, order);
            expect(buffer.getChar(4, order)).toBe(32768);
        }
        buffer.putShortVolatile(6, -2);
        expect(buffer.getShortVolatile(6)).toBe(-2);
        buffer.putCharVolatile(6, 0xfffe);
        expect(buffer.getCharVolatile(6)).toBe(0xfffe);
        expect(buffer.getShort(6)).toBe(-2);
    });

    it('widthAndByteOrderOfEveryPrimitive', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));

        buffer.putInt(0, 0x01020304);
        expect(bytesOf(buffer, 0, 4)).toEqual([4, 3, 2, 1]);
        buffer.putInt(0, 0x01020304, BIG_ENDIAN);
        expect(bytesOf(buffer, 0, 4)).toEqual([1, 2, 3, 4]);
        expect(buffer.getInt(0, BIG_ENDIAN)).toBe(0x01020304);
        expect(buffer.getInt(0, LITTLE_ENDIAN)).toBe(0x04030201);
        buffer.putInt(0, -2);
        expect(buffer.getInt(0)).toBe(-2);

        buffer.putShort(0, 0x0102);
        expect(bytesOf(buffer, 0, 2)).toEqual([2, 1]);
        buffer.putChar(0, 0x0102, BIG_ENDIAN);
        expect(bytesOf(buffer, 0, 2)).toEqual([1, 2]);

        buffer.putLong(0, 0x0102030405);
        expect(bytesOf(buffer, 0, 8)).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
        buffer.putLong(0, 0x0102030405, BIG_ENDIAN);
        expect(bytesOf(buffer, 0, 8)).toEqual([0, 0, 0, 1, 2, 3, 4, 5]);
        buffer.putLong(0, -2);
        expect(bytesOf(buffer, 0, 8)).toEqual([0xfe, 255, 255, 255, 255, 255, 255, 255]);
        expect(buffer.getLong(0)).toBe(-2);

        buffer.putDouble(0, 1.5);
        expect(buffer.getDouble(0)).toBe(1.5);
        expect(buffer.getLongBigInt(0)).toBe(0x3ff8000000000000n);
        buffer.putDouble(0, 1.5, BIG_ENDIAN);
        expect(bytesOf(buffer, 0, 8)).toEqual([0x3f, 0xf8, 0, 0, 0, 0, 0, 0]);
        expect(buffer.getDouble(0, BIG_ENDIAN)).toBe(1.5);
        buffer.putFloat(0, 1.5);
        expect(buffer.getFloat(0)).toBe(1.5);
        buffer.putFloat(0, 1.5, BIG_ENDIAN);
        expect(bytesOf(buffer, 0, 4)).toEqual([0x3f, 0xc0, 0, 0]);
        expect(buffer.getFloat(0, BIG_ENDIAN)).toBe(1.5);
        buffer.putFloat(0, 0.1);
        expect(buffer.getFloat(0)).toBe(Math.fround(0.1));
    });

    it('longBigIntAndTheRangeOfLongAsANumber', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(24));

        buffer.putLongBigInt(0, 2n ** 63n - 1n);
        expect(buffer.getLongBigInt(0)).toBe(2n ** 63n - 1n);
        expect(assertThrows(LongOverflowError, () => buffer.getLong(0)).value).toBe(2n ** 63n - 1n);
        buffer.putLongBigInt(8, -(2n ** 63n), BIG_ENDIAN);
        expect(buffer.getLongBigInt(8, BIG_ENDIAN)).toBe(-(2n ** 63n));
        expect(() => buffer.getLong(8, BIG_ENDIAN)).toThrow(RangeError);
        buffer.putLongBigInt(16, 2n ** 64n + 5n);
        expect(buffer.getLongBigInt(16)).toBe(5n);

        buffer.putLong(0, 7);
        expect(() => buffer.putLong(0, 2 ** 53)).toThrow(RangeError);
        expect(() => buffer.putLongVolatile(0, 2 ** 53)).toThrow(RangeError);
        expect(() => buffer.putLongOrdered(0, -(2 ** 53))).toThrow(RangeError);
        expect(buffer.getLong(0)).toBe(7);
        buffer.putLong(0, Long.MAX_VALUE);
        expect(() => buffer.getAndAddLong(0, 1)).toThrow(RangeError);
        expect(() => buffer.addLongOrdered(0, 1)).toThrow(RangeError);
        expect(() => buffer.addLongOpaque(0, 1)).toThrow(RangeError);
        expect(buffer.getLong(0)).toBe(Long.MAX_VALUE);
        expect(() => buffer.putLongAscii(0, 2 ** 53)).toThrow(RangeError);
        expect(() => buffer.putNaturalLongAscii(0, 2 ** 53)).toThrow(RangeError);
        expect(buffer.getLong(0)).toBe(Long.MAX_VALUE);
    });

    it('theAtomicOperationsFollowTheirContracts', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        buffer.putLong(0, 5);

        expect(buffer.compareAndSetLong(0, 6, 9)).toBe(false);
        expect(buffer.getLong(0)).toBe(5);
        expect(buffer.compareAndSetLong(0, 5, 9)).toBe(true);
        expect(buffer.getLong(0)).toBe(9);
        expect(buffer.compareAndExchangeLong(0, 5, 1)).toBe(9);
        expect(buffer.getLong(0)).toBe(9);
        expect(buffer.compareAndExchangeLong(0, 9, 1)).toBe(9);
        expect(buffer.getLong(0)).toBe(1);
        expect(buffer.getAndSetLong(0, -3)).toBe(1);
        expect(buffer.getAndAddLong(0, 10)).toBe(-3);
        expect(buffer.getLong(0)).toBe(7);
        expect(buffer.addLongOrdered(0, 1)).toBe(7);
        expect(buffer.getLongVolatile(0)).toBe(8);

        buffer.putInt(8, 5);
        expect(buffer.compareAndSetInt(8, 6, 9)).toBe(false);
        expect(buffer.getInt(8)).toBe(5);
        expect(buffer.compareAndSetInt(8, 5, 9)).toBe(true);
        expect(buffer.compareAndExchangeInt(8, 5, 1)).toBe(9);
        expect(buffer.getInt(8)).toBe(9);
        expect(buffer.getAndSetInt(8, -3)).toBe(9);
        expect(buffer.getAndAddInt(8, 10)).toBe(-3);
        expect(buffer.addIntOrdered(8, 1)).toBe(7);
        expect(buffer.getIntVolatile(8)).toBe(8);
        buffer.putInt(8, 0x7fffffff);
        expect(buffer.addIntOpaque(8, 1)).toBe(0x7fffffff);
        expect(buffer.getInt(8)).toBe(-0x80000000);
        buffer.putInt(8, 0x7fffffff);
        expect(buffer.getAndAddInt(8, 1)).toBe(0x7fffffff);
        expect(buffer.getInt(8)).toBe(-0x80000000);
        buffer.putInt(8, 0x7fffffff);
        expect(buffer.addIntRelease(8, 1)).toBe(0x7fffffff);
        expect(buffer.getInt(8)).toBe(-0x80000000);
    });

    it('stringsAreLengthPrefixedInTheGivenByteOrder', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));

        expect(buffer.putStringAscii(0, 'abc')).toBe(7);
        expect(bytesOf(buffer, 0, 7)).toEqual([3, 0, 0, 0, 0x61, 0x62, 0x63]);
        expect(buffer.putStringAscii(0, 'abc', BIG_ENDIAN)).toBe(7);
        expect(bytesOf(buffer, 0, 7)).toEqual([0, 0, 0, 3, 0x61, 0x62, 0x63]);
        expect(buffer.getStringAscii(0, BIG_ENDIAN)).toBe('abc');
        // read little-endian the big-endian length 3 is 50331648
        expect(() => buffer.getStringAscii(0, LITTLE_ENDIAN)).toThrow(IndexOutOfBoundsException);

        buffer.putStringAscii(0, 'héllo€', BIG_ENDIAN);
        expect(buffer.getStringAscii(0, BIG_ENDIAN)).toBe('h?llo?');
        expect(buffer.getStringAscii(0, 6)).toBe(buffer.getStringWithoutLengthAscii(4, 6));
        expect(buffer.putStringAscii(0, null)).toBe(4);
        expect(buffer.getInt(0)).toBe(0);
        expect(buffer.getStringAscii(0)).toBe('');
        expect(buffer.putStringAscii(0, null, BIG_ENDIAN)).toBe(4);
        expect(buffer.putStringAscii(0, '')).toBe(4);
        expect(buffer.getStringAscii(0, BIG_ENDIAN)).toBe('');

        buffer.putStringAscii(0, 'héllo');
        expect(buffer.getStringAscii(0)).toBe('h?llo');
        // a byte above 127 read back is U+FFFD where Java's US_ASCII decoder yields it, '?' for an Appendable
        buffer.putByte(5, 0xe9);
        expect(buffer.getStringAscii(0)).toBe('h�llo');
        expect(buffer.getStringWithoutLengthAscii(4, 5)).toBe('h�llo');
        let appended = '';
        const appendable = {
            append(c: string) {
                appended += c;
                return this;
            },
        };
        expect(buffer.getStringAscii(0, appendable)).toBe(5);
        expect(appended).toBe('h?llo');
        appended = '';
        expect(buffer.getStringAscii(0, appendable, LITTLE_ENDIAN)).toBe(5);
        expect(appended).toBe('h?llo');
        appended = '';
        expect(buffer.getStringAscii(0, 5, appendable)).toBe(5);
        expect(appended).toBe('h?llo');
        appended = '';
        expect(buffer.getStringWithoutLengthAscii(4, 5, appendable)).toBe(5);
        expect(appended).toBe('h?llo');
        buffer.putStringAscii(0, 'ab', BIG_ENDIAN);
        appended = '';
        expect(buffer.getStringAscii(0, appendable, BIG_ENDIAN)).toBe(2);
        expect(appended).toBe('ab');
        expect(buffer.putStringAscii(0, '')).toBe(4);
        expect(buffer.getStringAscii(0, appendable)).toBe(0);
        expect(buffer.getStringAscii(0, appendable, BIG_ENDIAN)).toBe(0);

        expect(buffer.putStringWithoutLengthAscii(0, 'xyz')).toBe(3);
        expect(buffer.putStringWithoutLengthAscii(0, null)).toBe(0);
        expect(buffer.putStringWithoutLengthAscii(0, 'héy')).toBe(3);
        expect(buffer.getStringWithoutLengthAscii(0, 3)).toBe('h?y');
        expect(buffer.putStringWithoutLengthAscii(2, 'abcdef', 2, 3)).toBe(3);
        expect(buffer.getStringWithoutLengthAscii(2, 3)).toBe('cde');
        expect(buffer.putStringWithoutLengthAscii(2, 'abcdef', 4, 10)).toBe(2);
        expect(buffer.putStringWithoutLengthAscii(2, null, 4, 10)).toBe(0);
        expect(buffer.getStringWithoutLengthAscii(0, 0)).toBe('');
    });

    it('utf8StringsAreLengthPrefixedInTheGivenByteOrder', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));

        expect(buffer.putStringUtf8(0, 'hé€')).toBe(4 + 6);
        expect(bytesOf(buffer, 0, 10)).toEqual([6, 0, 0, 0, 0x68, 0xc3, 0xa9, 0xe2, 0x82, 0xac]);
        expect(buffer.getStringUtf8(0)).toBe('hé€');
        expect(buffer.getStringUtf8(0, 6)).toBe('hé€');
        expect(buffer.getStringWithoutLengthUtf8(4, 6)).toBe('hé€');
        expect(buffer.putStringUtf8(0, 'hé€', BIG_ENDIAN)).toBe(10);
        expect(bytesOf(buffer, 0, 4)).toEqual([0, 0, 0, 6]);
        expect(buffer.getStringUtf8(0, BIG_ENDIAN)).toBe('hé€');
        expect(buffer.putStringUtf8(0, 'abc', 3)).toBe(7);
        expect(buffer.putStringUtf8(0, 'abc', BIG_ENDIAN, 3)).toBe(7);
        expect(bytesOf(buffer, 0, 4)).toEqual([0, 0, 0, 3]);
        expect(assertThrows(IllegalArgumentException, () => buffer.putStringUtf8(0, 'abcd', 3)).message).toBe(
            'Encoded string larger than maximum size: 3',
        );
        expect(() => buffer.putStringUtf8(0, 'abcd', BIG_ENDIAN, 3)).toThrow(IllegalArgumentException);
        expect(buffer.putStringUtf8(0, null)).toBe(8);
        expect(buffer.getStringUtf8(0)).toBe('null');
        expect(buffer.putStringUtf8(0, null, BIG_ENDIAN)).toBe(8);
        expect(buffer.putStringUtf8(0, '')).toBe(4);
        expect(buffer.getStringUtf8(0)).toBe('');
        expect(buffer.getStringUtf8(0, BIG_ENDIAN)).toBe('');
        expect(buffer.getStringUtf8(0, 0)).toBe('');
        expect(buffer.getStringWithoutLengthUtf8(0, 0)).toBe('');
        expect(buffer.putStringWithoutLengthUtf8(0, 'hé')).toBe(3);
        expect(buffer.getStringWithoutLengthUtf8(0, 3)).toBe('hé');
        expect(buffer.putStringWithoutLengthUtf8(0, null)).toBe(4);
        expect(buffer.getStringWithoutLengthUtf8(0, 4)).toBe('null');
        // a leading byte order mark is kept
        buffer.putBytes(0, new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
        expect(buffer.getStringWithoutLengthUtf8(0, 4)).toBe('﻿a');
    });

    it('aLoneSurrogateIsEncodedAsAQuestionMarkAsJavaDoes', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(32));

        expect(buffer.putStringUtf8(0, 'a\ud800b')).toBe(4 + 3);
        expect(bytesOf(buffer, 4, 3)).toEqual([0x61, 0x3f, 0x62]);
        expect(buffer.putStringUtf8(0, 'a\udc00b', BIG_ENDIAN)).toBe(7);
        expect(bytesOf(buffer, 4, 3)).toEqual([0x61, 0x3f, 0x62]);
        expect(buffer.putStringWithoutLengthUtf8(0, 'a\ud800')).toBe(2);
        expect(bytesOf(buffer, 0, 2)).toEqual([0x61, 0x3f]);
        expect(buffer.putStringWithoutLengthUtf8(0, '𐀀')).toBe(4);
        expect(bytesOf(buffer, 0, 4)).toEqual([0xf0, 0x90, 0x80, 0x80]);
        expect(buffer.putStringUtf8(0, 'x\udc00\ud800y', 9)).toBe(4 + 4);
        expect(bytesOf(buffer, 4, 4)).toEqual([0x78, 0x3f, 0x3f, 0x79]);
    });

    it('asciiDigitsAroundTheDigitCountBoundaries', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        const values = [
            0, 1, 9, 10, 99, 100, 9999, 10000, 99999999, 100000000, 100000001, 999999999999, 123456789012,
            999999999999999, 1000000000000000, 4503599627370496, 9007199254740991,
        ];
        for (const value of values) {
            for (const v of [value, -value]) {
                const length = buffer.putLongAscii(3, v);
                expect(buffer.getStringWithoutLengthAscii(3, length)).toBe(String(v));
                expect(buffer.parseLongAscii(3, length)).toBe(v + 0);
            }
            const natural = buffer.putNaturalLongAscii(3, value);
            expect(buffer.getStringWithoutLengthAscii(3, natural)).toBe(String(value));
            expect(buffer.parseNaturalLongAscii(3, natural)).toBe(value);
        }
        for (const value of [
            0, 9, 10, 99, 10000, 99999999, 100000000, 2147483647, -1, -2147483648, -99999999, -100000000,
        ]) {
            const length = buffer.putIntAscii(3, value);
            expect(buffer.getStringWithoutLengthAscii(3, length)).toBe(String(value));
            expect(buffer.parseIntAscii(3, length)).toBe(value);
            if (value >= 0) {
                const natural = buffer.putNaturalIntAscii(3, value);
                expect(natural).toBe(length);
                expect(buffer.parseNaturalIntAscii(3, natural)).toBe(value);
            }
        }
    });

    it('parseLongAsciiOutsideTheSafeRangeCarriesTheExactValue', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        const cases: [string, bigint][] = [
            ['9007199254740992', 9007199254740992n],
            ['-9007199254740992', -9007199254740992n],
            ['123456789012345678', 123456789012345678n],
            ['-123456789012345678', -123456789012345678n],
            ['1000000000000000000', 1000000000000000000n],
            ['9223372036854775807', 9223372036854775807n],
            ['9223372036854775806', 9223372036854775806n],
            ['-9223372036854775807', -9223372036854775807n],
            ['-9223372036854775808', -9223372036854775808n],
            ['8000000000000000000', 8000000000000000000n],
        ];
        for (const [text, expected] of cases) {
            const length = buffer.putStringWithoutLengthAscii(5, text);
            expect(assertThrows(LongOverflowError, () => buffer.parseLongAscii(5, length)).value).toBe(expected);
            if (!text.startsWith('-')) {
                expect(assertThrows(LongOverflowError, () => buffer.parseNaturalLongAscii(5, length)).value).toBe(
                    expected,
                );
            }
        }
        const length = buffer.putStringWithoutLengthAscii(5, '0009007199254740991');
        expect(buffer.parseLongAscii(5, length)).toBe(Long.MAX_VALUE);
        expect(buffer.parseNaturalLongAscii(5, length)).toBe(Long.MAX_VALUE);
        const negative = buffer.putStringWithoutLengthAscii(5, '-0009007199254740991');
        expect(buffer.parseLongAscii(5, negative)).toBe(Long.MIN_VALUE);
        const eight = buffer.putStringWithoutLengthAscii(5, '12345678');
        expect(buffer.parseLongAscii(5, eight)).toBe(12345678);
        const twelve = buffer.putStringWithoutLengthAscii(5, '123456789012');
        expect(buffer.parseLongAscii(5, twelve)).toBe(123456789012);
        expect(buffer.parseNaturalLongAscii(5, twelve)).toBe(123456789012);
    });

    it('putNaturalPaddedIntAscii', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        buffer.putNaturalPaddedIntAscii(2, 5, 42);
        expect(buffer.getStringWithoutLengthAscii(2, 5)).toBe('00042');
        buffer.putNaturalPaddedIntAscii(0, 4, 0);
        expect(buffer.getStringWithoutLengthAscii(0, 4)).toBe('0000');
        buffer.putNaturalPaddedIntAscii(0, 10, 2147483647);
        expect(buffer.getStringWithoutLengthAscii(0, 10)).toBe('2147483647');
        expect(buffer.getByte(10)).toBe(0);
        buffer.putNaturalPaddedIntAscii(0, 5, 99999);
        expect(buffer.getStringWithoutLengthAscii(0, 5)).toBe('99999');
        expect(assertThrows(NumberFormatException, () => buffer.putNaturalPaddedIntAscii(0, 5, 123456)).message).toBe(
            'Cannot write 123456 in 5 bytes',
        );
        expect(() => buffer.putNaturalPaddedIntAscii(14, 5, 1)).toThrow(IndexOutOfBoundsException);
    });

    it('putNaturalIntAsciiFromEnd', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        expect(buffer.putNaturalIntAsciiFromEnd(1234, 10)).toBe(6);
        expect(buffer.getStringWithoutLengthAscii(6, 4)).toBe('1234');
        expect(buffer.putNaturalIntAsciiFromEnd(7, 3)).toBe(2);
        expect(() => buffer.putNaturalIntAsciiFromEnd(12345, 4)).toThrow(IndexOutOfBoundsException);
    });

    it('boundsAreCheckedOnEveryAccessor', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        const window = new UnsafeBuffer(buffer, 4, 8);
        const reads: [string, (b: UnsafeBuffer, i: number) => unknown, number][] = [
            ['getByte', (b, i) => b.getByte(i), 1],
            ['getShort', (b, i) => b.getShort(i), 2],
            ['getChar', (b, i) => b.getChar(i), 2],
            ['getInt', (b, i) => b.getInt(i), 4],
            ['getLong', (b, i) => b.getLong(i), 8],
            ['getLongBigInt', (b, i) => b.getLongBigInt(i), 8],
            ['getFloat', (b, i) => b.getFloat(i), 4],
            ['getDouble', (b, i) => b.getDouble(i), 8],
            ['getLongVolatile', (b, i) => b.getLongVolatile(i), 8],
            ['getIntVolatile', (b, i) => b.getIntVolatile(i), 4],
            ['getShortVolatile', (b, i) => b.getShortVolatile(i), 2],
            ['getCharVolatile', (b, i) => b.getCharVolatile(i), 2],
            ['getByteVolatile', (b, i) => b.getByteVolatile(i), 1],
            ['getLongAcquire', (b, i) => b.getLongAcquire(i), 8],
            ['getIntAcquire', (b, i) => b.getIntAcquire(i), 4],
            ['getLongOpaque', (b, i) => b.getLongOpaque(i), 8],
            ['getIntOpaque', (b, i) => b.getIntOpaque(i), 4],
            ['putByte', (b, i) => b.putByte(i, 1), 1],
            ['putShort', (b, i) => b.putShort(i, 1), 2],
            ['putChar', (b, i) => b.putChar(i, 1), 2],
            ['putInt', (b, i) => b.putInt(i, 1), 4],
            ['putLong', (b, i) => b.putLong(i, 1), 8],
            ['putLongBigInt', (b, i) => b.putLongBigInt(i, 1n), 8],
            ['putFloat', (b, i) => b.putFloat(i, 1), 4],
            ['putDouble', (b, i) => b.putDouble(i, 1), 8],
            ['putLongRelease', (b, i) => b.putLongRelease(i, 1), 8],
            ['putIntRelease', (b, i) => b.putIntRelease(i, 1), 4],
            ['putLongOpaque', (b, i) => b.putLongOpaque(i, 1), 8],
            ['putIntOpaque', (b, i) => b.putIntOpaque(i, 1), 4],
            ['putShortVolatile', (b, i) => b.putShortVolatile(i, 1), 2],
            ['putCharVolatile', (b, i) => b.putCharVolatile(i, 1), 2],
            ['putByteVolatile', (b, i) => b.putByteVolatile(i, 1), 1],
            ['addLongRelease', (b, i) => b.addLongRelease(i, 1), 8],
            ['addIntRelease', (b, i) => b.addIntRelease(i, 1), 4],
            ['addLongOpaque', (b, i) => b.addLongOpaque(i, 1), 8],
            ['addIntOpaque', (b, i) => b.addIntOpaque(i, 1), 4],
            ['compareAndSetLong', (b, i) => b.compareAndSetLong(i, 0, 1), 8],
            ['compareAndSetInt', (b, i) => b.compareAndSetInt(i, 0, 1), 4],
            ['compareAndExchangeLong', (b, i) => b.compareAndExchangeLong(i, 0, 1), 8],
            ['compareAndExchangeInt', (b, i) => b.compareAndExchangeInt(i, 0, 1), 4],
            ['getAndSetLong', (b, i) => b.getAndSetLong(i, 1), 8],
            ['getAndSetInt', (b, i) => b.getAndSetInt(i, 1), 4],
            ['getAndAddLong', (b, i) => b.getAndAddLong(i, 1), 8],
            ['getAndAddInt', (b, i) => b.getAndAddInt(i, 1), 4],
        ];
        for (const target of [buffer, window]) {
            const capacity = target.capacity();
            for (const [name, access, width] of reads) {
                buffer.setMemory(0, 16, 0);
                expect(() => access(target, capacity - width), name).not.toThrow();
                expect(() => access(target, capacity - width + 1), name).toThrow(IndexOutOfBoundsException);
                expect(() => access(target, capacity), name).toThrow(IndexOutOfBoundsException);
                expect(() => access(target, -1), name).toThrow(IndexOutOfBoundsException);
            }
        }
        // nothing outside the window is touched
        window.putLong(0, 0x0102030405);
        expect(buffer.getByte(3)).toBe(0);
        expect(buffer.getByte(12)).toBe(0);
    });

    it('boundsAreCheckedOnBulkAndStringAccessors', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        const dst = new Uint8Array(4);
        expect(() => buffer.getBytes(12, dst)).not.toThrow();
        expect(() => buffer.getBytes(13, dst)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(-1, dst)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(0, dst, 1, 4)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(0, dst, -1, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(0, dst, 0, 5)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(14, dst, 0, 3)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getBytes(0, dst, 4, 0)).not.toThrow();
        expect(() => buffer.putBytes(12, dst)).not.toThrow();
        expect(() => buffer.putBytes(13, dst)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(0, dst, 1, 4)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(0, dst, 0, 5)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(14, dst, 0, 3)).toThrow(IndexOutOfBoundsException);
        const other = new UnsafeBuffer(new Uint8Array(8));
        expect(() => buffer.putBytes(0, other, 1, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(9, other, 0, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(0, other, -1, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putBytes(8, other, 0, 8)).not.toThrow();
        expect(() => buffer.getBytes(0, other, 1, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.setMemory(8, 9, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.setMemory(-1, 1, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.setMemory(8, 8, 1)).not.toThrow();
        expect(() => buffer.putStringAscii(8, 'abcde')).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putStringAscii(8, 'abcd')).not.toThrow();
        expect(() => buffer.getStringAscii(13)).toThrow(IndexOutOfBoundsException);
        buffer.putInt(0, 100);
        expect(() => buffer.getStringAscii(0)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getStringUtf8(0)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getStringAscii(0, 13)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getStringAscii(0, 12)).not.toThrow();
        expect(() => buffer.getStringUtf8(0, 13)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getStringWithoutLengthAscii(0, 17)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.getStringWithoutLengthUtf8(1, 16)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putStringWithoutLengthAscii(15, 'ab')).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putStringWithoutLengthUtf8(15, 'ab')).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putStringUtf8(10, 'abc')).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.parseIntAscii(10, 7)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.parseLongAscii(10, 7)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.parseNaturalIntAscii(10, 7)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.parseNaturalLongAscii(10, 7)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putIntAscii(14, 123)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putLongAscii(14, 123)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putNaturalLongAscii(14, 123)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.putNaturalIntAscii(14, 123)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.boundsCheck(10, 7)).toThrow(IndexOutOfBoundsException);
        expect(() => buffer.boundsCheck(10, 6)).not.toThrow();
        expect(() => buffer.checkLimit(16)).not.toThrow();
        expect(() => buffer.checkLimit(17)).toThrow(IndexOutOfBoundsException);
        expect(assertThrows(IndexOutOfBoundsException, () => buffer.checkLimit(17)).message).toBe(
            'limit=17 is beyond capacity=16',
        );
        expect(() => buffer.getByte(buffer.capacity())).toThrow(IndexOutOfBoundsException);
    });

    it('parseAsciiOfAnEmptyRangeThrows', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(16));
        for (const parse of [
            (l: number) => buffer.parseIntAscii(0, l),
            (l: number) => buffer.parseLongAscii(0, l),
            (l: number) => buffer.parseNaturalIntAscii(0, l),
            (l: number) => buffer.parseNaturalLongAscii(0, l),
        ]) {
            expect(assertThrows(IndexOutOfBoundsException, () => parse(-1)).message).toContain('out of bounds');
            expect(() => parse(0)).toThrow(/empty string: index=0 length=0/);
        }
    });

    it('wrapOfADirectBufferReadsAndWritesThroughItsMemory', () => {
        const backing = new UnsafeBuffer(new Uint8Array(32));
        backing.putInt(8, 0x01020304);
        const other = new UnsafeBuffer(new Uint8Array(8));

        other.wrap(backing);
        expect(other.getInt(8)).toBe(0x01020304);
        other.putInt(0, 77);
        expect(backing.getInt(0)).toBe(77);

        other.wrap(backing, 8, 8);
        expect(other.capacity()).toBe(8);
        expect(other.getInt(0)).toBe(0x01020304);
        other.putInt(4, 99);
        expect(backing.getInt(12)).toBe(99);
        expect(other.wrapAdjustment()).toBe(8);
        expect(other.addressOffset()).toBe(8);

        const arrayBuffer = new ArrayBuffer(16);
        new DataView(arrayBuffer).setInt32(4, 5, true);
        other.wrap(arrayBuffer, 4, 8);
        expect(other.getInt(0)).toBe(5);
        other.wrap(new Uint8Array(arrayBuffer, 4, 8));
        expect(other.getInt(0)).toBe(5);
        expect(other.wrapAdjustment()).toBe(0);
    });

    it('wrapOfAForeignDirectBufferCreatesTheViewOverItsArray', () => {
        const array = new Uint8Array(24);
        array[12] = 0x7e;
        const foreign = {
            capacity: () => 16,
            addressOffset: () => 8,
            byteArray: () => array,
            wrapAdjustment: () => 8,
        } as unknown as DirectBuffer;
        const buffer = new UnsafeBuffer(new Uint8Array(4));

        buffer.wrap(foreign);

        expect(buffer.getByte(4)).toBe(0x7e);
        expect(buffer.byteArray()).toBe(array);
        buffer.putByte(5, 9);
        expect(array[13]).toBe(9);
    });

    it('wrapOfTheSameArrayBufferReusesTheViews', () => {
        const arrayBuffer = new ArrayBuffer(16);
        const buffer = new UnsafeBuffer(arrayBuffer);
        const array = buffer.byteArray();

        buffer.wrap(arrayBuffer);
        expect(buffer.byteArray()).toBe(array);
        buffer.wrap(arrayBuffer, 4, 8);
        expect(buffer.byteArray()).toBe(array);
        expect(buffer.capacity()).toBe(8);
        buffer.putByte(0, 3);
        expect(array[4]).toBe(3);

        const other = new ArrayBuffer(16);
        buffer.wrap(other);
        expect(buffer.byteArray()).not.toBe(array);
        buffer.putByte(1, 4);
        expect(new Uint8Array(other)[1]).toBe(4);
        expect(array[1]).toBe(0);
        // a view that is not the whole of its ArrayBuffer is not reused
        const part = new Uint8Array(arrayBuffer, 8, 8);
        buffer.wrap(part);
        buffer.wrap(arrayBuffer);
        expect(buffer.capacity()).toBe(16);
        expect(buffer.byteArray().byteLength).toBe(16);
    });

    it('equalsHashCodeAndCompareToMatchTheJavaDefinitions', () => {
        for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 31, 64, 100]) {
            const a = randomBytes(length);
            const b = a.slice();
            const x = new UnsafeBuffer(a);
            const y = new UnsafeBuffer(b);
            expect(x.hashCode()).toBe(referenceHashCode(a));
            expect(x.equals(y)).toBe(true);
            expect(x.compareTo(y)).toBe(0);
            for (let position = 0; position < length; position++) {
                const c = a.slice();
                c[position] = c[position]! ^ 0x80;
                const z = new UnsafeBuffer(c);
                expect(x.equals(z), `${length}/${position}`).toBe(false);
                expect(z.equals(x)).toBe(false);
                expect(x.compareTo(z), `${length}/${position}`).toBe(referenceCompare(a, c));
                expect(z.compareTo(x)).toBe(referenceCompare(c, a));
                expect(z.hashCode()).toBe(referenceHashCode(c));
                const d = a.slice();
                d[position] = d[position]! ^ 0x01;
                expect(x.equals(new UnsafeBuffer(d))).toBe(false);
                expect(x.compareTo(new UnsafeBuffer(d))).toBe(referenceCompare(a, d));
            }
        }
        for (let i = 0; i < 300; i++) {
            const a = randomBytes(Math.floor(Math.random() * 40));
            const b = randomBytes(Math.floor(Math.random() * 40));
            if (Math.random() < 0.5 && a.length > 0) {
                b.set(a.subarray(0, Math.min(a.length, b.length)));
            }
            expect(new UnsafeBuffer(a).compareTo(new UnsafeBuffer(b))).toBe(referenceCompare(a, b));
        }
    });

    it('compareToUsesTheUnsignedLowWordAndTheSignedHighWordOfEachLong', () => {
        const lowHigh = new UnsafeBuffer(new Uint8Array([0, 0, 0, 0x80, 0, 0, 0, 0]));
        const lowLow = new UnsafeBuffer(new Uint8Array([0, 0, 0, 0x7f, 0, 0, 0, 0]));
        expect(lowHigh.compareTo(lowLow)).toBe(1);
        expect(lowLow.compareTo(lowHigh)).toBe(-1);
        const negative = new UnsafeBuffer(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0x80]));
        const positive = new UnsafeBuffer(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0x7f]));
        expect(negative.compareTo(positive)).toBe(-1);
        expect(positive.compareTo(negative)).toBe(1);
        // the tail is compared as signed bytes, to the difference
        const tailA = new UnsafeBuffer(new Uint8Array([0x80]));
        const tailB = new UnsafeBuffer(new Uint8Array([0x7f]));
        expect(tailA.compareTo(tailB)).toBe(-128 - 127);
        expect(tailB.compareTo(tailA)).toBe(255);
    });

    it('equalsComparesEveryByteOfEveryLong', () => {
        for (let position = 0; position < 16; position++) {
            const a = new UnsafeBuffer(new Uint8Array(16));
            const b = new UnsafeBuffer(new Uint8Array(16));
            b.putByte(position, 1);
            expect(a.equals(b), String(position)).toBe(false);
            expect(b.equals(a), String(position)).toBe(false);
        }
        const x = new UnsafeBuffer(new Uint8Array(8));
        expect(x.equals(null)).toBe(false);
        expect(x.equals(undefined)).toBe(false);
        expect(x.equals({})).toBe(false);
        expect(x.equals(new UnsafeBuffer(new Uint8Array(8)))).toBe(true);
        expect(x.equals(new UnsafeBuffer(new Uint8Array(16), 4, 8))).toBe(true);
    });

    it('compareToAForeignDirectBuffer', () => {
        const array = new Uint8Array([9, 1, 2, 3]);
        const foreign = {
            capacity: () => 3,
            addressOffset: () => 1,
            byteArray: () => array,
            wrapAdjustment: () => 1,
        } as unknown as DirectBuffer;

        expect(new UnsafeBuffer(new Uint8Array([1, 2, 3])).compareTo(foreign)).toBe(0);
        expect(new UnsafeBuffer(new Uint8Array([1, 2, 4])).compareTo(foreign)).toBe(1);
    });

    it('setMemoryFillsTheRegionOnlyAndGetBytesCopiesItBack', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        buffer.setMemory(3, 20, 0xab);
        expect(buffer.getByte(2)).toBe(0);
        expect(buffer.getByte(3)).toBe(-85);
        expect(buffer.getByte(22)).toBe(-85);
        expect(buffer.getByte(23)).toBe(0);
        buffer.setMemory(0, 0, 1);
        expect(buffer.getByte(0)).toBe(0);
        const copy = new Uint8Array(8);
        buffer.getBytes(1, copy, 2, 6);
        expect(Array.from(copy)).toEqual([0, 0, 0, 0, 0xab, 0xab, 0xab, 0xab]);
    });

    it('verifyAlignmentReportsTheCheckedOffsetInJavasFormat', () => {
        const arrayBuffer = new ArrayBuffer(64);
        expect(() => new UnsafeBuffer(arrayBuffer, 8, 8).verifyAlignment()).not.toThrow();
        expect(() => new UnsafeBuffer(arrayBuffer, 16, 8).verifyAlignment()).not.toThrow();
        const error = assertThrows(IllegalStateException, () => new UnsafeBuffer(arrayBuffer, 12, 8).verifyAlignment());
        expect(error.message).toBe('AtomicBuffer is not correctly aligned: addressOffset=12 is not divisible by 8');
        // the byteOffset of a Uint8Array view counts: 4 + 0 is not aligned, 4 + 4 and 8 + 0 are
        const view = new Uint8Array(arrayBuffer, 4, 32);
        expect(assertThrows(IllegalStateException, () => new UnsafeBuffer(view, 0, 8).verifyAlignment()).message).toBe(
            'AtomicBuffer is not correctly aligned: addressOffset=4 is not divisible by 8',
        );
        expect(() => new UnsafeBuffer(view, 4, 8).verifyAlignment()).not.toThrow();
        expect(() => new UnsafeBuffer(new Uint8Array(arrayBuffer, 8, 32), 0, 8).verifyAlignment()).not.toThrow();
        expect(() => new UnsafeBuffer(new Uint8Array(arrayBuffer, 8, 32), 8, 8).verifyAlignment()).not.toThrow();
        expect(() => new UnsafeBuffer(new Uint8Array(arrayBuffer, 8, 32), 1, 8).verifyAlignment()).toThrow(
            IllegalStateException,
        );
    });

    it('toStringIsJavasText', () => {
        expect(new UnsafeBuffer(new Uint8Array(10), 2, 5).toString()).toBe(
            'UnsafeBuffer{addressOffset=2, capacity=5, byteArray=byte[10], byteBuffer=null}',
        );
        expect(new UnsafeBuffer().toString()).toBe(
            'UnsafeBuffer{addressOffset=0, capacity=0, byteArray=byte[0], byteBuffer=null}',
        );
    });

    it('theEmptyBufferHasNoCapacityAndTheConstantsAreJavas', () => {
        const buffer = new UnsafeBuffer();
        expect(buffer.capacity()).toBe(0);
        expect(buffer.isExpandable()).toBe(false);
        expect(() => buffer.getByte(0)).toThrow(IndexOutOfBoundsException);
        expect(UnsafeBuffer.ALIGNMENT).toBe(8);
        expect(UnsafeBuffer.SHOULD_BOUNDS_CHECK).toBe(true);
        expect(UnsafeBuffer.DISABLE_BOUNDS_CHECKS_PROP_NAME).toBe('agrona.disable.bounds.checks');
    });
});

describe('BufferUtilExtra', () => {
    it('constantsAndBoundsCheck', () => {
        expect(new TextDecoder().decode(BufferUtil.NULL_BYTES)).toBe('null');
        expect(BufferUtil.NATIVE_BYTE_ORDER).toBe(LITTLE_ENDIAN);
        expect(BufferUtil.ARRAY_BASE_OFFSET).toBe(0);
        const array = new Uint8Array(8);
        expect(() => BufferUtil.boundsCheck(array, 0, 8)).not.toThrow();
        expect(() => BufferUtil.boundsCheck(array, 8, 0)).not.toThrow();
        expect(() => BufferUtil.boundsCheck(array, 1, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => BufferUtil.boundsCheck(array, -1, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => BufferUtil.boundsCheck(array, 0, -1)).toThrow(IndexOutOfBoundsException);
    });

    it('allocateDirectAligned', () => {
        expect(BufferUtil.allocateDirectAligned(0, 1).byteLength).toBe(0);
        expect(BufferUtil.allocateDirectAligned(99, 64).byteLength).toBe(99);
        expect(assertThrows(IllegalArgumentException, () => BufferUtil.allocateDirectAligned(8, 0)).message).toBe(
            'Must be a power of 2: alignment=0',
        );
        expect(() => BufferUtil.allocateDirectAligned(8, -8)).toThrow(IllegalArgumentException);
        expect(() => BufferUtil.allocateDirectAligned(8, 12)).toThrow(IllegalArgumentException);
    });
});
