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
 * a `SharedArrayBuffer` they use `Atomics` (spec D16).
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
    /**
     * Port-only (spec D16): writes a `long` for readers on other threads that use {@link getLongVolatileSeq}, a
     * sequence lock for one writer whose sequence `int` is at `seqIndex`. Allocates nothing. On a buffer that is not
     * shared it is a plain `putLong`.
     */
    putLongReleaseSeq(index: number, value: number, seqIndex: number): void;
    /**
     * Port-only (spec D16): reads a `long` written with {@link putLongReleaseSeq}; never torn. Allocates nothing.
     */
    getLongVolatileSeq(index: number, seqIndex: number): number;

    getByteVolatile(index: number): number;
    putByteVolatile(index: number, value: number): void;
}

export const AtomicBuffer = {
    /**
     * Buffer alignment to ensure atomic word accesses.
     */
    ALIGNMENT: SIZE_OF_LONG,
} as const;
