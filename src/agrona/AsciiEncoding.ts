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
// Port of org/agrona/AsciiEncoding.java @ Agrona 2.6.1
import { AsciiNumberFormatException } from './AsciiNumberFormatException.js';
import { Integer, Long, longToNumber, longValueExact } from './jdk.js';

const US_ASCII = new TextEncoder();

/**
 * Helper for dealing with ASCII encoding of numbers.
 * <p>
 * A Java `long` is a `number` that is exact to +/-(2^53 - 1): `parseLongAscii` parses the full 64-bit range and then
 * throws a `RangeError` for a value that a `number` cannot hold, and the SWAR helpers that take eight bytes at once
 * (`isEightDigitAsciiEncodedNumber`, `parseEightDigitsLittleEndian`) take a `bigint`. Java overloads on `int` and
 * `long` that a `number` cannot tell apart get the Java name with a `Long` suffix.
 */
export class AsciiEncoding {
    /**
     * Maximum number of digits in a US-ASCII-encoded int.
     */
    public static readonly INT_MAX_DIGITS = 10;

    /**
     * Maximum number of digits in a US-ASCII-encoded long.
     */
    public static readonly LONG_MAX_DIGITS = 19;

    /**
     * An absolute value of the {@link Integer#MIN_VALUE} as long.
     */
    public static readonly INTEGER_ABSOLUTE_MIN_VALUE = Math.abs(Integer.MIN_VALUE);

    /**
     * US-ASCII-encoded byte representation of the {@link Integer#MIN_VALUE}.
     */
    public static readonly MIN_INTEGER_VALUE: Uint8Array = US_ASCII.encode(String(Integer.MIN_VALUE));

    /**
     * US-ASCII-encoded byte representation of the {@link Integer#MAX_VALUE}.
     */
    public static readonly MAX_INTEGER_VALUE: Uint8Array = US_ASCII.encode(String(Integer.MAX_VALUE));

    /**
     * US-ASCII-encoded byte representation of the Java `Long.MIN_VALUE`, -2^63.
     */
    public static readonly MIN_LONG_VALUE: Uint8Array = US_ASCII.encode(String(-(2n ** 63n)));

    /**
     * US-ASCII-encoded byte representation of the Java `Long.MAX_VALUE`, 2^63 - 1.
     */
    public static readonly MAX_LONG_VALUE: Uint8Array = US_ASCII.encode(String(2n ** 63n - 1n));

    /**
     * Byte value of the minus sign ('{@code -}').
     */
    public static readonly MINUS_SIGN = '-'.charCodeAt(0);

    /**
     * Byte value of zero character ('{@code 0}').
     */
    public static readonly ZERO = '0'.charCodeAt(0);

    /**
     * Lookup table used for encoding ints/longs as ASCII characters.
     */
    // prettier-ignore
    public static readonly ASCII_DIGITS: Uint8Array = new Uint8Array([
        '0', '0', '0', '1', '0', '2', '0', '3', '0', '4', '0', '5', '0', '6', '0', '7', '0', '8', '0', '9',
        '1', '0', '1', '1', '1', '2', '1', '3', '1', '4', '1', '5', '1', '6', '1', '7', '1', '8', '1', '9',
        '2', '0', '2', '1', '2', '2', '2', '3', '2', '4', '2', '5', '2', '6', '2', '7', '2', '8', '2', '9',
        '3', '0', '3', '1', '3', '2', '3', '3', '3', '4', '3', '5', '3', '6', '3', '7', '3', '8', '3', '9',
        '4', '0', '4', '1', '4', '2', '4', '3', '4', '4', '4', '5', '4', '6', '4', '7', '4', '8', '4', '9',
        '5', '0', '5', '1', '5', '2', '5', '3', '5', '4', '5', '5', '5', '6', '5', '7', '5', '8', '5', '9',
        '6', '0', '6', '1', '6', '2', '6', '3', '6', '4', '6', '5', '6', '6', '6', '7', '6', '8', '6', '9',
        '7', '0', '7', '1', '7', '2', '7', '3', '7', '4', '7', '5', '7', '6', '7', '7', '7', '8', '7', '9',
        '8', '0', '8', '1', '8', '2', '8', '3', '8', '4', '8', '5', '8', '6', '8', '7', '8', '8', '8', '9',
        '9', '0', '9', '1', '9', '2', '9', '3', '9', '4', '9', '5', '9', '6', '9', '7', '9', '8', '9', '9',
    ].map((c) => c.charCodeAt(0)));

