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
// Port of org/agrona/concurrent/status/AtomicCountersTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import type { AtomicBuffer } from '../../../../src/agrona/concurrent/AtomicBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';

describe('AtomicCountersTest', () => {
    it('testPlain', () => {
        const buffer: AtomicBuffer = new UnsafeBuffer(new ArrayBuffer(8));
        const counter = new AtomicCounter(buffer, 0);

        expect(counter.getPlain()).toBe(0);

        expect(counter.incrementPlain()).toBe(0);
        expect(counter.getPlain()).toBe(1);

        counter.setPlain(42);
        expect(counter.getPlain()).toBe(42);

        expect(counter.decrementPlain()).toBe(42);
        expect(counter.getPlain()).toBe(41);

        expect(counter.getAndAddPlain(10)).toBe(41);
        expect(counter.getPlain()).toBe(51);
    });

    it('testVolatile', () => {
        const buffer: AtomicBuffer = new UnsafeBuffer(new ArrayBuffer(8));
        const counter = new AtomicCounter(buffer, 0);

        expect(counter.get()).toBe(0);

        expect(counter.increment()).toBe(0);
        expect(counter.get()).toBe(1);

        counter.set(42);
        expect(counter.get()).toBe(42);

        expect(counter.decrement()).toBe(42);
        expect(counter.get()).toBe(41);

        expect(counter.getAndAdd(10)).toBe(41);
        expect(counter.get()).toBe(51);
    });

    it('testOpaque', () => {
        const buffer: AtomicBuffer = new UnsafeBuffer(new ArrayBuffer(8));
        const counter = new AtomicCounter(buffer, 0);

        expect(counter.getOpaque()).toBe(0);

        expect(counter.incrementOpaque()).toBe(0);
        expect(counter.getOpaque()).toBe(1);

        counter.setOpaque(42);
        expect(counter.getOpaque()).toBe(42);

        expect(counter.decrementOpaque()).toBe(42);
        expect(counter.getOpaque()).toBe(41);

        expect(counter.getAndAddOpaque(10)).toBe(41);
        expect(counter.getOpaque()).toBe(51);
    });

    it('testReleaseAcquire', () => {
        const buffer: AtomicBuffer = new UnsafeBuffer(new ArrayBuffer(8));
        const counter = new AtomicCounter(buffer, 0);

        expect(counter.getAcquire()).toBe(0);

        expect(counter.incrementRelease()).toBe(0);
        expect(counter.getAcquire()).toBe(1);

        counter.setRelease(42);
        expect(counter.getAcquire()).toBe(42);

        expect(counter.decrementRelease()).toBe(42);
        expect(counter.getAcquire()).toBe(41);

        expect(counter.getAndAddRelease(10)).toBe(41);
        expect(counter.getAcquire()).toBe(51);
    });
});
