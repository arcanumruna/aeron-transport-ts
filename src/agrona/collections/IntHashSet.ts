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
// Port of org/agrona/collections/IntHashSet.java @ Agrona 2.6.1
import { BitUtil } from '../BitUtil.js';
import { IllegalArgumentException, IllegalStateException, NullPointerException } from '../jdk.js';
import { AbstractSet, NoSuchElementException, type JIterator } from '../jdkUtil.js';
import { CollectionUtil } from './CollectionUtil.js';
import { Hashing } from './Hashing.js';

const MISSING = 0;

/**
 * What `Collection.contains(Object)` is to a collection that is not an {@link IntHashSet}: a JS array or `Set`, or
 * anything with a `contains` method. Used by {@link IntHashSet.retainAll} only.
 */
type ContainsCollection = readonly number[] | ReadonlySet<number> | { contains(value: number): boolean };

function collectionContains(coll: ContainsCollection, value: number): boolean {
    if (Array.isArray(coll)) {
        return (coll as readonly number[]).includes(value);
    }

    if (coll instanceof Set) {
        return coll.has(value);
    }

    return (coll as { contains(value: number): boolean }).contains(value);
}

/**
 * Open-addressing with linear-probing expandable hash set. Allocation free in steady state use when expanded.
 * <p>
 * By storing elements as int primitives this significantly reduces memory consumption compared with a builtin
 * {@code Set<number>}. It implements the {@code Set<Integer>} of Java for convenience (a boxed {@code Integer} is a
 * {@code number}, so the boxed and primitive overloads are the same method), but calling functionality via those
 * methods can add overhead to your usage.
 * <p>
 * This class is not Threadsafe.
 * <p>
 * This HashSet caches its iterator object by default, so nested iteration is not supported. You can override this
 * behaviour at construction by indicating that the iterator should not be cached.
 *
 * @see IntHashSetIntIterator
 */
export class IntHashSet extends AbstractSet<number> {
    /**
     * The initial capacity used when none is specified in the constructor.
     */
    public static readonly DEFAULT_INITIAL_CAPACITY = 8;

    public static readonly MISSING_VALUE = MISSING;

    private readonly shouldAvoidAllocation: boolean;
    /** @internal */
    public containsMissingValue = false;
    private readonly _loadFactor: number = 0;
    private resizeThresholdValue: number = 0;
    // NB: excludes missing value
    /** @internal */
    public _sizeOfArrayValues = 0;

    /** @internal */
    public _values: Int32Array;
    private cachedIterator: IntHashSetIntIterator | null = null;

