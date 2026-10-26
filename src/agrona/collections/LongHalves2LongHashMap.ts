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
// (Long2LongHashMap.java), generated from src/agrona/collections/Long2LongHashMap.ts: (hi, lo) key variant, spec D14
import { BitUtil } from '../BitUtil.js';
import { IllegalArgumentException, IllegalStateException, Long } from '../jdk.js';
import { AbstractCollection, NoSuchElementException, requireNonNull, type JIterator } from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';

/**
 * A callback for each entry of a {@link LongHalves2LongHashMap}.
 */
export type LongHalvesLongConsumer = (keyHigh: number, keyLow: number, value: number) => void;

/**
 * A function of an entry of a {@link LongHalves2LongHashMap}.
 */
export type LongHalvesLongFunction = (keyHigh: number, keyLow: number, value: number) => number;

/**
 * A predicate on an entry of a {@link LongHalves2LongHashMap}.
 */
export type LongHalvesLongPredicate = (keyHigh: number, keyLow: number, value: number) => boolean;

/**
 * A open addressing with linear probing hash map specialised for 64-bit key and `long` value pairs, where the 64-bit
 * key is two `int` halves `(hi, lo)`. It is the `Long2LongHashMap` with the key split: the keys are in an `Int32Array`
 * (two slots per key) and the values in a `Float64Array` at the same index (the `Long2LongHashMap` interleaves both in
 * one array). The probing visits the same slots in the same order, the slot being half of the interleaved key index.
 * <p>
 * Port-only addition for D14 (Java has no such class): a 64-bit key such as a `receiverId` cannot be a `number` (D5),
 * and a `bigint` allocates. Every keyed method takes `(hi, lo)`, each coerced with `| 0`, and the hash is
 * {@link Hashing.evenHashLongHalves} of them.
 * <p>
 * A value or a missing value outside +/-(2^53 - 1) that is put in the map throws `RangeError` (spec D5). The nested
 * classes are `LongHalves2LongHashMapKeySet` and so on. Not ported, because they need a `number` key or a
 * `java.util.Map`: `longForEach`, `putAll(Map)`, `equals(Map)` against a foreign map and `hashCode`, the `AbstractSet`
 * behaviour of the key and entry sets, `toArray` and the `MapEntry` `hashCode` / `equals`. The iterators expose
 * `getKeyHigh()` / `getKeyLow()` where Java has `getLongKey()` / `nextValue()` of the key iterator.
 */
export class LongHalves2LongHashMap {
    static readonly MIN_CAPACITY = 8;

    private readonly _loadFactor: number;
    private readonly _missingValue: number;
    private _resizeThreshold = 0;
    /** @internal accessed by the nested classes, which are in this file */
    public _size = 0;
    /** @internal */
    public readonly _shouldAvoidAllocation: boolean;

    /** @internal two slots per key: the upper half, then the lower half */
    public _keys: Int32Array = new Int32Array(0);
    /** @internal the value of the key at the same index; the missing value marks an empty slot */
    public _values: Float64Array = new Float64Array(0);

