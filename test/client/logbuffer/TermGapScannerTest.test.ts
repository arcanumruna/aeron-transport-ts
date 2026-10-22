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
// Port of io/aeron/logbuffer/TermGapScannerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermGapScanner } from '../../../src/client/logbuffer/TermGapScanner.js';
import type { GapHandler } from '../../../src/client/logbuffer/TermGapScanner.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';

const { FRAME_ALIGNMENT } = FrameDescriptor;
const { align } = BitUtil;

const LOG_BUFFER_CAPACITY = LogBufferDescriptor.TERM_MIN_LENGTH;
const TERM_ID = 1;
const HEADER_LENGTH = DataHeaderFlyweight.HEADER_LENGTH;

describe('TermGapScanner', () => {
    // A real buffer holding the frame lengths that Mockito stubbed; `getIntVolatile` is a spy that calls through.
    let termBuffer: UnsafeBuffer;
    let getIntVolatile: ReturnType<typeof vi.spyOn>;
    let gapHandler: { onGap: Mock<GapHandler['onGap']> };

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_BUFFER_CAPACITY));
        getIntVolatile = vi.spyOn(termBuffer, 'getIntVolatile');
        gapHandler = { onGap: vi.fn<GapHandler['onGap']>() };
    });

    it('shouldReportGapAtBeginningOfBuffer', () => {
        const frameOffset = align(HEADER_LENGTH * 3, FRAME_ALIGNMENT);
        const highWaterMark = frameOffset + align(HEADER_LENGTH, FRAME_ALIGNMENT);

        termBuffer.putInt(frameOffset, HEADER_LENGTH);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, 0, highWaterMark, gapHandler)).toBe(0);

        expect(gapHandler.onGap.mock.calls).toEqual([[TERM_ID, 0, frameOffset]]);
    });

    it('shouldReportSingleGapWhenBufferNotFull', () => {
        const tail = align(HEADER_LENGTH, FRAME_ALIGNMENT);
        const highWaterMark = FRAME_ALIGNMENT * 3;

        termBuffer.putInt(tail - align(HEADER_LENGTH, FRAME_ALIGNMENT), HEADER_LENGTH);
        termBuffer.putInt(tail, 0);
        termBuffer.putInt(highWaterMark - align(HEADER_LENGTH, FRAME_ALIGNMENT), HEADER_LENGTH);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, tail, highWaterMark, gapHandler)).toBe(tail);

        expect(gapHandler.onGap.mock.calls).toEqual([[TERM_ID, tail, align(HEADER_LENGTH, FRAME_ALIGNMENT)]]);
    });

    it('shouldReportSingleGapWhenBufferIsFull', () => {
        const tail = LOG_BUFFER_CAPACITY - align(HEADER_LENGTH, FRAME_ALIGNMENT) * 2;
        const highWaterMark = LOG_BUFFER_CAPACITY;

        termBuffer.putInt(tail - align(HEADER_LENGTH, FRAME_ALIGNMENT), HEADER_LENGTH);
        termBuffer.putInt(tail, 0);
        termBuffer.putInt(highWaterMark - align(HEADER_LENGTH, FRAME_ALIGNMENT), HEADER_LENGTH);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, tail, highWaterMark, gapHandler)).toBe(tail);

        expect(gapHandler.onGap.mock.calls).toEqual([[TERM_ID, tail, align(HEADER_LENGTH, FRAME_ALIGNMENT)]]);
    });

    it('shouldReportNoGapWhenHwmIsInPadding', () => {
        const paddingLength = align(HEADER_LENGTH, FRAME_ALIGNMENT) * 2;
        const tail = LOG_BUFFER_CAPACITY - paddingLength;
        const highWaterMark = LOG_BUFFER_CAPACITY - paddingLength + HEADER_LENGTH;

        termBuffer.putInt(tail, paddingLength);
        termBuffer.putInt(tail + HEADER_LENGTH, 0);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, tail, highWaterMark, gapHandler)).toBe(
            LOG_BUFFER_CAPACITY,
        );

        expect(gapHandler.onGap).not.toHaveBeenCalled();
    });

    it('shouldReportSingleHeaderGap', () => {
        const offset = 8192 + 384;
        termBuffer.putInt(offset, 0);
        termBuffer.putInt(offset + HEADER_LENGTH, 128);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, offset, LOG_BUFFER_CAPACITY, gapHandler)).toBe(offset);

        expect(getIntVolatile.mock.calls).toEqual([[offset], [offset + HEADER_LENGTH]]);
        expect(gapHandler.onGap.mock.calls).toEqual([[TERM_ID, offset, HEADER_LENGTH]]);
    });

    it('shouldReportGapAtTheEndOfTheBuffer', () => {
        const offset = LOG_BUFFER_CAPACITY - 128;
        termBuffer.putInt(offset, 0);

        expect(TermGapScanner.scanForGap(termBuffer, TERM_ID, offset, LOG_BUFFER_CAPACITY, gapHandler)).toBe(offset);

        // verify(termBuffer).getIntVolatile(...) four times, once each, and no other interaction
        expect(getIntVolatile.mock.calls).toEqual([
            [offset],
            [offset + HEADER_LENGTH],
            [offset + 2 * HEADER_LENGTH],
            [offset + 3 * HEADER_LENGTH],
        ]);
        expect(gapHandler.onGap.mock.calls).toEqual([[TERM_ID, offset, 128]]);
    });
});