    /**
     * Construct a hash set with a proposed initial capacity, load factor, iterator caching support and {@code 0} as a
     * missing value. The defaults are {@link IntHashSet.DEFAULT_INITIAL_CAPACITY}, {@link Hashing.DEFAULT_LOAD_FACTOR}
     * and iterator caching.
     *
     * @param proposedCapacity      for the initial capacity of the set.
     * @param loadFactor            to be used for resizing, a float.
     * @param shouldAvoidAllocation should the iterator be cached to avoid further allocation.
     */
    public constructor(
        proposedCapacity: number = IntHashSet.DEFAULT_INITIAL_CAPACITY,
        loadFactor: number = Hashing.DEFAULT_LOAD_FACTOR,
        shouldAvoidAllocation = true,
    ) {
        super();

        loadFactor = Math.fround(loadFactor);
        CollectionUtil.validateLoadFactor(loadFactor);

        this.shouldAvoidAllocation = shouldAvoidAllocation;
        this._loadFactor = loadFactor;
        const capacity = BitUtil.findNextPositivePowerOfTwo(
            Math.max(IntHashSet.DEFAULT_INITIAL_CAPACITY, proposedCapacity),
        );
        this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(capacity) * loadFactor));
        this._values = new Int32Array(capacity);
    }

    /**
     * Get the load factor beyond which the set will increase size.
     *
     * @return load factor for when the set should increase size.
     */
    public loadFactor(): number {
        return this._loadFactor;
    }

    /**
     * Get the total capacity for the set to which the load factor with be a fraction of.
     *
     * @return the total capacity for the set.
     */
    public capacity(): number {
        return this._values.length;
    }

    /**
     * Get the actual threshold which when reached the map will resize.
     * This is a function of the current capacity and load factor.
     *
     * @return the threshold when the map will resize.
     */
    public resizeThreshold(): number {
        return this.resizeThresholdValue;
    }

    /**
     * Add a value to the set. The boxed {@code add(Integer)} and the primitive {@code add(int)} of Java are this one
     * method. The value is cast to an {@code int} as at a Java call site.
     *
     * @param value the value to add.
     * @return true if the collection has changed, false otherwise.
     */
    public add(value: number): boolean {
        value |= 0;
        if (MISSING === value) {
            const previousContainsMissingValue = this.containsMissingValue;
            this.containsMissingValue = true;
            return !previousContainsMissingValue;
        }

        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hash(value, mask);

        let oldValue: number;
        while (MISSING !== (oldValue = values[index]!)) {
            if (oldValue === value) {
                return false;
            }

            index = IntHashSet.next(index, mask);
        }

        values[index] = value;
        this._sizeOfArrayValues++;

        if (this._sizeOfArrayValues > this.resizeThresholdValue) {
            this.increaseCapacity();
        }

        return true;
    }

    private increaseCapacity(): void {
        const newCapacity = (this._values.length * 2) | 0;
        if (newCapacity < 0) {
            throw new IllegalStateException('max capacity reached at size=' + this.size());
        }

        this.rehash(newCapacity);
    }

    private rehash(newCapacity: number): void {
        const capacity = newCapacity;
        const mask = newCapacity - 1;
        this.resizeThresholdValue = Math.trunc(Math.fround(Math.fround(newCapacity) * this._loadFactor));

        const tempValues = new Int32Array(capacity);
        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const value = values[i]!;
            if (MISSING !== value) {
                let newHash = Hashing.hash(value, mask);
                while (MISSING !== tempValues[newHash]!) {
                    newHash = (newHash + 1) & mask;
                }

                tempValues[newHash] = value;
            }
        }

        this._values = tempValues;
    }

    /**
     * Remove a value from the set. The boxed {@code remove(Object)} and the primitive {@code remove(int)} of Java are
     * this one method.
     *
     * @param value the value to remove.
     * @return true if the value was present, false otherwise.
     */
    public override remove(value: number): boolean {
        value |= 0;
        if (MISSING === value) {
            const previousContainsMissingValue = this.containsMissingValue;
            this.containsMissingValue = false;
            return previousContainsMissingValue;
        }

        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hash(value, mask);

        let oldValue: number;
        while (MISSING !== (oldValue = values[index]!)) {
            if (oldValue === value) {
                values[index] = MISSING;
                this._sizeOfArrayValues--;
                this.compactChain(index);
                return true;
            }

            index = IntHashSet.next(index, mask);
        }

        return false;
    }

    private static next(index: number, mask: number): number {
        return (index + 1) & mask;
    }

    /** @internal */
    public compactChain(deleteIndex: number): void {
        const values = this._values;
        const mask = values.length - 1;

        let index = deleteIndex;
        for (;;) {
            index = IntHashSet.next(index, mask);
            const value = values[index]!;
            if (MISSING === value) {
                return;
            }

            const hash = Hashing.hash(value, mask);

            if (
                (index < hash && (hash <= deleteIndex || deleteIndex <= index)) ||
                (hash <= deleteIndex && deleteIndex <= index)
            ) {
                values[deleteIndex] = value;

                values[index] = MISSING;
                deleteIndex = index;
            }
        }
    }

    /**
     * Compact the backing arrays by rehashing with a capacity just larger than current size
     * and giving consideration to the load factor.
     */
    public compact(): void {
        const idealCapacity = Math.round(this.size() * (1.0 / this._loadFactor)) | 0;
        this.rehash(BitUtil.findNextPositivePowerOfTwo(Math.max(IntHashSet.DEFAULT_INITIAL_CAPACITY, idealCapacity)));
    }

    /**
     * Contains method that does not box values. The boxed {@code contains(Object)} and the primitive
     * {@code contains(int)} of Java are this one method.
     *
     * @param value to be checked for if the set contains it.
     * @return true if the value is contained in the set otherwise false.
     */
    public override contains(value: number): boolean {
        value |= 0;
        if (MISSING === value) {
            return this.containsMissingValue;
        }

        const values = this._values;
        const mask = values.length - 1;
        let index = Hashing.hash(value, mask);

        let existingValue: number;
        while (MISSING !== (existingValue = values[index]!)) {
            if (existingValue === value) {
                return true;
            }

            index = IntHashSet.next(index, mask);
        }

        return false;
    }

    public size(): number {
        return this._sizeOfArrayValues + (this.containsMissingValue ? 1 : 0);
    }

    public override isEmpty(): boolean {
        return this.size() === 0;
    }

    public override clear(): void {
        if (this.size() > 0) {
            this._values.fill(MISSING);
            this._sizeOfArrayValues = 0;
            this.containsMissingValue = false;
        }
    }

    /**
     * Add every value of a collection to this set: {@code addAll(Collection)} of Java, and its alias for another
     * {@link IntHashSet} that avoids allocation.
     *
     * @param coll containing the values to be added.
     * @return {@code true} if this set changed as a result of the call.
     */
    public addAll(coll: IntHashSet | Iterable<number>): boolean {
        if (coll instanceof IntHashSet) {
            let acc = false;

            const values = coll._values;
            for (let i = 0, length = values.length; i < length; i++) {
                const value = values[i]!;
                if (MISSING !== value) {
                    acc = this.add(value) || acc;
                }
            }

            if (coll.containsMissingValue) {
                acc = this.add(MISSING) || acc;
            }

            return acc;
        }

        let added = false;

        for (const value of coll) {
            added = this.add(value) || added;
        }

        return added;
    }

    /**
     * Whether every element of the collection is in this set: {@code containsAll(Collection)} of Java, and its
     * variant for another {@link IntHashSet}.
     *
     * @param coll to compare against.
     * @return true if every element in other is in this.
     */
    public override containsAll(coll: IntHashSet | Iterable<unknown>): boolean {
        if (coll instanceof IntHashSet) {
            const values = coll._values;
            for (let i = 0, length = values.length; i < length; i++) {
                const value = values[i]!;
                if (MISSING !== value && !this.contains(value)) {
                    return false;
                }
            }

            return this.containsMissingValue || !coll.containsMissingValue;
        }

        for (const e of coll) {
            if (!this.contains(e as number)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Fast Path set difference for comparison with another IntHashSet.
     * <p>
     * <b>Note:</b> garbage free in the identical case, allocates otherwise.
     *
     * @param other the other set to subtract.
     * @return null if identical, otherwise the set of differences.
     */
    public difference(other: IntHashSet): IntHashSet | null {
        let difference: IntHashSet | null = null;

        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const value = values[i]!;
            if (MISSING !== value && !other.contains(value)) {
                if (null === difference) {
                    difference = new IntHashSet();
                }

                difference.add(value);
            }
        }

        if (this.containsMissingValue && !other.containsMissingValue) {
            if (null === difference) {
                difference = new IntHashSet();
            }

            difference.add(MISSING);
        }

        return difference;
    }

    public override removeIf(filter: (value: number) => boolean): boolean {
        return super.removeIf(filter);
    }

    /**
     * Removes all the elements of this collection that satisfy the given predicate.
     * <p>
     * NB: Renamed from removeIf to avoid overloading on parameter types of lambda
     * expression, which doesn't play well with type inference in lambda expressions.
     *
     * @param filter which returns {@code true} for elements to be removed.
     * @return {@code true} if any elements were removed.
     */
    public removeIfInt(filter: (value: number) => boolean): boolean {
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

    /**
     * Remove every value of a collection from this set: {@code removeAll(Collection)} of Java, and its alias for
     * another {@link IntHashSet} that avoids allocation.
     *
     * @param coll containing the values to be removed.
     * @return {@code true} if this set changed as a result of the call.
     */
    public removeAll(coll: IntHashSet | Iterable<number>): boolean {
        if (coll instanceof IntHashSet) {
            let removed = false;

            const values = coll._values;
            for (let i = 0, length = values.length; i < length; i++) {
                const value = values[i]!;
                if (MISSING !== value) {
                    removed = this.remove(value) || removed;
                }
            }

            if (coll.containsMissingValue) {
                removed = this.remove(MISSING) || removed;
            }

            return removed;
        }

        let removed = false;

        for (const value of coll) {
            removed = this.remove(value) || removed;
        }

        return removed;
    }

    /**
     * Retain only the values that another collection contains: {@code retainAll(Collection)} of Java, and its alias
     * for another {@link IntHashSet} that avoids boxing and allocations. The collection is an {@link IntHashSet}, an
     * array, a {@code Set} or anything with a {@code contains} method.
     *
     * @param coll containing elements to be retained in this set.
     * @return {@code true} if this set changed as a result of the call.
     */
    public retainAll(coll: IntHashSet | ContainsCollection): boolean {
        let removed = false;
        const values = this._values;
        const length = values.length;
        const isSet = coll instanceof IntHashSet;
        let i = 0;
        for (; i < length; i++) {
            const value = values[i]!;
            if (
                MISSING !== value &&
                !(isSet ? coll.contains(value) : collectionContains(coll as ContainsCollection, value))
            ) {
                values[i] = MISSING;
                this._sizeOfArrayValues--;
                removed = true;
            }
        }

        if (removed && this._sizeOfArrayValues > 0) {
            this.rehash(values.length);
        }

        if (
            this.containsMissingValue &&
            !(isSet ? coll.containsMissingValue : collectionContains(coll as ContainsCollection, MISSING))
        ) {
            this.containsMissingValue = false;
            removed = true;
        }

        return removed;
    }

    public iterator(): IntHashSetIntIterator {
        let iterator = this.cachedIterator;
        if (null === iterator) {
            iterator = new IntHashSetIntIterator(this);
            if (this.shouldAvoidAllocation) {
                this.cachedIterator = iterator;
            }
        }

        return iterator.reset();
    }

    /**
     * Iterate over the collection without boxing.
     *
     * @param action to be taken for each element.
     */
    public forEachInt(action: (value: number) => void): void {
        if (this._sizeOfArrayValues > 0) {
            const values = this._values;
            for (let i = 0, length = values.length; i < length; i++) {
                const v = values[i]!;
                if (MISSING !== v) {
                    action(v);
                }
            }
        }
        if (this.containsMissingValue) {
            action(MISSING);
        }
    }

    /**
     * Copy values from another {@link IntHashSet} into this one.
     *
     * @param that set to copy values from.
     */
    public copy(that: IntHashSet): void {
        if (this._values.length !== that._values.length) {
            throw new IllegalArgumentException('cannot copy object: masks not equal');
        }

        this._values.set(that._values);
        this._sizeOfArrayValues = that._sizeOfArrayValues;
        this.containsMissingValue = that.containsMissingValue;
    }

    public override toString(): string {
        let sb = '{';

        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const value = values[i]!;
            if (MISSING !== value) {
                sb += value + ', ';
            }
        }

        if (this.containsMissingValue) {
            sb += MISSING + ', ';
        }

        if (sb.length > 1) {
            sb = sb.substring(0, sb.length - 2);
        }

        return sb + '}';
    }

    /**
     * The values in an array: {@code toArray()} (no argument, a new array) and {@code toArray(T[])} of Java (the
     * argument if it is long enough, else a new array; the elements after the last value are left as they are).
     * Java's {@code ArrayStoreException} for an array of the wrong element type cannot be raised: a JS array has no
     * element type.
     *
     * @param a the array to store the values in, if it is long enough.
     * @return the array with the values.
     * @throws NullPointerException if {@code a} is null.
     */
    public override toArray(): unknown[];
    public override toArray<A>(a: A[]): A[];
    public override toArray<A>(a?: A[]): unknown[] | A[] {
        if (null === a) {
            throw new NullPointerException();
        }

        const size = this.size();
        const arrayCopy: unknown[] = undefined === a || a.length < size ? new Array<unknown>(size).fill(null) : a;
        this.copyValues(arrayCopy);

        return arrayCopy as unknown[] | A[];
    }

    private copyValues(arrayCopy: unknown[]): void {
        let i = 0;
        const values = this._values;
        for (let j = 0, length = values.length; j < length; j++) {
            const value = values[j]!;
            if (MISSING !== value) {
                arrayCopy[i++] = value;
            }
        }

        if (this.containsMissingValue) {
            arrayCopy[this._sizeOfArrayValues] = MISSING;
        }
    }

    /**
     * Equal to another {@link IntHashSet} with the same values, or to a {@code Set} (a JS {@code Set} or an
     * {@code AbstractSet}) of {@code Integer}s with the same values.
     */
    public override equals(other: unknown): boolean {
        if (other === this) {
            return true;
        }

        if (other instanceof IntHashSet) {
            return (
                other.containsMissingValue === this.containsMissingValue &&
                other._sizeOfArrayValues === this._sizeOfArrayValues &&
                this.containsAll(other)
            );
        }

        let otherSize: number;
        if (other instanceof Set) {
            otherSize = other.size;
        } else if (other instanceof AbstractSet) {
            otherSize = other.size();
        } else {
            return false;
        }

        if (otherSize !== this.size()) {
            return false;
        }

        // Java's ClassCastException | NullPointerException from contains(Object) is an element that is not an Integer.
        for (const e of other as Iterable<unknown>) {
            if ('number' !== typeof e || (e | 0) !== e || !this.contains(e)) {
                return false;
            }
        }

        return true;
    }

    public override hashCode(): number {
        let hashCode = 0;
        const values = this._values;
        for (let i = 0, length = values.length; i < length; i++) {
            const value = values[i]!;
            if (MISSING !== value) {
                hashCode = (hashCode + value) | 0; // Integer.hashCode(value)
            }
        }

        if (this.containsMissingValue) {
            hashCode = (hashCode + MISSING) | 0;
        }

        return hashCode;
    }
}

/**
 * Iterator which supports unboxed access to the values via {@link IntHashSetIntIterator.nextValue}. It is
 * {@code IntHashSet.IntIterator} in Java.
 */
export class IntHashSetIntIterator implements JIterator<number> {
    private readonly set: IntHashSet;
    private remainingCount = 0;
    private positionCounter = 0;
    private stopCounter = 0;
    private isPositionValid = false;

    /**
     * Create a new instance over a set.
     */
    public constructor(set: IntHashSet) {
        this.set = set;
    }

    /** @internal */
    public reset(): IntHashSetIntIterator {
        this.remainingCount = this.set.size();

        const values = this.set._values;
        const length = values.length;
        let i = length;

        if (MISSING !== values[length - 1]!) {
            for (i = 0; i < length; i++) {
                if (MISSING === values[i]!) {
                    break;
                }
            }
        }

        this.stopCounter = i;
        this.positionCounter = i + length;
        this.isPositionValid = false;

        return this;
    }

    public hasNext(): boolean {
        return this.remainingCount > 0;
    }

    /**
     * Returns number of remaining (not yet visited) elements.
     *
     * @return number of remaining elements.
     */
    public remaining(): number {
        return this.remainingCount;
    }

    public next(): number {
        return this.nextValue();
    }

    /**
     * Strongly typed alternative of {@link IntHashSetIntIterator.next} to avoid boxing.
     *
     * @return the next int value.
     */
    public nextValue(): number {
        if (this.remainingCount === 1 && this.set.containsMissingValue) {
            this.remainingCount = 0;
            this.isPositionValid = true;

            return MISSING;
        }

        this.findNext();

        const values = this.set._values;

        return values[this.position(values)]!;
    }

    public remove(): void {
        if (this.isPositionValid) {
            if (0 === this.remainingCount && this.set.containsMissingValue) {
                this.set.containsMissingValue = false;
            } else {
                const values = this.set._values;
                const position = this.position(values);
                values[position] = MISSING;
                --this.set._sizeOfArrayValues;

                this.set.compactChain(position);
            }

            this.isPositionValid = false;
        } else {
            throw new IllegalStateException();
        }
    }

    private findNext(): void {
        const values = this.set._values;
        const mask = values.length - 1;
        this.isPositionValid = true;

        for (let i = this.positionCounter - 1, stop = this.stopCounter; i >= stop; i--) {
            const index = i & mask;
            if (MISSING !== values[index]!) {
                this.positionCounter = i;
                --this.remainingCount;
                return;
            }
        }

        this.isPositionValid = false;
        throw new NoSuchElementException();
    }

    private position(values: Int32Array): number {
        return this.positionCounter & (values.length - 1);
    }
}
