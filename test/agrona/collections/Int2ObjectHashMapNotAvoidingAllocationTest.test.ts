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
