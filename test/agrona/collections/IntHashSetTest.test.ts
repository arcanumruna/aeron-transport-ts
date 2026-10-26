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
// Port of org/agrona/collections/IntHashSetTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntHashSet } from '../../../src/agrona/collections/IntHashSet.js';
import type { IntHashSetIntIterator } from '../../../src/agrona/collections/IntHashSet.js';
import { NullPointerException } from '../../../src/agrona/jdk.js';
import { NoSuchElementException } from '../../../src/agrona/jdkUtil.js';
import { assertThrows } from '../../support/Assertions.js';
import { expectInOrder } from '../../support/InOrder.js';

const { MISSING_VALUE } = IntHashSet;

/** Hamcrest `containsInAnyOrder(...)` / `arrayContainingInAnyOrder(...)` over the elements of an iterable. */
function sorted(values: Iterable<unknown>): number[] {
    return [...(values as Iterable<number>)].sort((a, b) => a - b);
}

/** `Set.equals(Object)` of a `java.util.HashSet<Integer>`: the same size and every element contained. */
function hashSetEquals(set: Set<number>, other: IntHashSet): boolean {
    if (set.size !== other.size()) {
        return false;
    }

    for (const v of set) {
        if (!other.contains(v)) {
            return false;
        }
    }

    return true;
}

/** `HashSet.hashCode()` of a set of `Integer`: the sum of the elements. */
function hashSetHashCode(set: Set<number>): number {
    let h = 0;
    for (const v of set) {
        h = (h + v) | 0;
    }

    return h;
}