    /**
     * Java `Long.MAX_VALUE` split into components by 8 digits max.
     */
    public static readonly LONG_MAX_VALUE_DIGITS: Int32Array = new Int32Array([92233720, 36854775, 807]);

    /**
     * Java `Long.MIN_VALUE` split into components by 8 digits max.
     */
    public static readonly LONG_MIN_VALUE_DIGITS: Int32Array = new Int32Array([92233720, 36854775, 808]);

    /**
     * Power of ten for int values.
     */
    public static readonly INT_POW_10: readonly number[] = [
        1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000,
    ];

    /**
     * Power of ten for long values. Every entry is a power of ten that a `number` holds exactly.
     */
    public static readonly LONG_POW_10: readonly number[] = [
        1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000,
        100_000_000_000, 1_000_000_000_000, 10_000_000_000_000, 100_000_000_000_000, 1_000_000_000_000_000,
        10_000_000_000_000_000, 100_000_000_000_000_000, 1_000_000_000_000_000_000,
    ];

    private static readonly INT_DIGITS: number[] = new Array<number>(32).fill(0);

    private static readonly LONG_DIGITS: BigInt64Array = new BigInt64Array(64);

    static {
        for (let i = 1; i < 33; i++) {
            const smallest = 1 << (i - 1);
            // (long) cast of a NaN (the log of the negative 1 << 31) is 0
            const smallestLog10 = Math.ceil(Math.log10(smallest) / Math.log10(10)) || 0;
            if (1 === i) {
                AsciiEncoding.INT_DIGITS[i - 1] = 2 ** 32;
            } else if (i < 31) {
                AsciiEncoding.INT_DIGITS[i - 1] =
                    2 ** 32 - AsciiEncoding.LONG_POW_10[smallestLog10]! + smallestLog10 * 2 ** 32;
            } else {
                AsciiEncoding.INT_DIGITS[i - 1] = smallestLog10 * 2 ** 32;
            }
        }

        const tenToNineteen = 10n ** 19n;
        for (let i = 0; i < 64; i++) {
            if (0 === i) {
                AsciiEncoding.LONG_DIGITS[i] = 1n << 52n;
            } else {
                const upper = ((i * 1262611) >> 22) + 1;
                const correction =
                    upper < AsciiEncoding.LONG_MAX_DIGITS
                        ? BigInt(AsciiEncoding.LONG_POW_10[upper]!) >> BigInt(i >> 2)
                        : longValueExact(tenToNineteen >> BigInt(i >> 2));
                const value = (BigInt(upper + 1) << 52n) - correction;
                AsciiEncoding.LONG_DIGITS[i] = value;
            }
        }
    }

    private constructor() {}

    /**
     * Calling this method is equivalent of doing the following.
     * <pre>
     * {@code digitCount(value) - 1}
     * </pre>
     *
     * @param value to find the end encoded character offset.
     * @return the offset at which the encoded value will end.
     * @see #digitCount(int)
     * @deprecated Use {@link #digitCount(int)} instead.
     */
    public static endOffset(value: number): number {
        return AsciiEncoding.digitCount(value) - 1;
    }

    /**
     * Calling this method is equivalent of doing the following.
     * <pre>
     * {@code digitCountLong(value) - 1}
     * </pre>
     *
     * @param value to find the end encoded character offset.
     * @return the offset at which the encoded value will end.
     * @see #digitCountLong(long)
     * @deprecated Use {@link #digitCountLong(long)} instead.
     */
    public static endOffsetLong(value: number | bigint): number {
        return AsciiEncoding.digitCountLong(value) - 1;
    }

    /**
     * Count number of digits in a positive {@code int} value.
     *
     * <p>Implementation is based on the Kendall Willets' idea as presented in the
     * <a href="https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/"
     * target="_blank">Computing the number of digits of an integer even faster</a> blog post.
     *
     * @param value to count number of digits int.
     * @return number of digits in a number, e.g. if input value is {@code 123} then the result will be {@code 3}.
     */
    public static digitCount(value: number): number {
        return Math.floor((value + AsciiEncoding.INT_DIGITS[31 - Integer.numberOfLeadingZeros(value | 1)]!) / 2 ** 32);
    }