    private _keySet: LongHalves2LongHashMapKeySet | null = null;
    private valueCollection: LongHalves2LongHashMapValueCollection | null = null;
    private _entrySet: LongHalves2LongHashMapEntrySet | null = null;

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
        initialCapacity: number | LongHalves2LongHashMap,
        loadFactor?: number,
        missingValue?: number,
        shouldAvoidAllocation: boolean = true,
    ) {
        if (typeof initialCapacity === 'object') {
            const mapToCopy = initialCapacity;
            this._loadFactor = mapToCopy._loadFactor;
            this._resizeThreshold = mapToCopy._resizeThreshold;
            this._size = mapToCopy._size;
            this._shouldAvoidAllocation = mapToCopy._shouldAvoidAllocation;
            this._missingValue = mapToCopy._missingValue;

            this._keys = mapToCopy._keys.slice();
            this._values = mapToCopy._values.slice();
        } else {
            let capacity = initialCapacity;
            if (undefined === loadFactor) {
                missingValue = initialCapacity;
                capacity = LongHalves2LongHashMap.MIN_CAPACITY;
                loadFactor = Hashing.DEFAULT_LOAD_FACTOR;
            }

            loadFactor = Math.fround(loadFactor);
            CollectionUtil.validateLoadFactor(loadFactor);

            this._loadFactor = loadFactor;
            this._missingValue = Long.checkSafe(missingValue!) + 0; // + 0: -0 is stored as 0
            this._shouldAvoidAllocation = shouldAvoidAllocation;

            this.setCapacity(
                BitUtil.findNextPositivePowerOfTwo(Math.max(LongHalves2LongHashMap.MIN_CAPACITY, capacity)),
            );
        }
    }

    /**
     * The value to be used as a null marker in the map.
     *
     * @returns value to be used as a null marker in the map.
     */
    public missingValue(): number {
        return this._missingValue;
    }

    /**
     * Get the load factor beyond which the map will increase size.
     *
     * @returns load factor for when the map should increase size.
     */
    public loadFactor(): number {
        return this._loadFactor;
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
        return this._resizeThreshold;
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
     * The first slot of a key: Java's `evenHash(key, entries.length - 1)` is the even index of the interleaved
     * key / value pair, which is twice the slot.
     */
    private static slotOf(hi: number, lo: number, mask: number): number {
        return Hashing.evenHashLongHalves(hi, lo, (mask << 1) | 1) >> 1;
    }

    /**
     * Get the value for a key, or the default value if the key is not in the map.
     *
     * @param hi           the upper 32 bits of the lookup key.
     * @param lo           the lower 32 bits of the lookup key.
     * @param defaultValue to be returned if there is no value for the key.
     * @returns the value if found otherwise the default value.
     */
    public getOrDefault(hi: number, lo: number, defaultValue: number): number {
        const value = this.get(hi, lo);

        return this._missingValue !== value ? value : defaultValue;
    }

    /**
     * Get the value for a key.
     *
     * @param hi the upper 32 bits of the lookup key.
     * @param lo the lower 32 bits of the lookup key.
     * @returns the value if found otherwise the missing value.
     */
    public get(hi: number, lo: number): number {
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let value: number;
        while (missingValue !== (value = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        return value;
    }

    /**
     * Put a key value pair into the map.
     *
     * @param hi    the upper 32 bits of the lookup key
     * @param lo    the lower 32 bits of the lookup key
     * @param value new value, must not be the missing value
     * @returns previous value if found otherwise the missing value
     * @throws IllegalArgumentException if value is missingValue
     */
    public put(hi: number, lo: number, value: number): number {
        hi |= 0;
        lo |= 0;
        value = Long.checkSafe(value) + 0;
        const missingValue = this._missingValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        if (missingValue === oldValue) {
            ++this._size;
            keys[index * 2] = hi;
            keys[index * 2 + 1] = lo;
        }

        values[index] = value;

        this.increaseCapacity();

        return oldValue;
    }

    /**
     * Put a key value pair into the map if the key has no value.
     *
     * @param hi    the upper 32 bits of the lookup key
     * @param lo    the lower 32 bits of the lookup key
     * @param value new value, must not be the missing value
     * @returns previous value if found otherwise the missing value
     * @throws IllegalArgumentException if value is missingValue
     */
    public putIfAbsent(hi: number, lo: number, value: number): number {
        hi |= 0;
        lo |= 0;
        value = Long.checkSafe(value) + 0;
        const missingValue = this._missingValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                return oldValue;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        ++this._size;
        keys[index * 2] = hi;
        keys[index * 2 + 1] = lo;
        values[index] = value;

        this.increaseCapacity();

        return oldValue;
    }

    private increaseCapacity(): void {
        if (this._size > this._resizeThreshold) {
            // the capacity doubles
            const newCapacity = this._values.length << 1;
            this.rehash(newCapacity);
        }
    }

    private rehash(newCapacity: number): void {
        const missingValue = this._missingValue;
        const oldKeys = this._keys;
        const oldValues = this._values;
        const length = oldValues.length;

        this.setCapacity(newCapacity);

        const newKeys = this._keys;
        const newValues = this._values;
        const mask = newValues.length - 1;

        for (let i = 0; i < length; i++) {
            const value = oldValues[i]!;
            if (missingValue !== value) {
                const hi = oldKeys[i * 2]!;
                const lo = oldKeys[i * 2 + 1]!;
                let newIndex = LongHalves2LongHashMap.slotOf(hi, lo, mask);
                while (missingValue !== newValues[newIndex]) {
                    newIndex = (newIndex + 1) & mask;
                }

                newKeys[newIndex * 2] = hi;
                newKeys[newIndex * 2 + 1] = lo;
                newValues[newIndex] = value;
            }
        }
    }

    /**
     * Primitive specialised forEach implementation.
     *
     * @param consumer a callback called for each key/value pair in the map.
     */
    public forEach(consumer: LongHalvesLongConsumer): void {
        requireNonNull(consumer);

        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const length = values.length;

        for (let index = 0, remaining = this._size; remaining > 0 && index < length; index++) {
            if (missingValue !== values[index]) {
                consumer(keys[index * 2]!, keys[index * 2 + 1]!, values[index]!);
                --remaining;
            }
        }
    }

    /**
     * Long primitive specialised containsKey.
     *
     * @param hi the upper 32 bits of the key to check.
     * @param lo the lower 32 bits of the key to check.
     * @returns true if the map contains key as a key, false otherwise.
     */
    public containsKey(hi: number, lo: number): boolean {
        return this._missingValue !== this.get(hi, lo);
    }

    /**
     * Does the map contain the value.
     *
     * @param value to be checked.
     * @returns true if the map contains value as a value, false otherwise.
     */
    public containsValue(value: number): boolean {
        let found = false;
        const missingValue = this._missingValue;
        if (missingValue !== value) {
            const values = this._values;
            const length = values.length;
            let remaining = this._size;

            for (let index = 0; remaining > 0 && index < length; index++) {
                const existingValue = values[index]!;
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
            this._values.fill(this._missingValue);
            this._size = 0;
        }
    }

    /**
     * Compact the backing arrays by rehashing with a capacity just larger than current size
     * and giving consideration to the load factor.
     */
    public compact(): void {
        const idealCapacity = Math.round(this.size() * (1.0 / this._loadFactor));
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(LongHalves2LongHashMap.MIN_CAPACITY, idealCapacity)));
    }

    /**
     * Primitive specialised version of {@link Map#computeIfAbsent(Object, Function)}.
     *
     * @param hi              the upper 32 bits of the key to search on.
     * @param lo              the lower 32 bits of the key to search on.
     * @param mappingFunction to provide a value if the get returns missingValue.
     * @returns the value if found otherwise the missing value.
     */
    public computeIfAbsent(
        hi: number,
        lo: number,
        mappingFunction: (keyHigh: number, keyLow: number) => number,
    ): number {
        requireNonNull(mappingFunction);
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let value: number;
        while (missingValue !== (value = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        if (missingValue === value && missingValue !== (value = Long.checkSafe(mappingFunction(hi, lo)) + 0)) {
            keys[index * 2] = hi;
            keys[index * 2 + 1] = lo;
            values[index] = value;
            ++this._size;
            this.increaseCapacity();
        }

        return value;
    }

    /**
     * Primitive specialised version of {@link Map#computeIfPresent(Object, BiFunction)}.
     *
     * @param hi                the upper 32 bits of the key to search on.
     * @param lo                the lower 32 bits of the key to search on.
     * @param remappingFunction to compute a value if a value is found.
     * @returns the updated value if found otherwise the missing value.
     */
    public computeIfPresent(hi: number, lo: number, remappingFunction: LongHalvesLongFunction): number {
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let value: number;
        while (missingValue !== (value = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        if (missingValue !== value) {
            value = Long.checkSafe(remappingFunction(hi, lo, value)) + 0;
            values[index] = value;
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
     * @param hi                the upper 32 bits of the key to search on.
     * @param lo                the lower 32 bits of the key to search on.
     * @param remappingFunction to compute a value, given the old value or the missing value.
     * @returns the updated value if found otherwise the missing value.
     */
    public compute(hi: number, lo: number, remappingFunction: LongHalvesLongFunction): number {
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        const newValue = Long.checkSafe(remappingFunction(hi, lo, oldValue)) + 0;
        if (missingValue !== newValue) {
            values[index] = newValue;
            if (oldValue === missingValue) {
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
                ++this._size;
                this.increaseCapacity();
            }
        } else if (missingValue !== oldValue) {
            values[index] = missingValue;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    /**
     * Put all of the entries of another map into this one.
     *
     * @param map to copy the entries from.
     */
    public putAll(map: LongHalves2LongHashMap): void {
        const it = map.entrySet().iterator();

        while (it.hasNext()) {
            it.findNext();
            this.put(it.getKeyHigh(), it.getKeyLow(), it.getLongValue());
        }
    }

    /**
     * {@inheritDoc}
     */
    public keySet(): LongHalves2LongHashMapKeySet {
        if (null === this._keySet) {
            this._keySet = new LongHalves2LongHashMapKeySet(this);
        }

        return this._keySet;
    }

    /**
     * {@inheritDoc}
     */
    public values(): LongHalves2LongHashMapValueCollection {
        if (null === this.valueCollection) {
            this.valueCollection = new LongHalves2LongHashMapValueCollection(this);
        }

        return this.valueCollection;
    }

    /**
     * {@inheritDoc}
     * <p>
     * This set's iterator also is the entry so the key and value can be retrieved by from the iterator.
     */
    public entrySet(): LongHalves2LongHashMapEntrySet {
        if (null === this._entrySet) {
            this._entrySet = new LongHalves2LongHashMapEntrySet(this);
        }

        return this._entrySet;
    }

    /**
     * Remove a key from the map and return its value, or remove a key only if it is mapped to a value.
     *
     * @param hi    the upper 32 bits of the key to be removed.
     * @param lo    the lower 32 bits of the key to be removed.
     * @param value expected to be associated with the key.
     * @returns the previous value if found otherwise the missing value, or true if the pair was removed.
     */
    public remove(hi: number, lo: number): number;
    public remove(hi: number, lo: number, value: number): boolean;
    public remove(hi: number, lo: number, value?: number): number | boolean {
        // `arguments.length`, not `undefined`: an explicit `undefined` value is a (bad) value, not an omitted argument
        return 2 === arguments.length ? this.removeKey(hi, lo) : this.removeKeyValue(hi, lo, value as number);
    }

    private removeKey(hi: number, lo: number): number {
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                values[index] = missingValue;
                this._size--;

                this.compactChain(index);
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        return oldValue;
    }

    private removeKeyValue(hi: number, lo: number, value: number): boolean {
        hi |= 0;
        lo |= 0;
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                if (value === oldValue) {
                    values[index] = missingValue;
                    this._size--;

                    this.compactChain(index);
                    return true;
                }
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        return false;
    }

    /**
     * Primitive specialised version of {@link Map#merge(Object, Object, BiFunction)}.
     *
     * @param hi                the upper 32 bits of the key to search on.
     * @param lo                the lower 32 bits of the key to search on.
     * @param value             to merge with the existing value.
     * @param remappingFunction to compute a value when a mapping already exists, from the old and the new value.
     * @returns the new value, or the missing value if the mapping was removed.
     */
    public merge(
        hi: number,
        lo: number,
        value: number,
        remappingFunction: (oldValue: number, value: number) => number,
    ): number {
        requireNonNull(remappingFunction);
        hi |= 0;
        lo |= 0;
        value = Long.checkSafe(value) + 0;
        const missingValue = this._missingValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        const newValue = missingValue === oldValue ? value : Long.checkSafe(remappingFunction(oldValue, value)) + 0;
        if (missingValue !== newValue) {
            values[index] = newValue;
            if (missingValue === oldValue) {
                keys[index * 2] = hi;
                keys[index * 2 + 1] = lo;
                ++this._size;
                this.increaseCapacity();
            }
        } else {
            values[index] = missingValue;
            this._size--;
            this.compactChain(index);
        }

        return newValue;
    }

    /** @internal accessed by the nested classes */
    public compactChain(deleteIndex: number): void {
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = deleteIndex;

        for (;;) {
            index = LongHalves2LongHashMap.next(index, mask);
            const value = values[index]!;
            if (missingValue === value) {
                break;
            }

            const hi = keys[index * 2]!;
            const lo = keys[index * 2 + 1]!;
            const hash = LongHalves2LongHashMap.slotOf(hi, lo, mask);

            if (
                (index < hash && (hash <= deleteIndex || deleteIndex <= index)) ||
                (hash <= deleteIndex && deleteIndex <= index)
            ) {
                keys[deleteIndex * 2] = hi;
                keys[deleteIndex * 2 + 1] = lo;
                values[deleteIndex] = value;

                values[index] = missingValue;
                deleteIndex = index;
            }
        }
    }

    /**
     * Get the minimum value stored in the map. If the map is empty then it will return {@link missingValue}.
     *
     * @returns the minimum value stored in the map.
     */
    public minValue(): number {
        const missingValue = this._missingValue;
        let min = 0 === this._size ? missingValue : Long.MAX_VALUE;

        const values = this._values;
        const length = values.length;

        for (let index = 0; index < length; index++) {
            const value = values[index]!;
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
        const missingValue = this._missingValue;
        let max = 0 === this._size ? missingValue : Long.MIN_VALUE;

        const values = this._values;
        const length = values.length;

        for (let index = 0; index < length; index++) {
            const value = values[index]!;
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

        const entryIterator = new LongHalves2LongHashMapEntryIterator(this);
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
                entryIterator.getLongValue();
            if (!entryIterator.hasNext()) {
                return sb + '}';
            }
            sb += ', ';
        }
    }

    /**
     * Primitive specialised version of {@link Map#replace(Object, Object)}.
     *
     * @param hi    the upper 32 bits of the key with which the specified value is associated.
     * @param lo    the lower 32 bits of the key with which the specified value is associated.
     * @param value value to be associated with the specified key.
     * @returns the previous value associated with the specified key, or the missing value if there was no mapping.
     */
    public replace(hi: number, lo: number, value: number): number;
    /**
     * Primitive specialised version of {@link Map#replace(Object, Object, Object)}.
     *
     * @param hi       the upper 32 bits of the key with which the specified value is associated.
     * @param lo       the lower 32 bits of the key with which the specified value is associated.
     * @param oldValue value expected to be associated with the specified key.
     * @param newValue value to be associated with the specified key.
     * @returns true if the value was replaced.
     */
    public replace(hi: number, lo: number, oldValue: number, newValue: number): boolean;
    public replace(hi: number, lo: number, valueOrOld: number, newValue?: number): number | boolean {
        return 3 === arguments.length
            ? this.replaceValue(hi, lo, valueOrOld)
            : this.replaceOldNew(hi, lo, valueOrOld, newValue as number);
    }

    private replaceValue(hi: number, lo: number, value: number): number {
        hi |= 0;
        lo |= 0;
        value = Long.checkSafe(value) + 0; // + 0: -0 is stored as 0
        const missingValue = this._missingValue;
        if (missingValue === value) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let oldValue: number;
        while (missingValue !== (oldValue = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                values[index] = value;
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        return oldValue;
    }

    private replaceOldNew(hi: number, lo: number, oldValue: number, newValue: number): boolean {
        hi |= 0;
        lo |= 0;
        newValue = Long.checkSafe(newValue) + 0; // + 0: -0 is stored as 0
        const missingValue = this._missingValue;
        if (missingValue === newValue) {
            throw new IllegalArgumentException('cannot accept missingValue');
        }

        const keys = this._keys;
        const values = this._values;
        const mask = values.length - 1;
        let index = LongHalves2LongHashMap.slotOf(hi, lo, mask);

        let value: number;
        while (missingValue !== (value = values[index]!)) {
            if (hi === keys[index * 2] && lo === keys[index * 2 + 1]) {
                if (oldValue === value) {
                    values[index] = newValue;
                    return true;
                }
                break;
            }

            index = LongHalves2LongHashMap.next(index, mask);
        }

        return false;
    }

    /**
     * Primitive specialised version of {@link Map#replaceAll(BiFunction)}.
     *
     * @param function_ computes a replacement for each value.
     * @throws IllegalArgumentException if the function returns the missing value.
     */
    public replaceAll(function_: LongHalvesLongFunction): void {
        requireNonNull(function_);
        const missingValue = this._missingValue;
        const keys = this._keys;
        const values = this._values;
        const length = values.length;

        for (let index = 0, remaining = this._size; remaining > 0 && index < length; index++) {
            const existingValue = values[index]!;
            if (missingValue !== existingValue) {
                const newValue = Long.checkSafe(function_(keys[index * 2]!, keys[index * 2 + 1]!, existingValue)) + 0;
                if (missingValue === newValue) {
                    throw new IllegalArgumentException('cannot replace with a missingValue');
                }

                values[index] = newValue;
                --remaining;
            }
        }
    }

    private static next(index: number, mask: number): number {
        return (index + 1) & mask;
    }

    private setCapacity(newCapacity: number): void {
        if (newCapacity * 2 > 0x7fffffff) {
            throw new IllegalStateException('max capacity reached at size=' + this._size);
        }

        this._resizeThreshold = Math.trunc(Math.fround(Math.fround(newCapacity) * this._loadFactor));
        this._keys = new Int32Array(newCapacity * 2);
        this._values = new Float64Array(newCapacity).fill(this._missingValue);
    }
}

/**
 * Base class for the iterators.
 */
abstract class AbstractIterator {
    /** @internal */
    public isPositionValid = false;
    private remainingValue = 0;
    private positionCounter = 0;
    private stopCounter = 0;

    protected readonly map: LongHalves2LongHashMap;

    protected constructor(map: LongHalves2LongHashMap) {
        this.map = map;
    }

    /** @internal package-private in Java */
    public reset(): void {
        this.isPositionValid = false;
        this.remainingValue = this.map._size;
        const missingValue = this.map.missingValue();
        const values = this.map._values;
        const capacity = values.length;
        let index = capacity;

        if (missingValue !== values[capacity - 1]) {
            for (let i = 0; i < capacity; i++) {
                if (missingValue === values[i]) {
                    index = i;
                    break;
                }
            }
        }

        this.stopCounter = index;
        this.positionCounter = index + capacity;
    }

    /** @internal protected in Java: the slot of the current entry */
    public keyPosition(): number {
        return this.positionCounter & (this.map._values.length - 1);
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

        const values = this.map._values;
        const missingValue = this.map.missingValue();
        const mask = values.length - 1;

        for (let position = this.positionCounter - 1, stop = this.stopCounter; position >= stop; position--) {
            const index = position & mask;
            if (missingValue !== values[index]) {
                this.isPositionValid = true;
                this.positionCounter = position;
                --this.remainingValue;
                return;
            }
        }

        this.isPositionValid = false;
        throw new IllegalStateException();
    }

    public remove(): void {
        if (this.isPositionValid) {
            const position = this.keyPosition();
            this.map._values[position] = this.map.missingValue();
            --this.map._size;

            this.map.compactChain(position);

            this.isPositionValid = false;
        } else {
            throw new IllegalStateException();
        }
    }
}

/**
 * Iterator over keys: {@link nextKey} moves to the next key, which {@link getKeyHigh} and {@link getKeyLow} read.
 */
export class LongHalves2LongHashMapKeyIterator extends AbstractIterator {
    public constructor(map: LongHalves2LongHashMap) {
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
        return this.map._keys[this.keyPosition() * 2]!;
    }

    /**
     * The lower 32 bits of the current key.
     *
     * @returns the lower half.
     */
    public getKeyLow(): number {
        return this.map._keys[this.keyPosition() * 2 + 1]!;
    }
}

/**
 * Iterator over values which supports access to unboxed values via {@link nextValue}.
 */
export class LongHalves2LongHashMapValueIterator extends AbstractIterator implements JIterator<number> {
    public constructor(map: LongHalves2LongHashMap) {
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

        return this.map._values[this.keyPosition()]!;
    }
}

/**
 * The entry of {@link LongHalves2LongHashMapEntryIterator.next}: the key halves and the value.
 */
export interface LongHalves2LongHashMapEntry {
    getKeyHigh(): number;
    getKeyLow(): number;
    getLongValue(): number;
    setValue(value: number): number;
}

/**
 * Iterator over entries which supports access to the unboxed key halves and value.
 */
export class LongHalves2LongHashMapEntryIterator extends AbstractIterator implements LongHalves2LongHashMapEntry {
    public constructor(map: LongHalves2LongHashMap) {
        super(map);
    }

    /**
     * The upper 32 bits of the current key.
     *
     * @returns the upper half.
     */
    public getKeyHigh(): number {
        return this.map._keys[this.keyPosition() * 2]!;
    }

    /**
     * The lower 32 bits of the current key.
     *
     * @returns the lower half.
     */
    public getKeyLow(): number {
        return this.map._keys[this.keyPosition() * 2 + 1]!;
    }

    public getLongValue(): number {
        return this.map._values[this.keyPosition()]!;
    }

    /**
     * Set the value of the entry.
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
        const values = this.map._values;
        const prevValue = values[keyPosition]!;
        values[keyPosition] = value;

        return prevValue;
    }

    /**
     * Move to the next entry, and return it: the iterator itself when the map avoids allocation, otherwise a copy.
     *
     * @returns the entry.
     */
    public next(): LongHalves2LongHashMapEntry {
        this.findNext();

        if (this.map._shouldAvoidAllocation) {
            return this;
        }

        return this.allocateDuplicateEntry();
    }

    /** @internal private in Java, used by the entry set, which is a nested class of the same outer class */
    public allocateDuplicateEntry(): LongHalves2LongHashMapEntry {
        return new LongHalves2LongHashMapMapEntry(this.map, this.getKeyHigh(), this.getKeyLow(), this.getLongValue());
    }
}

/**
 * An entry that is not the iterator: a copy of the key and the value.
 */
export class LongHalves2LongHashMapMapEntry implements LongHalves2LongHashMapEntry {
    private readonly map: LongHalves2LongHashMap;
    private readonly hi: number;
    private readonly lo: number;
    private readonly v: number;

    public constructor(map: LongHalves2LongHashMap, hi: number, lo: number, v: number) {
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

    public getLongValue(): number {
        return this.v;
    }

    /**
     * {@inheritDoc}
     */
    public setValue(value: number): number {
        return this.map.put(this.hi, this.lo, value);
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return '(' + this.hi + ', ' + this.lo + ')=' + this.v;
    }
}

/**
 * A key set implementation which supports cached iterators to avoid allocation.
 */
export class LongHalves2LongHashMapKeySet {
    private readonly map: LongHalves2LongHashMap;
    private readonly keyIterator: LongHalves2LongHashMapKeyIterator | null;

    public constructor(map: LongHalves2LongHashMap) {
        this.map = map;
        this.keyIterator = map._shouldAvoidAllocation ? new LongHalves2LongHashMapKeyIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2LongHashMapKeyIterator {
        let keyIterator = this.keyIterator;
        if (null === keyIterator) {
            keyIterator = new LongHalves2LongHashMapKeyIterator(this.map);
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
     * {@inheritDoc}
     */
    public clear(): void {
        this.map.clear();
    }

    /**
     * Checks if the key is contained in the map.
     *
     * @param hi the upper 32 bits of the key to check.
     * @param lo the lower 32 bits of the key to check.
     * @returns true if the key is in the map.
     */
    public contains(hi: number, lo: number): boolean {
        return this.map.containsKey(hi, lo);
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
export class LongHalves2LongHashMapValueCollection extends AbstractCollection<number> {
    private readonly map: LongHalves2LongHashMap;
    private readonly valueIterator: LongHalves2LongHashMapValueIterator | null;

    public constructor(map: LongHalves2LongHashMap) {
        super();
        this.map = map;
        this.valueIterator = map._shouldAvoidAllocation ? new LongHalves2LongHashMapValueIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2LongHashMapValueIterator {
        let valueIterator = this.valueIterator;
        if (null === valueIterator) {
            valueIterator = new LongHalves2LongHashMapValueIterator(this.map);
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
     * Checks if the value is contained in the map.
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
export class LongHalves2LongHashMapEntrySet {
    private readonly map: LongHalves2LongHashMap;
    private readonly entryIterator: LongHalves2LongHashMapEntryIterator | null;

    public constructor(map: LongHalves2LongHashMap) {
        this.map = map;
        this.entryIterator = map._shouldAvoidAllocation ? new LongHalves2LongHashMapEntryIterator(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): LongHalves2LongHashMapEntryIterator {
        let entryIterator = this.entryIterator;
        if (null === entryIterator) {
            entryIterator = new LongHalves2LongHashMapEntryIterator(this.map);
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
     * @returns true if the map maps the key to the value.
     */
    public contains(hi: number, lo: number, value: number): boolean {
        const mapped = this.map.get(hi, lo);

        return mapped !== this.map.missingValue() && mapped === value;
    }

    /**
     * Removes all of the elements of this collection that satisfy the given predicate.
     *
     * @param filter a predicate which returns true for elements to be removed.
     * @returns true if any elements were removed.
     */
    public removeIfLongHalves(filter: LongHalvesLongPredicate): boolean {
        let removed = false;
        const iterator = this.iterator();
        while (iterator.hasNext()) {
            iterator.findNext();
            if (filter(iterator.getKeyHigh(), iterator.getKeyLow(), iterator.getLongValue())) {
                iterator.remove();
                removed = true;
            }
        }

        return removed;
    }
}
