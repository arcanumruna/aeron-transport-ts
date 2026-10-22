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
// Port of io/aeron/logbuffer/LogBufferUnblockerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { LogBufferUnblocker } from '../../../src/client/logbuffer/LogBufferUnblocker.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { expectInOrder } from '../../support/InOrder.js';

const {
    LOG_ACTIVE_TERM_COUNT_OFFSET,
    LOG_META_DATA_LENGTH,
    PARTITION_COUNT,
    TERM_MIN_LENGTH,
    TERM_TAIL_COUNTERS_OFFSET,
    computePosition,
    indexByPosition,
    initialTermId,
    initialiseTailWithTermId,
    packTail,
    rawTailVolatile,
    termId,
} = LogBufferDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;

const TERM_LENGTH = TERM_MIN_LENGTH;
const TERM_ID_1 = 1;
const TERM_TAIL_COUNTER_OFFSET = TERM_TAIL_COUNTERS_OFFSET;

describe('LogBufferUnblocker', () => {
    // JUnit creates a new test instance per test, so the buffers are rebuilt before each one. As in Java the meta
    // data buffer and the term buffers are real buffers wrapped in spies that call through.
    let logMetaDataBuffer: UnsafeBuffer;
    let termBuffers: UnsafeBuffer[];
    let positionBitsToShift: number;
    let compareAndSetInt: ReturnType<typeof vi.spyOn>;
    let putLongBigInt: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        positionBitsToShift = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);
        logMetaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
        termBuffers = [];
        initialTermId(logMetaDataBuffer, TERM_ID_1);

        for (let i = 0; i < PARTITION_COUNT; i++) {
            termBuffers[i] = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        }

        const initialTermIdValue = TERM_ID_1;
        initialiseTailWithTermId(logMetaDataBuffer, 0, initialTermIdValue);
        for (let i = 1; i < PARTITION_COUNT; i++) {
            const expectedTermId = initialTermIdValue + i - PARTITION_COUNT;
            initialiseTailWithTermId(logMetaDataBuffer, i, expectedTermId);
        }

        compareAndSetInt = vi.spyOn(logMetaDataBuffer, 'compareAndSetInt');
        putLongBigInt = vi.spyOn(logMetaDataBuffer, 'putLongBigInt');
    });

    it('shouldNotUnblockWhenPositionHasCompleteMessage', () => {
        const blockedOffset = HEADER_LENGTH * 4;
        const blockedPosition = computePosition(TERM_ID_1, blockedOffset, positionBitsToShift, TERM_ID_1);
        const activeIndex = indexByPosition(blockedPosition, positionBitsToShift);

        (termBuffers[activeIndex] as UnsafeBuffer).putInt(blockedOffset, HEADER_LENGTH);

        expect(LogBufferUnblocker.unblock(termBuffers, logMetaDataBuffer, blockedPosition, TERM_LENGTH)).toBe(false);

        const rawTail = rawTailVolatile(logMetaDataBuffer);
        expect(computePosition(termId(rawTail), blockedOffset, positionBitsToShift, TERM_ID_1)).toBe(blockedPosition);
    });

    it('shouldUnblockWhenPositionHasNonCommittedMessageAndTailWithinTerm', () => {
        const blockedOffset = HEADER_LENGTH * 4;
        const messageLength = HEADER_LENGTH * 4;
        const blockedPosition = computePosition(TERM_ID_1, blockedOffset, positionBitsToShift, TERM_ID_1);
        const activeIndex = indexByPosition(blockedPosition, positionBitsToShift);

        (termBuffers[activeIndex] as UnsafeBuffer).putInt(blockedOffset, -messageLength);

        expect(LogBufferUnblocker.unblock(termBuffers, logMetaDataBuffer, blockedPosition, TERM_LENGTH)).toBe(true);

        const rawTail = rawTailVolatile(logMetaDataBuffer);
        expect(computePosition(termId(rawTail), blockedOffset + messageLength, positionBitsToShift, TERM_ID_1)).toBe(
            blockedPosition + messageLength,
        );
    });

    it('shouldUnblockWhenPositionHasNonCommittedMessageAndTailAtEndOfTerm', () => {
        const messageLength = HEADER_LENGTH * 4;
        const blockedOffset = TERM_LENGTH - messageLength;
        const blockedPosition = computePosition(TERM_ID_1, blockedOffset, positionBitsToShift, TERM_ID_1);
        const activeIndex = indexByPosition(blockedPosition, positionBitsToShift);

        (termBuffers[activeIndex] as UnsafeBuffer).putInt(blockedOffset, 0);

        logMetaDataBuffer.getAndAddLong(TERM_TAIL_COUNTER_OFFSET, TERM_LENGTH);

        expect(LogBufferUnblocker.unblock(termBuffers, logMetaDataBuffer, blockedPosition, TERM_LENGTH)).toBe(true);

        const rawTail = rawTailVolatile(logMetaDataBuffer);
        const activeTermId = termId(rawTail);
        expect(computePosition(activeTermId, 0, positionBitsToShift, TERM_ID_1)).toBe(blockedPosition + messageLength);

        expect(compareAndSetInt.mock.calls).toEqual([[LOG_ACTIVE_TERM_COUNT_OFFSET, 0, 1]]);
    });

    it('shouldUnblockWhenPositionHasCommittedMessageAndTailAtEndOfTermButNotRotated', () => {
        const blockedPosition = TERM_LENGTH;

        const termTailCounterTwoOffset = TERM_TAIL_COUNTER_OFFSET + BitUtil.SIZE_OF_LONG;
        logMetaDataBuffer.getAndAddLong(TERM_TAIL_COUNTER_OFFSET, TERM_LENGTH);

        expect(LogBufferUnblocker.unblock(termBuffers, logMetaDataBuffer, blockedPosition, TERM_LENGTH)).toBe(true);

        const rawTail = rawTailVolatile(logMetaDataBuffer);
        const activeTermId = termId(rawTail);
        expect(activeTermId).toBe(TERM_ID_1 + 1);
        expect(computePosition(activeTermId, 0, positionBitsToShift, TERM_ID_1)).toBe(blockedPosition);

        // compareAndSetLong(termTailCounterTwoOffset, pack(TERM_ID_1 - 2, 0), pack(TERM_ID_1 + 1, 0)): a raw tail
        // is compared and stored as a `bigint` (spec D12), so the compare is the old value of the slot and the store
        // of the new one is the call
        expect(putLongBigInt.mock.calls).toEqual([[termTailCounterTwoOffset, packTail(TERM_ID_1 + 1, 0)]]);
        expect(compareAndSetInt.mock.calls).toEqual([[LOG_ACTIVE_TERM_COUNT_OFFSET, 0, 1]]);
        expectInOrder([putLongBigInt, 0], [compareAndSetInt, 0]);
    });

    it('shouldUnblockWhenPositionHasNonCommittedMessageAndTailPastEndOfTerm', () => {
        const messageLength = HEADER_LENGTH * 4;
        const blockedOffset = TERM_LENGTH - messageLength;
        const blockedPosition = computePosition(TERM_ID_1, blockedOffset, positionBitsToShift, TERM_ID_1);
        const activeIndex = indexByPosition(blockedPosition, positionBitsToShift);

        (termBuffers[activeIndex] as UnsafeBuffer).putInt(blockedOffset, 0);

        logMetaDataBuffer.putLongBigInt(TERM_TAIL_COUNTER_OFFSET, packTail(TERM_ID_1, TERM_LENGTH + HEADER_LENGTH));

        expect(LogBufferUnblocker.unblock(termBuffers, logMetaDataBuffer, blockedPosition, TERM_LENGTH)).toBe(true);

        const rawTail = rawTailVolatile(logMetaDataBuffer);
        const activeTermId = termId(rawTail);
        expect(computePosition(activeTermId, 0, positionBitsToShift, TERM_ID_1)).toBe(blockedPosition + messageLength);

        expect(compareAndSetInt.mock.calls).toEqual([[LOG_ACTIVE_TERM_COUNT_OFFSET, 0, 1]]);
    });
});
