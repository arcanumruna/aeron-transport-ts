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
// Port of org/agrona/concurrent/broadcast/BroadcastReceiverTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { BroadcastBufferDescriptor } from '../../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastReceiver } from '../../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { RecordDescriptor } from '../../../../src/agrona/concurrent/broadcast/RecordDescriptor.js';
import { IllegalStateException } from '../../../../src/agrona/jdk.js';
import { assertThrows } from '../../../support/Assertions.js';
import { InOrder, type MockedUnsafeBuffer, mockUnsafeBuffer, verify, when } from '../../../support/MockBuffer.js';

const { align } = BitUtil;
const { HEADER_LENGTH, PADDING_MSG_TYPE_ID, RECORD_ALIGNMENT, lengthOffset, msgOffset, typeOffset } = RecordDescriptor;

// adapted: the buffer is a mock, so the test does not use the backings (the tests of the broadcast classes over a real
// ArrayBuffer and SharedArrayBuffer are in test/extra/agrona/concurrent/broadcast)
describe('BroadcastReceiverTest', () => {
    const MSG_TYPE_ID = 7;
    const CAPACITY = 1024;
    const TOTAL_BUFFER_LENGTH = CAPACITY + BroadcastBufferDescriptor.TRAILER_LENGTH;
    const TAIL_INTENT_COUNTER_OFFSET = CAPACITY + BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET;
    const TAIL_COUNTER_INDEX = CAPACITY + BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET;
    const LATEST_COUNTER_INDEX = CAPACITY + BroadcastBufferDescriptor.LATEST_COUNTER_OFFSET;

    // JUnit creates an instance of the test class, and so these fields, for each test
    let mocked: MockedUnsafeBuffer;
    let buffer: MockedUnsafeBuffer['spies'];
    let broadcastReceiver: BroadcastReceiver;

    /** `inOrder(buffer)` */
    const inOrder = (): InOrder => new InOrder(mocked.all);

    beforeEach(() => {
        mocked = mockUnsafeBuffer();
        buffer = mocked.spies;
        when(buffer.capacity).thenReturn(TOTAL_BUFFER_LENGTH);

        broadcastReceiver = new BroadcastReceiver(mocked.buffer);
    });

    it('shouldCalculateCapacityForBuffer', () => {
        expect(broadcastReceiver.capacity()).toBe(CAPACITY);
    });

    it('shouldThrowExceptionForCapacityThatIsNotPowerOfTwo', () => {
        const capacity = 777;
        const totalBufferLength = capacity + BroadcastBufferDescriptor.TRAILER_LENGTH;

        when(buffer.capacity).thenReturn(totalBufferLength);

        assertThrows(IllegalStateException, () => new BroadcastReceiver(mocked.buffer));
    });

    it('shouldNotBeLappedBeforeReception', () => {
        expect(broadcastReceiver.lappedCount()).toBe(0);
    });

    it('shouldNotReceiveFromEmptyBuffer', () => {
        expect(broadcastReceiver.receiveNext()).toBe(false);
    });

    it('shouldReceiveFirstMessageFromBuffer', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const tail = recordLengthAligned;
        const latestRecord = tail - recordLengthAligned;
        const recordOffset = latestRecord;

        when(buffer.getLongVolatile, TAIL_INTENT_COUNTER_OFFSET).thenReturn(tail);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.getInt, lengthOffset(recordOffset)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffset)).thenReturn(MSG_TYPE_ID);

        expect(broadcastReceiver.receiveNext()).toBe(true);
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffset));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_INTENT_COUNTER_OFFSET);
    });

    it('shouldReceiveTwoMessagesFromBuffer', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const tail = recordLengthAligned * 2;
        const latestRecord = tail - recordLengthAligned;
        const recordOffsetOne = 0;
        const recordOffsetTwo = latestRecord;

        when(buffer.getLongVolatile, TAIL_INTENT_COUNTER_OFFSET).thenReturn(tail);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);

        when(buffer.getInt, lengthOffset(recordOffsetOne)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffsetOne)).thenReturn(MSG_TYPE_ID);

        when(buffer.getInt, lengthOffset(recordOffsetTwo)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffsetTwo)).thenReturn(MSG_TYPE_ID);

        expect(broadcastReceiver.receiveNext()).toBe(true);
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffsetOne));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(true);

        expect(broadcastReceiver.receiveNext()).toBe(true);
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffsetTwo));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(true);

        const inOrder0 = inOrder();
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_INTENT_COUNTER_OFFSET);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_INTENT_COUNTER_OFFSET);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_INTENT_COUNTER_OFFSET);
        inOrder0.verify(buffer.getLongVolatile, 1, TAIL_INTENT_COUNTER_OFFSET);
    });

    it('shouldLateJoinTransmission', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const tail = CAPACITY * 3 + HEADER_LENGTH + recordLengthAligned;
        const latestRecord = tail - recordLengthAligned;
        const recordOffset = latestRecord & (CAPACITY - 1);

        when(buffer.getLongVolatile, TAIL_INTENT_COUNTER_OFFSET).thenReturn(tail);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);
        when(buffer.getLongVolatile, LATEST_COUNTER_INDEX).thenReturn(latestRecord);

        when(buffer.getInt, lengthOffset(recordOffset)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffset)).thenReturn(MSG_TYPE_ID);

        expect(broadcastReceiver.receiveNext()).toBe(true);
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffset));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(true);
        expect(broadcastReceiver.lappedCount()).toBeGreaterThan(0);
    });

    it('shouldCopeWithPaddingRecordAndWrapOfBufferForNextRecord', () => {
        const length = 120;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const catchupTail = CAPACITY * 2 - HEADER_LENGTH;
        const postPaddingTail = catchupTail + HEADER_LENGTH + recordLengthAligned;
        const latestRecord = catchupTail - recordLengthAligned;
        const catchupOffset = latestRecord & (CAPACITY - 1);

        when(buffer.getLongVolatile, TAIL_INTENT_COUNTER_OFFSET).thenReturn(catchupTail, postPaddingTail);
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(catchupTail, postPaddingTail);
        when(buffer.getLongVolatile, LATEST_COUNTER_INDEX).thenReturn(latestRecord);
        when(buffer.getInt, lengthOffset(catchupOffset)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(catchupOffset)).thenReturn(MSG_TYPE_ID);

        const paddingOffset = catchupTail & (CAPACITY - 1);
        const recordOffset = (postPaddingTail - recordLengthAligned) & (CAPACITY - 1);
        when(buffer.getInt, typeOffset(paddingOffset)).thenReturn(PADDING_MSG_TYPE_ID);

        when(buffer.getInt, lengthOffset(recordOffset)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffset)).thenReturn(MSG_TYPE_ID);

        expect(broadcastReceiver.receiveNext()).toBe(true); // To catch up to record before padding.

        expect(broadcastReceiver.receiveNext()).toBe(true); // no skip over the padding and read next record.
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffset));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(true);
    });

    it('shouldDealWithRecordBecomingInvalidDueToOverwrite', () => {
        const length = 8;
        const recordLength = length + HEADER_LENGTH;
        const recordLengthAligned = align(recordLength, RECORD_ALIGNMENT);
        const tail = recordLengthAligned;
        const latestRecord = tail - recordLengthAligned;
        const recordOffset = latestRecord;

        when(buffer.getLongVolatile, TAIL_INTENT_COUNTER_OFFSET).thenReturn(
            tail,
            tail + (CAPACITY - recordLengthAligned),
        );
        when(buffer.getLongVolatile, TAIL_COUNTER_INDEX).thenReturn(tail);

        when(buffer.getInt, lengthOffset(recordOffset)).thenReturn(recordLength);
        when(buffer.getInt, typeOffset(recordOffset)).thenReturn(MSG_TYPE_ID);

        expect(broadcastReceiver.receiveNext()).toBe(true);
        expect(broadcastReceiver.typeId()).toBe(MSG_TYPE_ID);
        expect(broadcastReceiver.buffer()).toBe(mocked.buffer);
        expect(broadcastReceiver.offset()).toBe(msgOffset(recordOffset));
        expect(broadcastReceiver.length()).toBe(length);

        expect(broadcastReceiver.validate()).toBe(false); // Need to receiveNext() to catch up with transmission again.

        verify(buffer.getLongVolatile, 1, TAIL_COUNTER_INDEX);
    });
});
