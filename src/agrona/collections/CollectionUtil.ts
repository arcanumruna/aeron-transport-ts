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
// Port of org/agrona/collections/CollectionUtil.java @ Agrona 2.6.1
import { BitUtil } from '../BitUtil.js';
import { IllegalArgumentException } from '../jdk.js';
import { floatToString } from '../jdkUtil.js';

const FLOAT_0_1 = Math.fround(0.1);
const FLOAT_0_9 = Math.fround(0.9);

/**
 * Utility functions for collection objects.
 * <p>
 * A `Map` is anything with `get` and `put`, a `List` is an array.
 */
export class CollectionUtil {
    private constructor() {}

    /**
     * A getOrDefault that doesn't create garbage if its suppler is non-capturing.
     *
     * @param map      to perform the lookup on.
     * @param key      on which the lookup is done.
     * @param supplier of the default value if one is not found.
     * @returns the value if found or a new default which as been added to the map.
     */
    public static getOrDefault<K, V>(
        map: { get(key: K): V | null; put(key: K, value: V): unknown },
        key: K,
        supplier: (key: K) => V,
    ): V {
        let value = map.get(key);
        if (value === null || value === undefined) {
            value = supplier(key);
            map.put(key, value);
        }

        return value;
    }

    /**
     * Garbage free sum function.
     *
     * @param values   the list of input values
     * @param func     function that map each value to an int
     * @returns the sum of all the int values returned for each member of the list.
     */
    public static sum<V>(values: readonly V[], func: (value: V) => number): number {
        let total = 0;

        const size = values.length;
        for (let i = 0; i < size; i++) {
            const value = values[i]!;
            total = (total + func(value)) | 0;
        }

        return total;
    }

    /**
     * Validate that a load factor is in the range of 0.1 to 0.9.
     * <p>
     * Load factors in the range 0.5 - 0.7 are recommended for open-addressing with linear probing.
     *
     * @param loadFactor to be validated, a float.
     */
    public static validateLoadFactor(loadFactor: number): void {
        if (loadFactor < FLOAT_0_1 || loadFactor > FLOAT_0_9) {
            throw new IllegalArgumentException(
                'load factor must be in the range of 0.1 to 0.9: ' + floatToString(loadFactor),
            );
        }
    }

    /**
     * Validate that a number is a power of two.
     *
     * @param value to be validated.
     */
    public static validatePositivePowerOfTwo(value: number): void {
        if (!BitUtil.isPowerOfTwo(value)) {
            throw new IllegalArgumentException('value must be a positive power of two: ' + value);
        }
    }

    /**
     * Remove element from a list if it matches a predicate.
     *
     * @param values    to be iterated over.
     * @param predicate to test the value against
     * @returns the number of items remove.
     */
    public static removeIf<T>(values: T[], predicate: (value: T) => boolean): number {
        let size = values.length;
        let total = 0;

        for (let i = 0; i < size;) {
            const value = values[i]!;
            if (predicate(value)) {
                values.splice(i, 1);
                total++;
                size--;
            } else {
                i++;
            }
        }

        return total;
    }
}
