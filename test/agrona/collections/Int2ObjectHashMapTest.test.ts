// Port of org/agrona/collections/Int2ObjectHashMapTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { Hashing } from '../../../src/agrona/collections/Hashing.js';
import { Int2NullableObjectHashMap } from '../../../src/agrona/collections/Int2NullableObjectHashMap.js';
import {
    Int2ObjectHashMap,
    type Int2ObjectHashMapKeyIterator,
} from '../../../src/agrona/collections/Int2ObjectHashMap.js';
import type { IntObjectToObjectFunction } from '../../../src/agrona/collections/IntObjectToObjectFunction.js';
import type { IntObjPredicate } from '../../../src/agrona/collections/IntObjPredicate.js';
import { NullPointerException } from '../../../src/agrona/jdk.js';
import type { Entry } from '../../../src/agrona/jdkUtil.js';
import { assertIs, assertThrowsExactly } from '../../support/Assertions.js';
import { CharSequenceKey, type CharSequence } from './CharSequenceKey.js';

/**
 * The tests of Java's `Int2ObjectHashMapTest`, which `Int2ObjectHashMapNotAvoidingAllocationTest` inherits.
 *
 * @param newMap the overridable `newMap(loadFactor, initialCapacity)` of the Java class.
 * @returns the accessor of the `map` field that the subclass tests use.
 */
