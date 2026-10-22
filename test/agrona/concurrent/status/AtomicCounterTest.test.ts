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
// Port of org/agrona/concurrent/status/AtomicCounterTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import type { AtomicBuffer } from '../../../../src/agrona/concurrent/AtomicBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteBuffer } from '../../../support/ByteBuffer.js';

const { COUNTER_LENGTH } = CountersReader;

function buffers(): AtomicBuffer[] {
    return [new UnsafeBuffer(ByteBuffer.allocateDirect(10 * COUNTER_LENGTH).arrayBuffer())];
}

describe('AtomicCounterTest', () => {
    it.each(buffers())('canWrapDifferentKindsOfBuffers', (buffer) => {
        const value = 42;
        const counterId = 5;
        const counter = new AtomicCounter(buffer, counterId);

        counter.set(value);
        counter.increment();
        expect(counter.get()).toBe(value + 1);
    });
});
