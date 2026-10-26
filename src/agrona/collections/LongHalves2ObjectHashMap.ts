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
// Port of org/agrona/collections/Long2ObjectHashMap.java @ Agrona 2.6.1, generated from
// src/agrona/collections/Long2ObjectHashMap.ts: (hi, lo) key variant, spec D14
import { BitUtil } from '../BitUtil.js';
import { IllegalStateException } from '../jdk.js';
import {
    AbstractCollection,
    hashCodeOf,
    instanceEquals,
    NoSuchElementException,
    objectsEquals,
    requireNonNull,
    type JIterator,
} from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';

/**
 * A callback for each entry of a {@link LongHalves2ObjectHashMap}.
 */
export type LongHalvesObjConsumer<V> = (keyHigh: number, keyLow: number, value: V) => void;

/**
 * A function of an entry of a {@link LongHalves2ObjectHashMap}.
 */
export type LongHalvesObjectToObjectFunction<T, R> = (keyHigh: number, keyLow: number, value: T) => R;

/**
 * A predicate on an entry of a {@link LongHalves2ObjectHashMap}.
 */
export type LongHalvesObjPredicate<V> = (keyHigh: number, keyLow: number, value: V) => boolean;

/**
 * A open addressing with linear probing hash map specialised for 64-bit key and object value pairs, where the 64-bit
 * key is two `int` halves `(hi, lo)`, stored in an `Int32Array` (two slots per key). It is the `Long2ObjectHashMap`
 * with the key split, with the same probing, resize, load factor and iteration order for the same hash.
 * <p>
 * Port-only addition for D14 (Java has no such class): a 64-bit key such as `Hashing.compoundKey(sessionId, streamId)`
 * or a `receiverId` cannot be a `number` (D5), and a `bigint` allocates. Every keyed method takes `(hi, lo)`, each
 * coerced with `| 0`, and the hash is {@link Hashing.hashLongHalves} of them.
 * <p>
 * If a value is null then the map cannot be sure whether it is not there or just a null value, so the null value is
 * not supported. The nested classes are `LongHalves2ObjectHashMapKeySet` and so on. Not ported, because they need a
 * `number` key or a `java.util.Map`: `longForEach`, `putAll(Map)`, `equals(Map)` against a foreign map, the
 * `AbstractSet` behaviour of the key and entry sets, `toArray` and the `MapEntry` `hashCode` / `equals`. The iterators
 * expose `getKeyHigh()` / `getKeyLow()` where Java has `getLongKey()` / `nextLong()`.
 *
 * @typeParam V - type of values stored in the {@link Map}.
 */
export class LongHalves2ObjectHashMap<V> {
    static readonly MIN_CAPACITY = 8;

    private readonly loadFactorValue: number;
    private resizeThresholdValue: number;
    /** @internal accessed by the nested classes, which are in this file */
    public _size: number;
    /** @internal */
    public readonly _shouldAvoidAllocation: boolean;

    /** @internal two slots per key: the upper half, then the lower half */
    public _keys: Int32Array;
    /** @internal */
    public _values: unknown[];

    private valueCollection: LongHalves2ObjectHashMapValueCollection<V> | null = null;
    private keySetValue: LongHalves2ObjectHashMapKeySet<V> | null = null;
    private entrySetValue: LongHalves2ObjectHashMapEntrySet<V> | null = null;