export function int2ObjectHashMapTest(
    newMap: (loadFactor: number, initialCapacity: number) => Int2ObjectHashMap<string>,
): () => Int2ObjectHashMap<string> {
    let map: Int2ObjectHashMap<string>;

    beforeEach(() => {
        map = newMap(Hashing.DEFAULT_LOAD_FACTOR, Int2ObjectHashMap.MIN_CAPACITY);
    });

    it('shouldDoPutAndThenGet', () => {
        const value = 'Seven';
        map.put(7, value);

        expect(map.get(7)).toBe(value);
    });

    it('shouldReplaceExistingValueForTheSameKey', () => {
        const key = 7;
        const value = 'Seven';
        map.put(key, value);

        const newValue = 'New Seven';
        const oldValue = map.put(key, newValue);

        expect(map.get(key)).toBe(newValue);
        expect(oldValue).toBe(value);
        expect(map.size()).toBe(1);
    });

    it('shouldGrowWhenThresholdExceeded', () => {
        const loadFactor = 0.5;
        const initialCapacity = 32;
        const map = newMap(loadFactor, initialCapacity);
        for (let i = 0; i < 16; i++) {
            map.put(i, i.toString());
        }

        expect(map.resizeThreshold()).toBe(16);
        expect(map.capacity()).toBe(initialCapacity);
        expect(map.size()).toBe(16);

        map.put(16, '16');

        expect(map.resizeThreshold()).toBe(initialCapacity);
        expect(map.capacity()).toBe(64);
        expect(map.size()).toBe(17);

        expect(map.get(16)).toBe('16');
        expect(map.loadFactor()).toBe(loadFactor);
    });

    it('shouldHandleCollisionAndThenLinearProbe', () => {
        const loadFactor = 0.5;
        const initialCapacity = 32;
        const map = newMap(loadFactor, initialCapacity);
        const key = 7;
        const value = 'Seven';
        map.put(key, value);

        const collisionKey = key + map.capacity();
        const collisionValue = collisionKey.toString();
        map.put(collisionKey, collisionValue);

        expect(map.get(key)).toBe(value);
        expect(map.get(collisionKey)).toBe(collisionValue);
        expect(map.loadFactor()).toBe(loadFactor);
    });

    it('shouldClearCollection', () => {
        for (let i = 0; i < 15; i++) {
            map.put(i, i.toString());
        }

        expect(map.size()).toBe(15);
        expect(map.get(1)).toBe('1');

        map.clear();

        expect(map.size()).toBe(0);
        expect(map.get(1)).toBeNull();
    });

    it('shouldCompactCollection', () => {
        const totalItems = 50;
        for (let i = 0; i < totalItems; i++) {
            map.put(i, i.toString());
        }

        for (let i = 0, limit = totalItems - 4; i < limit; i++) {
            map.remove(i);
        }

        const capacityBeforeCompaction = map.capacity();
        map.compact();

        expect(map.capacity()).toBeLessThan(capacityBeforeCompaction);
    });

    it('shouldCompute', () => {
        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(map.get(testKey)).toBeNull();
        expect(map.size()).toBe(0);

        expect(map.compute(testKey, () => testValue)).toBe(testValue);
        expect(map.get(testKey)).toBe(testValue);
        expect(map.size()).toBe(1);

        expect(map.compute(testKey, () => testValue2)).toBe(testValue2);
        expect(map.get(testKey)).toBe(testValue2);
        expect(map.size()).toBe(1);
    });

    it('shouldComputeBoxed', () => {
        const intToObjectMap: Int2ObjectHashMap<string> = map;

        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(intToObjectMap.compute(testKey, () => testValue)).toBe(testValue);
        expect(intToObjectMap.get(testKey)).toBe(testValue);
        expect(map.size()).toBe(1);

        expect(intToObjectMap.compute(testKey, () => testValue2)).toBe(testValue2);
        expect(intToObjectMap.get(testKey)).toBe(testValue2);
        expect(map.size()).toBe(1);
    });

    it('computeShouldRemoveExistingMappingIfValueIsNull', () => {
        const key = 5;
        const value = 'five';
        map.put(key, value);

        expect(map.compute(key, () => null)).toBeNull();

        expect(map.size()).toBe(0);
    });

    it('computeIsANoOpIfKeyIsUnknownAndValueIsNull', () => {
        map.put(42, '42');

        expect(map.compute(5, () => null)).toBeNull();

        expect(map.size()).toBe(1);
        expect(map.get(42)).toBe('42');
    });

    it('shouldComputeIfAbsent', () => {
        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(map.get(testKey)).toBeNull();

        expect(map.computeIfAbsent(testKey, () => testValue)).toBe(testValue);
        expect(map.get(testKey)).toBe(testValue);

        expect(map.computeIfAbsent(testKey, () => testValue2)).toBe(testValue);
        expect(map.get(testKey)).toBe(testValue);
    });

    it('shouldComputeIfAbsentBoxed', () => {
        const intToObjectMap: Int2ObjectHashMap<string> = map;

        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(intToObjectMap.computeIfAbsent(testKey, () => testValue)).toBe(testValue);
        expect(intToObjectMap.get(testKey)).toBe(testValue);

        expect(intToObjectMap.computeIfAbsent(testKey, () => testValue2)).toBe(testValue);
        expect(intToObjectMap.get(testKey)).toBe(testValue);
    });

    it('shouldComputeIfPresent', () => {
        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(map.computeIfPresent(testKey, () => testValue)).toBeNull();
        expect(map.get(testKey)).toBeNull();

        map.put(testKey, testValue);
        expect(map.computeIfPresent(testKey, () => testValue2)).toBe(testValue2);
        expect(map.get(testKey)).toBe(testValue2);
    });

    it('computeIfPresentShouldDeleteExistingEntryIfFunctionReturnsNull', () => {
        map.put(1, 'one');
        const key = 3;
        const value = 'three';
        map.put(key, value);
        const fn: IntObjectToObjectFunction<string, string | null> = (k, v) => {
            expect(k).toBe(key);
            expect(v).toBe(value);
            return null;
        };

        expect(map.computeIfPresent(key, fn)).toBeNull();

        expect(map.size()).toBe(1);
        expect(map.get(1)).toBe('one');
        expect(map.containsKey(key)).toBe(false);
        expect(map.containsValue(value)).toBe(false);
    });

    it('shouldComputeIfPresentBoxed', () => {
        const intToObjectMap: Int2ObjectHashMap<string> = map;

        const testKey = 7;
        const testValue = 'Seven';
        const testValue2 = '7';

        expect(intToObjectMap.computeIfPresent(testKey, () => testValue)).toBeNull();
        expect(intToObjectMap.get(testKey)).toBeNull();

        intToObjectMap.put(testKey, testValue);
        expect(intToObjectMap.computeIfPresent(testKey, () => testValue2)).toBe(testValue2);
        expect(intToObjectMap.get(testKey)).toBe(testValue2);
    });

    it('shouldContainValue', () => {
        const key = 7;
        const value = 'Seven';

        map.put(key, value);

        expect(map.containsValue(value)).toBe(true);
        expect(map.containsValue('NoKey')).toBe(false);
    });

    it('shouldContainKey', () => {
        const key = 7;
        const value = 'Seven';

        map.put(key, value);

        expect(map.containsKey(key)).toBe(true);
        expect(map.containsKey(0)).toBe(false);
    });

    it('shouldRemoveEntry', () => {
        const key = 7;
        const value = 'Seven';

        map.put(key, value);

        expect(map.containsKey(key)).toBe(true);

        map.remove(key);

        expect(map.containsKey(key)).toBe(false);
    });

    it('shouldRemoveEntryAndCompactCollisionChain', () => {
        const key = 12;
        const value = '12';

        map.put(key, value);
        map.put(13, '13');

        const collisionKey = key + map.capacity();
        const collisionValue = collisionKey.toString();

        map.put(collisionKey, collisionValue);
        map.put(14, '14');

        expect(map.remove(key)).toBe(value);
    });

    it('shouldIterateValues', () => {
        const initialSet: string[] = [];

        for (let i = 0; i < 11; i++) {
            const value = i.toString();
            map.put(i, value);
            initialSet.push(value);
        }

        const copyToSetOne: string[] = [];
        for (const s of map.values()) {
            copyToSetOne.push(s!);
        }

        const copyToSetTwo: string[] = [];
        for (const s of map.values()) {
            copyToSetTwo.push(s!);
        }

        expect(copyToSetOne.length).toBe(initialSet.length);
        expect(copyToSetOne.every((s) => initialSet.includes(s))).toBe(true);

        expect(copyToSetTwo.length).toBe(initialSet.length);
        expect(copyToSetTwo.every((s) => initialSet.includes(s))).toBe(true);
    });

    it('shouldForEachValues', () => {
        const expected = new Set<string>();
        for (let i = 0; i < 11; i++) {
            const value = i.toString();
            map.put(i, value);
            expected.add(value);
        }

        const copySet = new Set<string>();
        map.values().forEach((v) => copySet.add(v!));

        expect(copySet).toEqual(expected);
    });

    it('shouldIterateKeysGettingIntAsPrimitive', () => {
        const initialSet = new Set<number>();

        for (let i = 0; i < 11; i++) {
            const value = i.toString();
            map.put(i, value);
            initialSet.add(i);
        }

        const copyToSet = new Set<number>();

        for (const iter: Int2ObjectHashMapKeyIterator<string> = map.keySet().iterator(); iter.hasNext();) {
            copyToSet.add(iter.nextInt());
        }

        expect(copyToSet).toEqual(initialSet);
    });

    it('shouldIterateKeys', () => {
        const initialSet = new Set<number>();

        for (let i = 0; i < 11; i++) {
            const value = i.toString();
            map.put(i, value);
            initialSet.add(i);
        }

        assertIterateKeys(initialSet);
        assertIterateKeys(initialSet);
        assertIterateKeys(initialSet);
    });

    function assertIterateKeys(initialSet: Set<number>): void {
        const copyToSet = new Set<number>();
        for (const aInteger of map.keySet()) {
            copyToSet.add(aInteger);
        }

        expect(copyToSet).toEqual(initialSet);
    }

    it('shouldIterateAndHandleRemove', () => {
        const initialSet = new Set<number>();

        const count = 11;
        for (let i = 0; i < count; i++) {
            const value = i.toString();
            map.put(i, value);
            initialSet.add(i);
        }

        const copyOfSet = new Set<number>();

        let i = 0;
        for (const iter = map.keySet().iterator(); iter.hasNext();) {
            const item = iter.next();
            if (i++ === 7) {
                iter.remove();
            } else {
                copyOfSet.add(item);
            }
        }

        const reducedSetSize = count - 1;
        expect(initialSet.size).toBe(count);
        expect(map.size()).toBe(reducedSetSize);
        expect(copyOfSet.size).toBe(reducedSetSize);
    });

    it('shouldIterateEntries', () => {
        const count = 11;
        for (let i = 0; i < count; i++) {
            const value = i.toString();
            map.put(i, value);
        }

        iterateEntries();
        iterateEntries();
        iterateEntries();

        const testValue = 'Wibble';
        for (const entry of map.entrySet()) {
            expect(String(entry.getKey())).toBe(entry.getValue());

            if (entry.getKey() === 7) {
                entry.setValue(testValue);
            }
        }

        expect(map.get(7)).toBe(testValue);
    });

    function iterateEntries(): void {
        for (const entry of map.entrySet()) {
            expect(String(entry.getKey())).toBe(entry.getValue());
        }
    }

    it('shouldIterateForEach', () => {
        const count = 11;
        for (let i = 0; i < count; i++) {
            const value = i.toString();
            map.put(i, value);
        }

        const copyToSet = new Set<number>();
        map.forEachInt((key, value) => {
            expect(value).toBe(String(key));

            // not copying values, because they match keys
            copyToSet.add(key);
        });
        // assertEquals(copyToSet, map.keySet()): the HashSet equals a Set of the same size that it contains all of
        expect(copyToSet.size).toBe(map.keySet().size());
        for (const key of map.keySet()) {
            expect(copyToSet.has(key)).toBe(true);
        }
    });

    it('shouldGenerateStringRepresentation', () => {
        const testEntries = [3, 1, 19, 7, 11, 12, 7];

        for (const testEntry of testEntries) {
            map.put(testEntry, String(testEntry));
        }

        const mapAsAString = '{19=19, 1=1, 11=11, 7=7, 3=3, 12=12}';
        expect(map.toString()).toBe(mapAsAString);
    });

    it('shouldCopyConstructAndBeEqual', () => {
        const testEntries = [3, 1, 19, 7, 11, 12, 7];

        for (const testEntry of testEntries) {
            map.put(testEntry, String(testEntry));
        }

        const mapCopy = new Int2ObjectHashMap<string>(map);
        assertIs(mapCopy, map);
    });

    it('shouldAllowNullValuesWithNullMapping', () => {
        class NullMappingMap extends Int2ObjectHashMap<string | null> {
            private readonly nullRef = {};

            protected override mapNullValue(value: unknown): unknown {
                return value === null ? this.nullRef : value;
            }

            protected override unmapNullValue(value: unknown): string | null {
                return value === this.nullRef ? null : (value as string);
            }
        }
        const map = new NullMappingMap();

        map.put(0, null);
        map.put(1, 'one');

        expect(map.get(0)).toBeNull();
        expect(map.get(1)).toBe('one');
        expect(map.get(-1)).toBeNull();

        expect(map.containsKey(0)).toBe(true);
        expect(map.containsKey(1)).toBe(true);
        expect(map.containsKey(-1)).toBe(false);

        // containsInAnyOrder
        const values: (string | null)[] = [];
        for (const v of map.values()) {
            values.push(v);
        }
        expect(values).toHaveLength(2);
        expect(values).toContain(null);
        expect(values).toContain('one');
        const keys: number[] = [];
        for (const k of map.keySet()) {
            keys.push(k);
        }
        expect(keys).toHaveLength(2);
        expect(keys).toContain(0);
        expect(keys).toContain(1);

        expect(map.size()).toBe(2);

        map.remove(0);

        expect(map.get(0)).toBeNull();
        expect(map.get(1)).toBe('one');
        expect(map.get(-1)).toBeNull();

        expect(map.containsKey(0)).toBe(false);
        expect(map.containsKey(1)).toBe(true);
        expect(map.containsKey(-1)).toBe(false);

        expect(map.size()).toBe(1);
    });

    it('shouldToArray', () => {
        const map = new Int2ObjectHashMap<string>();
        map.put(1, 'a');
        map.put(2, 'b');
        map.put(3, 'c');

        const array = map.entrySet().toArray();
        for (const entry of array) {
            map.remove((entry as Entry<number, string>).getKey());
        }

        expect(map.isEmpty()).toBe(true);
    });

    it('shouldToArrayTyped', () => {
        const map = new Int2ObjectHashMap<string>();
        map.put(1, 'a');
        map.put(2, 'b');
        map.put(3, 'c');

        const type: Entry<number, string | null>[] = new Array<Entry<number, string | null>>(1);
        const array = map.entrySet().toArray(type);
        for (const entry of array) {
            map.remove(entry.getKey());
        }

        expect(map.isEmpty()).toBe(true);
    });

    it('shouldToArrayWithArrayListConstructor', () => {
        const map = new Int2ObjectHashMap<string>();
        map.put(1, 'a');
        map.put(2, 'b');
        map.put(3, 'c');

        // new ArrayList<>(collection) copies collection.toArray()
        const list = map.entrySet().toArray() as Entry<number, string>[];
        for (const entry of list) {
            map.remove(entry.getKey());
        }

        expect(map.isEmpty()).toBe(true);
    });

    it('containsValueShouldPerformEqualityCheckBasedOnTheValueStoredInTheMap', () => {
        const map = new Int2ObjectHashMap<CharSequence>();
        map.put(11, new CharSequenceKey('abc'));
        const xyzKey = new CharSequenceKey('xyz');
        map.put(42, xyzKey);

        expect(map.containsValue('abc')).toBe(true);
        expect(map.containsValue(new CharSequenceKey('abc'))).toBe(true);
        expect(map.containsValue(xyzKey)).toBe(true);
        expect(map.containsValue(new CharSequenceKey('xyz'))).toBe(true);

        const values = map.values();
        expect(values.contains('abc')).toBe(true);
        expect(values.contains(new CharSequenceKey('abc'))).toBe(true);
        expect(values.contains(xyzKey)).toBe(true);

        expect(map.containsValue(null)).toBe(false);
        expect(map.containsValue('null')).toBe(false);
        expect(map.containsValue(new CharSequenceKey('test'))).toBe(false);
    });

    it('getOrDefaultShouldReturnDefaultValueIfNoMappingExistsForAGivenKey', () => {
        const key = 121;
        const defaultValue = 'fallback';

        expect(map.getOrDefault(key, defaultValue)).toBe(defaultValue);
    });

    it('getOrDefaultShouldReturnValueForAnExistingKey', () => {
        const key = 121;
        const value = 'found';
        const defaultValue = 'fallback';
        map.put(key, value);

        expect(map.getOrDefault(key, defaultValue)).toBe(value);
    });

    it('removeIsANoOpIfValueIsNull', () => {
        const key = 42;
        const value = 'nine';
        map.put(key, value);

        expect(map.remove(key, null)).toBe(false);

        expect(map.get(key)).toBe(value);
    });

    it('removeIsANoOpIfValueDoesNotMatch', () => {
        const key = 42;
        const value = 'nine';
        map.put(key, value);

        expect(map.remove(key, 'ten')).toBe(false);

        expect(map.get(key)).toBe(value);
    });

    it('removeShouldDeleteKeyMappingIfValueMatches', () => {
        const key = -100;
        const map = new Int2ObjectHashMap<CharSequence>();
        map.put(key, new CharSequenceKey('abc'));
        map.put(2, 'two');

        expect(map.remove(key, 'abc')).toBe(true);

        expect(map.size()).toBe(1);
        expect(map.get(2)).toBe('two');
    });

    it('replaceThrowsNullPointerExceptionIfValueIsNull', () => {
        const exception = assertThrowsExactly(NullPointerException, () => map.replace(42, null));
        expect(exception.message).toBe('value cannot be null');
    });

    it('replaceReturnsNullForAnUnknownKey', () => {
        map.put(1, 'one');

        expect(map.replace(2, 'three')).toBeNull();

        expect(map.get(1)).toBe('one');
    });

    it('replaceReturnsPreviousValueAfterSettingTheNewOne', () => {
        const key = 1;
        const oldValue = 'one';
        const newValue = 'three';
        map.put(key, oldValue);

        expect(map.replace(key, newValue)).toBe(oldValue);

        expect(map.get(key)).toBe(newValue);
    });

    it('replaceThrowsNullPointerExceptionIfNewValueIsNull', () => {
        const exception = assertThrowsExactly(NullPointerException, () => map.replace(42, 'abc', null));
        expect(exception.message).toBe('value cannot be null');
    });

    it('replaceReturnsFalseForAnUnknownKey', () => {
        map.put(1, 'one');

        expect(map.replace(2, 'a', 'b')).toBe(false);

        expect(map.get(1)).toBe('one');
    });

    it('replaceReturnsFalseIfTheOldValueDoesNotMatch', () => {
        const key = 1;
        const value = 'one';
        map.put(key, value);

        expect(map.replace(key, 'wrong!', 'new one')).toBe(false);

        expect(map.get(key)).toBe(value);
    });

    it('replaceReturnsTrueAfterUpdatingTheNewValue', () => {
        const map = new Int2ObjectHashMap<CharSequence>();
        const key = 1;
        const newValue = 'two';
        map.put(key, new CharSequenceKey('one'));

        expect(map.replace(key, 'one', newValue)).toBe(true);

        expect(map.get(key)).toBe(newValue);
    });

    it('replaceAllIntThrowsNullPointerExceptionIfTheNewValueIsNull', () => {
        const nullFunction: IntObjectToObjectFunction<string, string | null> = () => null;
        map.put(1, 'one');

        const exception = assertThrowsExactly(NullPointerException, () => map.replaceAllInt(nullFunction));
        expect(exception.message).toBe('value cannot be null');
    });

    it('replaceAllIntUpdatesEveryExistingValue', () => {
        const updateFunction: IntObjectToObjectFunction<string, string> = (key, value) => key + '_' + value;
        map.put(1, 'one');
        map.put(2, 'two');
        map.put(-100, 'null');

        map.replaceAllInt(updateFunction);

        expect(map.size()).toBe(3);
        expect(map.get(1)).toBe('1_one');
        expect(map.get(2)).toBe('2_two');
        expect(map.get(-100)).toBe('-100_null');
    });

    it.each(['', 'val 1', '你好'])('putIfAbsentShouldReturnAnExistingValueForAnExistingKey %j', (value) => {
        const key = 42;
        const newValue = ' this is something new';
        map.put(key, value);

        expect(map.putIfAbsent(key, newValue)).toBe(value);
    });

    it.each(['', 'val 1', '你好'])('putIfAbsentShouldReturnNullAfterPuttingANewValue %j', (newValue) => {
        const key = 42;
        map.put(3, 'three');

        expect(map.putIfAbsent(key, newValue)).toBeNull();

        expect(map.get(key)).toBe(newValue);
        expect(map.get(3)).toBe('three');
    });

    it('putIfAbsentThrowsNullPointerExceptionIfValueIsNull', () => {
        const exception = assertThrowsExactly(NullPointerException, () => map.putIfAbsent(42, null));
        expect(exception.message).toBe('value cannot be null');
    });

    it('putAllCopiesAllOfTheValuesFromTheSourceMap', () => {
        map.put(42, 'forty two');
        map.put(0, 'zero');
        const otherMap = new Int2ObjectHashMap<string>();
        otherMap.put(1, '1');
        otherMap.put(2, '2');
        otherMap.put(3, '3');
        otherMap.put(42, '42');

        map.putAll(otherMap);

        expect(map.size()).toBe(5);
        expect(map.get(0)).toBe('zero');
        expect(map.get(1)).toBe('1');
        expect(map.get(2)).toBe('2');
        expect(map.get(3)).toBe('3');
        expect(map.get(42)).toBe('42');
    });

    it('putAllThrowsNullPointerExceptionIfOtherMapContainsNull', () => {
        map.put(0, 'zero');
        const otherMap = new Int2NullableObjectHashMap<string>();
        otherMap.put(1, null);

        const exception = assertThrowsExactly(NullPointerException, () => map.putAll(otherMap));
        expect(exception.message).toBe('value cannot be null');
    });

    it('removeIfIntOnKeySet', () => {
        const filter = (key: number): boolean => (key & 1) === 0;
        map.put(1, 'one');
        map.put(2, 'two');
        map.put(3, 'three');

        expect(map.keySet().removeIfInt(filter)).toBe(true);

        expect(map.size()).toBe(2);
        expect(map.get(1)).toBe('one');
        expect(map.get(3)).toBe('three');

        expect(map.keySet().removeIfInt(filter)).toBe(false);
        expect(map.size()).toBe(2);
    });

    it('removeIfOnValuesCollection', () => {
        const filter = (value: string | null): boolean => value!.includes('e');
        map.put(1, 'one');
        map.put(2, 'two');
        map.put(3, 'three');

        expect(map.values().removeIf(filter)).toBe(true);

        expect(map.size()).toBe(1);
        expect(map.get(2)).toBe('two');

        expect(map.values().removeIf(filter)).toBe(false);
        expect(map.size()).toBe(1);
    });

    it('removeIfIntOnEntrySet', () => {
        const filter: IntObjPredicate<string> = (key, value) => (key & 1) === 0 && value.startsWith('t');
        map.put(1, 'one');
        map.put(2, 'two');
        map.put(3, 'three');
        map.put(4, 'four');

        expect(map.entrySet().removeIfInt(filter)).toBe(true);

        expect(map.size()).toBe(3);
        expect(map.get(1)).toBe('one');
        expect(map.get(3)).toBe('three');
        expect(map.get(4)).toBe('four');

        expect(map.entrySet().removeIfInt(filter)).toBe(false);
        expect(map.size()).toBe(3);
    });

    it('mergeShouldInsertNewMapping', () => {
        map.put(1, 'one');
        const key = 42;
        const value = 'forty two';

        expect(
            map.merge(key, value, () => {
                expect.fail('not expected');
            }),
        ).toBe(value);

        expect(map.size()).toBe(2);
        expect(map.get(1)).toBe('one');
        expect(map.get(key)).toBe(value);
    });

    it('mergeShouldUpdateExistingMapping', () => {
        const key = 42;
        const value = 'forty two';
        const expectedValue = value + '-' + 'eleven';
        map.put(key, value);

        expect(map.merge(key, 'eleven', () => expectedValue)).toBe(expectedValue);

        expect(map.size()).toBe(1);
        expect(map.get(key)).toBe(expectedValue);
    });

    it('mergeShouldDeleteExistingMapping', () => {
        const key = 42;
        const value = 'forty two';
        map.put(key, value);

        expect(map.merge(key, 'eleven', () => null)).toBeNull();

        expect(map.size()).toBe(0);
    });

    return () => map;
}

describe('Int2ObjectHashMapTest', () => {
    int2ObjectHashMapTest((loadFactor, initialCapacity) => new Int2ObjectHashMap<string>(initialCapacity, loadFactor));
});