    /**
     * Count number of digits in a positive {@code long} value.
     *
     * <p>Implementation is based on the Kendall Willets' idea as presented in the
     * <a href="https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/"
     * target="_blank">Computing the number of digits of an integer even faster</a> blog post.
     *
     * @param value to count number of digits int, a `number` or a `bigint` for the values above 2^53 - 1.
     * @return number of digits in a number, e.g. if input value is {@code 12345678909876} then the result will be
     * {@code 14}.
     */
    public static digitCountLong(value: number | bigint): number {
        const v = typeof value === 'bigint' ? value : BigInt(value);
        const floorLog2 = 63 ^ Long.numberOfLeadingZeros(v | 1n);
        return Number((AsciiEncoding.LONG_DIGITS[floorLog2]! + (v >> BigInt(floorLog2 >> 2))) >> 52n);
    }

    /**
     * Check if the {@code value} is an ASCII-encoded digit.
     *
     * @param value to be checked, a byte or a char.
     * @return {@code true} if the {@code value} is an ASCII-encoded digit.
     */
    public static isDigit(value: number): boolean {
        return value >= 0x30 && value <= 0x39;
    }

    /**
     * Get the digit value of an ASCII encoded {@code byte} or {@code char}.
     *
     * @param index within the string the value is encoded.
     * @param value of the encoding in ASCII.
     * @return the digit value of the encoded ASCII.
     * @throws AsciiNumberFormatException if the value is not a digit.
     */
    public static getDigit(index: number, value: number): number {
        if (value < 0x30 || value > 0x39) {
            throw new AsciiNumberFormatException(
                "'" + String.fromCharCode(value & 0xffff) + "' is not a valid digit @ " + index,
            );
        }

        return value - 0x30;
    }

    /**
     * Parse an ASCII encoded int from a {@link CharSequence}.
     *
     * @param cs     to parse.
     * @param index  at which the number begins.
     * @param length of the encoded number in characters.
     * @return the parsed value.
     * @throws AsciiNumberFormatException if {@code length <= 0} or {@code cs} is not an int value
     */
    public static parseIntAscii(cs: string, index: number, length: number): number {
        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        const negative = AsciiEncoding.MINUS_SIGN === cs.charCodeAt(index);
        let i = index;
        if (negative) {
            i++;
            if (1 === length) {
                AsciiEncoding.throwParseIntError(cs, index, length);
            }
        }

        const end = index + length;
        if (end - i < AsciiEncoding.INT_MAX_DIGITS) {
            const tally = AsciiEncoding.parsePositiveIntAscii(cs, index, length, i, end);
            return negative ? -tally | 0 : tally;
        } else {
            const tally = AsciiEncoding.parsePositiveIntAsciiOverflowCheck(cs, index, length, i, end);
            if (
                tally > AsciiEncoding.INTEGER_ABSOLUTE_MIN_VALUE ||
                (AsciiEncoding.INTEGER_ABSOLUTE_MIN_VALUE === tally && !negative)
            ) {
                AsciiEncoding.throwParseIntOverflowError(cs, index, length);
            }
            return (negative ? -tally : tally) | 0;
        }
    }

    /**
     * Parse an ASCII encoded long from a {@link CharSequence}.
     *
     * @param cs     to parse.
     * @param index  at which the number begins.
     * @param length of the encoded number in characters.
     * @return the parsed value.
     * @throws AsciiNumberFormatException if {@code length <= 0} or {@code cs} is not a long value
     * @throws RangeError if the long value is outside +/-(2^53 - 1), which a {@code number} cannot hold
     */
    public static parseLongAscii(cs: string, index: number, length: number): number {
        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        const negative = AsciiEncoding.MINUS_SIGN === cs.charCodeAt(index);
        let i = index;
        if (negative) {
            i++;
            if (1 === length) {
                AsciiEncoding.throwParseLongError(cs, index, length);
            }
        }

        const end = index + length;
        if (end - i < AsciiEncoding.LONG_MAX_DIGITS) {
            const tally = AsciiEncoding.parsePositiveLongAscii(cs, index, length, i, end);
            return longToNumber(negative ? -tally : tally);
        } else if (negative) {
            return longToNumber(
                BigInt.asIntN(
                    64,
                    -AsciiEncoding.parseLongAsciiOverflowCheck(
                        cs,
                        index,
                        length,
                        AsciiEncoding.LONG_MIN_VALUE_DIGITS,
                        i,
                        end,
                    ),
                ),
            );
        } else {
            return longToNumber(
                AsciiEncoding.parseLongAsciiOverflowCheck(
                    cs,
                    index,
                    length,
                    AsciiEncoding.LONG_MAX_VALUE_DIGITS,
                    i,
                    end,
                ),
            );
        }
    }

