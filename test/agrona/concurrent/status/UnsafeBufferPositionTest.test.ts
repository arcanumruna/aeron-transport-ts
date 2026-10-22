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
// Port of org/agrona/concurrent/status/UnsafeBufferPositionTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteBuffer } from '../../../support/ByteBuffer.js';

const { COUNTER_LENGTH } = CountersReader;

describe('UnsafeBufferPositionTest', () => {
    it('shouldWrapDirectBuffer', () => {
        const buffer = new UnsafeBuffer(ByteBuffer.allocateDirect(5 * COUNTER_LENGTH).arrayBuffer());
        const value = 12362863812378;
        const counterId = 2;

        const position = new UnsafeBufferPosition(buffer, counterId, null);
        try {
            position.set(value);
            position.proposeMax(value + 42);
            expect(position.get()).toBe(value + 42);
        } finally {
            position.close();
        }
    });

    it('testPlain', () => {
        const buffer = new UnsafeBuffer(ByteBuffer.allocateDirect(5 * COUNTER_LENGTH).arrayBuffer());
        const counterId = 2;

        const position = new UnsafeBufferPosition(buffer, counterId, null);
        try {
            position.set(10);
            expect(position.get()).toBe(10);

            expect(position.proposeMax(5)).toBe(false);
            expect(position.get()).toBe(10);
            expect(position.proposeMax(100)).toBe(true);
            expect(position.get()).toBe(100);
        } finally {
            position.close();
        }
    });

    it('testVolatile', () => {
        const buffer = new UnsafeBuffer(ByteBuffer.allocateDirect(5 * COUNTER_LENGTH).arrayBuffer());
        const counterId = 2;

        const position = new UnsafeBufferPosition(buffer, counterId, null);
        try {
            position.setVolatile(10);
            expect(position.getVolatile()).toBe(10);
        } finally {
            position.close();
        }
    });

    it('testAcquireRelease', () => {
        const buffer = new UnsafeBuffer(ByteBuffer.allocateDirect(5 * COUNTER_LENGTH).arrayBuffer());
        const counterId = 2;

        const position = new UnsafeBufferPosition(buffer, counterId, null);
        try {
            position.setRelease(10);
            expect(position.getAcquire()).toBe(10);

            expect(position.proposeMaxRelease(5)).toBe(false);
            expect(position.getOpaque()).toBe(10);
            expect(position.proposeMaxRelease(100)).toBe(true);
            expect(position.getAcquire()).toBe(100);
        } finally {
            position.close();
        }
    });

    it('testOpaque', () => {
        const buffer = new UnsafeBuffer(ByteBuffer.allocateDirect(5 * COUNTER_LENGTH).arrayBuffer());
        const counterId = 2;

        const position = new UnsafeBufferPosition(buffer, counterId, null);
        try {
            position.setOpaque(10);
            expect(position.getOpaque()).toBe(10);

            expect(position.proposeMaxOpaque(5)).toBe(false);
            expect(position.getOpaque()).toBe(10);
            expect(position.proposeMaxOpaque(100)).toBe(true);
            expect(position.getOpaque()).toBe(100);
        } finally {
            position.close();
        }
    });
});
