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
// Port of org/agrona/collections/IntArrayList.java @ Agrona 2.6.1
import { ArrayUtil } from './ArrayUtil.js';
import { IllegalStateException, IndexOutOfBoundsException, Integer } from '../jdk.js';

/**
 * A {@code java.util.List} of {@code int} that avoids boxing. Only the members that {@link CountersManager} uses are
 * ported: construction, {@code nullValue}, {@code size}, {@code isEmpty}, {@code capacity}, {@code clear},
 * {@code getInt}, {@code addInt}, {@code pushInt}, {@code remove}, {@code removeAt} and {@code toString}. The rest
 * of the {@code List} interface, the stream and conversion methods and {@code wrap} are not ported.
 */
export class IntArrayList {
    /**
     * The default value that will be used in place of null for an element.
     */
    public static readonly DEFAULT_NULL_VALUE = Integer.MIN_VALUE;

    /**
     * Initial capacity to which the array will be sized.
     */
    public static readonly INITIAL_CAPACITY = 10;

    private readonly _nullValue: number = 0;
    private _size = 0;
    private elements: Int32Array;

    /**
     * Constructs a new list with the {@link IntArrayList.INITIAL_CAPACITY} using
     * {@link IntArrayList.DEFAULT_NULL_VALUE}, or a list with the given capacity and null value.
     *
     * @param initialCapacity for the backing array.
     * @param nullValue       to be used to represent a null element.
     */
    public constructor(
        initialCapacity: number = IntArrayList.INITIAL_CAPACITY,
        nullValue: number = IntArrayList.DEFAULT_NULL_VALUE,
    ) {
        this._nullValue = nullValue;
        this.elements = new Int32Array(Math.max(initialCapacity, IntArrayList.INITIAL_CAPACITY));
    }

    /**
     * The value representing null.
     *
     * @return value representing null.
     */
    public nullValue(): number {
        return this._nullValue;
    }

    public size(): number {
        return this._size;
    }

    public isEmpty(): boolean {
        return 0 === this._size;
    }

    /**
     * The current capacity for the collection.
     *
     * @return the current capacity for the collection.
     */
    public capacity(): number {
        return this.elements.length;
    }

    public clear(): void {
        this._size = 0;
    }

    /**
     * Get the element at a given index.
     *
     * @param index to get.
     * @return the element.
     */
    public getInt(index: number): number {
        this.checkIndex(index);

        return this.elements[index]!;
    }

    /**
     * Add an element.
     *
     * @param element to be added.
     * @return true
     */
    public addInt(element: number): boolean {
        this.ensureCapacityPrivate(this._size + 1);

        this.elements[this._size] = element;
        this._size++;

        return true;
    }

    /**
     * Remove at a given index.
     *
     * @param index of the element to be removed.
     * @return the existing value at this index, or null if it was the null value.
     */
    public remove(index: number): number | null {
        const value = this.removeAt(index);

        return this._nullValue === value ? null : value;
    }

    /**
     * Remove at a given index.
     *
     * @param index of the element to be removed.
     * @return the existing value at this index.
     */
    public removeAt(index: number): number {
        this.checkIndex(index);

        const value = this.elements[index]!;

        const moveCount = this._size - index - 1;
        if (moveCount > 0) {
            this.elements.copyWithin(index, index + 1, index + 1 + moveCount);
        }

        this._size--;

        return value;
    }

    /**
     * Push an element onto the end of the array like a stack.
     *
     * @param element to be pushed onto the end of the array.
     */
    public pushInt(element: number): void {
        this.ensureCapacityPrivate(this._size + 1);

        this.elements[this._size] = element;
        this._size++;
    }

    public toString(): string {
        let sb = '[';

        const nullValue = this._nullValue;
        const elements = this.elements;
        for (let i = 0, size = this._size; i < size; i++) {
            const value = elements[i]!;
            sb += (value !== nullValue ? String(value) : 'null') + ', ';
        }

        if (sb.length > 1) {
            sb = sb.slice(0, -2);
        }

        sb += ']';

        return sb;
    }

    private ensureCapacityPrivate(requiredCapacity: number): void {
        const currentCapacity = this.elements.length;
        if (requiredCapacity > currentCapacity) {
            if (requiredCapacity > ArrayUtil.MAX_CAPACITY) {
                throw new IllegalStateException('max capacity: ' + ArrayUtil.MAX_CAPACITY);
            }

            let newCapacity =
                currentCapacity > IntArrayList.INITIAL_CAPACITY ? currentCapacity : IntArrayList.INITIAL_CAPACITY;

            while (newCapacity < requiredCapacity) {
                newCapacity = newCapacity + (newCapacity >> 1);

                if (newCapacity < 0 || newCapacity >= ArrayUtil.MAX_CAPACITY) {
                    newCapacity = ArrayUtil.MAX_CAPACITY;
                }
            }

            const newElements = new Int32Array(newCapacity);
            newElements.set(this.elements);
            this.elements = newElements;
        }
    }

    private checkIndex(index: number): void {
        if (index >= this._size || index < 0) {
            throw new IndexOutOfBoundsException('index=' + index + ' size=' + this._size);
        }
    }
}
