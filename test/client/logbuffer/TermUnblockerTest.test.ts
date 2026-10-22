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
// Port of io/aeron/logbuffer/TermUnblockerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermUnblocker } from '../../../src/client/logbuffer/TermUnblocker.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { expectInOrder } from '../../support/InOrder.js';

const { NO_ACTION, UNBLOCKED, UNBLOCKED_TO_END } = TermUnblocker.Status;
const { termIdOffset, termOffsetOffset, typeOffset } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { HDR_TYPE_PAD } = HeaderFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;

const TERM_BUFFER_CAPACITY = 64 * 1014;
const TERM_ID = 7;

describe('TermUnblocker', () => {
    // The term buffer is a real buffer whose reads of frame lengths and writes of the padding header are spies that
    // call through; Mockito's `thenReturn(a).thenReturn(b)` is `stub` below. The meta data buffer is a real buffer
    // too (its default frame header is all zeros).
    let mockTermBuffer: UnsafeBuffer;
    let mockLogMetaDataBuffer: UnsafeBuffer;
    let getIntVolatile: ReturnType<typeof vi.spyOn>;
    let putShort: ReturnType<typeof vi.spyOn>;
    let putInt: ReturnType<typeof vi.spyOn>;
    let putIntRelease: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockTermBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_CAPACITY));
        mockLogMetaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        getIntVolatile = vi.spyOn(mockTermBuffer, 'getIntVolatile');
        putShort = vi.spyOn(mockTermBuffer, 'putShort');
        putInt = vi.spyOn(mockTermBuffer, 'putInt');
        putIntRelease = vi.spyOn(mockTermBuffer, 'putIntRelease');
    });

    /**
     * `when(getIntVolatile(offset)).thenReturn(values[0]).thenReturn(values[1])...`: each read at the offset returns
     * the next value and the last one is repeated. Other offsets read the buffer.
     */
    function stub(offset: number, ...values: number[]): void {
        let next = 0;
        const read = UnsafeBuffer.prototype.getIntVolatile;
        const previous = getIntVolatile.getMockImplementation() as ((index: number) => number) | undefined;
        getIntVolatile.mockImplementation((index: number) => {
            if (index === offset) {
                return values[Math.min(next++, values.length - 1)] as number;
            }

            return previous ? previous(index) : read.call(mockTermBuffer, index);
        });
    }

    /** The padding header that `resetHeader` writes, in order, for a frame of `messageLength` at `termOffset`. */
    function expectPaddingHeader(termOffset: number, messageLength: number): void {
        expect(putShort.mock.calls).toEqual([[typeOffset(termOffset), HDR_TYPE_PAD, LITTLE_ENDIAN]]);
        expect(putInt.mock.calls[0]).toEqual([termOffsetOffset(termOffset), termOffset, LITTLE_ENDIAN]);
        expect(putInt.mock.calls[1]).toEqual([termIdOffset(termOffset), TERM_ID, LITTLE_ENDIAN]);
        expect(putIntRelease.mock.calls).toEqual([[termOffset, messageLength]]);
        expectInOrder([putShort, 0], [putInt, 0], [putIntRelease, 0]);
    }

    function expectNoPaddingHeader(): void {
        expect(putShort).not.toHaveBeenCalled();
        expect(putInt).not.toHaveBeenCalled();
        expect(putIntRelease).not.toHaveBeenCalled();
    }

    it('shouldTakeNoActionWhenMessageIsComplete', () => {
        const termOffset = 0;
        const tailOffset = TERM_BUFFER_CAPACITY;
        stub(termOffset, HEADER_LENGTH);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldTakeNoActionWhenNoUnblockedMessage', () => {
        const termOffset = 0;
        const tailOffset = TERM_BUFFER_CAPACITY / 2;

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldPatchNonCommittedMessage', () => {
        const termOffset = 0;
        const messageLength = HEADER_LENGTH * 4;
        const tailOffset = messageLength;

        stub(termOffset, -messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            UNBLOCKED,
        );

        expectPaddingHeader(termOffset, messageLength);
    });

    it('shouldPatchToEndOfPartition', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = TERM_BUFFER_CAPACITY - messageLength;
        const tailOffset = TERM_BUFFER_CAPACITY;

        stub(termOffset, 0);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            UNBLOCKED_TO_END,
        );

        expectPaddingHeader(termOffset, messageLength);
    });

    it('shouldScanForwardForNextCompleteMessage', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 2;

        stub(messageLength, messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            UNBLOCKED,
        );

        expectPaddingHeader(termOffset, messageLength);
    });

    it('shouldScanForwardForNextNonCommittedMessage', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 2;

        stub(messageLength, -messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            UNBLOCKED,
        );

        expectPaddingHeader(termOffset, messageLength);
    });

    it('shouldTakeNoActionIfMessageCompleteAfterScan', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 2;

        stub(termOffset, 0, messageLength);
        stub(messageLength, messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldTakeNoActionIfMessageNonCommittedAfterScan', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 2;

        stub(termOffset, 0, -messageLength);
        stub(messageLength, messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldTakeNoActionToEndOfPartitionIfMessageCompleteAfterScan', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = TERM_BUFFER_CAPACITY - messageLength;
        const tailOffset = TERM_BUFFER_CAPACITY;

        stub(termOffset, 0, messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldTakeNoActionToEndOfPartitionIfMessageNonCommittedAfterScan', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = TERM_BUFFER_CAPACITY - messageLength;
        const tailOffset = TERM_BUFFER_CAPACITY;

        stub(termOffset, 0, -messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldNotUnblockGapWithMessageRaceOnSecondMessageIncreasingTailThenInterrupting', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 3;

        stub(messageLength, 0, messageLength);
        stub(messageLength * 2, messageLength);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });

    it('shouldNotUnblockGapWithMessageRaceWhenScanForwardTakesAnInterrupt', () => {
        const messageLength = HEADER_LENGTH * 4;
        const termOffset = 0;
        const tailOffset = messageLength * 3;

        stub(messageLength, 0, messageLength);
        stub(messageLength + HEADER_LENGTH, 7);

        expect(TermUnblocker.unblock(mockLogMetaDataBuffer, mockTermBuffer, termOffset, tailOffset, TERM_ID)).toBe(
            NO_ACTION,
        );
        expectNoPaddingHeader();
    });
});
