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
// Port of org/agrona/concurrent/status/AtomicCounter.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { DirectBuffer } from '../../DirectBuffer.js';
import { IllegalStateException } from '../../jdk.js';
import type { AutoCloseable } from '../../jdkLang.js';
import type { MutableDirectBuffer } from '../../MutableDirectBuffer.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import type { CountersManager } from './CountersManager.js';
import { CountersReader } from './CountersReader.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * Atomic counter that is backed by an {@link AtomicBuffer} that can be read across threads and processes.
 * <p>
 * Java uses {@code Unsafe} on the byte array of the buffer; here every operation is the {@link AtomicBuffer}
 * operation of the same memory semantics at the offset of the counter, with no allocation. The counter is a Java
 * {@code long} held in a {@code number} (spec D5): an increment or an add that would leave +/-(2^53 - 1) throws
 * {@code RangeError} and changes nothing.
 */
export class AtomicCounter implements AutoCloseable {
    private _isClosed = false;
    private readonly _id: number = 0;
    private readonly buffer: AtomicBuffer;
    private readonly counterOffset: number = 0;
    private countersManager: CountersManager | null;

    /**
     * Map a counter over a buffer.
     *
     * @param buffer    containing the counter.
     * @param counterId identifier of the counter.
     */
    public constructor(buffer: AtomicBuffer, counterId: number);

    /**
     * Map a counter over a buffer. This version will free the counter on close.
     *
     * @param buffer          containing the counter.
     * @param counterId       identifier of the counter.
     * @param countersManager to be called to free the counter on close.
     */
    public constructor(buffer: AtomicBuffer, counterId: number, countersManager: CountersManager | null);

    public constructor(buffer: AtomicBuffer, counterId: number, countersManager: CountersManager | null = null) {
        this._id = counterId;
        this.countersManager = countersManager;
        this.buffer = buffer;

        const counterOffset = CountersReader.counterOffset(counterId);
        buffer.boundsCheck(counterOffset, SIZE_OF_LONG);
        this.counterOffset = counterOffset;
    }

    /**
     * Identity of the counter within the {@link CountersReader} and {@link CountersManager}.
     *
     * @return the identity of the counter within the {@link CountersReader} and {@link CountersManager}.
     */
    public id(): number {
        return this._id;
    }

    /**
     * Disconnect from the {@link CountersManager} so the counter is not freed on close.
     */
    public disconnectCountersManager(): void {
        this.countersManager = null;
    }

    /**
     * Free the counter slot for reuse and disconnect from the {@link CountersManager}, if it was set.
     */
    public close(): void {
        if (!this._isClosed) {
            this._isClosed = true;
            if (null !== this.countersManager) {
                this.countersManager.free(this._id);
            }
        }
    }

    /**
     * Has this counter been closed and thus no longer be used?
     *
     * @return true if it has been closed otherwise false.
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * Get the label for the counter if the {@link CountersManager} is present.
     *
     * @return the label for the counter, or null if not constructed with a {@link CountersManager}.
     */
    public label(): string | null {
        return null !== this.countersManager ? this.countersManager.getCounterLabel(this._id) : null;
    }

    /**
     * Update the label for the counter.
     *
     * @param newLabel to replace the existing label.
     * @throws IllegalStateException if not constructed with a {@link CountersManager}.
     */
    public updateLabel(newLabel: string): void {
        if (null !== this.countersManager) {
            this.countersManager.setCounterLabel(this._id, newLabel);
        } else {
            throw new IllegalStateException('Not constructed with CountersManager');
        }
    }

    /**
     * Append to the label for the counter.
     *
     * @param suffix to be appended to the existing label.
     * @return this for a fluent API.
     * @throws IllegalStateException if not constructed with a {@link CountersManager}.
     */
    public appendToLabel(suffix: string): AtomicCounter {
        if (null !== this.countersManager) {
            this.countersManager.appendToLabel(this._id, suffix);
        } else {
            throw new IllegalStateException('Not constructed with CountersManager');
        }

        return this;
    }

