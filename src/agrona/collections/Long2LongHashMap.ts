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
// Port of org/agrona/collections/Int2IntHashMap.java @ Agrona 2.6.1, as generated for long in Agrona's build
// (Long2LongHashMap.java): `int` keys and values are `long`, which are `number` (spec D5).
import { BitUtil } from '../BitUtil.js';
import { IllegalArgumentException, IllegalStateException, Long } from '../jdk.js';
import {
    AbstractCollection,
    AbstractSet,
    isEntry,
    isMap,
    longHashCode,
    NoSuchElementException,
    requireNonNull,
    type Entry,
    type JIterator,
    type JMap,
} from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';
import type { LongLongConsumer } from './LongLongConsumer.js';
import type { LongLongFunction } from './LongLongFunction.js';
import type { LongLongPredicate } from './LongLongPredicate.js';

/** Marks an omitted optional argument, so that `remove` and `replace` need no `...rest` array per call. */
const NO_ARG = Symbol('NO_ARG');

/**
 * A open addressing with linear probing hash map specialised for primitive key and value pairs.
 * <p>
 * A `long` is a `number` in +/-(2^53 - 1) (spec D5): a key, a value or a missing value outside that range that is put
 * in the map throws `RangeError`. The nested classes `KeySet`, `ValueCollection`, `EntrySet`, `KeyIterator`,
 * `ValueIterator`, `EntryIterator` and `MapEntry` are `Long2LongHashMapKeySet` and so on.
 * <p>
 * The boxed methods of `java.util.Map` whose result differs from the primitive one (`get(Object)`, `put(Long, Long)`,
 * `putIfAbsent`, `replace(Long, Long)`, `remove(Object)`, which return null where the primitive ones return the
 * missing value) are not ported; `containsKey`, `containsValue`, `forEach`, `replaceAll`, `putAll` and
 * `remove(Object, Object)` are the same methods as the primitive ones.
 */
export class Long2LongHashMap {
    static readonly MIN_CAPACITY = 8;

    private readonly loadFactorValue: number;
    private readonly missingValueValue: number;
    private resizeThresholdValue = 0;
    /** @internal accessed by the nested classes, which are in this file */
    public _size = 0;
    /** @internal */
    public readonly _shouldAvoidAllocation: boolean;

    /** @internal the keys at the even indexes, the values at the odd ones */
    public _entries: Float64Array = new Float64Array(0);

    private keySetValue: Long2LongHashMapKeySet | null = null;
    private valuesValue: Long2LongHashMapValueCollection | null = null;
    private entrySetValue: Long2LongHashMapEntrySet | null = null;

    /**
     * Construct a new map allowing a configuration for initial capacity and load factor, or copy-construct a new map
     * from an existing one.
     * <p>
     * One argument is the missing value (or the map to copy) with the default capacity and load factor.
     *
     * @param initialCapacity       for the backing array, or the missing value, or the map to copy.
     * @param loadFactor            limit for resizing on puts, a float.
     * @param missingValue          value to be used as a null maker in the map.
     * @param shouldAvoidAllocation should allocation be avoided by caching iterators and map entries.
     */
    public constructor(
        initialCapacity: number | Long2LongHashMap,
        loadFactor?: number,
        missingValue?: number,
        shouldAvoidAllocation: boolean = true,
    ) {
        if (typeof initialCapacity === 'object') {
            const mapToCopy = initialCapacity;
            this.loadFactorValue = mapToCopy.loadFactorValue;
            this.resizeThresholdValue = mapToCopy.resizeThresholdValue;
            this._size = mapToCopy._size;
            this._shouldAvoidAllocation = mapToCopy._shouldAvoidAllocation;
            this.missingValueValue = mapToCopy.missingValueValue;

            this._entries = mapToCopy._entries.slice();
        } else {
            let capacity = initialCapacity;
            if (undefined === loadFactor) {
                missingValue = initialCapacity;
                capacity = Long2LongHashMap.MIN_CAPACITY;
                loadFactor = Hashing.DEFAULT_LOAD_FACTOR;
            }

            loadFactor = Math.fround(loadFactor);
            CollectionUtil.validateLoadFactor(loadFactor);

            this.loadFactorValue = loadFactor;
            this.missingValueValue = Long.checkSafe(missingValue!) + 0; // + 0: -0 is stored as 0
            this._shouldAvoidAllocation = shouldAvoidAllocation;

            this.setCapacity(BitUtil.findNextPositivePowerOfTwo(Math.max(Long2LongHashMap.MIN_CAPACITY, capacity)));
        }
    }

