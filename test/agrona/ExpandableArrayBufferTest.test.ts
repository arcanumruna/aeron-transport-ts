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
// Port of org/agrona/ExpandableArrayBufferTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { ExpandableArrayBuffer } from '../../src/agrona/ExpandableArrayBuffer.js';
import { ByteOrder, IndexOutOfBoundsException, Integer, Long } from '../../src/agrona/jdk.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';
import { mutableDirectBufferTests } from './MutableDirectBufferTests.js';

/** `ensureCapacity` is protected in Java and the test is in the same package. */
const ensureCapacity = (buffer: ExpandableArrayBuffer, index: number, length: number): void =>
    (buffer as unknown as { ensureCapacity(index: number, length: number): void }).ensureCapacity(index, length);

describe('ExpandableArrayBufferTest', () => {
    const newBuffer = (capacity: number): MutableDirectBuffer => new ExpandableArrayBuffer(capacity);

    mutableDirectBufferTests(newBuffer);

    it.each([-123, Integer.MIN_VALUE, Integer.MAX_VALUE, 0, 77777])('putIntAsciiShouldExpandCapacity %i', (value) => {
        const initialCapacity = 2;
        const index = 5;
        const buffer = newBuffer(initialCapacity);

        const length = buffer.putIntAscii(index, value);
        expect(buffer.parseIntAscii(index, length)).toBe(value);
    });

    it.each([Integer.MAX_VALUE, 0, 77777, 1])('putNaturalIntAsciiShouldExpandCapacity %i', (value) => {
        const initialCapacity = 2;
        const index = initialCapacity;
        const buffer = newBuffer(initialCapacity);

        const length = buffer.putNaturalIntAscii(index, value);
        expect(buffer.parseIntAscii(index, length)).toBe(value);
    });

    // adapted: Long.MIN_VALUE and Long.MAX_VALUE of jdk.ts are +/-(2^53 - 1) (spec D5)
    it.each([Long.MIN_VALUE + 1, Long.MIN_VALUE, Long.MAX_VALUE, 0, 1754837658435])(
        'putLongAsciiShouldExpandCapacity %i',
        (value) => {
            const initialCapacity = 12;
            const index = 50;
            const buffer = newBuffer(initialCapacity);

            const length = buffer.putLongAscii(index, value);
            expect(buffer.parseLongAscii(index, length)).toBe(value);
        },
    );

    // adapted: as putLongAsciiShouldExpandCapacity
    it.each([Long.MAX_VALUE, 0, 1754837658435, Long.MAX_VALUE - 111])(
        'putNaturalLongAsciiShouldExpandCapacity %i',
        (value) => {
            const initialCapacity = 2;
            const index = initialCapacity * 2;
            const buffer = newBuffer(initialCapacity);

            const length = buffer.putNaturalLongAscii(index, value);
            expect(buffer.parseNaturalLongAscii(index, length)).toBe(value);
        },
    );

    it('ensureCapacityThrowsIndexOutOfBoundsExceptionIfIndexIsNegative', () => {
        const buffer = new ExpandableArrayBuffer(1);
        const exception = assertThrowsExactly(IndexOutOfBoundsException, () => ensureCapacity(buffer, -3, 4));
        expect(exception.message).toBe('negative value: index=-3 length=4');
    });

    it('ensureCapacityThrowsIndexOutOfBoundsExceptionIfLengthIsNegative', () => {
        const buffer = new ExpandableArrayBuffer(1);
        const exception = assertThrowsExactly(IndexOutOfBoundsException, () => ensureCapacity(buffer, 8, -100));
        expect(exception.message).toBe('negative value: index=8 length=-100');
    });

    it('ensureCapacityIsANoOpIfExistingCapacityIsEnough', () => {
        const index = 1;
        const capacity = 5;
        const buffer = new ExpandableArrayBuffer(capacity);

        ensureCapacity(buffer, index, capacity - index);

        expect(buffer.capacity()).toBe(capacity);
    });

    it.each([
        [3, 10, 15],
        [100, 40, 163],
    ])('ensureCapacityExtendsTheUnderlyingArray %i, %i, %i', (index, length, expectedCapacity) => {
        const initialCapacity = 5;
        const buffer = new ExpandableArrayBuffer(initialCapacity);
        const originalArray = buffer.byteArray();

        ensureCapacity(buffer, index, length);

        expect(buffer.capacity()).toBe(expectedCapacity);
        expect(buffer.byteArray()).not.toBe(originalArray);
    });

    it('wrapAdjustmentIsAlwaysZero', () => {
        const buffer = newBuffer(5);
        expect(buffer.wrapAdjustment()).toBe(0);
    });

    it.each([3, 777])('checkLimitIncreaseBufferCapacity %i', (limit) => {
        const buffer = new ExpandableArrayBuffer(1);
        const originalArray = buffer.byteArray();
        expect(limit > buffer.capacity()).toBe(true);

        buffer.checkLimit(limit);

        expect(limit <= buffer.capacity()).toBe(true);
        expect(buffer.byteArray()).not.toBe(originalArray);
    });

    it('shouldThrowExceptionForReadingIntAboveCapacity', () => {
        const buffer = newBuffer(3);
        assertThrows(IndexOutOfBoundsException, () => buffer.getInt(4, ByteOrder.BIG_ENDIAN));
    });

    it('shouldThrowExceptionForReadingLongAboveCapacity', () => {
        const buffer = newBuffer(3);
        assertThrows(IndexOutOfBoundsException, () => buffer.getLong(4, ByteOrder.BIG_ENDIAN));
    });
});
