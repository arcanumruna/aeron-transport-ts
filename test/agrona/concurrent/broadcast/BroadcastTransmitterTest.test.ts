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
// Port of org/agrona/concurrent/broadcast/BroadcastTransmitterTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { BroadcastBufferDescriptor } from '../../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastTransmitter } from '../../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { RecordDescriptor } from '../../../../src/agrona/concurrent/broadcast/RecordDescriptor.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IllegalStateException } from '../../../../src/agrona/jdk.js';
import { assertThrows } from '../../../support/Assertions.js';
import { BACKINGS } from '../../../support/Backing.js';
import { InOrder, type MockedUnsafeBuffer, mockUnsafeBuffer, when } from '../../../support/MockBuffer.js';

const { align } = BitUtil;
const { HEADER_LENGTH, PADDING_MSG_TYPE_ID, RECORD_ALIGNMENT, lengthOffset, msgOffset, typeOffset } = RecordDescriptor;

describe.each(BACKINGS)('BroadcastTransmitterTest over $name', (backing) => {
    const MSG_TYPE_ID = 7;
    const CAPACITY = 1024;
    const TOTAL_BUFFER_LENGTH = CAPACITY + BroadcastBufferDescriptor.TRAILER_LENGTH;
    const TAIL_INTENT_COUNTER_OFFSET = CAPACITY + BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET;
    const TAIL_COUNTER_INDEX = CAPACITY + BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET;
    const LATEST_COUNTER_INDEX = CAPACITY + BroadcastBufferDescriptor.LATEST_COUNTER_OFFSET;

    // JUnit creates an instance of the test class, and so these fields, for each test
    let mocked: MockedUnsafeBuffer;
    let buffer: MockedUnsafeBuffer['spies'];
    let broadcastTransmitter: BroadcastTransmitter;

    /** `inOrder(buffer)` */
    const inOrder = (): InOrder => new InOrder(mocked.all);

    const newBuffer = (length: number): UnsafeBuffer => new UnsafeBuffer(backing.bytes(length));

    beforeEach(() => {
        mocked = mockUnsafeBuffer();
        buffer = mocked.spies;
        when(buffer.capacity).thenReturn(TOTAL_BUFFER_LENGTH);

        broadcastTransmitter = new BroadcastTransmitter(mocked.buffer);
    });

    it('shouldCalculateCapacityForBuffer', () => {
        expect(broadcastTransmitter.capacity()).toBe(CAPACITY);
    });

    it('shouldThrowExceptionForCapacityThatIsNotPowerOfTwo', () => {
        const capacity = 777;
        const totalBufferLength = capacity + BroadcastBufferDescriptor.TRAILER_LENGTH;

        when(buffer.capacity).thenReturn(totalBufferLength);

        assertThrows(IllegalStateException, () => new BroadcastTransmitter(mocked.buffer));
    });

    it('shouldThrowExceptionWhenMaxMessageLengthExceeded', () => {
        const srcBuffer = newBuffer(1024);

        assertThrows(IllegalArgumentException, () =>
            broadcastTransmitter.transmit(MSG_TYPE_ID, srcBuffer, 0, broadcastTransmitter.maxMsgLength() + 1),
        );
    });

    it('shouldThrowExceptionWhenMessageTypeIdInvalid', () => {
        const invalidMsgId = -1;
        const srcBuffer = newBuffer(1024);

        assertThrows(IllegalArgumentException, () => broadcastTransmitter.transmit(invalidMsgId, srcBuffer, 0, 32));
    });

    it('shouldTransmitIntoEmptyBuffer', () => {
        const tail = 0;
        const recordOffset = tail;
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);

        const srcBuffer = newBuffer(1024);
        const srcIndex = 0;

        broadcastTransmitter.transmit(MSG_TYPE_ID, srcBuffer, srcIndex, length);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);

        inOrder0.verify(buffer.putLongRelease, 1, TAIL_INTENT_COUNTER_OFFSET, tail + recordLengthAligned);
        inOrder0.verify(buffer.putInt, 1, lengthOffset(recordOffset), recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordOffset), MSG_TYPE_ID);
        inOrder0.verify(buffer.putBytes, 1, msgOffset(recordOffset), srcBuffer, srcIndex, length);

        inOrder0.verify(buffer.putLongRelease, 1, LATEST_COUNTER_INDEX, tail);
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + recordLengthAligned);
    });

    it('shouldTransmitIntoUsedBuffer', () => {
        const tail = RECORD_ALIGNMENT * 3;
        const recordOffset = tail;
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);

        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);
        const srcIndex = 0;

        broadcastTransmitter.transmit(MSG_TYPE_ID, srcBuffer, srcIndex, length);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);

        inOrder0.verify(buffer.putLongRelease, 1, TAIL_INTENT_COUNTER_OFFSET, tail + recordLengthAligned);
        inOrder0.verify(buffer.putInt, 1, lengthOffset(recordOffset), recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordOffset), MSG_TYPE_ID);
        inOrder0.verify(buffer.putBytes, 1, msgOffset(recordOffset), srcBuffer, srcIndex, length);

        inOrder0.verify(buffer.putLongRelease, 1, LATEST_COUNTER_INDEX, tail);
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + recordLengthAligned);
    });

    it('shouldTransmitIntoEndOfBuffer', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const tail = CAPACITY - recordLengthAligned;
        const recordOffset = tail;

        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);
        const srcIndex = 0;

        broadcastTransmitter.transmit(MSG_TYPE_ID, srcBuffer, srcIndex, length);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);

        inOrder0.verify(buffer.putLongRelease, 1, TAIL_INTENT_COUNTER_OFFSET, tail + recordLengthAligned);
        inOrder0.verify(buffer.putInt, 1, lengthOffset(recordOffset), recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordOffset), MSG_TYPE_ID);
        inOrder0.verify(buffer.putBytes, 1, msgOffset(recordOffset), srcBuffer, srcIndex, length);

        inOrder0.verify(buffer.putLongRelease, 1, LATEST_COUNTER_INDEX, tail);
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + recordLengthAligned);
    });

    it('shouldApplyPaddingWhenInsufficientSpaceAtEndOfBuffer', () => {
        let tail = CAPACITY - RECORD_ALIGNMENT;
        let recordOffset = tail;
        const length = RECORD_ALIGNMENT + 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const toEndOfBuffer = CAPACITY - recordOffset;

        when(buffer.getLong, TAIL_COUNTER_INDEX).thenReturn(tail);

        const srcBuffer = newBuffer(1024);
        const srcIndex = 0;

        broadcastTransmitter.transmit(MSG_TYPE_ID, srcBuffer, srcIndex, length);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLong, 1, TAIL_COUNTER_INDEX);

        inOrder0.verify(
            buffer.putLongRelease,
            1,
            TAIL_INTENT_COUNTER_OFFSET,
            tail + recordLengthAligned + toEndOfBuffer,
        );

        inOrder0.verify(buffer.putInt, 1, lengthOffset(recordOffset), toEndOfBuffer);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordOffset), PADDING_MSG_TYPE_ID);

        tail += toEndOfBuffer;
        recordOffset = 0;
        inOrder0.verify(buffer.putInt, 1, lengthOffset(recordOffset), recordLength);
        inOrder0.verify(buffer.putInt, 1, typeOffset(recordOffset), MSG_TYPE_ID);
        inOrder0.verify(buffer.putBytes, 1, msgOffset(recordOffset), srcBuffer, srcIndex, length);

        inOrder0.verify(buffer.putLongRelease, 1, LATEST_COUNTER_INDEX, tail);
        inOrder0.verify(buffer.putLongRelease, 1, TAIL_COUNTER_INDEX, tail + recordLengthAligned);
    });
});