    /**
     * Checks if the provided {@code value} represents an ASCII-encoded number which contains exactly four digits.
     *
     * @param value four ASCII-encoded bytes to check.
     * @return {@code true} if the {@code value} is an ASCII-encoded number with four digits in it.
     */
    public static isFourDigitsAsciiEncodedNumber(value: number): boolean {
        return 0 === (((value + 0x46464646) | (value - 0x30303030)) & 0x80808080);
    }

    /**
     * Parses a four-digit number out of an ASCII-encoded value assuming little-endian byte order.
     *
     * @param bytes ASCII-encoded value in little-endian byte order.
     * @return {@code int} value with four digits.
     */
    public static parseFourDigitsLittleEndian(bytes: number): number {
        let val = bytes & 0x0f0f0f0f;
        val = (Math.imul(val, 10) + (val >> 8)) | 0;
        return Math.imul(val & 0x00ff00ff, 6553601) >> 16;
    }

    /**
     * Checks if the provided {@code value} represents an ASCII-encoded number which contains exactly eight digits.
     *
     * @param value eight ASCII-encoded bytes to check, a long held in a `bigint`.
     * @return {@code true} if the {@code value} is an ASCII-encoded number with eight digits in it.
     */
    public static isEightDigitAsciiEncodedNumber(value: bigint): boolean {
        return 0n === (((value + 0x4646464646464646n) | (value - 0x3030303030303030n)) & 0x8080808080808080n);
    }

    /**
     * Parses an eight-digit number out of an ASCII-encoded value assuming little-endian byte order.
     *
     * @param bytes ASCII-encoded value in little-endian byte order, a long held in a `bigint`.
     * @return {@code int} value with eight digits.
     */
    public static parseEightDigitsLittleEndian(bytes: bigint): number {
        let val = BigInt.asIntN(64, bytes - 0x3030303030303030n);
        val = BigInt.asIntN(64, val * 10n + (val >> 8n));
        val =
            BigInt.asIntN(
                64,
                (val & 0x000000ff000000ffn) * 0x000f424000000064n +
                    ((val >> 16n) & 0x000000ff000000ffn) * 0x0000271000000001n,
            ) >> 32n;
        return Number(BigInt.asIntN(32, val));
    }

    private static parsePositiveIntAscii(
        cs: string,
        index: number,
        length: number,
        startIndex: number,
        end: number,
    ): number {
        let i = startIndex;
        let tally = 0,
            quartet: number;
        while (
            end - i >= 4 &&
            AsciiEncoding.isFourDigitsAsciiEncodedNumber((quartet = AsciiEncoding.readFourBytesLittleEndian(cs, i)))
        ) {
            tally = tally * 10_000 + AsciiEncoding.parseFourDigitsLittleEndian(quartet);
            i += 4;
        }

        let digit: number;
        while (i < end && AsciiEncoding.isDigit((digit = cs.charCodeAt(i)))) {
            tally = tally * 10 + (digit - 0x30);
            i++;
        }

        if (i !== end) {
            AsciiEncoding.throwParseIntError(cs, index, length);
        }

        return tally;
    }

    private static parsePositiveIntAsciiOverflowCheck(
        cs: string,
        index: number,
        length: number,
        startIndex: number,
        end: number,
    ): number {
        if (end - startIndex > AsciiEncoding.INT_MAX_DIGITS) {
            AsciiEncoding.throwParseIntOverflowError(cs, index, length);
        }

        let i = startIndex;
        let tally = 0;
        const octet = AsciiEncoding.readEightBytesLittleEndian(cs, i);
        if (AsciiEncoding.isEightDigitAsciiEncodedNumber(octet)) {
            tally = AsciiEncoding.parseEightDigitsLittleEndian(octet);
            i += 8;

            let digit: number;
            while (i < end && AsciiEncoding.isDigit((digit = cs.charCodeAt(i)))) {
                tally = tally * 10 + (digit - 0x30);
                i++;
            }
        }

        if (i !== end) {
            AsciiEncoding.throwParseIntError(cs, index, length);
        }

        return tally;
    }

    private static throwParseIntError(cs: string, index: number, length: number): never {
        throw new AsciiNumberFormatException('error parsing int: ' + cs.substring(index, index + length));
    }

    private static throwParseIntOverflowError(cs: string, index: number, length: number): never {
        throw new AsciiNumberFormatException('int overflow parsing: ' + cs.substring(index, index + length));
    }

