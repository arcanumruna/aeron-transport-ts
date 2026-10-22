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
// Port of io/aeron/logbuffer/TermReaderTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { Integer } from '../../../src/agrona/jdk.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { FragmentHandler } from '../../../src/client/logbuffer/FragmentHandler.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermReader } from '../../../src/client/logbuffer/TermReader.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { expectInOrder } from '../../support/InOrder.js';
import { MockPosition } from '../../support/MockPosition.js';

const { FRAME_ALIGNMENT, PADDING_FRAME_TYPE, frameType } = FrameDescriptor;
const { align } = BitUtil;
const { HDR_TYPE_DATA } = HeaderFlyweight;

const TERM_BUFFER_CAPACITY = LogBufferDescriptor.TERM_MIN_LENGTH;
const HEADER_LENGTH = DataHeaderFlyweight.HEADER_LENGTH;
const INITIAL_TERM_ID = 7;
const POSITION_BITS_TO_SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_BUFFER_CAPACITY);

describe('TermReader', () => {
    // JUnit creates a new test instance per test, so the fixtures are rebuilt before each one. The term buffer is a
    // real buffer holding real frames that Mockito stubbed; its `getIntVolatile` is a spy that calls through.
    let header: Header;
    let termBuffer: UnsafeBuffer;
    let getIntVolatile: ReturnType<typeof vi.spyOn>;
    let errorHandler: { onError: Mock<ErrorHandler['onError']> };
    let handler: { onFragment: Mock<FragmentHandler['onFragment']> };
    let subscriberPosition: MockPosition;

    beforeEach(() => {
        header = new Header(INITIAL_TERM_ID, TERM_BUFFER_CAPACITY);
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_CAPACITY));
        getIntVolatile = vi.spyOn(termBuffer, 'getIntVolatile');
        errorHandler = { onError: vi.fn<ErrorHandler['onError']>() };
        handler = { onFragment: vi.fn<FragmentHandler['onFragment']>() };
        subscriberPosition = new MockPosition();
    });

    /** `when(termBuffer.getIntVolatile(offset)).thenReturn(frameLength)` and the type: a frame in the buffer. */
    function frame(offset: number, frameLength: number, type: number): void {
        termBuffer.putInt(offset, frameLength);
        frameType(termBuffer, offset, type);
    }

    it('shouldReadFirstMessage', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const termOffset = 0;

        frame(0, frameLength, HDR_TYPE_DATA);

        const readOutcome = TermReader.read(
            termBuffer,
            termOffset,
            handler,
            Integer.MAX_VALUE,
            header,
            errorHandler,
            0,
            subscriberPosition,
        );
        expect(readOutcome).toBe(1);

        expect(getIntVolatile.mock.calls[0]).toEqual([0]);
        expect(handler.onFragment.mock.calls).toEqual([[termBuffer, HEADER_LENGTH, msgLength, header]]);
        expect(subscriberPosition.setReleaseSpy.mock.calls).toEqual([[alignedFrameLength]]);
        expectInOrder([getIntVolatile, 0], [handler.onFragment, 0], [subscriberPosition.setReleaseSpy, 0]);
    });

    it('shouldNotReadPastTail', () => {
        const termOffset = 0;

        const readOutcome = TermReader.read(
            termBuffer,
            termOffset,
            handler,
            Integer.MAX_VALUE,
            header,
            errorHandler,
            0,
            subscriberPosition,
        );
        expect(readOutcome).toBe(0);
        expect(subscriberPosition.setReleaseSpy).not.toHaveBeenCalled();

        expect(getIntVolatile.mock.calls).toEqual([[0]]);
        expect(handler.onFragment).not.toHaveBeenCalled();
    });

    it('shouldReadOneLimitedMessage', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const termOffset = 0;

        // every offset holds the frame in the Java test (anyInt()); the limit stops the read after the first
        for (let offset = 0; offset < 4 * alignedFrameLength; offset += alignedFrameLength) {
            frame(offset, frameLength, HDR_TYPE_DATA);
        }

        const readOutcome = TermReader.read(
            termBuffer,
            termOffset,
            handler,
            1,
            header,
            errorHandler,
            0,
            subscriberPosition,
        );
        expect(readOutcome).toBe(1);

        expect(getIntVolatile.mock.calls).toEqual([[0]]);
        expect(handler.onFragment.mock.calls).toEqual([[termBuffer, HEADER_LENGTH, msgLength, header]]);
        expect(subscriberPosition.setReleaseSpy.mock.calls).toEqual([[alignedFrameLength]]);
        expectInOrder([getIntVolatile, 0], [handler.onFragment, 0], [subscriberPosition.setReleaseSpy, 0]);
        // verifyNoMoreInteractions: nothing else was read, handed over or released
        expect(getIntVolatile).toHaveBeenCalledTimes(1);
        expect(handler.onFragment).toHaveBeenCalledTimes(1);
        expect(subscriberPosition.setReleaseSpy).toHaveBeenCalledTimes(1);
        expect(errorHandler.onError).not.toHaveBeenCalled();
    });

    it('shouldReadMultipleMessages', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const termOffset = 0;

        frame(0, frameLength, HDR_TYPE_DATA);
        frame(alignedFrameLength, frameLength, HDR_TYPE_DATA);

        const readOutcome = TermReader.read(
            termBuffer,
            termOffset,
            handler,
            Integer.MAX_VALUE,
            header,
            errorHandler,
            0,
            subscriberPosition,
        );
        expect(readOutcome).toBe(2);

        expect(getIntVolatile.mock.calls[0]).toEqual([0]);
        expect(handler.onFragment.mock.calls[0]).toEqual([termBuffer, HEADER_LENGTH, msgLength, header]);
        expect(getIntVolatile.mock.calls[1]).toEqual([alignedFrameLength]);
        expect(handler.onFragment.mock.calls[1]).toEqual([
            termBuffer,
            alignedFrameLength + HEADER_LENGTH,
            msgLength,
            header,
        ]);
        expect(subscriberPosition.setReleaseSpy.mock.calls).toEqual([[alignedFrameLength * 2]]);
        expectInOrder(
            [getIntVolatile, 0],
            [handler.onFragment, 0],
            [getIntVolatile, 1],
            [handler.onFragment, 1],
            [subscriberPosition.setReleaseSpy, 0],
        );
    });

    it('shouldReadLastMessage', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const frameOffset = TERM_BUFFER_CAPACITY - alignedFrameLength;
        const startingPosition = LogBufferDescriptor.computePosition(
            INITIAL_TERM_ID,
            frameOffset,
            POSITION_BITS_TO_SHIFT,
            INITIAL_TERM_ID,
        );

        frame(frameOffset, frameLength, HDR_TYPE_DATA);
        subscriberPosition.value = startingPosition;

        const readOutcome = TermReader.read(
            termBuffer,
            frameOffset,
            handler,
            Integer.MAX_VALUE,
            header,
            errorHandler,
            startingPosition,
            subscriberPosition,
        );
        expect(readOutcome).toBe(1);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(handler.onFragment.mock.calls).toEqual([[termBuffer, frameOffset + HEADER_LENGTH, msgLength, header]]);
        expect(subscriberPosition.setReleaseSpy.mock.calls).toEqual([[TERM_BUFFER_CAPACITY]]);
        expectInOrder([getIntVolatile, 0], [handler.onFragment, 0], [subscriberPosition.setReleaseSpy, 0]);
    });

    it('shouldNotReadLastMessageWhenPadding', () => {
        const msgLength = 1;
        const frameLength = HEADER_LENGTH + msgLength;
        const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
        const frameOffset = TERM_BUFFER_CAPACITY - alignedFrameLength;
        const currentPosition = LogBufferDescriptor.computePosition(
            INITIAL_TERM_ID,
            frameOffset,
            POSITION_BITS_TO_SHIFT,
            INITIAL_TERM_ID,
        );

        frame(frameOffset, frameLength, PADDING_FRAME_TYPE);
        subscriberPosition.value = currentPosition;

        const readOutcome = TermReader.read(
            termBuffer,
            frameOffset,
            handler,
            Integer.MAX_VALUE,
            header,
            errorHandler,
            currentPosition,
            subscriberPosition,
        );
        expect(readOutcome).toBe(0);

        expect(getIntVolatile.mock.calls[0]).toEqual([frameOffset]);
        expect(handler.onFragment).not.toHaveBeenCalled();
        expect(subscriberPosition.setReleaseSpy.mock.calls).toEqual([[TERM_BUFFER_CAPACITY]]);
        expectInOrder([getIntVolatile, 0], [subscriberPosition.setReleaseSpy, 0]);
    });
});
