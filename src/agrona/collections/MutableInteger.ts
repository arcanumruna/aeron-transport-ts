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
// Port of org/agrona/collections/MutableInteger.java @ Agrona 2.6.1
import { Integer } from '../jdk.js';

/**
 * Holder for an int value that is mutable. Useful for being a counter in a {@link java.util.Map} or for passing by
 * reference.
 * <p>
 * Java's {@code extends Number} and {@code implements Comparable} are the methods only: {@code byteValue},
 * {@code shortValue}, {@code intValue}, {@code longValue}, {@code floatValue}, {@code doubleValue} and
 * {@code compareTo}. The arithmetic wraps like an {@code int}.
 */
export class MutableInteger {
    /**
     * The value. Default value is {@code 0}.
     */
    public value = 0;

    /**
     * Creates an instance with a value, or {@code 0}.
     *
     * @param value to assign.
     */
    public constructor(value = 0) {
        this.value = value | 0;
    }

    /**
     * Get the value.
     *
     * @return the value.
     */
    public get(): number {
        return this.value;
    }

    /**
     * Set the value.
     *
     * @param value to be assigned.
     */
    public set(value: number): void {
        this.value = value | 0;
    }

    /**
     * Set and return the value.
     *
     * @param value to be assigned.
     * @return the value that was assigned.
     */
    public setAndGet(value: number): number {
        this.set(value);
        return this.value;
    }

    /**
     * Return value as {@code byte}.
     *
     * @return value as {@code byte}.
     */
    public byteValue(): number {
        return (this.value << 24) >> 24;
    }

    /**
     * Return value as {@code short}.
     *
     * @return value as {@code short}.
     */
    public shortValue(): number {
        return (this.value << 16) >> 16;
    }

    /**
     * Return value as {@code int}.
     *
     * @return value as {@code int}.
     */
    public intValue(): number {
        return this.value;
    }

    /**
     * Return value as {@code long}.
     *
     * @return value as {@code long}.
     */
    public longValue(): number {
        return this.value;
    }

    /**
     * Return value as {@code float}.
     *
     * @return value as {@code float}.
     */
    public floatValue(): number {
        return Math.fround(this.value);
    }

    /**
     * Return value as {@code double}.
     *
     * @return value as {@code double}.
     */
    public doubleValue(): number {
        return this.value;
    }

    /**
     * Increment the value.
     */
    public increment(): void {
        this.value = (this.value + 1) | 0;
    }

    /**
     * Increment and return the value.
     *
     * @return the value after increment.
     */
    public incrementAndGet(): number {
        return (this.value = (this.value + 1) | 0);
    }

    /**
     * Get and increment the value.
     *
     * @return the value before increment.
     */
    public getAndIncrement(): number {
        const result = this.value;
        this.value = (result + 1) | 0;
        return result;
    }

    /**
     * Decrement the value.
     */
    public decrement(): void {
        this.value = (this.value - 1) | 0;
    }

    /**
     * Decrement and get the value.
     *
     * @return value after the decrement.
     */
    public decrementAndGet(): number {
        return (this.value = (this.value - 1) | 0);
    }

    /**
     * Get the value and decrement it.
     *
     * @return the value before the decrement.
     */
    public getAndDecrement(): number {
        const result = this.value;
        this.value = (result - 1) | 0;
        return result;
    }

    /**
     * Get the value and add {@code delta} to it.
     *
     * @param delta to add.
     * @return the value before the change.
     */
    public getAndAdd(delta: number): number {
        const result = this.value;
        this.value = (result + delta) | 0;
        return result;
    }

    /**
     * Add the {@code delta} and get the value.
     *
     * @param delta to add.
     * @return the value after the change.
     */
    public addAndGet(delta: number): number {
        return (this.value = (this.value + delta) | 0);
    }

    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (null === o || undefined === o || this.constructor !== (o as object).constructor) {
            return false;
        }

        const that = o as MutableInteger;

        return this.value === that.value;
    }

    public hashCode(): number {
        return this.value; // Integer.hashCode(value)
    }

    public toString(): string {
        return String(this.value);
    }

    public compareTo(that: MutableInteger): number {
        return MutableInteger.compare(this.value, that.value);
    }

    /**
     * Compare two values. Invoking this method is equivalent to:
     * <pre>
     *     Integer.compare(lhs, rhs);
     * </pre>
     *
     * @param lhs first value to compare.
     * @param rhs second value to compare.
     * @return zero if values are equal, negative value if {@code lhs} is less than {@code rhs} or
     * positive value otherwise.
     */
    public static compare(lhs: number, rhs: number): number {
        return Integer.compare(lhs, rhs);
    }
}