    private static parsePositiveLongAscii(
        cs: string,
        index: number,
        length: number,
        startIndex: number,
        end: number,
    ): bigint {
        let i = startIndex;
        let tally = 0n,
            octet: bigint;
        while (
            end - i >= 8 &&
            AsciiEncoding.isEightDigitAsciiEncodedNumber((octet = AsciiEncoding.readEightBytesLittleEndian(cs, i)))
        ) {
            tally = tally * 100_000_000n + BigInt(AsciiEncoding.parseEightDigitsLittleEndian(octet));
            i += 8;
        }

        let quartet: number;
        while (
            end - i >= 4 &&
            AsciiEncoding.isFourDigitsAsciiEncodedNumber((quartet = AsciiEncoding.readFourBytesLittleEndian(cs, i)))
        ) {
            tally = tally * 10_000n + BigInt(AsciiEncoding.parseFourDigitsLittleEndian(quartet));
            i += 4;
        }

        let digit: number;
        while (i < end && AsciiEncoding.isDigit((digit = cs.charCodeAt(i)))) {
            tally = tally * 10n + BigInt(digit - 0x30);
            i++;
        }

        if (i !== end) {
            AsciiEncoding.throwParseLongError(cs, index, length);
        }

        return tally;
    }

    private static parseLongAsciiOverflowCheck(
        cs: string,
        index: number,
        length: number,
        maxValue: Int32Array,
        startIndex: number,
        end: number,
    ): bigint {
        if (end - startIndex > AsciiEncoding.LONG_MAX_DIGITS) {
            AsciiEncoding.throwParseLongOverflowError(cs, index, length);
        }

        let i = startIndex,
            k = 0;
        let checkOverflow = true;
        let tally = 0n,
            octet: bigint;
        while (
            end - i >= 8 &&
            AsciiEncoding.isEightDigitAsciiEncodedNumber((octet = AsciiEncoding.readEightBytesLittleEndian(cs, i)))
        ) {
            const eightDigits = AsciiEncoding.parseEightDigitsLittleEndian(octet);
            if (checkOverflow) {
                if (eightDigits > maxValue[k]!) {
                    AsciiEncoding.throwParseLongOverflowError(cs, index, length);
                } else if (eightDigits < maxValue[k]!) {
                    checkOverflow = false;
                }
                k++;
            }
            tally = BigInt.asIntN(64, tally * 100_000_000n + BigInt(eightDigits));
            i += 8;
        }

        let digit: number;
        let lastDigits = 0;
        while (i < end && AsciiEncoding.isDigit((digit = cs.charCodeAt(i)))) {
            lastDigits = lastDigits * 10 + (digit - 0x30);
            i++;
        }

        if (i !== end) {
            AsciiEncoding.throwParseLongError(cs, index, length);
        } else if (checkOverflow && lastDigits > maxValue[k]!) {
            AsciiEncoding.throwParseLongOverflowError(cs, index, length);
        }

        return BigInt.asIntN(64, tally * 1000n + BigInt(lastDigits));
    }

    private static throwParseLongError(cs: string, index: number, length: number): never {
        throw new AsciiNumberFormatException('error parsing long: ' + cs.substring(index, index + length));
    }

    private static throwParseLongOverflowError(cs: string, index: number, length: number): never {
        throw new AsciiNumberFormatException('long overflow parsing: ' + cs.substring(index, index + length));
    }

    private static readFourBytesLittleEndian(cs: string, index: number): number {
        return (
            (cs.charCodeAt(index + 3) << 24) |
            (cs.charCodeAt(index + 2) << 16) |
            (cs.charCodeAt(index + 1) << 8) |
            cs.charCodeAt(index)
        );
    }

    private static readEightBytesLittleEndian(cs: string, index: number): bigint {
        return BigInt.asIntN(
            64,
            (BigInt(cs.charCodeAt(index + 7)) << 56n) |
                (BigInt(cs.charCodeAt(index + 6)) << 48n) |
                (BigInt(cs.charCodeAt(index + 5)) << 40n) |
                (BigInt(cs.charCodeAt(index + 4)) << 32n) |
                (BigInt(cs.charCodeAt(index + 3)) << 24n) |
                (BigInt(cs.charCodeAt(index + 2)) << 16n) |
                BigInt((cs.charCodeAt(index + 1) << 8) | cs.charCodeAt(index)),
        );
    }
}
