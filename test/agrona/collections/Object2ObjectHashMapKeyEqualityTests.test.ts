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
