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
// Port of org/agrona/MutableDirectBuffer.java @ Agrona 2.6.1
import type { DirectBuffer } from './DirectBuffer.js';
import type { ByteOrder } from './jdk.js';

/**
 * Expands on the {@link DirectBuffer} by adding methods to write to the buffer.
 * <p>
 * A Java `long` is a `number` that is exact to +/-(2^53 - 1): `putLong` throws a `RangeError`, writing nothing, for a
 * value that is not a safe integer, and `putLongBigInt` writes the whole 64 bits.
 */
export interface MutableDirectBuffer extends DirectBuffer {
    /**
     * Is the underlying buffer expandable.
     */
    isExpandable(): boolean;

    /**
     * Set a region of memory to a given byte value.
     */
    setMemory(index: number, length: number, value: number): void;

    putLong(index: number, value: number, byteOrder?: ByteOrder): void;

    /**
     * Put a 64-bit value, held in a `bigint`, at a given index.
     */
    putLongBigInt(index: number, value: bigint, byteOrder?: ByteOrder): void;

    putInt(index: number, value: number, byteOrder?: ByteOrder): void;

    /**
     * Put an int as ASCII digits, with a minus sign when negative, returning the number of bytes written.
     */
    putIntAscii(index: number, value: number): number;

    /**
     * Put a natural (non-negative) int as ASCII digits, returning the number of bytes written.
     */
    putNaturalIntAscii(index: number, value: number): number;

    /**
     * Put a natural int as ASCII digits padded with zeros to `length` bytes.
     *
     * @throws NumberFormatException if the value does not fit in `length` bytes.
     */
    putNaturalPaddedIntAscii(index: number, length: number, value: number): void;

    /**
     * Put a natural int as ASCII digits ending at `endExclusive`, returning the index of the first digit.
     */
    putNaturalIntAsciiFromEnd(value: number, endExclusive: number): number;

    /**
     * Put a natural long as ASCII digits, returning the number of bytes written.
     */
    putNaturalLongAscii(index: number, value: number): number;

    /**
     * Put a long as ASCII digits, with a minus sign when negative, returning the number of bytes written.
     */
    putLongAscii(index: number, value: number): number;

    putDouble(index: number, value: number, byteOrder?: ByteOrder): void;

    putFloat(index: number, value: number, byteOrder?: ByteOrder): void;

    putShort(index: number, value: number, byteOrder?: ByteOrder): void;

    putChar(index: number, value: number, byteOrder?: ByteOrder): void;

    putByte(index: number, value: number): void;

    /**
     * Put an array into the underlying buffer, or `length` bytes of it from `offset`, or `length` bytes of another
     * {@link DirectBuffer} from `srcIndex`.
     */
    putBytes(index: number, src: Uint8Array): void;
    putBytes(index: number, src: Uint8Array, offset: number, length: number): void;
    putBytes(index: number, srcBuffer: DirectBuffer, srcIndex: number, length: number): void;

    /**
     * Encode a String as ASCII bytes to the buffer with a length prefix, replacing a character above 127 with '?'.
     * A null value is written as a zero length.
     *
     * @return the number of bytes put to the buffer.
     */
    putStringAscii(index: number, value: string | null, byteOrder?: ByteOrder): number;

    /**
     * Encode a String as ASCII bytes to the buffer without a length prefix, or part of it, from `valueOffset` for
     * `length` characters.
     *
     * @return the number of bytes put to the buffer.
     */
    putStringWithoutLengthAscii(index: number, value: string | null): number;
    putStringWithoutLengthAscii(index: number, value: string | null, valueOffset: number, length: number): number;

    /**
     * Encode a String as UTF-8 bytes to the buffer with a length prefix. A null value is written as "null".
     *
     * @throws IllegalArgumentException if the encoded bytes are longer than `maxEncodedLength`.
     * @return the number of bytes put to the buffer.
     */
    putStringUtf8(index: number, value: string | null): number;
    putStringUtf8(index: number, value: string | null, byteOrder: ByteOrder): number;
    putStringUtf8(index: number, value: string | null, maxEncodedLength: number): number;
    putStringUtf8(index: number, value: string | null, byteOrder: ByteOrder, maxEncodedLength: number): number;

    /**
     * Encode a String as UTF-8 bytes to the buffer without a length prefix.
     *
     * @return the number of bytes put to the buffer.
     */
    putStringWithoutLengthUtf8(index: number, value: string | null): number;
}