    /**
     * Update the key for the counter using a callback.
     *
     * @param keyFunc to update the key in the counter's record.
     * @throws IllegalStateException if not constructed with a {@link CountersManager}.
     */
    public updateKey(keyFunc: (keyBuffer: MutableDirectBuffer) => void): void;

    /**
     * Update the key for the counter by copying from a buffer.
     *
     * @param keyBuffer containing the new key.
     * @param offset    in the buffer at which the key begins.
     * @param length    of the key.
     * @throws IllegalStateException if not constructed with a {@link CountersManager}.
     */
    public updateKey(keyBuffer: DirectBuffer, offset: number, length: number): void;

    public updateKey(
        arg0: ((keyBuffer: MutableDirectBuffer) => void) | DirectBuffer,
        offset?: number,
        length?: number,
    ): void {
        if (null !== this.countersManager) {
            if ('function' === typeof arg0) {
                this.countersManager.setCounterKey(this._id, arg0);
            } else {
                this.countersManager.setCounterKey(this._id, arg0, offset!, length!);
            }
        } else {
            throw new IllegalStateException('Not constructed with CountersManager');
        }
    }

    /**
     * Perform an atomic increment that will not lose updates across threads.
     *
     * @return the previous value of the counter
     */
    public increment(): number {
        return this.buffer.getAndAddLong(this.counterOffset, 1);
    }

    /**
     * Perform an atomic increment that is not safe across threads.
     *
     * @return the previous value of the counter
     */
    public incrementOrdered(): number {
        return this.incrementRelease();
    }

    /**
     * Increment with release memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public incrementRelease(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongRelease(offset, currentValue + 1);

        return currentValue;
    }

    /**
     * Increment with opaque memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public incrementOpaque(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongOpaque(offset, currentValue + 1);

        return currentValue;
    }

    /**
     * Increment with plain memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public incrementPlain(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLong(offset, currentValue + 1);

        return currentValue;
    }

    /**
     * Perform an atomic decrement that will not lose updates across threads.
     *
     * @return the previous value of the counter
     */
    public decrement(): number {
        return this.buffer.getAndAddLong(this.counterOffset, -1);
    }

    /**
     * Perform an atomic decrement that is not safe across threads.
     *
     * @return the previous value of the counter
     */
    public decrementOrdered(): number {
        return this.decrementRelease();
    }

    /**
     * Decrement with release memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public decrementRelease(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongRelease(offset, currentValue - 1);

        return currentValue;
    }

    /**
     * Decrement with opaque memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public decrementOpaque(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongOpaque(offset, currentValue - 1);

        return currentValue;
    }

    /**
     * Decrement with plain memory ordering semantics.
     *
     * @return the previous value of the counter
     */
    public decrementPlain(): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLong(offset, currentValue - 1);

