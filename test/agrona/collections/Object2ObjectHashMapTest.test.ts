// Port of org/agrona/collections/Object2ObjectHashMapTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { Object2ObjectHashMap } from '../../../src/agrona/collections/Object2ObjectHashMap.js';
import { hashCodeOf, objectsEquals, type Entry } from '../../../src/agrona/jdkUtil.js';
import { assertEqualsObject } from '../../support/Assertions.js';

describe('Object2ObjectHashMapTest', () => {
    it('testToArray', () => {
        const cut = new Object2ObjectHashMap<string, string>();
        cut.put('a', 'valA');
        cut.put('b', 'valA');
        cut.put('c', 'valA');

        const array = cut.entrySet().toArray();
        for (const entry of array) {
            cut.remove((entry as Entry<unknown, unknown>).getKey());
        }

        expect(cut.isEmpty()).toBe(true);
    });

    it('testToArrayTyped', () => {
        const map = new Object2ObjectHashMap<string, string>();
        map.put('a', 'valA');
        map.put('b', 'valA');
        map.put('c', 'valA');

        const type: Entry<unknown, unknown>[] = new Array<Entry<unknown, unknown>>(1);
        const array = map.entrySet().toArray(type);
        for (const entry of array) {
            map.remove(entry.getKey());
        }

        expect(map.isEmpty()).toBe(true);
    });

    it('testToArrayWithArrayListConstructor', () => {
        const map = new Object2ObjectHashMap<string, string>();
        map.put('a', 'valA');
        map.put('b', 'valA');
        map.put('c', 'valA');

        // new ArrayList<>(collection) copies collection.toArray()
        const list = map.entrySet().toArray() as Entry<string, string>[];
        for (const entry of list) {
            map.remove(entry.getKey());
        }

        expect(map.isEmpty()).toBe(true);
    });

    /** `new HashSet<>(entries)`: the entries without the ones that equal an earlier one. */
    function hashSetOf<T>(entries: T[]): T[] {
        const set: T[] = [];
        for (const e of entries) {
            if (!set.some((s) => hashCodeOf(s) === hashCodeOf(e) && objectsEquals(s, e))) {
                set.push(e);
            }
        }
        return set;
    }

    it('shouldForEachEntries', () => {
        class TestEntry {
            public readonly key: string;
            public readonly value: string;

            public constructor(key: string, value: string) {
                this.key = key;
                this.value = value;
            }

            public equals(o: unknown): boolean {
                if (this === o) {
                    return true;
                }

                if (o === null || this.constructor !== (o as object).constructor) {
                    return false;
                }

                const entry = o as TestEntry;
                return objectsEquals(this.key, entry.key) && objectsEquals(this.value, entry.value);
            }

            public hashCode(): number {
                // Objects.hash(key, value)
                return (31 * (31 * 1 + hashCodeOf(this.key)) + hashCodeOf(this.value)) | 0;
            }

            public toString(): string {
                return "Entry{key='" + this.key + "', value='" + this.value + "'}";
            }
        }

        const map = new Object2ObjectHashMap<string, string>();

        for (let i = 0; i < 11; i++) {
            const val = i.toString();
            const key = 'key-' + val;
            const value = 'value-' + val;

            map.put(key, value);
        }

        const copyOne: TestEntry[] = [];
        for (const entry of map.entrySet()) {
            copyOne.push(new TestEntry(entry.getKey(), entry.getValue()!));
        }

        const copyTwo: TestEntry[] = [];
        map.forEach((key, value) => copyTwo.push(new TestEntry(key, value)));

        // assertEquals(HashSet, HashSet): the same size, and each entry of one in the other
        const setOne = hashSetOf(copyOne);
        const setTwo = hashSetOf(copyTwo);
        expect(setOne.length).toBe(11);
        expect(setTwo.length).toBe(setOne.length);
        expect(setOne.every((e) => setTwo.some((s) => s.equals(e)))).toBe(true);
    });

    it('shouldForEachValues', () => {
        const map = new Object2ObjectHashMap<string, string>();
        for (let i = 0; i < 11; i++) {
            const val = i.toString();
            map.put('key-' + val, 'value-' + val);
        }

        const copyOne = new Set<string | null>();
        for (const s of map.values()) {
            copyOne.add(s);
        }

        const copyTwo = new Set<string | null>();
        map.values().forEach((v) => copyTwo.add(v));

        expect(copyOne).toEqual(copyTwo);
    });

    it('shouldForEachKeys', () => {
        const map = new Object2ObjectHashMap<string, string>();
        for (let i = 0; i < 11; i++) {
            const val = i.toString();
            map.put('key-' + val, 'value-' + val);
        }

        const copyOne = new Set<string>();
        for (const s of map.keySet()) {
            copyOne.add(s);
        }

        const copyTwo = new Set<string>();
        map.keySet().forEach((k) => copyTwo.add(k));

        expect(copyOne).toEqual(copyTwo);
    });

    it('shouldCopyConstructAndBeEqual', () => {
        const testEntries = [3, 1, 19, 7, 11, 12, 7];

        const map = new Object2ObjectHashMap<string, number>();
        for (const testEntry of testEntries) {
            map.put(String(testEntry), testEntry);
        }

        const mapCopy = new Object2ObjectHashMap<string, number>(map);
        assertEqualsObject(map, mapCopy);
    });
});
