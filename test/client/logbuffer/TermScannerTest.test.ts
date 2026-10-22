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
// Port of io/aeron/logbuffer/TermScannerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermScanner } from '../../../src/client/logbuffer/TermScanner.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { expectInOrder } from '../../support/InOrder.js';

const { FRAME_ALIGNMENT, PADDING_FRAME_TYPE, frameType, typeOffset } = FrameDescriptor;
const { align } = BitUtil;
const { HDR_TYPE_DATA } = HeaderFlyweight;

const TERM_BUFFER_CAPACITY = LogBufferDescriptor.TERM_MIN_LENGTH;
const MTU_LENGTH = 1024;
const HEADER_LENGTH = DataHeaderFlyweight.HEADER_LENGTH;

describe('TermScanner', () => {
    // A real buffer holding the frames that Mockito stubbed; the two reads of a frame are spies that call through.
    let termBuffer: UnsafeBuffer;
    let getIntVolatile: ReturnType<typeof vi.spyOn>;
    let getShort: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_CAPACITY));
        getIntVolatile = vi.spyOn(termBuffer, 'getIntVolatile');
        getShort = vi.spyOn(termBuffer, 'getShort');
    });

    /** `when(getIntVolatile(offset)).thenReturn(frameLength)` and `when(getShort(typeOffset(offset)))...`. */
    function frame(offset: number, frameLength: number, type: number): void {
        termBuffer.putInt(offset, frameLength);
        frameType(termBuffer, offset, type);
    }

    it('shouldPackPaddingAndOffsetIntoResultingStatus', () => {
        const padding = 77;
        const available = 65000;

        const scanOutcome = TermScanner.pack(padding, available);

        expect(TermScanner.padding(scanOutcome)).toBe(padding);
        expect(TermScanner.available(scanOutcome)).toBe(available);
    });

    it('shouldReturnZeroOnEmptyLog', () => {
        const scanOutcome = TermScanner.scanForAvailability(termBuffer, 0, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(0);
        expect(TermScanner.padding(scanOutcome)).toBe(0);
    });

    it('shouldScanSingleMessage', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const frameOffset = 0;

        frame(frameOffset, frameLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(alignedFrameLength);
        expect(TermScanner.padding(scanOutcome)).toBe(0);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(getShort.mock.calls[0]).toEqual([typeOffset(frameOffset)]);
        expectInOrder([getIntVolatile, 0], [getShort, 0]);
    });

    it('shouldFailToScanMessageLargerThanMaxLength', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const maxLength = alignedFrameLength - 1;
        const frameOffset = 0;

        frame(frameOffset, frameLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, maxLength);
        expect(TermScanner.available(scanOutcome)).toBe(-alignedFrameLength);
        expect(TermScanner.padding(scanOutcome)).toBe(-1);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(getShort.mock.calls[0]).toEqual([typeOffset(frameOffset)]);
        expectInOrder([getIntVolatile, 0], [getShort, 0]);
    });

    it('shouldScanTwoMessagesThatFitInSingleMtu', () => {
        const msgLength = 100;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        let frameOffset = 0;

        frame(frameOffset, frameLength, HDR_TYPE_DATA);
        frame(frameOffset + alignedFrameLength, alignedFrameLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(alignedFrameLength * 2);
        expect(TermScanner.padding(scanOutcome)).toBe(0);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(getShort.mock.calls[0]).toEqual([typeOffset(frameOffset)]);

        frameOffset += alignedFrameLength;
        expect(getIntVolatile.mock.calls[1]).toEqual([frameOffset]);
        expect(getShort.mock.calls[1]).toEqual([typeOffset(frameOffset)]);
        expectInOrder([getIntVolatile, 0], [getShort, 0], [getIntVolatile, 1], [getShort, 1]);
    });

    it('shouldScanTwoMessagesAndStopAtMtuBoundary', () => {
        const frameTwoLength = align(HEADER_LENGTH + 1, FRAME_ALIGNMENT);
        const frameOneLength = MTU_LENGTH - frameTwoLength;

        let frameOffset = 0;

        frame(frameOffset, frameOneLength, HDR_TYPE_DATA);
        frame(frameOffset + frameOneLength, frameTwoLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(frameOneLength + frameTwoLength);
        expect(TermScanner.padding(scanOutcome)).toBe(0);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(getShort.mock.calls[0]).toEqual([typeOffset(frameOffset)]);

        frameOffset += frameOneLength;
        expect(getIntVolatile.mock.calls[1]).toEqual([frameOffset]);
        expect(getShort.mock.calls[1]).toEqual([typeOffset(frameOffset)]);
        expectInOrder([getIntVolatile, 0], [getShort, 0], [getIntVolatile, 1], [getShort, 1]);
    });

    it('shouldScanTwoMessagesAndStopAtSecondThatSpansMtu', () => {
        const frameTwoLength = align(HEADER_LENGTH * 2, FRAME_ALIGNMENT);
        const frameOneLength = MTU_LENGTH - frameTwoLength / 2;
        let frameOffset = 0;

        frame(frameOffset, frameOneLength, HDR_TYPE_DATA);
        frame(frameOffset + frameOneLength, frameTwoLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(frameOneLength);
        expect(TermScanner.padding(scanOutcome)).toBe(0);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(getShort.mock.calls[0]).toEqual([typeOffset(frameOffset)]);

        frameOffset += frameOneLength;
        expect(getIntVolatile.mock.calls[1]).toEqual([frameOffset]);
        expect(getShort.mock.calls[1]).toEqual([typeOffset(frameOffset)]);
        expectInOrder([getIntVolatile, 0], [getShort, 0], [getIntVolatile, 1], [getShort, 1]);
    });

    it('shouldScanLastFrameInBuffer', () => {
        const alignedFrameLength = align(HEADER_LENGTH * 2, FRAME_ALIGNMENT);
        const frameOffset = TERM_BUFFER_CAPACITY - alignedFrameLength;

        frame(frameOffset, alignedFrameLength, HDR_TYPE_DATA);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(alignedFrameLength);
        expect(TermScanner.padding(scanOutcome)).toBe(0);
    });

    it('shouldScanLastMessageInBufferPlusPadding', () => {
        const alignedFrameLength = align(HEADER_LENGTH * 2, FRAME_ALIGNMENT);
        const paddingFrameLength = align(HEADER_LENGTH * 3, FRAME_ALIGNMENT);
        const frameOffset = TERM_BUFFER_CAPACITY - (alignedFrameLength + paddingFrameLength);

        frame(frameOffset, alignedFrameLength, HDR_TYPE_DATA);
        frame(frameOffset + alignedFrameLength, paddingFrameLength, PADDING_FRAME_TYPE);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, MTU_LENGTH);
        expect(TermScanner.available(scanOutcome)).toBe(alignedFrameLength + HEADER_LENGTH);
        expect(TermScanner.padding(scanOutcome)).toBe(paddingFrameLength - HEADER_LENGTH);
    });

    it('shouldScanLastMessageInBufferMinusPaddingLimitedByMtu', () => {
        const alignedFrameLength = align(HEADER_LENGTH, FRAME_ALIGNMENT);
        const frameOffset = TERM_BUFFER_CAPACITY - align(HEADER_LENGTH * 3, FRAME_ALIGNMENT);
        const mtu = alignedFrameLength + 8;

        frame(frameOffset, alignedFrameLength, HDR_TYPE_DATA);
        frame(frameOffset + alignedFrameLength, alignedFrameLength * 2, PADDING_FRAME_TYPE);

        const scanOutcome = TermScanner.scanForAvailability(termBuffer, frameOffset, mtu);
        expect(TermScanner.available(scanOutcome)).toBe(alignedFrameLength);
        expect(TermScanner.padding(scanOutcome)).toBe(0);
    });
});
