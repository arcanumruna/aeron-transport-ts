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
// Port of org/agrona/DirectBuffer.java @ Agrona 2.6.1
import { BitUtil } from './BitUtil.js';
import type { Appendable, ByteOrder } from './jdk.js';
import type { MutableDirectBuffer } from './MutableDirectBuffer.js';

const { SIZE_OF_INT } = BitUtil;

/**
 * Abstraction over a range of buffer types that allows fields to be read in native typed fashion.
 * <p>
 * A Java `long` is a `number` that is exact to +/-(2^53 - 1): `getLong` throws a `RangeError` for a stored value that
 * is outside that range, and `getLongBigInt` reads the whole 64 bits. The Java methods that take a `ByteBuffer` or a raw
 * memory address are not ported.
 */
export interface DirectBuffer {
    /**
     * Attach a view to a byte array, an `ArrayBuffer` (the Java `ByteBuffer`) or another buffer for providing direct
     * access, with an optional window of `length` bytes from `offset`.
     */
    wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer): void;
    wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer, offset: number, length: number): void;

    /**
     * Get the offset of the first byte of the buffer within {@link byteArray}.
     */
    addressOffset(): number;

    /**
     * Get the underlying byte array if one exists.
     */
    byteArray(): Uint8Array;

    /**
     * Get the capacity of the underlying buffer.
     */
    capacity(): number;

    /**
     * Check that a given limit is not greater than the capacity of a buffer from a given offset.
     *
     * @throws IndexOutOfBoundsException if limit is beyond buffer capacity.
     */
    checkLimit(limit: number): void;

    /**
     * Get the value at a given index.
     */
    getLong(index: number, byteOrder?: ByteOrder): number;

    /**
     * Get the 64-bit value at a given index as a `bigint`.
     */
    getLongBigInt(index: number, byteOrder?: ByteOrder): bigint;

    getInt(index: number, byteOrder?: ByteOrder): number;

    parseNaturalIntAscii(index: number, length: number): number;

    parseNaturalLongAscii(index: number, length: number): number;

    parseIntAscii(index: number, length: number): number;

    parseLongAscii(index: number, length: number): number;

    getDouble(index: number, byteOrder?: ByteOrder): number;

    getFloat(index: number, byteOrder?: ByteOrder): number;

    getShort(index: number, byteOrder?: ByteOrder): number;

    getChar(index: number, byteOrder?: ByteOrder): number;

    getByte(index: number): number;

    /**
     * Get from the underlying buffer into a supplied byte array, from `offset` for `length` bytes (the whole array by
     * default), or into a {@link MutableDirectBuffer} at `dstIndex` for `length` bytes.
     */
    getBytes(index: number, dst: Uint8Array): void;
    getBytes(index: number, dst: Uint8Array, offset: number, length: number): void;
    getBytes(index: number, dstBuffer: MutableDirectBuffer, dstIndex: number, length: number): void;

    /**
     * Get a String from bytes encoded in ASCII format that is length prefixed, or read `length` bytes after the length
     * prefix. Bytes above 127 are replaced with '?'. A {@link Appendable} receives the characters instead of a String,
     * and the number of characters is returned.
     */
    getStringAscii(index: number): string;
    getStringAscii(index: number, appendable: Appendable): number;
    getStringAscii(index: number, byteOrder: ByteOrder): string;
    getStringAscii(index: number, appendable: Appendable, byteOrder: ByteOrder): number;
    getStringAscii(index: number, length: number): string;
    getStringAscii(index: number, length: number, appendable: Appendable): number;

    /**
     * Get part of a String from bytes encoded in ASCII format that is not length prefixed.
     */
    getStringWithoutLengthAscii(index: number, length: number): string;
    getStringWithoutLengthAscii(index: number, length: number, appendable: Appendable): number;

    /**
     * Get a String from bytes encoded in UTF-8 format that is length prefixed.
     */
    getStringUtf8(index: number): string;
    getStringUtf8(index: number, byteOrder: ByteOrder): string;
    getStringUtf8(index: number, length: number): string;

    /**
     * Get part of String from bytes encoded in UTF-8 format that is not length prefixed.
     */
    getStringWithoutLengthUtf8(index: number, length: number): string;

    /**
     * Check that a given length of bytes can be read from a given index.
     *
     * @throws IndexOutOfBoundsException if the range is not within the buffer.
     */
    boundsCheck(index: number, length: number): void;

    /**
     * Return the wrap adjustment: the offset of the first byte of this buffer in the array it wraps.
     */
    wrapAdjustment(): number;

    /**
     * Compare the contents of this buffer with another, as `Comparable<DirectBuffer>` does.
     */
    compareTo(that: DirectBuffer): number;

    /**
     * The `java.lang.Object` method: a hash of the whole capacity of the buffer.
     */
    hashCode(): number;

    /**
     * The `java.lang.Object` method: true for a buffer of the same class and capacity with the same content.
     */
    equals(obj: unknown): boolean;
}

export const DirectBuffer = {
    /**
     * Length of the header on strings to denote the length of the string in bytes.
     */
    STR_HEADER_LEN: SIZE_OF_INT,

    /**
     * Name of the system property that specifies whether array content printout should be disabled.
     *
     * @deprecated no longer used.
     */
    DISABLE_ARRAY_CONTENT_PRINTOUT_PROP_NAME: 'agrona.disable.array.printout',

    /**
     * Name of the system property that specifies whether bounds checks should be disabled.
     */
    DISABLE_BOUNDS_CHECKS_PROP_NAME: 'agrona.disable.bounds.checks',

    /**
     * Should the bounds checks be performed. There are no system properties in JavaScript: this is always `true`.
     */
    SHOULD_BOUNDS_CHECK: true,
} as const;