    /**
     * Construct a new map allowing a configuration for initial capacity and load factor, or copy-construct a new map
     * from an existing one.
     *
     * @param initialCapacity       for the backing array, or the map to copy.
     * @param loadFactor            limit for resizing on puts, a float.
     * @param shouldAvoidAllocation should allocation be avoided by caching iterators and map entries.
     */
    public constructor(
        initialCapacity: number | LongHalves2ObjectHashMap<V> = LongHalves2ObjectHashMap.MIN_CAPACITY,
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
                Math.max(LongHalves2ObjectHashMap.MIN_CAPACITY, initialCapacity),
            );
            this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(capacity) * loadFactor));
            this._keys = new Int32Array(capacity * 2);
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
     * Long primitive specialised forEach implementation.
     *
     * @param consumer a callback called for each key/value pair in the map.
     */
    public forEach(consumer: LongHalvesObjConsumer<V>): void {
        requireNonNull(consumer);

        const keys = this._keys;
        const values = this._values;
        const length = values.length;

        for (let index = 0, remaining = this._size; remaining > 0 && index < length; index++) {
            const value = values[index];
            if (null !== value) {
                consumer(keys[index * 2]!, keys[index * 2 + 1]!, this.unmapNullValue(value) as V);
                --remaining;
            }
        }
    }

    /**
     * Check if the map contains a key.
     *
     * @param hi the upper 32 bits of the key.
     * @param lo the lower 32 bits of the key.
     * @returns true if the map contains the key.
     */
    public containsKey(hi: number, lo: number): boolean {
        hi |= 0;
        lo |= 0;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let found = false;
        while (null !== values[index]) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
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
     * @param hi the upper 32 bits of the key.
     * @param lo the lower 32 bits of the key.
     * @returns the value if found, null otherwise.
     */
    public get(hi: number, lo: number): V | null {
        return this.unmapNullValue(this.getMapped(hi, lo));
    }

    /**
     * Returns the value to which the specified key is mapped, or defaultValue if this map contains no mapping for
     * the key.
     *
     * @param hi           the upper 32 bits of the key.
     * @param lo           the lower 32 bits of the key.
     * @param defaultValue the default mapping of the key.
     * @returns the value to which the specified key is mapped, or defaultValue if this map contains no mapping for
     * the key.
     */
    public getOrDefault(hi: number, lo: number, defaultValue: V): V {
        const value = this.getMapped(hi, lo) as V | null;

        return null !== value ? (this.unmapNullValue(value) as V) : defaultValue;
    }

    /**
     * Get the mapped value, which can be the representation of null.
     *
     * @param hi the upper 32 bits of the key.
     * @param lo the lower 32 bits of the key.
     * @returns the mapped value or null if there is none.
     */
    protected getMapped(hi: number, lo: number): V | null {
        hi |= 0;
        lo |= 0;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let value: unknown;
        while (null !== (value = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        return value as V | null;
    }

    /**
     * {@inheritDoc}
     */
    public computeIfAbsent(
        hi: number,
        lo: number,
        mappingFunction: (keyHigh: number, keyLow: number) => V | null,
    ): V | null {
        requireNonNull(mappingFunction);
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        let value = this.unmapNullValue(mappedValue);
        if (null === value && null !== (value = mappingFunction(hi, lo) ?? null)) {
            values[index] = value;
            if (null === mappedValue) {
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
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
    public computeIfPresent(
        hi: number,
        lo: number,
        remappingFunction: LongHalvesObjectToObjectFunction<V, V | null>,
    ): V | null {
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        let value = this.unmapNullValue(mappedValue);
        if (null !== value) {
            value = remappingFunction(hi, lo, value) ?? null;
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
    public compute(
        hi: number,
        lo: number,
        remappingFunction: LongHalvesObjectToObjectFunction<V | null, V | null>,
    ): V | null {
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedvalue: unknown;
        while (null !== (mappedvalue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const newValue = remappingFunction(hi, lo, this.unmapNullValue(mappedvalue)) ?? null;
        if (null !== newValue) {
            values[index] = newValue;
            if (null === mappedvalue) {
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
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
    public merge(
        hi: number,
        lo: number,
        value: V | null,
        remappingFunction: (oldValue: V, newValue: V) => V | null,
    ): V | null {
        const nonNullValue = requireNonNull(value);
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedvalue: unknown;
        while (null !== (mappedvalue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const oldValue = this.unmapNullValue(mappedvalue);
        const newValue = null === oldValue ? nonNullValue : (remappingFunction(oldValue, nonNullValue) ?? null);
        if (null !== newValue) {
            values[index] = newValue;
            if (null === mappedvalue) {
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
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
     * @param hi    the upper 32 bits of the lookup key
     * @param lo    the lower 32 bits of the lookup key
     * @param value new value, must not be null
     * @returns current value associated with key, or null if none found
     * @throws NullPointerException if value is null
     */
    public put(hi: number, lo: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let oldValue: unknown;
        while (null !== (oldValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        if (null === oldValue) {
            ++this._size;
            keys[index * 2] = hi;
            keys[index * 2 + 1] = lo;
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
     * @param hi the upper 32 bits of the key to be removed.
     * @param lo the lower 32 bits of the key to be removed.
     * @returns the previous value for the key, otherwise null if no value was found.
     */
    public remove(hi: number, lo: number): V | null;
    /**
     * Removes the entry for the specified key only if it is currently mapped to the specified value.
     *
     * @param hi    the upper 32 bits of the key with which the specified value is associated.
     * @param lo    the lower 32 bits of the key with which the specified value is associated.
     * @param value expected to be associated with the specified key.
     * @returns true if the value was removed.
     */
    public remove(hi: number, lo: number, value: V | null): boolean;
    public remove(hi: number, lo: number, value?: V | null): V | null | boolean {
        // `arguments.length`, not `undefined`: an explicit `undefined` value is a (bad) value, not an omitted argument
        return 2 === arguments.length ? this.removeKey(hi, lo) : this.removeKeyValue(hi, lo, value as V | null);
    }

    private removeKey(hi: number, lo: number): V | null {
        hi |= 0;
        lo |= 0;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let value: unknown;
        while (null !== (value = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                values[index] = null;
                --this._size;

                this.compactChain(index);
                break;
            }

            index = (index + 1) & mask;
        }

        return this.unmapNullValue(value);
    }

    private removeKeyValue(hi: number, lo: number, value: V | null): boolean {
        const val = this.mapNullValue(value);
        if (null !== val) {
            hi |= 0;
            lo |= 0;
            const keys = this._keys;
            const values = this._values;
            const mask = values.length - 1;
            let index = Hashing.hashLongHalves(hi, lo, mask);

            let mappedValue: unknown;
            while (null !== (mappedValue = values[index])) {
                if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
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
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(LongHalves2ObjectHashMap.MIN_CAPACITY, idealCapacity)));
    }

    /**
     * Put all of the entries of another map into this one.
     *
     * @param map to copy the entries from.
     * @throws NullPointerException if a value of the map is null (and this map does not map nulls).
     */
    public putAll(map: LongHalves2ObjectHashMap<V>): void {
        const iterator = map.entrySet().iterator();

        while (iterator.hasNext()) {
            iterator.findNext();
            this.put(iterator.getKeyHigh(), iterator.getKeyLow(), iterator.getValue());
        }
    }

    /**
     * Put a value in the map if there is none.
     *
     * @param hi    the upper 32 bits of the lookup key
     * @param lo    the lower 32 bits of the lookup key
     * @param value new value, must not be null
     * @returns current counter value associated with key, or null if none found
     * @throws NullPointerException if value is null
     */
    public putIfAbsent(hi: number, lo: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = (index + 1) & mask;
        }

        const oldValue = this.unmapNullValue(mappedValue);
        if (null === oldValue) {
            if (null === mappedValue) {
                ++this._size;
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
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
    public keySet(): LongHalves2ObjectHashMapKeySet<V> {
        if (null === this.keySetValue) {
            this.keySetValue = new LongHalves2ObjectHashMapKeySet<V>(this);
        }

        return this.keySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public values(): LongHalves2ObjectHashMapValueCollection<V> {
        if (null === this.valueCollection) {
            this.valueCollection = new LongHalves2ObjectHashMapValueCollection<V>(this);
        }

        return this.valueCollection;
    }

    /**
     * {@inheritDoc}
     */
    public entrySet(): LongHalves2ObjectHashMapEntrySet<V> {
        if (null === this.entrySetValue) {
            this.entrySetValue = new LongHalves2ObjectHashMapEntrySet<V>(this);
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

        const entryIterator = new LongHalves2ObjectHashMapEntryIterator<V>(this);
        entryIterator.reset();

        let sb = '{';
        for (;;) {
            entryIterator.next();
            sb +=
                '(' +
                entryIterator.getKeyHigh() +
                ', ' +
                entryIterator.getKeyLow() +
                ')=' +
                String(this.unmapNullValue(entryIterator.getValue()));
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

        if (!(o instanceof LongHalves2ObjectHashMap)) {
            return false;
        }

        const that = o as LongHalves2ObjectHashMap<unknown>;
        if (this._size !== that.size()) {
            return false;
        }

        const keys = this._keys;
        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const thisValue = values[i];
            if (null !== thisValue) {
                const thatValue = that.get(keys[i * 2]!, keys[i * 2 + 1]!);

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
                // Long.hashCode(key) is (int)(key ^ (key >>> 32)), that is hi ^ lo
                result = (result + (keys[i * 2]! ^ keys[i * 2 + 1]! ^ hashCodeOf(value))) | 0;
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
    public _getMapped(hi: number, lo: number): V | null {
        return this.getMapped(hi, lo);
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
     * @param hi    the upper 32 bits of the key with which the specified value is associated.
     * @param lo    the lower 32 bits of the key with which the specified value is associated.
     * @param value value to be associated with the specified key.
     * @returns the previous value associated with the specified key, or null if there was no mapping for the key.
     * @throws NullPointerException if value is null
     */
    public replace(hi: number, lo: number, value: V | null): V | null;
    /**
     * Replaces the entry for the specified key only if currently mapped to the specified value.
     *
     * @param hi       the upper 32 bits of the key with which the specified value is associated.
     * @param lo       the lower 32 bits of the key with which the specified value is associated.
     * @param oldValue value expected to be associated with the specified key.
     * @param newValue value to be associated with the specified key.
     * @returns true if the value was replaced.
     * @throws NullPointerException if newValue is null
     */
    public replace(hi: number, lo: number, oldValue: V | null, newValue: V | null): boolean;
    public replace(hi: number, lo: number, valueOrOld: V | null, newValue?: V | null): V | null | boolean {
        return 3 === arguments.length
            ? this.replaceValue(hi, lo, valueOrOld)
            : this.replaceOldNew(hi, lo, valueOrOld, newValue as V | null);
    }

    private replaceValue(hi: number, lo: number, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let oldValue: unknown;
        while (null !== (oldValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                values[index] = val;
                break;
            }

            index = (index + 1) & mask;
        }

        return this.unmapNullValue(oldValue);
    }

    private replaceOldNew(hi: number, lo: number, oldValue: V | null, newValue: V | null): boolean {
        const val = this.mapNullValue(newValue);
        requireNonNull(val, 'value cannot be null');
        hi |= 0;
        lo |= 0;

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hashLongHalves(hi, lo, mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = values[index])) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
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
     * Replaces each entry's value with the result of invoking the given function on that entry until all entries have
     * been processed or the function throws an exception.
     *
     * @param function_ to apply to each entry.
     * @throws NullPointerException if the function returns null.
     */
    public replaceAll(function_: LongHalvesObjectToObjectFunction<V, V | null>): void {
        requireNonNull(function_);

        const keys = this._keys;
        const values = this._values;
        const length = values.length;
        let remaining = this._size;

        for (let index = 0; remaining > 0 && index < length; index++) {
            const oldValue = values[index];
            if (null !== oldValue) {
                const newVal = this.mapNullValue(
                    function_(keys[index * 2]!, keys[index * 2 + 1]!, this.unmapNullValue(oldValue) as V) ?? null,
                );
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

        const tempKeys = new Int32Array(newCapacity * 2);
        const tempValues = new Array<unknown>(newCapacity).fill(null);

        const keys = this._keys;
        const values = this._values;
        for (let i = 0, size = values.length; i < size; i++) {
            const value = values[i];
            if (null !== value) {
                const hi = keys[i * 2]!;
                const lo = keys[i * 2 + 1]!;
                let index = Hashing.hashLongHalves(hi, lo, mask);
                while (null !== tempValues[index]) {
                    index = (index + 1) & mask;
                }

                tempKeys[index * 2] = hi;
                tempKeys[index * 2 + 1] = lo;
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

            const hi = keys[index * 2]!;
            const lo = keys[index * 2 + 1]!;
            const hash = Hashing.hashLongHalves(hi, lo, mask);

            if (
                (index < hash && (hash <= deleteIndex || deleteIndex <= index)) ||
                (hash <= deleteIndex && deleteIndex <= index)
            ) {
                keys[deleteIndex * 2] = hi;
                keys[deleteIndex * 2 + 1] = lo;
                values[deleteIndex] = value;

                values[index] = null;
                deleteIndex = index;
            }
        }
    }
}

/**
 * A key set implementation which supports cached iterators to avoid allocation. Its iterator reads the key with
 * `getKeyHigh()` / `getKeyLow()` after `nextKey()`.
 */
export class LongHalves2ObjectHashMapKeySet<V> {
    private readonly map: LongHalves2ObjectHashMap<V>;
    private readonly keyIterator: LongHalves2ObjectHashMapKeyIterator<V> | null;

    public constructor(map: LongHalves2ObjectHashMap<V>) {
        this.map = map;
        this.keyIterator = map._shouldAvoidAllocation ? new LongHalves2ObjectHashMapKeyIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2ObjectHashMapKeyIterator<V> {
        let keyIterator = this.keyIterator;
        if (null === keyIterator) {
            keyIterator = new LongHalves2ObjectHashMapKeyIterator<V>(this.map);
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
    public isEmpty(): boolean {
        return this.map.isEmpty();
    }

    /**
     * Checks if the key is contained in the map.
     *
     * @param hi the upper 32 bits of the key.
     * @param lo the lower 32 bits of the key.
     * @returns true if the key is in the map.
     */
    public contains(hi: number, lo: number): boolean {
        return this.map.containsKey(hi, lo);
    }

    /**
     * Remove a key from the map.
     *
     * @param hi the upper 32 bits of the key to be removed.
     * @param lo the lower 32 bits of the key to be removed.
     * @returns true if the key was present.
     */
    public remove(hi: number, lo: number): boolean {
        return null !== this.map.remove(hi, lo);
    }

    /**
     * {@inheritDoc}
     */
    public clear(): void {
        this.map.clear();
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLongHalves(filter: (keyHigh: number, keyLow: number) => boolean): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            iterator.nextKey();
            if (filter(iterator.getKeyHigh(), iterator.getKeyLow())) {
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
export class LongHalves2ObjectHashMapValueCollection<V> extends AbstractCollection<V | null> {
    private readonly map: LongHalves2ObjectHashMap<V>;
    private readonly valueIterator: LongHalves2ObjectHashMapValueIterator<V> | null;

    public constructor(map: LongHalves2ObjectHashMap<V>) {
        super();
        this.map = map;
        this.valueIterator = map._shouldAvoidAllocation ? new LongHalves2ObjectHashMapValueIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2ObjectHashMapValueIterator<V> {
        let valueIterator = this.valueIterator;
        if (null === valueIterator) {
            valueIterator = new LongHalves2ObjectHashMapValueIterator<V>(this.map);
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
export class LongHalves2ObjectHashMapEntrySet<V> {
    private readonly map: LongHalves2ObjectHashMap<V>;
    private readonly entryIterator: LongHalves2ObjectHashMapEntryIterator<V> | null;

    public constructor(map: LongHalves2ObjectHashMap<V>) {
        this.map = map;
        this.entryIterator = map._shouldAvoidAllocation ? new LongHalves2ObjectHashMapEntryIterator<V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2ObjectHashMapEntryIterator<V> {
        let entryIterator = this.entryIterator;
        if (null === entryIterator) {
            entryIterator = new LongHalves2ObjectHashMapEntryIterator<V>(this.map);
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
    public isEmpty(): boolean {
        return this.map.isEmpty();
    }

    /**
     * {@inheritDoc}
     */
    public clear(): void {
        this.map.clear();
    }

    /**
     * Checks if the entry is contained in the map.
     *
     * @param hi    the upper 32 bits of the key.
     * @param lo    the lower 32 bits of the key.
     * @param value of the entry.
     * @returns true if the map maps the key to an equal value.
     */
    public contains(hi: number, lo: number, value: V | null): boolean {
        const mapped = this.map._getMapped(hi, lo);

        return null !== mapped && instanceEquals(mapped, this.map._mapNullValue(value));
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLongHalves(filter: LongHalvesObjPredicate<V>): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            iterator.findNext();
            if (filter(iterator.getKeyHigh(), iterator.getKeyLow(), iterator.getValue() as V)) {
                iterator.remove();
                removed = true;
            }
        }

        return removed;
    }
}

/**
 * Base class for the iterators, which iterate backwards from a position, as Aeron does, so that the removal of an
 * element does not move one that is still to be seen.
 */
abstract class AbstractIterator<V> {
    private posCounter = 0;
    private stopCounter = 0;
    private remainingValue = 0;
    /** @internal */
    public isPositionValid = false;

    protected readonly map: LongHalves2ObjectHashMap<V>;

    protected constructor(map: LongHalves2ObjectHashMap<V>) {
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
export class LongHalves2ObjectHashMapValueIterator<V> extends AbstractIterator<V> implements JIterator<V | null> {
    public constructor(map: LongHalves2ObjectHashMap<V>) {
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
 * Iterator over keys: {@link nextKey} moves to the next key, which {@link getKeyHigh} and {@link getKeyLow} read.
 */
export class LongHalves2ObjectHashMapKeyIterator<V> extends AbstractIterator<V> {
    public constructor(map: LongHalves2ObjectHashMap<V>) {
        super(map);
    }

    /**
     * Move to the next key without boxing.
     */
    public nextKey(): void {
        this.findNext();
    }

    /**
     * The upper 32 bits of the current key.
     *
     * @returns the upper half.
     */
    public getKeyHigh(): number {
        return this.map._keys[this.position() * 2]!;
    }

    /**
     * The lower 32 bits of the current key.
     *
     * @returns the lower half.
     */
    public getKeyLow(): number {
        return this.map._keys[this.position() * 2 + 1]!;
    }
}

/**
 * The entry of {@link LongHalves2ObjectHashMapEntryIterator.next}: the key halves and the value.
 */
export interface LongHalves2ObjectHashMapEntry<V> {
    getKeyHigh(): number;
    getKeyLow(): number;
    getValue(): V | null;
    setValue(value: V | null): V | null;
}

/**
 * Iterator over entries which supports access to the unboxed key halves via {@link getKeyHigh} and {@link getKeyLow}.
 */
export class LongHalves2ObjectHashMapEntryIterator<V>
    extends AbstractIterator<V>
    implements LongHalves2ObjectHashMapEntry<V>
{
    public constructor(map: LongHalves2ObjectHashMap<V>) {
        super(map);
    }

    /**
     * Move to the next entry, and return it: the iterator itself when the map avoids allocation, otherwise a copy.
     *
     * @returns the entry.
     */
    public next(): LongHalves2ObjectHashMapEntry<V> {
        this.findNext();

        if (this.map._shouldAvoidAllocation) {
            return this;
        }

        return this.allocateDuplicateEntry();
    }

    /** @internal private in Java, used by the entry set, which is a nested class of the same outer class */
    public allocateDuplicateEntry(): LongHalves2ObjectHashMapEntry<V> {
        return new LongHalves2ObjectHashMapMapEntry<V>(this.map, this.getKeyHigh(), this.getKeyLow(), this.getValue());
    }

    /**
     * The upper 32 bits of the current key.
     *
     * @returns the upper half.
     */
    public getKeyHigh(): number {
        return this.map._keys[this.position() * 2]!;
    }

    /**
     * The lower 32 bits of the current key.
     *
     * @returns the lower half.
     */
    public getKeyLow(): number {
        return this.map._keys[this.position() * 2 + 1]!;
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
export class LongHalves2ObjectHashMapMapEntry<V> implements LongHalves2ObjectHashMapEntry<V> {
    private readonly map: LongHalves2ObjectHashMap<V>;
    private readonly hi: number;
    private readonly lo: number;
    private readonly v: V | null;

    public constructor(map: LongHalves2ObjectHashMap<V>, hi: number, lo: number, v: V | null) {
        this.map = map;
        this.hi = hi;
        this.lo = lo;
        this.v = v;
    }

    /**
     * The upper 32 bits of the key.
     *
     * @returns the upper half.
     */
    public getKeyHigh(): number {
        return this.hi;
    }

    /**
     * The lower 32 bits of the key.
     *
     * @returns the lower half.
     */
    public getKeyLow(): number {
        return this.lo;
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
        return this.map.put(this.hi, this.lo, value);
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return '(' + this.hi + ', ' + this.lo + ')=' + String(this.v);
    }
}
