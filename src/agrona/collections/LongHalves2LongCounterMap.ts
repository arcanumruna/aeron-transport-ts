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
// Port of org/agrona/collections/Int2IntCounterMap.java @ Agrona 2.6.1, as generated for long in Agrona's build
// (Long2LongCounterMap.java), over LongHalves2LongHashMap: (hi, lo) key variant, spec D14
import { IllegalArgumentException } from '../jdk.js';
import { LongHalves2LongHashMap } from './LongHalves2LongHashMap.js';

/**
 * Map for counters keyed by the two `int` halves of a `long` (spec D14), which reads and updates the counter of a key
 * that has none as the {@link initialValue}. A counter that is updated to the initial value is removed, so
 * {@link size} and {@link isEmpty} count only the keys that hold another value.
 * <p>
 * The only user is the reference count by stream id and session id of the receive channel endpoint, whose key
 * `Hashing.compoundKey(streamId, sessionId)` is two `int`s here, as the key of `SendChannelEndpoint`'s publications.
 */
export class LongHalves2LongCounterMap {
    private readonly map: LongHalves2LongHashMap;
    private readonly initial: number;

    /**
     * Construct a map with the given initial value.
     *
     * @param initialValue the value that a key without a counter reads as.
     */
    public constructor(initialValue: number) {
        this.initial = initialValue;
        this.map = new LongHalves2LongHashMap(initialValue);
    }

    /**
     * The value to which a key without a counter is set.
     *
     * @return the initial value.
     */
    public initialValue(): number {
        return this.initial;
    }

    /**
     * The number of keys that hold a value other than the initial value.
     *
     * @return the number of keys.
     */
    public size(): number {
        return this.map.size();
    }

    /**
     * Is the map empty?
     *
     * @return size == 0
     */
    public isEmpty(): boolean {
        return this.map.isEmpty();
    }

    /**
     * Get the value of a counter associated with a key or {@link initialValue} if not found.
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @return counter value associated with key or {@link initialValue} if not found.
     */
    public get(keyHigh: number, keyLow: number): number {
        return this.map.get(keyHigh, keyLow);
    }

    /**
     * Put the value for a key in the map.
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @param value   new value, must not be initialValue.
     * @return current counter value associated with key, or {@link initialValue} if none found.
     * @throws IllegalArgumentException if value is {@link initialValue}.
     */
    public put(keyHigh: number, keyLow: number, value: number): number {
        if (this.initial === value) {
            throw new IllegalArgumentException('cannot accept initialValue');
        }

        return this.map.put(keyHigh, keyLow, value);
    }

    /**
     * Convenience version of {@link addAndGet} (key, 1).
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @return the new value.
     */
    public incrementAndGet(keyHigh: number, keyLow: number): number {
        return this.addAndGet(keyHigh, keyLow, 1);
    }

    /**
     * Convenience version of {@link addAndGet} (key, -1).
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @return the new value.
     */
    public decrementAndGet(keyHigh: number, keyLow: number): number {
        return this.addAndGet(keyHigh, keyLow, -1);
    }

    /**
     * Add amount to the current value associated with this key. If no such value exists use {@link initialValue} as
     * current value and associate key with {@link initialValue} + amount unless amount is 0, in which case map remains
     * unchanged.
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @param amount  to be added
     * @return the new value associated with the key, or {@link initialValue} + amount if no mapping for key.
     */
    public addAndGet(keyHigh: number, keyLow: number, amount: number): number {
        return this.getAndAdd(keyHigh, keyLow, amount) + amount;
    }

    /**
     * Add amount to the current value associated with this key. If no such value exists use {@link initialValue} as
     * current value and associate key with {@link initialValue} + amount unless amount is 0, in which case map remains
     * unchanged. A counter that reaches the initial value is removed.
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @param amount  to be added.
     * @return the previous value associated with the key, or {@link initialValue} if no mapping for key.
     */
    public getAndAdd(keyHigh: number, keyLow: number, amount: number): number {
        const oldValue = this.map.get(keyHigh, keyLow);
        if (0 !== amount) {
            const newValue = oldValue + amount;
            if (this.initial === newValue) {
                this.map.remove(keyHigh, keyLow);
            } else {
                this.map.put(keyHigh, keyLow, newValue);
            }
        }

        return oldValue;
    }

    /**
     * Does the map contain a counter for the key?
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @return true if the key holds a value other than the initial value.
     */
    public containsKey(keyHigh: number, keyLow: number): boolean {
        return this.map.containsKey(keyHigh, keyLow);
    }

    /**
     * Remove the counter of a key.
     *
     * @param keyHigh upper half of the key, an `int`.
     * @param keyLow  lower half of the key, an `int`.
     * @return the value of the counter, or {@link initialValue} if there was none.
     */
    public remove(keyHigh: number, keyLow: number): number {
        return this.map.remove(keyHigh, keyLow);
    }

    /**
     * Clear out all entries.
     */
    public clear(): void {
        this.map.clear();
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return this.map.toString();
    }
}
