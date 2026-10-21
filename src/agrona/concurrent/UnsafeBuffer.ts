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
// Port of org/agrona/concurrent/UnsafeBuffer.java @ Agrona 2.6.1
import { AbstractMutableDirectBuffer } from '../AbstractMutableDirectBuffer.js';
import { BitUtil } from '../BitUtil.js';
import { DirectBuffer } from '../DirectBuffer.js';
import { dataViewGetLong, dataViewSetLong, IllegalStateException, Objects } from '../jdk.js';
import { AtomicBuffer } from './AtomicBuffer.js';

const { SIZE_OF_BYTE, SIZE_OF_CHAR, SIZE_OF_INT, SIZE_OF_LONG, SIZE_OF_SHORT } = BitUtil;
// ArrayUtil.EMPTY_BYTE_ARRAY: collections/ArrayUtil is ported in T4
const EMPTY_BYTE_ARRAY = new Uint8Array(0);

/**
 * Supports regular, byte ordered, and atomic (memory ordered) access to an underlying buffer. The buffer can be a
 * byte array or an `ArrayBuffer`.
 * <p>
 * JavaScript runs one thread, so the operations that are volatile, ordered, release, acquire, opaque or atomic in Java
 * are plain reads and writes with the same names and results. A Java `long` is a `number` that is exact to
 * +/-(2^53 - 1): see {@link DirectBuffer}.
 * <p>
 * The constructors and `wrap` that take a `ByteBuffer` or a raw memory address are not ported.
 */
export class UnsafeBuffer extends AbstractMutableDirectBuffer implements AtomicBuffer {
    /**
     * Buffer alignment to ensure atomic word accesses.
     */
    public static readonly ALIGNMENT = AtomicBuffer.ALIGNMENT;

    /**
     * Name of the system property that specifies whether bounds checks should be disabled.
     */
    public static readonly DISABLE_BOUNDS_CHECKS_PROP_NAME = DirectBuffer.DISABLE_BOUNDS_CHECKS_PROP_NAME;

    /**
     * Should bounds checks be done or not.
     */
    public static readonly SHOULD_BOUNDS_CHECK = DirectBuffer.SHOULD_BOUNDS_CHECK;

    private _wrapAdjustment = 0;

    /**
     * Empty constructor for a later {@link wrap}, or attach a view to a byte array, an `ArrayBuffer` or another
     * buffer, with an optional window of `length` bytes from `offset`.
     *
     * @param buffer to which the view is attached.
     * @param offset within the buffer at which the view begins.
     * @param length of the buffer included in the view.
     */
    public constructor(buffer?: Uint8Array | ArrayBuffer | DirectBuffer);
    public constructor(buffer: Uint8Array | ArrayBuffer | DirectBuffer, offset: number, length: number);
    public constructor(buffer?: Uint8Array | ArrayBuffer | DirectBuffer, offset?: number, length?: number) {
        super();
        if (undefined === buffer) {
            this.wrap(EMPTY_BYTE_ARRAY);
        } else if (undefined === offset) {
            this.wrap(buffer);
        } else {
            this.wrap(buffer, offset, length!);
        }
    }

