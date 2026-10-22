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
// Port of io/aeron/logbuffer/TermBlockScannerTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermBlockScanner } from '../../../src/client/logbuffer/TermBlockScanner.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';

const { FRAME_ALIGNMENT, frameType, lengthOffset } = FrameDescriptor;
const { HDR_TYPE_DATA, HDR_TYPE_PAD } = HeaderFlyweight;

describe('TermBlockScanner', () => {
    let termBuffer: UnsafeBuffer;

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.TERM_MIN_LENGTH));
    });

    /** `when(getIntVolatile(lengthOffset(offset))).thenReturn(length)` and the type read: a frame in the buffer. */
    function frame(offset: number, length: number, type: number): void {
        termBuffer.putInt(lengthOffset(offset), length);
        frameType(termBuffer, offset, type);
    }

    it('shouldScanEmptyBuffer', () => {
        const offset = 0;
        const limit = termBuffer.capacity();

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(offset);
    });

    it('shouldReadFirstMessage', () => {
        const offset = 0;
        const limit = termBuffer.capacity();
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);

        frame(offset, messageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(alignedMessageLength);
    });

    it('shouldReadBlockOfTwoMessages', () => {
        const offset = 0;
        const limit = termBuffer.capacity();
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);

        frame(offset, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength, messageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(alignedMessageLength * 2);
    });

    it('shouldReadBlockOfThreeMessagesThatFillBuffer', () => {
        const offset = 0;
        const limit = termBuffer.capacity();
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);
        const thirdMessageLength = limit - alignedMessageLength * 2;

        frame(offset, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength * 2, thirdMessageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(limit);
    });

    it('shouldReadBlockOfTwoMessagesBecauseOfLimit', () => {
        const offset = 0;
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);
        const limit = alignedMessageLength * 2 + 1;

        frame(offset, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength * 2, messageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(alignedMessageLength * 2);
    });

    it('shouldFailToReadFirstMessageBecauseOfLimit', () => {
        const offset = 0;
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);
        const limit = alignedMessageLength - 1;

        frame(offset, messageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(newOffset).toBe(offset);
    });

    it('shouldReadOneMessageOnLimit', () => {
        const offset = 0;
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);

        frame(offset, messageLength, HDR_TYPE_DATA);

        const newOffset = TermBlockScanner.scan(termBuffer, offset, alignedMessageLength);
        expect(newOffset).toBe(alignedMessageLength);
    });

    it('shouldReadBlockOfOneMessageThenPadding', () => {
        const offset = 0;
        const limit = termBuffer.capacity();
        const messageLength = 50;
        const alignedMessageLength = BitUtil.align(messageLength, FRAME_ALIGNMENT);

        frame(offset, messageLength, HDR_TYPE_DATA);
        frame(alignedMessageLength, messageLength, HDR_TYPE_PAD);

        const firstOffset = TermBlockScanner.scan(termBuffer, offset, limit);
        expect(firstOffset).toBe(alignedMessageLength);

        const secondOffset = TermBlockScanner.scan(termBuffer, firstOffset, limit);
        expect(secondOffset).toBe(alignedMessageLength * 2);
    });
});
