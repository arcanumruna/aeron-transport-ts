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
// Port of org/agrona/concurrent/AtomicBuffer.java @ Agrona 2.6.1
import { BitUtil } from '../BitUtil.js';
import type { MutableDirectBuffer } from '../MutableDirectBuffer.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * Abstraction over a range of buffer types that allows type to be accessed with memory ordering semantics.
 * <p>
 * Over an `ArrayBuffer` (one thread) the volatile, ordered, release, acquire and opaque operations and the atomic
 * compare-and-set, get-and-add and get-and-set operations are plain operations with the same names and results. Over
 * a `SharedArrayBuffer` the `byte` to `int` ones use `Atomics` and the `long` ones are 64-bit atomics on Java's word
 * through the striped lock table `LongStripes`, allocating nothing (spec D16).
 * <p>
 * Rule of D16: a thread that uses shared buffers must never be `worker.terminate()`d while it can be inside a buffer
 * operation, because a thread killed while it holds a stripe leaves it locked for ever. Agents stop cooperatively
 * (`AgentRunner.close`); a dying producer is modelled by the worker exiting itself between operations. After 2^28 spins
 * on a held stripe an operation throws `IllegalStateException`: a failure detector, not a timeout that anything
 * depends on.
 */
export interface AtomicBuffer extends MutableDirectBuffer {
    /**
     * Verify that the underlying buffer is correctly aligned to prevent word tearing, other ordering issues and
     * the JVM from crashing.
     *
     * @throws IllegalStateException if the alignment is not correct.
     */
    verifyAlignment(): void;

    getLongVolatile(index: number): number;
    getLongAcquire(index: number): number;
    putLongVolatile(index: number, value: number): void;
    putLongOrdered(index: number, value: number): void;
    putLongRelease(index: number, value: number): void;
    addLongOrdered(index: number, increment: number): number;
    putLongOpaque(index: number, value: number): void;
    getLongOpaque(index: number): number;
    addLongOpaque(index: number, increment: number): number;
    addLongRelease(index: number, increment: number): number;
    compareAndSetLong(index: number, expectedValue: number, updateValue: number): boolean;
    compareAndExchangeLong(index: number, expectedValue: number, updateValue: number): number;
    getAndSetLong(index: number, value: number): number;
    getAndAddLong(index: number, delta: number): number;

    getIntVolatile(index: number): number;
    putIntVolatile(index: number, value: number): void;
    getIntAcquire(index: number): number;
    putIntOrdered(index: number, value: number): void;
    putIntRelease(index: number, value: number): void;
    addIntOrdered(index: number, increment: number): number;
    addIntRelease(index: number, increment: number): number;
    putIntOpaque(index: number, value: number): void;
    getIntOpaque(index: number): number;
    addIntOpaque(index: number, increment: number): number;
    compareAndSetInt(index: number, expectedValue: number, updateValue: number): boolean;
    compareAndExchangeInt(index: number, expectedValue: number, updateValue: number): number;
    getAndSetInt(index: number, value: number): number;
    getAndAddInt(index: number, delta: number): number;

    getShortVolatile(index: number): number;
    putShortVolatile(index: number, value: number): void;
    getCharVolatile(index: number): number;
    putCharVolatile(index: number, value: number): void;
    getByteVolatile(index: number): number;
    putByteVolatile(index: number, value: number): void;

    /**
     * Port-only (spec D16): the 64-bit word at `index` as an `int` pair over the full 64-bit range, volatile (the raw
     * tails of the log buffer, D12). Allocates nothing.
     *
     * @param out receives the low half at 0 and the high half at 1.
     */
    getLongVolatileHalves(index: number, out: Int32Array): void;

    /** Port-only (spec D16): stores the 64-bit word at `index` from its `int` halves, volatile. */
    putLongVolatileHalves(index: number, lo: number, hi: number): void;

    /** Port-only (spec D16): compare-and-set of the 64-bit word at `index` over its `int` halves. */
    compareAndSetLongHalves(
        index: number,
        expectedLo: number,
        expectedHi: number,
        updateLo: number,
        updateHi: number,
    ): boolean;

    /**
     * Port-only (spec D16): adds `delta`, an `int` in [0, 2^31 - 1], to the 64-bit word at `index` in one atomic step,
     * carrying into the high half (`INT32_MAX` plus a carry wraps to `INT32_MIN`).
     *
     * @param out receives the OLD low half at 0 and the OLD high half at 1.
     * @throws IllegalArgumentException if `delta` is out of range.
     */
    getAndAddLongHalves(index: number, delta: number, out: Int32Array): void;
}

export const AtomicBuffer = {
    /**
     * Buffer alignment to ensure atomic word accesses.
     */
    ALIGNMENT: SIZE_OF_LONG,
} as const;
