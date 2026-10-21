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
// Port of org/agrona/collections/ArrayListUtil.java @ Agrona 2.6.1
import { outOfBounds } from '../jdkUtil.js';

/**
 * `ArrayList.remove(int)`: the element removed, or an `IndexOutOfBoundsException`.
 */
function removeAtIndex<T>(list: T[], index: number): T {
    if (index < 0 || index >= list.length) {
        throw outOfBounds(index, list.length);
    }

    // pop allocates nothing: the removal of the last element is the case on the fast path
    return index === list.length - 1 ? list.pop()! : list.splice(index, 1)[0]!;
}

/**
 * Utility functions for working with `ArrayList`s, which are arrays here.
 * <p>
 * `fastUnorderedRemove(ArrayList, int)` and `fastUnorderedRemove(ArrayList, int, int)` are one method with an optional
 * `lastIndex`; `fastUnorderedRemove(ArrayList, T)` is `fastUnorderedRemoveElement`: an element that is a `number` and
 * an index cannot be told apart.
 */
export class ArrayListUtil {
    private constructor() {}

    /**
     * Removes element at index, but instead of copying all elements to the left, moves into the same slot the last
     * element. This avoids the copy costs, but spoils the list order. If index is the last element it is just removed.
     *
     * @param list      to be modified.
     * @param index     to be removed.
     * @param lastIndex last element index in the list to be swapped into the removed index, the last one of the list
     *                  by default.
     * @throws IndexOutOfBoundsException if index or lastIndex are out of bounds.
     */
    public static fastUnorderedRemove<T>(list: T[], index: number, lastIndex: number = list.length - 1): void {
        if (index !== lastIndex) {
            const last = removeAtIndex(list, lastIndex);
            if (index < 0 || index >= list.length) {
                throw outOfBounds(index, list.length);
            }
            list[index] = last;
        } else {
            removeAtIndex(list, index);
        }
    }

    /**
     * Removes element but instead of copying all elements to the left, moves into the same slot the last element.
     * This avoids the copy costs, but spoils the list order. If element is the last element then it is just removed.
     * This is the Java `fastUnorderedRemove(ArrayList, T)`.
     *
     * @param list to be modified.
     * @param e    to be removed, found by identity.
     * @returns true if found and removed, false otherwise.
     */
    public static fastUnorderedRemoveElement<T>(list: T[], e: T): boolean {
        for (let i = 0, size = list.length; i < size; i++) {
            if (e === list[i]) {
                ArrayListUtil.fastUnorderedRemove(list, i, size - 1);
                return true;
            }
        }

        return false;
    }
}
