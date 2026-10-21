// Port of org/agrona/collections/Long2LongHashMapTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { Long2LongHashMap } from '../../../src/agrona/collections/Long2LongHashMap.js';
import type { LongLongPredicate } from '../../../src/agrona/collections/LongLongPredicate.js';

describe('Long2LongHashMapTest', () => {
    it('removeIfLongOnKeySet', () => {
        const map = new Long2LongHashMap(-1);
        const filter = (v: number): boolean => v < 3;
        map.put(1, 1);
        map.put(2, 2);
        map.put(3, 3);
        map.put(4, 4);

        expect(map.keySet().removeIfLong(filter)).toBe(true);

        expect(map.size()).toBe(2);
        expect(map.get(3)).toBe(3);
        expect(map.get(4)).toBe(4);

        expect(map.keySet().removeIfLong(filter)).toBe(false);
        expect(map.size()).toBe(2);
    });

    it('removeIfLongOnValuesCollection', () => {
        const map = new Long2LongHashMap(-1);
        const filter = (v: number): boolean => v >= 20;
        map.put(1, 10);
        map.put(2, 20);
        map.put(3, 30);
        map.put(4, 40);

        expect(map.values().removeIfLong(filter)).toBe(true);

        expect(map.size()).toBe(1);
        expect(map.get(1)).toBe(10);

        expect(map.values().removeIfLong(filter)).toBe(false);
        expect(map.size()).toBe(1);
    });

    it('removeIfLongOnEntrySet', () => {
        const map = new Long2LongHashMap(-1);
        const filter: LongLongPredicate = (k, v) => k >= 2 && v <= 30;
        map.put(1, 10);
        map.put(2, 20);
        map.put(3, 30);
        map.put(4, 40);

        expect(map.entrySet().removeIfLong(filter)).toBe(true);

        expect(map.size()).toBe(2);
        expect(map.get(1)).toBe(10);
        expect(map.get(4)).toBe(40);

        expect(map.entrySet().removeIfLong(filter)).toBe(false);
        expect(map.size()).toBe(2);
    });
});