    /**
     * The value to be used as a null marker in the map.
     *
     * @returns value to be used as a null marker in the map.
     */
    public missingValue(): number {
        return this.missingValueValue;
    }

    /**
     * Get the load factor beyond which the map will increase size.
     *
     * @returns load factor for when the map should increase size.
     */
    public loadFactor(): number {
        return this.loadFactorValue;
    }

    /**
     * Get the total capacity for the map to which the load factor will be a fraction of.
     *
     * @returns the total capacity for the map.
     */
    public capacity(): number {
        return this._entries.length >> 1;
    }

    /**
     * Get the actual threshold which when reached the map will resize.
     * This is a function of the current capacity and load factor.
     *
     * @returns the threshold when the map will resize.
     */
    public resizeThreshold(): number {
        return this.resizeThresholdValue;
    }

    /**
     * {@inheritDoc}
     */
    public size(): number {
        return this._size;
    }

    /**
     * {@inheritDoc}
     */
    public isEmpty(): boolean {
        return 0 === this._size;
    }

    /**
     * Get the value for a key, or the default value if the key is not in the map.
     *
     * @param key          lookup key.
     * @param defaultValue to be returned if there is no value for the key.
     * @returns the value if found otherwise the default value.
     */
    public getOrDefault(key: number, defaultValue: number): number {
        const value = this.get(key);

        return this.missingValueValue !== value ? value : defaultValue;
    }

    /**
     * Get the value for a key.
     *
     * @param key lookup key.
     * @returns the value if found otherwise the missing value.
     */
    public get(key: number): number {
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let value: number;
        while (missingValue !== (value = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        return value;
    }

    /**
     * Put a key value pair into the map.
     *
     * @param key   lookup key
     * @param value new value, must not be the missing value
     * @returns previous value if found otherwise the missing value
     * @throws IllegalArgumentException if value is missingValue
     */
    public put(key: number, value: number): number {
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0
        value = Long.checkSafe(value) + 0;
        const missingValue = this.missingValueValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        if (missingValue === oldValue) {
            ++this._size;
            entries[index] = key;
        }

        entries[index + 1] = value;

        this.increaseCapacity();

        return oldValue;
    }

    /**
     * Put a key value pair into the map if the key has no value.
     *
     * @param key   lookup key
     * @param value new value, must not be the missing value
     * @returns previous value if found otherwise the missing value
     * @throws IllegalArgumentException if value is missingValue
     */
    public putIfAbsent(key: number, value: number): number {
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0
        value = Long.checkSafe(value) + 0;
        const missingValue = this.missingValueValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[index + 1]!)) {
            if (key === entries[index]) {
                return oldValue;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        ++this._size;
        entries[index] = key;
        entries[index + 1] = value;

        this.increaseCapacity();

        return oldValue;
    }

    private increaseCapacity(): void {
        if (this._size > this.resizeThresholdValue) {
            // entries.length = 2 * capacity
            const newCapacity = this._entries.length;
            this.rehash(newCapacity);
        }
    }

    private rehash(newCapacity: number): void {
        const missingValue = this.missingValueValue;
        const oldEntries = this._entries;
        const length = oldEntries.length;

        this.setCapacity(newCapacity);

        const newEntries = this._entries;
        const mask = newEntries.length - 1;

        for (let valueIndex = 1; valueIndex < length; valueIndex += 2) {
            const value = oldEntries[valueIndex]!;
            if (missingValue !== value) {
                const key = oldEntries[valueIndex - 1]!;
                let newKeyIndex = Hashing.evenHashLong(key, mask);
                while (missingValue !== newEntries[newKeyIndex + 1]) {
                    newKeyIndex = Long2LongHashMap.next(newKeyIndex, mask);
                }

                newEntries[newKeyIndex] = key;
                newEntries[newKeyIndex + 1] = value;
            }
        }
    }

    /**
     * Primitive specialised forEach implementation.
     * <p>
     * NB: Renamed from forEach to avoid overloading on parameter types of lambda expression, which doesn't play well
     * with type inference in lambda expressions.
     *
     * @param consumer a callback called for each key/value pair in the map.
     * @deprecated Use {@link forEachLong}.
     */
    public longForEach(consumer: LongLongConsumer): void {
        this.forEachLong(consumer);
    }

    /**
     * Primitive specialised forEach implementation.
     * <p>
     * NB: Renamed from forEach to avoid overloading on parameter types of lambda expression, which doesn't play well
     * with type inference in lambda expressions.
     *
     * @param consumer a callback called for each key/value pair in the map.
     */
    public forEachLong(consumer: LongLongConsumer): void {
        requireNonNull(consumer);

        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const length = entries.length;

        for (let valueIndex = 1, remaining = this._size; remaining > 0 && valueIndex < length; valueIndex += 2) {
            if (missingValue !== entries[valueIndex]) {
                consumer(entries[valueIndex - 1]!, entries[valueIndex]!);
                --remaining;
            }
        }
    }

    /**
     * Long primitive specialised containsKey: the `containsKey(Object)` and `containsKey(long)` of Java.
     *
     * @param key the key to check.
     * @returns true if the map contains key as a key, false otherwise.
     */
    public containsKey(key: number): boolean {
        return this.missingValueValue !== this.get(key);
    }

    /**
     * Does the map contain the value: the `containsValue(Object)` and `containsValue(long)` of Java.
     *
     * @param value to be checked.
     * @returns true if the map contains value as a value, false otherwise.
     */
    public containsValue(value: number): boolean {
        let found = false;
        const missingValue = this.missingValueValue;
        if (missingValue !== value) {
            const entries = this._entries;
            const length = entries.length;
            let remaining = this._size;

            for (let valueIndex = 1; remaining > 0 && valueIndex < length; valueIndex += 2) {
                const existingValue = entries[valueIndex]!;
                if (missingValue !== existingValue) {
                    if (existingValue === value) {
                        found = true;
                        break;
                    }
                    --remaining;
                }
            }
        }

        return found;
    }

    /**
     * {@inheritDoc}
     */
    public clear(): void {
        if (this._size > 0) {
            this._entries.fill(this.missingValueValue);
            this._size = 0;
        }
    }

    /**
     * Compact the backing arrays by rehashing with a capacity just larger than current size
     * and giving consideration to the load factor.
     */
    public compact(): void {
        const idealCapacity = Math.round(this.size() * (1.0 / this.loadFactorValue));
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(Long2LongHashMap.MIN_CAPACITY, idealCapacity)));
    }

