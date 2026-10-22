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
// Port of org/agrona/collections/ArrayUtilTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { ArrayUtil } from '../../../src/agrona/collections/ArrayUtil.js';

describe('ArrayUtilTest', () => {
    // Reference Equality
    const ONE = 1;
    const TWO = 2;
    const THREE = 3;

    const values = [ONE, TWO];

    it('shouldNotRemoveMissingElement', () => {
        const result = ArrayUtil.remove(values, THREE);

        expect(result).toEqual(values);
    });

    it('shouldRemovePresentElementAtEnd', () => {
        const result = ArrayUtil.remove(values, TWO);

        expect(result).toEqual([ONE]);
    });

    it('shouldRemovePresentElementAtStart', () => {
        const result = ArrayUtil.remove(values, ONE);

        expect(result).toEqual([TWO]);
    });

    it('shouldRemoveByIndex', () => {
        const result = ArrayUtil.removeAt(values, 0);

        expect(result).toEqual([TWO]);
    });
});
