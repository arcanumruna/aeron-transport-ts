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
// Port of io/aeron/logbuffer/TermGapFillerTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermGapFiller } from '../../../src/client/logbuffer/TermGapFiller.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';

const { PADDING_FRAME_TYPE, UNFRAGMENTED } = FrameDescriptor;
const { LOG_META_DATA_LENGTH, TERM_MIN_LENGTH, initialTermId, storeDefaultFrameHeader } = LogBufferDescriptor;
const { createDefaultHeader } = DataHeaderFlyweight;

const INITIAL_TERM_ID = 11;
const TERM_ID = 22;
const SESSION_ID = 333;
const STREAM_ID = 1007;

/** Java's `(byte)` cast of the unsigned flags. */
function toByte(value: number): number {
    return (value << 24) >> 24;
}

describe('TermGapFiller', () => {
    // JUnit creates a new test instance per test, so the buffers are rebuilt before each one
    let metaDataBuffer: UnsafeBuffer;
    let termBuffer: UnsafeBuffer;
    let dataFlyweight: DataHeaderFlyweight;

    beforeEach(() => {
        metaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_MIN_LENGTH));
        dataFlyweight = new DataHeaderFlyweight(termBuffer);

        initialTermId(metaDataBuffer, INITIAL_TERM_ID);
        storeDefaultFrameHeader(metaDataBuffer, createDefaultHeader(SESSION_ID, STREAM_ID, INITIAL_TERM_ID));
    });

    it('shouldFillGapAtBeginningOfTerm', () => {
        const gapOffset = 0;
        const gapLength = 64;

        expect(TermGapFiller.tryFillGap(metaDataBuffer, termBuffer, TERM_ID, gapOffset, gapLength)).toBe(true);

        expect(dataFlyweight.frameLength()).toBe(gapLength);
        expect(dataFlyweight.frameLength()).toBe(gapLength);
        expect(dataFlyweight.termOffset()).toBe(gapOffset);
        expect(dataFlyweight.sessionId()).toBe(SESSION_ID);
        expect(dataFlyweight.termId()).toBe(TERM_ID);
        expect(dataFlyweight.headerType()).toBe(PADDING_FRAME_TYPE);
        expect(toByte(dataFlyweight.flags())).toBe(UNFRAGMENTED);
    });

    it('shouldNotOverwriteExistingFrame', () => {
        const gapOffset = 0;
        const gapLength = 64;

        dataFlyweight.frameLength(32);

        expect(TermGapFiller.tryFillGap(metaDataBuffer, termBuffer, TERM_ID, gapOffset, gapLength)).toBe(false);
    });

    it('shouldFillGapAfterExistingFrame', () => {
        const gapOffset = 128;
        const gapLength = 64;

        dataFlyweight
            .sessionId(SESSION_ID)
            .termId(TERM_ID)
            .streamId(STREAM_ID)
            .flags(UNFRAGMENTED)
            .frameLength(gapOffset);
        dataFlyweight.setMemory(0, gapOffset - DataHeaderFlyweight.HEADER_LENGTH, 'x'.charCodeAt(0));

        expect(TermGapFiller.tryFillGap(metaDataBuffer, termBuffer, TERM_ID, gapOffset, gapLength)).toBe(true);

        dataFlyweight.wrap(termBuffer, gapOffset, termBuffer.capacity() - gapOffset);
        expect(dataFlyweight.frameLength()).toBe(gapLength);
        expect(dataFlyweight.termOffset()).toBe(gapOffset);
        expect(dataFlyweight.sessionId()).toBe(SESSION_ID);
        expect(dataFlyweight.termId()).toBe(TERM_ID);
        expect(dataFlyweight.headerType()).toBe(PADDING_FRAME_TYPE);
        expect(toByte(dataFlyweight.flags())).toBe(UNFRAGMENTED);
    });

    it('shouldFillGapBetweenExistingFrames', () => {
        const gapOffset = 128;
        const gapLength = 64;

        dataFlyweight
            .sessionId(SESSION_ID)
            .termId(TERM_ID)
            .termOffset(0)
            .streamId(STREAM_ID)
            .flags(UNFRAGMENTED)
            .frameLength(gapOffset)
            .setMemory(0, gapOffset - DataHeaderFlyweight.HEADER_LENGTH, 'x'.charCodeAt(0));

        const secondExistingFrameOffset = gapOffset + gapLength;
        dataFlyweight.wrap(termBuffer, secondExistingFrameOffset, termBuffer.capacity() - secondExistingFrameOffset);
        dataFlyweight
            .sessionId(SESSION_ID)
            .termId(TERM_ID)
            .termOffset(secondExistingFrameOffset)
            .streamId(STREAM_ID)
            .flags(UNFRAGMENTED)
            .frameLength(64);

        expect(TermGapFiller.tryFillGap(metaDataBuffer, termBuffer, TERM_ID, gapOffset, gapLength)).toBe(true);

        dataFlyweight.wrap(termBuffer, gapOffset, termBuffer.capacity() - gapOffset);
        expect(dataFlyweight.frameLength()).toBe(gapLength);
        expect(dataFlyweight.termOffset()).toBe(gapOffset);
        expect(dataFlyweight.sessionId()).toBe(SESSION_ID);
        expect(dataFlyweight.termId()).toBe(TERM_ID);
        expect(dataFlyweight.headerType()).toBe(PADDING_FRAME_TYPE);
        expect(toByte(dataFlyweight.flags())).toBe(UNFRAGMENTED);
    });

    it('shouldFillGapAtEndOfTerm', () => {
        const gapOffset = termBuffer.capacity() - 64;
        const gapLength = 64;

        dataFlyweight
            .sessionId(SESSION_ID)
            .termId(TERM_ID)
            .streamId(STREAM_ID)
            .flags(UNFRAGMENTED)
            .frameLength(termBuffer.capacity() - gapOffset);
        dataFlyweight.setMemory(0, gapOffset - DataHeaderFlyweight.HEADER_LENGTH, 'x'.charCodeAt(0));

        expect(TermGapFiller.tryFillGap(metaDataBuffer, termBuffer, TERM_ID, gapOffset, gapLength)).toBe(true);

        dataFlyweight.wrap(termBuffer, gapOffset, termBuffer.capacity() - gapOffset);
        expect(dataFlyweight.frameLength()).toBe(gapLength);
        expect(dataFlyweight.termOffset()).toBe(gapOffset);
        expect(dataFlyweight.sessionId()).toBe(SESSION_ID);
        expect(dataFlyweight.termId()).toBe(TERM_ID);
        expect(dataFlyweight.headerType()).toBe(PADDING_FRAME_TYPE);
        expect(toByte(dataFlyweight.flags())).toBe(UNFRAGMENTED);
    });
});
