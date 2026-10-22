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
// Port of org/agrona/concurrent/ringbuffer/ManyToOneRingBufferTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { ControlledMessageHandler } from '../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import type { MessageHandler } from '../../../../src/agrona/concurrent/MessageHandler.js';
import { ManyToOneRingBuffer } from '../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { RecordDescriptor } from '../../../../src/agrona/concurrent/ringbuffer/RecordDescriptor.js';
import { RingBuffer } from '../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { RingBufferDescriptor } from '../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IllegalStateException, Long } from '../../../../src/agrona/jdk.js';
import { assertThrows } from '../../../support/Assertions.js';
import { BACKINGS } from '../../../support/Backing.js';
import {
    ANY,
    InOrder,
    type MockedUnsafeBuffer,
    mockUnsafeBuffer,
    verifyNever,
    when,
} from '../../../support/MockBuffer.js';
import { MutableInteger } from '../../../support/MutableInteger.js';

const { align } = BitUtil;
const { ALIGNMENT, HEADER_LENGTH, encodedMsgOffset, lengthOffset, typeOffset } = RecordDescriptor;
const { INSUFFICIENT_CAPACITY, PADDING_MSG_TYPE_ID } = RingBuffer;
const { HEAD_CACHE_POSITION_OFFSET, HEAD_POSITION_OFFSET, TAIL_POSITION_OFFSET, TRAILER_LENGTH } = RingBufferDescriptor;
const { MIN_CAPACITY } = ManyToOneRingBuffer;
const { SIZE_OF_LONG } = BitUtil;

