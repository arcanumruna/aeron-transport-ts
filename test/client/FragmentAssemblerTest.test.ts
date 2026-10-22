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
// Port of io/aeron/FragmentAssemblerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import { FragmentAssembler } from '../../src/client/FragmentAssembler.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';

const { FRAME_ALIGNMENT } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;

const SESSION_ID = 777;
const INITIAL_TERM_ID = 3;

describe('FragmentAssembler', () => {
    // JUnit creates a new test instance per test, so the fixture is rebuilt before each one
    let delegateFragmentHandler: { onFragment: Mock<FragmentHandler['onFragment']> };
    let header: Header;
    let assembler: FragmentAssembler;
    let headerFlyweight: DataHeaderFlyweight;

    // calls of the delegate as [buffer, offset, length, header]
    function calls(): [DirectBuffer, number, number, Header][] {
        return delegateFragmentHandler.onFragment.mock.calls;
    }

    beforeEach(() => {
        delegateFragmentHandler = { onFragment: vi.fn<FragmentHandler['onFragment']>() };
        header = new Header(INITIAL_TERM_ID, LogBufferDescriptor.TERM_MIN_LENGTH);
        assembler = new FragmentAssembler(delegateFragmentHandler);

        const buffer = new UnsafeBuffer(new Uint8Array(64));
        headerFlyweight = new DataHeaderFlyweight();
        headerFlyweight.wrap(buffer, 16, HEADER_LENGTH);
        header.buffer(buffer);
        header.offset(headerFlyweight.wrapAdjustment());

        headerFlyweight.sessionId(SESSION_ID);
    });

    it('shouldPassThroughUnfragmentedMessage', () => {
        headerFlyweight.flags(FrameDescriptor.UNFRAGMENTED);
        const srcBuffer = new UnsafeBuffer(new Uint8Array(128));
        const offset = 8;
        const length = 32;

        assembler.onFragment(srcBuffer, offset, length, header);

        // verify(delegate, times(1)).onFragment(srcBuffer, offset, length, header)
        expect(delegateFragmentHandler.onFragment.mock.calls).toHaveLength(1);
        const call = calls()[0]!;
        expect(call[0]).toBe(srcBuffer);
        expect(call[1]).toBe(offset);
        expect(call[2]).toBe(length);
        expect(call[3]).toBe(header);
    });

    it('shouldAssembleTwoPartMessage', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(1024 + 2 * HEADER_LENGTH));
        const length = 512;

        let offset = HEADER_LENGTH;
        headerFlyweight.flags(FrameDescriptor.BEGIN_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);

        // verify(delegate, times(1)).onFragment(any(), eq(0), eq(length * 2), headerArg.capture())
        expect(calls()).toHaveLength(1);
        const call = calls()[0]!;
        expect(call[1]).toBe(0);
        expect(call[2]).toBe(length * 2);

        const capturedHeader = call[3];
        expect(capturedHeader.sessionId()).toBe(SESSION_ID);
        expect(capturedHeader.flags()).toBe(FrameDescriptor.UNFRAGMENTED);
    });

    it('shouldAssembleFourPartMessage', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(1024 + 4 * HEADER_LENGTH));
        const length = 256;

        let offset = HEADER_LENGTH;
        headerFlyweight.flags(FrameDescriptor.BEGIN_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(0);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(0);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG | 0x3);
        assembler.onFragment(srcBuffer, offset, length, header);

        expect(calls()).toHaveLength(1);
        const call = calls()[0]!;
        expect(call[1]).toBe(0);
        expect(call[2]).toBe(length * 4);

        const capturedHeader = call[3];
        expect(capturedHeader.sessionId()).toBe(SESSION_ID);
        expect(capturedHeader.flags()).toBe(((FrameDescriptor.UNFRAGMENTED | 0x3) << 24) >> 24);
    });

    it('shouldFreeSessionBuffer', () => {
        // when(header.flags()).thenReturn(BEGIN_FRAG_FLAG).thenReturn(END_FRAG_FLAG): set before each call
        const srcBuffer = new UnsafeBuffer(new Uint8Array(1024));
        const offset = 0;
        const length = srcBuffer.capacity() / 2;

        srcBuffer.setMemory(0, length, 65);
        srcBuffer.setMemory(length, length, 66);

        expect(assembler.freeSessionBuffer(SESSION_ID)).toBe(false);

        headerFlyweight.flags(FrameDescriptor.BEGIN_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG);
        assembler.onFragment(srcBuffer, length, length, header);

        expect(assembler.freeSessionBuffer(SESSION_ID)).toBe(true);
        expect(assembler.freeSessionBuffer(SESSION_ID)).toBe(false);
    });

    it('shouldDoNotingIfEndArrivesWithoutBegin', () => {
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG);
        const srcBuffer = new UnsafeBuffer(new Uint8Array(1024));
        const offset = 0;
        const length = srcBuffer.capacity() / 2;

        assembler.onFragment(srcBuffer, offset, length, header);

        expect(delegateFragmentHandler.onFragment).not.toHaveBeenCalled();
    });

    it('shouldDoNotingIfMidArrivesWithoutBegin', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(1024));
        const offset = 0;
        const length = srcBuffer.capacity() / 2;

        headerFlyweight.flags(0);
        assembler.onFragment(srcBuffer, offset, length, header);
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);

        expect(delegateFragmentHandler.onFragment).not.toHaveBeenCalled();
    });

    it('shouldSkipOverMessagesWithLoss', () => {
        const srcBuffer = new UnsafeBuffer(new Uint8Array(2048));
        const length = 256;

        let offset = HEADER_LENGTH;
        headerFlyweight.flags(FrameDescriptor.BEGIN_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(FrameDescriptor.END_FRAG_FLAG);
        assembler.onFragment(srcBuffer, offset, length, header);
        offset = BitUtil.align(offset + length + HEADER_LENGTH, FRAME_ALIGNMENT);
        headerFlyweight.flags(FrameDescriptor.UNFRAGMENTED);
        assembler.onFragment(srcBuffer, offset, length, header);

        // verify(delegate, times(1)).onFragment(any(), eq(offset), eq(length), headerArg.capture()): the calls that
        // match the offset and the length (the frame headers carry no term offset, so the END fragment is assembled
        // too, with offset 0 and length 512, and does not match)
        const matching = calls().filter((call) => call[1] === offset && call[2] === length);
        expect(matching).toHaveLength(1);

        const capturedHeader = matching[0]![3];
        expect(capturedHeader.sessionId()).toBe(SESSION_ID);
        expect(capturedHeader.flags()).toBe(FrameDescriptor.UNFRAGMENTED);
    });
});
