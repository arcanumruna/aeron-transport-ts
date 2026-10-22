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
// Port of org/agrona/collections/ArrayUtil.java @ Agrona 2.6.1
import { ArrayIndexOutOfBoundsException, Integer } from '../jdk.js';
import { arraysCopyOf } from '../jdkUtil.js';

/**
 * Utility class for operating on arrays as if they were collections. This is useful for
 * critical paths where operations like add and remove are seldom used, but iterating
 * is common and checkcast and indirection are comparatively expensive.
 * <p>
 * In all cases the array being mutated is assumed to be full.
 * <p>
 * In all cases reference equality is used.
 * <p>
 * `remove(T[], int)` is `removeAt`: a `number` element and an index cannot be told apart. The empty primitive arrays
 * are typed arrays (a `byte[]` is a `Uint8Array`, a `long[]` a `Float64Array`, spec D5).
 */
export class ArrayUtil {
    /**
     * Constant indicating an invalid/unknown array index.
     */
    public static readonly UNKNOWN_INDEX = -1;

    /**
     * Empty boolean array.
     */
    public static readonly EMPTY_BOOLEAN_ARRAY: readonly boolean[] = Object.freeze([] as boolean[]);

    /**
     * Empty byte array.
     */
    public static readonly EMPTY_BYTE_ARRAY: Uint8Array = new Uint8Array(0);

    /**
     * Empty char array.
     */
    public static readonly EMPTY_CHAR_ARRAY: Uint16Array = new Uint16Array(0);

    /**
     * Empty short array.
     */
    public static readonly EMPTY_SHORT_ARRAY: Int16Array = new Int16Array(0);

    /**
     * Empty int array.
     */
    public static readonly EMPTY_INT_ARRAY: Int32Array = new Int32Array(0);

    /**
     * Empty float array.
     */
    public static readonly EMPTY_FLOAT_ARRAY: Float32Array = new Float32Array(0);

    /**
     * Empty long array.
     */
    public static readonly EMPTY_LONG_ARRAY: Float64Array = new Float64Array(0);

    /**
     * Empty double array.
     */
    public static readonly EMPTY_DOUBLE_ARRAY: Float64Array = new Float64Array(0);

    /**
     * Empty Object array.
     */
    public static readonly EMPTY_OBJECT_ARRAY: readonly unknown[] = Object.freeze([] as unknown[]);

    /**
     * Empty String array.
     */
    public static readonly EMPTY_STRING_ARRAY: readonly string[] = Object.freeze([] as string[]);

    /**
     * Maximum capacity to which an array can grow.
     */
    public static readonly MAX_CAPACITY = Integer.MAX_VALUE - 8;

    private constructor() {}

    /**
     * Add an element to an array resulting in a new array.
     *
     * @param oldElements  to have the new element added.
     * @param elementToAdd for the new array.
     * @returns a new array that is one bigger and containing the new element at the end.
     */
    public static add<T>(oldElements: readonly T[], elementToAdd: T): T[] {
        const length = oldElements.length;
        const newElements = arraysCopyOf(oldElements, length + 1);
        newElements[length] = elementToAdd;

        return newElements;
    }

    /**
     * Remove an element from an array resulting in a new array if the element was found otherwise the old array.
     * <p>
     * Returns its input parameter if the element to remove isn't a member.
     *
     * @param oldElements     to have the element removed from.
     * @param elementToRemove being searched for by identity semantics.
     * @returns a new array without the element if found otherwise the original array.
     */
    public static remove<T>(oldElements: T[], elementToRemove: T): T[] {
        const length = oldElements.length;
        let index = ArrayUtil.UNKNOWN_INDEX;

        for (let i = 0; i < length; i++) {
            if (oldElements[i] === elementToRemove) {
                index = i;
            }
        }

        return ArrayUtil.removeAt(oldElements, index);
    }

    /**
     * Remove an element from an array resulting in a new array if the index was inside the array otherwise the old
     * array. This is the Java `remove(T[], int)`.
     * <p>
     * Returns the old elements array if the index isn't inside the array.
     *
     * @param oldElements to have the element removed from.
     * @param index       to remove the element at.
     * @returns a new array without the element if the index is inside the array otherwise the original array.
     */
    public static removeAt<T>(oldElements: T[], index: number): T[] {
        if (index === ArrayUtil.UNKNOWN_INDEX) {
            return oldElements;
        }

        const oldLength = oldElements.length;
        const newLength = oldLength - 1;
        const newElements = ArrayUtil.newArray(oldElements, newLength);

        for (let i = 0, j = 0; i < oldLength; i++) {
            if (index !== i) {
                if (j >= newLength) {
                    // Java's array store; JS would grow the array instead
                    throw new ArrayIndexOutOfBoundsException(`Index ${j} out of bounds for length ${newLength}`);
                }
                newElements[j++] = oldElements[i]!;
            }
        }

        return newElements;
    }

    /**
     * Allocate a new array of the same type as another array.
     *
     * @param _oldElements on which the new array is based.
     * @param length       of the new array.
     * @returns the new array of requested length.
     */
    public static newArray<T>(_oldElements: readonly T[], length: number): T[] {
        return arraysCopyOf<T>([], length);
    }

    /**
     * Ensure an array has the required capacity. Resizing only if needed.
     *
     * @param oldElements    to ensure that are long enough.
     * @param requiredLength to ensure.
     * @returns an array of the required length.
     */
    public static ensureCapacity<T>(oldElements: T[], requiredLength: number): T[] {
        let result = oldElements;

        if (oldElements.length < requiredLength) {
            result = arraysCopyOf(oldElements, requiredLength);
        }

        return result;
    }
}
