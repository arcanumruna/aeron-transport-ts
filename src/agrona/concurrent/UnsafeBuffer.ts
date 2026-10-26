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
import { INSPECT_CUSTOM } from '../inspect.js';
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

const SHOULD_BOUNDS_CHECK = DirectBuffer.SHOULD_BOUNDS_CHECK;

/** Spins after which a held stripe is declared dead (spec D16): lowered only by the tests, see {@link lockSlow}. */
let STRIPE_SPIN_CAP = 1 << 28;

// The cold paths of the striped operations are module functions, so that the hot bodies stay small enough (V8 inlines
// a callee of at most 460 bytecode bytes) and a throw costs the fast path a call only when it is taken.

/**
 * The slow path of the stripe lock, entered only when the test-and-set found the stripe held: waits (reading, so that
 * the cache line is not hammered) while it is odd, then retries the test-and-set. Returns the even value the stripe
 * had, which the caller unlocks with (`q + 2` after a write, `q` after none).
 * <p>
 * Dead-holder rule (spec D16): a thread that was killed while it held a stripe (`worker.terminate()` inside a buffer
 * operation) leaves it odd for ever. After 2^28 spins this throws, so that the survivors fail loudly instead of
 * hanging. It is a failure detector, not a timeout that anything depends on: a write holds a stripe for a few stores.
 */
function lockSlow(table: Int32Array, s: number): number {
    let spins = 0;
    for (;;) {
        while (0 !== (Atomics.load(table, s) & 1)) {
            if (++spins >= STRIPE_SPIN_CAP) {
                throw deadHolder(s);
            }
        }

        const q = Atomics.or(table, s, 1);
        if (0 === (q & 1)) {
            return q;
        }
    }
}

function deadHolder(s: number): IllegalStateException {
    return new IllegalStateException(
        'LongStripes stripe ' +
            (s >> 4) +
            ' held for 2^28 spins: a writer died holding it (worker terminated mid-write?)',
    );
}

/** Throws the `RangeError` of {@link Long.checkSafe} for the first of `a` and `b` that is not a safe integer. */
function requireSafe(a: number, b: number): void {
    Long.checkSafe(a);
    Long.checkSafe(b);
}

function badDelta(delta: number): IllegalArgumentException {
    return new IllegalArgumentException('delta must be in [0, 2^31 - 1]: ' + delta);
}

/** The error (D5) for a stored word outside +/-(2^53 - 1): the exact 64-bit value Java would have returned. */
function overflow(lo: number, hi: number): LongOverflowError {
    return new LongOverflowError((BigInt(hi) << 32n) | BigInt(lo >>> 0));
}

