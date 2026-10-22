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
// Port of io/aeron/logbuffer/LogBufferDescriptorTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';

const {
    LOG_META_DATA_LENGTH,
    PARTITION_COUNT,
    activeTermCount,
    packTail,
    rawTail,
    rotateLog,
    computeFragmentedFrameLength,
} = LogBufferDescriptor;

describe('LogBufferDescriptor', () => {
    // JUnit creates a new test instance per test, so the buffer is rebuilt before each one; `allocateDirect` is an ArrayBuffer
    let metadataBuffer: UnsafeBuffer;

    beforeEach(() => {
        metadataBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
    });

    it('rotateLogIsAShouldCasActiveTermCountEvenWhenTermIdDoesNotMatch', () => {
        const termId = 5;
        const termCount = 1;
        rawTail(metadataBuffer, 2, packTail(termId, 1024));
        rawTail(metadataBuffer, 0, packTail(termId + 1, 2048));
        rawTail(metadataBuffer, 1, packTail(termId + 2, 4096));
        activeTermCount(metadataBuffer, termCount);

        expect(rotateLog(metadataBuffer, termCount, termId)).toBe(true);

        expect(rawTail(metadataBuffer, 2)).toBe(packTail(termId, 1024));
        expect(rawTail(metadataBuffer, 0)).toBe(packTail(termId + 1, 2048));
        expect(rawTail(metadataBuffer, 1)).toBe(packTail(termId + 2, 4096));
        expect(activeTermCount(metadataBuffer)).toBe(termCount + 1);
    });

    it('rotateLogIsAShouldCasActiveTermCountAfterSettingTailForTheNextTerm', () => {
        const termId = 51;
        const termCount = 19;
        rawTail(metadataBuffer, 1, packTail(termId, 1024));
        rawTail(metadataBuffer, 2, packTail(termId + 1 - PARTITION_COUNT, 2048));
        rawTail(metadataBuffer, 0, packTail(termId + 2 - PARTITION_COUNT, 4096));
        activeTermCount(metadataBuffer, termCount);

        expect(rotateLog(metadataBuffer, termCount, termId)).toBe(true);

        expect(rawTail(metadataBuffer, 1)).toBe(packTail(termId, 1024));
        expect(rawTail(metadataBuffer, 2)).toBe(packTail(termId + 1, 0));
        expect(rawTail(metadataBuffer, 0)).toBe(packTail(termId + 2 - PARTITION_COUNT, 4096));
        expect(activeTermCount(metadataBuffer)).toBe(termCount + 1);
    });

    it('rotateLogIsANoOpIfNeitherTailNorActiveTermCountCanBeChanged', () => {
        const termId = 23;
        const termCount = 42;
        rawTail(metadataBuffer, 0, packTail(termId, 1024));
        rawTail(metadataBuffer, 1, packTail(termId + 18, 2048));
        rawTail(metadataBuffer, 2, packTail(termId - 19, 4096));
        activeTermCount(metadataBuffer, termCount);

        expect(rotateLog(metadataBuffer, 3, termId)).toBe(false);

        expect(rawTail(metadataBuffer, 0)).toBe(packTail(termId, 1024));
        expect(rawTail(metadataBuffer, 1)).toBe(packTail(termId + 18, 2048));
        expect(rawTail(metadataBuffer, 2)).toBe(packTail(termId - 19, 4096));
        expect(activeTermCount(metadataBuffer)).toBe(termCount);
    });

    it.each([
        [0, 1376, 0],
        [10, 1024, 64],
        [2048, 2048, 2080],
        [4096, 1024, 4224],
        [7997, 992, 8288],
    ])('shouldComputeFragmentedFrameLength %d %d %d', (length, maxPayloadLength, frameLength) => {
        expect(computeFragmentedFrameLength(length, maxPayloadLength)).toBe(frameLength);
    });
});
