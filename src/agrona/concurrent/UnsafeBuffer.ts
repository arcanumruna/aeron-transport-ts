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
import { LongStripes } from './LongStripes.js';

const { SIZE_OF_BYTE, SIZE_OF_CHAR, SIZE_OF_INT, SIZE_OF_LONG, SIZE_OF_SHORT } = BitUtil;

// Atomics read and write in platform byte order, the buffers are little-endian (spec D16): checked when a
// SharedArrayBuffer is first bound, so that a big-endian platform can still use ArrayBuffers
const LITTLE_ENDIAN = 'LE' === endianness();

const TWO_POW_32 = 4294967296;

/**
 * The Atomics views of a SharedArrayBuffer, over all of it. A view is as long as the whole elements that fit, so an
 * odd sized SharedArrayBuffer can be wrapped.
 */
class SharedViews {
    public readonly i32: Int32Array;
    public readonly i16: Int16Array;

    public constructor(buffer: SharedArrayBuffer) {
        this.i32 = new Int32Array(buffer, 0, buffer.byteLength >> 2);
        this.i16 = new Int16Array(buffer, 0, buffer.byteLength >> 1);
    }
}

/** Cached per SharedArrayBuffer, so that wrapping the same one again allocates nothing. */
const SHARED_VIEWS = new WeakMap<SharedArrayBuffer, SharedViews>();

/** The largest SharedArrayBuffer whose byte addresses are exact in the unsigned 32-bit shifts of the atomic paths. */
const MAX_SHARED_LENGTH = 0xffffffff;

