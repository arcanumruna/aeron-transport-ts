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
// Port of org/agrona/BitUtil.java @ Agrona 2.6.1
import { ArrayIndexOutOfBoundsException, IllegalArgumentException, Integer, Long, ThreadLocalRandom } from './jdk.js';

const US_ASCII = new TextDecoder();

/**
 * Miscellaneous useful functions for dealing with low level bits and bytes.
 * <p>
 * Java overloads on `int` and `long` that a `number` cannot tell apart get the Java name with a `Long` suffix.
 */
export class BitUtil {
    /**
     * Size of a byte in bytes.
     */
    public static readonly SIZE_OF_BYTE = 1;

    /**
     * Size of a boolean in bytes.
     */
    public static readonly SIZE_OF_BOOLEAN = 1;

    /**
     * Size of a char in bytes.
     */
    public static readonly SIZE_OF_CHAR = 2;

    /**
     * Size of a short in bytes.
     */
    public static readonly SIZE_OF_SHORT = 2;

    /**
     * Size of an int in bytes.
     */
    public static readonly SIZE_OF_INT = 4;

    /**
     * Size of a float in bytes.
     */
    public static readonly SIZE_OF_FLOAT = 4;

    /**
     * Size of a long in bytes.
     */
    public static readonly SIZE_OF_LONG = 8;

    /**
     * Size of a double in bytes.
     */
    public static readonly SIZE_OF_DOUBLE = 8;

    /**
     * Length of the data blocks used by the CPU cache sub-system in bytes.
     */
    public static readonly CACHE_LINE_LENGTH = 64;

