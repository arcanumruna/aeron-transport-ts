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
// Port of io/aeron/protocol/SetupFlyweightTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ThreadLocalRandom } from '../../../src/agrona/jdk.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';

// FrameDescriptor.FRAME_ALIGNMENT, LogBufferDescriptor.TERM_MIN_LENGTH and TERM_MAX_LENGTH: both classes are ported in
// T9, which replaces these with their constants.
const FRAME_ALIGNMENT = 32;
const TERM_MIN_LENGTH = 64 * 1024;
const TERM_MAX_LENGTH = 1024 * 1024 * 1024;

const { HEADER_LENGTH, MAX_UDP_PAYLOAD_LENGTH } = SetupFlyweight;

describe('SetupFlyweight', () => {
    // JUnit creates a new test instance per test, so the field is rebuilt before each one
    let flyweight: SetupFlyweight;

    beforeEach(() => {
        flyweight = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(HEADER_LENGTH)));
    });

    it.each([0, 8, TERM_MIN_LENGTH / 2, TERM_MAX_LENGTH + 1])(
        'shouldRejectFrameIfTermLengthIsOutOfBounds %d',
        (termLength) => {
            flyweight.mtuLength(64).termOffset(0).termLength(termLength);

            expect(flyweight.isValid()).toBe(false);
        },
    );

    it.each([TERM_MIN_LENGTH - 1, TERM_MAX_LENGTH - 1, 1_000_000])(
        'shouldRejectFrameIfTermLengthIsNotPowerOfTwo %d',
        (termLength) => {
            flyweight.mtuLength(64).termOffset(0).termLength(termLength);

            expect(flyweight.isValid()).toBe(false);
        },
    );

    it.each([-32, TERM_MIN_LENGTH, TERM_MIN_LENGTH * 2])(
        'shouldRejectFrameIfTermOffsetIsOutOfBounds %d',
        (termOffset) => {
            flyweight.mtuLength(64).termOffset(termOffset).termLength(TERM_MIN_LENGTH);

            expect(flyweight.isValid()).toBe(false);
        },
    );

    it.each([1, TERM_MIN_LENGTH - 55])('shouldRejectFrameIfTermOffsetIsNotAligned %d', (termOffset) => {
        flyweight.mtuLength(64).termOffset(termOffset).termLength(TERM_MIN_LENGTH);

        expect(flyweight.isValid()).toBe(false);
    });

    it.each([0, DataHeaderFlyweight.HEADER_LENGTH - 1, MAX_UDP_PAYLOAD_LENGTH + FRAME_ALIGNMENT])(
        'shouldRejectFrameIfMtuIsOutOfBounds %d',
        (mtu) => {
            flyweight.mtuLength(mtu).termOffset(0).termLength(TERM_MIN_LENGTH);

            expect(flyweight.isValid()).toBe(false);
        },
    );

    // Java has two tests of this name: the @ValueSource one here and, below, the @CsvSource one that asserts valid frames.
    it.each([DataHeaderFlyweight.HEADER_LENGTH + 1, 999])('shouldRejectFrameIfMtuIsNotAligned %d', (mtu) => {
        flyweight.mtuLength(mtu).termOffset(0).termLength(TERM_MIN_LENGTH);

        expect(flyweight.isValid()).toBe(false);
    });

    it.each([
        [32, 0, 65536],
        [1408, 0, 1073741824],
        [128, 1073741792, 1073741824],
        [4096, 64, 1048576],
    ] as const)('shouldRejectFrameIfMtuIsNotAligned %d %d %d', (mtu, termOffset, termLength) => {
        flyweight
            .sessionId(ThreadLocalRandom.current().nextInt())
            .streamId(ThreadLocalRandom.current().nextInt())
            .initialTermId(ThreadLocalRandom.current().nextInt())
            .activeTermId(ThreadLocalRandom.current().nextInt())
            .mtuLength(mtu)
            .termOffset(termOffset)
            .termLength(termLength);

        expect(flyweight.isValid()).toBe(true);
    });
});
