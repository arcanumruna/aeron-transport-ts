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
// Port of org/agrona/collections/MapKeyEqualityTests.java @ Agrona 2.6.1
import { beforeEach, expect, it } from 'vitest';
import type { Object2ObjectHashMap } from '../../../src/agrona/collections/Object2ObjectHashMap.js';
import { hashCodeOf, isEntry, objectsEquals, type Entry } from '../../../src/agrona/jdkUtil.js';
import { assertEqualsObject, assertNotEqualsObject } from '../../support/Assertions.js';
import { CharSequenceKey } from './CharSequenceKey.js';

export const THIS = new CharSequenceKey('this');

/**
 * `java.util.AbstractMap.SimpleImmutableEntry`.
 */
export class SimpleImmutableEntry<K, V> implements Entry<K, V> {
    private readonly key: K;
    private readonly value: V;

    public constructor(key: K, value: V) {
        this.key = key;
        this.value = value;
    }

    public getKey(): K {
        return this.key;
    }

    public getValue(): V {
        return this.value;
    }

    public setValue(_value: V): V {
        throw new Error('UnsupportedOperationException');
    }

    public hashCode(): number {
        return hashCodeOf(this.key) ^ hashCodeOf(this.value);
    }

    public equals(o: unknown): boolean {
        return isEntry(o) && objectsEquals(this.key, o.getKey()) && objectsEquals(this.value, o.getValue());
    }
}

/** `lookupKeys()`: the key, and the value it finds (null for none). */
export function lookupKeys(): [unknown, number | null][] {
    return [
        ['one', 1],
        [new CharSequenceKey('two'), 2],
        [THIS, 3],
        [new CharSequenceKey('vier'), null],
        ['五', 5],
    ];
}

/** `insertKeys()`: the key, the value it replaces (null for none) and the new value. */
export function insertKeys(): [unknown, number | null, number][] {
    return [
        ['one', 1, 1_000],
        [new CharSequenceKey('two'), 2, 2147483647],
        [THIS, 3, -33],
        ['vier', null, 4],
        [new CharSequenceKey('new'), null, 0],
    ];
}

/**
 * Base class containing a common set of tests for the maps that compare their keys with `equals`.
 *
 * @param newMap  the abstract `newMap()`.
 * @param convert the abstract `convert(Integer)`.
 * @param options `skipEntrySetContains` leaves out the inherited `entrySetContains` for a subclass that overrides it.
 * @returns the accessor of the `map` field.
 */
export function mapKeyEqualityTests<T extends number>(
    newMap: () => Object2ObjectHashMap<unknown, T>,
    convert: (value: number | null) => T | null,
    options: { skipEntrySetContains?: boolean } = {},
): () => Object2ObjectHashMap<unknown, T> {
    let map: Object2ObjectHashMap<unknown, T>;

    beforeEach(() => {
        map = newMap();
        map.put(new CharSequenceKey('one'), convert(1));
        map.put(new CharSequenceKey('two'), convert(2));
        map.put(THIS, convert(3));
        map.put(new CharSequenceKey('four'), convert(4));
        map.put(new CharSequenceKey('五'), convert(5));
    });

    it.each(insertKeys())('put [%#]', (key, oldValue, newValue) => {
        expect(map.put(key, convert(newValue))).toBe(convert(oldValue));
        expect(map.get(key)).toBe(convert(newValue));
    });

    it.each(lookupKeys())('get [%#]', (key, rawValue) => {
        expect(map.get(key)).toBe(convert(rawValue));
    });

    it.each(lookupKeys())('remove [%#]', (key, rawValue) => {
        expect(map.remove(key)).toBe(convert(rawValue));
    });

    it.each(lookupKeys())('containsKey [%#]', (key, rawValue) => {
        if (null === rawValue) {
            expect(map.containsKey(key)).toBe(false);
            expect(map.keySet().contains(key)).toBe(false);
        } else {
            expect(map.containsKey(key)).toBe(true);
            expect(map.keySet().contains(key)).toBe(true);
        }
    });

    if (options.skipEntrySetContains !== true) {
        it('entrySetContains', () => {
            const entrySet = map.entrySet();
            const entries = entrySet.toArray() as Entry<unknown, T>[];
            for (const e of entries) {
                expect(entrySet.contains(e)).toBe(true);
            }
        });
    }

    it('entryEqualAndHashCode', () => {
        for (const e of map.entrySet()) {
            const entry = e as Entry<unknown, T> & { hashCode(): number; equals(o: unknown): boolean };
            expect(entry.hashCode()).toBe(hashCodeOf(e.getKey()) ^ hashCodeOf(e.getValue()));
            assertEqualsObject(e, e);
            assertEqualsObject(e, new SimpleImmutableEntry(e.getKey(), e.getValue()));
            assertNotEqualsObject(e, new SimpleImmutableEntry(null, e.getValue()));
            assertNotEqualsObject(e, new SimpleImmutableEntry(e.getKey(), null));
        }
    });

    it('entrySetValue', () => {
        for (const e of map.entrySet()) {
            const value = e.getValue();
            expect(value).not.toBeNull();
            const newValue = convert(value! * 2);
            const oldValue = e.setValue(newValue);
            expect(oldValue).toBe(value);
            expect(e.getValue()).toBe(newValue);
            expect(map.get(e.getKey())).toBe(newValue);
        }
    });

    it('clonedEntryEqualAndHashCode', () => {
        const entries = map.entrySet().toArray() as (Entry<unknown, T> & {
            hashCode(): number;
        })[];
        for (const e of entries) {
            expect(e.hashCode()).toBe(hashCodeOf(e.getKey()) ^ hashCodeOf(e.getValue()));
            assertEqualsObject(e, e);
            assertEqualsObject(e, new SimpleImmutableEntry(e.getKey(), e.getValue()));
            assertNotEqualsObject(e, new SimpleImmutableEntry(null, e.getValue()));
            assertNotEqualsObject(e, new SimpleImmutableEntry(e.getKey(), null));
            assertNotEqualsObject(e, new SimpleImmutableEntry(null, null));
        }
    });

    it('clonedEntrySetValue', () => {
        const entries = map.entrySet().toArray() as Entry<unknown, T | null>[];
        for (const e of entries) {
            const value = e.getValue();
            expect(value).not.toBeNull();
            const newValue = convert(value! * 2);
            const oldValue = e.setValue(newValue);
            expect(oldValue).toBe(value);
            expect(e.getValue()).toBe(newValue);
            expect(map.get(e.getKey())).toBe(newValue);
        }
    });

    return () => map;
}
