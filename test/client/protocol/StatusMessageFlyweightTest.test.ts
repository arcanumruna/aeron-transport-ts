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
// Port of io/aeron/protocol/StatusMessageFlyweightTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Integer, ThreadLocalRandom } from '../../../src/agrona/jdk.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';

// LogBufferDescriptor.TERM_MIN_LENGTH: LogBufferDescriptor is ported in T9, which replaces this with its constant.
const TERM_MIN_LENGTH = 64 * 1024;

describe('StatusMessageFlyweight', () => {
    // JUnit creates a new test instance per test, so the field is rebuilt before each one
    let flyweight: StatusMessageFlyweight;

    beforeEach(() => {
        flyweight = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH)));
    });

    it.each([-128, -1, 1024 * 1024 * 1024, 2 * 1024 * 1024])(
        'shouldRejectFrameIfConsumptionTermOffsetIsOutOfBounds %d',
        (termOffset) => {
            flyweight.consumptionTermOffset(termOffset);

            expect(flyweight.isValid(2 * 1024 * 1024)).toBe(false);
        },
    );

    it.each([1, 31])('shouldRejectFrameIfConsumptionTermOffsetIsNotAligned %d', (termOffset) => {
        flyweight.consumptionTermOffset(termOffset);

        expect(flyweight.isValid(2 * 1024 * 1024)).toBe(false);
    });

    it.each([Integer.MIN_VALUE, -4, 1024 * 1024 + 1, 4194304, 2 * 1024 * 1024, 2 * 1024 * 1024 - 1])(
        'shouldRejectFrameIfReceiveWindowIsOutOfBounds %d',
        (receiverWindowLength) => {
            flyweight.receiverWindowLength(receiverWindowLength);

            expect(flyweight.isValid(2 * 1024 * 1024)).toBe(false);
        },
    );

    it.each<[number, number]>([
        [0, 0],
        [0, 1024],
        [32768, 32768],
        [65504, 32768],
        [65504, 10],
    ])('shouldRecognizeValidFrame %d,%d', (termOffset, receiverWindowLength) => {
        flyweight
            .streamId(ThreadLocalRandom.current().nextInt())
            .sessionId(ThreadLocalRandom.current().nextInt())
            .consumptionTermId(ThreadLocalRandom.current().nextInt())
            .consumptionTermOffset(termOffset)
            .receiverWindowLength(receiverWindowLength);

        expect(flyweight.isValid(TERM_MIN_LENGTH)).toBe(true);
    });
});
