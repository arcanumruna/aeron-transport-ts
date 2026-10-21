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
// Port of org/agrona/MutableDirectBufferTests.java @ Agrona 2.6.1
import assert from 'node:assert/strict';
import { expect, it } from 'vitest';
import { AbstractMutableDirectBuffer } from '../../src/agrona/AbstractMutableDirectBuffer.js';
import { AsciiNumberFormatException } from '../../src/agrona/AsciiNumberFormatException.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { Integer, IndexOutOfBoundsException, Long, ThreadLocalRandom } from '../../src/agrona/jdk.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { assertEqualsObject, assertNotEqualsObject, assertThrowsExactly } from '../support/Assertions.js';
import { mock } from '../support/Mockito.js';

const ROUND_TRIP_ITERATIONS = 10_000_000;

const US_ASCII = new TextEncoder();

/** A Java `(byte)` cast. */
const toByte = (value: number): number => (value << 24) >> 24;

/**
 * Base class containing a common set of tests for {@link MutableDirectBuffer} implementations.
 *
 * @param newBuffer allocate a new buffer with the specified capacity.
 */
export function mutableDirectBufferTests(newBuffer: (capacity: number) => MutableDirectBuffer): void {
    it('shouldThrowExceptionWhenOutOfBounds', () => {
        const buffer = newBuffer(10);
        const index = buffer.capacity();
        expect(() => buffer.getByte(index)).toThrow(IndexOutOfBoundsException);
    });

    it('shouldPutBytes', () => {
        const index = 5;
        const value = 'Hello World';
        const buffer = newBuffer(20);

        buffer.putBytes(index, US_ASCII.encode(value));

        expect(buffer.getStringWithoutLengthAscii(index, value.length)).toBe(value);
    });

    it.skip('shouldPutBytesFromByteBuffer', () => {
        // no direct memory / ByteBuffer in JS: putBytes(int, ByteBuffer, int, int) is not ported
    });

    it.each(valuesAndLengths())('shouldPutNaturalFromEnd %s', (value, length) => {
        const buffer = newBuffer(8 * 1024);

        const start = buffer.putNaturalIntAsciiFromEnd(value, length);
        const messageSupplier = () => 'value=' + value + ' length=' + length;
        expect(start, messageSupplier()).toBe(0);

        expect(buffer.getStringWithoutLengthAscii(0, length), messageSupplier()).toBe(String(value));
    });

    it('putIntAsciiRoundTrip', () => {
        const index = 4;
        const buffer = newBuffer(64);

        for (let i = 0; i < ROUND_TRIP_ITERATIONS; i++) {
            const value = ThreadLocalRandom.current().nextInt();
            const length = buffer.putIntAscii(index, value);
            const parsedValue = buffer.parseIntAscii(index, length);
            // adapted: node:assert instead of expect, which costs seconds over 10,000,000 iterations
            assert.strictEqual(parsedValue, value);
        }
    }, 120_000);

    it('putLongAsciiRoundTrip', () => {
        const index = 16;
        const buffer = newBuffer(64);

        for (let i = 0; i < ROUND_TRIP_ITERATIONS; i++) {
            // adapted: a random long within +/-(2^53 - 1) with a random number of digits, since a long is a number
            const value = randomLong();
            const length = buffer.putLongAscii(index, value);
            const parsedValue = buffer.parseLongAscii(index, length);
            assert.strictEqual(parsedValue, value);
        }
    }, 120_000);

    it('putNaturalIntAsciiRoundTrip', () => {
        const index = 8;
        const buffer = newBuffer(64);

        for (let i = 0; i < ROUND_TRIP_ITERATIONS; i++) {
            const value = ThreadLocalRandom.current().nextInt(0, Integer.MAX_VALUE);
            const length = buffer.putNaturalIntAscii(index, value);
            const parsedValue = buffer.parseNaturalIntAscii(index, length);
            assert.strictEqual(parsedValue, value);
        }
    }, 120_000);

    it('putNaturalLongAsciiRoundTrip', () => {
        const index = 12;
        const buffer = newBuffer(64);

        for (let i = 0; i < ROUND_TRIP_ITERATIONS; i++) {
            // adapted: a random natural long below Long.MAX_VALUE (2^53 - 1) with a random number of digits
            const value = Math.abs(randomLong());
            const length = buffer.putNaturalLongAscii(index, value);
            const parsedValue = buffer.parseNaturalLongAscii(index, length);
            assert.strictEqual(parsedValue, value);
        }
    }, 120_000);

    it.each([11, 64, 1011])('setMemory %s', (length) => {
        const index = 2;
        const value = toByte(11);
        const buffer = newBuffer(2 * index + length);

        buffer.setMemory(index, length, value);

        expect(buffer.getByte(0)).toBe(0);
        expect(buffer.getByte(1)).toBe(0);
        expect(buffer.getByte(index + length)).toBe(0);
        expect(buffer.getByte(index + length + 1)).toBe(0);
        for (let i = 0; i < length; i++) {
            expect(buffer.getByte(index + i)).toBe(value);
        }
    });

    it('putLongAsciiShouldHandleEightDigitNumber', () => {
        const index = 0;
        const buffer = newBuffer(16);

        const length = buffer.putLongAscii(index, 87654321);
        expect(length).toBe(8);

        expect(buffer.getStringWithoutLengthAscii(index, length)).toBe('87654321');
    });

    // adapted: Long.MIN_VALUE and Long.MAX_VALUE are -(2^53 - 1) and 2^53 - 1, the bounds of a long held in a number
    it.each([Long.MIN_VALUE, 0, Long.MAX_VALUE])('putLongAsciiShouldEncodeBoundaryValues %s', (value) => {
        const encodedValue = String(value);
        const index = 4;
        const buffer = newBuffer(32);

        const length = buffer.putLongAscii(index, value);

        expect(length).toBe(encodedValue.length);
        expect(buffer.getStringWithoutLengthAscii(index, length)).toBe(encodedValue);
        expect(buffer.parseLongAscii(index, length)).toBe(value);
    });

    it.each([Integer.MIN_VALUE, 0, Integer.MAX_VALUE])('putIntAsciiShouldEncodeBoundaryValues %s', (value) => {
        const encodedValue = String(value);
        const index = 3;
        const buffer = newBuffer(32);

        const length = buffer.putIntAscii(index, value);

        expect(length).toBe(encodedValue.length);
        expect(buffer.getStringWithoutLengthAscii(index, length)).toBe(encodedValue);
        expect(buffer.parseIntAscii(index, length)).toBe(value);
    });

    it.each(nonParsableIntValues())(
        'parseIntAsciiThrowsAsciiNumberFormatExceptionIfValueContainsInvalidCharacters %s',
        (value) => {
            const index = 2;
            const buffer = newBuffer(16);
            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseIntAscii(index, length),
            );
            expect(exception.message).toBe('error parsing int: ' + value);
        },
    );

    it.each(nonParsableLongValues())(
        'parseLongAsciiThrowsAsciiNumberFormatExceptionIfValueContainsInvalidCharacters %s',
        (value, _baseIndex) => {
            const index = 7;
            const buffer = newBuffer(32);
            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseLongAscii(index, length),
            );
            expect(exception.message).toBe('error parsing long: ' + value);
        },
    );

    it.each(nonParsableIntValues())(
        'parseNaturalIntAsciiThrowsAsciiNumberFormatExceptionIfValueContainsInvalidCharacters %s',
        (value) => {
            const index = 1;
            const buffer = newBuffer(16);
            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseNaturalIntAscii(index, length),
            );
            expect(exception.message).toBe('error parsing int: ' + value);
        },
    );

    it.each(nonParsableLongValues())(
        'parseNaturalLongAsciiThrowsAsciiNumberFormatExceptionIfValueContainsInvalidCharacters %s',
        (value, _baseIndex) => {
            const index = 8;
            const buffer = newBuffer(32);
            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseNaturalLongAscii(index, length),
            );
            expect(exception.message).toBe('error parsing long: ' + value);
        },
    );

    it.each([
        '-5547483650',
        '-2147483649',
        '2147483648',
        '2147483649',
        '9999999991',
        '-999999999999999999',
        '12345678901234567890',
    ])('parseIntAsciiShouldThrowAsciiNumberFormatExceptionIfValueIsOutOfRange %s', (value) => {
        const index = 4;
        const buffer = newBuffer(32);

        const length = buffer.putStringWithoutLengthAscii(index, value);

        const exception = assertThrowsExactly(AsciiNumberFormatException, () => buffer.parseIntAscii(index, length));
        expect(exception.message).toBe('int overflow parsing: ' + value);
    });

    it.each([
        '-9223372036854775810',
        '-9223372036854775809',
        '9223372036854775808',
        '9223372036854775809',
        '-19191919191919191919',
        '123456789012345678901234567890',
    ])('parseLongAsciiShouldThrowAsciiNumberFormatExceptionIfValueIsOutOfRange %s', (value) => {
        const index = 7;
        const buffer = newBuffer(64);

        const length = buffer.putStringWithoutLengthAscii(index, value);

        const exception = assertThrowsExactly(AsciiNumberFormatException, () => buffer.parseLongAscii(index, length));
        expect(exception.message).toBe('long overflow parsing: ' + value);
    });

    it.each(['2147483648', '2147483649', '9999999991', '12345678901234567890'])(
        'parseNaturalIntAsciiShouldThrowAsciiNumberFormatExceptionIfValueIsOutOfRange %s',
        (value) => {
            const index = 4;
            const buffer = newBuffer(32);

            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseNaturalIntAscii(index, length),
            );
            expect(exception.message).toBe('int overflow parsing: ' + value);
        },
    );

    it.each(['9223372036854775808', '9223372036854775809', '123456789012345678901234567890'])(
        'parseNaturalLongAsciiShouldThrowAsciiNumberFormatExceptionIfValueIsOutOfRange %s',
        (value) => {
            const index = 7;
            const buffer = newBuffer(64);

            const length = buffer.putStringWithoutLengthAscii(index, value);

            const exception = assertThrowsExactly(AsciiNumberFormatException, () =>
                buffer.parseNaturalLongAscii(index, length),
            );
            expect(exception.message).toBe('long overflow parsing: ' + value);
        },
    );

    // adapted: ExpandableArrayBuffer and ExpandableDirectByteBuffer are not ported, and the UnsafeBuffers over a heap
    // and a direct ByteBuffer are over an ArrayBuffer
    it.each(mutableBuffers())('getBytesShouldCopyIntoDestinationBuffer %s', (dest) => {
        const srcIndex = 20;
        const dstIndex = 13;
        const length = 49;
        const data = new Uint8Array(64);
        ThreadLocalRandom.current().nextBytes(data);
        const buffer = newBuffer(100);
        buffer.putBytes(srcIndex, data);

        buffer.getBytes(srcIndex, dest, dstIndex, length);

        for (let i = 0; i < length; i++) {
            expect(dest.getByte(dstIndex + i)).toBe(toByte(data[i]!));
        }
    });

    // adapted: same rows as getBytesShouldCopyIntoDestinationBuffer
    it.each(mutableBuffers())('putBytesShouldCopyBytesFromTheSourceBuffer %s', (src) => {
        const srcIndex = 13;
        const dstIndex = 6;
        const length = 28;
        const data = new Uint8Array(32);
        ThreadLocalRandom.current().nextBytes(data);
        src.putBytes(srcIndex, data);

        const buffer = newBuffer(100);
        buffer.putBytes(dstIndex, src, srcIndex, length);

        for (let i = 0; i < length; i++) {
            expect(buffer.getByte(dstIndex + i)).toBe(toByte(data[i]!));
        }
    });

    it('equalsReturnsTrueForThis', () => {
        const buffer = newBuffer(1);
        assertEqualsObject(buffer, buffer);
    });

    it('equalsReturnsFalseForNull', () => {
        const buffer = newBuffer(1);
        assertNotEqualsObject(null, buffer);
    });

    it('equalsReturnsFalseForWrongClass', () => {
        const buffer = newBuffer(1);
        const other = mock(AbstractMutableDirectBuffer);

        assertNotEqualsObject(buffer, other.mock);

        other.verifyNoInteractions();
    });

    it('equalsReturnsFalseWhenCapacityDoesNotMatch', () => {
        const buffer = newBuffer(1);
        const other = newBuffer(3);

        assertNotEqualsObject(buffer, other);
    });

    it.each([1, 7, 21, 64])('equalsReturnsTrueWhenOtherBufferHasTheSameData %s', (capacity) => {
        const data = new Uint8Array(capacity);
        ThreadLocalRandom.current().nextBytes(data);
        const buffer = newBuffer(capacity);
        const other = newBuffer(capacity);
        buffer.putBytes(0, data);
        other.putBytes(0, data);

        assertEqualsObject(buffer, other);
    });

    it('hashCodeConsidersAnEntireCapacity', () => {
        const buffer1 = newBuffer(10);
        const buffer2 = newBuffer(15);
        const buffer3 = newBuffer(10);
        const length = 7;
        buffer1.setMemory(0, length, 'f'.charCodeAt(0));
        buffer2.setMemory(0, length, 'f'.charCodeAt(0));
        buffer3.setMemory(0, length, 'f'.charCodeAt(0));

        expect(buffer1.hashCode()).not.toBe(buffer2.hashCode());
        expect(buffer3.hashCode()).toBe(buffer1.hashCode());
    });

    it.each([
        [3, 687175],
        [11, 17668045],
        [128, -56919533],
    ])('hashCodeDifferentDataSizes %s', (capacity, expectedHashCode) => {
        const buffer = newBuffer(capacity);
        buffer.setMemory(0, capacity, 'z'.charCodeAt(0));
        expect(buffer.hashCode()).toBe(expectedHashCode);
    });

    it('compareToComparesCapacityIfContentIsEqual', () => {
        const buffer1 = newBuffer(3);
        const buffer2 = newBuffer(5);
        const buffer3 = newBuffer(3);

        expect(buffer1.compareTo(buffer2)).toBe(-1);
        expect(buffer2.compareTo(buffer1)).toBe(1);
        expect(buffer3.compareTo(buffer1)).toBe(0);
    });

    it.each([1, 6, 19, 256])('compareToReturnsZeroForEqualContents %s', (capacity) => {
        const data = new Uint8Array(capacity);
        ThreadLocalRandom.current().nextBytes(data);
        const buffer1 = newBuffer(capacity);
        buffer1.putBytes(0, data);
        const buffer2 = new UnsafeBuffer(data);

        expect(buffer1.compareTo(buffer2)).toBe(0);
        expect(buffer2.compareTo(buffer1)).toBe(0);
    });

    it.each([5, 33])('compareToStopsComparisonUponTheFirstNonEqualByte %s', (capacity) => {
        const buffer1 = newBuffer(capacity);
        const buffer2 = newBuffer(capacity);
        const index1 = ThreadLocalRandom.current().nextInt(capacity - 2, capacity);
        const index2 = ThreadLocalRandom.current().nextInt(0, index1);
        buffer1.setMemory(0, index1, 'a'.charCodeAt(0));
        buffer2.setMemory(0, index2, 'a'.charCodeAt(0));
        buffer2.setMemory(index2, capacity - index2, 'x'.charCodeAt(0));

        expect(buffer1.compareTo(buffer2) < 0).toBe(true);
        expect(buffer2.compareTo(buffer1) > 0).toBe(true);
    });

    it.each([1, 5, 9, 16, 33, 100, 256])('setMemoryCopiesTheSameByteAcross %s', (length) => {
        const index = ThreadLocalRandom.current().nextInt(0, 10);
        const buffer = newBuffer(index + length);
        const value = toByte(ThreadLocalRandom.current().nextInt());
        const expected = new Uint8Array(length);
        expected.fill(value);

        buffer.setMemory(index, length, value);

        const actual = new Uint8Array(length);
        buffer.getBytes(index, actual);
        expect(actual).toEqual(expected);
    });
}

