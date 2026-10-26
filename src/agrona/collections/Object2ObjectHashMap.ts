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
// Port of org/agrona/collections/Object2ObjectHashMap.java @ Agrona 2.6.1
import { BitUtil } from '../BitUtil.js';
import { IllegalArgumentException, IllegalStateException, Integer, NullPointerException } from '../jdk.js';
import {
    AbstractCollection,
    AbstractSet,
    hashCodeOf,
    isEntry,
    isMap,
    NoSuchElementException,
    objectsEquals,
    requireNonNull,
    type Entry,
    type JIterator,
    type JMap,
} from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';

/**
 * A open addressing with linear probing hash map, same as {@link Int2ObjectHashMap} but for objects. A key must be a
 * `string`, a `number`, a `boolean`, a `bigint` or an object, and is hashed and compared as Java does: with its
 * `hashCode()` and `equals()` methods if it has them (see `HashCoded` in `jdkUtil.ts`), as Java's `String`,
 * `Integer` / `Double`, `Boolean` and `Long` otherwise (an object without them has an identity hash and is compared
 * with `===`). The nested classes are `Object2ObjectHashMapKeySet` and so on.
 *
 * @typeParam K - type of keys stored in the {@link Map}.
 * @typeParam V - type of values stored in the {@link Map}.
 */
export class Object2ObjectHashMap<K, V> {
    static readonly MIN_CAPACITY = 8;

    private readonly loadFactorValue: number;
    private resizeThresholdValue = 0;
    /** @internal accessed by the nested classes, which are in this file */
    public _size = 0;
    /** @internal */
    public readonly _shouldAvoidAllocation: boolean;

    /** @internal the keys at the even indexes, the values at the odd ones */
    public _entries: unknown[] = [];

    private keySetValue: Object2ObjectHashMapKeySet<K, V> | null = null;
    private valueCollection: Object2ObjectHashMapValueCollection<K, V> | null = null;
    private entrySetValue: Object2ObjectHashMapEntrySet<K, V> | null = null;