describe.each(BACKINGS)('ManyToOneRingBufferTest over $name', (backing) => {
    const MSG_TYPE_ID = 7;
    const CAPACITY = 4096;
    const TOTAL_BUFFER_LENGTH = CAPACITY + TRAILER_LENGTH;
    const TAIL_COUNTER_INDEX = CAPACITY + TAIL_POSITION_OFFSET;
    const HEAD_COUNTER_INDEX = CAPACITY + HEAD_POSITION_OFFSET;
    const HEAD_COUNTER_CACHE_INDEX = CAPACITY + HEAD_CACHE_POSITION_OFFSET;

    // JUnit creates an instance of the test class, and so these fields, for each test
    let mocked: MockedUnsafeBuffer;
    let buffer: MockedUnsafeBuffer['spies'];
    let ringBuffer: ManyToOneRingBuffer;

    /** `inOrder(buffer)` */
    const inOrder = (): InOrder => new InOrder(mocked.all);

    const newBuffer = (length: number): UnsafeBuffer => new UnsafeBuffer(backing.arrayBuffer(length));

    beforeEach(() => {
        mocked = mockUnsafeBuffer();
        buffer = mocked.spies;
        when(buffer.capacity).thenReturn(TOTAL_BUFFER_LENGTH);

        ringBuffer = new ManyToOneRingBuffer(mocked.buffer);
    });

    it.each([2, 4])('shouldThrowExceptionIfCapacityIsBelowMinCapacity (%i)', (capacity) => {
        when(buffer.capacity).thenReturn(TRAILER_LENGTH + capacity);

        const exception = assertThrows(IllegalArgumentException, () => new ManyToOneRingBuffer(mocked.buffer));

        expect(exception.message).toBe(
            'insufficient capacity: minCapacity=' +
                (TRAILER_LENGTH + MIN_CAPACITY) +
                ', capacity=' +
                (TRAILER_LENGTH + capacity),
        );
    });

    it.each([
        [MIN_CAPACITY, 0],
        [MIN_CAPACITY * 2, HEADER_LENGTH],
        [MIN_CAPACITY * MIN_CAPACITY, 8],
        [1024, 128],
    ])('shouldComputeMaxMessageLength (%i, %i)', (capacity, maxMessageLength) => {
        when(buffer.capacity).thenReturn(TRAILER_LENGTH + capacity);

        const ringBuffer = new ManyToOneRingBuffer(mocked.buffer);
        expect(ringBuffer.maxMsgLength()).toBe(maxMessageLength);
    });

    it('shouldWriteToEmptyBuffer', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = 0;
        const head = 0;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tail, tail + alignedRecordLength).thenReturn(true);

        const srcBuffer = newBuffer(1024);
        const srcIndex = 0;

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), -recordLength);
        inOrder0.verify(buffer.putBytes, 1, encodedMsgOffset(tail), srcBuffer, srcIndex, length);
        inOrder0.verify(buffer.putInt, 1, typeOffset(tail), MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), recordLength);
    });

    it('shouldRejectWriteWhenInsufficientSpace', () => {
        const length = 200;
        const head = 0;
        const tail = head + (CAPACITY - align(length - ALIGNMENT, ALIGNMENT));

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(false);

        verifyNever(buffer.putInt, ANY, ANY);
        verifyNever(buffer.compareAndSetLong, ANY, ANY, ANY);
        verifyNever(buffer.putBytes, ANY, srcBuffer, ANY, ANY);
        verifyNever(buffer.putIntRelease, ANY, ANY);
    });

    it('shouldRejectWriteWhenBufferFull', () => {
        const length = 8;
        const head = 0;
        const tail = head + CAPACITY;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(false);

        verifyNever(buffer.putInt, ANY, ANY);
        verifyNever(buffer.compareAndSetLong, ANY, ANY, ANY);
        verifyNever(buffer.putIntRelease, ANY, ANY);
    });

    it('shouldInsertPaddingRecordPlusMessageOnBufferWrap', () => {
        const length = 200;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = CAPACITY - HEADER_LENGTH;
        const head = tail - ALIGNMENT * 4;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tail, tail + alignedRecordLength + ALIGNMENT).thenReturn(
            true,
        );

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), -HEADER_LENGTH);
        inOrder0.verify(buffer.putInt, 1, typeOffset(tail), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), HEADER_LENGTH);

        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(0), -recordLength);
        inOrder0.verify(buffer.putBytes, 1, encodedMsgOffset(0), srcBuffer, srcIndex, length);
        inOrder0.verify(buffer.putInt, 1, typeOffset(0), MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(0), recordLength);
    });

    it('shouldInsertPaddingRecordPlusMessageOnBufferWrapWithHeadEqualToTail', () => {
        const length = 200;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = CAPACITY - HEADER_LENGTH;
        const head = tail;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tail, tail + alignedRecordLength + ALIGNMENT).thenReturn(
            true,
        );

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), -HEADER_LENGTH);
        inOrder0.verify(buffer.putInt, 1, typeOffset(tail), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), HEADER_LENGTH);

        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(0), -recordLength);
        inOrder0.verify(buffer.putBytes, 1, encodedMsgOffset(0), srcBuffer, srcIndex, length);
        inOrder0.verify(buffer.putInt, 1, typeOffset(0), MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(0), recordLength);
    });

    it('shouldReadNothingFromEmptyBuffer', () => {
        const head = 0;

        when(buffer.getLong, HEAD_COUNTER_INDEX).thenReturn(head);

        const handler: MessageHandler = { onMessage: () => expect.fail('should not be called') };
        const messagesRead = ringBuffer.read(handler);

        expect(messagesRead).toBe(0);
    });

    it('shouldNotReadSingleMessagePartWayThroughWriting', () => {
        const head = 0;
        const headIndex = head;

        when(buffer.getLong, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getIntVolatile, lengthOffset(headIndex)).thenReturn(0);

        const times = new MutableInteger();
        const handler: MessageHandler = { onMessage: () => times.increment() };
        const messagesRead = ringBuffer.read(handler);

        expect(messagesRead).toBe(0);
        expect(times.get()).toBe(0);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getIntVolatile, 1, lengthOffset(headIndex));
        inOrder0.verify(buffer.setMemory, 0, headIndex, 0, 0);
        inOrder0.verify(buffer.putLongRelease, 0, HEAD_COUNTER_INDEX, headIndex);
    });

    it('shouldReadTwoMessages', () => {
        const msgLength = 16;
        const recordLength = HEADER_LENGTH + msgLength;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = alignedRecordLength * 2;
        const head = 0;
        const headIndex = head;

        when(buffer.getLong, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getInt, typeOffset(headIndex)).thenReturn(MSG_TYPE_ID);
        when(buffer.getIntVolatile, lengthOffset(headIndex)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(headIndex + alignedRecordLength)).thenReturn(MSG_TYPE_ID);
        when(buffer.getIntVolatile, lengthOffset(headIndex + alignedRecordLength)).thenReturn(recordLength);

        const times = new MutableInteger();
        const handler: MessageHandler = { onMessage: () => times.increment() };
        const messagesRead = ringBuffer.read(handler);

        expect(messagesRead).toBe(2);
        expect(times.get()).toBe(2);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.setMemory, 1, headIndex, alignedRecordLength * 2, 0);
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, tail);
    });

    it('shouldLimitReadOfMessages', () => {
        const msgLength = 16;
        const recordLength = HEADER_LENGTH + msgLength;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const head = 0;
        const headIndex = head;

        when(buffer.getLong, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getInt, typeOffset(headIndex)).thenReturn(MSG_TYPE_ID);
        when(buffer.getIntVolatile, lengthOffset(headIndex)).thenReturn(recordLength);

        const times = new MutableInteger();
        const handler: MessageHandler = { onMessage: () => times.increment() };
        const limit = 1;
        const messagesRead = ringBuffer.read(handler, limit);

        expect(messagesRead).toBe(1);
        expect(times.get()).toBe(1);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.setMemory, 1, headIndex, alignedRecordLength, 0);
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, head + alignedRecordLength);
    });

    it('shouldCopeWithExceptionFromHandler', () => {
        const msgLength = 16;
        const recordLength = HEADER_LENGTH + msgLength;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = alignedRecordLength * 2;
        const head = 0;
        const headIndex = head;

        when(buffer.getLong, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getInt, typeOffset(headIndex)).thenReturn(MSG_TYPE_ID);
        when(buffer.getIntVolatile, lengthOffset(headIndex)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(headIndex + alignedRecordLength)).thenReturn(MSG_TYPE_ID);
        when(buffer.getIntVolatile, lengthOffset(headIndex + alignedRecordLength)).thenReturn(recordLength);

        const times = new MutableInteger();
        const handler: MessageHandler = {
            onMessage: () => {
                if (times.incrementAndGet() === 2) {
                    throw new Error('RuntimeException');
                }
            },
        };

        try {
            ringBuffer.read(handler);
        } catch {
            expect(times.get()).toBe(2);

            const inOrder0 = inOrder();
            inOrder0.verify(buffer.setMemory, 1, headIndex, alignedRecordLength * 2, 0);
            inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, tail);

            return;
        }

        expect.fail('Should have thrown exception');
    });

    it('shouldNotUnblockWhenEmpty', () => {
        const position = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(position);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(position);

        expect(ringBuffer.unblock()).toBe(false);
    });

    it('shouldUnblockMessageWithHeader', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength * 2);
        when(buffer.getIntVolatile, messageLength).thenReturn(-messageLength);

        expect(ringBuffer.unblock()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putInt, 1, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(messageLength), messageLength);
    });

    it('shouldUnblockWhenFullWithHeader', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength + CAPACITY);
        when(buffer.getIntVolatile, messageLength).thenReturn(-messageLength);

        expect(ringBuffer.unblock()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putInt, 1, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(messageLength), messageLength);
    });

    it('shouldUnblockWhenFullWithoutHeader', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength + CAPACITY);
        when(buffer.getIntVolatile, messageLength * 2).thenReturn(messageLength);

        expect(ringBuffer.unblock()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putInt, 1, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(messageLength), messageLength);
    });

    it('shouldUnblockGapWithZeros', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength * 3);
        when(buffer.getIntVolatile, messageLength * 2).thenReturn(messageLength);

        expect(ringBuffer.unblock()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putInt, 1, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(messageLength), messageLength);
    });

    it('shouldNotUnblockGapWithMessageRaceOnSecondMessageIncreasingTailThenInterrupting', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength * 3);
        when(buffer.getIntVolatile, messageLength * 2).thenReturn(0, messageLength);

        expect(ringBuffer.unblock()).toBe(false);
        verifyNever(buffer.putInt, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
    });

    it('shouldNotUnblockGapWithMessageRaceWhenScanForwardTakesAnInterrupt', () => {
        const messageLength = ALIGNMENT * 4;
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(messageLength);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(messageLength * 3);
        when(buffer.getIntVolatile, messageLength * 2).thenReturn(0, messageLength);
        when(buffer.getIntVolatile, messageLength * 2 + ALIGNMENT).thenReturn(7);

        expect(ringBuffer.unblock()).toBe(false);
        verifyNever(buffer.putInt, typeOffset(messageLength), PADDING_MSG_TYPE_ID);
    });

    it('shouldCalculateCapacityForBuffer', () => {
        expect(ringBuffer.capacity()).toBe(CAPACITY);
    });

    it('shouldThrowExceptionForCapacityThatIsNotPowerOfTwo', () => {
        const capacity = 777;
        const totalBufferLength = capacity + TRAILER_LENGTH;
        expect(() => new ManyToOneRingBuffer(new UnsafeBuffer(backing.bytes(totalBufferLength)))).toThrow(
            IllegalArgumentException,
        );
    });

    it('shouldThrowExceptionWhenMaxMessageSizeExceeded', () => {
        const srcBuffer = newBuffer(1024);

        expect(() => ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, ringBuffer.maxMsgLength() + 1)).toThrow(
            IllegalArgumentException,
        );
    });

    it('shouldInsertPaddingAndWriteToBuffer', () => {
        const padding = 200;
        const messageLength = 400;
        const recordLength = messageLength + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);

        const tail = 2 * CAPACITY - padding;
        const head = tail;

        // free space is (200 + 300) more than message length (400)
        // but contiguous space (300) is less than message length (400)
        const headCache = CAPACITY + 300;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.getLongVolatile, HEAD_COUNTER_CACHE_INDEX).thenReturn(headCache);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tail, tail + alignedRecordLength + padding).thenReturn(true);

        const srcBuffer = new UnsafeBuffer(backing.bytes(messageLength));

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, messageLength)).toBe(true);
    });

    it('tryClaimShouldThrowIllegalArgumentExceptionIfMessageTypeIsInvalid', () => {
        expect(() => ringBuffer.tryClaim(-1, 10)).toThrow(IllegalArgumentException);
    });

    it('tryClaimShouldThrowIllegalArgumentExceptionIfLengthExceedsMaxMessageSize', () => {
        expect(() => ringBuffer.tryClaim(3, CAPACITY)).toThrow(IllegalArgumentException);
    });

    it('tryClaimShouldThrowIllegalArgumentExceptionIfLengthIsNegative', () => {
        expect(() => ringBuffer.tryClaim(MSG_TYPE_ID, -6)).toThrow(IllegalArgumentException);
    });

    it('tryClaimReturnsIndexAtWhichEncodedMessageStarts', () => {
        const length = 10;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const headPosition = 248;
        const tailPosition = 320;
        const recordIndex = tailPosition;
        when(buffer.getLongVolatile, HEAD_COUNTER_CACHE_INDEX).thenReturn(headPosition);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tailPosition);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tailPosition, tailPosition + alignedRecordLength).thenReturn(
            true,
        );

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(recordIndex + HEADER_LENGTH);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(
            buffer.compareAndSetLong,
            1,
            TAIL_COUNTER_INDEX,
            tailPosition,
            tailPosition + alignedRecordLength,
        );
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), -recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordIndex), MSG_TYPE_ID);
        inOrder0.verifyNoMoreInteractions();
    });

    it('tryClaimReturnsIndexAtWhichEncodedMessageStartsAfterPadding', () => {
        const length = 10;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const headPosition = 248;
        const padding = 22;
        const tailPosition = CAPACITY - padding;
        const paddingIndex = tailPosition;
        const recordIndex = 0;
        when(buffer.getLongVolatile, HEAD_COUNTER_CACHE_INDEX).thenReturn(headPosition);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tailPosition);
        when(
            buffer.compareAndSetLong,
            TAIL_COUNTER_INDEX,
            tailPosition,
            tailPosition + alignedRecordLength + padding,
        ).thenReturn(true);

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(recordIndex + HEADER_LENGTH);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(
            buffer.compareAndSetLong,
            1,
            TAIL_COUNTER_INDEX,
            tailPosition,
            tailPosition + alignedRecordLength + padding,
        );
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), -padding);
        inOrder0.verify(buffer.putInt, 1, typeOffset(paddingIndex), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), padding);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), -recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordIndex), MSG_TYPE_ID);
        inOrder0.verifyNoMoreInteractions();
    });

    it('tryClaimReturnsInsufficientCapacityHead', () => {
        const length = 10;
        const headPosition = 0;
        const tailPosition = CAPACITY - 10;
        when(buffer.getLongVolatile, HEAD_COUNTER_CACHE_INDEX).thenReturn(headPosition);
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(headPosition);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tailPosition);

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(INSUFFICIENT_CAPACITY);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verifyNoMoreInteractions();
    });

    it('tryClaimReturnsInsufficientCapacityTail', () => {
        const length = 10;
        const cachedHeadPosition = 0;
        const headPosition = CAPACITY + 8;
        const padding = 16;
        const tailPosition = 2 * CAPACITY - padding;
        const paddingIndex = tailPosition & (CAPACITY - 1);
        when(buffer.getLongVolatile, HEAD_COUNTER_CACHE_INDEX).thenReturn(cachedHeadPosition);
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(headPosition);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tailPosition);
        when(buffer.compareAndSetLong, TAIL_COUNTER_INDEX, tailPosition, tailPosition + padding).thenReturn(true);

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(INSUFFICIENT_CAPACITY);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_CACHE_INDEX, headPosition);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_CACHE_INDEX, headPosition);
        inOrder0.verify(buffer.compareAndSetLong, 1, TAIL_COUNTER_INDEX, tailPosition, tailPosition + padding);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), -padding);
        inOrder0.verify(buffer.putInt, 1, typeOffset(paddingIndex), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), padding);
        inOrder0.verifyNoMoreInteractions();
    });

    it.each([-2, 0, 7, CAPACITY + 1])('commitThrowsIllegalArgumentExceptionIfIndexIsOutOfBounds (%i)', (index) => {
        expect(() => ringBuffer.commit(index)).toThrow(IllegalArgumentException);
    });

    it('commitThrowsIllegalStateExceptionIfSpaceWasAlreadyCommitted', () => {
        testAlreadyCommitted((index) => ringBuffer.commit(index));
    });

    it('commitThrowsIllegalStateExceptionIfSpaceWasAlreadyAborted', () => {
        testAlreadyAborted((index) => ringBuffer.commit(index));
    });

    it('commitPublishesMessageByInvertingTheLengthValue', () => {
        const index = 128;
        const recordIndex = index - HEADER_LENGTH;
        const recordLength = -19;
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(recordLength);

        ringBuffer.commit(index);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getInt, 1, lengthOffset(recordIndex));
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), -recordLength);
        inOrder0.verifyNoMoreInteractions();
    });

    it.each([-1, 0, 7, CAPACITY + 1])('abortThrowsIllegalArgumentExceptionIfIndexIsInvalid (%i)', (index) => {
        expect(() => ringBuffer.abort(index)).toThrow(IllegalArgumentException);
    });

    it('abortThrowsIllegalStateExceptionIfSpaceWasAlreadyCommitted', () => {
        testAlreadyCommitted((index) => ringBuffer.abort(index));
    });

    it('abortThrowsIllegalStateExceptionIfSpaceWasAlreadyAborted', () => {
        testAlreadyAborted((index) => ringBuffer.abort(index));
    });

    it('abortMarksUnusedSpaceAsPadding', () => {
        const index = 108;
        const recordIndex = index - HEADER_LENGTH;
        const recordLength = -11111;
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(recordLength);

        ringBuffer.abort(index);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getInt, 1, lengthOffset(recordIndex));
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordIndex), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), -recordLength);
        inOrder0.verifyNoMoreInteractions();
    });

    // ExpandableArrayBuffer is not ported (see docs/mapping.md): the source is an UnsafeBuffer that is large enough
    it('shouldContinueOnControlledRead', () => {
        const msg = 'Hello World';
        const srcBuffer = newBuffer(64);
        const srcLength = srcBuffer.putStringAscii(0, msg);
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(1024));

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);

        const controlledMessageHandler: ControlledMessageHandler = {
            onMessage: (msgTypeId, buffer, index, length) => {
                expect(msgTypeId).toBe(MSG_TYPE_ID);
                expect(index).toBe(HEADER_LENGTH);
                expect(length).toBe(srcLength);
                expect(buffer.getStringAscii(index)).toBe(msg);

                return ControlledMessageHandler.Action.CONTINUE;
            },
        };

        const messagesRead = ringBuffer.controlledRead(controlledMessageHandler, 1);
        expect(messagesRead).toBe(1);
        expect(ringBuffer.consumerPosition()).toBe(ringBuffer.producerPosition());
    });

    it('shouldAbortOnControlledRead', () => {
        const msg = 'Hello World';
        const srcBuffer = newBuffer(64);
        const srcLength = srcBuffer.putStringAscii(0, msg);
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(1024));

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);

        const controlledMessageHandler: ControlledMessageHandler = {
            onMessage: (msgTypeId, buffer, index, length) => {
                expect(msgTypeId).toBe(MSG_TYPE_ID);
                expect(index).toBe(HEADER_LENGTH);
                expect(length).toBe(srcLength);
                expect(buffer.getStringAscii(index)).toBe(msg);

                return ControlledMessageHandler.Action.ABORT;
            },
        };

        const messagesRead = ringBuffer.controlledRead(controlledMessageHandler, 1);
        expect(messagesRead).toBe(0);
        expect(ringBuffer.consumerPosition()).toBe(0);
    });

    it('shouldAbortOnControlledReadOfSecondMessage', () => {
        const msg = 'Hello World';
        const srcBuffer = newBuffer(64);
        const srcLength = srcBuffer.putStringAscii(0, msg);
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(1024));
        const counter = new MutableInteger();

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);

        const controlledMessageHandler: ControlledMessageHandler = {
            onMessage: () =>
                counter.getAndIncrement() === 0
                    ? ControlledMessageHandler.Action.CONTINUE
                    : ControlledMessageHandler.Action.ABORT,
        };

        const messagesRead = ringBuffer.controlledRead(controlledMessageHandler);
        expect(counter.get()).toBe(2);
        expect(messagesRead).toBe(1);
        expect(ringBuffer.consumerPosition()).not.toBe(ringBuffer.producerPosition());
    });

    it('shouldCommitOnEachMessage', () => {
        const msg = 'Hello World';
        const srcBuffer = newBuffer(64);
        const srcLength = srcBuffer.putStringAscii(0, msg);
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(1024));
        const counter = new MutableInteger();

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, srcLength)).toBe(true);

        const controlledMessageHandler: ControlledMessageHandler = {
            onMessage: () => {
                if (0 === counter.getAndIncrement()) {
                    expect(ringBuffer.consumerPosition()).toBe(0);
                } else {
                    expect(ringBuffer.consumerPosition()).toBe(ringBuffer.producerPosition() / 2);
                }

                return ControlledMessageHandler.Action.COMMIT;
            },
        };

        const messagesRead = ringBuffer.controlledRead(controlledMessageHandler);
        expect(counter.get()).toBe(2);
        expect(messagesRead).toBe(2);
        expect(ringBuffer.consumerPosition()).toBe(ringBuffer.producerPosition());
    });

    it('shouldAllowWritingEmptyMessagesWhenCapacityIsMinimal', () => {
        const msgType = 13;
        const srcBuffer = new UnsafeBuffer(backing.bytes(MIN_CAPACITY));
        srcBuffer.putLong(0, Long.MAX_VALUE);
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(MIN_CAPACITY + TRAILER_LENGTH));

        expect(ringBuffer.write(msgType, srcBuffer, 0, 0)).toBe(true);

        // ring buffer is full so the second write should fail
        expect(ringBuffer.write(msgType, srcBuffer, 0, 0)).toBe(false);

        // write will succeed after the read
        expect(ringBuffer.read({ onMessage: (_msgTypeId, _buffer, _index, length) => expect(length).toBe(0) })).toBe(1);
        expect(ringBuffer.write(msgType, srcBuffer, 0, 0)).toBe(true);

        expect(ringBuffer.read({ onMessage: (_msgTypeId, _buffer, _index, length) => expect(length).toBe(0) })).toBe(1);
        expect(ringBuffer.read({ onMessage: () => expect.fail() })).toBe(0);
    });

    it('shouldWriteMessageAfterInsertedPaddingIsConsumedThusMakeEnoughContiguousSpace', () => {
        const msgType = 42;
        const srcBuffer = new UnsafeBuffer(backing.bytes(MIN_CAPACITY));
        const ringBuffer = new ManyToOneRingBuffer(newBuffer(MIN_CAPACITY * 2 + TRAILER_LENGTH));

        expect(ringBuffer.write(msgType, srcBuffer, 0, 0)).toBe(true);

        srcBuffer.putLong(0, Long.MAX_VALUE);
        expect(ringBuffer.write(msgType, srcBuffer, 0, MIN_CAPACITY)).toBe(false); // not enough space in the buffer

        // consume the message and move head
        expect(ringBuffer.read({ onMessage: (_msgTypeId, _buffer, _index, length) => expect(length).toBe(0) })).toBe(1);

        // not enough contiguous space --> insert padding
        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(false);

        // consume the padding and move head
        expect(ringBuffer.read({ onMessage: () => expect.fail() })).toBe(0);

        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(true); // message fits

        expect(
            ringBuffer.read({
                onMessage: (_msgTypeId, buffer, index) => expect(buffer.getLong(index)).toBe(Long.MAX_VALUE),
            }),
        ).toBe(1);
        expect(ringBuffer.read({ onMessage: () => expect.fail() })).toBe(0);
    });

    function testAlreadyCommitted(action: (index: number) => void): void {
        const index = HEADER_LENGTH;
        const recordIndex = index - HEADER_LENGTH;
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(0);

        const exception = assertThrows(IllegalStateException, () => action(index));
        expect(exception.message).toBe('claimed space previously committed');
    }

    function testAlreadyAborted(action: (index: number) => void): void {
        const index = 128;
        const recordIndex = index - HEADER_LENGTH;
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(10);
        when(buffer.getInt, typeOffset(recordIndex)).thenReturn(PADDING_MSG_TYPE_ID);

        const exception = assertThrows(IllegalStateException, () => action(index));
        expect(exception.message).toBe('claimed space previously aborted');
    }
});
