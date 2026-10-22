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
// Port of org/agrona/collections/Long2ObjectHashMap.java @ Agrona 2.6.1, as generated for long in Agrona's build
// (Long2ObjectHashMap.java): `long` keys are `long` keys, which are `number` (spec D5).
import { BitUtil } from '../BitUtil.js';
import { IllegalStateException, Long } from '../jdk.js';
import {
    AbstractCollection,
    AbstractSet,
    hashCodeOf,
    instanceEquals,
    isEntry,
    isMap,
    longHashCode,
    NoSuchElementException,
    objectsEquals,
    requireNonNull,
    type Entry,
    type JIterator,
    type JMap,
} from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';
import type { LongObjConsumer } from './LongObjConsumer.js';
import type { LongObjectToObjectFunction } from './LongObjectToObjectFunction.js';
import type { LongObjPredicate } from './LongObjPredicate.js';

/**
 * A open addressing with linear probing hash map specialised for primitive key and object value pairs. If a value is
 * null then the map cannot be sure whether it is not there or just a null value, so the null value is not supported
 * (Agrona's Long2NullableObjectHashMap, which overrides `mapNullValue` and `unmapNullValue`, is not ported).
 * <p>
 * A `long` key is a `number` in +/-(2^53 - 1) (spec D5): a key outside that range that is put in the map throws
 * `RangeError`.
 * <p>
 * Java's `java.util.Map<Long, V>` is not a TypeScript type: the boxed overloads (`get(Object)`, `put(Long, V)`,
 * `computeIfAbsent(Long, Function)`, `forEach(BiConsumer)`, ...) are the same methods as the `long` ones, taking a
 * `number`. Only `forEach` / `replaceAll` keep both names (`forEachLong`, `replaceAllLong`). The nested classes
 * `KeySet`, `ValueCollection`, `EntrySet`, `KeyIterator`, `ValueIterator`, `EntryIterator` and `MapEntry` are
 * `Long2ObjectHashMapKeySet` and so on. A `for ... of` over a collection view uses its `iterator()`.
 *
 * @typeParam V - type of values stored in the {@link Map}.
 */
export class Long2ObjectHashMap<V> {
    static readonly MIN_CAPACITY = 8;

    private readonly loadFactorValue: number;
    private resizeThresholdValue: number;
    /** @internal accessed by the nested classes, which are in this file */
    public _size: number;
    /** @internal */
    public readonly _shouldAvoidAllocation: boolean;

    /** @internal */
    public _keys: Float64Array;
    /** @internal */
    public _values: unknown[];

    private valueCollection: Long2ObjectHashMapValueCollection<V> | null = null;
    private keySetValue: Long2ObjectHashMapKeySet<V> | null = null;
    private entrySetValue: Long2ObjectHashMapEntrySet<V> | null = null;

