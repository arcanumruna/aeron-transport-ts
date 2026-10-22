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
// Port of org/agrona/concurrent/ringbuffer/OneToOneRingBufferTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { ControlledMessageHandler } from '../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import type { MessageHandler } from '../../../../src/agrona/concurrent/MessageHandler.js';
import { OneToOneRingBuffer } from '../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
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
const { MIN_CAPACITY } = OneToOneRingBuffer;
const { SIZE_OF_LONG } = BitUtil;

describe.each(BACKINGS)('OneToOneRingBufferTest over $name', (backing) => {
    const MSG_TYPE_ID = 7;
    const CAPACITY = 4096;
    const TOTAL_BUFFER_LENGTH = CAPACITY + TRAILER_LENGTH;
    const TAIL_COUNTER_INDEX = CAPACITY + TAIL_POSITION_OFFSET;
    const HEAD_COUNTER_INDEX = CAPACITY + HEAD_POSITION_OFFSET;
    const HEAD_COUNTER_CACHE_INDEX = CAPACITY + HEAD_CACHE_POSITION_OFFSET;

    // JUnit creates an instance of the test class, and so these fields, for each test
    let mocked: MockedUnsafeBuffer;
    let buffer: MockedUnsafeBuffer['spies'];
    let ringBuffer: OneToOneRingBuffer;

    /** `inOrder(buffer)` */
    const inOrder = (): InOrder => new InOrder(mocked.all);

    const newBuffer = (length: number): UnsafeBuffer => new UnsafeBuffer(backing.arrayBuffer(length));

    beforeEach(() => {
        mocked = mockUnsafeBuffer();
        buffer = mocked.spies;
        when(buffer.capacity).thenReturn(TOTAL_BUFFER_LENGTH);

        ringBuffer = new OneToOneRingBuffer(mocked.buffer);
    });

    it.each([2, 4, 8])('shouldThrowExceptionIfCapacityIsBelowMinCapacity (%i)', (capacity) => {
        when(buffer.capacity).thenReturn(TRAILER_LENGTH + capacity);

        const exception = assertThrows(IllegalArgumentException, () => new OneToOneRingBuffer(mocked.buffer));

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
        [MIN_CAPACITY * MIN_CAPACITY, 32],
        [1024, 128],
    ])('shouldComputeMaxMessageLength (%i, %i)', (capacity, maxMessageLength) => {
        when(buffer.capacity).thenReturn(TRAILER_LENGTH + capacity);

        const ringBuffer = new OneToOneRingBuffer(mocked.buffer);
        expect(ringBuffer.maxMsgLength()).toBe(maxMessageLength);
    });

    it('shouldWriteToEmptyBuffer', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = 0;
        const head = 0;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(12);
        const srcIndex = 4;

        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + alignedRecordLength);
        inOrder0.verify(buffer.putLong, 1, tail + alignedRecordLength, 0);
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
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(false);

        verifyNever(buffer.putBytes, ANY, srcBuffer, ANY, ANY);
        verifyNever(buffer.putLong, ANY, ANY);
        verifyNever(buffer.putLongRelease, ANY, ANY);
        verifyNever(buffer.putIntRelease, ANY, ANY);
    });

    it('shouldRejectWriteWhenBufferFull', () => {
        const length = 8;
        const head = 0;
        const tail = head + CAPACITY;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(false);

        verifyNever(buffer.putLongRelease, ANY, ANY);
    });

    it('shouldInsertPaddingRecordPlusMessageOnBufferWrap', () => {
        const length = 200;
        const recordLength = length + HEADER_LENGTH;
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const tail = CAPACITY - HEADER_LENGTH;
        const head = tail - ALIGNMENT * 4;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + alignedRecordLength + HEADER_LENGTH);

        inOrder0.verify(buffer.putLong, 1, 0, 0);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), -HEADER_LENGTH);
        inOrder0.verify(buffer.putInt, 1, typeOffset(tail), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), HEADER_LENGTH);

        inOrder0.verify(buffer.putLong, 1, alignedRecordLength, 0);

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
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);

        const srcIndex = 0;
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, srcIndex, length)).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + alignedRecordLength + HEADER_LENGTH);

        inOrder0.verify(buffer.putLong, 1, 0, 0);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), -HEADER_LENGTH);
        inOrder0.verify(buffer.putInt, 1, typeOffset(tail), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(tail), HEADER_LENGTH);

        inOrder0.verify(buffer.putLong, 1, alignedRecordLength, 0);

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
        inOrder0.verify(buffer.setMemory, 0, ANY, ANY, ANY);
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
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, tail);
        inOrder0.verify(buffer.setMemory, 0, ANY, ANY, ANY);
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
        inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, head + alignedRecordLength);
        inOrder0.verify(buffer.setMemory, 0, ANY, ANY, ANY);
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
            inOrder0.verify(buffer.putLongRelease, 1, HEAD_COUNTER_INDEX, tail);
            inOrder0.verify(buffer.setMemory, 0, ANY, ANY, ANY);

            return;
        }

        expect.fail('Should have thrown exception');
    });

    it('shouldNotUnblockBecauseNotOtherProducersToRaceWith', () => {
        expect(ringBuffer.unblock()).toBe(false);
    });

    it('shouldCalculateCapacityForBuffer', () => {
        expect(ringBuffer.capacity()).toBe(CAPACITY);
    });

    it('shouldThrowExceptionForCapacityThatIsNotPowerOfTwo', () => {
        const capacity = 777;
        const totalBufferLength = capacity + TRAILER_LENGTH;
        expect(() => new OneToOneRingBuffer(new UnsafeBuffer(backing.bytes(totalBufferLength)))).toThrow(
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

        const tail = 2 * CAPACITY - padding;
        const head = tail;

        // free space is (200 + 300) more than message length (400)
        // but contiguous space (300) is less than message length (400)
        const headCache = CAPACITY + 300;

        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(head);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.getLong, HEAD_COUNTER_CACHE_INDEX).thenReturn(headCache);

        const srcBuffer = new UnsafeBuffer(backing.bytes(messageLength));
        expect(ringBuffer.write(MSG_TYPE_ID, srcBuffer, 0, messageLength)).toBe(true);
    });

    it('tryClaimThrowsIllegalArgumentExceptionIfMessageTypeIdIsInvalid', () => {
        expect(() => ringBuffer.tryClaim(0, 10)).toThrow(IllegalArgumentException);
    });

    it('tryClaimThrowsIllegalArgumentExceptionIfLengthIsBiggerThanMaxMessageLength', () => {
        expect(() => ringBuffer.tryClaim(MSG_TYPE_ID, 2000)).toThrow(IllegalArgumentException);
    });

    it('tryClaimThrowsIllegalArgumentExceptionIfLengthIsNegative', () => {
        expect(() => ringBuffer.tryClaim(MSG_TYPE_ID, -5)).toThrow(IllegalArgumentException);
    });

    it('tryClaimReturnsOffsetAtWhichMessageBodyCanBeWritten', () => {
        const msgTypeId = MSG_TYPE_ID;
        const length = 333;
        const recordLength = HEADER_LENGTH + length;
        const alignedRecordLength = align(recordLength, ALIGNMENT);

        const index = ringBuffer.tryClaim(msgTypeId, length);

        expect(index).toBe(HEADER_LENGTH);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, alignedRecordLength);
        inOrder0.verify(buffer.putLong, 1, alignedRecordLength, 0);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(0), -recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(0), msgTypeId);
    });

    it('tryClaimReturnsInsufficientCapacityIfThereIsNotEnoughSpaceInTheBuffer', () => {
        const length = 10;
        when(buffer.getLong, HEAD_COUNTER_CACHE_INDEX).thenReturn(10);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(CAPACITY);

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(INSUFFICIENT_CAPACITY);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verifyNoMoreInteractions();
    });

    it('tryClaimReturnsInsufficientCapacityIfThereIsNotEnoughSpaceInTheBufferAfterWrap', () => {
        const length = 100;
        when(buffer.getLong, HEAD_COUNTER_CACHE_INDEX).thenReturn(22);
        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(CAPACITY * 2 - 10);
        when(buffer.getLongVolatile, HEAD_COUNTER_INDEX).thenReturn(CAPACITY + 111, 3);

        const index = ringBuffer.tryClaim(MSG_TYPE_ID, length);

        expect(index).toBe(INSUFFICIENT_CAPACITY);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, HEAD_COUNTER_CACHE_INDEX);
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verify(buffer.putLong, 1, HEAD_COUNTER_CACHE_INDEX, CAPACITY + 111);
        inOrder0.verify(buffer.getLongVolatile, 1, HEAD_COUNTER_INDEX);
        inOrder0.verify(buffer.putLong, 1, HEAD_COUNTER_CACHE_INDEX, 3);
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, CAPACITY * 2);
        const paddingIndex = CAPACITY - 10;
        inOrder0.verify(buffer.putLong, 1, 0, 0);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), -10);
        inOrder0.verify(buffer.putInt, 1, typeOffset(paddingIndex), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(paddingIndex), 10);
        inOrder0.verifyNoMoreInteractions();
    });

    it.each([-1, 0, 7, CAPACITY + 1])('commitThrowsIllegalArgumentExceptionIfIndexIsInvalid (%i)', (index) => {
        expect(() => ringBuffer.commit(index)).toThrow(IllegalArgumentException);
    });

    it('commitThrowsIllegalStateExceptionIfSpaceWasAlreadyCommitted', () => {
        testAlreadyCommitted((index) => ringBuffer.commit(index));
    });

    it('commitThrowsIllegalStateExceptionIfSpaceWasAlreadyAborted', () => {
        testAlreadyAborted((index) => ringBuffer.commit(index));
    });

    it('commitPublishesMessageByInvertingTheLengthValue', () => {
        const index = 32;
        const recordIndex = index - HEADER_LENGTH;
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(-19);

        ringBuffer.commit(index);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getInt, 1, lengthOffset(recordIndex));
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), 19);
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
        when(buffer.getInt, lengthOffset(recordIndex)).thenReturn(-11111);

        ringBuffer.abort(index);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getInt, 1, lengthOffset(recordIndex));
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordIndex), PADDING_MSG_TYPE_ID);
        inOrder0.verify(buffer.putIntRelease, 1, lengthOffset(recordIndex), 11111);
        inOrder0.verifyNoMoreInteractions();
    });

    // ExpandableArrayBuffer is not ported (see docs/mapping.md): the source is an UnsafeBuffer that is large enough
    it('shouldContinueOnControlledRead', () => {
        const msg = 'Hello World';
        const srcBuffer = newBuffer(64);
        const srcLength = srcBuffer.putStringAscii(0, msg);
        const ringBuffer = new OneToOneRingBuffer(newBuffer(1024));

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
        const ringBuffer = new OneToOneRingBuffer(newBuffer(1024));

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
        const ringBuffer = new OneToOneRingBuffer(newBuffer(1024));
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
        const ringBuffer = new OneToOneRingBuffer(newBuffer(1024));
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
        const ringBuffer = new OneToOneRingBuffer(newBuffer(MIN_CAPACITY + TRAILER_LENGTH));

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
        const ringBuffer = new OneToOneRingBuffer(newBuffer(MIN_CAPACITY * 2 + TRAILER_LENGTH));

        srcBuffer.putLong(0, Long.MAX_VALUE);
        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(true);

        expect(ringBuffer.write(msgType, srcBuffer, 0, 0)).toBe(true); // an empty message

        srcBuffer.putLong(0, Long.MIN_VALUE);
        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(false); // not enough space in the buffer

        // consume one message and move head
        expect(
            ringBuffer.read(
                {
                    onMessage: (_msgTypeId, buffer, index) => expect(buffer.getLong(index)).toBe(Long.MAX_VALUE),
                },
                1,
            ),
        ).toBe(1);

        // not enough contiguous space --> insert padding
        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(false);

        // consume the empty message and move head
        expect(ringBuffer.read({ onMessage: (_msgTypeId, _buffer, _index, length) => expect(length).toBe(0) })).toBe(1);

        expect(ringBuffer.write(msgType, srcBuffer, 0, SIZE_OF_LONG)).toBe(true); // message fits

        expect(
            ringBuffer.read({
                onMessage: (_msgTypeId, buffer, index) => expect(buffer.getLong(index)).toBe(Long.MIN_VALUE),
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