        return currentValue;
    }

    /**
     * Set the counter with volatile memory semantics.
     *
     * @param value to be set for the counter.
     */
    public set(value: number): void {
        this.buffer.putLongVolatile(this.counterOffset, value);
    }

    /**
     * Set the counter with ordered memory semantics.
     *
     * @param value to be set for the counter.
     */
    public setOrdered(value: number): void {
        this.setRelease(value);
    }

    /**
     * Set the counter with release memory semantics.
     *
     * @param value to be set for the counter.
     */
    public setRelease(value: number): void {
        this.buffer.putLongRelease(this.counterOffset, value);
    }

    /**
     * Set the counter with opaque memory semantics.
     *
     * @param value to be set for the counter.
     */
    public setOpaque(value: number): void {
        this.buffer.putLongOpaque(this.counterOffset, value);
    }

    /**
     * Set the counter with plain memory semantics.
     *
     * @param value to be set for the counter.
     */
    public setWeak(value: number): void {
        this.setPlain(value);
    }

    /**
     * Set the counter with plain memory semantics.
     *
     * @param value to be set for the counter.
     */
    public setPlain(value: number): void {
        this.buffer.putLong(this.counterOffset, value);
    }

    /**
     * Add an increment to the counter that will not lose updates across threads.
     *
     * @param increment to be added.
     * @return the previous value of the counter
     */
    public getAndAdd(increment: number): number {
        return this.buffer.getAndAddLong(this.counterOffset, increment);
    }

    /**
     * Add an increment to the counter with ordered store semantics.
     *
     * @param increment to be added.
     * @return the previous value of the counter
     */
    public getAndAddOrdered(increment: number): number {
        return this.getAndAddRelease(increment);
    }

    /**
     * Add an increment to the counter with release store semantics.
     *
     * @param increment to be added.
     * @return the previous value of the counter
     */
    public getAndAddRelease(increment: number): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongRelease(offset, currentValue + increment);

        return currentValue;
    }

    /**
     * Add an increment to the counter with opaque store semantics.
     *
     * @param increment to be added.
     * @return the previous value of the counter
     */
    public getAndAddOpaque(increment: number): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLongOpaque(offset, currentValue + increment);

        return currentValue;
    }

    /**
     * Add an increment to the counter with plain store semantics.
     *
     * @param increment to be added.
     * @return the previous value of the counter
     */
    public getAndAddPlain(increment: number): number {
        const buffer = this.buffer;
        const offset = this.counterOffset;
        const currentValue = buffer.getLong(offset);
        buffer.putLong(offset, currentValue + increment);

        return currentValue;
    }

    /**
     * Get the current value of the counter and set a new value.
     *
     * @param value to be set for the counter.
     * @return the previous value of the counter
     */
    public getAndSet(value: number): number {
        return this.buffer.getAndSetLong(this.counterOffset, value);
    }

    /**
     * Compare the current value to an expected value and if they match then set the counter to a new update value in
     * an atomic and sequentially consistent manner.
     *
     * @param expectedValue for the counter.
     * @param updateValue   for the counter.
     * @return true if successful otherwise false.
     */
    public compareAndSet(expectedValue: number, updateValue: number): boolean {
        return this.buffer.compareAndSetLong(this.counterOffset, expectedValue, updateValue);
    }

    /**
     * Get the latest value for the counter with volatile semantics.
     *
     * @return the latest value for the counter.
     */
    public get(): number {
        return this.buffer.getLongVolatile(this.counterOffset);
    }

    /**
     * Get the value of the counter using acquire semantics.
     *
     * @return the latest value for the counter.
     */
    public getAcquire(): number {
        return this.buffer.getLongAcquire(this.counterOffset);
    }

    /**
     * Get the value of the counter using opaque semantics.
     *
     * @return the latest value for the counter.
     */
    public getOpaque(): number {
        return this.buffer.getLongOpaque(this.counterOffset);
    }

    /**
     * Get the value of the counter using plain semantics.
     *
     * @return the latest value for the counter.
     */
    public getWeak(): number {
        return this.getPlain();
    }

    /**
     * Get the value of the counter using plain semantics.
     *
     * @return the latest value for the counter.
     */
    public getPlain(): number {
        return this.buffer.getLong(this.counterOffset);
    }

    /**
     * Set the value of the counter with plain semantics if the proposed value is greater than the current value.
     *
     * @param proposedValue to replace the current value if greater.
     * @return true if a new maximum was set.
     */
    public proposeMax(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLong(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    /**
     * Set the value of the counter with ordered semantics if the proposed value is greater than the current value.
     *
     * @param proposedValue to replace the current value if greater.
     * @return true if a new maximum was set.
     */
    public proposeMaxOrdered(proposedValue: number): boolean {
        return this.proposeMaxRelease(proposedValue);
    }

    /**
     * Set the value of the counter with release semantics if the proposed value is greater than the current value.
     *
     * @param proposedValue to replace the current value if greater.
     * @return true if a new maximum was set.
     */
    public proposeMaxRelease(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLongRelease(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    /**
     * Set the value of the counter with opaque semantics if the proposed value is greater than the current value.
     *
     * @param proposedValue to replace the current value if greater.
     * @return true if a new maximum was set.
     */
    public proposeMaxOpaque(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLongOpaque(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    public toString(): string {
        return (
            'AtomicCounter{' +
            'isClosed=' +
            this.isClosed() +
            ', id=' +
            this._id +
            ', value=' +
            (this.isClosed() ? -1 : this.get()) +
            ', countersManager=' +
            this.countersManager +
            '}'
        );
    }
}
