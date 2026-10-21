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
// Port of org/agrona/BitUtilTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { Integer, Long } from '../../src/agrona/jdk.js';

const MAX_VALUE = Integer.MAX_VALUE;
const MIN_VALUE = Integer.MIN_VALUE;
const {
    CACHE_LINE_LENGTH,
    align,
    alignLong,
    findNextPositivePowerOfTwo,
    fromHex,
    fromHexByteArray,
    toHex,
    toHexByteArray,
} = BitUtil;

describe('BitUtilTest', () => {
    it('shouldReturnNextPositivePowerOfTwo', () => {
        expect(findNextPositivePowerOfTwo(MIN_VALUE)).toBe(MIN_VALUE);
        expect(findNextPositivePowerOfTwo(MIN_VALUE + 1)).toBe(1);
        expect(findNextPositivePowerOfTwo(-1)).toBe(1);
        expect(findNextPositivePowerOfTwo(0)).toBe(1);
        expect(findNextPositivePowerOfTwo(1)).toBe(1);
        expect(findNextPositivePowerOfTwo(2)).toBe(2);
        expect(findNextPositivePowerOfTwo(3)).toBe(4);
        expect(findNextPositivePowerOfTwo(4)).toBe(4);
        expect(findNextPositivePowerOfTwo(31)).toBe(32);
        expect(findNextPositivePowerOfTwo(32)).toBe(32);
        expect(findNextPositivePowerOfTwo(1 << 30)).toBe(1 << 30);
        expect(findNextPositivePowerOfTwo((1 << 30) + 1)).toBe(MIN_VALUE);
    });

    it('shouldAlignValueToNextMultipleOfAlignment', () => {
        const alignment = CACHE_LINE_LENGTH;

        expect(align(0, alignment)).toBe(0);
        expect(align(1, alignment)).toBe(alignment);
        expect(align(alignment, alignment)).toBe(alignment);
        expect(align(alignment + 1, alignment)).toBe(alignment * 2);

        const remainder = MAX_VALUE % alignment;
        const maxMultiple = MAX_VALUE - remainder;

        expect(align(maxMultiple, alignment)).toBe(maxMultiple);
        expect(align(MAX_VALUE, alignment)).toBe(MIN_VALUE);
    });

    it('shouldAlignValueToNextMultipleOfAlignmentLong', () => {
        const alignment = CACHE_LINE_LENGTH;

        expect(alignLong(0, alignment)).toBe(0);
        expect(alignLong(1, alignment)).toBe(alignment);
        expect(alignLong(alignment, alignment)).toBe(alignment);
        expect(alignLong(alignment + 1, alignment)).toBe(alignment * 2);

        const remainder = Long.MAX_VALUE % alignment;
        const maxMultiple = Long.MAX_VALUE - remainder;

        expect(alignLong(maxMultiple, alignment)).toBe(maxMultiple);
        // adapted: a long is a number, so aligning Long.MAX_VALUE does not wrap to Long.MIN_VALUE; it gives the next
        // multiple, 2^53, which is still exact
        expect(alignLong(Long.MAX_VALUE, alignment)).toBe(Long.MAX_VALUE + 1);
    });

    it.each([
        [0, 64, 0],
        [1, 1024, 1024],
        [1073741824, 4096, 1073741824],
        [1073741824, 1073741824, 1073741824],
        [1073741825, 1073741824, 2147483648],
        [100, 8589934592, 8589934592],
        [9999999999, 8589934592, 17179869184],
    ])('alignWithLongValues %s', (value, alignment, expected) => {
        expect(alignLong(value, alignment)).toBe(expected);
    });

    it('shouldConvertToHex', () => {
        const buffer = new Uint8Array([0x01, 0x23, 0x45, 0x69, 0x78, 0xbc, 0xda, 0xef, 0x5f]);
        const converted = toHexByteArray(buffer);
        const hexString = toHex(buffer);

        expect(converted[0]).toBe('0'.charCodeAt(0));
        expect(converted[1]).toBe('1'.charCodeAt(0));
        expect(converted[2]).toBe('2'.charCodeAt(0));
        expect(converted[3]).toBe('3'.charCodeAt(0));
        expect(hexString).toBe('0123456978bcdaef5f');
    });

    it('shouldConvertFromHex', () => {
        const hexString = '0123456978bcdaef5f';

        const expectedBuffer = new Uint8Array([0x01, 0x23, 0x45, 0x69, 0x78, 0xbc, 0xda, 0xef, 0x5f]);
        const fromHexStringBuffer = fromHex(hexString);
        expect(fromHexStringBuffer).toEqual(expectedBuffer);

        const expectedHexBuffer = toHexByteArray(expectedBuffer);
        const fromHexBuffer = fromHexByteArray(expectedHexBuffer);
        expect(fromHexBuffer).toEqual(expectedBuffer);
    });

    it('shouldDetectEvenAndOddNumbers', () => {
        expect(BitUtil.isEven(0)).toBe(true);
        expect(BitUtil.isEven(2)).toBe(true);
        expect(BitUtil.isEven(MIN_VALUE)).toBe(true);

        expect(BitUtil.isEven(1)).toBe(false);
        expect(BitUtil.isEven(-1)).toBe(false);
        expect(BitUtil.isEven(MAX_VALUE)).toBe(false);
    });
});
