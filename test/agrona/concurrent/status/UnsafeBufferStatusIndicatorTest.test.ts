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
// Port of org/agrona/concurrent/status/UnsafeBufferStatusIndicatorTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferStatusIndicator } from '../../../../src/agrona/concurrent/status/UnsafeBufferStatusIndicator.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Long } from '../../../../src/agrona/jdk.js';

const { COUNTER_LENGTH } = CountersReader;

describe('UnsafeBufferStatusIndicatorTest', () => {
    it('canWrapDifferentKindsOfBuffers', () => {
        const value = Long.MIN_VALUE;
        const counterId = 2;
        const buffer = new UnsafeBuffer(new ArrayBuffer(5 * COUNTER_LENGTH));
        const unsafeBufferStatusIndicator = new UnsafeBufferStatusIndicator(buffer, counterId);

        unsafeBufferStatusIndicator.setVolatile(value);
        expect(unsafeBufferStatusIndicator.getVolatile()).toBe(value);
    });

    it('testVolatile', () => {
        const counterId = 2;
        const buffer = new UnsafeBuffer(new ArrayBuffer(5 * COUNTER_LENGTH));
        const statusIndicator = new UnsafeBufferStatusIndicator(buffer, counterId);
        expect(statusIndicator.getVolatile()).toBe(0);
        statusIndicator.setVolatile(10);
        expect(statusIndicator.getVolatile()).toBe(10);
    });

    it('testReleaseAcquire', () => {
        const counterId = 2;
        const buffer = new UnsafeBuffer(new ArrayBuffer(5 * COUNTER_LENGTH));
        const statusIndicator = new UnsafeBufferStatusIndicator(buffer, counterId);
        expect(statusIndicator.getAcquire()).toBe(0);
        statusIndicator.setRelease(10);
        expect(statusIndicator.getAcquire()).toBe(10);
    });

    it('testOpaque', () => {
        const counterId = 2;
        const buffer = new UnsafeBuffer(new ArrayBuffer(5 * COUNTER_LENGTH));
        const statusIndicator = new UnsafeBufferStatusIndicator(buffer, counterId);
        expect(statusIndicator.getOpaque()).toBe(0);
        statusIndicator.setOpaque(10);
        expect(statusIndicator.getOpaque()).toBe(10);
    });
});
