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
// Port of org/agrona/AsciiEncodingTest.java @ Agrona 2.6.1
import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { AsciiEncoding } from '../../src/agrona/AsciiEncoding.js';
import { AsciiNumberFormatException } from '../../src/agrona/AsciiNumberFormatException.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Integer, Long, ThreadLocalRandom } from '../../src/agrona/jdk.js';

const {
    INT_MAX_DIGITS,
    LONG_MAX_DIGITS,
    INT_POW_10,
    LONG_POW_10,
    digitCount,
    digitCountLong,
    getDigit,
    isDigit,
    isEightDigitAsciiEncodedNumber,
    isFourDigitsAsciiEncodedNumber,
    parseEightDigitsLittleEndian,
    parseFourDigitsLittleEndian,
    parseIntAscii,
    parseLongAscii,
} = AsciiEncoding;

const { BIG_ENDIAN, LITTLE_ENDIAN } = ByteOrder;

const ITERATIONS = 1_000_000;

const BYTE_MIN_VALUE = -128;
const BYTE_MAX_VALUE = 127;

/** A Java `byte` / `char` literal such as `'0'`. */
const c = (ch: string): number => ch.charCodeAt(0);

describe('AsciiEncodingTest', () => {
    it('shouldParseInt', () => {
        expect(parseIntAscii('0', 0, 1)).toBe(0);
        expect(parseIntAscii('-0', 0, 2)).toBe(0);
        expect(parseIntAscii('7', 0, 1)).toBe(7);
        expect(parseIntAscii('-7', 0, 2)).toBe(-7);
        expect(parseIntAscii('3333', 1, 2)).toBe(33);
        expect(parseIntAscii('-123456789', 0, 10)).toBe(-123456789);

        const maxValueMinusOne = String(Integer.MAX_VALUE - 1);
        expect(parseIntAscii(maxValueMinusOne, 0, maxValueMinusOne.length)).toBe(Integer.MAX_VALUE - 1);

        const maxValue = String(Integer.MAX_VALUE);
        expect(parseIntAscii(maxValue, 0, maxValue.length)).toBe(Integer.MAX_VALUE);

        const minValuePlusOne = String(Integer.MIN_VALUE + 1);
        expect(parseIntAscii(minValuePlusOne, 0, minValuePlusOne.length)).toBe(Integer.MIN_VALUE + 1);

        const minValue = String(Integer.MIN_VALUE);
        expect(parseIntAscii(minValue, 0, minValue.length)).toBe(Integer.MIN_VALUE);
    });

    it('shouldParseLong', () => {
        expect(parseLongAscii('0', 0, 1)).toBe(0);
        expect(parseLongAscii('-0', 0, 2)).toBe(0);
        expect(parseLongAscii('7', 0, 1)).toBe(7);
        expect(parseLongAscii('-7', 0, 2)).toBe(-7);
        expect(parseLongAscii('3333', 1, 2)).toBe(33);
        // adapted: -123456789876543210 is below -(2^53 - 1), so 16 digits are used
        expect(parseLongAscii('-1234567898765432', 0, 17)).toBe(-1234567898765432);

        // adapted: a long is exact to 2^53 - 1, so Long.MAX_VALUE and Long.MIN_VALUE are the bounds of the safe range
        const maxValueMinusOne = String(Long.MAX_VALUE - 1);
        expect(parseLongAscii(maxValueMinusOne, 0, maxValueMinusOne.length)).toBe(Long.MAX_VALUE - 1);

        const maxValue = String(Long.MAX_VALUE);
        expect(parseLongAscii(maxValue, 0, maxValue.length)).toBe(Long.MAX_VALUE);

        const minValuePlusOne = String(Long.MIN_VALUE + 1);
        expect(parseLongAscii(minValuePlusOne, 0, minValuePlusOne.length)).toBe(Long.MIN_VALUE + 1);

        const minValue = String(Long.MIN_VALUE);
        expect(parseLongAscii(minValue, 0, minValue.length)).toBe(Long.MIN_VALUE);

        // adapted: the 64-bit values of the Java test (19 digits, the overflow-check path) parse, then are refused
        expect(() => parseLongAscii('-123456789876543210', 0, 19)).toThrow(RangeError);
        expect(() => parseLongAscii('9223372036854775806', 0, 19)).toThrow(RangeError);
        expect(() => parseLongAscii('9223372036854775807', 0, 19)).toThrow(RangeError);
        expect(() => parseLongAscii('-9223372036854775807', 0, 20)).toThrow(RangeError);
        expect(() => parseLongAscii('-9223372036854775808', 0, 20)).toThrow(RangeError);
    });

    it('shouldThrowExceptionWhenParsingIntegerWhichCanOverFlow', () => {
        const maxValuePlusOneDigit = Integer.MAX_VALUE + '1';
        expect(() => parseIntAscii(maxValuePlusOneDigit, 0, maxValuePlusOneDigit.length)).toThrow(
            AsciiNumberFormatException,
        );

        const maxValuePlusOne = '2147483648';
        expect(() => parseIntAscii(maxValuePlusOne, 0, maxValuePlusOne.length)).toThrow(AsciiNumberFormatException);

        const minValuePlusOneDigit = Integer.MIN_VALUE + '1';
        expect(() => parseIntAscii(minValuePlusOneDigit, 0, minValuePlusOneDigit.length)).toThrow(
            AsciiNumberFormatException,
        );

        const minValueMinusOne = '-2147483649';
        expect(() => parseIntAscii(minValueMinusOne, 0, minValueMinusOne.length)).toThrow(AsciiNumberFormatException);
    });

    it('shouldRejectNonAsciiCharsWhoseLowByteLooksLikeADigit', () => {
        // U+0130 / U+0132 have digit low bytes (0x30 / 0x32); narrowing to byte
        // would accept them as digits, so they must be rejected like getDigit is.
        expect(isDigit(c('İ'))).toBe(false);
        expect(() => getDigit(0, c('İ'))).toThrow(AsciiNumberFormatException);

        expect(() => parseIntAscii('İ', 0, 1)).toThrow(AsciiNumberFormatException);
        expect(() => parseIntAscii('1Ĳ', 0, 2)).toThrow(AsciiNumberFormatException);
        expect(() => parseLongAscii('İ', 0, 1)).toThrow(AsciiNumberFormatException);
        // 10-digit int / 19-digit long tails exercise the overflow-check paths.
        expect(() => parseIntAscii('123456789İ', 0, 10)).toThrow(AsciiNumberFormatException);
        expect(() => parseLongAscii('123456789012345678İ', 0, 19)).toThrow(AsciiNumberFormatException);
    });

    it('shouldThrowExceptionWhenParsingLongWhichCanOverFlow', () => {
        const maxValuePlusOneDigit = '9223372036854775807' + '1';
        expect(() => parseLongAscii(maxValuePlusOneDigit, 0, maxValuePlusOneDigit.length)).toThrow(
            AsciiNumberFormatException,
        );

        const maxValuePlusOne = '9223372036854775808';
        expect(() => parseLongAscii(maxValuePlusOne, 0, maxValuePlusOne.length)).toThrow(AsciiNumberFormatException);

        const minValuePlusOneDigit = '-9223372036854775808' + '1';
        expect(() => parseLongAscii(minValuePlusOneDigit, 0, minValuePlusOneDigit.length)).toThrow(
            AsciiNumberFormatException,
        );

        const minValueMinusOne = '-9223372036854775809';
        expect(() => parseLongAscii(minValueMinusOne, 0, minValueMinusOne.length)).toThrow(AsciiNumberFormatException);
    });

    it('shouldThrowExceptionWhenDecodingCharNonNumericValue', () => {
        expect(() => AsciiEncoding.getDigit(0, c('a'))).toThrow(AsciiNumberFormatException);
    });

    it('shouldThrowExceptionWhenDecodingByteNonNumericValue', () => {
        expect(() => AsciiEncoding.getDigit(0, c('a'))).toThrow(AsciiNumberFormatException);
    });

    it.each([c('0'), c('1'), c('2'), c('3'), c('4'), c('5'), c('6'), c('7'), c('8'), c('9')])(
        'getDigitFromByte %s',
        (value) => {
            expect(AsciiEncoding.getDigit(0, value)).toBe(value - 0x30);
        },
    );

    it.each([c('0'), c('1'), c('2'), c('3'), c('4'), c('5'), c('6'), c('7'), c('8'), c('9')])(
        'getDigitFromChar %s',
        (value) => {
            expect(AsciiEncoding.getDigit(0, value)).toBe(value - 0x30);
        },
    );

    it('shouldThrowExceptionWhenParsingIntegerContainingLoneMinusSign', () => {
        expect(() => parseIntAscii('-', 0, 1)).toThrow(AsciiNumberFormatException);
    });

    it('shouldThrowExceptionWhenParsingLongContainingLoneMinusSign', () => {
        expect(() => parseLongAscii('-', 0, 1)).toThrow(AsciiNumberFormatException);
    });

    it('shouldThrowExceptionWhenParsingLongContainingLonePlusSign', () => {
        expect(() => parseLongAscii('+', 0, 1)).toThrow(AsciiNumberFormatException);
    });

    it.each([-3, 0])('shouldThrowExceptionWhenParsingEmptyInteger %s', (length) => {
        expect(() => parseIntAscii('123', 0, length)).toThrow(AsciiNumberFormatException);
    });

    it.each([-1, 0])('shouldThrowExceptionWhenParsingEmptyLong %s', (length) => {
        expect(() => parseLongAscii('900000', 0, length)).toThrow(AsciiNumberFormatException);
    });

    it('digitCountIntValue', () => {
        for (let i = 0; i < INT_MAX_DIGITS; i++) {
            const min = 0 === i ? 0 : INT_POW_10[i]!;
            const max = INT_MAX_DIGITS - 1 === i ? Integer.MAX_VALUE : INT_POW_10[i + 1]! - 1;
            const expectedDigitCount = i + 1;
            expect(digitCount(min)).toBe(expectedDigitCount);
            expect(digitCount(min + 1)).toBe(expectedDigitCount);
            expect(digitCount((min + (max - min)) >>> 1)).toBe(expectedDigitCount);
            expect(digitCount(max - 1)).toBe(expectedDigitCount);
            expect(digitCount(max)).toBe(expectedDigitCount);
        }
    });

    it('digitCountLongValue', () => {
        // adapted: the values are bigints, since 19 digits do not fit in a number; `>>>` on a positive long is `>>`
        for (let i = 0; i < LONG_MAX_DIGITS; i++) {
            const min = 0 === i ? 0n : BigInt(LONG_POW_10[i]!);
            const max = LONG_MAX_DIGITS - 1 === i ? 0x7fffffffffffffffn : BigInt(LONG_POW_10[i + 1]!) - 1n;
            const expectedDigitCount = i + 1;
            expect(digitCountLong(min)).toBe(expectedDigitCount);
            expect(digitCountLong(min + 1n)).toBe(expectedDigitCount);
            expect(digitCountLong((min + (max - min)) >> 1n)).toBe(expectedDigitCount);
            expect(digitCountLong(max - 1n)).toBe(expectedDigitCount);
            expect(digitCountLong(max)).toBe(expectedDigitCount);
        }
    });

    it('shouldDetectFourDigitsAsciiEncodedNumbers', () => {
        const index = 2;
        const buffer = new UnsafeBuffer(new Uint8Array(8));

        for (let i = 0; i < 1000; i++) {
            buffer.putIntAscii(index, i);
            expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, LITTLE_ENDIAN))).toBe(false);
            expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, BIG_ENDIAN))).toBe(false);
        }

        for (let i = 1000; i < 10000; i++) {
            buffer.putIntAscii(index, i);
            expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, LITTLE_ENDIAN))).toBe(true);
            expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, BIG_ENDIAN))).toBe(true);
        }

        buffer.putIntAscii(index, 1234);
        buffer.putByte(index, c('a'));
        expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, LITTLE_ENDIAN))).toBe(false);
        expect(isFourDigitsAsciiEncodedNumber(buffer.getInt(index, BIG_ENDIAN))).toBe(false);
    });

    it('shouldParseFourDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder', () => {
        const index = 2;
        const buffer = new UnsafeBuffer(new Uint8Array(8));

        for (let i = 1000; i < 10000; i++) {
            buffer.putIntAscii(index, i);
            const bytes = buffer.getInt(index, LITTLE_ENDIAN);
            expect(parseFourDigitsLittleEndian(bytes)).toBe(i);
        }
    });

    // adapted: the eight bytes are read with getLongBigInt, as 8 ASCII digits are above 2^53 - 1; node:assert instead of
    // expect in the loop, which costs 10 s for 810,811 iterations
    it('shouldDetectEightDigitsAsciiEncodedNumbers', () => {
        const index = 4;
        const buffer = new UnsafeBuffer(new Uint8Array(16));

        buffer.putIntAscii(index, 1234);
        assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, LITTLE_ENDIAN)), false);
        assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, BIG_ENDIAN)), false);

        for (let i = 10_000_000; i < 100_000_000; i += 111) {
            buffer.putLongAscii(index, i);
            assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, LITTLE_ENDIAN)), true);
            assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, BIG_ENDIAN)), true);
        }

        buffer.putByte(index, c('a'));
        assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, LITTLE_ENDIAN)), false);
        assert.strictEqual(isEightDigitAsciiEncodedNumber(buffer.getLongBigInt(index, BIG_ENDIAN)), false);
    });

    // adapted: as shouldDetectEightDigitsAsciiEncodedNumbers, node:assert for 810,811 iterations
    it('shouldParseEightDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder', () => {
        const index = 3;
        const buffer = new UnsafeBuffer(new Uint8Array(16));

        for (let i = 10_000_000; i < 100_000_000; i += 111) {
            buffer.putIntAscii(index, i);
            const bytes = buffer.getLongBigInt(index, LITTLE_ENDIAN);
            assert.strictEqual(parseEightDigitsLittleEndian(bytes), i);
        }
    });

    it.each([c('0'), c('1'), c('2'), c('3'), c('4'), c('5'), c('6'), c('7'), c('8'), c('9')])(
        'isDigitReturnsTrueForAsciiEncodedDigits %s',
        (value) => {
            expect(isDigit(value)).toBe(true);
        },
    );

    it('isDigitReturnsFalseForAnyOtherByte', () => {
        for (let i = BYTE_MIN_VALUE; i <= BYTE_MAX_VALUE; i++) {
            const value = i;
            if (value >= 0x30 && value <= 0x39) {
                continue;
            }
            expect(isDigit(value), Integer.toHexString(value)).toBe(false);
        }
    });

    it('parseIntAsciiRoundTrip', () => {
        const prefix = 'testInt';
        let buffer = prefix;

        for (let i = 0; i < ITERATIONS; i++) {
            const value = ThreadLocalRandom.current().nextInt();
            buffer += value;

            const parsedValue = parseIntAscii(buffer, prefix.length, buffer.length - prefix.length);

            // adapted: node:assert instead of expect, which costs 6 s over the 1,000,000 iterations
            assert.strictEqual(value, parsedValue);
            buffer = buffer.substring(0, prefix.length);
        }
    });

    it('parseLongAsciiRoundTrip', () => {
        const prefix = 'long to test';
        let buffer = prefix;

        for (let i = 0; i < ITERATIONS; i++) {
            // adapted: a random 64-bit long, shifted right by a random amount so that every digit count occurs;
            // values outside +/-(2^53 - 1) are parsed in full and then refused with a RangeError
            const random = BigInt.asIntN(
                64,
                (BigInt(ThreadLocalRandom.current().nextInt() >>> 0) << 32n) |
                    BigInt(ThreadLocalRandom.current().nextInt() >>> 0),
            );
            const value = random >> BigInt(ThreadLocalRandom.current().nextInt() & 63);
            buffer += value;

            if (value >= -BigInt(Long.MAX_VALUE) && value <= BigInt(Long.MAX_VALUE)) {
                const parsedValue = parseLongAscii(buffer, prefix.length, buffer.length - prefix.length);

                assert.strictEqual(Number(value), parsedValue);
            } else {
                assert.throws(() => parseLongAscii(buffer, prefix.length, buffer.length - prefix.length), RangeError);
            }
            buffer = buffer.substring(0, prefix.length);
        }
    });
});
