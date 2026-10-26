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
// Port of org/agrona/ExpandableArrayBuffer.java @ Agrona 2.6.1
import { AbstractMutableDirectBuffer } from './AbstractMutableDirectBuffer.js';
import type { DirectBuffer } from './DirectBuffer.js';
import { IndexOutOfBoundsException, NegativeArraySizeException, UnsupportedOperationException } from './jdk.js';

/**
 * Expandable {@link MutableDirectBuffer} that is backed by an array of bytes. Find the capacity of the buffer is
 * extended on put operations: when the position of a value is past the current length, then the buffer will be
 * expanded to accommodate the resulting position for the value.
 * <p>
 * Put operations will expand the capacity as necessary up to {@link MAX_ARRAY_LENGTH}. Get operations will throw
 * a {@link IndexOutOfBoundsException} if past current capacity.
 * <p>
 * <b>Note:</b> this class has a natural ordering that is inconsistent with equals.
 * Types may be different but equal on buffer contents.
 */
export class ExpandableArrayBuffer extends AbstractMutableDirectBuffer {
    /**
     * Maximum length to which the underlying buffer can grow. Some JVMs store state in the last few bytes.
     */
    public static readonly MAX_ARRAY_LENGTH: number = 0x7fffffff - 8;

    /**
     * Initial capacity of the buffer from which it will expand as necessary.
     */
    public static readonly INITIAL_CAPACITY: number = 128;

    /**
     * Create an {@link ExpandableArrayBuffer} with a provided initial length, or with an initial length of
     * {@link INITIAL_CAPACITY}.
     *
     * @param initialCapacity of the buffer.
     */
    public constructor(initialCapacity: number = ExpandableArrayBuffer.INITIAL_CAPACITY) {
        super();
        if (initialCapacity < 0) {
            throw new NegativeArraySizeException(String(initialCapacity));
        }

        this._byteArray = new Uint8Array(initialCapacity);
        this._dataView = new DataView(this._byteArray.buffer);
        this._capacity = initialCapacity | 0;
        this._addressOffset = 0;
    }

    public wrap(buffer: Uint8Array | ArrayBufferLike | DirectBuffer): void;
    public wrap(buffer: Uint8Array | ArrayBufferLike | DirectBuffer, offset: number, length: number): void;
    public wrap(): void {
        throw new UnsupportedOperationException();
    }

    public isExpandable(): boolean {
        return true;
    }

    public wrapAdjustment(): number {
        return 0;
    }

    public override checkLimit(limit: number): void {
        this.ensureCapacity(limit, 0);
    }

    public override toString(): string {
        return (
            'ExpandableArrayBuffer{' +
            ', capacity=' +
            this._capacity +
            ', byteArray=' +
            ('byte[' + this._byteArray.length + ']') +
            '}'
        );
    }

    protected ensureCapacity(index: number, length: number): void {
        if (index < 0 || length < 0) {
            throw new IndexOutOfBoundsException('negative value: index=' + index + ' length=' + length);
        }

        const resultingPosition = index + length;
        if (resultingPosition > this._capacity) {
            if (resultingPosition > ExpandableArrayBuffer.MAX_ARRAY_LENGTH) {
                throw new IndexOutOfBoundsException(
                    'index=' + index + ' length=' + length + ' maxCapacity=' + ExpandableArrayBuffer.MAX_ARRAY_LENGTH,
                );
            }

            const newCapacity = ExpandableArrayBuffer.calculateExpansion(this._capacity, resultingPosition);
            // Arrays.copyOf(byteArray, newCapacity)
            const newArray = new Uint8Array(newCapacity);
            newArray.set(this._byteArray);
            this._byteArray = newArray;
            this._dataView = new DataView(newArray.buffer);
            this._capacity = newCapacity | 0;
        }
    }

    private static calculateExpansion(currentLength: number, requiredLength: number): number {
        let value = Math.max(currentLength, 2);

        while (value < requiredLength) {
            value = value + (value >> 1);

            if (value > ExpandableArrayBuffer.MAX_ARRAY_LENGTH) {
                value = ExpandableArrayBuffer.MAX_ARRAY_LENGTH;
            }
        }

        return value;
    }
}
