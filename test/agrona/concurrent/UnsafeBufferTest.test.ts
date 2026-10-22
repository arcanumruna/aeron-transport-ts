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
// Port of org/agrona/concurrent/UnsafeBufferTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import { ByteOrder, IllegalStateException, IndexOutOfBoundsException } from '../../../src/agrona/jdk.js';
import type { MutableDirectBuffer } from '../../../src/agrona/MutableDirectBuffer.js';
import { BACKINGS } from '../../support/Backing.js';
import { assertIs, assertIsNot, assertThrowsExactly } from '../../support/Assertions.js';
import { ByteBuffer } from '../../support/ByteBuffer.js';
import { mutableDirectBufferTests } from '../MutableDirectBufferTests.js';

const US_ASCII = new TextEncoder();

describe.each(BACKINGS)('UnsafeBufferTest over $name', (backing) => {
    const VALUE = 42;
    const ADJUSTMENT_OFFSET = 3;

    let wibbleBytes: Uint8Array;
    let wobbleBytes: Uint8Array;
    let wibbleBytes2: Uint8Array;

    // JUnit creates an instance of the test class, and so these fields, for each test
    beforeEach(() => {
        wibbleBytes = US_ASCII.encode('Wibble');
        wobbleBytes = US_ASCII.encode('Wobble');
        wibbleBytes2 = US_ASCII.encode('Wibble2');
    });

    const newBuffer = (capacity: number): MutableDirectBuffer => new UnsafeBuffer(backing.bytes(capacity));

    mutableDirectBufferTests(newBuffer, backing);

    it('shouldThrowExceptionForAboveCapacity', () => {
        const buffer = newBuffer(3);
        expect(() => buffer.checkLimit(4)).toThrow(IndexOutOfBoundsException);
    });

    it('shouldEqualOnInstance', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes);

        assertIs(wibbleBuffer, wibbleBuffer);
    });

    it('shouldEqualOnContent', () => {
        const wibbleBufferOne = new UnsafeBuffer(wibbleBytes);
        const wibbleBufferTwo = new UnsafeBuffer(wibbleBytes.slice());

        assertIs(wibbleBufferOne, wibbleBufferTwo);
    });

    it('shouldNotEqual', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes);
        const wobbleBuffer = new UnsafeBuffer(wobbleBytes);

        assertIsNot(wibbleBuffer, wobbleBuffer);
    });

    it('shouldEqualOnHashCode', () => {
        const wibbleBufferOne = new UnsafeBuffer(wibbleBytes);
        const wibbleBufferTwo = new UnsafeBuffer(wibbleBytes.slice());

        expect(wibbleBufferOne.hashCode()).toBe(wibbleBufferTwo.hashCode());
    });

    it('shouldEqualOnCompareContents', () => {
        const wibbleBufferOne = new UnsafeBuffer(wibbleBytes);
        const wibbleBufferTwo = new UnsafeBuffer(wibbleBytes.slice());

        expect(wibbleBufferOne.compareTo(wibbleBufferTwo)).toBe(0);
    });

    it('shouldCompareLessThanOnContents', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes);
        const wobbleBuffer = new UnsafeBuffer(wobbleBytes);

        expect(wibbleBuffer.compareTo(wobbleBuffer)).toBeLessThan(0);
    });

    it('shouldCompareGreaterThanOnContents', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes);
        const wobbleBuffer = new UnsafeBuffer(wobbleBytes);

        expect(wobbleBuffer.compareTo(wibbleBuffer)).toBeGreaterThan(0);
    });

    it('shouldCompareLessThanOnContentsOfDifferingCapacity', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes);
        const wibbleBuffer2 = new UnsafeBuffer(wibbleBytes2);

        expect(wibbleBuffer.compareTo(wibbleBuffer2)).toBeLessThan(0);
    });

    it('shouldExposePositionAtWhichByteArrayGetsWrapped', () => {
        const wibbleBuffer = new UnsafeBuffer(wibbleBytes, ADJUSTMENT_OFFSET, wibbleBytes.length - ADJUSTMENT_OFFSET);

        wibbleBuffer.putByte(0, VALUE);

        expect(wibbleBytes[wibbleBuffer.wrapAdjustment()]).toBe(VALUE);
    });

    // adapted: the ByteBuffer is the test/support stand-in, which an UnsafeBuffer wraps through its ArrayBuffer
    it('shouldExposePositionAtWhichHeapByteBufferGetsWrapped', () => {
        const wibbleByteBuffer = ByteBuffer.wrap(backing.arrayBuffer(wibbleBytes.length));
        shouldExposePositionAtWhichByteBufferGetsWrapped(wibbleByteBuffer);
    });

    // adapted: as shouldExposePositionAtWhichHeapByteBufferGetsWrapped
    it('shouldExposePositionAtWhichDirectByteBufferGetsWrapped', () => {
        const wibbleByteBuffer = ByteBuffer.allocateDirect(wibbleBytes.length, backing.shared);
        shouldExposePositionAtWhichByteBufferGetsWrapped(wibbleByteBuffer);
    });

    it('shouldWrapValidRange', () => {
        const buffer = new UnsafeBuffer(backing.bytes(8));
        const slice = new UnsafeBuffer();

        slice.wrap(buffer);
        slice.wrap(buffer, 0, 8);
        slice.wrap(buffer, 1, 7);
        slice.wrap(buffer, 2, 6);
        slice.wrap(buffer, 3, 5);
        slice.wrap(buffer, 4, 4);
        slice.wrap(buffer, 5, 3);
        slice.wrap(buffer, 6, 2);
        slice.wrap(buffer, 7, 1);
        slice.wrap(buffer, 8, 0);
    });

    it('shouldNotWrapInValidRange', () => {
        const buffer = new UnsafeBuffer(backing.bytes(8));
        const slice = new UnsafeBuffer();

        expect(() => slice.wrap(buffer, -1, 0)).toThrow(IndexOutOfBoundsException);
        expect(() => slice.wrap(buffer, 0, -1)).toThrow(IndexOutOfBoundsException);
        expect(() => slice.wrap(buffer, 8, 1)).toThrow(IndexOutOfBoundsException);
        expect(() => slice.wrap(buffer, 7, 3)).toThrow(IndexOutOfBoundsException);
    });

    it.each([123, -25])('putIntAsciiShouldBoundsCheckBeforeWritingAnyData %s', (value) => {
        if (!UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            return; // assumeTrue(UnsafeBuffer.SHOULD_BOUNDS_CHECK, "bounds check disabled!")
        }

        const index = 6;
        const buffer = new UnsafeBuffer(backing.bytes(8));
        expect(buffer.getByte(index)).toBe(0);

        const exception = assertThrowsExactly(IndexOutOfBoundsException, () => buffer.putIntAscii(index, value));
        expect(exception.message).toBe('Range [6, 6 + 3) out of bounds for length 8');

        expect(buffer.getByte(index)).toBe(0);
    });

    it.each([-251463777, 1234567890])('putLongAsciiShouldBoundsCheckBeforeWritingAnyData %s', (value) => {
        if (!UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            return; // assumeTrue(UnsafeBuffer.SHOULD_BOUNDS_CHECK, "bounds check disabled!")
        }

        const index = 1;
        const buffer = new UnsafeBuffer(backing.bytes(10));
        expect(buffer.getByte(index)).toBe(0);

        const exception = assertThrowsExactly(IndexOutOfBoundsException, () => buffer.putLongAscii(index, value));
        expect(exception.message).toBe('Range [1, 1 + 10) out of bounds for length 10');

        expect(buffer.getByte(index)).toBe(0);
    });

    // adapted: the ByteBuffer is the test/support stand-in, wrapped through its ArrayBuffer
    it.each(byteOrders())('parseIntAsciiIsNotDependentOnTheBufferEndianness %s', (byteOrder) => {
        const index = 13;
        const value = 1690021;
        const buffer = new UnsafeBuffer(ByteBuffer.allocate(32, backing.shared).order(byteOrder).arrayBuffer());
        const length = buffer.putIntAscii(index, value);

        expect(buffer.parseIntAscii(index, length)).toBe(value);
    });

    // adapted: as parseIntAsciiIsNotDependentOnTheBufferEndianness
    it.each(byteOrders())('parseLongAsciiIsNotDependentOnTheBufferEndianness %s', (byteOrder) => {
        const index = 4;
        const value = 16900210032;
        const buffer = new UnsafeBuffer(ByteBuffer.allocate(64, backing.shared).order(byteOrder).arrayBuffer());
        const length = buffer.putLongAscii(index, value);

        expect(buffer.parseLongAscii(index, length)).toBe(value);
    });

    // adapted: allocateDirectAligned returns an ArrayBuffer, so the buffer is a window at byteOffset `alignment`
    it.each([1, 2, 4])(
        'verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromImproperlyAlignedDirectByteBuffer %s',
        (alignment) => {
            const buffer = new UnsafeBuffer(backing.aligned(99 + alignment, alignment), alignment, 99);
            assertThrowsExactly(IllegalStateException, () => buffer.verifyAlignment());
        },
    );

    // adapted: the address 1133 is the offset 1133 of a window in an ArrayBuffer
    it('verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromAnUnalignedAddress', () => {
        const buffer = new UnsafeBuffer(backing.arrayBuffer(1133 + 8), 1133, 8);
        assertThrowsExactly(IllegalStateException, () => buffer.verifyAlignment());
    });

    it.each([8, 16, 64, 512])('verifyAlignmentWorksIfDirectBufferAlignedOnEightByteBoundaries %s', (alignment) => {
        const buffer = new UnsafeBuffer(backing.aligned(99, alignment));
        buffer.verifyAlignment();
    });

    // adapted: ExpandableArrayBuffer and ExpandableDirectByteBuffer are not ported, and the UnsafeBuffer over a heap
    // ByteBuffer is over an ArrayBuffer; the byteBuffer() assertions are dropped as there is no byteBuffer()
    it.each(directBuffers())('wrapDirectBuffer %s', (src) => {
        const buffer = new UnsafeBuffer(src);

        expect(buffer.byteArray()).toBe(src.byteArray());
        expect(buffer.capacity()).toBe(src.capacity());
        expect(buffer.addressOffset()).toBe(src.addressOffset());
        expect(buffer.wrapAdjustment()).toBe(src.wrapAdjustment());
    });

    // adapted: as wrapDirectBuffer
    it.each(directBuffers())('wrapDirectBufferWithOffsetAndLength %s', (src) => {
        const offset = 3;
        const length = 17;
        const buffer = new UnsafeBuffer(src, offset, length);

        expect(buffer.byteArray()).toBe(src.byteArray());
        expect(buffer.capacity()).toBe(length);
        expect(buffer.addressOffset()).toBe(src.addressOffset() + offset);
        expect(buffer.wrapAdjustment()).toBe(src.wrapAdjustment() + offset);
    });

    function byteOrders(): ByteOrder[] {
        return [ByteOrder.BIG_ENDIAN, ByteOrder.LITTLE_ENDIAN];
    }

    function shouldExposePositionAtWhichByteBufferGetsWrapped(byteBuffer: ByteBuffer): void {
        const wibbleBuffer = new UnsafeBuffer(
            byteBuffer.arrayBuffer(),
            ADJUSTMENT_OFFSET,
            byteBuffer.capacity() - ADJUSTMENT_OFFSET,
        );

        wibbleBuffer.putByte(0, VALUE);

        expect(byteBuffer.get(wibbleBuffer.wrapAdjustment())).toBe(VALUE);
    }

    function directBuffers(): DirectBuffer[] {
        const mockBuffer = {
            wrapAdjustment: vi.fn(() => 11),
            capacity: vi.fn(() => 99),
            byteArray: vi.fn(() => mockByteArray),
            addressOffset: vi.fn(() => 0), // Mockito's default for a long that is not stubbed
        } as unknown as DirectBuffer;
        const mockByteArray = new Uint8Array(5);
        return [new UnsafeBuffer(backing.arrayBuffer(64)), mockBuffer];
    }

    it.skip('wrapForRawMemoryAddressShouldResetWrapAdjustment', () => {
        // no direct memory / ByteBuffer in JS: wrap(long address, int length) is not ported
    });
});
