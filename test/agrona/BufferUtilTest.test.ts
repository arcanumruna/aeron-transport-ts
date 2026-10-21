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
// Port of org/agrona/BufferUtilTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { BufferUtil } from '../../src/agrona/BufferUtil.js';
import { IllegalArgumentException, IndexOutOfBoundsException, Long } from '../../src/agrona/jdk.js';

describe('BufferUtilTest', () => {
    it('shouldDetectNonPowerOfTwoAlignment', () => {
        expect(() => BufferUtil.allocateDirectAligned(1, 3)).toThrow(IllegalArgumentException);
    });

    it.skip('shouldAlignToWordBoundary', () => {
        // no direct memory / ByteBuffer in JS: an ArrayBuffer has no address to be aligned
    });

    it.skip('shouldAlignToCacheLineBoundary', () => {
        // no direct memory / ByteBuffer in JS: an ArrayBuffer has no address to be aligned
    });

    it.skip('freeIsANoOpIfDirectBufferIsNull', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeIsANoOpIfByteBufferIsNull', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeIsANoOpIfByteBufferIsNotDirect', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeIsANoOpIfDirectBufferContainsNonDirectByteBuffer', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeShouldReleaseByteBufferResources', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeShouldReleaseDirectBufferResources', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeThrowsIllegalArgumentExceptionIfByteBufferIsASlice', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it.skip('freeThrowsIllegalArgumentExceptionIfByteBufferIsADuplicate', () => {
        // no direct memory / ByteBuffer in JS: BufferUtil.free is not ported, memory is garbage collected
    });

    it('shouldBoundsCheckByteArrayIndexWithoutLongOverflow', () => {
        const buffer = new Uint8Array(8);
        // adapted: Long.MAX_VALUE is 2^53 - 1, the largest index a number holds
        const index = Long.MAX_VALUE - 3;
        const length = 10;

        expect(() => BufferUtil.boundsCheck(buffer, index, length)).toThrow(IndexOutOfBoundsException);
    });

    it.skip('shouldBoundsCheckByteBufferIndexWithoutLongOverflow', () => {
        // no direct memory / ByteBuffer in JS: boundsCheck(ByteBuffer, long, int) is not ported
    });
});