    /**
     * Primitive specialised version of {@link Map#computeIfAbsent(Object, Function)}.
     *
     * @param key             to search on.
     * @param mappingFunction to provide a value if the get returns missingValue.
     * @returns the value if found otherwise the missing value.
     */
    public computeIfAbsent(key: number, mappingFunction: (key: number) => number): number {
        requireNonNull(mappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let value: number;
        while (missingValue !== (value = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        if (missingValue === value && missingValue !== (value = Long.checkSafe(mappingFunction(key)) + 0)) {
            entries[index] = key;
            entries[index + 1] = value;
            ++this._size;
            this.increaseCapacity();
        }

        return value;
    }

    /**
     * Primitive specialised version of {@link Map#computeIfPresent(Object, BiFunction)}.
     *
     * @param key               to search on.
     * @param remappingFunction to compute a value if a value is found.
     * @returns the updated value if found otherwise the missing value.
     */
    public computeIfPresent(key: number, remappingFunction: (key: number, value: number) => number): number {
        requireNonNull(remappingFunction);
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let value: number;
        while (missingValue !== (value = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        if (missingValue !== value) {
            value = Long.checkSafe(remappingFunction(key, value)) + 0;
            entries[index + 1] = value;
            if (missingValue === value) {
                this._size--;
                this.compactChain(index);
            }
        }

        return value;
    }

    /**
     * Primitive specialised version of {@link Map#compute(Object, BiFunction)}.
     *
     * @param key               to search on.
     * @param remappingFunction to compute a value.
     * @returns the updated value if found otherwise the missing value.
     */
    public compute(key: number, remappingFunction: (key: number, value: number) => number): number {
        requireNonNull(remappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        const newValue = Long.checkSafe(remappingFunction(key, oldValue)) + 0;
        if (missingValue !== newValue) {
            entries[index + 1] = newValue;
            if (oldValue === missingValue) {
                entries[index] = key;
                ++this._size;
                this.increaseCapacity();
            }
        } else if (missingValue !== oldValue) {
            entries[index + 1] = missingValue;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    // ---------------- Boxed Versions Below ----------------

    /**
     * {@inheritDoc}
     */
    public forEach(action: LongLongConsumer): void {
        this.forEachLong(action);
    }

    /**
     * Put all of the entries of another map into this one: the `putAll(Map)` and `putAll(Long2LongHashMap)` of Java.
     *
     * @param map to copy the entries from.
     */
    public putAll(map: Long2LongHashMap | JMap<number, number>): void {
        if (map instanceof Long2LongHashMap) {
            const it = map.entrySet().iterator();

            while (it.hasNext()) {
                it.findNext();
                this.put(it.getLongKey(), it.getLongValue());
            }
        } else {
            const it = map.entrySet().iterator();
            while (it.hasNext()) {
                const entry = it.next();
                this.put(entry.getKey(), entry.getValue());
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public replaceAll(function_: LongLongFunction): void {
        this.replaceAllLong(function_);
    }

    /**
     * {@inheritDoc}
     */
    public keySet(): Long2LongHashMapKeySet {
        if (null === this.keySetValue) {
            this.keySetValue = new Long2LongHashMapKeySet(this);
        }

        return this.keySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public values(): Long2LongHashMapValueCollection {
        if (null === this.valuesValue) {
            this.valuesValue = new Long2LongHashMapValueCollection(this);
        }

        return this.valuesValue;
    }

    /**
     * {@inheritDoc}
     * <p>
     * This set's iterator also implements `Map.Entry` so the key and value can be retrieved by from the iterator.
     */
    public entrySet(): Long2LongHashMapEntrySet {
        if (null === this.entrySetValue) {
            this.entrySetValue = new Long2LongHashMapEntrySet(this);
        }

        return this.entrySetValue;
    }

    /**
     * Remove a key from the map and return its value, or remove a key only if it is mapped to a value: the
     * `remove(long)` and `remove(long, long)` of Java, whose boxed overloads are the same methods.
     *
     * @param key   to be removed.
     * @param value expected to be associated with the key.
     * @returns the previous value if found otherwise the missing value, or true if the pair was removed.
     */
    public remove(key: number): number;
    public remove(key: number, value: number): boolean;
    public remove(key: number, value: number | typeof NO_ARG = NO_ARG): number | boolean {
        return NO_ARG === value ? this.removeKey(key) : this.removeKeyValue(key, value);
    }

    private removeKey(key: number): number {
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[keyIndex + 1]!)) {
            if (key === entries[keyIndex]) {
                entries[keyIndex + 1] = missingValue;
                this._size--;

                this.compactChain(keyIndex);
                break;
            }

            keyIndex = Long2LongHashMap.next(keyIndex, mask);
        }

        return oldValue;
    }

    private removeKeyValue(key: number, value: number): boolean {
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[keyIndex + 1]!)) {
            if (key === entries[keyIndex]) {
                if (value === oldValue) {
                    entries[keyIndex + 1] = missingValue;
                    this._size--;

                    this.compactChain(keyIndex);
                    return true;
                }
                break;
            }

            keyIndex = Long2LongHashMap.next(keyIndex, mask);
        }

        return false;
    }

    /**
     * Primitive specialised version of {@link Map#merge(Object, Object, BiFunction)}.
     *
     * @param key               to search on.
     * @param value             to merge with the existing value.
     * @param remappingFunction to compute a value when a mapping already exists.
     * @returns the new value, or the missing value if the mapping was removed.
     */
    public merge(key: number, value: number, remappingFunction: LongLongFunction): number {
        requireNonNull(remappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0
        value = Long.checkSafe(value) + 0;
        const missingValue = this.missingValueValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const entries = this._entries;
        const mask = entries.length - 1;
        let index = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[index + 1]!)) {
            if (key === entries[index]) {
                break;
            }

            index = Long2LongHashMap.next(index, mask);
        }

        const newValue = missingValue === oldValue ? value : Long.checkSafe(remappingFunction(oldValue, value)) + 0;
        if (missingValue !== newValue) {
            entries[index + 1] = newValue;
            if (missingValue === oldValue) {
                entries[index] = key;
                ++this._size;
                this.increaseCapacity();
            }
        } else {
            entries[index + 1] = missingValue;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    /** @internal accessed by the nested classes */
    public compactChain(deleteKeyIndex: number): void {
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = deleteKeyIndex;

        for (;;) {
            keyIndex = Long2LongHashMap.next(keyIndex, mask);
            const value = entries[keyIndex + 1]!;
            if (missingValue === value) {
                break;
            }

            const key = entries[keyIndex]!;
            const hash = Hashing.evenHashLong(key, mask);

            if (
                (keyIndex < hash && (hash <= deleteKeyIndex || deleteKeyIndex <= keyIndex)) ||
                (hash <= deleteKeyIndex && deleteKeyIndex <= keyIndex)
            ) {
                entries[deleteKeyIndex] = key;
                entries[deleteKeyIndex + 1] = value;

                entries[keyIndex + 1] = missingValue;
                deleteKeyIndex = keyIndex;
            }
        }
    }

    /**
     * Get the minimum value stored in the map. If the map is empty then it will return {@link missingValue}.
     *
     * @returns the minimum value stored in the map.
     */
    public minValue(): number {
        const missingValue = this.missingValueValue;
        let min = 0 === this._size ? missingValue : Long.MAX_VALUE;

        const entries = this._entries;
        const length = entries.length;

        for (let valueIndex = 1; valueIndex < length; valueIndex += 2) {
            const value = entries[valueIndex]!;
            if (missingValue !== value) {
                min = Math.min(min, value);
            }
        }

        return min;
    }

    /**
     * Get the maximum value stored in the map. If the map is empty then it will return {@link missingValue}.
     *
     * @returns the maximum value stored in the map.
     */
    public maxValue(): number {
        const missingValue = this.missingValueValue;
        let max = 0 === this._size ? missingValue : Long.MIN_VALUE;

        const entries = this._entries;
        const length = entries.length;

        for (let valueIndex = 1; valueIndex < length; valueIndex += 2) {
            const value = entries[valueIndex]!;
            if (missingValue !== value) {
                max = Math.max(max, value);
            }
        }

        return max;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        if (this.isEmpty()) {
            return '{}';
        }

        const entryIterator = new Long2LongHashMapEntryIterator(this);
        entryIterator.reset();

        let sb = '{';
        for (;;) {
            entryIterator.next();
            sb += entryIterator.getLongKey() + '=' + entryIterator.getLongValue();
            if (!entryIterator.hasNext()) {
                return sb + '}';
            }
            sb += ', ';
        }
    }

    /**
     * Primitive specialised version of {@link Map#replace(Object, Object)}.
     *
     * @param key   key with which the specified value is associated.
     * @param value value to be associated with the specified key.
     * @returns the previous value associated with the specified key, or the missing value if there was no mapping.
     */
    public replace(key: number, value: number): number;
    /**
     * Primitive specialised version of {@link Map#replace(Object, Object, Object)}.
     *
     * @param key      key with which the specified value is associated.
     * @param oldValue value expected to be associated with the specified key.
     * @param newValue value to be associated with the specified key.
     * @returns true if the value was replaced.
     */
    public replace(key: number, oldValue: number, newValue: number): boolean;
    public replace(key: number, valueOrOld: number, newValue: number | typeof NO_ARG = NO_ARG): number | boolean {
        return NO_ARG === newValue ? this.replaceValue(key, valueOrOld) : this.replaceOldNew(key, valueOrOld, newValue);
    }

    private replaceValue(key: number, value: number): number {
        value = Long.checkSafe(value) + 0; // + 0: -0 is stored as 0
        const missingValue = this.missingValueValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHashLong(key, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = entries[keyIndex + 1]!)) {
            if (key === entries[keyIndex]) {
                entries[keyIndex + 1] = value;
                break;
            }

            keyIndex = Long2LongHashMap.next(keyIndex, mask);
        }

        return oldValue;
    }

    private replaceOldNew(key: number, oldValue: number, newValue: number): boolean {
        newValue = Long.checkSafe(newValue) + 0; // + 0: -0 is stored as 0
        const missingValue = this.missingValueValue;
        if (missingValue === newValue) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHashLong(key, mask);

        let value: number;
        while (missingValue !== (value = entries[keyIndex + 1]!)) {
            if (key === entries[keyIndex]) {
                if (oldValue === value) {
                    entries[keyIndex + 1] = newValue;
                    return true;
                }
                break;
            }

            keyIndex = Long2LongHashMap.next(keyIndex, mask);
        }

        return false;
    }

    /**
     * Primitive specialised version of {@link Map#replaceAll(BiFunction)}.
     *
     * @param function_ computes a replacement for each value.
     * @throws IllegalArgumentException if the function returns the missing value.
     */
    public replaceAllLong(function_: LongLongFunction): void {
        requireNonNull(function_);
        const missingValue = this.missingValueValue;
        const entries = this._entries;
        const length = entries.length;

        for (let valueIndex = 1, remaining = this._size; remaining > 0 && valueIndex < length; valueIndex += 2) {
            const existingValue = entries[valueIndex]!;
            if (missingValue !== existingValue) {
                const newValue = Long.checkSafe(function_(entries[valueIndex - 1]!, existingValue)) + 0;
                if (missingValue === newValue) {
                    throw new IllegalArgumentException('cannot replace with a missingValue');
                }

                entries[valueIndex] = newValue;
                --remaining;
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (!isMap(o)) {
            return false;
        }

        const that = o as JMap<number, number>;

        return this._size === that.size() && this.entrySet().equals(that.entrySet());
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return this.entrySet().hashCode();
    }

    private static next(index: number, mask: number): number {
        return (index + 2) & mask;
    }

    private setCapacity(newCapacity: number): void {
        const entriesLength = newCapacity * 2;
        if (entriesLength > 0x7fffffff) {
            throw new IllegalStateException('max capacity reached at size=' + this._size);
        }

        this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(newCapacity) * this.loadFactorValue));
        this._entries = new Float64Array(entriesLength).fill(this.missingValueValue);
    }
}

/**
 * Base class for the iterators.
 */
abstract class AbstractIterator<T> implements JIterator<T> {
    /** @internal */
    public isPositionValid = false;
    private remainingValue = 0;
    private positionCounter = 0;
    private stopCounter = 0;

    protected readonly map: Long2LongHashMap;

    protected constructor(map: Long2LongHashMap) {
        this.map = map;
    }

    /** @internal package-private in Java */
    public reset(): void {
        this.isPositionValid = false;
        this.remainingValue = this.map._size;
        const missingValue = this.map.missingValue();
        const entries = this.map._entries;
        const capacity = entries.length;
        let keyIndex = capacity;

        if (missingValue !== entries[capacity - 1]) {
            for (let i = 1; i < capacity; i += 2) {
                if (missingValue === entries[i]) {
                    keyIndex = i - 1;
                    break;
                }
            }
        }

        this.stopCounter = keyIndex;
        this.positionCounter = keyIndex + capacity;
    }

    /** @internal protected in Java */
    public keyPosition(): number {
        return this.positionCounter & (this.map._entries.length - 1);
    }

    public remaining(): number {
        return this.remainingValue;
    }

    public hasNext(): boolean {
        return this.remainingValue > 0;
    }

    /** @internal protected in Java */
    public findNext(): void {
        if (!this.hasNext()) {
            throw new NoSuchElementException();
        }

        const entries = this.map._entries;
        const missingValue = this.map.missingValue();
        const mask = entries.length - 1;

        for (let keyIndex = this.positionCounter - 2, stop = this.stopCounter; keyIndex >= stop; keyIndex -= 2) {
            const index = keyIndex & mask;
            if (missingValue !== entries[index + 1]) {
                this.isPositionValid = true;
                this.positionCounter = keyIndex;
                --this.remainingValue;
                return;
            }
        }

        this.isPositionValid = false;
        throw new IllegalStateException();
    }

    public abstract next(): T;

    public remove(): void {
        if (this.isPositionValid) {
            const position = this.keyPosition();
            this.map._entries[position + 1] = this.map.missingValue();
            --this.map._size;

            this.map.compactChain(position);

            this.isPositionValid = false;
        } else {
            throw new IllegalStateException();
        }
    }
}

/**
 * Iterator over keys which supports access to unboxed keys via {@link nextValue}.
 */
export class Long2LongHashMapKeyIterator extends AbstractIterator<number> {
    public constructor(map: Long2LongHashMap) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): number {
        return this.nextValue();
    }

    /**
     * Return next key without boxing.
     *
     * @returns next key.
     */
    public nextValue(): number {
        this.findNext();

        return this.map._entries[this.keyPosition()]!;
    }
}

/**
 * Iterator over values which supports access to unboxed values via {@link nextValue}.
 */
export class Long2LongHashMapValueIterator extends AbstractIterator<number> {
    public constructor(map: Long2LongHashMap) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): number {
        return this.nextValue();
    }

    /**
     * Return next value without boxing.
     *
     * @returns next value.
     */
    public nextValue(): number {
        this.findNext();

        return this.map._entries[this.keyPosition() + 1]!;
    }
}

/**
 * Iterator over entries which supports access to unboxed keys and values.
 */
export class Long2LongHashMapEntryIterator
    extends AbstractIterator<Entry<number, number>>
    implements Entry<number, number>
{
    public constructor(map: Long2LongHashMap) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public getKey(): number {
        return this.getLongKey();
    }

    public getLongKey(): number {
        return this.map._entries[this.keyPosition()]!;
    }

    /**
     * {@inheritDoc}
     */
    public getValue(): number {
        return this.getLongValue();
    }

    public getLongValue(): number {
        return this.map._entries[this.keyPosition() + 1]!;
    }

    /**
     * Set the value of the entry, which is the `setValue(Long)` and `setValue(long)` of Java.
     *
     * @param value to be set.
     * @returns the previous value.
     */
    public setValue(value: number): number {
        value = Long.checkSafe(value) + 0; // + 0: -0 is stored as 0
        if (!this.isPositionValid) {
            throw new IllegalStateException();
        }

        if (this.map.missingValue() === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keyPosition = this.keyPosition();
        const entries = this.map._entries;
        const prevValue = entries[keyPosition + 1]!;
        entries[keyPosition + 1] = value;

        return prevValue;
    }

    /**
     * {@inheritDoc}
     */
    public next(): Entry<number, number> {
        this.findNext();

        if (this.map._shouldAvoidAllocation) {
            return this;
        }

        return this.allocateDuplicateEntry();
    }

    /** @internal private in Java, used by the entry set, which is a nested class of the same outer class */
    public allocateDuplicateEntry(): Entry<number, number> {
        return new Long2LongHashMapMapEntry(this.map, this.getLongKey(), this.getLongValue());
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return longHashCode(this.getLongKey()) ^ longHashCode(this.getLongValue());
    }

    /**
     * {@inheritDoc}
     */
    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (!isEntry(o)) {
            return false;
        }

        const that = o;

        return this.getKey() === that.getKey() && this.getValue() === that.getValue();
    }
}

/**
 * An entry that is not the iterator: a copy of the key and the value.
 */
export class Long2LongHashMapMapEntry implements Entry<number, number> {
    private readonly map: Long2LongHashMap;
    private readonly k: number;
    private readonly v: number;

    public constructor(map: Long2LongHashMap, k: number, v: number) {
        this.map = map;
        this.k = k;
        this.v = v;
    }

    /**
     * {@inheritDoc}
     */
    public getKey(): number {
        return this.k;
    }

    /**
     * {@inheritDoc}
     */
    public getValue(): number {
        return this.v;
    }

    /**
     * {@inheritDoc}
     */
    public setValue(value: number): number {
        return this.map.put(this.k, value);
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return longHashCode(this.k) ^ longHashCode(this.v);
    }

    /**
     * {@inheritDoc}
     */
    public equals(o: unknown): boolean {
        if (!isEntry(o)) {
            return false;
        }

        const e = o;

        return e.getKey() !== null && e.getValue() !== null && e.getKey() === this.k && e.getValue() === this.v;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return this.k + '=' + this.v;
    }
}

/**
 * A key set implementation which supports cached iterators to avoid allocation.
 */
export class Long2LongHashMapKeySet extends AbstractSet<number> {
    private readonly map: Long2LongHashMap;
    private readonly keyIterator: Long2LongHashMapKeyIterator | null;

    public constructor(map: Long2LongHashMap) {
        super();
        this.map = map;
        this.keyIterator = map._shouldAvoidAllocation ? new Long2LongHashMapKeyIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2LongHashMapKeyIterator {
        let keyIterator = this.keyIterator;
        if (null === keyIterator) {
            keyIterator = new Long2LongHashMapKeyIterator(this.map);
        }

        keyIterator.reset();

        return keyIterator;
    }

    /**
     * {@inheritDoc}
     */
    public size(): number {
        return this.map.size();
    }

    /**
     * {@inheritDoc}
     */
    public override isEmpty(): boolean {
        return this.map.isEmpty();
    }

    /**
     * {@inheritDoc}
     */
    public override clear(): void {
        this.map.clear();
    }

    /**
     * Checks if the key is contained in the map: the `contains(Object)` and `contains(long)` of Java.
     *
     * @param o the key to check.
     * @returns true if the key is in the map.
     */
    public override contains(o: unknown): boolean {
        return this.map.containsKey(o as number);
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLong(filter: (key: number) => boolean): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            if (filter(iterator.nextValue())) {
                iterator.remove();
                removed = true;
            }
        }

        return removed;
    }
}

/**
 * A collection implementation which supports cached iterators to avoid allocation.
 */
export class Long2LongHashMapValueCollection extends AbstractCollection<number> {
    private readonly map: Long2LongHashMap;
    private readonly valueIterator: Long2LongHashMapValueIterator | null;

    public constructor(map: Long2LongHashMap) {
        super();
        this.map = map;
        this.valueIterator = map._shouldAvoidAllocation ? new Long2LongHashMapValueIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2LongHashMapValueIterator {
        let valueIterator = this.valueIterator;
        if (null === valueIterator) {
            valueIterator = new Long2LongHashMapValueIterator(this.map);
        }

        valueIterator.reset();

        return valueIterator;
    }

    /**
     * {@inheritDoc}
     */
    public size(): number {
        return this.map.size();
    }

    /**
     * Checks if the value is contained in the map: the `contains(Object)` and `contains(long)` of Java.
     *
     * @param o the value to check.
     * @returns true if the value is in the map.
     */
    public override contains(o: unknown): boolean {
        return this.map.containsValue(o as number);
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLong(filter: (value: number) => boolean): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            if (filter(iterator.nextValue())) {
                iterator.remove();
                removed = true;
            }
        }

        return removed;
    }
}

/**
 * An entry set implementation which supports cached iterators to avoid allocation.
 */
export class Long2LongHashMapEntrySet extends AbstractSet<Entry<number, number>> {
    private readonly map: Long2LongHashMap;
    private readonly entryIterator: Long2LongHashMapEntryIterator | null;

    public constructor(map: Long2LongHashMap) {
        super();
        this.map = map;
        this.entryIterator = map._shouldAvoidAllocation ? new Long2LongHashMapEntryIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2LongHashMapEntryIterator {
        let entryIterator = this.entryIterator;
        if (null === entryIterator) {
            entryIterator = new Long2LongHashMapEntryIterator(this.map);
        }

        entryIterator.reset();

        return entryIterator;
    }

    /**
     * {@inheritDoc}
     */
    public size(): number {
        return this.map.size();
    }

    /**
     * {@inheritDoc}
     */
    public override isEmpty(): boolean {
        return this.map.isEmpty();
    }

    /**
     * {@inheritDoc}
     */
    public override clear(): void {
        this.map.clear();
    }

    /**
     * {@inheritDoc}
     */
    public override contains(o: unknown): boolean {
        if (!isEntry(o)) {
            return false;
        }

        const key = o.getKey();
        if ('number' !== typeof key) {
            return false;
        }

        const value = this.map.get(key);

        return value !== this.map.missingValue() && value === o.getValue();
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLong(filter: LongLongPredicate): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            iterator.findNext();
            if (filter(iterator.getLongKey(), iterator.getLongValue())) {
                iterator.remove();
                removed = true;
            }
        }

        return removed;
    }

    /**
     * {@inheritDoc}
     */
    public override toArray(): unknown[];
    public override toArray<A>(a: A[]): A[];
    public override toArray<A>(a?: A[]): unknown[] | A[] {
        const size = this.map._size;
        const array: unknown[] =
            undefined !== a && a.length >= size ? a : (new Array<unknown>(size).fill(null) as unknown[]);

        const it = this.iterator();
        for (let i = 0; i < array.length; i++) {
            if (it.hasNext()) {
                it.next();
                array[i] = it.allocateDuplicateEntry();
            } else {
                array[i] = null;
                break;
            }
        }

        return array as A[];
    }
}
