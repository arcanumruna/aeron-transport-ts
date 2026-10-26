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
// Port of io/aeron/driver/ext/MultiGapLossGeneratorTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { MultiGapLossGenerator } from '../../../src/driver/ext/MultiGapLossGenerator.js';

describe('MultiGapLossGeneratorTest', () => {
    it('singleSmallGap', () => {
        const generator = new MultiGapLossGenerator(0, 8, 4, 1);

        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 0, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 8, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 16, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 24, 8)).toBe(false);

        expect(generator.shouldDropFrame(null, null, 124, 456, 0, 0, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 124, 456, 0, 8, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 124, 456, 0, 16, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 124, 456, 0, 24, 8)).toBe(false);
    });

    it('singleSmallGapRX', () => {
        const generator = new MultiGapLossGenerator(0, 8, 4, 1);

        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 0, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 8, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 16, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 8, 8)).toBe(false);
    });

    it('multiSmallGap', () => {
        const generator = new MultiGapLossGenerator(0, 16, 8, 4);

        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 0, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 8, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 16, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 24, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 32, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 40, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 48, 4)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 52, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 60, 2)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 123, 456, 0, 62, 10)).toBe(true);
    });
});
