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
// Port of io/aeron/BufferBuilderTest.java @ 1.53.3
import { randomFillSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArrayUtil } from '../../src/agrona/collections/ArrayUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IllegalStateException } from '../../src/agrona/jdk.js';
import { Aeron } from '../../src/client/Aeron.js';
import { BufferBuilder } from '../../src/client/BufferBuilder.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { assertThrowsExactly } from '../support/Assertions.js';

const { INIT_MIN_CAPACITY } = BufferBuilder;
const { BEGIN_FRAG_FLAG } = FrameDescriptor;
const { computeFragmentedFrameLength, computePosition } = LogBufferDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { HDR_TYPE_ATS_SETUP, HDR_TYPE_DATA, HDR_TYPE_NAK, HDR_TYPE_RTTM, VERSION_FIELD_OFFSET } = HeaderFlyweight;

const INT_MAX = 2147483647;
const SIZE_OF_LONG = 8;
const CAFE_BABE_DEAD_BEEF = BigInt.asIntN(64, 0xcafe_babe_dead_beefn); // 0xCAFE_BABE_DEAD_BEEFL

// Java's (byte) cast
function toByte(value: number): number {
    return (value << 24) >> 24;
}

describe('BufferBuilder', () => {
    // JUnit creates a new test instance per test, so the builder is rebuilt before each one
    let bufferBuilder: BufferBuilder;

    beforeEach(() => {
        bufferBuilder = new BufferBuilder();
    });

    it.each([
        [0, 0, 4096],
        [4095, 1, 4096],
        [4096, 7, 4096],
        [100, 200, 4096],
        [101, 5000, 6144],
        [5000, 8080, 11250],
        [6666, 11111, 14998],
        [0, 2147483639, 2147483639],
        [2048, 2147483647, 2147483639],
        [5, 1000000000000, 2147483639],
    ])('shouldFindSuitableCapacity %d %d %d', (capacity, requiredCapacity, expected) => {
        expect(BufferBuilder.findSuitableCapacity(capacity, requiredCapacity)).toBe(expected);
    });

    it('shouldInitialiseToDefaultValues', () => {
        expect(bufferBuilder.capacity()).toBe(0);
        expect(bufferBuilder.limit()).toBe(0);
        expect(bufferBuilder.nextTermOffset()).toBe(Aeron.NULL_VALUE);
        expect(bufferBuilder.buffer().capacity()).toBe(0);
        // assertNull(buffer().byteBuffer()) is not ported: there is no ByteBuffer (spec D9)
        expect(bufferBuilder.buffer().byteArray()).toEqual(ArrayUtil.EMPTY_BYTE_ARRAY);
    });

    it('shouldGrowDirectBuffer', () => {
        const builder = new BufferBuilder(0, true);
        expect(builder.limit()).toBe(0);
        expect(builder.capacity()).toBe(0);
        expect(builder.buffer().capacity()).toBe(0);

        const appendedLength = 10;
        const srcBuffer = new UnsafeBuffer(new Uint8Array(appendedLength));
        builder.append(srcBuffer, 0, srcBuffer.capacity());

        expect(builder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(builder.buffer().capacity()).toBe(INIT_MIN_CAPACITY);
        expect(builder.limit()).toBe(appendedLength);
    });

    it.each([false, true])('shouldCreateHeaderBuffer %s', (isDirect) => {
        const builder = new BufferBuilder(0, isDirect);
        expect(builder.buffer()).not.toBeNull();
        expect(builder.headerBuffer).not.toBeNull();
        expect(builder.headerBuffer).not.toBe(builder.buffer());

        expect(builder.capacity()).toBe(0);
        expect(builder.limit()).toBe(0);
        expect(builder.buffer().capacity()).toBe(0);

        expect(builder.headerBuffer.capacity()).toBe(HEADER_LENGTH);
    });

    it.each([-1, INT_MAX, INT_MAX - 7])(
        'shouldThrowIllegalArgumentExceptionIfInitialCapacityIsOutOfRange %d',
        (initialCapacity) => {
            const exception = assertThrowsExactly(IllegalArgumentException, () => new BufferBuilder(initialCapacity));
            expect(exception.message).toBe(
                'initialCapacity outside range 0 - 2147483639: initialCapacity=' + initialCapacity,
            );
        },
    );

    it.each([-1, 65, 1000000])('shouldThrowIllegalArgumentExceptionIfLimitIsOutOfRange %d', (limit) => {
        const builder = new BufferBuilder(0);
        const exception = assertThrowsExactly(IllegalArgumentException, () => builder.limit(limit));
        expect(exception.message).toBe('limit outside range: capacity=' + builder.capacity() + ' limit=' + limit);
    });

    it.each([INT_MAX, INT_MAX - 23])('shouldThrowIllegalStateExceptionIfDataExceedsMaxCapacity %d', (length) => {
        const src = new UnsafeBuffer(new Uint8Array(16));
        src.putLong(0, Number.MAX_SAFE_INTEGER);
        src.putLong(SIZE_OF_LONG, Number.MIN_SAFE_INTEGER);

        const builder = new BufferBuilder(64);
        builder.append(src, 0, src.capacity());
        expect(builder.limit()).toBe(src.capacity());

        const exception = assertThrowsExactly(IllegalStateException, () => builder.append(src, 0, length));
        expect(exception.message).toBe(
            'insufficient capacity: maxCapacity=2147483639 limit=' + builder.limit() + ' additionalLength=' + length,
        );
    });

    it('shouldAppendNothingForZeroLength', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(INIT_MIN_CAPACITY));

        bufferBuilder.append(srcBuffer, 0, 0);

        expect(bufferBuilder.limit()).toBe(0);
        expect(bufferBuilder.capacity()).toBe(0);
    });

    it('shouldGrowToMultipleOfInitialCapacity', () => {
        const srcCapacity = INIT_MIN_CAPACITY * 5;
        const srcBuffer = new UnsafeBuffer(new Uint8Array(srcCapacity));

        bufferBuilder.append(srcBuffer, 0, srcBuffer.capacity());

        expect(bufferBuilder.limit()).toBe(srcCapacity);
        expect(bufferBuilder.capacity()).toBeGreaterThanOrEqual(srcCapacity);
    });

    it('shouldAppendThenReset', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(INIT_MIN_CAPACITY));

        bufferBuilder.append(srcBuffer, 0, srcBuffer.capacity());
        bufferBuilder.nextTermOffset(1024);

        expect(bufferBuilder.limit()).toBe(srcBuffer.capacity());
        expect(bufferBuilder.nextTermOffset()).toBe(1024);

        bufferBuilder.reset();

        expect(bufferBuilder.limit()).toBe(0);
        expect(bufferBuilder.nextTermOffset()).toBe(Aeron.NULL_VALUE);
    });

    it('shouldAppendOneBufferWithoutResizing', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(INIT_MIN_CAPACITY));
        const bytes = new TextEncoder().encode('Hello World');
        srcBuffer.putBytes(0, bytes, 0, bytes.length);

        bufferBuilder.append(srcBuffer, 0, bytes.length);

        const temp = new Uint8Array(bytes.length);
        bufferBuilder.buffer().getBytes(0, temp, 0, bytes.length);

        expect(bufferBuilder.limit()).toBe(bytes.length);
        expect(bufferBuilder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(bytes).toEqual(temp);
    });

    it('shouldAppendTwoBuffersWithoutResizing', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(INIT_MIN_CAPACITY));
        const bytes = new TextEncoder().encode('1111111122222222');
        srcBuffer.putBytes(0, bytes, 0, bytes.length);

        bufferBuilder.append(srcBuffer, 0, bytes.length / 2);
        bufferBuilder.append(srcBuffer, bytes.length / 2, bytes.length / 2);

        const temp = new Uint8Array(bytes.length);
        bufferBuilder.buffer().getBytes(0, temp, 0, bytes.length);

        expect(bufferBuilder.limit()).toBe(bytes.length);
        expect(bufferBuilder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(bytes).toEqual(temp);
    });

    it('shouldFillBufferWithoutResizing', () => {
        const bufferLength = 128;
        const buffer = new Uint8Array(bufferLength);
        buffer.fill(7);
        const srcBuffer = new UnsafeBuffer(buffer);

        const bufferBuilder = new BufferBuilder(bufferLength);
        const initialCapacity = bufferBuilder.capacity();

        bufferBuilder.append(srcBuffer, 0, bufferLength);

        const temp = new Uint8Array(bufferLength);
        bufferBuilder.buffer().getBytes(0, temp, 0, bufferLength);

        expect(bufferBuilder.limit()).toBe(bufferLength);
        expect(bufferBuilder.capacity()).toBe(initialCapacity);
        expect(buffer).toEqual(temp);
    });

    it('shouldResizeWhenBufferJustDoesNotFit', () => {
        const bufferLength = 128;
        const buffer = new Uint8Array(bufferLength + 1);
        buffer.fill(7);
        const srcBuffer = new UnsafeBuffer(buffer);

        const bufferBuilder = new BufferBuilder(bufferLength);

        bufferBuilder.append(srcBuffer, 0, buffer.length);

        const temp = new Uint8Array(buffer.length);
        bufferBuilder.buffer().getBytes(0, temp, 0, buffer.length);

        expect(bufferBuilder.limit()).toBe(buffer.length);
        expect(bufferBuilder.capacity()).toBeGreaterThan(bufferLength);
        expect(buffer).toEqual(temp);
    });

    it('shouldAppendTwoBuffersAndResize', () => {
        const bufferLength = 128;
        const buffer = new Uint8Array(bufferLength);
        const firstLength = buffer.length / 4;
        const secondLength = buffer.length / 2;
        buffer.fill(7, 0, firstLength + secondLength);
        const srcBuffer = new UnsafeBuffer(buffer);

        const bufferBuilder = new BufferBuilder(bufferLength / 2);

        bufferBuilder.append(srcBuffer, 0, firstLength);
        bufferBuilder.append(srcBuffer, firstLength, secondLength);

        const temp = new Uint8Array(buffer.length);
        bufferBuilder.buffer().getBytes(0, temp, 0, secondLength + firstLength);

        expect(bufferBuilder.limit()).toBe(firstLength + secondLength);
        expect(bufferBuilder.capacity()).toBeGreaterThanOrEqual(firstLength + secondLength);
        expect(buffer).toEqual(temp);
    });

    it('shouldCompactBufferToLowerLimit', () => {
        const bufferLength = INIT_MIN_CAPACITY / 2;
        const buffer = new Uint8Array(bufferLength);
        const srcBuffer = new UnsafeBuffer(buffer);

        const bufferBuilder = new BufferBuilder();

        const bufferCount = 5;
        for (let i = 0; i < bufferCount; i++) {
            bufferBuilder.append(srcBuffer, 0, buffer.length);
        }

        const expectedLimit = buffer.length * bufferCount;
        expect(bufferBuilder.limit()).toBe(expectedLimit);
        const expandedCapacity = bufferBuilder.capacity();
        expect(expandedCapacity).toBeGreaterThan(expectedLimit);

        bufferBuilder.reset();

        bufferBuilder.append(srcBuffer, 0, buffer.length);
        bufferBuilder.append(srcBuffer, 0, buffer.length);
        bufferBuilder.append(srcBuffer, 0, buffer.length);

        bufferBuilder.compact();

        expect(bufferBuilder.limit()).toBe(buffer.length * 3);
        expect(bufferBuilder.capacity()).toBeLessThan(expandedCapacity);
        expect(bufferBuilder.capacity()).toBe(bufferBuilder.limit());
    });

    it('captureFirstHeaderShouldCopyTheEntireHeader', () => {
        const reservedValue = 2n ** 63n - 1n - 117n; // Long.MAX_VALUE - 117
        const offset = 40;
        const headerFlyweight = new DataHeaderFlyweight();
        headerFlyweight.wrap(new Uint8Array(100), offset, 50);
        headerFlyweight.frameLength(512);
        headerFlyweight.version(0xa);
        headerFlyweight.flags(0b1110_0111);
        headerFlyweight.headerType(HDR_TYPE_RTTM);
        headerFlyweight.termOffset(384);
        headerFlyweight.sessionId(-890);
        headerFlyweight.streamId(555);
        headerFlyweight.termId(42);
        headerFlyweight.reservedValue(reservedValue);

        const header = new Header(5, 3);
        header.buffer(new UnsafeBuffer(headerFlyweight.byteArray()));
        header.offset(headerFlyweight.wrapAdjustment());
        const originalHeaderBuffer = header.buffer();

        expect(bufferBuilder.captureHeader(header)).toBe(bufferBuilder);

        expect(bufferBuilder.capacity()).toBe(0);
        expect(bufferBuilder.limit()).toBe(0);
        expect(header.buffer()).toBe(originalHeaderBuffer);
        expect(header.offset()).toBe(headerFlyweight.wrapAdjustment());

        headerFlyweight.wrap(bufferBuilder.headerBuffer, 0, HEADER_LENGTH);
        expect(bufferBuilder._completeHeader.frameLength()).toBe(512);
        expect(headerFlyweight.version()).toBe(0xa);
        expect(bufferBuilder._completeHeader.flags()).toBe(toByte(0b1110_0111));
        expect(headerFlyweight.headerType()).toBe(HDR_TYPE_RTTM);
        expect(bufferBuilder._completeHeader.termOffset()).toBe(384);
        expect(bufferBuilder._completeHeader.sessionId()).toBe(-890);
        expect(bufferBuilder._completeHeader.streamId()).toBe(555);
        expect(bufferBuilder._completeHeader.termId()).toBe(42);
        expect(bufferBuilder._completeHeader.reservedValue()).toBe(reservedValue);
    });

    it('shouldPrepareCompleteHeader', () => {
        const data = new UnsafeBuffer(new Uint8Array(999));

        const frameLength = 128;
        const termOffset = 1024;
        const version = 15;
        const type = HDR_TYPE_NAK;
        const sessionId = 87;
        const streamId = -9;
        const termId = 10;
        const reservedValue = CAFE_BABE_DEAD_BEEF;
        const headerFlyweight = new DataHeaderFlyweight();
        headerFlyweight.wrap(new Uint8Array(44), 1, 39);
        headerFlyweight.frameLength(frameLength);
        headerFlyweight.version(version);
        headerFlyweight.flags(0b1011_1001);
        headerFlyweight.headerType(type);
        headerFlyweight.termOffset(termOffset);
        headerFlyweight.sessionId(sessionId);
        headerFlyweight.streamId(streamId);
        headerFlyweight.termId(termId);
        headerFlyweight.reservedValue(reservedValue);

        const header = new Header(4, 48);
        header.buffer(new UnsafeBuffer(headerFlyweight.byteArray()));
        header.offset(headerFlyweight.wrapAdjustment());

        expect(bufferBuilder.captureHeader(header)).toBe(bufferBuilder);

        bufferBuilder.append(data, 0, frameLength - HEADER_LENGTH);
        bufferBuilder.append(data, 0, frameLength - HEADER_LENGTH);

        headerFlyweight.wrap(new Uint8Array(88), 19, 42);
        headerFlyweight.frameLength(frameLength);
        headerFlyweight.version(0xc);
        headerFlyweight.flags(0b0100_0100);
        headerFlyweight.headerType(HDR_TYPE_ATS_SETUP);
        headerFlyweight.termOffset(48);
        headerFlyweight.sessionId(999);
        headerFlyweight.streamId(4);
        headerFlyweight.termId(39);
        headerFlyweight.reservedValue(-(2n ** 63n)); // Long.MIN_VALUE
        header.buffer(new UnsafeBuffer(headerFlyweight.byteArray()));
        header.offset(headerFlyweight.wrapAdjustment());
        const originalHeaderBuffer = header.buffer();

        const completeHeader = bufferBuilder.completeHeader(header);
        expect(completeHeader).not.toBe(header);

        expect(bufferBuilder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(bufferBuilder.limit()).toBe(2 * (frameLength - HEADER_LENGTH));
        expect(header.buffer()).toBe(originalHeaderBuffer);
        expect(header.offset()).toBe(headerFlyweight.wrapAdjustment());
        expect(bufferBuilder.headerBuffer).not.toBe(bufferBuilder.buffer());
        expect(completeHeader.buffer()).toBe(bufferBuilder.headerBuffer);
        expect(completeHeader.offset()).toBe(0);
        expect(completeHeader.initialTermId()).toBe(4);
        expect(completeHeader.positionBitsToShift()).toBe(48);
        expect(completeHeader.frameLength()).toBe(HEADER_LENGTH + 2 * (frameLength - HEADER_LENGTH));
        expect(completeHeader.buffer().getByte(VERSION_FIELD_OFFSET)).toBe(toByte(version));
        expect(completeHeader.flags()).toBe(toByte(0xfd));
        expect(completeHeader.flags() & BEGIN_FRAG_FLAG).not.toBe(0);
        expect(completeHeader.type()).toBe(type);
        expect(completeHeader.termOffset()).toBe(termOffset);
        expect(completeHeader.sessionId()).toBe(sessionId);
        expect(completeHeader.streamId()).toBe(streamId);
        expect(completeHeader.termId()).toBe(termId);
        expect(completeHeader.reservedValue()).toBe(reservedValue);
    });

    it.each([
        [1024, 1408],
        [1024, 128],
        [8192, 1408],
    ])('shouldCalculatePositionAndFrameLengthWhenReassembling %d %d', (totalPayloadLength, mtu) => {
        const maxPayloadLength = mtu - HEADER_LENGTH;
        const termOffset = 1024;
        const termId = 10;
        const initialTermId = 4;
        const positionBitsToShift = 16;

        const expectedFrameLength = HEADER_LENGTH + totalPayloadLength;
        const fragmentedFrameLength = computeFragmentedFrameLength(totalPayloadLength, maxPayloadLength);
        const startPosition = computePosition(termId, termOffset, positionBitsToShift, initialTermId);
        const expectedPosition = startPosition + fragmentedFrameLength;

        const data = new UnsafeBuffer(new Uint8Array(totalPayloadLength));

        const firstHeader = new DataHeaderFlyweight();
        firstHeader.wrap(new Uint8Array(32));
        firstHeader.frameLength(HEADER_LENGTH + maxPayloadLength);
        firstHeader.version(15);
        firstHeader.flags(0b1011_1001);
        firstHeader.headerType(HDR_TYPE_DATA);
        firstHeader.termOffset(termOffset);
        firstHeader.sessionId(87);
        firstHeader.streamId(-9);
        firstHeader.termId(termId);
        firstHeader.reservedValue(CAFE_BABE_DEAD_BEEF);

        const header = new Header(initialTermId, positionBitsToShift);
        header.buffer(new UnsafeBuffer(firstHeader.byteArray()));
        header.offset(firstHeader.wrapAdjustment());

        bufferBuilder.captureHeader(header);

        let lastPayloadLength = 0;
        for (let position = 0; position < data.capacity(); position += maxPayloadLength) {
            lastPayloadLength = Math.min(maxPayloadLength, data.capacity() - position);
            bufferBuilder.append(data, position, lastPayloadLength);
        }

        expect(lastPayloadLength).not.toBe(0);

        const valueIsIgnored = -2147483648; // Integer.MIN_VALUE

        const lastHeader = new DataHeaderFlyweight();
        lastHeader.wrap(new Uint8Array(32));
        lastHeader.frameLength(HEADER_LENGTH + lastPayloadLength);
        lastHeader.version(15);
        lastHeader.flags(0b1011_1001);
        lastHeader.headerType(HDR_TYPE_DATA);
        lastHeader.termOffset(valueIsIgnored);
        lastHeader.sessionId(87);
        lastHeader.streamId(-9);
        lastHeader.termId(10);
        lastHeader.reservedValue(CAFE_BABE_DEAD_BEEF);
        header.buffer(new UnsafeBuffer(lastHeader.byteArray()));
        header.offset(lastHeader.wrapAdjustment());

        const completeHeader = bufferBuilder.completeHeader(header);

        expect(completeHeader.frameLength()).toBe(expectedFrameLength);
        expect(completeHeader.fragmentedFrameLength()).toBe(fragmentedFrameLength);
        expect(completeHeader.position()).toBe(expectedPosition);
    });

    it('compactEmptyBufferIsAnOp', () => {
        expect(bufferBuilder.compact()).toBe(bufferBuilder);

        expect(bufferBuilder.capacity()).toBe(0);
        expect(bufferBuilder.limit()).toBe(0);
        expect(bufferBuilder.buffer().capacity()).toBe(0);
    });

    it('compactIsANoOpIfTheCapacityIsNotDecreasing', () => {
        expect(bufferBuilder.append(new UnsafeBuffer(new Uint8Array(5)), 0, 3)).toBe(bufferBuilder);
        expect(bufferBuilder.limit()).toBe(3);
        expect(bufferBuilder.capacity()).toBe(INIT_MIN_CAPACITY);
        const originalBuffer = bufferBuilder.buffer();
        expect(originalBuffer.capacity()).toBe(INIT_MIN_CAPACITY);

        expect(bufferBuilder.compact()).toBe(bufferBuilder);

        expect(bufferBuilder.limit()).toBe(3);
        expect(bufferBuilder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(bufferBuilder.buffer()).toBe(originalBuffer);
        expect(originalBuffer.capacity()).toBe(INIT_MIN_CAPACITY);
    });

    it.each([false, true])('shouldNotChangeHeaderBufferUponResize %s', (isDirect) => {
        const builder = new BufferBuilder(0, isDirect);
        const headerBuffer = builder.headerBuffer;
        // headerBuffer.byteBuffer() is not checked: there is no ByteBuffer (spec D9)
        const headerByteArray = headerBuffer.byteArray();
        headerBuffer.setMemory(0, headerBuffer.capacity(), 0xfa);

        const src = new UnsafeBuffer(new Uint8Array(100));
        randomFillSync(src.byteArray());
        builder.append(src, 0, src.capacity());

        expect(builder.headerBuffer).toBe(headerBuffer);
        expect(builder.headerBuffer.byteArray()).toBe(headerByteArray);
        for (let i = 0; i < headerBuffer.capacity(); i++) {
            expect(headerBuffer.getByte(i)).toBe(toByte(0xfa));
        }
    });
});