    private static readonly HEX_DIGIT_TABLE = new Uint8Array(
        ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.charCodeAt(0)),
    );

    private static FROM_HEX_DIGIT_TABLE: Uint8Array;

    static {
        const table = new Uint8Array(128);

        table['0'.charCodeAt(0)] = 0x00;
        table['1'.charCodeAt(0)] = 0x01;
        table['2'.charCodeAt(0)] = 0x02;
        table['3'.charCodeAt(0)] = 0x03;
        table['4'.charCodeAt(0)] = 0x04;
        table['5'.charCodeAt(0)] = 0x05;
        table['6'.charCodeAt(0)] = 0x06;
        table['7'.charCodeAt(0)] = 0x07;
        table['8'.charCodeAt(0)] = 0x08;
        table['9'.charCodeAt(0)] = 0x09;
        table['a'.charCodeAt(0)] = 0x0a;
        table['A'.charCodeAt(0)] = 0x0a;
        table['b'.charCodeAt(0)] = 0x0b;
        table['B'.charCodeAt(0)] = 0x0b;
        table['c'.charCodeAt(0)] = 0x0c;
        table['C'.charCodeAt(0)] = 0x0c;
        table['d'.charCodeAt(0)] = 0x0d;
        table['D'.charCodeAt(0)] = 0x0d;
        table['e'.charCodeAt(0)] = 0x0e;
        table['E'.charCodeAt(0)] = 0x0e;
        table['f'.charCodeAt(0)] = 0x0f;
        table['F'.charCodeAt(0)] = 0x0f;

        BitUtil.FROM_HEX_DIGIT_TABLE = table;
    }

    private static readonly LAST_DIGIT_MASK = 0b1;

    private constructor() {}

    /**
     * Fast method of finding the next power of 2 greater than or equal to the supplied value.
     * <p>
     * If the value is &lt;= 0 then 1 will be returned.
     * <p>
     * This method is not suitable for {@link Integer#MIN_VALUE} or numbers greater than 2^30. When provided
     * then {@link Integer#MIN_VALUE} will be returned.
     *
     * @param value from which to search for next power of 2.
     * @return The next power of 2 or the value itself if it is a power of 2.
     */
    public static findNextPositivePowerOfTwo(value: number): number {
        return 1 << (Integer.SIZE - Integer.numberOfLeadingZeros(value - 1));
    }

    /**
     * Fast method of finding the next power of 2 greater than or equal to the supplied value.
     * <p>
     * If the value is &lt;= 0 then 1 will be returned.
     * <p>
     * This method is not suitable for numbers greater than 2^52, whose next power of 2 is not a safe integer.
     *
     * @param value from which to search for next power of 2.
     * @return The next power of 2 or the value itself if it is a power of 2.
     */
    public static findNextPositivePowerOfTwoLong(value: number): number {
        return 2 ** ((Long.SIZE - Long.numberOfLeadingZeros(value - 1)) & 63);
    }

    /**
     * Align a value to the next multiple up of alignment.
     * If the value equals an alignment multiple then it is returned unchanged.
     * <p>
     * This method executes without branching. This code is designed to be use in the fast path and should not
     * be used with negative numbers. Negative numbers will result in undefined behaviour.
     *
     * @param value     to be aligned up.
     * @param alignment to be used.
     * @return the value aligned to the next boundary.
     */
    public static align(value: number, alignment: number): number {
        return (value + (alignment - 1)) & -alignment;
    }

    /**
     * Align a value to the next multiple up of alignment.
     * If the value equals an alignment multiple then it is returned unchanged.
     * <p>
     * This method executes without branching. This code is designed to be use in the fast path and should not
     * be used with negative numbers. Negative numbers will result in undefined behaviour.
     *
     * @param value     to be aligned up.
     * @param alignment to be used.
     * @return the value aligned to the next boundary.
     */
    public static alignLong(value: number, alignment: number): number {
        return Long.and(value + (alignment - 1), -alignment);
    }

    /**
     * Generate a byte array from the hex representation of the given byte array.
     *
     * @param buffer to convert from a hex representation (in Big Endian).
     * @return new byte array that is decimal representation of the passed array.
     */
    public static fromHexByteArray(buffer: Uint8Array): Uint8Array {
        const outputBuffer = new Uint8Array(buffer.length >> 1);

        for (let i = 1; i < buffer.length; i += 2) {
            const hi = BitUtil.fromHexDigit(buffer[i - 1]!) << 4;
            const lo = BitUtil.fromHexDigit(buffer[i]!);
            outputBuffer[(i - 1) >> 1] = hi | lo;
        }

        return outputBuffer;
    }

    /**
     * Generate a byte array that is a hex representation of a given byte array.
     *
     * @param buffer to convert to a hex representation, a byte array or a CharSequence.
     * @param offset the offset into the buffer.
     * @param length the number of bytes to convert.
     * @return new byte array that is hex representation (in Big Endian) of the passed array.
     */
    public static toHexByteArray(
        buffer: Uint8Array | string,
        offset: number = 0,
        length: number = buffer.length,
    ): Uint8Array {
        const outputBuffer = new Uint8Array(length << 1);

        for (let i = 0; i < length << 1; i += 2) {
            const b =
                typeof buffer === 'string'
                    ? (buffer.charCodeAt(offset + (i >> 1)) << 24) >> 24
                    : (buffer[offset + (i >> 1)]! << 24) >> 24;

            outputBuffer[i] = BitUtil.HEX_DIGIT_TABLE[(b >> 4) & 0x0f]!;
            outputBuffer[i + 1] = BitUtil.HEX_DIGIT_TABLE[b & 0x0f]!;
        }

        return outputBuffer;
    }

    /**
     * Generate a byte array from a string that is the hex representation of the given byte array.
     *
     * @param string to convert from a hex representation (in Big Endian).
     * @return new byte array holding the decimal representation of the passed array.
     */
    public static fromHex(string: string): Uint8Array {
        const length = string.length;
        const bytes = new Uint8Array(length);

        for (let i = 0; i < length; i++) {
            bytes[i] = string.charCodeAt(i);
        }

        return BitUtil.fromHexByteArray(bytes);
    }

    /**
     * Generate a string that is the hex representation of a given byte array.
     *
     * @param buffer to convert to a hex representation.
     * @param offset the offset into the buffer.
     * @param length the number of bytes to convert.
     * @return new String holding the hex representation (in Big Endian) of the passed array.
     */
    public static toHex(buffer: Uint8Array, offset: number = 0, length: number = buffer.length): string {
        return US_ASCII.decode(BitUtil.toHexByteArray(buffer, offset, length));
    }

    /**
     * Is a int value even.
     *
     * @param value to check.
     * @return true if the number is even otherwise false.
     */
    public static isEven(value: number): boolean {
        return (value & BitUtil.LAST_DIGIT_MASK) === 0;
    }

    /**
     * Is a long value even.
     *
     * @param value to check.
     * @return true if the number is even otherwise false.
     */
    public static isEvenLong(value: number): boolean {
        return (value & BitUtil.LAST_DIGIT_MASK) === 0;
    }

    /**
     * Is a value a positive power of 2.
     *
     * @param value to be checked.
     * @return true if the number is a positive power of 2, otherwise false.
     */
    public static isPowerOfTwo(value: number): boolean {
        return value > 0 && (value & (~value + 1)) === value;
    }

    /**
     * Is a value a positive power of 2.
     *
     * @param value to be checked.
     * @return true if the number is a positive power of 2, otherwise false.
     */
    public static isPowerOfTwoLong(value: number): boolean {
        return value > 0 && Long.and(value, -value) === value;
    }

    /**
     * Cycles indices of an array one at a time in a forward fashion.
     *
     * @param current value to be incremented.
     * @param max     value for the cycle.
     * @return the next value, or zero if max is reached.
     */
    public static next(current: number, max: number): number {
        let next = current + 1;
        if (next === max) {
            next = 0;
        }

        return next;
    }

    /**
     * Cycles indices of an array one at a time in a backwards fashion.
     *
     * @param current value to be decremented.
     * @param max     value of the cycle.
     * @return the next value, or max - 1 if current is zero.
     */
    public static previous(current: number, max: number): number {
        if (0 === current) {
            return max - 1;
        }

        return current - 1;
    }

    /**
     * Calculate the shift value to scale a number based on how refs are compressed or not.
     *
     * @param scale of the number reported by Unsafe.
     * @return how many times the number needs to be shifted to the left.
     */
    public static calculateShiftForScale(scale: number): number {
        if (4 === scale) {
            return 2;
        } else if (8 === scale) {
            return 3;
        }

        throw new IllegalArgumentException('unknown pointer size for scale=' + scale);
    }

    /**
     * Generate a randomised integer over [{@link Integer#MIN_VALUE}, {@link Integer#MAX_VALUE}].
     *
     * @return randomised integer suitable as an ID.
     */
    public static generateRandomisedId(): number {
        return ThreadLocalRandom.current().nextInt();
    }

    /**
     * Is an address aligned on a boundary.
     *
     * @param address   to be tested.
     * @param alignment boundary the address is tested against.
     * @return true if the address is on the aligned boundary otherwise false.
     * @throws IllegalArgumentException if the alignment is not a power of 2.
     */
    public static isAligned(address: number, alignment: number): boolean {
        if (!BitUtil.isPowerOfTwo(alignment)) {
            throw new IllegalArgumentException('alignment must be a power of 2: alignment=' + alignment);
        }

        return Long.and(address, alignment - 1) === 0;
    }

    /**
     * The `FROM_HEX_DIGIT_TABLE[digit]` lookup for a byte, which in Java throws for a byte outside the table.
     */
    private static fromHexDigit(digit: number): number {
        if (digit > 127) {
            throw new ArrayIndexOutOfBoundsException(`Index ${digit - 256} out of bounds for length 128`);
        }

        return BitUtil.FROM_HEX_DIGIT_TABLE[digit]!;
    }
}