describe('IntHashSetTest', () => {
    const INITIAL_CAPACITY = 100;

    let testSet: IntHashSet;

    beforeEach(() => {
        testSet = new IntHashSet(INITIAL_CAPACITY);
    });

    function addTwoElements(obj: IntHashSet | Set<number>): void {
        if (obj instanceof IntHashSet) {
            obj.add(1);
            obj.add(1001);
        } else {
            obj.add(1);
            obj.add(1001);
        }
    }

    function assertContainsElements(other: Iterable<number>): void {
        expect(sorted(other)).toEqual([1, 1001]);
    }

    function assertArrayContainingElements(result: unknown[]): void {
        expect(sorted(result)).toEqual([1, 1001]);
    }

    function assertIteratorHasElements(): void {
        const iter = testSet.iterator();

        const values = new Set<number>();

        expect(iter.hasNext()).toBe(true);
        values.add(iter.next());
        expect(iter.hasNext()).toBe(true);
        values.add(iter.next());
        expect(iter.hasNext()).toBe(false);

        assertContainsElements(values);
    }

    function assertIteratorHasElementsWithoutHasNext(): void {
        const iter = testSet.iterator();

        const values = new Set<number>();

        values.add(iter.next());
        values.add(iter.next());

        assertContainsElements(values);
    }

    function exhaustIterator(): void {
        const iterator = testSet.iterator();
        iterator.next();
        iterator.next();
        iterator.next();
    }

    it('initiallyContainsNoElements', () => {
        for (let i = 0; i < 10_000; i++) {
            expect(testSet.contains(i)).toBe(false);
        }
    });

    it('initiallyContainsNoBoxedElements', () => {
        for (let i = 0; i < 10_000; i++) {
            expect(testSet.contains(i)).toBe(false);
        }
    });

    it('containsAddedElement', () => {
        expect(testSet.add(1)).toBe(true);

        expect(testSet.contains(1)).toBe(true);
    });

    it('addingAnElementTwiceDoesNothing', () => {
        expect(testSet.add(1)).toBe(true);
        expect(testSet.size()).toBe(1);

        expect(testSet.add(1)).toBe(false);
        expect(testSet.size()).toBe(1);
    });

    it('containsAddedBoxedElements', () => {
        expect(testSet.add(1)).toBe(true);
        expect(testSet.add(2)).toBe(true);

        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
    });

    it('removingAnElementFromAnEmptyListDoesNothing', () => {
        expect(testSet.remove(0)).toBe(false);
    });

    it('removingAPresentElementRemovesIt', () => {
        expect(testSet.add(1)).toBe(true);

        expect(testSet.remove(1)).toBe(true);

        expect(testSet.contains(1)).toBe(false);
        expect(testSet.size()).toBe(0);
    });

    it('sizeIsInitiallyZero', () => {
        expect(testSet.size()).toBe(0);
    });

    it('sizeIncrementsWithNumberOfAddedElements', () => {
        addTwoElements(testSet);

        expect(testSet.size()).toBe(2);
    });

    it('sizeContainsNumberOfNewElements', () => {
        testSet.add(1);
        testSet.add(1);

        expect(testSet.size()).toBe(1);
    });

    it('iteratorsListElements', () => {
        addTwoElements(testSet);

        assertIteratorHasElements();
    });

    it('iteratorsStartFromTheBeginningEveryTime', () => {
        addTwoElements(testSet);
        assertIteratorHasElements();

        assertIteratorHasElements();
    });

    it('iteratorsListElementsWithoutHasNext', () => {
        addTwoElements(testSet);

        assertIteratorHasElementsWithoutHasNext();
    });

    it('iteratorsStartFromTheBeginningEveryTimeWithoutHasNext', () => {
        addTwoElements(testSet);
        assertIteratorHasElementsWithoutHasNext();

        assertIteratorHasElementsWithoutHasNext();
    });

    it('iteratorsThrowNoSuchElementException', () => {
        addTwoElements(testSet);

        assertThrows(NoSuchElementException, exhaustIterator);
    });

    it('iteratorsThrowNoSuchElementExceptionFromTheBeginningEveryTime', () => {
        addTwoElements(testSet);

        try {
            exhaustIterator();
        } catch (e) {
            if (!(e instanceof NoSuchElementException)) {
                throw e;
            }
        }

        assertThrows(NoSuchElementException, exhaustIterator);
    });

    it('iteratorHasNoElements', () => {
        expect(testSet.iterator().hasNext()).toBe(false);
    });

    it('iteratorThrowExceptionForEmptySet', () => {
        assertThrows(NoSuchElementException, () => testSet.iterator().next());
    });

    it('clearRemovesAllElementsOfTheSet', () => {
        addTwoElements(testSet);

        testSet.clear();

        expect(testSet.size()).toBe(0);
        expect(testSet.contains(1)).toBe(false);
        expect(testSet.contains(1001)).toBe(false);
    });

    it('differenceReturnsNullIfBothSetsEqual', () => {
        addTwoElements(testSet);

        const other = new IntHashSet(100);
        addTwoElements(other);

        expect(testSet.difference(other)).toBeNull();
    });

    it('differenceReturnsElementsOfTheOriginalSetThatNotContainedInTheOtherSet', () => {
        const other = new IntHashSet();
        other.add(10);
        other.add(1);
        other.add(5);
        other.add(42);
        const otherCopy = new IntHashSet();
        otherCopy.copy(other);
        testSet.add(1);
        testSet.add(3);
        testSet.add(5);
        testSet.add(21);

        const diff = testSet.difference(other);

        expect(diff).not.toBeNull();
        expect(diff!.size()).toBe(2);
        expect(diff!.contains(3)).toBe(true);
        expect(diff!.contains(21)).toBe(true);

        expect(otherCopy.equals(other)).toBe(true);
    });

    it('differenceReturnsASetWithOnlyAMissingValueIfItIsNotContainedInAnotherSet', () => {
        const one = new IntHashSet();
        one.add(1);
        one.add(5);
        const two = new IntHashSet();
        two.add(MISSING_VALUE);

        const diff = two.difference(one);

        expect(diff).not.toBeNull();
        expect(diff!.size()).toBe(1);
        expect(diff!.contains(MISSING_VALUE)).toBe(true);
        expect(diff!.contains(1)).toBe(false);
        expect(diff!.contains(5)).toBe(false);
    });

    it('differenceReturnsASetWithAMissingValueIfItIsNotContainedInAnotherSet', () => {
        const one = new IntHashSet();
        one.add(MISSING_VALUE);
        one.add(5);
        const two = new IntHashSet();
        two.add(2);

        const diff = one.difference(two);

        expect(diff).not.toBeNull();
        expect(diff!.size()).toBe(2);
        expect(diff!.contains(MISSING_VALUE)).toBe(true);
        expect(diff!.contains(5)).toBe(true);
        expect(diff!.contains(2)).toBe(false);
    });

    it('copiesOtherIntHashSet', () => {
        addTwoElements(testSet);

        const other = new IntHashSet(100);
        other.copy(testSet);

        assertContainsElements(other);
    });

    it('twoEmptySetsAreEqual', () => {
        const other = new IntHashSet(100);
        expect(testSet.equals(other)).toBe(true);
    });

    it('setsWithTheSameValuesAreEqual', () => {
        const other = new IntHashSet(100);

        addTwoElements(testSet);
        addTwoElements(other);

        expect(testSet.equals(other)).toBe(true);
    });

    it('setsWithTheDifferentSizesAreNotEqual', () => {
        const other = new IntHashSet(100);

        addTwoElements(testSet);

        other.add(1001);

        expect(testSet.equals(other)).toBe(false);
    });

    it('setsWithTheDifferentValuesAreNotEqual', () => {
        const other = new IntHashSet(100);

        addTwoElements(testSet);

        other.add(2);
        other.add(1001);

        expect(testSet.equals(other)).toBe(false);
    });

    it('twoEmptySetsHaveTheSameHashcode', () => {
        expect(testSet.hashCode()).toBe(new IntHashSet(100).hashCode());
    });

    it('setsWithTheSameValuesHaveTheSameHashcode', () => {
        const other = new IntHashSet(100);

        addTwoElements(testSet);

        addTwoElements(other);

        expect(testSet.hashCode()).toBe(other.hashCode());
    });

    it('reducesSizeWhenElementRemoved', () => {
        addTwoElements(testSet);

        testSet.remove(1001);

        expect(testSet.size()).toBe(1);
    });

    // Java stores into a String[]; a JS array has no element type, so the ArrayStoreException cannot be raised.
    it.skip('toArrayThrowsArrayStoreExceptionForWrongType', () => {});

    it('toArrayThrowsNullPointerExceptionForNullArgument', () => {
        const into = null as unknown as number[];
        assertThrows(NullPointerException, () => testSet.toArray(into));
    });

    it('toArrayCopiesElementsIntoSufficientlySizedArray', () => {
        addTwoElements(testSet);

        const result = testSet.toArray(new Array<number>(testSet.size()));

        assertArrayContainingElements(result);
    });

    it('toArrayCopiesElementsIntoNewArray', () => {
        addTwoElements(testSet);

        const result = testSet.toArray(new Array<number>(testSet.size()));

        assertArrayContainingElements(result);
    });

    it('toArraySupportsEmptyCollection', () => {
        const result = testSet.toArray(new Array<number>(testSet.size()));

        expect(result).toEqual([]);
    });

    // Test case from usage bug.
    it('chainCompactionShouldNotCauseElementsToBeMovedBeforeTheirHash', () => {
        const requiredFields = new IntHashSet(14);

        requiredFields.add(8);
        requiredFields.add(9);
        requiredFields.add(35);
        requiredFields.add(49);
        requiredFields.add(56);

        expect(requiredFields.remove(8), 'Failed to remove 8').toBe(true);
        expect(requiredFields.remove(9), 'Failed to remove 9').toBe(true);

        expect(sorted(requiredFields)).toEqual([35, 49, 56]);
    });

    it('shouldResizeWhenItHitsCapacity', () => {
        for (let i = 0; i < 2 * INITIAL_CAPACITY; i++) {
            expect(testSet.add(i)).toBe(true);
        }

        for (let i = 0; i < 2 * INITIAL_CAPACITY; i++) {
            expect(testSet.contains(i)).toBe(true);
        }
    });

    it('containsEmptySet', () => {
        const other = new IntHashSet(100);

        expect(testSet.containsAll(other)).toBe(true);
        expect(testSet.containsAll(other as Iterable<unknown>)).toBe(true);
    });

    it('containsSubset', () => {
        addTwoElements(testSet);

        const subset = new IntHashSet(100);

        subset.add(1);

        expect(testSet.containsAll(subset)).toBe(true);
        expect(testSet.containsAll(subset as Iterable<unknown>)).toBe(true);
    });

    it('doesNotContainDisjointSet', () => {
        addTwoElements(testSet);

        const other = new IntHashSet(100);

        other.add(1);
        other.add(1002);

        expect(testSet.containsAll(other)).toBe(false);
        expect(testSet.containsAll(other as Iterable<unknown>)).toBe(false);
    });

    it('doesNotContainSuperset', () => {
        addTwoElements(testSet);

        const superset = new IntHashSet(100);

        addTwoElements(superset);
        superset.add(15);

        expect(testSet.containsAll(superset)).toBe(false);
        expect(testSet.containsAll(superset as Iterable<unknown>)).toBe(false);
    });

    it('addingEmptySetDoesNothing', () => {
        addTwoElements(testSet);

        expect(testSet.addAll(new IntHashSet(100))).toBe(false);
        expect(testSet.addAll(new Set<number>())).toBe(false);
        assertContainsElements(testSet);
    });

    it('addingSubsetDoesNothing', () => {
        addTwoElements(testSet);

        const subset = new IntHashSet(100);

        subset.add(1);

        const subSetCollection = new Set<number>(subset);

        expect(testSet.addAll(subset)).toBe(false);
        expect(testSet.addAll(subSetCollection)).toBe(false);
        assertContainsElements(testSet);
    });

    it('addingEqualSetDoesNothing', () => {
        addTwoElements(testSet);

        const equal = new IntHashSet(100);

        addTwoElements(equal);

        const equalCollection = new Set<number>(equal);

        expect(testSet.addAll(equal)).toBe(false);
        expect(testSet.addAll(equalCollection)).toBe(false);
        assertContainsElements(testSet);
    });

    it('containsValuesAddedFromDisjointSetPrimitive', () => {
        addTwoElements(testSet);

        const disjoint = new IntHashSet(100);

        disjoint.add(2);
        disjoint.add(1002);

        expect(testSet.addAll(disjoint)).toBe(true);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(disjoint)).toBe(true);
    });

    it('containsValuesAddedFromDisjointSet', () => {
        addTwoElements(testSet);

        const disjoint = new Set<number>();

        disjoint.add(2);
        disjoint.add(1002);

        expect(testSet.addAll(disjoint)).toBe(true);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(disjoint)).toBe(true);
    });

    it('containsValuesAddedFromIntersectingSetPrimitive', () => {
        addTwoElements(testSet);

        const intersecting = new IntHashSet(100);

        intersecting.add(1);
        intersecting.add(1002);

        expect(testSet.addAll(intersecting)).toBe(true);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(intersecting)).toBe(true);
    });

    it('containsValuesAddedFromIntersectingSet', () => {
        addTwoElements(testSet);

        const intersecting = new Set<number>();

        intersecting.add(1);
        intersecting.add(1002);

        expect(testSet.addAll(intersecting)).toBe(true);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(intersecting)).toBe(true);
    });

    it('removingEmptySetDoesNothing', () => {
        addTwoElements(testSet);

        expect(testSet.removeAll(new IntHashSet(100))).toBe(false);
        expect(testSet.removeAll(new Set<number>())).toBe(false);
        assertContainsElements(testSet);
    });

    it('removingDisjointSetDoesNothing', () => {
        addTwoElements(testSet);

        const disjoint = new IntHashSet(100);

        disjoint.add(2);
        disjoint.add(1002);

        expect(testSet.removeAll(disjoint)).toBe(false);
        expect(testSet.removeAll(new Set<number>())).toBe(false);
        assertContainsElements(testSet);
    });

    it('doesNotContainRemovedIntersectingSetPrimitive', () => {
        addTwoElements(testSet);

        const intersecting = new IntHashSet(100);

        intersecting.add(1);
        intersecting.add(1002);

        expect(testSet.removeAll(intersecting)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(intersecting)).toBe(false);
    });

    it('doesNotContainRemovedIntersectingSet', () => {
        addTwoElements(testSet);

        const intersecting = new Set<number>();

        intersecting.add(1);
        intersecting.add(1002);

        expect(testSet.removeAll(intersecting)).toBe(true);
        expect(testSet.contains(1001)).toBe(true);
        expect(testSet.containsAll(intersecting)).toBe(false);
    });

    it('isEmptyAfterRemovingEqualSetPrimitive', () => {
        addTwoElements(testSet);

        const equal = new IntHashSet(100);

        addTwoElements(equal);

        expect(testSet.removeAll(equal)).toBe(true);
        expect(testSet.isEmpty()).toBe(true);
    });

    it('isEmptyAfterRemovingEqualSet', () => {
        addTwoElements(testSet);

        const equal = new Set<number>();

        addTwoElements(equal);

        expect(testSet.removeAll(equal)).toBe(true);
        expect(testSet.isEmpty()).toBe(true);
    });

    it('removeElementsFromIterator', () => {
        addTwoElements(testSet);

        const iterator: IntHashSetIntIterator = testSet.iterator();
        while (iterator.hasNext()) {
            if (iterator.nextValue() === 1) {
                iterator.remove();
            }
        }

        expect([...testSet]).toEqual([1001]);
        expect(testSet.size()).toBe(1);
    });

    it('shouldNotContainMissingValueInitially', () => {
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('shouldAllowMissingValue', () => {
        expect(testSet.add(MISSING_VALUE)).toBe(true);

        expect(testSet.contains(MISSING_VALUE)).toBe(true);

        expect(testSet.add(MISSING_VALUE)).toBe(false);
    });

    it('shouldAllowRemovalOfMissingValue', () => {
        expect(testSet.add(MISSING_VALUE)).toBe(true);

        expect(testSet.remove(MISSING_VALUE)).toBe(true);

        expect(testSet.contains(MISSING_VALUE)).toBe(false);

        expect(testSet.remove(MISSING_VALUE)).toBe(false);
    });

    it('sizeAccountsForMissingValue', () => {
        testSet.add(1);
        testSet.add(MISSING_VALUE);

        expect(testSet.size()).toBe(2);
    });

    it('toArrayCopiesElementsIntoNewArrayIncludingMissingValue', () => {
        addTwoElements(testSet);

        testSet.add(MISSING_VALUE);

        const result = testSet.toArray(new Array<number>(testSet.size()));

        expect(sorted(result)).toEqual([MISSING_VALUE, 1, 1001]);
    });

    it('toObjectArrayCopiesElementsIntoNewArrayIncludingMissingValue', () => {
        addTwoElements(testSet);

        testSet.add(MISSING_VALUE);

        const result = testSet.toArray();

        expect(sorted(result)).toEqual([MISSING_VALUE, 1, 1001]);
    });

    it('equalsAccountsForMissingValue', () => {
        addTwoElements(testSet);
        testSet.add(MISSING_VALUE);

        const other = new IntHashSet(100);
        addTwoElements(other);

        expect(testSet.equals(other)).toBe(false);

        other.add(MISSING_VALUE);
        expect(testSet.equals(other)).toBe(true);

        testSet.remove(MISSING_VALUE);

        expect(testSet.equals(other)).toBe(false);
    });

    it('consecutiveValuesShouldBeCorrectlyStored', () => {
        for (let i = 0; i < 10_000; i++) {
            testSet.add(i);
        }

        expect(testSet.size()).toBe(10_000);
    });

    it('iteratorAccountsForMissingValue', () => {
        addTwoElements(testSet);
        testSet.add(MISSING_VALUE);

        let missingValueCount = 0;
        const iterator = testSet.iterator();
        while (iterator.hasNext()) {
            if (iterator.nextValue() === MISSING_VALUE) {
                missingValueCount++;
            }
        }

        expect(missingValueCount).toBe(1);
    });

    it('iteratorCanRemoveMissingValue', () => {
        addTwoElements(testSet);
        testSet.add(MISSING_VALUE);

        const iterator = testSet.iterator();
        while (iterator.hasNext()) {
            if (iterator.nextValue() === MISSING_VALUE) {
                iterator.remove();
            }
        }

        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('shouldGenerateStringRepresentation', () => {
        const set = new IntHashSet(16);
        const testEntries = [MISSING_VALUE, 3, 0, 1, -1, 19, 7, 11, 12, 7, -1, 3, 3, -1];

        for (const testEntry of testEntries) {
            set.add(testEntry);
        }

        const mapAsAString = '{-1, 12, 3, 7, 11, 1, 19, 0}';
        expect(set.toString()).toBe(mapAsAString);
    });

    it('shouldRemoveMissingValueWhenCleared', () => {
        expect(testSet.add(MISSING_VALUE)).toBe(true);

        testSet.clear();

        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('shouldHaveCompatibleEqualsAndHashcode', () => {
        const compatibleSet = new Set<number>();
        const seed = Date.now();
        // java.util.Random(seed).nextInt() is a 32-bit value; a seeded xorshift stands in for it.
        let state = seed | 0 || 1;
        const nextInt = (): number => {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return state | 0;
        };
        for (let i = 0; i < 1024; i++) {
            const value = nextInt();
            compatibleSet.add(value);
            testSet.add(value);
        }

        if ((nextInt() & 1) === 1) {
            compatibleSet.add(MISSING_VALUE);
            testSet.add(MISSING_VALUE);
        }

        // assertEquals(testSet, compatibleSet) is IntHashSet.equals(Set); assertEquals(compatibleSet, testSet) is
        // HashSet.equals(Set): the same size and every element contained.
        expect(testSet.equals(compatibleSet), 'Fail with seed:' + seed).toBe(true);
        expect(hashSetEquals(compatibleSet, testSet), 'Fail with seed:' + seed).toBe(true);
        expect(hashSetHashCode(compatibleSet), 'Fail with seed:' + seed).toBe(testSet.hashCode());
    });

    it('forEachIsANoOpIfTheSetIsEmpty', () => {
        const consumer = vi.fn<(v: number) => void>();

        testSet.forEach(consumer);

        expect(consumer).not.toHaveBeenCalled();
    });

    it('forEachShouldInvokeConsumerWithEveryValueAddedToTheSet', () => {
        const consumer = vi.fn<(v: number) => void>();

        testSet.add(15);
        testSet.add(-2);
        testSet.add(0);
        testSet.add(100);
        testSet.add(-8);

        testSet.forEach(consumer);

        expect(consumer.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([-8, -2, 0, 15, 100]);
        expect(consumer).toHaveBeenCalledTimes(5);
    });

    it('forEachShouldInvokeConsumerWithTheMissingValueAtTheIfOneWasAddedToTheSet', () => {
        const consumer = vi.fn<(v: number) => void>();

        testSet.add(MISSING_VALUE);
        testSet.add(15);
        testSet.add(MISSING_VALUE);

        testSet.forEach(consumer);

        expect(consumer.mock.calls).toEqual([[15], [MISSING_VALUE]]);
        expectInOrder([consumer, 0], [consumer, 1]);
    });

    it('forEachIntIsANoOpIfTheSetIsEmpty', () => {
        const consumer = vi.fn<(v: number) => void>();

        testSet.forEachInt(consumer);

        expect(consumer).not.toHaveBeenCalled();
    });

    it('forEachIntShouldInvokeConsumerWithEveryValueAddedToTheSet', () => {
        const set = new IntHashSet(1);
        const consumer = vi.fn<(v: number) => void>();

        set.add(-999);
        set.add(-2);
        set.add(0);
        set.add(1000);
        set.add(-8);

        set.forEachInt(consumer);

        expect(consumer.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([-999, -8, -2, 0, 1000]);
        expect(consumer).toHaveBeenCalledTimes(5);
    });

    it('forEachIntShouldInvokeConsumerWithTheMissingValueAtTheIfOneWasAddedToTheSet', () => {
        const set = new IntHashSet(5);
        const consumer = vi.fn<(v: number) => void>();

        set.add(MISSING_VALUE);
        set.add(44);

        set.forEachInt(consumer);

        expect(consumer.mock.calls).toEqual([[44], [MISSING_VALUE]]);
        expectInOrder([consumer, 0], [consumer, 1]);
    });

    it('retainAllCollectionIsANoOpIfCollectionHasAllOfTheElementsFromTheSet', () => {
        const coll = [0, 5, -3, 42, 21, MISSING_VALUE];
        testSet.add(MISSING_VALUE);
        testSet.add(42);
        testSet.add(-3);

        expect(testSet.retainAll(coll)).toBe(false);

        expect(testSet.size()).toBe(3);
        expect(testSet.contains(MISSING_VALUE)).toBe(true);
        expect(testSet.contains(42)).toBe(true);
        expect(testSet.contains(-3)).toBe(true);
    });

    it('retainAllCollectionRemovesNonMissingValuesNotFoundInAGivenCollection', () => {
        const coll = [100, 5, 21, 8];
        testSet.add(0);
        testSet.add(8);
        testSet.add(100);
        testSet.add(-999);

        expect(testSet.retainAll(coll)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(8)).toBe(true);
        expect(testSet.contains(100)).toBe(true);
        expect(testSet.contains(-999)).toBe(false);
        expect(testSet.contains(0)).toBe(false);
    });

    it('retainAllCollectionRemovesMissingValueWhichWasAddedToTheSet', () => {
        const coll = [42, 42, 42, 500];
        testSet.add(MISSING_VALUE);
        testSet.add(42);

        expect(testSet.retainAll(coll)).toBe(true);

        expect(testSet.size()).toBe(1);
        expect(testSet.contains(42)).toBe(true);
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('retainAllIsANoOpIfCollectionHasAllOfTheElementsFromTheSet', () => {
        const coll = new IntHashSet(2);
        coll.addAll([0, 5, -3, 42, 21, MISSING_VALUE]);
        testSet.add(MISSING_VALUE);
        testSet.add(42);
        testSet.add(-3);

        expect(testSet.retainAll(coll)).toBe(false);

        expect(testSet.size()).toBe(3);
        expect(testSet.contains(MISSING_VALUE)).toBe(true);
        expect(testSet.contains(42)).toBe(true);
        expect(testSet.contains(-3)).toBe(true);
    });

    it('retainAllRemovesNonMissingValuesNotFoundInAGivenCollection', () => {
        const coll = new IntHashSet();
        coll.addAll([100, 5, 21, 8]);
        testSet.add(0);
        testSet.add(8);
        testSet.add(100);
        testSet.add(-999);

        expect(testSet.retainAll(coll)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(8)).toBe(true);
        expect(testSet.contains(100)).toBe(true);
        expect(testSet.contains(-999)).toBe(false);
        expect(testSet.contains(0)).toBe(false);
    });

    it('retainAllRemovesMissingValueWhichWasAddedToTheSet', () => {
        const coll = new IntHashSet(5);
        coll.addAll([42, 42, 42, -1, 500]);
        testSet.add(MISSING_VALUE);
        testSet.add(42);
        testSet.add(500);

        expect(testSet.retainAll(coll)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(42)).toBe(true);
        expect(testSet.contains(500)).toBe(true);
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('removeAllIsANoOpIfTwoCollectionsHaveNoValuesInCommon', () => {
        const other = new IntHashSet(10);
        other.add(4);
        other.add(5);
        other.add(100);
        testSet.add(1);
        testSet.add(2);
        testSet.add(MISSING_VALUE);

        expect(testSet.removeAll(other)).toBe(false);

        expect(testSet.size()).toBe(3);
        expect(testSet.contains(MISSING_VALUE)).toBe(true);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
    });

    it('removeAllRemovesMissingValueOfTheOtherSet', () => {
        const other = new IntHashSet(10);
        other.add(4);
        other.add(5);
        other.add(MISSING_VALUE);
        testSet.add(1);
        testSet.add(2);
        testSet.add(MISSING_VALUE);

        expect(testSet.removeAll(other)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('removeIfIntIsANoOpIfNoValuesMatchFilter', () => {
        const filter = (v: number): boolean => v < 0;
        testSet.add(1);
        testSet.add(2);
        testSet.add(0);

        expect(testSet.removeIfInt(filter)).toBe(false);

        expect(testSet.size()).toBe(3);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
        expect(testSet.contains(0)).toBe(true);
    });

    it('removeIfIntDeletesAllMatchingValues', () => {
        const filter = (v: number): boolean => v < 1;
        testSet.add(1);
        testSet.add(2);
        testSet.add(-2);
        testSet.add(MISSING_VALUE);

        expect(testSet.removeIfInt(filter)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('removeIfIsANoOpIfNoValuesMatchFilter', () => {
        const filter = (v: number): boolean => v < 0;
        testSet.add(1);
        testSet.add(2);
        testSet.add(0);

        expect(testSet.removeIf(filter)).toBe(false);

        expect(testSet.size()).toBe(3);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(2)).toBe(true);
        expect(testSet.contains(0)).toBe(true);
    });

    it('removeIfDeletesAllMatchingValues', () => {
        const filter = (v: number): boolean => v < 0;
        testSet.add(1);
        testSet.add(-2);
        testSet.add(MISSING_VALUE);
        testSet.add(-1);

        expect(testSet.removeIf(filter)).toBe(true);

        expect(testSet.size()).toBe(2);
        expect(testSet.contains(1)).toBe(true);
        expect(testSet.contains(MISSING_VALUE)).toBe(true);
        expect(testSet.contains(-1)).toBe(false);
    });

    it('addAllShouldAddOnlyNonMissingValuesIfTheSourceListDoesNotContainExplicitMissingValue', () => {
        const other = new IntHashSet(5);
        other.add(1);
        other.add(2);
        other.add(3);
        other.add(4);
        other.add(5);
        testSet.add(1);
        testSet.add(5);
        testSet.add(MISSING_VALUE);

        expect(testSet.addAll(other)).toBe(true);

        expect(testSet.size()).toBe(6);
        for (let i = 1; i <= 5; i++) {
            expect(testSet.contains(i)).toBe(true);
        }
        expect(testSet.contains(MISSING_VALUE)).toBe(true);
    });

    it('addAllShouldAddMissingValueFromAnotherSet', () => {
        const other = new IntHashSet(5);
        other.add(1);
        other.add(2);
        other.add(3);
        testSet.add(-1);

        expect(testSet.addAll(other)).toBe(true);

        expect(testSet.size()).toBe(4);
        for (let i = 1; i <= 3; i++) {
            expect(testSet.contains(i)).toBe(true);
        }
        expect(testSet.contains(MISSING_VALUE)).toBe(false);
    });

    it('containsAllReturnsTrueIfTheSetContainsAllNonMissingValues', () => {
        const other = new IntHashSet(2);
        other.add(0);
        other.add(2);
        other.add(4);
        other.add(6);
        testSet.add(MISSING_VALUE);
        for (let i = 0; i < 9; i++) {
            testSet.add(i);
        }

        expect(testSet.containsAll(other)).toBe(true);
    });

    it('containsAllReturnsTrueIfTheSetContainsTheMissingValueOfAnotherSet', () => {
        const other = new IntHashSet(2);
        other.add(9);
        testSet.add(9);

        expect(testSet.containsAll(other)).toBe(true);
    });

    it.each([1, 10, 100, 1000])('retainAllWithAnotherIntHashSet %i', (capacity) => {
        const set1 = new IntHashSet(capacity);
        set1.add(9);
        for (let i = 0; i < capacity; i++) {
            set1.add(10 + Math.floor(Math.random() * (0x7fffffff - 10)));
        }
        set1.add(MISSING_VALUE);
        const actualCapacity = set1.capacity();

        const set2 = new IntHashSet();
        set2.add(8);
        set2.add(9);

        expect(set1.retainAll(set2)).toBe(true);

        expect(set1.size()).toBe(1);
        expect(set1.contains(9)).toBe(true);
        expect(set1.contains(MISSING_VALUE)).toBe(false);
        expect(set1.capacity()).toBe(actualCapacity);
    });

    it.each([1, 10, 100, 1000])('retainAllWithCollection %i', (capacity) => {
        const set = new IntHashSet(capacity);
        set.add(9);
        for (let i = 0; i < capacity; i++) {
            set.add(10 + Math.floor(Math.random() * (0x7fffffff - 10)));
        }
        set.add(MISSING_VALUE);
        const actualCapacity = set.capacity();

        const list = [8, 9];

        expect(set.retainAll(list)).toBe(true);

        expect(set.size()).toBe(1);
        expect(set.contains(9)).toBe(true);
        expect(set.contains(MISSING_VALUE)).toBe(false);
        expect(set.capacity()).toBe(actualCapacity);
    });

    it('removeIfIntUsingDefaults', () => {
        const set = new IntHashSet();
        set.add(4);
        set.add(5);

        expect(set.removeIfInt(() => true)).toBe(true);

        expect(set.size()).toBe(0);
    });

    it('removeIfUsingDefaults', () => {
        const set = new IntHashSet();
        set.add(4);
        set.add(5);

        expect(set.removeIf(() => true)).toBe(true);

        expect(set.size()).toBe(0);
    });

    it('removeIfInt', () => {
        const set = new IntHashSet();
        set.add(4);
        set.add(5);
        set.add(MISSING_VALUE);

        expect(set.removeIfInt((i) => 5 === i)).toBe(true);

        expect(set.size()).toBe(2);
        expect(set.contains(5)).toBe(false);
        expect(set.contains(4)).toBe(true);
        expect(set.contains(MISSING_VALUE)).toBe(true);
    });

    it('removeIf', () => {
        const set = new IntHashSet();
        set.add(4);
        set.add(5);
        set.add(MISSING_VALUE);

        expect(set.removeIf((i) => 5 === i)).toBe(true);

        expect(set.size()).toBe(2);
        expect(set.contains(5)).toBe(false);
        expect(set.contains(4)).toBe(true);
        expect(set.contains(MISSING_VALUE)).toBe(true);
    });

    it('retailAllIntHashSetWhenNumberOfRemainingElementsIsAPowerOfTwo', () => {
        const set = new IntHashSet(16, 0.9, true);
        set.addAll([3, 8, 13, 10, 17, 2, 18, 38, 7, 21, 16, 99]);
        expect(set.size()).toBe(12);
        expect(set.capacity()).toBe(16);

        const other = new IntHashSet();
        other.addAll([8, 10, 2, 18, 7, 21, 16, 99]);

        expect(set.retainAll(other)).toBe(true);
        expect(set.size()).toBe(8);
        expect(set.capacity()).toBe(16);

        other.forEachInt((v) => expect(set.contains(v)).toBe(true));
        expect(set.contains(3)).toBe(false);
        expect(set.contains(13)).toBe(false);
        expect(set.contains(17)).toBe(false);
        expect(set.contains(38)).toBe(false);
    });

    it('retailAllCollectionWhenNumberOfRemainingElementsIsAPowerOfTwo', () => {
        const set = new IntHashSet(16, 0.9, true);
        set.addAll([3, 8, 13, 10, 17, 2, 18, 38, 7, 21, 16, 99]);
        expect(set.size()).toBe(12);
        expect(set.capacity()).toBe(16);

        const other = [8, 10, 2, 18, 7, 21, 16, 99];

        expect(set.retainAll(other)).toBe(true);
        expect(set.size()).toBe(8);
        expect(set.capacity()).toBe(16);

        for (const v of other) {
            expect(set.contains(v)).toBe(true);
        }
        expect(set.contains(3)).toBe(false);
        expect(set.contains(13)).toBe(false);
        expect(set.contains(17)).toBe(false);
        expect(set.contains(38)).toBe(false);
    });
});
