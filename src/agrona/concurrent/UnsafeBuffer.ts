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
import { endianness } from 'node:os';
import { AbstractMutableDirectBuffer } from '../AbstractMutableDirectBuffer.js';
import { BitUtil } from '../BitUtil.js';
import { ArrayUtil } from '../collections/ArrayUtil.js';
import { DirectBuffer } from '../DirectBuffer.js';
import {
    dataViewGetLong,
    dataViewSetLong,
    IllegalArgumentException,
    IllegalStateException,
    Long,
    LongOverflowError,
    Objects,
} from '../jdk.js';
import { AtomicBuffer } from './AtomicBuffer.js';

const { SIZE_OF_BYTE, SIZE_OF_CHAR, SIZE_OF_INT, SIZE_OF_LONG, SIZE_OF_SHORT } = BitUtil;

// Atomics read and write in platform byte order, the buffers are little-endian (spec D16)
if ('LE' !== endianness()) {
    throw new Error('UnsafeBuffer on a SharedArrayBuffer needs a little-endian platform: ' + endianness());
}

const TWO_POW_32 = 4294967296;

/**
 * The Atomics views of a SharedArrayBuffer, over all of it. A view is as long as the whole elements that fit, so an
 * odd sized SharedArrayBuffer can be wrapped.
 */
class SharedViews {
    public readonly i32: Int32Array;
    public readonly i16: Int16Array;
    public readonly i64: BigInt64Array;

    public constructor(buffer: SharedArrayBuffer) {
        this.i32 = new Int32Array(buffer, 0, buffer.byteLength >> 2);
        this.i16 = new Int16Array(buffer, 0, buffer.byteLength >> 1);
        this.i64 = new BigInt64Array(buffer, 0, buffer.byteLength >> 3);
    }
}

/** Cached per SharedArrayBuffer, so that wrapping the same one again allocates nothing. */
const SHARED_VIEWS = new WeakMap<SharedArrayBuffer, SharedViews>();

/** The largest SharedArrayBuffer whose byte addresses are exact in the unsigned 32-bit shifts of the atomic paths. */
const MAX_SHARED_LENGTH = 0xffffffff;

/** A Java `long` read from a BigInt64Array as a `number`: a RangeError (D5) if it is outside +/-(2^53 - 1). */
function toLong(value: bigint): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new LongOverflowError(value);
    }

    return number;
}

