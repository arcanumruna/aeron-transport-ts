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
// Port of org/agrona/collections/Int2ObjectHashMapNotAvoidingAllocationTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { Int2ObjectHashMap } from '../../../src/agrona/collections/Int2ObjectHashMap.js';
import { assertNotEqualsObject } from '../../support/Assertions.js';
import { int2ObjectHashMapTest } from './Int2ObjectHashMapTestSuite.js';

describe('Int2ObjectHashMapNotAvoidingAllocationTest', () => {
    const map = int2ObjectHashMapTest(
        (loadFactor, initialCapacity) => new Int2ObjectHashMap<string>(initialCapacity, loadFactor, false),
    );

    it('valuesIteratorIsNotCached', () => {
        expect(map().values().iterator()).not.toBe(map().values().iterator());
    });

    it('keysIteratorIsNotCached', () => {
        expect(map().keySet().iterator()).not.toBe(map().keySet().iterator());
    });

    it('entryIteratorIsNotCached', () => {
        expect(map().entrySet().iterator()).not.toBe(map().entrySet().iterator());
    });

    it('entriesAreAllocatedByEntriesIterator', () => {
        map().put(1, '1');
        map().put(2, '2');

        const entryIterator = map().entrySet().iterator();
        const entry1 = entryIterator.next();
        const entry2 = entryIterator.next();

        assertNotEqualsObject(entry1, entry2);
    });
});