    /**
     * Construct a new map allowing a configuration for initial capacity and load factor, or copy-construct a new map
     * from an existing one.
     *
     * @param initialCapacity       for the backing array, or the map to copy.
     * @param loadFactor            limit for resizing on puts, a float.
     * @param shouldAvoidAllocation should allocation be avoided by caching iterators and map entries.
     */
    public constructor(
        initialCapacity: number | Object2ObjectHashMap<K, V> = Object2ObjectHashMap.MIN_CAPACITY,
        loadFactor: number = Hashing.DEFAULT_LOAD_FACTOR,
        shouldAvoidAllocation: boolean = true,
    ) {
        if (typeof initialCapacity === 'object') {
            const mapToCopy = initialCapacity;
            this.loadFactorValue = mapToCopy.loadFactorValue;
            this.resizeThresholdValue = mapToCopy.resizeThresholdValue;
            this._size = mapToCopy._size;
            this._shouldAvoidAllocation = mapToCopy._shouldAvoidAllocation;

            this._entries = mapToCopy._entries.slice();
        } else {
            loadFactor = Math.fround(loadFactor);
            CollectionUtil.validateLoadFactor(loadFactor);

            this.loadFactorValue = loadFactor;
            this._shouldAvoidAllocation = shouldAvoidAllocation;

            this.setCapacity(
                BitUtil.findNextPositivePowerOfTwo(Math.max(Object2ObjectHashMap.MIN_CAPACITY, initialCapacity)),
            );
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
     * Get the actual threshold which when reached the map will resize.
     * This is a function of the current capacity and load factor.
     *
     * @returns the threshold when the map will resize.
     */
    public resizeThreshold(): number {
        return this.resizeThresholdValue;
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
     * {@inheritDoc}
     */
    public size(): number {
        return this._size;
    }

    /**
     * {@inheritDoc}
     */
    public isEmpty(): boolean {
        return this._size === 0;
    }

    /**
     * {@inheritDoc}
     */
    public get(key: unknown): V | null {
        return this.unmapNullValue(this.getMapped(key));
    }

    /**
     * Get the mapped value, which can be the representation of null.
     *
     * @param key to get the value for.
     * @returns the mapped value or null if there is none.
     */
    protected getMapped(key: unknown): V | null {
        requireNonNull(key);

        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(hashCodeOf(key), mask);

        let value: unknown;
        while (null !== (value = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        return value as V | null;
    }

    /**
     * {@inheritDoc}
     */
    public put(key: K, value: V | null): V | null {
        const val = this.mapNullValue(value);
        requireNonNull(val, 'value cannot be null');

        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(Object2ObjectHashMap.hashOfKey(key), mask);

        let oldValue: unknown;
        while (null !== (oldValue = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        if (null === oldValue) {
            ++this._size;
            entries[keyIndex] = key;
        }

        entries[keyIndex + 1] = val;

        this.increaseCapacity();

        return this.unmapNullValue(oldValue);
    }

    private increaseCapacity(): void {
        if (this._size > this.resizeThresholdValue) {
            // entries.length = 2 * capacity
            const newCapacity = this._entries.length;
            this.rehash(newCapacity);
        }
    }

    private rehash(newCapacity: number): void {
        const oldEntries = this._entries;
        const length = oldEntries.length;

        this.setCapacity(newCapacity);

        const newEntries = this._entries;
        const mask = newEntries.length - 1;

        for (let keyIndex = 0; keyIndex < length; keyIndex += 2) {
            const value = oldEntries[keyIndex + 1];
            if (null !== value) {
                const key = oldEntries[keyIndex];

                let index = Hashing.evenHash(hashCodeOf(key), mask);
                while (null !== newEntries[index + 1]) {
                    index = Object2ObjectHashMap.next(index, mask);
                }

                newEntries[index] = key;
                newEntries[index + 1] = value;
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public containsValue(value: unknown): boolean {
        const val = this.mapNullValue(value);
        let found = false;
        if (null !== val) {
            const entries = this._entries;
            const length = entries.length;

            for (let valueIndex = 1; valueIndex < length; valueIndex += 2) {
                const entry = entries[valueIndex];
                if (null !== entry && objectsEquals(entry, val)) {
                    found = true;
                    break;
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
            this._entries.fill(null);
            this._size = 0;
        }
    }

    /**
     * Compact the backing arrays by rehashing with a capacity just larger than current size
     * and giving consideration to the load factor.
     */
    public compact(): void {
        const idealCapacity = Math.round(this.size() * (1.0 / this.loadFactorValue));
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(Object2ObjectHashMap.MIN_CAPACITY, idealCapacity)));
    }

    /**
     * {@inheritDoc}
     */
    public forEach(consumer: (key: K, value: V) => void): void {
        let remaining = this._size;

        const entries = this._entries;
        for (let i = 1, length = entries.length; remaining > 0 && i < length; i += 2) {
            const value = entries[i];
            if (null !== value) {
                consumer(entries[i - 1] as K, this.unmapNullValue(value) as V);
                --remaining;
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public containsKey(key: unknown): boolean {
        return null !== this.getMapped(key);
    }

    /**
     * {@inheritDoc}
     */
    public putAll(map: JMap<K, V>): void {
        const iterator = map.entrySet().iterator();
        while (iterator.hasNext()) {
            const entry = iterator.next();
            this.put(entry.getKey(), entry.getValue());
        }
    }

    /**
     * {@inheritDoc}
     */
    public keySet(): Object2ObjectHashMapKeySet<K, V> {
        if (null === this.keySetValue) {
            this.keySetValue = new Object2ObjectHashMapKeySet<K, V>(this);
        }

        return this.keySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public values(): Object2ObjectHashMapValueCollection<K, V> {
        if (null === this.valueCollection) {
            this.valueCollection = new Object2ObjectHashMapValueCollection<K, V>(this);
        }

        return this.valueCollection;
    }

    /**
     * {@inheritDoc}
     */
    public entrySet(): Object2ObjectHashMapEntrySet<K, V> {
        if (null === this.entrySetValue) {
            this.entrySetValue = new Object2ObjectHashMapEntrySet<K, V>(this);
        }

        return this.entrySetValue;
    }

    /**
     * {@inheritDoc}
     */
    public remove(key: unknown): V | null {
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(Object2ObjectHashMap.hashOfKey(key), mask);

        let value: unknown;
        while (null !== (value = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                entries[keyIndex] = null;
                entries[keyIndex + 1] = null;
                this._size--;

                this.compactChain(keyIndex);
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        return this.unmapNullValue(value);
    }

    /** @internal accessed by the nested classes */
    public compactChain(deleteKeyIndex: number): void {
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = deleteKeyIndex;

        for (;;) {
            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
            const value = entries[keyIndex + 1];
            if (null === value) {
                break;
            }

            const key = entries[keyIndex];
            const hash = Hashing.evenHash(hashCodeOf(key), mask);

            if (
                (keyIndex < hash && (hash <= deleteKeyIndex || deleteKeyIndex <= keyIndex)) ||
                (hash <= deleteKeyIndex && deleteKeyIndex <= keyIndex)
            ) {
                entries[deleteKeyIndex] = key;
                entries[deleteKeyIndex + 1] = value;

                entries[keyIndex] = null;
                entries[keyIndex + 1] = null;
                deleteKeyIndex = keyIndex;
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        if (this.isEmpty()) {
            return '{}';
        }

        const entryIterator = new Object2ObjectHashMapEntryIterator<K, V>(this);
        entryIterator.reset();

        let sb = '{';
        for (;;) {
            entryIterator.next();
            sb += String(entryIterator.getKey()) + '=' + String(this.unmapNullValue(entryIterator.getValue()));
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

        const that = o as JMap<K, V>;

        return this._size === that.size() && this.entrySet().equals(that.entrySet());
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return this.entrySet().hashCode();
    }

    /**
     * {@inheritDoc}
     */
    public computeIfAbsent(key: K, mappingFunction: (key: K) => V | null): V | null {
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(Object2ObjectHashMap.hashOfKey(key), mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        let value = this.unmapNullValue(mappedValue);
        if (value === null && (value = mappingFunction(key) ?? null) !== null) {
            entries[keyIndex + 1] = value;
            if (mappedValue === null) {
                entries[keyIndex] = key;
                ++this._size;
                this.increaseCapacity();
            }
        }

        return value;
    }

    /**
     * {@inheritDoc}
     */
    public computeIfPresent(key: K, remappingFunction: (key: K, value: V) => V | null): V | null {
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(Object2ObjectHashMap.hashOfKey(key), mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        let value = this.unmapNullValue(mappedValue);
        if (value !== null) {
            value = remappingFunction(key, value) ?? null;
            entries[keyIndex + 1] = value;
            if (value === null) {
                entries[keyIndex] = null;
                this._size--;
                this.compactChain(keyIndex);
            }
        }

        return value;
    }

    /**
     * {@inheritDoc}
     */
    public compute(key: K, remappingFunction: (key: K, value: V | null) => V | null): V | null {
        const entries = this._entries;
        const mask = entries.length - 1;
        let keyIndex = Hashing.evenHash(Object2ObjectHashMap.hashOfKey(key), mask);

        let mappedValue: unknown;
        while (null !== (mappedValue = entries[keyIndex + 1])) {
            if (objectsEquals(entries[keyIndex], key)) {
                break;
            }

            keyIndex = Object2ObjectHashMap.next(keyIndex, mask);
        }

        const oldValue = this.unmapNullValue(mappedValue);
        const newValue = remappingFunction(key, oldValue) ?? null;
        if (newValue !== null) {
            entries[keyIndex + 1] = newValue;
            if (mappedValue === null) {
                entries[keyIndex] = key;
                this._size++;
                this.increaseCapacity();
            }
        } else if (mappedValue !== null) {
            entries[keyIndex] = null;
            entries[keyIndex + 1] = null;
            this._size--;
            this.compactChain(keyIndex);
        }

        return newValue;
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
    public _getMapped(key: unknown): V | null {
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

    private static next(index: number, mask: number): number {
        return (index + 2) & mask;
    }

    /** `key.hashCode()`: a `NullPointerException` for a null key. */
    private static hashOfKey(key: unknown): number {
        if (null === key || undefined === key) {
            throw new NullPointerException('Cannot invoke "Object.hashCode()" because "key" is null');
        }

        return hashCodeOf(key);
    }

    private setCapacity(newCapacity: number): void {
        const entriesLength = newCapacity * 2;
        if (entriesLength > Integer.MAX_VALUE) {
            throw new IllegalStateException('max capacity reached at size=' + this._size);
        }

        this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(newCapacity) * this.loadFactorValue));
        this._entries = new Array<unknown>(entriesLength).fill(null);
    }
}

/**
 * A key set implementation which supports cached iterators to avoid allocation.
 */
export class Object2ObjectHashMapKeySet<K, V> extends AbstractSet<K> {
    private readonly map: Object2ObjectHashMap<K, V>;
    private readonly keyIterator: Object2ObjectHashMapKeyIterator<K, V> | null;

    public constructor(map: Object2ObjectHashMap<K, V>) {
        super();
        this.map = map;
        this.keyIterator = map._shouldAvoidAllocation ? new Object2ObjectHashMapKeyIterator<K, V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Object2ObjectHashMapKeyIterator<K, V> {
        let keyIterator = this.keyIterator;
        if (null === keyIterator) {
            keyIterator = new Object2ObjectHashMapKeyIterator<K, V>(this.map);
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
     * {@inheritDoc}
     */
    public override contains(o: unknown): boolean {
        return this.map.containsKey(o);
    }

    /**
     * {@inheritDoc}
     */
    public override forEach(action: (key: K) => void): void {
        let remaining = this.map._size;

        const entries = this.map._entries;
        for (let i = 1, length = entries.length; remaining > 0 && i < length; i += 2) {
            if (null !== entries[i]) {
                action(entries[i - 1] as K);
                --remaining;
            }
        }
    }
}

/**
 * A collection implementation which supports cached iterators to avoid allocation.
 */
export class Object2ObjectHashMapValueCollection<K, V> extends AbstractCollection<V | null> {
    private readonly map: Object2ObjectHashMap<K, V>;
    private readonly valueIterator: Object2ObjectHashMapValueIterator<K, V> | null;

    public constructor(map: Object2ObjectHashMap<K, V>) {
        super();
        this.map = map;
        this.valueIterator = map._shouldAvoidAllocation ? new Object2ObjectHashMapValueIterator<K, V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Object2ObjectHashMapValueIterator<K, V> {
        let valueIterator = this.valueIterator;
        if (null === valueIterator) {
            valueIterator = new Object2ObjectHashMapValueIterator<K, V>(this.map);
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

    /**
     * {@inheritDoc}
     */
    public override forEach(action: (value: V | null) => void): void {
        let remaining = this.map._size;

        const entries = this.map._entries;
        for (let i = 1, length = entries.length; remaining > 0 && i < length; i += 2) {
            const entry = entries[i];
            if (null !== entry) {
                action(this.map._unmapNullValue(entry));
                --remaining;
            }
        }
    }
}

/**
 * An entry set implementation which supports cached iterators to avoid allocation.
 */
export class Object2ObjectHashMapEntrySet<K, V> extends AbstractSet<Entry<K, V | null>> {
    private readonly map: Object2ObjectHashMap<K, V>;
    private readonly entryIterator: Object2ObjectHashMapEntryIterator<K, V> | null;

    public constructor(map: Object2ObjectHashMap<K, V>) {
        super();
        this.map = map;
        this.entryIterator = map._shouldAvoidAllocation ? new Object2ObjectHashMapEntryIterator<K, V>(map) : null;
    }

    /**
     * {@inheritDoc}
     */
    public iterator(): Object2ObjectHashMapEntryIterator<K, V> {
        let entryIterator = this.entryIterator;
        if (null === entryIterator) {
            entryIterator = new Object2ObjectHashMapEntryIterator<K, V>(this.map);
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

        const value = this.map._getMapped(o.getKey());

        return null !== value && objectsEquals(value, this.map._mapNullValue(o.getValue()));
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

/**
 * Base class for the iterators.
 */
abstract class AbstractIterator<K, V, T> implements JIterator<T> {
    /** @internal */
    public isPositionValid = false;
    private remainingValue = 0;
    private positionCounter = 0;
    private stopCounter = 0;

    protected readonly map: Object2ObjectHashMap<K, V>;

    protected constructor(map: Object2ObjectHashMap<K, V>) {
        this.map = map;
    }

    /** @internal package-private in Java */
    public reset(): void {
        this.isPositionValid = false;
        this.remainingValue = this.map._size;

        const entries = this.map._entries;
        const capacity = entries.length;
        let keyIndex = capacity;

        if (null !== entries[capacity - 1]) {
            for (let i = 1; i < capacity; i += 2) {
                if (null === entries[i]) {
                    keyIndex = i - 1;
                    break;
                }
            }
        }

        this.stopCounter = keyIndex;
        this.positionCounter = keyIndex + capacity;
    }

    /** @internal package-private in Java */
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
        const mask = entries.length - 1;

        for (let keyIndex = this.positionCounter - 2; keyIndex >= this.stopCounter; keyIndex -= 2) {
            const index = keyIndex & mask;
            if (null !== entries[index + 1]) {
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
            const entries = this.map._entries;
            entries[position] = null;
            entries[position + 1] = null;

            --this.map._size;

            this.map.compactChain(position);

            this.isPositionValid = false;
        } else {
            throw new IllegalStateException();
        }
    }
}

/**
 * Iterator over keys.
 */
export class Object2ObjectHashMapKeyIterator<K, V> extends AbstractIterator<K, V, K> {
    public constructor(map: Object2ObjectHashMap<K, V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): K {
        this.findNext();

        return this.map._entries[this.keyPosition()] as K;
    }
}

/**
 * Iterator over values.
 */
export class Object2ObjectHashMapValueIterator<K, V> extends AbstractIterator<K, V, V | null> {
    public constructor(map: Object2ObjectHashMap<K, V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public next(): V | null {
        this.findNext();

        return this.map._unmapNullValue(this.map._entries[this.keyPosition() + 1]);
    }
}

/**
 * Iterator over entries, which is the entry when the map avoids allocation.
 */
export class Object2ObjectHashMapEntryIterator<K, V>
    extends AbstractIterator<K, V, Entry<K, V | null>>
    implements Entry<K, V | null>
{
    public constructor(map: Object2ObjectHashMap<K, V>) {
        super(map);
    }

    /**
     * {@inheritDoc}
     */
    public getKey(): K {
        return this.map._entries[this.keyPosition()] as K;
    }

    /**
     * {@inheritDoc}
     */
    public getValue(): V | null {
        return this.map._unmapNullValue(this.map._entries[this.keyPosition() + 1]);
    }

    /**
     * {@inheritDoc}
     */
    public setValue(value: V | null): V | null {
        const val = this.map._mapNullValue(value);

        if (!this.isPositionValid) {
            throw new IllegalStateException();
        }

        if (null === val) {
            throw new IllegalArgumentException();
        }

        const keyPosition = this.keyPosition();
        const entries = this.map._entries;
        const prevValue = entries[keyPosition + 1];
        entries[keyPosition + 1] = val;

        return this.map._unmapNullValue(prevValue);
    }

    /**
     * {@inheritDoc}
     */
    public next(): Entry<K, V | null> {
        this.findNext();

        if (this.map._shouldAvoidAllocation) {
            return this;
        }

        return this.allocateDuplicateEntry();
    }

    /** @internal private in Java, used by the entry set, which is a nested class of the same outer class */
    public allocateDuplicateEntry(): Entry<K, V | null> {
        return new Object2ObjectHashMapMapEntry<K, V>(this.map, this.getKey(), this.getValue());
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return hashCodeOf(this.getKey()) ^ hashCodeOf(this.getValue());
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

        return objectsEquals(this.getKey(), that.getKey()) && objectsEquals(this.getValue(), that.getValue());
    }
}

/**
 * An entry that is not the iterator: a copy of the key and the value.
 */
export class Object2ObjectHashMapMapEntry<K, V> implements Entry<K, V | null> {
    private readonly map: Object2ObjectHashMap<K, V>;
    private readonly k: K;
    private v: V | null;

    public constructor(map: Object2ObjectHashMap<K, V>, k: K, v: V | null) {
        this.map = map;
        this.k = k;
        this.v = v;
    }

    /**
     * {@inheritDoc}
     */
    public getKey(): K {
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
        const oldValue = this.map.put(this.k, value);
        this.v = value;

        return oldValue;
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        return hashCodeOf(this.k) ^ hashCodeOf(this.v);
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

        const e = o;

        return objectsEquals(this.k, e.getKey()) && objectsEquals(this.v, e.getValue());
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return String(this.k) + '=' + String(this.v);
    }
}
