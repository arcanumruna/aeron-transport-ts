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
// Port of org/agrona/SemanticVersionTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { SemanticVersion } from '../../src/agrona/SemanticVersion.js';
import { IllegalArgumentException } from '../../src/agrona/jdk.js';
import { assertThrows } from '../support/Assertions.js';

describe('SemanticVersionTest', () => {
    it('shouldComposeValidVersion', () => {
        const major = 17;
        const minor = 9;
        const patch = 127;

        const version = SemanticVersion.compose(major, minor, patch);

        expect(SemanticVersion.major(version)).toBe(major);
        expect(SemanticVersion.minor(version)).toBe(minor);
        expect(SemanticVersion.patch(version)).toBe(patch);
    });

    it('shouldDetectNegativeMajor', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(-1, 1, 1));
    });

    it('shouldDetectNegativeMinor', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(1, -1, 1));
    });

    it('shouldDetectNegativePatch', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(1, 1, -1));
    });

    it('shouldDetectZeroVersion', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(0, 0, 0));
    });

    it('shouldDetectExcessiveMajor', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(256, 1, 1));
    });

    it('shouldDetectExcessiveMinor', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(1, 256, 1));
    });

    it('shouldDetectExcessivePatch', () => {
        assertThrows(IllegalArgumentException, () => SemanticVersion.compose(1, 1, 256));
    });

    it('shouldConvertToString', () => {
        const major = 17;
        const minor = 9;
        const patch = 127;

        const version = SemanticVersion.compose(major, minor, patch);

        expect(SemanticVersion.toString(version)).toBe('17.9.127');
    });
});
