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
// Port of io/aeron/protocol/NakFlyweightTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Integer, ThreadLocalRandom } from '../../../src/agrona/jdk.js';
import { NakFlyweight } from '../../../src/client/protocol/NakFlyweight.js';

// LogBufferDescriptor.TERM_MIN_LENGTH: LogBufferDescriptor is ported in T9, which replaces this with its constant.
const TERM_MIN_LENGTH = 64 * 1024;

describe('NakFlyweight', () => {
    // JUnit creates a new test instance per test, so the field is rebuilt before each one
    let flyweight: NakFlyweight;

    beforeEach(() => {
        flyweight = new NakFlyweight(new UnsafeBuffer(new Uint8Array(NakFlyweight.HEADER_LENGTH)));
    });

    it.each([Integer.MIN_VALUE, -1024, 128 * 1024 * 1024, TERM_MIN_LENGTH])(
        'shouldRejectFrameIfTermOffsetIsOutOfBounds %d',
        (termOffset) => {
            flyweight.termOffset(termOffset);

            expect(flyweight.isValid(TERM_MIN_LENGTH)).toBe(false);
        },
    );

    it.each([100, 31])('shouldRejectFrameIfTermOffsetIsNotAligned %d', (termOffset) => {
        flyweight.termOffset(termOffset);

        expect(flyweight.isValid(TERM_MIN_LENGTH)).toBe(false);
    });

    it.each([Integer.MIN_VALUE, -1])('shouldRejectFrameIfLengthIsNegative %d', (length) => {
        flyweight.termOffset(0).length(length);

        expect(flyweight.isValid(TERM_MIN_LENGTH)).toBe(false);
    });

    it.each<[number, number]>([
        [0, 2097152],
        [1048544, 512],
    ])('shouldRejectFrameIfLengthPlusTermOffsetExceedTermBoundaries %d,%d', (termOffset, length) => {
        flyweight.termOffset(termOffset).length(length);

        expect(flyweight.isValid(1048576)).toBe(false);
    });

    it.each<[number, number]>([
        [0, 2097152],
        [1048544, 512],
        [0, 0],
        [128, 0],
    ])('shouldRecognizeValidFrames %d,%d', (termOffset, length) => {
        flyweight
            .sessionId(ThreadLocalRandom.current().nextInt())
            .streamId(ThreadLocalRandom.current().nextInt())
            .termId(ThreadLocalRandom.current().nextInt())
            .termOffset(termOffset)
            .length(length);

        expect(flyweight.isValid(2097152)).toBe(true);
    });
});
