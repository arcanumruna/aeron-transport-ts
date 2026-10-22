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
// Port of org/agrona/concurrent/AtomicBufferTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Byte, ByteOrder, Integer, Short } from '../../../src/agrona/jdk.js';
import { BACKINGS } from '../../support/Backing.js';
import { ByteBuffer } from '../../support/ByteBuffer.js';

const { SIZE_OF_LONG } = BitUtil;
const { BIG_ENDIAN, LITTLE_ENDIAN, nativeOrder } = ByteOrder;

const US_ASCII = new TextEncoder();

/**
 * adapted: `new UnsafeBuffer(ByteBuffer)` is not ported; the UnsafeBuffer wraps the window of the ArrayBuffer that the
 * ByteBuffer (the test/support stand-in) is a view of.
 */
function newUnsafeBuffer(buffer: ByteBuffer): UnsafeBuffer {
    return new UnsafeBuffer(buffer.arrayBuffer(), buffer.arrayOffset(), buffer.capacity());
}

describe.each(BACKINGS)('AtomicBufferTest over $name', (backing) => {
    const BUFFER_CAPACITY = 64;
    const INDEX = 8;

    const BYTE_VALUE = 1;
    const SHORT_VALUE = Byte.MAX_VALUE + 2;
    const CHAR_VALUE = '8'.charCodeAt(0);
    const INT_VALUE = Short.MAX_VALUE + 3;
    const FLOAT_VALUE = Short.MAX_VALUE + 4.0;
    const LONG_VALUE = Integer.MAX_VALUE + 5;
    const DOUBLE_VALUE = Integer.MAX_VALUE + 7.0;

    it.each(nativeBuffers())('shouldCopyMemory %s', (buffer) => {
        const expected = US_ASCII.encode('xxxxxxxxxxx');

        const unsafeBuffer = newUnsafeBuffer(buffer);
        unsafeBuffer.setMemory(0, expected.length, 'x'.charCodeAt(0));

        const buff = new Uint8Array(expected.length);
        buffer.get(buff);
        expect(buff).toEqual(expected);
    });

    it.each(nativeBuffers())('shouldGetLongFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putLong(INDEX, LONG_VALUE);

        expect(unsafeBuffer.getLong(INDEX, buffer.order())).toBe(LONG_VALUE);
    });

    it.each(nativeBuffers())('shouldPutLongToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putLong(INDEX, LONG_VALUE, buffer.order());

        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE);
    });

    it.each(atomicBuffers())('shouldPutLongVolatileToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putLongVolatile(INDEX, LONG_VALUE);

        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE);
    });

    it.each(atomicBuffers())('shouldPutLongReleaseToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putLongRelease(INDEX, LONG_VALUE);

        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE);
    });

    it.each(atomicBuffers())('shouldAddLongReleaseToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        const initialValue = Integer.MAX_VALUE + 7;
        const increment = 9;
        unsafeBuffer.putLongRelease(INDEX, initialValue);
        unsafeBuffer.addLongRelease(INDEX, increment);

        expect(buffer.getLong(INDEX)).toBe(initialValue + increment);
    });

    it.each(atomicBuffers())('shouldCompareAndSetLongToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putLong(INDEX, LONG_VALUE);

        expect(unsafeBuffer.compareAndSetLong(INDEX, LONG_VALUE, LONG_VALUE + 1)).toBe(true);

        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE + 1);
    });

    it.each(atomicBuffers())('shouldCompareAndExchangeLongToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putLong(INDEX, LONG_VALUE);

        // success
        expect(unsafeBuffer.compareAndExchangeLong(INDEX, LONG_VALUE, LONG_VALUE + 1)).toBe(LONG_VALUE);
        expect(unsafeBuffer.getLongVolatile(INDEX)).toBe(LONG_VALUE + 1);

        // failure
        expect(unsafeBuffer.compareAndExchangeLong(INDEX, LONG_VALUE + 10, 21)).toBe(LONG_VALUE + 1);
        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE + 1);
    });

    it.each(atomicBuffers())('shouldGetAndSetLongToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putLong(INDEX, LONG_VALUE);

        const afterValue = 1;
        const beforeValue = unsafeBuffer.getAndSetLong(INDEX, afterValue);

        expect(beforeValue).toBe(LONG_VALUE);
        expect(buffer.getLong(INDEX)).toBe(afterValue);
    });

    it.each(atomicBuffers())('shouldGetAndAddLongToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putLong(INDEX, LONG_VALUE);

        const delta = 1;
        const beforeValue = unsafeBuffer.getAndAddLong(INDEX, delta);

        expect(beforeValue).toBe(LONG_VALUE);
        expect(buffer.getLong(INDEX)).toBe(LONG_VALUE + delta);
    });

    it.each(nativeBuffers())('shouldGetIntFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        expect(unsafeBuffer.getInt(INDEX, buffer.order())).toBe(INT_VALUE);
    });

    it.each(nativeBuffers())('shouldPutIntToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putInt(INDEX, INT_VALUE, buffer.order());

        expect(buffer.getInt(INDEX)).toBe(INT_VALUE);
    });

    it.each(atomicBuffers())('shouldGetIntVolatileFromNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        expect(unsafeBuffer.getIntVolatile(INDEX)).toBe(INT_VALUE);
    });

    it.each(atomicBuffers())('shouldPutIntVolatileToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putIntVolatile(INDEX, INT_VALUE);

        expect(buffer.getInt(INDEX)).toBe(INT_VALUE);
    });

    it.each(atomicBuffers())('shouldPutIntReleaseToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putIntRelease(INDEX, INT_VALUE);

        expect(buffer.getInt(INDEX)).toBe(INT_VALUE);
    });

    it.each(atomicBuffers())('shouldAddIntReleaseToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        const initialValue = 7;
        const increment = 9;
        unsafeBuffer.putIntRelease(INDEX, initialValue);
        unsafeBuffer.addIntRelease(INDEX, increment);

        expect(buffer.getInt(INDEX)).toBe(initialValue + increment);
    });

    it.each(atomicBuffers())('shouldCompareAndSetIntToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        expect(unsafeBuffer.compareAndSetInt(INDEX, INT_VALUE, INT_VALUE + 1)).toBe(true);

        expect(buffer.getInt(INDEX)).toBe(INT_VALUE + 1);
    });

    it.each(atomicBuffers())('shouldCompareAndExchangeIntToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        // success
        expect(unsafeBuffer.compareAndExchangeInt(INDEX, INT_VALUE, INT_VALUE + 1)).toBe(INT_VALUE);
        expect(unsafeBuffer.getIntVolatile(INDEX)).toBe(INT_VALUE + 1);

        // failure
        expect(unsafeBuffer.compareAndExchangeInt(INDEX, INT_VALUE + 10, 21)).toBe(INT_VALUE + 1);
        expect(buffer.getInt(INDEX)).toBe(INT_VALUE + 1);
    });

    it.each(atomicBuffers())('shouldGetAndSetIntToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        const afterValue = 1;
        const beforeValue = unsafeBuffer.getAndSetInt(INDEX, afterValue);

        expect(beforeValue).toBe(INT_VALUE);
        expect(buffer.getInt(INDEX)).toBe(afterValue);
    });

    it.each(atomicBuffers())('shouldGetAndAddIntToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putInt(INDEX, INT_VALUE);

        const delta = 1;
        const beforeValue = unsafeBuffer.getAndAddInt(INDEX, delta);

        expect(beforeValue).toBe(INT_VALUE);
        expect(buffer.getInt(INDEX)).toBe(INT_VALUE + delta);
    });

    it.each(nativeBuffers())('shouldGetShortFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putShort(INDEX, SHORT_VALUE);

        expect(unsafeBuffer.getShort(INDEX, buffer.order())).toBe(SHORT_VALUE);
    });

    it.each(nativeBuffers())('shouldPutShortToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putShort(INDEX, SHORT_VALUE, buffer.order());

        expect(buffer.getShort(INDEX)).toBe(SHORT_VALUE);
    });

    it.each(nativeBuffers())('shouldGetShortFromNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putShort(INDEX, SHORT_VALUE);

        expect(unsafeBuffer.getShort(INDEX, buffer.order())).toBe(SHORT_VALUE);
    });

    it.each(nativeBuffers())('shouldPutShortToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putShort(INDEX, SHORT_VALUE, buffer.order());

        expect(buffer.getShort(INDEX)).toBe(SHORT_VALUE);
    });

    it.each(atomicBuffers())('shouldGetShortVolatileFromNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putShort(INDEX, SHORT_VALUE);

        expect(unsafeBuffer.getShortVolatile(INDEX)).toBe(SHORT_VALUE);
    });

    it.each(atomicBuffers())('shouldPutShortVolatileToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putShortVolatile(INDEX, SHORT_VALUE);

        expect(buffer.getShort(INDEX)).toBe(SHORT_VALUE);
    });

    it.each(nativeBuffers())('shouldGetCharFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putChar(INDEX, CHAR_VALUE);

        expect(unsafeBuffer.getChar(INDEX, buffer.order())).toBe(CHAR_VALUE);
    });

    it.each(nativeBuffers())('shouldPutCharToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putChar(INDEX, CHAR_VALUE, buffer.order());

        expect(buffer.getChar(INDEX)).toBe(CHAR_VALUE);
    });

    it.each(nativeBuffers())('shouldGetCharFromNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putChar(INDEX, CHAR_VALUE);

        expect(unsafeBuffer.getChar(INDEX, buffer.order())).toBe(CHAR_VALUE);
    });

    it.each(nativeBuffers())('shouldPutCharToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putChar(INDEX, CHAR_VALUE, buffer.order());

        expect(buffer.getChar(INDEX)).toBe(CHAR_VALUE);
    });

    it.each(atomicBuffers())('shouldGetCharVolatileFromNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putChar(INDEX, CHAR_VALUE);

        expect(unsafeBuffer.getCharVolatile(INDEX)).toBe(CHAR_VALUE);
    });

    it.each(atomicBuffers())('shouldPutCharVolatileToNativeBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putCharVolatile(INDEX, CHAR_VALUE);

        expect(buffer.getChar(INDEX)).toBe(CHAR_VALUE);
    });

    it.each(nativeBuffers())('shouldGetDoubleFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putDouble(INDEX, DOUBLE_VALUE);

        expect(unsafeBuffer.getDouble(INDEX, buffer.order())).toBe(DOUBLE_VALUE);
    });

    it.each(nativeBuffers())('shouldPutDoubleToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putDouble(INDEX, DOUBLE_VALUE, buffer.order());

        expect(buffer.getDouble(INDEX)).toBe(DOUBLE_VALUE);
    });

    it.each(nativeBuffers())('shouldGetFloatFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.putFloat(INDEX, FLOAT_VALUE);

        expect(unsafeBuffer.getFloat(INDEX, buffer.order())).toBe(FLOAT_VALUE);
    });

    it.each(nativeBuffers())('shouldPutFloatToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putFloat(INDEX, FLOAT_VALUE, buffer.order());

        expect(buffer.getFloat(INDEX)).toBe(FLOAT_VALUE);
    });

    it.each(nativeBuffers())('shouldGetByteFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.put(INDEX, BYTE_VALUE);

        expect(unsafeBuffer.getByte(INDEX)).toBe(BYTE_VALUE);
    });

    it.each(nativeBuffers())('shouldPutByteToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putByte(INDEX, BYTE_VALUE);

        expect(buffer.get(INDEX)).toBe(BYTE_VALUE);
    });

    it.each(nativeBuffers())('shouldGetByteVolatileFromBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        buffer.put(INDEX, BYTE_VALUE);

        expect(unsafeBuffer.getByteVolatile(INDEX)).toBe(BYTE_VALUE);
    });

    it.each(nativeBuffers())('shouldPutByteVolatileToBuffer %s', (buffer) => {
        const unsafeBuffer = newUnsafeBuffer(buffer);

        unsafeBuffer.putByteVolatile(INDEX, BYTE_VALUE);

        expect(buffer.get(INDEX)).toBe(BYTE_VALUE);
    });

    it.each(nativeBuffers())('shouldGetBytesFromBuffer %s', (buffer) => {
        const testBytes = US_ASCII.encode('Hello World');

        const unsafeBuffer = newUnsafeBuffer(buffer);
        buffer.position(INDEX);
        buffer.put(testBytes);

        const buff = new Uint8Array(testBytes.length);
        unsafeBuffer.getBytes(INDEX, buff);

        expect(buff).toEqual(testBytes);
    });

    it.skip('shouldGetBytesFromBufferToBuffer', () => {
        // no direct memory / ByteBuffer in JS: getBytes(int, ByteBuffer, int) is not ported
    });

    it.skip('shouldGetBytesFromBufferToSlice', () => {
        // no direct memory / ByteBuffer in JS: getBytes(int, ByteBuffer, int) is not ported
    });

    it('verifyIntOpaqueOperations', () => {
        const unsafeBuffer = new UnsafeBuffer(backing.bytes(4));
        const index = 0;
        expect(unsafeBuffer.getIntOpaque(index)).toBe(0);
        unsafeBuffer.putIntOpaque(index, 10);
        expect(unsafeBuffer.getIntOpaque(index)).toBe(10);
        expect(unsafeBuffer.addIntOpaque(0, 2)).toBe(10);
        expect(unsafeBuffer.getIntOpaque(index)).toBe(12);
    });

    it('verifyIntReleaseAcquireOperations', () => {
        const unsafeBuffer = new UnsafeBuffer(backing.bytes(4));
        const index = 0;
        expect(unsafeBuffer.getIntAcquire(index)).toBe(0);
        unsafeBuffer.putIntRelease(index, 10);
        expect(unsafeBuffer.getIntAcquire(index)).toBe(10);
        expect(unsafeBuffer.addIntRelease(0, 2)).toBe(10);
        expect(unsafeBuffer.getIntAcquire(index)).toBe(12);
    });

    it('verifyLongOpaqueOperations', () => {
        const unsafeBuffer = new UnsafeBuffer(backing.bytes(8));
        const index = 0;
        expect(unsafeBuffer.getLongOpaque(index)).toBe(0);
        unsafeBuffer.putLongOpaque(index, 10);
        expect(unsafeBuffer.getLongOpaque(index)).toBe(10);
        expect(unsafeBuffer.addLongOpaque(index, 2)).toBe(10);
        expect(unsafeBuffer.getLongOpaque(index)).toBe(12);
    });

    it('verifyLongReleaseAcquireOperations', () => {
        const unsafeBuffer = new UnsafeBuffer(backing.bytes(8));
        const index = 0;
        expect(unsafeBuffer.getLongAcquire(index)).toBe(0);
        unsafeBuffer.putLongRelease(index, 10);
        expect(unsafeBuffer.getLongAcquire(index)).toBe(10);
        expect(unsafeBuffer.addLongRelease(index, 2)).toBe(10);
        expect(unsafeBuffer.getLongAcquire(index)).toBe(12);
    });

    it.skip('verifyAlignmentShouldThrowForAByteArrayIfStrictAlignmentChecksAreEnabled', () => {
        // no JVM equivalent: whether a byte[] is aligned (object layout, STRICT_ALIGNMENT_CHECKS) does not exist in JS
    });

    it.skip('verifyAlignmentShouldThrowForAHeapByteBufferArrayIfStrictAlignmentChecksAreEnabled', () => {
        // no JVM equivalent: whether a byte[] is aligned (object layout, STRICT_ALIGNMENT_CHECKS) does not exist in JS
    });

    it.skip('verifyAlignmentShouldWarnForAByteArrayWhenStrictChecksAreDisabled', () => {
        // no JVM equivalent: whether a byte[] is aligned (object layout, STRICT_ALIGNMENT_CHECKS) does not exist in JS
    });

    function sliceBuffer(buffer: ByteBuffer): ByteBuffer {
        return buffer.slice();
    }

    function nativeBuffers(): ByteBuffer[] {
        return [
            ByteBuffer.allocate(BUFFER_CAPACITY, backing.shared).order(LITTLE_ENDIAN),
            ByteBuffer.allocateDirect(BUFFER_CAPACITY, backing.shared).order(BIG_ENDIAN),
            sliceBuffer(ByteBuffer.allocate(BUFFER_CAPACITY * 2, backing.shared).position(BUFFER_CAPACITY)),
        ];
    }

    function atomicBuffers(): ByteBuffer[] {
        // adapted: allocateDirectAligned returns an ArrayBuffer, which the ByteBuffer stand-in wraps
        return [ByteBuffer.wrap(backing.aligned(BUFFER_CAPACITY, SIZE_OF_LONG)).order(nativeOrder())];
    }
});
