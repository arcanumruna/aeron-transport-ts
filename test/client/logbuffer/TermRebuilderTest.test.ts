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
// Port of io/aeron/logbuffer/TermRebuilderTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermRebuilder } from '../../../src/client/logbuffer/TermRebuilder.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { expectInOrder } from '../../support/InOrder.js';

const { FRAME_ALIGNMENT, PADDING_FRAME_TYPE, typeOffset } = FrameDescriptor;
const { LITTLE_ENDIAN } = ByteOrder;
const { HEADER_LENGTH } = DataHeaderFlyweight;

const TERM_BUFFER_CAPACITY = LogBufferDescriptor.TERM_MIN_LENGTH;

describe('TermRebuilder', () => {
    // A real term buffer whose writes are spies that call through, so the bytes can be checked as well
    let termBuffer: UnsafeBuffer;
    let putBytes: ReturnType<typeof vi.spyOn>;
    let putInt: ReturnType<typeof vi.spyOn>;
    let putIntRelease: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_CAPACITY));
        putBytes = vi.spyOn(termBuffer, 'putBytes');
        putInt = vi.spyOn(termBuffer, 'putInt');
        putIntRelease = vi.spyOn(termBuffer, 'putIntRelease');
    });

    /** The payload after the header is a pattern, so that the copy can be told from zeros. */
    function pattern(packet: UnsafeBuffer, length: number): void {
        for (let i = 4; i < length; i++) {
            packet.putByte(i, (i * 7 + 3) & 0xff);
        }
    }

    function expectCopied(termOffset: number, packet: UnsafeBuffer, length: number): void {
        expect(termBuffer.byteArray().slice(termOffset, termOffset + length)).toEqual(
            packet.byteArray().slice(0, length),
        );
    }

    it('shouldInsertIntoEmptyBuffer', () => {
        const packet = new UnsafeBuffer(new ArrayBuffer(256));
        const termOffset = 0;
        const srcOffset = 0;
        const length = 256;
        pattern(packet, length);
        packet.putInt(srcOffset, length, LITTLE_ENDIAN);

        TermRebuilder.insert(termBuffer, termOffset, packet, length);

        // putLong(termOffset + 24 / 16 / 8, packet.getLong(...)) are the pairs of int halves, high half first (spec D5)
        expect(putBytes.mock.calls).toEqual([
            [termOffset + HEADER_LENGTH, packet, srcOffset + HEADER_LENGTH, length - HEADER_LENGTH],
        ]);
        expect(putInt.mock.calls).toEqual([28, 24, 20, 16, 12, 8, 4].map((o) => [termOffset + o, packet.getInt(o)]));
        // putLongRelease(termOffset, packet.getLong(0)): the frame length is the low half and is released last
        expect(putIntRelease.mock.calls).toEqual([[termOffset, packet.getInt(0)]]);
        expect(putIntRelease.mock.calls).toEqual([[termOffset, length]]);
        expectInOrder(
            [putBytes, 0],
            [putInt, 0],
            [putInt, 1],
            [putInt, 2],
            [putInt, 3],
            [putInt, 4],
            [putInt, 5],
            [putInt, 6],
            [putIntRelease, 0],
        );
        expectCopied(termOffset, packet, length);
    });

    it('shouldInsertLastFrameIntoBuffer', () => {
        const frameLength = BitUtil.align(256, FRAME_ALIGNMENT);
        const srcOffset = 0;
        const tail = TERM_BUFFER_CAPACITY - frameLength;
        const termOffset = tail;
        const packet = new UnsafeBuffer(new ArrayBuffer(frameLength));
        pattern(packet, frameLength);
        packet.putShort(typeOffset(srcOffset), PADDING_FRAME_TYPE, LITTLE_ENDIAN);
        packet.putInt(srcOffset, frameLength, LITTLE_ENDIAN);

        TermRebuilder.insert(termBuffer, termOffset, packet, frameLength);

        expect(putBytes.mock.calls).toEqual([
            [tail + HEADER_LENGTH, packet, srcOffset + HEADER_LENGTH, frameLength - HEADER_LENGTH],
        ]);
        expectCopied(termOffset, packet, frameLength);
    });

    it('shouldFillSingleGap', () => {
        const frameLength = 50;
        const alignedFrameLength = BitUtil.align(frameLength, FRAME_ALIGNMENT);
        const srcOffset = 0;
        const tail = alignedFrameLength;
        const termOffset = tail;
        const packet = new UnsafeBuffer(new ArrayBuffer(alignedFrameLength));
        pattern(packet, alignedFrameLength);

        TermRebuilder.insert(termBuffer, termOffset, packet, alignedFrameLength);

        expect(putBytes.mock.calls).toEqual([
            [tail + HEADER_LENGTH, packet, srcOffset + HEADER_LENGTH, alignedFrameLength - HEADER_LENGTH],
        ]);
        expectCopied(termOffset, packet, alignedFrameLength);
    });

    it('shouldFillAfterAGap', () => {
        const frameLength = 50;
        const alignedFrameLength = BitUtil.align(frameLength, FRAME_ALIGNMENT);
        const srcOffset = 0;
        const packet = new UnsafeBuffer(new ArrayBuffer(alignedFrameLength));
        pattern(packet, alignedFrameLength);
        const termOffset = alignedFrameLength * 2;

        TermRebuilder.insert(termBuffer, termOffset, packet, alignedFrameLength);

        expect(putBytes.mock.calls).toEqual([
            [
                alignedFrameLength * 2 + HEADER_LENGTH,
                packet,
                srcOffset + HEADER_LENGTH,
                alignedFrameLength - HEADER_LENGTH,
            ],
        ]);
        expectCopied(termOffset, packet, alignedFrameLength);
    });

    it('shouldFillGapButNotMoveTailOrHwm', () => {
        const frameLength = 50;
        const alignedFrameLength = BitUtil.align(frameLength, FRAME_ALIGNMENT);
        const srcOffset = 0;
        const packet = new UnsafeBuffer(new ArrayBuffer(alignedFrameLength));
        pattern(packet, alignedFrameLength);
        const termOffset = alignedFrameLength * 2;

        TermRebuilder.insert(termBuffer, termOffset, packet, alignedFrameLength);

        expect(putBytes.mock.calls).toEqual([
            [
                alignedFrameLength * 2 + HEADER_LENGTH,
                packet,
                srcOffset + HEADER_LENGTH,
                alignedFrameLength - HEADER_LENGTH,
            ],
        ]);
        expectCopied(termOffset, packet, alignedFrameLength);
    });
});
