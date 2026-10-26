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
// Port of io/aeron/driver/ext/FixedLossGeneratorTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { FixedLossGenerator } from '../../../src/driver/ext/FixedLossGenerator.js';

describe('FixedLossGeneratorTest', () => {
    it('shouldDropSingleFrameOnce', () => {
        const fixedLossGenerator = new FixedLossGenerator(0, 0, 1408);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(false);
    });

    it('shouldDropFirstTwoFramesOnceUnaligned', () => {
        const fixedLossGenerator = new FixedLossGenerator(0, 50, 1408);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 2 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 1408, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 2 * 1408, 1408)).toBe(false);
    });

    it('shouldDropForIndependentStreams', () => {
        const fixedLossGenerator = new FixedLossGenerator(0, 50, 1408);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 2 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 457, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 457, 0, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 457, 0, 2 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 456, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 456, 0, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 456, 0, 2 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 457, 0, 0, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 457, 0, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 124, 457, 0, 2 * 1408, 1408)).toBe(false);
    });

    it('shouldOnlyDropInMatchingFrames', () => {
        const fixedLossGenerator = new FixedLossGenerator(1, 2000, 1408);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 0, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 1408, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 2 * 1408, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 0, 3 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 1, 0, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 1, 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 1, 2 * 1408, 1408)).toBe(true);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 1, 3 * 1408, 1408)).toBe(false);

        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 2, 0, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 2, 1408, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 2, 2 * 1408, 1408)).toBe(false);
        expect(fixedLossGenerator.shouldDropFrame(null, null, 123, 456, 2, 3 * 1408, 1408)).toBe(false);
    });
});