/** The error (D5) of a get-and-add whose old value or sum is outside +/-(2^53 - 1). */
function addOverflow(lo: number, hi: number, delta: number): LongOverflowError {
    const oldValue = hi * TWO_POW_32 + (lo >>> 0);
    if (!Number.isSafeInteger(oldValue)) {
        return overflow(lo, hi);
    }

    return new LongOverflowError(BigInt.asIntN(64, BigInt(oldValue) + BigInt(delta)));
}

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
    public static readonly SHOULD_BOUNDS_CHECK = SHOULD_BOUNDS_CHECK;

    private _wrapAdjustment = 0;

    /** Whether the backing store is a SharedArrayBuffer: decided at {@link wrap}, and the Atomics paths are taken. */
    private _shared = false;

    /** The offset of the first byte of the buffer in the SharedArrayBuffer: byteOffset of the window + addressOffset. */
    private _base = 0;

    private _i32: Int32Array | null = null;
    private _i16: Int16Array | null = null;

    /** The LongStripes table (spec D16), cached while the backing store is shared. */
    private _stripes: Int32Array | null = null;

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
                this._capacity = buffer.length | 0;
                this._addressOffset = 0;
                this._wrapAdjustment = 0;
            } else {
                if (SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, buffer.length);
                }

                this._capacity = length! | 0;
                this._addressOffset = offset | 0;
                this._wrapAdjustment = offset | 0;
            }

            if (buffer !== this._byteArray) {
                this._byteArray = buffer;
                this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
                this.bindShared(buffer);
            }
        } else {
            if (undefined === offset) {
                this._capacity = buffer.capacity() | 0;
                this._addressOffset = buffer.addressOffset() | 0;
                this._wrapAdjustment = buffer.wrapAdjustment() | 0;
            } else {
                if (SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, buffer.capacity());
                }

                this._capacity = length! | 0;
                this._addressOffset = (buffer.addressOffset() + offset) | 0;
                this._wrapAdjustment = (buffer.wrapAdjustment() + offset) | 0;
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

        this._base = (this._byteArray.byteOffset + this._addressOffset) | 0;
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

    // The `long` methods are tiny dispatchers on the backing, decided at wrap: V8 inlines a small function whatever its
    // callers have already inlined, and the cumulative inlining budget (920 bytecode bytes) then goes to the compact
    // body of the backing in use, so that a value above 2^31 is not boxed across a call (spec 5.3).

    public getLongVolatile(index: number): number {
        return this._shared ? this.getLongShared(index) : this.getLongPlain(index);
    }

    public putLongVolatile(index: number, value: number): void {
        if (this._shared) {
            this.putLongShared(index, value);
        } else {
            this.putLongPlain(index, value);
        }
    }

    public getLongAcquire(index: number): number {
        return this._shared ? this.getLongShared(index) : this.getLongPlain(index);
    }

    public putLongOrdered(index: number, value: number): void {
        this.putLongRelease(index, value);
    }

    public putLongRelease(index: number, value: number): void {
        if (this._shared) {
            this.putLongShared(index, value);
        } else {
            this.putLongPlain(index, value);
        }
    }

    public addLongOrdered(index: number, increment: number): number {
        return this.addLongRelease(index, increment);
    }

    public addLongRelease(index: number, increment: number): number {
        return this._shared ? this.getAndAddLongShared(index, increment) : this.getAndAddLongPlain(index, increment);
    }

    public putLongOpaque(index: number, value: number): void {
        if (this._shared) {
            this.putLongShared(index, value);
        } else {
            this.putLongPlain(index, value);
        }
    }

    public getLongOpaque(index: number): number {
        return this._shared ? this.getLongShared(index) : this.getLongPlain(index);
    }

    public addLongOpaque(index: number, increment: number): number {
        return this._shared ? this.getAndAddLongShared(index, increment) : this.getAndAddLongPlain(index, increment);
    }

    public compareAndSetLong(index: number, expectedValue: number, updateValue: number): boolean {
        return this._shared
            ? this.compareAndSetLongShared(index, expectedValue, updateValue)
            : this.compareAndSetLongPlain(index, expectedValue, updateValue);
    }

    public compareAndExchangeLong(index: number, expectedValue: number, updateValue: number): number {
        return this._shared
            ? this.compareAndExchangeLongShared(index, expectedValue, updateValue)
            : this.compareAndExchangeLongPlain(index, expectedValue, updateValue);
    }

    public getAndSetLong(index: number, value: number): number {
        return this._shared ? this.getAndSetLongShared(index, value) : this.getAndSetLongPlain(index, value);
    }

    public getAndAddLong(index: number, delta: number): number {
        return this._shared ? this.getAndAddLongShared(index, delta) : this.getAndAddLongPlain(index, delta);
    }

    /**
     * Port-only (spec D16): the 64-bit word at `index` as an `int` pair, for the whole 64-bit range (the raw tails of
     * the log buffer, D12). Volatile, and on a shared buffer exact through {@link LongStripes}. Allocates nothing.
     *
     * @param index of the `long`.
     * @param out   receives the low half at 0 and the high half at 1.
     */
    public getLongVolatileHalves(index: number, out: Int32Array): void {
        if (this._shared) {
            this.getLongHalvesShared(index, out);
        } else {
            this.getLongHalvesPlain(index, out);
        }
    }

    /**
     * Port-only (spec D16): stores the 64-bit word at `index` from its two `int` halves, volatile. Allocates nothing.
     *
     * @param index of the `long`.
     * @param lo    the low 32 bits.
     * @param hi    the high 32 bits.
     */
    public putLongVolatileHalves(index: number, lo: number, hi: number): void {
        if (this._shared) {
            this.putLongHalvesShared(index, lo, hi);
        } else {
            this.putLongHalvesPlain(index, lo, hi);
        }
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
        return this._shared
            ? this.compareAndSetLongHalvesShared(index, expectedLo, expectedHi, updateLo, updateHi)
            : this.compareAndSetLongHalvesPlain(index, expectedLo, expectedHi, updateLo, updateHi);
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
        if (this._shared) {
            this.getAndAddLongHalvesShared(index, delta, out);
        } else {
            this.getAndAddLongHalvesPlain(index, delta, out);
        }
    }

    public getIntVolatile(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            return Atomics.load(this._i32!, this.atomicIndex(index, 4, 2));
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public putIntVolatile(index: number, value: number): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            Atomics.store(this._i32!, this.atomicIndex(index, 4, 2), value);
            return;
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntAcquire(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            Atomics.store(this._i32!, this.atomicIndex(index, 4, 2), value);
            return;
        }

        this._dataView.setInt32(this._addressOffset + index, value, true);
    }

    public getIntOpaque(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        if (this._shared) {
            return Atomics.load(this._i32!, this.atomicIndex(index, 4, 2));
        }

        return this._dataView.getInt32(this._addressOffset + index, true);
    }

    public addIntOpaque(index: number, increment: number): number {
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
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
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        if (this._shared) {
            return Atomics.load(this._i16!, this.atomicIndex(index, 2, 1));
        }

        return this._dataView.getInt16(this._addressOffset + index, true);
    }

    public putShortVolatile(index: number, value: number): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        if (this._shared) {
            Atomics.store(this._i16!, this.atomicIndex(index, 2, 1), value);
            return;
        }

        this._dataView.setInt16(this._addressOffset + index, value, true);
    }

    public getByteVolatile(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        if (this._shared) {
            return (Atomics.load(this._byteArray, this._addressOffset + index) << 24) >> 24;
        }

        return this._dataView.getInt8(this._addressOffset + index);
    }

    public putByteVolatile(index: number, value: number): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        if (this._shared) {
            Atomics.store(this._byteArray, this._addressOffset + index, value);
            return;
        }

        this._dataView.setInt8(this._addressOffset + index, value);
    }

    public getCharVolatile(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_CHAR);
        }

        if (this._shared) {
            return Atomics.load(this._i16!, this.atomicIndex(index, 2, 1)) & 0xffff;
        }

        return this._dataView.getUint16(this._addressOffset + index, true);
    }

    public putCharVolatile(index: number, value: number): void {
        if (SHOULD_BOUNDS_CHECK) {
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

    // The `long` operations over an ArrayBuffer (one thread): plain accesses with the same names and results.

    private getLongPlain(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, true);
    }

    private putLongPlain(index: number, value: number): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        dataViewSetLong(this._dataView, this._addressOffset + index, value, true);
    }

    private getAndAddLongPlain(index: number, delta: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, oldValue + delta, true);
        return oldValue;
    }

    private compareAndSetLongPlain(index: number, expectedValue: number, updateValue: number): boolean {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        if (dataViewGetLong(this._dataView, offset, true) === expectedValue) {
            dataViewSetLong(this._dataView, offset, updateValue, true);
            return true;
        }

        return false;
    }

    private compareAndExchangeLongPlain(index: number, expectedValue: number, updateValue: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const witness = dataViewGetLong(this._dataView, offset, true);
        if (witness === expectedValue) {
            dataViewSetLong(this._dataView, offset, updateValue, true);
        }

        return witness;
    }

    private getAndSetLongPlain(index: number, value: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        const oldValue = dataViewGetLong(this._dataView, offset, true);
        dataViewSetLong(this._dataView, offset, value, true);
        return oldValue;
    }

    private getLongHalvesPlain(index: number, out: Int32Array): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        out[0] = this._dataView.getInt32(offset, true);
        out[1] = this._dataView.getInt32(offset + 4, true);
    }

    private putLongHalvesPlain(index: number, lo: number, hi: number): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        const offset = this._addressOffset + index;
        this._dataView.setInt32(offset, lo, true);
        this._dataView.setInt32(offset + 4, hi, true);
    }

    private compareAndSetLongHalvesPlain(
        index: number,
        expectedLo: number,
        expectedHi: number,
        updateLo: number,
        updateHi: number,
    ): boolean {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
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

    private getAndAddLongHalvesPlain(index: number, delta: number, out: Int32Array): void {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        if (!(Number.isInteger(delta) && delta >= 0 && delta <= 0x7fffffff)) {
            throw badDelta(delta);
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

    // The striped 64-bit operations of a shared buffer (spec D16). Each is ONE compact body with everything inlined (the
    // range check, the alignment check, the safe integer check and the stripe hash), so that TurboFan inlines it into
    // the caller (a body must stay under V8's 460 bytecode bytes for that) and a value above 2^31 is not boxed in a heap
    // number across a call. The common shape:
    //
    //   1. every check that can throw runs BEFORE the stripe is taken;
    //   2. the writer takes the stripe with a test-and-set, `Atomics.or(table, s, 1)`: if the old value was even, the
    //      stripe is ours, and `q` is that even value; otherwise `lockSlow` waits for the holder;
    //   3. inside the lock the payload READS are plain element reads. The sequentially consistent `Atomics.or` read the
    //      unlock store of the previous holder, so it synchronizes-with it (ECMA-262 section 29.4) and those reads are
    //      race free. The payload WRITES stay `Atomics.store`: a plain store is not ordered for the readers, which do
    //      not take the lock (a plain payload store is incorrect, see the T2b review);
    //   4. the HIGH half is stored first and only when it changed, the LOW half is ALWAYS stored LAST. Aeron readers that
    //      read only the low `int` of a 64-bit word without the stripe (for example `frameLengthVolatile` after
    //      `TermRebuilder`'s `putLongRelease` of the first header word, where the high half holds the version, flags and
    //      type) must see the high half once the low half is visible, otherwise a frame reads as type 0, padding;
    //   5. a write unlocks with `q + 2`, so that a reader can tell that a write happened between its two loads. A path
    //      that wrote nothing (a compare-and-set miss, an overflow thrown after the lock) restores `q`: no reader can
    //      have seen anything change, and every throw after the lock unlocks first.
    //
    // A reader never writes the stripe: it loads the stripe, the two halves and the stripe again, and retries while the
    // stripe is odd or changed. Retries are counted, and a stripe held for 2^28 spins throws (see lockSlow).

    private getLongShared(index: number): number {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        for (let spins = 0; ;) {
            const q = Atomics.load(table, s);
            const lo = Atomics.load(view, e);
            const hi = Atomics.load(view, e + 1);
            if (0 === (q & 1) && q === Atomics.load(table, s)) {
                const value = hi * TWO_POW_32 + (lo >>> 0);
                if (!Number.isSafeInteger(value)) {
                    throw overflow(lo, hi);
                }

                return value;
            }

            if (++spins >= STRIPE_SPIN_CAP) {
                throw deadHolder(s);
            }
        }
    }

    private putLongShared(index: number, value: number): void {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!Number.isSafeInteger(value)) {
            requireSafe(value, 0);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const hi = Math.floor(value / TWO_POW_32);
        if (hi !== view[e + 1]) {
            Atomics.store(view, e + 1, hi);
        }

        Atomics.store(view, e, value | 0);
        Atomics.store(table, s, (q + 2) | 0);
    }

    /** Java's `getAndAddLong`; the sum is range checked (D5), with nothing written and the stripe restored when outside. */
    private getAndAddLongShared(index: number, delta: number): number {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!Number.isSafeInteger(delta)) {
            requireSafe(delta, 0);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const lo = view[e]!;
        const hi = view[e + 1]!;
        const oldValue = hi * TWO_POW_32 + (lo >>> 0);
        const newValue = oldValue + delta;
        if (!Number.isSafeInteger(oldValue) || !Number.isSafeInteger(newValue)) {
            Atomics.store(table, s, q);
            throw addOverflow(lo, hi, delta);
        }

        const newHi = Math.floor(newValue / TWO_POW_32);
        if (newHi !== hi) {
            Atomics.store(view, e + 1, newHi);
        }

        Atomics.store(view, e, newValue | 0);
        Atomics.store(table, s, (q + 2) | 0);
        return oldValue;
    }

    private compareAndSetLongShared(index: number, expectedValue: number, updateValue: number): boolean {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!Number.isSafeInteger(expectedValue) || !Number.isSafeInteger(updateValue)) {
            requireSafe(expectedValue, updateValue);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        // the halves are compared, so that a stored value outside +/-(2^53 - 1) is a miss and not a throw
        const hi = view[e + 1]!;
        const hit = view[e] === (expectedValue | 0) && hi === Math.floor(expectedValue / TWO_POW_32);
        if (hit) {
            const newHi = Math.floor(updateValue / TWO_POW_32);
            if (newHi !== hi) {
                Atomics.store(view, e + 1, newHi);
            }

            Atomics.store(view, e, updateValue | 0);
            q = (q + 2) | 0;
        }

        Atomics.store(table, s, q);
        return hit;
    }

    private compareAndExchangeLongShared(index: number, expectedValue: number, updateValue: number): number {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!Number.isSafeInteger(expectedValue) || !Number.isSafeInteger(updateValue)) {
            requireSafe(expectedValue, updateValue);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const lo = view[e]!;
        const hi = view[e + 1]!;
        const witness = hi * TWO_POW_32 + (lo >>> 0);
        if (!Number.isSafeInteger(witness)) {
            Atomics.store(table, s, q);
            throw overflow(lo, hi);
        }

        if (witness === expectedValue) {
            const newHi = Math.floor(updateValue / TWO_POW_32);
            if (newHi !== hi) {
                Atomics.store(view, e + 1, newHi);
            }

            Atomics.store(view, e, updateValue | 0);
            q = (q + 2) | 0;
        }

        Atomics.store(table, s, q);
        return witness;
    }

    private getAndSetLongShared(index: number, value: number): number {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!Number.isSafeInteger(value)) {
            requireSafe(value, 0);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const lo = view[e]!;
        const hi = view[e + 1]!;
        const oldValue = hi * TWO_POW_32 + (lo >>> 0);
        if (!Number.isSafeInteger(oldValue)) {
            Atomics.store(table, s, q);
            throw overflow(lo, hi);
        }

        const newHi = Math.floor(value / TWO_POW_32);
        if (newHi !== hi) {
            Atomics.store(view, e + 1, newHi);
        }

        Atomics.store(view, e, value | 0);
        Atomics.store(table, s, (q + 2) | 0);
        return oldValue;
    }

    private getLongHalvesShared(index: number, out: Int32Array): void {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        for (let spins = 0; ;) {
            const q = Atomics.load(table, s);
            const lo = Atomics.load(view, e);
            const hi = Atomics.load(view, e + 1);
            if (0 === (q & 1) && q === Atomics.load(table, s)) {
                out[0] = lo;
                out[1] = hi;
                return;
            }

            if (++spins >= STRIPE_SPIN_CAP) {
                throw deadHolder(s);
            }
        }
    }

    private putLongHalvesShared(index: number, lo: number, hi: number): void {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        if (view[e + 1] !== (hi | 0)) {
            Atomics.store(view, e + 1, hi | 0);
        }

        Atomics.store(view, e, lo | 0);
        Atomics.store(table, s, (q + 2) | 0);
    }

    private compareAndSetLongHalvesShared(
        index: number,
        expectedLo: number,
        expectedHi: number,
        updateLo: number,
        updateHi: number,
    ): boolean {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const hi = view[e + 1]!;
        const hit = view[e] === (expectedLo | 0) && hi === (expectedHi | 0);
        if (hit) {
            if (hi !== (updateHi | 0)) {
                Atomics.store(view, e + 1, updateHi | 0);
            }

            Atomics.store(view, e, updateLo | 0);
            q = (q + 2) | 0;
        }

        Atomics.store(table, s, q);
        return hit;
    }

    private getAndAddLongHalvesShared(index: number, delta: number, out: Int32Array): void {
        const address = this._base + index;
        if (0 !== (address & 7) || (SHOULD_BOUNDS_CHECK && (index < 0 || index > this._capacity - 8))) {
            throw this.accessError(index);
        }

        if (!(delta >= 0 && delta <= 0x7fffffff && (delta | 0) === delta)) {
            throw badDelta(delta);
        }

        const s = (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4;
        const e = address >>> 2;
        const table = this._stripes!;
        const view = this._i32!;
        let q = Atomics.or(table, s, 1);
        if (0 !== (q & 1)) {
            q = lockSlow(table, s);
        }

        const lo = view[e]!;
        const hi = view[e + 1]!;
        const sum = (lo >>> 0) + delta;
        if (sum >= TWO_POW_32) {
            // the carry: INT32_MAX plus one wraps to INT32_MIN, as the Java 64-bit add does
            Atomics.store(view, e + 1, (hi + 1) | 0);
        }

        Atomics.store(view, e, sum | 0);
        Atomics.store(table, s, (q + 2) | 0);
        out[0] = lo;
        out[1] = hi;
    }

    /**
     * Port-only (spec D16): sets the number of spins after which a stripe that stays held is declared dead (default
     * 2^28). For the tests of the dead-holder rule, which lower it and restore it.
     */
    public static setStripeSpinCapForTests(spins: number): void {
        STRIPE_SPIN_CAP = spins;
    }

    /**
     * The error of an access that failed the inline checks of a shared `long` operation: an out of range index
     * (thrown by the bounds check, as for every other method) or an address that is not a multiple of 8.
     */
    private accessError(index: number): IllegalArgumentException {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return new IllegalArgumentException('Unaligned atomic access: index=' + index + ' size=8');
    }

    /** A short form for pretty-format and JSON (issue #47): the identity of the window, never its bytes. */
    public toJSON(): object {
        return {
            type: 'UnsafeBuffer',
            capacity: this._capacity,
            addressOffset: this._addressOffset,
            shared: this._shared,
        };
    }

    /** A short form for `util.inspect` (issue #47). */
    public [INSPECT_CUSTOM](): string {
        return this.toString();
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
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }
    }
}
