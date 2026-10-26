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
// Port of org/agrona/collections/Int2IntCounterMap.java @ Agrona 2.6.1, over a JS Map (control plane only, see docs/mapping.md)
import { IllegalArgumentException } from '../jdk.js';

/**
 * Map for counters keyed by an `int`, which reads and updates the counter of a key that has none as the
 * {@link initialValue}. A counter that is updated to the initial value is removed, so {@link size} and {@link isEmpty}
 * count only the keys that hold another value.
 * <p>
 * Java's open addressing arrays are a JS `Map` here: the only users are the reference counts of the receive channel
 * endpoint, which the conductor updates when it adds and removes a subscription (control plane, never per message).
 */
export class Int2IntCounterMap {
    private readonly counters = new Map<number, number>();
    private readonly initial: number;

    /**
     * Construct a map with the given initial value.
     *
     * @param initialValue the value that a key without a counter reads as, an `int`.
     */
    public constructor(initialValue: number) {
        this.initial = initialValue | 0;
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
        return this.counters.size;
    }

    /**
     * Is the map empty?
     *
     * @return size == 0
     */
    public isEmpty(): boolean {
        return 0 === this.counters.size;
    }

    /**
     * Get the value of a counter associated with a key or {@link initialValue} if not found.
     *
     * @param key to lookup.
     * @return counter value associated with key or {@link initialValue} if not found.
     */
    public get(key: number): number {
        return this.counters.get(key | 0) ?? this.initial;
    }

    /**
     * Put the value for a key in the map.
     *
     * @param key   lookup key.
     * @param value new value, must not be initialValue.
     * @return current counter value associated with key, or {@link initialValue} if none found.
     * @throws IllegalArgumentException if value is {@link initialValue}.
     */
    public put(key: number, value: number): number {
        if (this.initial === (value | 0)) {
            throw new IllegalArgumentException('cannot accept initialValue');
        }

        const oldValue = this.get(key);
        this.counters.set(key | 0, value | 0);

        return oldValue;
    }

    /**
     * Convenience version of {@link addAndGet} (key, 1).
     *
     * @param key for the counter.
     * @return the new value.
     */
    public incrementAndGet(key: number): number {
        return this.addAndGet(key, 1);
    }

    /**
     * Convenience version of {@link addAndGet} (key, -1).
     *
     * @param key for the counter.
     * @return the new value.
     */
    public decrementAndGet(key: number): number {
        return this.addAndGet(key, -1);
    }

    /**
     * Add amount to the current value associated with this key. If no such value exists use {@link initialValue} as
     * current value and associate key with {@link initialValue} + amount unless amount is 0, in which case map remains
     * unchanged.
     *
     * @param key    new or existing
     * @param amount to be added
     * @return the new value associated with the key, or {@link initialValue} + amount if no mapping for key.
     */
    public addAndGet(key: number, amount: number): number {
        return (this.getAndAdd(key, amount) + amount) | 0;
    }

    /**
     * Convenience version of {@link getAndAdd} (key, 1).
     *
     * @param key for the counter.
     * @return the old value.
     */
    public getAndIncrement(key: number): number {
        return this.getAndAdd(key, 1);
    }

    /**
     * Convenience version of {@link getAndAdd} (key, -1).
     *
     * @param key for the counter.
     * @return the old value.
     */
    public getAndDecrement(key: number): number {
        return this.getAndAdd(key, -1);
    }

    /**
     * Add amount to the current value associated with this key. If no such value exists use {@link initialValue} as
     * current value and associate key with {@link initialValue} + amount unless amount is 0, in which case map remains
     * unchanged. A counter that reaches the initial value is removed.
     *
     * @param key    new or existing.
     * @param amount to be added.
     * @return the previous value associated with the key, or {@link initialValue} if no mapping for key.
     */
    public getAndAdd(key: number, amount: number): number {
        const oldValue = this.get(key);
        if (0 !== amount) {
            const newValue = (oldValue + amount) | 0;
            if (this.initial === newValue) {
                this.counters.delete(key | 0);
            } else {
                this.counters.set(key | 0, newValue);
            }
        }

        return oldValue;
    }

    /**
     * Does the map contain a counter for the key?
     *
     * @param key to check.
     * @return true if the key holds a value other than the initial value.
     */
    public containsKey(key: number): boolean {
        return this.counters.has(key | 0);
    }

    /**
     * Remove the counter of a key.
     *
     * @param key to remove.
     * @return the value of the counter, or {@link initialValue} if there was none.
     */
    public remove(key: number): number {
        const oldValue = this.get(key);
        this.counters.delete(key | 0);

        return oldValue;
    }

    /**
     * Clear out all entries.
     */
    public clear(): void {
        this.counters.clear();
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        const entries: string[] = [];
        for (const [key, value] of this.counters) {
            entries.push(key + '->' + value);
        }

        return '{' + entries.join(', ') + '}';
    }
}
