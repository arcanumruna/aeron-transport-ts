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
// Port of org/agrona/collections/MutableIntegerTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { MutableInteger } from '../../../src/agrona/collections/MutableInteger.js';
import { Integer } from '../../../src/agrona/jdk.js';

describe('MutableIntegerTest', () => {
    it.each([Integer.MIN_VALUE, -1, 0, 1, Integer.MAX_VALUE])('shouldSetAndGet %i', (value) => {
        const mutableInteger = new MutableInteger();
        expect(mutableInteger.setAndGet(value)).toBe(value);
    });
});