/**
 * Supports regular, byte ordered, and atomic (memory ordered) access to an underlying buffer. The buffer can be a
 * byte array, an `ArrayBuffer` or a `SharedArrayBuffer`.
 * <p>
 * Over an `ArrayBuffer` (one thread) the operations that are volatile, ordered, release, acquire, opaque or atomic in
 * Java are plain reads and writes with the same names and results. Over a `SharedArrayBuffer`, decided once at
 * {@link wrap}, the `int`, `short` and `char` ones and the `long` ones use `Atomics` (spec D16): an atomic access
 * needs an address that is a multiple of its size, and the `long` ones allocate a `bigint` per call, so no
 * per-message path uses them. A Java `long` is a `number` that is exact to
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

    /** Whether the backing store is a SharedArrayBuffer: decided at {@link wrap}, and the Atomics paths are taken. */
    private _shared = false;

    /** The offset of the first byte of the buffer in the SharedArrayBuffer: byteOffset of the window + addressOffset. */
    private _base = 0;

    private _i32: Int32Array | null = null;
    private _i16: Int16Array | null = null;
    private _i64: BigInt64Array | null = null;

    /**
     * Empty constructor for a later {@link wrap}, or attach a view to a byte array, an `ArrayBuffer`, a `SharedArrayBuffer` or another
     * buffer, with an optional window of `length` bytes from `offset`.
     *
     * @param buffer to which the view is attached.
     * @param offset within the buffer at which the view begins.
     * @param length of the buffer included in the view.
     */
    public constructor(buffer?: Uint8Array | ArrayBufferLike | DirectBuffer);
    public constructor(buffer: Uint8Array | ArrayBufferLike | DirectBuffer, offset: number, length: number);
    public constructor(buffer?: Uint8Array | ArrayBufferLike | DirectBuffer, offset?: number, length?: number) {
        super();
        if (undefined === buffer) {
            this.wrap(ArrayUtil.EMPTY_BYTE_ARRAY);
        } else if (undefined === offset) {
            this.wrap(buffer);
        } else {
            this.wrap(buffer, offset, length!);
        }
    }

    public wrap(buffer: Uint8Array | ArrayBufferLike | DirectBuffer): void;
    public wrap(buffer: Uint8Array | ArrayBufferLike | DirectBuffer, offset: number, length: number): void;
    public wrap(buffer: Uint8Array | ArrayBufferLike | DirectBuffer, offset?: number, length?: number): void {
        if (buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer) {
            // the Java wrap(ByteBuffer ...): the window is the whole of the ArrayBuffer unless given; the view of the
            // ArrayBuffer that is already wrapped is reused, as the Java reuses the array
            buffer =
                undefined !== this._byteArray &&
                buffer === this._byteArray.buffer &&
                0 === this._byteArray.byteOffset &&
                this._byteArray.byteLength === buffer.byteLength
                    ? this._byteArray
                    : new Uint8Array(buffer);
        }

        if (buffer instanceof Uint8Array) {
            if (undefined === offset) {
                this._capacity = buffer.length;
                this._addressOffset = 0;
                this._wrapAdjustment = 0;
            } else {
                if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, buffer.length);
                }

                this._capacity = length!;
                this._addressOffset = offset;
                this._wrapAdjustment = offset;
            }

            if (buffer !== this._byteArray) {
                this._byteArray = buffer;
                this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                this.bindShared(buffer);
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
                this.bindShared(array);
            }
        }

        this._base = this._byteArray.byteOffset + this._addressOffset;
    }

    /**
     * Decides, for the byte array just attached, whether the atomic operations use Atomics (a SharedArrayBuffer), and
     * takes the cached views of it. Nothing is allocated when the SharedArrayBuffer was seen before.
     */
    private bindShared(array: Uint8Array): void {
        const backing = array.buffer;
        if (backing instanceof SharedArrayBuffer) {
            if (backing.byteLength > MAX_SHARED_LENGTH) {
                throw new IllegalArgumentException('SharedArrayBuffer is too long: length=' + backing.byteLength);
            }

            let views = SHARED_VIEWS.get(backing);
            if (undefined === views) {
                views = new SharedViews(backing);
                SHARED_VIEWS.set(backing, views);
            }

            this._shared = true;
            this._i32 = views.i32;
            this._i16 = views.i16;
            this._i64 = views.i64;
        } else {
            this._shared = false;
            this._i32 = null;
            this._i16 = null;
            this._i64 = null;
        }
    }

    public wrapAdjustment(): number {
        return this._wrapAdjustment;
    }

    public isExpandable(): boolean {
        return false;
    }

    public verifyAlignment(): void {
        // A byte array or an ArrayBuffer has no address to inspect: it is the offset of the window in its ArrayBuffer
        const address = this._byteArray.byteOffset + this._addressOffset;
        if (0 !== (address & (UnsafeBuffer.ALIGNMENT - 1))) {
            throw new IllegalStateException(
                'AtomicBuffer is not correctly aligned: addressOffset=' +
                    address +
                    ' is not divisible by ' +
                    UnsafeBuffer.ALIGNMENT,
            );
        }
    }

    public getLongVolatile(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return toLong(Atomics.load(this._i64!, this.atomicIndex(index, 8, 3)));
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public putLongVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            this.storeLongShared(index, value);
            return;
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongAcquire(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return toLong(Atomics.load(this._i64!, this.atomicIndex(index, 8, 3)));
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

        if (this._shared) {
            this.storeLongShared(index, value);
            return;
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

        if (this._shared) {
            return this.getAndAddLongShared(index, increment);
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

        if (this._shared) {
            this.storeLongShared(index, value);
            return;
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongOpaque(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return toLong(Atomics.load(this._i64!, this.atomicIndex(index, 8, 3)));
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public addLongOpaque(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return this.getAndAddLongShared(index, increment);
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

        if (this._shared) {
            Long.checkSafe(expectedValue);
            Long.checkSafe(updateValue);
            const expected = BigInt(expectedValue);
            return (
                expected ===
                Atomics.compareExchange(this._i64!, this.atomicIndex(index, 8, 3), expected, BigInt(updateValue))
            );
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

        if (this._shared) {
            Long.checkSafe(expectedValue);
            Long.checkSafe(updateValue);
            return toLong(
                Atomics.compareExchange(
                    this._i64!,
                    this.atomicIndex(index, 8, 3),
                    BigInt(expectedValue),
                    BigInt(updateValue),
                ),
            );
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

        if (this._shared) {
            Long.checkSafe(value);
            return toLong(Atomics.exchange(this._i64!, this.atomicIndex(index, 8, 3), BigInt(value)));
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

        if (this._shared) {
            return this.getAndAddLongShared(index, delta);
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

        if (this._shared) {
            return Atomics.load(this._i32!, this.atomicIndex(index, 4, 2));
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public putIntVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            Atomics.store(this._i32!, this.atomicIndex(index, 4, 2), value);
            return;
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntAcquire(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            return Atomics.load(this._i32!, this.atomicIndex(index, 4, 2));
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

        if (this._shared) {
            Atomics.store(this._i32!, this.atomicIndex(index, 4, 2), value);
            return;
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

        if (this._shared) {
            return Atomics.add(this._i32!, this.atomicIndex(index, 4, 2), increment);
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

        if (this._shared) {
            Atomics.store(this._i32!, this.atomicIndex(index, 4, 2), value);
            return;
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntOpaque(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            return Atomics.load(this._i32!, this.atomicIndex(index, 4, 2));
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public addIntOpaque(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            return Atomics.add(this._i32!, this.atomicIndex(index, 4, 2), increment);
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

        if (this._shared) {
            const expected = expectedValue | 0;
            return (
                expected === Atomics.compareExchange(this._i32!, this.atomicIndex(index, 4, 2), expected, updateValue)
            );
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

        if (this._shared) {
            return Atomics.compareExchange(this._i32!, this.atomicIndex(index, 4, 2), expectedValue | 0, updateValue);
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

        if (this._shared) {
            return Atomics.exchange(this._i32!, this.atomicIndex(index, 4, 2), value);
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

        if (this._shared) {
            return Atomics.add(this._i32!, this.atomicIndex(index, 4, 2), delta);
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

        if (this._shared) {
            return Atomics.load(this._i16!, this.atomicIndex(index, 2, 1));
        }

        return this._dataView.getInt16(this._addressOffset + index, true);
    }

    public putShortVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        if (this._shared) {
            Atomics.store(this._i16!, this.atomicIndex(index, 2, 1), value);
            return;
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

        if (this._shared) {
            return Atomics.load(this._i16!, this.atomicIndex(index, 2, 1)) & 0xffff;
        }

        return this._dataView.getUint16(this._addressOffset + index, true);
    }

    public putCharVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_CHAR);
        }

        if (this._shared) {
            Atomics.store(this._i16!, this.atomicIndex(index, 2, 1), value);
            return;
        }

        this._dataView.setUint16(this._addressOffset + index, value, true);
    }

    /**
     * The index of the element of an Atomics view of `size` bytes (`1 << shift`) at `index` of the buffer.
     *
     * @throws IllegalArgumentException if the address is not a multiple of `size`: an Atomics view needs an aligned
     * element. Agrona has no such check per call (x86 tolerates a misaligned access), see spec D16.
     */
    private atomicIndex(index: number, size: number, shift: number): number {
        const address = this._base + index;
        if (0 !== (address & (size - 1))) {
            throw new IllegalArgumentException('Unaligned atomic access: index=' + index + ' size=' + size);
        }

        return address >>> shift;
    }

    private storeLongShared(index: number, value: number): void {
        Long.checkSafe(value);
        Atomics.store(this._i64!, this.atomicIndex(index, 8, 3), BigInt(value));
    }

    /**
     * Java's `getAndAddLong` on a shared buffer: the add wraps at 64 bits in the bigint domain, as Java's does, then
     * the result is range checked (D5), with nothing written when it is outside.
     */
    private getAndAddLongShared(index: number, delta: number): number {
        Long.checkSafe(delta);
        const view = this._i64!;
        const element = this.atomicIndex(index, 8, 3);
        const increment = BigInt(delta);
        for (;;) {
            const oldValue = Atomics.load(view, element);
            const newValue = BigInt.asIntN(64, oldValue + increment);
            const result = toLong(oldValue);
            toLong(newValue);
            if (oldValue === Atomics.compareExchange(view, element, oldValue, newValue)) {
                return result;
            }
        }
    }

    /**
     * Port-only (spec D16): writes a `long` that readers on other threads read with {@link getLongVolatileSeq}, a
     * sequence lock for one writer. The sequence `int` at `seqIndex` goes odd while the two halves are written, then
     * even. Allocates nothing. On a buffer that is not shared it is {@link putLong} and `seqIndex` is not used.
     *
     * @param index    of the 8 byte value, a multiple of 4 on a shared buffer.
     * @param value    to write, +/-(2^53 - 1) (D5).
     * @param seqIndex of the sequence `int`, a multiple of 4 on a shared buffer.
     */
    public putLongReleaseSeq(index: number, value: number, seqIndex: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
            this.boundsCheck0(seqIndex, SIZE_OF_INT);
        }

        if (this._shared) {
            Long.checkSafe(value);
            const view = this._i32!;
            const element = this.atomicIndex(index, 4, 2);
            const seq = this.atomicIndex(seqIndex, 4, 2);
            const s = Atomics.load(view, seq);
            Atomics.store(view, seq, (s + 1) | 0);
            Atomics.store(view, element, value | 0);
            Atomics.store(view, element + 1, Math.floor(value / TWO_POW_32));
            Atomics.store(view, seq, (s + 2) | 0);
            return;
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    /**
     * Port-only (spec D16): reads a `long` written with {@link putLongReleaseSeq}, retrying until the sequence is even
     * and the same before and after the two halves are read, so a value is never torn. Allocates nothing. On a buffer
     * that is not shared it is {@link getLong}.
     *
     * @param index    of the 8 byte value, a multiple of 4 on a shared buffer.
     * @param seqIndex of the sequence `int`, a multiple of 4 on a shared buffer.
     * @return the value.
     */
    public getLongVolatileSeq(index: number, seqIndex: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
            this.boundsCheck0(seqIndex, SIZE_OF_INT);
        }

        if (this._shared) {
            const view = this._i32!;
            const element = this.atomicIndex(index, 4, 2);
            const seq = this.atomicIndex(seqIndex, 4, 2);
            for (;;) {
                const s1 = Atomics.load(view, seq);
                if (0 !== (s1 & 1)) {
                    continue;
                }

                const lo = Atomics.load(view, element);
                const hi = Atomics.load(view, element + 1);
                if (s1 === Atomics.load(view, seq)) {
                    const value = hi * TWO_POW_32 + (lo >>> 0);
                    if (!Number.isSafeInteger(value)) {
                        throw new LongOverflowError((BigInt(hi) << 32n) | BigInt(lo >>> 0));
                    }

                    return value;
                }
            }
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public override toString(): string {
        return (
            'UnsafeBuffer{' +
            'addressOffset=' +
            this._addressOffset +
            ', capacity=' +
            this._capacity +
            ', byteArray=' +
            ('byte[' + this._byteArray.length + ']') +
            ', byteBuffer=' +
            'null' +
            '}'
        );
    }

    protected ensureCapacity(index: number, length: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }
    }
}
