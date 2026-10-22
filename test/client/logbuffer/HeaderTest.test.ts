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
// Port of io/aeron/logbuffer/HeaderTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { Header } from '../../../src/client/logbuffer/Header.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';

describe('Header', () => {
    it('constructorInitializedData', () => {
        const initialTermId = 18;
        const context = 2n ** 63n - 1n; // BigDecimal.valueOf(Long.MAX_VALUE): any object serves as a context
        const positionBitsToShift = 2;
        const header = new Header(initialTermId, positionBitsToShift, context);

        expect(header.initialTermId()).toBe(initialTermId);
        expect(header.positionBitsToShift()).toBe(positionBitsToShift);
        expect(header.context()).toBe(context);
    });

    it.each([
        [0, 2, 100, 1024, 5, 1172],
        [42, 16, 13, 4096, 46, 266272],
        [1, 30, 1024, 1073741824, 111, 119185343488],
    ])(
        'positionCalculationTheEndOfTheMessageInTheLog %d %d %d %d %d %d',
        (initialTermId, positionBitsToShift, frameLength, termOffset, termId, expectedPosition) => {
            const dataHeaderFlyweight = new DataHeaderFlyweight();
            const header = new Header(initialTermId, positionBitsToShift);
            header.buffer(dataHeaderFlyweight);
            header.offset(0);
            dataHeaderFlyweight.wrap(new Uint8Array(64), 16, 32);
            dataHeaderFlyweight.frameLength(frameLength);
            dataHeaderFlyweight.termId(termId);
            dataHeaderFlyweight.termOffset(termOffset);

            expect(header.position()).toBe(expectedPosition);
            expect(header.fragmentedFrameLength()).toBe(Aeron.NULL_VALUE);
        },
    );

    it('offsetIsRelativeToTheBufferStart', () => {
        const header = new Header(42, 3, 'xyz');

        expect(header.offset()).toBe(0);

        header.offset(142);

        expect(header.offset()).toBe(142);
    });

    it.each([
        [103, 0x3, 0x1a, 0x6, 2080, -46234, 333, 5, 909090909090909n],
        [512, 0x1, 0xc, 0x1, 1073741824, 42, -876, 1543, -4632842384627834687n],
    ] as const)(
        'shouldReadDataFromTheBuffer %d %d %d %d %d %d %d %d %d',
        (frameLength, version, flags, type, termOffset, sessionId, streamId, termId, reservedValue) => {
            const array = new Uint8Array(100);
            const offset = 16;
            const dataHeaderFlyweight = new DataHeaderFlyweight();
            dataHeaderFlyweight.wrap(array, offset, 64);

            dataHeaderFlyweight.frameLength(frameLength).version(version).flags(flags).headerType(type);

            dataHeaderFlyweight
                .termOffset(termOffset)
                .sessionId(sessionId)
                .streamId(streamId)
                .termId(termId)
                .reservedValue(reservedValue);

            const header = new Header(5, 22);
            header.buffer(new UnsafeBuffer(array));
            header.offset(offset);

            expect(header.frameLength()).toBe(frameLength);
            expect(header.flags()).toBe(flags);
            expect(header.type()).toBe(type);
            expect(header.termOffset()).toBe(termOffset);
            expect(header.sessionId()).toBe(sessionId);
            expect(header.streamId()).toBe(streamId);
            expect(header.termId()).toBe(termId);
            expect(header.reservedValue()).toBe(reservedValue);
        },
    );

    it('shouldOverrideInitialTermId', () => {
        const initialTermId = -178;
        const newInitialTermId = 871;
        const header = new Header(initialTermId, 3);
        expect(header.initialTermId()).toBe(initialTermId);

        header.initialTermId(newInitialTermId);
        expect(header.initialTermId()).toBe(newInitialTermId);
    });

    it('shouldOverridePositionBitsToShift', () => {
        const positionBitsToShift = -6;
        const newPositionBitsToShift = 20;
        const header = new Header(42, positionBitsToShift);
        expect(header.positionBitsToShift()).toBe(positionBitsToShift);

        header.positionBitsToShift(newPositionBitsToShift);
        expect(header.positionBitsToShift()).toBe(newPositionBitsToShift);
    });
});