/**
 * Supports regular, byte ordered, and atomic (memory ordered) access to an underlying buffer. The buffer can be a
 * byte array, an `ArrayBuffer` or a `SharedArrayBuffer`.
 * <p>
 * Over an `ArrayBuffer` (one thread) the operations that are volatile, ordered, release, acquire, opaque or atomic in
 * Java are plain reads and writes with the same names and results. Over a `SharedArrayBuffer`, decided once at
 * {@link wrap}, the `byte`, `short`, `char` and `int` ones use `Atomics`, and the `long` ones are true 64-bit atomics on
 * Java's word (its layout and semantics) through the striped lock table {@link LongStripes} (spec D16); they allocate
 * nothing. An atomic access needs an address that is a multiple of its size. A Java `long` is a `number` that is exact
 * to +/-(2^53 - 1): see {@link DirectBuffer}.
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

    /** The LongStripes table (spec D16), cached while the backing store is shared. */
    private _stripes: Int32Array | null = null;

    /** The halves that {@link readHalves} last read: scratch, so that a read allocates nothing. */
    private _lo = 0;
    private _hi = 0;

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
        if (null === LongStripes.table()) {
            UnsafeBuffer.requireStripes(buffer);
        }

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
     * Throws when `buffer` is shared and this worker has no LongStripes table, before wrap changes any state.
     */
    private static requireStripes(buffer: Uint8Array | ArrayBufferLike | DirectBuffer): void {
        const backing =
            buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer
                ? buffer
                : buffer instanceof Uint8Array
                  ? buffer.buffer
                  : buffer.byteArray().buffer;
        if (backing instanceof SharedArrayBuffer) {
            throw new IllegalStateException(
                'No LongStripes table in this worker: start workers after LongStripes is loaded on the main thread',
            );
        }
    }

    /**
     * Decides, for the byte array just attached, whether the atomic operations use Atomics (a SharedArrayBuffer), and
     * takes the cached views of it. Nothing is allocated when the SharedArrayBuffer was seen before.
     */
    private bindShared(array: Uint8Array): void {
        const backing = array.buffer;
        if (backing instanceof SharedArrayBuffer) {
            if (!LITTLE_ENDIAN) {
                throw new IllegalStateException(
                    'UnsafeBuffer on a SharedArrayBuffer needs a little-endian platform: ' + endianness(),
                );
            }

            // `growable` is ES2024; the lib here is ES2022
            if ((backing as { growable?: boolean }).growable) {
                throw new IllegalArgumentException('growable SharedArrayBuffer is not supported');
            }

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
            this._stripes = LongStripes.table();
        } else {
            this._shared = false;
            this._i32 = null;
            this._i16 = null;
            this._stripes = null;
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
            return this.getLongStriped(index);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public putLongVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            this.putLongStriped(index, value);
            return;
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongAcquire(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return this.getLongStriped(index);
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
            this.putLongStriped(index, value);
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
            return this.getAndAddLongStriped(index, increment);
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
            this.putLongStriped(index, value);
            return;
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    public getLongOpaque(index: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return this.getLongStriped(index);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    public addLongOpaque(index: number, increment: number): number {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            return this.getAndAddLongStriped(index, increment);
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
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            const hit =
                Atomics.load(view, element) === (expectedValue | 0) &&
                Atomics.load(view, element + 1) === Math.floor(expectedValue / TWO_POW_32);
            if (hit) {
                UnsafeBuffer.storeHalves(view, element, updateValue);
            }

            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            return hit;
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
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            const lo = Atomics.load(view, element);
            const hi = Atomics.load(view, element + 1);
            if (lo === (expectedValue | 0) && hi === Math.floor(expectedValue / TWO_POW_32)) {
                UnsafeBuffer.storeHalves(view, element, updateValue);
            }

            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            return UnsafeBuffer.halvesToLong(lo, hi);
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
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            const lo = Atomics.load(view, element);
            const hi = Atomics.load(view, element + 1);
            const oldValue = hi * TWO_POW_32 + (lo >>> 0);
            if (!Number.isSafeInteger(oldValue)) {
                UnsafeBuffer.unlockStripe(table, stripe, sequence);
                throw new LongOverflowError((BigInt(hi) << 32n) | BigInt(lo >>> 0));
            }

            UnsafeBuffer.storeHalves(view, element, value);
            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            return oldValue;
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
            return this.getAndAddLongStriped(index, delta);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, oldValue + delta, true);
        return oldValue;
    }

    /**
     * Port-only (spec D16): the 64-bit word at `index` as an `int` pair, for the whole 64-bit range (the raw tails of
     * the log buffer, D12). Volatile, and on a shared buffer exact through {@link LongStripes}. Allocates nothing.
     *
     * @param index of the `long`.
     * @param out   receives the low half at 0 and the high half at 1.
     */
    public getLongVolatileHalves(index: number, out: Int32Array): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            this.readHalves(index);
            out[0] = this._lo;
            out[1] = this._hi;
            return;
        }

        const offset = this._addressOffset + index;
        out[0] = this._dataView.getInt32(offset, true);
        out[1] = this._dataView.getInt32(offset + 4, true);
    }

    /**
     * Port-only (spec D16): stores the 64-bit word at `index` from its two `int` halves, volatile. Allocates nothing.
     *
     * @param index of the `long`.
     * @param lo    the low 32 bits.
     * @param hi    the high 32 bits.
     */
    public putLongVolatileHalves(index: number, lo: number, hi: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            Atomics.store(view, element + 1, hi | 0);
            Atomics.store(view, element, lo | 0);
            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            return;
        }

        const offset = this._addressOffset + index;
        this._dataView.setInt32(offset, lo, true);
        this._dataView.setInt32(offset + 4, hi, true);
    }

    /**
     * Port-only (spec D16): compare-and-set of the 64-bit word at `index` over its `int` halves. Allocates nothing.
     *
     * @param index      of the `long`.
     * @param expectedLo low half expected.
     * @param expectedHi high half expected.
     * @param updateLo   low half to store.
     * @param updateHi   high half to store.
     * @return true if the update was applied.
     */
    public compareAndSetLongHalves(
        index: number,
        expectedLo: number,
        expectedHi: number,
        updateLo: number,
        updateHi: number,
    ): boolean {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (this._shared) {
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            const hit =
                Atomics.load(view, element) === (expectedLo | 0) &&
                Atomics.load(view, element + 1) === (expectedHi | 0);
            if (hit) {
                Atomics.store(view, element + 1, updateHi | 0);
                Atomics.store(view, element, updateLo | 0);
            }

            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            return hit;
        }

        const offset = this._addressOffset + index;
        if (
            this._dataView.getInt32(offset, true) === (expectedLo | 0) &&
            this._dataView.getInt32(offset + 4, true) === (expectedHi | 0)
        ) {
            this._dataView.setInt32(offset, updateLo, true);
            this._dataView.setInt32(offset + 4, updateHi, true);
            return true;
        }

        return false;
    }

    /**
     * Port-only (spec D16): adds `delta` to the 64-bit word at `index` in one atomic step, carrying from the low half
     * into the high half, which wraps from `INT32_MAX` to `INT32_MIN` as the Java 64-bit add does. Allocates nothing.
     *
     * @param index of the `long`.
     * @param delta an `int` in [0, 2^31 - 1].
     * @param out   receives the OLD low half at 0 and the OLD high half at 1.
     * @throws IllegalArgumentException if `delta` is out of range; nothing is locked or written.
     */
    public getAndAddLongHalves(index: number, delta: number, out: Int32Array): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (!(Number.isInteger(delta) && delta >= 0 && delta <= 0x7fffffff)) {
            throw new IllegalArgumentException('delta must be in [0, 2^31 - 1]: ' + delta);
        }

        if (this._shared) {
            const element = this.atomicIndex(index, 8, 3) << 1;
            const table = this._stripes!;
            const view = this._i32!;
            const stripe = LongStripes.stripe(this._base + index);
            const sequence = UnsafeBuffer.lockStripe(table, stripe);
            const lo = Atomics.load(view, element);
            const hi = Atomics.load(view, element + 1);
            const sum = (lo >>> 0) + delta;
            Atomics.store(view, element + 1, sum >= TWO_POW_32 ? (hi + 1) | 0 : hi);
            Atomics.store(view, element, sum | 0);
            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            out[0] = lo;
            out[1] = hi;
            return;
        }

        const offset = this._addressOffset + index;
        const lo = this._dataView.getInt32(offset, true);
        const hi = this._dataView.getInt32(offset + 4, true);
        const sum = (lo >>> 0) + delta;
        this._dataView.setInt32(offset + 4, sum >= TWO_POW_32 ? (hi + 1) | 0 : hi, true);
        this._dataView.setInt32(offset, sum | 0, true);
        out[0] = lo;
        out[1] = hi;
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

        if (this._shared) {
            return (Atomics.load(this._byteArray, this._addressOffset + index) << 24) >> 24;
        }

        return this._dataView.getInt8(this._addressOffset + index);
    }

    public putByteVolatile(index: number, value: number): void {
        if (UnsafeBuffer.SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        if (this._shared) {
            Atomics.store(this._byteArray, this._addressOffset + index, value);
            return;
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

    /**
     * Takes the stripe (spec D16): compare-and-sets it from even to odd.
     *
     * @return the even value the stripe had, to pass to {@link unlockStripe}.
     */
    private static lockStripe(table: Int32Array, stripe: number): number {
        for (;;) {
            const sequence = Atomics.load(table, stripe);
            if (
                0 === (sequence & 1) &&
                sequence === Atomics.compareExchange(table, stripe, sequence, (sequence + 1) | 0)
            ) {
                return sequence;
            }
        }
    }

    /** Releases the stripe, with a value that differs from the one a reader may have seen before the write. */
    private static unlockStripe(table: Int32Array, stripe: number, sequence: number): void {
        Atomics.store(table, stripe, (sequence + 2) | 0);
    }

    /**
     * Stores a `long` as two `int` halves, HIGH HALF FIRST and LOW HALF LAST, under the stripe. The order is a rule for
     * every striped write: Aeron readers that read only the low `int` of a 64-bit word without the stripe (for example
     * `frameLengthVolatile` after `TermRebuilder`'s `putLongRelease` of the first header word, where the high half holds
     * the version, flags and type) must see the high half once the low half is visible. Otherwise a frame reads as
     * type 0, padding.
     */
    private static storeHalves(view: Int32Array, element: number, value: number): void {
        Atomics.store(view, element + 1, Math.floor(value / TWO_POW_32));
        Atomics.store(view, element, value | 0);
    }

    /** The `number` of two halves, or a {@link LongOverflowError} (D5) when it is not a safe integer. */
    private static halvesToLong(lo: number, hi: number): number {
        const value = hi * TWO_POW_32 + (lo >>> 0);
        if (!Number.isSafeInteger(value)) {
            throw new LongOverflowError((BigInt(hi) << 32n) | BigInt(lo >>> 0));
        }

        return value;
    }

    /**
     * Reads the halves of the `long` at `index` into `_lo` and `_hi`: the stripe, the halves and the stripe again, until
     * the stripe is even and unchanged. There is no iteration cap: a write holds a stripe for a few stores.
     */
    private readHalves(index: number): void {
        const element = this.atomicIndex(index, 8, 3) << 1;
        const table = this._stripes!;
        const view = this._i32!;
        const stripe = LongStripes.stripe(this._base + index);
        for (;;) {
            const sequence = Atomics.load(table, stripe);
            const lo = Atomics.load(view, element);
            const hi = Atomics.load(view, element + 1);
            if (0 === (sequence & 1) && sequence === Atomics.load(table, stripe)) {
                this._lo = lo;
                this._hi = hi;
                return;
            }
        }
    }

    private getLongStriped(index: number): number {
        this.readHalves(index);
        return UnsafeBuffer.halvesToLong(this._lo, this._hi);
    }

    private putLongStriped(index: number, value: number): void {
        Long.checkSafe(value);
        const element = this.atomicIndex(index, 8, 3) << 1;
        const table = this._stripes!;
        const stripe = LongStripes.stripe(this._base + index);
        const sequence = UnsafeBuffer.lockStripe(table, stripe);
        UnsafeBuffer.storeHalves(this._i32!, element, value);
        UnsafeBuffer.unlockStripe(table, stripe, sequence);
    }

    /**
     * Java's `getAndAddLong` on a shared buffer, under the stripe. The sum is range checked (D5), with nothing written
     * and the stripe released when it is outside.
     */
    private getAndAddLongStriped(index: number, delta: number): number {
        Long.checkSafe(delta);
        const element = this.atomicIndex(index, 8, 3) << 1;
        const table = this._stripes!;
        const view = this._i32!;
        const stripe = LongStripes.stripe(this._base + index);
        const sequence = UnsafeBuffer.lockStripe(table, stripe);
        const lo = Atomics.load(view, element);
        const hi = Atomics.load(view, element + 1);
        const oldValue = hi * TWO_POW_32 + (lo >>> 0);
        if (!Number.isSafeInteger(oldValue)) {
            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            throw new LongOverflowError((BigInt(hi) << 32n) | BigInt(lo >>> 0));
        }

        const newValue = oldValue + delta;
        if (!Number.isSafeInteger(newValue)) {
            UnsafeBuffer.unlockStripe(table, stripe, sequence);
            throw new LongOverflowError(BigInt.asIntN(64, BigInt(oldValue) + BigInt(delta)));
        }

        UnsafeBuffer.storeHalves(view, element, newValue);
        UnsafeBuffer.unlockStripe(table, stripe, sequence);
        return oldValue;
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