    /**
     * Construct a new map allowing a configuration for initial capacity and load factor, or copy-construct a new map
     * from an existing one.
     *
     * @param initialCapacity       for the backing array, or the map to copy.
     * @param loadFactor            limit for resizing on puts, a float.
     * @param shouldAvoidAllocation should allocation be avoided by caching iterators and map entries.
     */
    public constructor(
        initialCapacity: number | Long2ObjectHashMap<V> = Long2ObjectHashMap.MIN_CAPACITY,
        loadFactor: number = Hashing.DEFAULT_LOAD_FACTOR,
        shouldAvoidAllocation: boolean = true,
    ) {
        if (typeof initialCapacity === 'object') {
            const mapToCopy = initialCapacity;
            this.loadFactorValue = mapToCopy.loadFactorValue;
            this.resizeThresholdValue = mapToCopy.resizeThresholdValue;
            this._size = mapToCopy._size;
            this._shouldAvoidAllocation = mapToCopy._shouldAvoidAllocation;

            this._keys = mapToCopy._keys.slice();
            this._values = mapToCopy._values.slice();
        } else {
            loadFactor = Math.fround(loadFactor);
            CollectionUtil.validateLoadFactor(loadFactor);

            this.loadFactorValue = loadFactor;
            this._shouldAvoidAllocation = shouldAvoidAllocation;
            this._size = 0;

            const capacity = BitUtil.findNextPositivePowerOfTwo(
                Math.max(Long2ObjectHashMap.MIN_CAPACITY, initialCapacity),
            );
            this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(capacity) * loadFactor));
            this._keys = new Float64Array(capacity);
            this._values = new Array<unknown>(capacity).fill(null);
        }
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
        return this._values.length;
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
     * {@inheritDoc}
     */
    public forEach(action: LongObjConsumer<V>): void {
        this.forEachLong(action);
    }

    /**
     * Long primitive specialised forEach implementation.
     * <p>
     * NB: Renamed from forEach to avoid overloading on parameter types of lambda expression, which doesn't play well
     * with type inference in lambda expressions.
     *
     * @param consumer a callback called for each key/value pair in the map.
     * @deprecated Use {@link forEachLong}.
     */
    public longForEach(consumer: LongObjConsumer<V>): void {
        this.forEachLong(consumer);
    }

    /**
     * Long primitive specialised forEach implementation.
     * <p>
     * NB: Renamed from forEach to avoid overloading on parameter types of lambda expression, which doesn't play well
     * with type inference in lambda expressions.
     *
     * @param consumer a callback called for each key/value pair in the map.
     */
    public forEachLong(consumer: LongObjConsumer<V>): void {
        requireNonNull(consumer);

        const keys = this._keys;
        const values = this._values;
        const length = values.length;

        for (let index = 0, remaining = this._size; remaining > 0 && index < length; index++) {
            const value = values[index];
            if (null !== value) {
                consumer(keys[index]!, this.unmapNullValue(value) as V);
                --remaining;
            }
        }
    }

    /**
     * Check if the map contains a key: the `containsKey(Object)` and `containsKey(long)` of Java.
     *
     * @param key to check.
     * @returns true if the map contains the key.
     */
    public containsKey(key: number): boolean {
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let found = false;
        while (null !== values[index]) {
            if (key === keys[index]) {
                found = true;
                break;
            }

            index = (index + 1) & mask;
        }

        return found;
    }

    /**
     * {@inheritDoc}
     */
    public containsValue(value: unknown): boolean {
        let found = false;
        const val = this.mapNullValue(value);

        if (null !== val) {
            const values = this._values;
            const length = values.length;

            for (let i = 0, remaining = this._size; remaining > 0 && i < length; i++) {
                const existingValue = values[i];
                if (null !== existingValue) {
                    if (objectsEquals(existingValue, val)) {
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
     * Get a value for a given key, or null if there is no mapping for the key.
     *
     * @param key to get the value for.
     * @returns the value if found, null otherwise.
     */
    public get(key: number): V | null {
        return this.unmapNullValue(this.getMapped(key));
    }

    /**
     * Returns the value to which the specified key is mapped, or defaultValue if this map contains no mapping for
     * the key.
     *
     * @param key          whose associated value is to be returned.
     * @param defaultValue the default mapping of the key.
     * @returns the value to which the specified key is mapped, or defaultValue if this map contains no mapping for
     * the key.
     */
    public getOrDefault(key: number, defaultValue: V): V {
        const value = this.getMapped(key) as V | null;

        return null !== value ? (this.unmapNullValue(value) as V) : defaultValue;
    }

    /**
     * Get the mapped value, which can be the representation of null.
     *
     * @param key to get the value for.
     * @returns the mapped value or null if there is none.
     */
    protected getMapped(key: number): V | null {
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let value: unknown;
        while (null !== (value = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        return value as V | null;
    }

    /**
     * {@inheritDoc}
     */
    public computeIfAbsent(key: number, mappingFunction: (key: number) => V | null): V | null {
        requireNonNull(mappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        let value = this.unmapNullValue(mappedValue);
        if (null === value && null !== (value = mappingFunction(key) ?? null)) {
            values[index] = value;
            if (null === mappedValue) {
                keys[index] = key;
                if (++this._size > this.resizeThresholdValue) {
                    this.increaseCapacity();
                }
            }
        }

        return value;
    }

    /**
     * {@inheritDoc}
     */
    public computeIfPresent(key: number, remappingFunction: LongObjectToObjectFunction<V, V | null>): V | null {
        requireNonNull(remappingFunction);

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        let value = this.unmapNullValue(mappedValue);
        if (null !== value) {
            value = remappingFunction(key, value) ?? null;
            values[index] = value;

            if (null === value) {
                --this._size;
                this.compactChain(index);
            }
        }

        return value;
    }

    /**
     * {@inheritDoc}
     */
    public compute(key: number, remappingFunction: LongObjectToObjectFunction<V | null, V | null>): V | null {
        requireNonNull(remappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedvalue: unknown;
        while (null !== (mappedvalue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const newValue = remappingFunction(key, this.unmapNullValue(mappedvalue)) ?? null;
        if (null !== newValue) {
            values[index] = newValue;
            if (null === mappedvalue) {
                keys[index] = key;
                if (++this._size > this.resizeThresholdValue) {
                    this.increaseCapacity();
                }
            }
        } else if (null !== mappedvalue) {
            values[index] = null;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    /**
     * {@inheritDoc}
     */
    public merge(key: number, value: V | null, remappingFunction: (oldValue: V, newValue: V) => V | null): V | null {
        const nonNullValue = requireNonNull(value);
        requireNonNull(remappingFunction);
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedvalue: unknown;
        while (null !== (mappedvalue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const oldValue = this.unmapNullValue(mappedvalue);
        const newValue = null === oldValue ? nonNullValue : (remappingFunction(oldValue, nonNullValue) ?? null);
        if (null !== newValue) {
            values[index] = newValue;
            if (null === mappedvalue) {
                keys[index] = key;
                if (++this._size > this.resizeThresholdValue) {
                    this.increaseCapacity();
                }
            }
        } else if (null !== mappedvalue) {
            values[index] = null;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    /**
     * Put a key value pair into the map.
     *
     * @param key   lookup key
     * @param value new value, must not be null
     * @returns current value associated with key, or null if none found
     * @throws NullPointerException if value is null
     */
    public put(key: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let oldValue: unknown;
        while (null !== (oldValue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        if (null === oldValue) {
            ++this._size;
            keys[index] = key;
        }

        values[index] = val;

        if (this._size > this.resizeThresholdValue) {
            this.increaseCapacity();
        }

        return this.unmapNullValue(oldValue);
    }

    /**
     * Remove a value from the map and return the value.
     *
     * @param key to be removed.
     * @returns the previous value for the key, otherwise null if no value was found.
     */
    public remove(key: number): V | null;
    /**
     * Removes the entry for the specified key only if it is currently mapped to the specified value.
     *
     * @param key   with which the specified value is associated.
     * @param value expected to be associated with the specified key.
     * @returns true if the value was removed.
     */
    public remove(key: number, value: V | null): boolean;
    public remove(key: number, value?: V | null): V | null | boolean {
        // `arguments.length`, not `undefined`: an explicit `undefined` value is a (bad) value, not an omitted argument
        return 1 === arguments.length ? this.removeKey(key) : this.removeKeyValue(key, value as V | null);
    }

    private removeKey(key: number): V | null {
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let value: unknown;
        while (null !== (value = values[index])) {
            if (key === keys[index]) {
                values[index] = null;
                --this._size;

                this.compactChain(index);
                break;
            }

            index = (index + 1) & mask;
        }

        return this.unmapNullValue(value);
    }

    private removeKeyValue(key: number, value: V | null): boolean {
        const val = this.mapNullValue(value);
        if (null !== val) {
            const keys = this._keys;
            const values = this._values;
            const mask = values.length - 1;
            let index = Hashing.hashLong(key, mask);

            let mappedValue: unknown;
            while (null !== (mappedValue = values[index])) {
                if (key === keys[index]) {
                    if (objectsEquals(this.unmapNullValue(mappedValue), value)) {
                        values[index] = null;
                        --this._size;

                        this.compactChain(index);
                        return true;
                    }
                    break;
                }

                index = (index + 1) & mask;
            }
        }

        return false;
    }

    /**
     * {@inheritDoc}
     */
    public clear(): void {
        if (this._size > 0) {
            this._values.fill(null);
            this._size = 0;
        }
    }

    /**
     * Compact the backing arrays by rehashing with a capacity just larger than current size
     * and giving consideration to the load factor.
     */
    public compact(): void {
        const idealCapacity = Math.round(this.size() * (1.0 / this.loadFactorValue));
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(Long2ObjectHashMap.MIN_CAPACITY, idealCapacity)));
    }

    /**
     * Put all of the entries of another map into this one: the `putAll(Map)` and `putAll(Long2ObjectHashMap)` of Java.
     *
     * @param map to copy the entries from.
     * @throws NullPointerException if a value of the map is null (and this map does not map nulls).
     */
    public putAll(map: Long2ObjectHashMap<V> | JMap<number, V>): void {
        if (map instanceof Long2ObjectHashMap) {
            const iterator = map.entrySet().iterator();

            while (iterator.hasNext()) {
                iterator.findNext();
                this.put(iterator.getLongKey(), iterator.getValue());
            }
        } else {
            const iterator = map.entrySet().iterator();
            while (iterator.hasNext()) {
                const entry = iterator.next();
                this.put(entry.getKey(), entry.getValue());
            }
        }
    }

    /**
     * Put a value in the map if there is none.
     *
     * @param key   lookup key
     * @param value new value, must not be null
     * @returns current counter value associated with key, or null if none found
     * @throws NullPointerException if value is null
     */
    public putIfAbsent(key: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');
        key = Long.checkSafe(key) + 0; // + 0: -0 is stored as 0

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (key === keys[index]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const oldValue = this.unmapNullValue(mappedValue);
        if (null === oldValue) {
            if (null === mappedValue) {
                ++this._size;
                keys[index] = key;
            }

            values[index] = val;

            if (this._size > this.resizeThresholdValue) {
                this.increaseCapacity();
            }
        }

        return oldValue;
    }

    /**
     * {@inheritDoc}
     */
    public keySet(): Long2ObjectHashMapKeySet<V> {
        if (null === this.keySetValue) {
            this.keySetValue = new Long2ObjectHashMapKeySet<V>(this);
        }

        return this.keySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public values(): Long2ObjectHashMapValueCollection<V> {
        if (null === this.valueCollection) {
            this.valueCollection = new Long2ObjectHashMapValueCollection<V>(this);
        }

        return this.valueCollection;
    }

    /**
     * {@inheritDoc}
     */
    public entrySet(): Long2ObjectHashMapEntrySet<V> {
        if (null === this.entrySetValue) {
            this.entrySetValue = new Long2ObjectHashMapEntrySet<V>(this);
        }

        return this.entrySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        if (this.isEmpty()) {
            return '{}';
        }

        const entryIterator = new Long2ObjectHashMapEntryIterator<V>(this);
        entryIterator.reset();

        let sb = '{';
        for (;;) {
            entryIterator.next();
            sb += entryIterator.getLongKey() + '=' + String(this.unmapNullValue(entryIterator.getValue()));
            if (!entryIterator.hasNext()) {
                return sb + '}';
            }
            sb += ', ';
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

        const that = o as JMap<number, unknown>;
        if (this._size !== that.size()) {
            return false;
        }

        const keys = this._keys;
        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const thisValue = values[i];
            if (null !== thisValue) {
                const thatValue = that.get(keys[i]!);

                if (!instanceEquals(thisValue, this.mapNullValue(thatValue))) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        let result = 0;

        const keys = this._keys;
        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const value = values[i];
            if (null !== value) {
                result = (result + (longHashCode(keys[i]!) ^ hashCodeOf(value))) | 0;
            }
        }

        return result;
    }

    /**
     * Handle the mapping of a null value to a representation which is not null, if the map supports null values.
     *
     * @param value to be mapped.
     * @returns the mapped value.
     */
    protected mapNullValue(value: unknown): unknown {
        return value;
    }

    /**
     * Handle the unmapping of a value, mapping the representation of null back to null.
     *
     * @param value to be unmapped.
     * @returns the unmapped value.
     */
    protected unmapNullValue(value: unknown): V | null {
        return value as V | null;
    }

    /** @internal the `getMapped` seen by the nested classes */
    public _getMapped(key: number): V | null {
        return this.getMapped(key);
    }

    /** @internal the `mapNullValue` seen by the nested classes */
    public _mapNullValue(value: unknown): unknown {
        return this.mapNullValue(value);
    }

    /** @internal the `unmapNullValue` seen by the nested classes */
    public _unmapNullValue(value: unknown): V | null {
        return this.unmapNullValue(value);
    }

    /**
     * Replaces the entry for the specified key only if it is currently mapped to some value.
     *
     * @param key   key with which the specified value is associated.
     * @param value value to be associated with the specified key.
     * @returns the previous value associated with the specified key, or null if there was no mapping for the key.
     * @throws NullPointerException if value is null
     */
    public replace(key: number, value: V | null): V | null;
    /**
     * Replaces the entry for the specified key only if currently mapped to the specified value.
     *
     * @param key      key with which the specified value is associated.
     * @param oldValue value expected to be associated with the specified key.
     * @param newValue value to be associated with the specified key.
     * @returns true if the value was replaced.
     * @throws NullPointerException if newValue is null
     */
    public replace(key: number, oldValue: V | null, newValue: V | null): boolean;
    public replace(key: number, valueOrOld: V | null, newValue?: V | null): V | null | boolean {
        return 2 === arguments.length
            ? this.replaceValue(key, valueOrOld)
            : this.replaceOldNew(key, valueOrOld, newValue as V | null);
    }

    private replaceValue(key: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let oldValue: unknown;
        while (null !== (oldValue = values[index])) {
            if (key === keys[index]) {
                values[index] = val;
                break;
            }

            index = (index + 1) & mask;
        }

        return this.unmapNullValue(oldValue);
    }

    private replaceOldNew(key: number, oldValue: V | null, newValue: V | null): boolean {
        const val = this.mapNullValue(newValue);
        requireNonNull(val, 'value cannot be null');

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLong(key, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (key === keys[index]) {
                if (objectsEquals(this.unmapNullValue(mappedValue), oldValue)) {
                    values[index] = val;
                    return true;
                }
                break;
            }

            index = (index + 1) & mask;
        }

        return false;
    }

    /**
     * {@inheritDoc}
     */
    public replaceAll(function_: LongObjectToObjectFunction<V, V | null>): void {
        this.replaceAllLong(function_);
    }

    /**
     * Replaces each entry's value with the result of invoking the given function on that entry until all entries have
     * been processed or the function throws an exception.
     *
     * @param function_ to apply to each entry.
     * @throws NullPointerException if the function returns null.
     */
    public replaceAllLong(function_: LongObjectToObjectFunction<V, V | null>): void {
        requireNonNull(function_);

        const keys = this._keys;
        const values = this._values;
        const length = values.length;
        let remaining = this._size;

        for (let index = 0; remaining > 0 && index < length; index++) {
            const oldValue = values[index];
            if (null !== oldValue) {
                const newVal = this.mapNullValue(function_(keys[index]!, this.unmapNullValue(oldValue) as V) ?? null);
                requireNonNull(newVal, 'value cannot be null');

                values[index] = newVal;
                --remaining;
            }
        }
    }

    private increaseCapacity(): void {
        const newCapacity = this._values.length << 1;
        if (newCapacity < 0) {
            throw new IllegalStateException('max capacity reached at size=' + this._size);
        }

        this.rehash(newCapacity);
    }

    private rehash(newCapacity: number): void {
        const mask = newCapacity - 1;
        this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(newCapacity) * this.loadFactorValue));

        const tempKeys = new Float64Array(newCapacity);
        const tempValues = new Array<unknown>(newCapacity).fill(null);

        const keys = this._keys;
        const values = this._values;
        for (let i = 0, size = values.length; i < size; i++) {
            const value = values[i];
            if (null !== value) {
                const key = keys[i]!;
                let index = Hashing.hashLong(key, mask);
                while (null !== tempValues[index]) {
                    index = (index + 1) & mask;
                }

                tempKeys[index] = key;
                tempValues[index] = value;
            }
        }

        this._keys = tempKeys;
        this._values = tempValues;
    }

    /** @internal accessed by the nested classes */
    public compactChain(deleteIndex: number): void {
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = deleteIndex;
        for (;;) {
            index = (index + 1) & mask;
            const value = values[index];
            if (null === value) {
                break;
            }

            const key = keys[index]!;
            const hash = Hashing.hashLong(key, mask);

            if (
                (index < hash && (hash <= deleteIndex || deleteIndex <= index)) ||
                (hash <= deleteIndex && deleteIndex <= index)
            ) {
                keys[deleteIndex] = key;
                values[deleteIndex] = value;

                values[index] = null;
                deleteIndex = index;
            }
        }
    }
}

/**
 * A key set implementation which supports cached iterators to avoid allocation.
 */
export class Long2ObjectHashMapKeySet<V> extends AbstractSet<number> {
    private readonly map: Long2ObjectHashMap<V>;
    private readonly keyIterator: Long2ObjectHashMapKeyIterator<V> | null;

    public constructor(map: Long2ObjectHashMap<V>) {
        super();
        this.map = map;
        this.keyIterator = map._shouldAvoidAllocation ? new Long2ObjectHashMapKeyIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2ObjectHashMapKeyIterator<V> {
        let keyIterator = this.keyIterator;
        if (null === keyIterator) {
            keyIterator = new Long2ObjectHashMapKeyIterator<V>(this.map);
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
    public override contains(o: unknown): boolean {
        return this.map.containsKey(o as number);
    }

    /**
     * Remove a key from the map: the `remove(Object)` and `remove(long)` of Java.
     *
     * @param key to be removed.
     * @returns true if the key was present.
     */
    public override remove(key: number): boolean {
        return null !== this.map.remove(key);
    }

    /**
     * {@inheritDoc}
     */
    public override clear(): void {
        this.map.clear();
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
            if (filter(iterator.nextLong())) {
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
export class Long2ObjectHashMapValueCollection<V> extends AbstractCollection<V | null> {
    private readonly map: Long2ObjectHashMap<V>;
    private readonly valueIterator: Long2ObjectHashMapValueIterator<V> | null;

    public constructor(map: Long2ObjectHashMap<V>) {
        super();
        this.map = map;
        this.valueIterator = map._shouldAvoidAllocation ? new Long2ObjectHashMapValueIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2ObjectHashMapValueIterator<V> {
        let valueIterator = this.valueIterator;
        if (null === valueIterator) {
            valueIterator = new Long2ObjectHashMapValueIterator<V>(this.map);
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
     * {@inheritDoc}
     */
    public override contains(o: unknown): boolean {
        return this.map.containsValue(o);
    }

    public override clear(): void {
        this.map.clear();
    }

    /**
     * {@inheritDoc}
     */
    public override forEach(action: (value: V | null) => void): void {
        let remaining = this.map._size;

        const values = this.map._values;
        for (let i = 0, length = values.length; remaining > 0 && i < length; i++) {
            const value = values[i];
            if (null !== value) {
                action(this.map._unmapNullValue(value));
                --remaining;
            }
        }
    }
}

/**
 * An entry set implementation which supports cached iterators to avoid allocation.
 */
export class Long2ObjectHashMapEntrySet<V> extends AbstractSet<Entry<number, V | null>> {
    private readonly map: Long2ObjectHashMap<V>;
    private readonly entryIterator: Long2ObjectHashMapEntryIterator<V> | null;

    public constructor(map: Long2ObjectHashMap<V>) {
        super();
        this.map = map;
        this.entryIterator = map._shouldAvoidAllocation ? new Long2ObjectHashMapEntryIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Long2ObjectHashMapEntryIterator<V> {
        let entryIterator = this.entryIterator;
        if (null === entryIterator) {
            entryIterator = new Long2ObjectHashMapEntryIterator<V>(this.map);
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

        const key = o.getKey() as number;
        const value = this.map._getMapped(key);

        return null !== value && instanceEquals(value, this.map._mapNullValue(o.getValue()));
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLong(filter: LongObjPredicate<V>): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            iterator.findNext();
            if (filter(iterator.getLongKey(), iterator.getValue() as V)) {
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
            undefined === a
                ? new Array<unknown>(size).fill(null)
                : a.length >= size
                  ? a
                  : new Array<unknown>(size).fill(null);

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

/**
 * Base class for the iterators, which iterate backwards from a position, as Aeron does, so that the removal of an
 * element does not move one that is still to be seen.
 */
abstract class AbstractIterator<V, T> implements JIterator<T> {
    private posCounter = 0;
    private stopCounter = 0;
    private remainingValue = 0;
    /** @internal */
    public isPositionValid = false;

    protected readonly map: Long2ObjectHashMap<V>;

    protected constructor(map: Long2ObjectHashMap<V>) {
        this.map = map;
    }

    protected position(): number {
        return this.posCounter & (this.map._values.length - 1);
    }

    public remaining(): number {
        return this.remainingValue;
    }

    public hasNext(): boolean {
        return this.remainingValue > 0;
    }

    /** @internal protected in Java, used by the map and the entry set, which are nested classes of one outer class */
    public findNext(): void {
        if (!this.hasNext()) {
            throw new NoSuchElementException();
        }

        const values = this.map._values;
        const mask = values.length - 1;

        for (let i = this.posCounter - 1, stop = this.stopCounter; i >= stop; i--) {
            const index = i & mask;
            if (null !== values[index]) {
                this.posCounter = i;
                this.isPositionValid = true;
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
            const position = this.position();
            this.map._values[position] = null;
            --this.map._size;

            this.map.compactChain(position);

            this.isPositionValid = false;
        } else {
            throw new IllegalStateException();
        }
    }

    /** @internal package-private in Java */
    public reset(): void {
        this.remainingValue = this.map._size;
        const values = this.map._values;
        const capacity = values.length;

        let i = capacity;
        if (null !== values[capacity - 1]) {
            for (i = 0; i < capacity; i++) {
                if (null === values[i]) {
                    break;
                }
            }
        }

        this.stopCounter = i;
        this.posCounter = i + capacity;
        this.isPositionValid = false;
    }
}

/**
 * Iterator over values.
 */
export class Long2ObjectHashMapValueIterator<V> extends AbstractIterator<V, V | null> {
    public constructor(map: Long2ObjectHashMap<V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): V | null {
        this.findNext();

        return this.map._unmapNullValue(this.map._values[this.position()]);
    }
}

/**
 * Iterator over keys which supports access to unboxed keys via {@link nextLong}.
 */
export class Long2ObjectHashMapKeyIterator<V> extends AbstractIterator<V, number> {
    public constructor(map: Long2ObjectHashMap<V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): number {
        return this.nextLong();
    }

    /**
     * Return next key without boxing.
     *
     * @returns next key.
     */
    public nextLong(): number {
        this.findNext();

        return this.map._keys[this.position()]!;
    }
}

/**
 * Iterator over entries which supports access to unboxed keys via {@link getLongKey}.
 */
export class Long2ObjectHashMapEntryIterator<V>
    extends AbstractIterator<V, Entry<number, V | null>>
    implements Entry<number, V | null>
{
    public constructor(map: Long2ObjectHashMap<V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): Entry<number, V | null> {
        this.findNext();

        if (this.map._shouldAvoidAllocation) {
            return this;
        }

        return this.allocateDuplicateEntry();
    }

    /** @internal private in Java, used by the entry set, which is a nested class of the same outer class */
    public allocateDuplicateEntry(): Entry<number, V | null> {
        return new Long2ObjectHashMapMapEntry<V>(this.map, this.getLongKey(), this.getValue());
    }

    /**
     * {@inheritDoc}
     */
    public getKey(): number {
        return this.getLongKey();
    }

    /**
     * Get the key without boxing.
     *
     * @returns the key.
     */
    public getLongKey(): number {
        return this.map._keys[this.position()]!;
    }

    /**
     * {@inheritDoc}
     */
    public getValue(): V | null {
        return this.map._unmapNullValue(this.map._values[this.position()]);
    }

    /**
     * {@inheritDoc}
     */
    public setValue(value: V | null): V | null {
        const val = this.map._mapNullValue(value);
        requireNonNull(val, 'value cannot be null');

        if (!this.isPositionValid) {
            throw new IllegalStateException();
        }

        const pos = this.position();
        const values = this.map._values;
        const oldValue = values[pos];
        values[pos] = val;

        return oldValue as V | null;
    }
}

/**
 * An entry that is not the iterator: a copy of the key and the value.
 */
export class Long2ObjectHashMapMapEntry<V> implements Entry<number, V | null> {
    private readonly map: Long2ObjectHashMap<V>;
    private readonly k: number;
    private readonly v: V | null;

    public constructor(map: Long2ObjectHashMap<V>, k: number, v: V | null) {
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
    public getValue(): V | null {
        return this.v;
    }

    /**
     * {@inheritDoc}
     */
    public setValue(value: V | null): V | null {
        return this.map.put(this.k, value);
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return longHashCode(this.k) ^ (null !== this.v ? hashCodeOf(this.v) : 0);
    }

    /**
     * {@inheritDoc}
     */
    public equals(o: unknown): boolean {
        if (!isEntry(o)) {
            return false;
        }

        const e = o;
        return (
            e.getKey() !== null &&
            e.getKey() === this.k &&
            ((e.getValue() === null && this.v === null) ||
                (e.getValue() !== null && instanceEquals(e.getValue(), this.v)))
        );
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return this.k + '=' + String(this.v);
    }
}
