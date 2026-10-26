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
// Port of org/agrona/BufferUtil.java @ Agrona 2.6.1
import { BitUtil } from './BitUtil.js';
import { ByteOrder, IllegalArgumentException, Objects } from './jdk.js';

const { isPowerOfTwo } = BitUtil;

/**
 * Common functions associated with buffers.
 * <p>
 * The members that work on a Java `ByteBuffer` or on a raw memory address are not ported (see docs/mapping.md).
 */
export class BufferUtil {
    /**
     * UTF-8 encoded bytes for "null".
     */
    public static readonly NULL_BYTES: Uint8Array = new TextEncoder().encode('null');

    /**
     * Native byte order.
     */
    public static readonly NATIVE_BYTE_ORDER: ByteOrder = ByteOrder.nativeOrder();

    /**
     * Byte array base offset: there is no object header in front of a typed array's elements.
     */
    public static readonly ARRAY_BASE_OFFSET = 0;

    private constructor() {}

    /**
     * Bounds check the access range and throw a {@link IndexOutOfBoundsException} if exceeded.
     *
     * @param buffer to be checked.
     * @param index  at which the access will begin.
     * @param length of the range accessed.
     */
    public static boundsCheck(buffer: Uint8Array, index: number, length: number): void {
        Objects.checkFromIndexSize(index, length, buffer.length);
    }

    /**
     * Allocate a new buffer of `capacity` bytes. The alignment is checked to be a power of 2, then ignored: the memory
     * of an `ArrayBuffer` has no address that JavaScript can see or choose.
     *
     * @param capacity  of the new buffer.
     * @param alignment to be applied.
     * @return the new buffer.
     * @throws IllegalArgumentException if the alignment is not a power of 2.
     */
    public static allocateDirectAligned(capacity: number, alignment: number): ArrayBuffer {
        if (!isPowerOfTwo(alignment)) {
            throw new IllegalArgumentException('Must be a power of 2: alignment=' + alignment);
        }

        return new ArrayBuffer(capacity);
    }

    /**
     * Port-only: allocate a new `SharedArrayBuffer` of `length` bytes, for memory that two agents (worker threads)
     * share (spec D16). The alignment is checked to be a power of 2, then ignored, as in
     * {@link allocateDirectAligned}.
     *
     * @param length    of the new buffer.
     * @param alignment to be applied.
     * @return the new buffer.
     * @throws IllegalArgumentException if the alignment is not a power of 2.
     */
    public static allocateShared(length: number, alignment: number): SharedArrayBuffer {
        if (!isPowerOfTwo(alignment)) {
            throw new IllegalArgumentException('Must be a power of 2: alignment=' + alignment);
        }

        return new SharedArrayBuffer(length);
    }
}
