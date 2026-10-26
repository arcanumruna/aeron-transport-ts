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
// Extra tests of T13 (port-only): `Int2IntCounterMap` and `LongHalves2LongCounterMap`, the counter maps that count the
// references of a receive channel endpoint, against the behaviour of Agrona's `Int2IntCounterMap`: a key reads as the
// initial value until it is updated, an update to the initial value removes the entry, and `put` of the initial value is
// refused. Compared with a model for a seeded random sequence of operations.
import { describe, expect, it } from 'vitest';
import { Int2IntCounterMap } from '../../../../src/agrona/collections/Int2IntCounterMap.js';
import { LongHalves2LongCounterMap } from '../../../../src/agrona/collections/LongHalves2LongCounterMap.js';
import { IllegalArgumentException, Integer } from '../../../../src/agrona/jdk.js';
import { assertThrows } from '../../../support/Assertions.js';
import { mulberry32 } from '../../../support/Random.js';

describe('Int2IntCounterMap', () => {
    it('reads the initial value for a key without a counter, and counts up and down', () => {
        const map = new Int2IntCounterMap(0);
        expect(map.initialValue()).toBe(0);
        expect(map.get(7)).toBe(0);
        expect(map.isEmpty()).toBe(true);

        expect(map.incrementAndGet(7)).toBe(1);
        expect(map.incrementAndGet(7)).toBe(2);
        expect(map.size()).toBe(1);
        expect(map.getAndIncrement(7)).toBe(2);
        expect(map.getAndDecrement(7)).toBe(3);
        expect(map.decrementAndGet(7)).toBe(1);
        expect(map.decrementAndGet(7)).toBe(0);
        expect(map.isEmpty()).toBe(true); // an entry at the initial value is removed (mutation: it stays)
        expect(map.containsKey(7)).toBe(false);
    });

    it('a decrement of a key without a counter is -1 and leaves an entry, as Java does; remove takes it out', () => {
        const map = new Int2IntCounterMap(0);
        expect(map.decrementAndGet(5)).toBe(-1);
        expect(map.size()).toBe(1);
        expect(map.remove(5)).toBe(-1);
        expect(map.isEmpty()).toBe(true);
        expect(map.remove(5)).toBe(0);
    });

    it('works with a nonzero initial value: the value at the initial value is the absent one', () => {
        const map = new Int2IntCounterMap(10);
        expect(map.get(1)).toBe(10);
        expect(map.addAndGet(1, 5)).toBe(15);
        expect(map.addAndGet(1, -5)).toBe(10);
        expect(map.isEmpty()).toBe(true);
        expect(map.addAndGet(2, 0)).toBe(10); // amount 0: unchanged
        expect(map.isEmpty()).toBe(true);
        expect(assertThrows(IllegalArgumentException, () => map.put(3, 10)).message).toBe('cannot accept initialValue');
        expect(map.put(3, 11)).toBe(10);
        expect(map.put(3, 12)).toBe(11);
        expect(map.get(3)).toBe(12);
        expect(map.toString()).toBe('{3->12}');
        map.clear();
        expect(map.isEmpty()).toBe(true);
    });

    it('wraps like an int and takes the extreme keys', () => {
        const map = new Int2IntCounterMap(0);
        expect(map.addAndGet(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(Integer.MAX_VALUE);
        expect(map.addAndGet(Integer.MIN_VALUE, 1)).toBe(Integer.MIN_VALUE);
        expect(map.addAndGet(Integer.MAX_VALUE, 1)).toBe(1);
        expect(map.size()).toBe(2);
    });

    it('agrees with a model over a seeded random sequence', () => {
        const random = mulberry32(20261026);
        const nextInt = (bound: number): number => Math.floor(random() * bound);
        const map = new Int2IntCounterMap(0);
        const model = new Map<number, number>();
        for (let i = 0; i < 20_000; i++) {
            const key = nextInt(8) - 4;
            const amount = nextInt(5) - 2;
            const expected = (model.get(key) ?? 0) + amount;
            expect(map.addAndGet(key, amount)).toBe(expected);
            if (0 === expected) {
                model.delete(key);
            } else {
                model.set(key, expected);
            }
            expect(map.size()).toBe(model.size);
            expect(map.get(key)).toBe(model.get(key) ?? 0);
        }
    });
});

describe('LongHalves2LongCounterMap', () => {
    it('keys by both halves: the same low half under another high half is another counter', () => {
        const map = new LongHalves2LongCounterMap(0);
        expect(map.incrementAndGet(1, 2)).toBe(1);
        expect(map.incrementAndGet(2, 1)).toBe(1);
        expect(map.incrementAndGet(1, 2)).toBe(2);
        expect(map.get(1, 2)).toBe(2);
        expect(map.get(2, 1)).toBe(1);
        expect(map.get(0, 2)).toBe(0);
        expect(map.size()).toBe(2);
        expect(map.containsKey(2, 1)).toBe(true);

        expect(map.decrementAndGet(2, 1)).toBe(0);
        expect(map.containsKey(2, 1)).toBe(false);
        expect(map.size()).toBe(1);
        expect(map.remove(1, 2)).toBe(2);
        expect(map.isEmpty()).toBe(true);
    });

    it('takes the extreme halves, and refuses a put of the initial value', () => {
        const map = new LongHalves2LongCounterMap(0);
        expect(map.addAndGet(Integer.MIN_VALUE, Integer.MAX_VALUE, 3)).toBe(3);
        expect(map.addAndGet(Integer.MAX_VALUE, Integer.MIN_VALUE, 4)).toBe(4);
        expect(map.addAndGet(-1, -1, 5)).toBe(5);
        expect(map.get(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(3);
        expect(map.size()).toBe(3);
        expect(assertThrows(IllegalArgumentException, () => map.put(1, 1, 0)).message).toBe(
            'cannot accept initialValue',
        );
        expect(map.put(1, 1, 9)).toBe(0);
        expect(map.getAndAdd(1, 1, -9)).toBe(9);
        expect(map.containsKey(1, 1)).toBe(false);
        expect(map.addAndGet(8, 8, 0)).toBe(0);
        expect(map.containsKey(8, 8)).toBe(false);
        map.clear();
        expect(map.isEmpty()).toBe(true);
        expect(map.initialValue()).toBe(0);
        expect(typeof map.toString()).toBe('string');
    });

    it('agrees with a model over a seeded random sequence of 64-bit keys', () => {
        const random = mulberry32(77);
        const nextInt = (bound: number): number => Math.floor(random() * bound);
        const map = new LongHalves2LongCounterMap(0);
        const model = new Map<string, number>();
        const keys: [number, number][] = [
            [0, 0],
            [0, -1],
            [-1, 0],
            [Integer.MIN_VALUE, Integer.MAX_VALUE],
            [Integer.MAX_VALUE, Integer.MIN_VALUE],
            [1 << 21, 5],
            [5, 1 << 21],
            [123456789, -987654321],
        ];
        for (let i = 0; i < 20_000; i++) {
            const [hi, lo] = keys[nextInt(keys.length)] as [number, number];
            const amount = nextInt(5) - 2;
            const id = hi + ':' + lo;
            const expected = (model.get(id) ?? 0) + amount;
            expect(map.addAndGet(hi, lo, amount)).toBe(expected);
            if (0 === expected) {
                model.delete(id);
            } else {
                model.set(id, expected);
            }
            expect(map.size()).toBe(model.size);
            expect(map.get(hi, lo)).toBe(model.get(id) ?? 0);
        }
    });
});