/** A random long in +/-(2^53 - 1) with a random number of digits. */
function randomLong(): number {
    const random =
        (ThreadLocalRandom.current().nextInt() >> 11) * 4294967296 + (ThreadLocalRandom.current().nextInt() >>> 0);
    return Math.trunc(random / 2 ** (ThreadLocalRandom.current().nextInt() & 31));
}

function valuesAndLengths(): [number, number][] {
    return [
        [1, 1],
        [10, 2],
        [100, 3],
        [1000, 4],
        [12, 2],
        [123, 3],
        [2345, 4],
        [9, 1],
        [99, 2],
        [999, 3],
        [9999, 4],
    ];
}

function nonParsableIntValues(): string[] {
    return ['23.5', '+1', 'a14349', '0xFF', '999v', '-', '+', '1234%67890'];
}

function nonParsableLongValues(): [string, number][] {
    return [
        ['23.5', 2],
        ['+1', 0],
        ['a14349', 0],
        ['0xFF', 1],
        ['999v', 3],
        ['-', 0],
        ['+', 0],
        ['123456789^123456789', 9],
    ];
}

function mutableBuffers(): MutableDirectBuffer[] {
    return [new UnsafeBuffer(new Uint8Array(64)), new UnsafeBuffer(new ArrayBuffer(64))];
}
