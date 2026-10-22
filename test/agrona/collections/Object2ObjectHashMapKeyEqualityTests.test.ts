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
// Port of org/agrona/collections/Object2ObjectHashMapKeyEqualityTests.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { Object2ObjectHashMap } from '../../../src/agrona/collections/Object2ObjectHashMap.js';
import { hashCodeOf, type Entry } from '../../../src/agrona/jdkUtil.js';
import { assertEqualsObject } from '../../support/Assertions.js';
import { CharSequenceKey, type CharSequence } from './CharSequenceKey.js';
import { lookupKeys, mapKeyEqualityTests, SimpleImmutableEntry, THIS } from './MapKeyEqualityTests.js';

describe('Object2ObjectHashMapKeyEqualityTests', () => {
    mapKeyEqualityTests<number>(
        () => new Object2ObjectHashMap<unknown, number>(),
        (value) => value,
        { skipEntrySetContains: true }, // the own entrySetContains below overrides the inherited one
    );

    it.each(lookupKeys())('containsValue [%#]', (key, rawValue) => {
        const map = new Object2ObjectHashMap<CharSequence, CharSequenceKey>();
        map.put(new CharSequenceKey('one'), new CharSequenceKey('one'));
        map.put(new CharSequenceKey('two'), new CharSequenceKey('two'));
        map.put(THIS, THIS);
        map.put(new CharSequenceKey('four'), new CharSequenceKey('four'));
        map.put(new CharSequenceKey('五'), new CharSequenceKey('五'));

        const values = map.values();
        if (null === rawValue) {
            expect(map.containsValue(key)).toBe(false);
            expect(values.contains(key)).toBe(false);
        } else {
            expect(map.containsValue(key)).toBe(true);
            expect(values.contains(key)).toBe(true);
        }
    });

    // overrides the inherited test of the same name
    it('entrySetContains', () => {
        const map = new Object2ObjectHashMap<CharSequence, CharSequenceKey>();
        map.put(new CharSequenceKey('one'), new CharSequenceKey('one'));
        map.put(new CharSequenceKey('two'), new CharSequenceKey('two'));
        map.put(THIS, THIS);
        const entrySet = map.entrySet();
        const entries = entrySet.toArray() as Entry<CharSequence, CharSequenceKey>[];

        for (const e of entries) {
            expect(entrySet.contains(e)).toBe(true);
        }
    });

    it('entryEqualsAndHashCode', () => {
        const map = new Object2ObjectHashMap<CharSequence, CharSequenceKey>();
        map.put(new CharSequenceKey('one'), new CharSequenceKey('one'));
        map.put(THIS, THIS);

        for (const e of map.entrySet()) {
            expect((e as unknown as { hashCode(): number }).hashCode()).toBe(
                hashCodeOf(e.getKey()) ^ hashCodeOf(e.getValue()),
            );
            assertEqualsObject(e, e);
            assertEqualsObject(e, new SimpleImmutableEntry(e.getKey(), e.getValue()));
        }
    });

    it('clonedEntryEqualsAndHashCode', () => {
        const map = new Object2ObjectHashMap<CharSequence, CharSequenceKey>();
        map.put(new CharSequenceKey('one'), new CharSequenceKey('one'));
        map.put(THIS, THIS);

        const entries = map.entrySet().toArray() as (Entry<CharSequence, CharSequenceKey> & { hashCode(): number })[];
        for (const e of entries) {
            expect(e.hashCode()).toBe(hashCodeOf(e.getKey()) ^ hashCodeOf(e.getValue()));
            assertEqualsObject(e, e);
            assertEqualsObject(e, new SimpleImmutableEntry(e.getKey(), e.getValue()));
        }
    });
});