    public wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer): void;
    public wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer, offset: number, length: number): void;
    public wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer, offset?: number, length?: number): void {
        if (buffer instanceof ArrayBuffer) {
            // the Java wrap(ByteBuffer ...): the window is the whole of the ArrayBuffer unless given
            buffer = new Uint8Array(buffer);
        }

        if (buffer instanceof Uint8Array) {
            if (undefined === offset) {
                this._capacity = buffer.length;
                this._addressOffset = 0;
                this._wrapAdjustment = 0;

                if (buffer !== this._byteArray) {
                    this._byteArray = buffer;
                    this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                }
            } else {
                if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, buffer.length);
                }

                this._capacity = length!;
                this._addressOffset = offset;
                this._wrapAdjustment = offset;

                if (buffer !== this._byteArray) {
                    this._byteArray = buffer;
                    this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                }
            }
        } else {
            if (undefined === offset) {
                this._capacity = buffer.capacity();
                this._addressOffset = buffer.addressOffset();
                this._wrapAdjustment = buffer.wrapAdjustment();
            } else {
                if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, buffer.capacity());
                }

                this._capacity = length!;
                this._addressOffset = buffer.addressOffset() + offset;
                this._wrapAdjustment = buffer.wrapAdjustment() + offset;
            }

            const array = buffer.byteArray();
            if (array !== this._byteArray) {
                this._byteArray = array;
                // a DataView is only made when the buffer is not an UnsafeBuffer, which already has one
                this._dataView =
                    buffer instanceof UnsafeBuffer
                        ? buffer._dataView
                        : new DataView(array.buffer, array.byteOffset, array.byteLength);
            }
        }
    }

    public wrapAdjustment(): number {
        return this._wrapAdjustment;
    }

    public isExpandable(): boolean {
        return false;
    }

    public verifyAlignment(): void {
        // A byte array or an ArrayBuffer has no address to inspect: its alignment is the offset of the window in it
        if (0 !== ((this._byteArray.byteOffset + this._addressOffset) & (UnsafeBuffer.ALIGNMENT - 1))) {
            throw new IllegalStateException(
                'AtomicBuffer is not correctly aligned: addressOffset=' +
                    this._addressOffset +
                    ' is not divisible by ' +
                    UnsafeBuffer.ALIGNMENT,
            );
        }
    }

    public getLongVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public putLongVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongAcquire(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public putLongOrdered(index: number, value: number): void {
        this.putLongRelease(index, value);
    }

    public putLongRelease(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public addLongOrdered(index: number, increment: number): number {
        return this.addLongRelease(index, increment);
    }

    public addLongRelease(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, oldValue + increment, true);
        return oldValue;
    }

    public putLongOpaque(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongOpaque(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public addLongOpaque(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const oldValue = dataViewGetLong(this._dataView, this._addressOffset + index, true);
        const newValue = oldValue + increment;
        dataViewSetLong(this._dataView, this._addressOffset + index, newValue, true);
        return oldValue;
    }

    public compareAndSetLong(index: number, expectedValue: number, updateValue: number): boolean {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        if (dataViewGetLong(this._dataView, offset, true) === expectedValue) {
            dataViewSetLong(this._dataView, offset, updateValue, true);
            return true;
        }

        return false;
    }

    public compareAndExchangeLong(index: number, expectedValue: number, updateValue: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const witness = dataViewGetLong(this._dataView, offset, true);
        if (witness === expectedValue) {
            dataViewSetLong(this._dataView, offset, updateValue, true);
        }

        return witness;
    }

    public getAndSetLong(index: number, value: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, value, true);
        return oldValue;
    }

    public getAndAddLong(index: number, delta: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, oldValue + delta, true);
        return oldValue;
    }

    public getIntVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public putIntVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntAcquire(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public putIntOrdered(index: number, value: number): void {
        this.putIntRelease(index, value);
    }

    public putIntRelease(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public addIntOrdered(index: number, increment: number): number {
        return this.addIntRelease(index, increment);
    }

    public addIntRelease(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const offset = this._addressOffset + index;
        const oldValue = this._dataView.getInt32(offset, true);
        this._dataView.setInt32(offset, oldValue + increment, true);
        return oldValue;
    }

    public putIntOpaque(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntOpaque(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public addIntOpaque(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const oldValue = this._dataView.getInt32(this._addressOffset + index, true);
        const newValue = (oldValue + increment) | 0;
        this._dataView.setInt32(this._addressOffset + index, newValue, true);
        return oldValue;
    }

    public compareAndSetInt(index: number, expectedValue: number, updateValue: number): boolean {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const offset = this._addressOffset + index;
        if (this._dataView.getInt32(offset, true) === expectedValue) {
            this._dataView.setInt32(offset, updateValue, true);
            return true;
        }

        return false;
    }

    public compareAndExchangeInt(index: number, expectedValue: number, updateValue: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const offset = this._addressOffset + index;
        const witness = this._dataView.getInt32(offset, true);
        if (witness === expectedValue) {
            this._dataView.setInt32(offset, updateValue, true);
        }

        return witness;
    }

    public getAndSetInt(index: number, value: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const offset = this._addressOffset + index;
        const oldValue = this._dataView.getInt32(offset, true);
        this._dataView.setInt32(offset, value, true);
        return oldValue;
    }

    public getAndAddInt(index: number, delta: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        const offset = this._addressOffset + index;
        const oldValue = this._dataView.getInt32(offset, true);
        this._dataView.setInt32(offset, oldValue + delta, true);
        return oldValue;
    }

    public getShortVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        return this._dataView.getInt16(this._addressOffset + index, true);
    }

    public putShortVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        this._dataView.setInt16(this._addressOffset + index, value, true);
    }

    public getByteVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        return this._dataView.getInt8(this._addressOffset + index);
    }

    public putByteVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        this._dataView.setInt8(this._addressOffset + index, value);
    }

    public getCharVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_CHAR);
        }

        return this._dataView.getUint16(this._addressOffset + index, true);
    }

    public putCharVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_CHAR);
        }

        this._dataView.setUint16(this._addressOffset + index, value, true);
    }

    public override toString(): string {
        return (
            'UnsafeBuffer{' +
            'addressOffset=' +
            this._addressOffset +
            ', capacity=' +
            this._capacity +
            ', byteArray=byte[' +
            this._byteArray.length +
            ']' +
            '}'
        );
    }

    protected ensureCapacity(index: number, length: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }
    }
}
