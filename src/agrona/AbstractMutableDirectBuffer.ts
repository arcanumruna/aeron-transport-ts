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
// Port of org/agrona/AbstractMutableDirectBuffer.java @ Agrona 2.6.1
import { AsciiEncoding } from './AsciiEncoding.js';
import { AsciiNumberFormatException } from './AsciiNumberFormatException.js';
import { BitUtil } from './BitUtil.js';
import { BufferUtil } from './BufferUtil.js';
import { DirectBuffer } from './DirectBuffer.js';
import {
    type Appendable,
    Byte,
    ByteOrder,
    dataViewGetLong,
    dataViewSetLong,
    IllegalArgumentException,
    IndexOutOfBoundsException,
    Integer,
    Long,
    longToNumber,
    newStringAscii,
    NumberFormatException,
    Objects,
} from './jdk.js';
import type { MutableDirectBuffer } from './MutableDirectBuffer.js';

const { SHOULD_BOUNDS_CHECK, STR_HEADER_LEN } = DirectBuffer;
const { SIZE_OF_BYTE, SIZE_OF_CHAR, SIZE_OF_DOUBLE, SIZE_OF_FLOAT, SIZE_OF_INT, SIZE_OF_LONG, SIZE_OF_SHORT } = BitUtil;
const {
    ASCII_DIGITS,
    INT_MAX_DIGITS,
    INTEGER_ABSOLUTE_MIN_VALUE,
    LONG_MAX_DIGITS,
    LONG_MAX_VALUE_DIGITS,
    LONG_MIN_VALUE_DIGITS,
    MIN_INTEGER_VALUE,
    MINUS_SIGN,
    ZERO,
    isDigit,
    isEightDigitAsciiEncodedNumber,
    isFourDigitsAsciiEncodedNumber,
    parseEightDigitsLittleEndian,
    parseFourDigitsLittleEndian,
} = AsciiEncoding;
const { ARRAY_BASE_OFFSET, NATIVE_BYTE_ORDER, NULL_BYTES } = BufferUtil;

const UTF_8_ENCODER = new TextEncoder();
// ignoreBOM: a leading U+FEFF is kept, as `new String(bytes, UTF_8)` does
const UTF_8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * `Unsafe.copyMemory` between two byte arrays.
 */
function copyMemory(src: Uint8Array, srcOffset: number, dst: Uint8Array, dstOffset: number, length: number): void {
    if (src === dst) {
        dst.copyWithin(dstOffset, srcOffset, srcOffset + length);
    } else if (length < 64) {
        for (let i = 0; i < length; i++) {
            dst[dstOffset + i] = src[srcOffset + i]!;
        }
    } else {
        dst.set(src.subarray(srcOffset, srcOffset + length), dstOffset);
    }
}

/**
 * Supports regular, byte ordered, and atomic (memory ordered) access to an underlying buffer. The buffer can be a
 * byte array or an `ArrayBuffer`.
 * <p>
 * The Java fields `byteArray`, `addressOffset` and `capacity` have the same names as their accessors, so the fields are
 * `_byteArray`, `_addressOffset` and `_capacity`. A `DataView` over the byte array, `_dataView`, replaces
 * `sun.misc.Unsafe` as the way to read and write it.
 */
export abstract class AbstractMutableDirectBuffer implements MutableDirectBuffer {
    /**
     * The byte array the buffer is a window of.
     */
    protected _byteArray!: Uint8Array;

    /**
     * A view over the whole of {@link _byteArray}.
     */
    protected _dataView!: DataView;

    /**
     * The offset of the first byte of the buffer in {@link _byteArray}.
     */
    protected _addressOffset = 0;

    /**
     * The capacity of the buffer in bytes.
     */
    protected _capacity = 0;

    /**
     * Constructor for subclasses.
     */
    protected constructor() {}

    public byteArray(): Uint8Array {
        return this._byteArray;
    }

    public addressOffset(): number {
        return this._addressOffset;
    }

    public capacity(): number {
        return this._capacity;
    }

    public checkLimit(limit: number): void {
        if (limit > this._capacity) {
            throw new IndexOutOfBoundsException('limit=' + limit + ' is beyond capacity=' + this._capacity);
        }
    }

    public abstract wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer): void;
    public abstract wrap(buffer: Uint8Array | ArrayBuffer | DirectBuffer, offset: number, length: number): void;

    public abstract wrapAdjustment(): number;

    public abstract isExpandable(): boolean;

    public setMemory(index: number, length: number, value: number): void {
        this.ensureCapacity(index, length);

        const offset = this._addressOffset + index;
        // Uint8Array.fill replaces the long-at-a-time loop for a short region and Unsafe.setMemory for a long one
        this._byteArray.fill(value, offset, offset + length);
    }

    public getLong(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return dataViewGetLong(this._dataView, this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getLongBigInt(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): bigint {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_LONG);
        }

        return this._dataView.getBigInt64(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putLong(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_LONG);

        dataViewSetLong(this._dataView, this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putLongBigInt(index: number, value: bigint, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_LONG);

        this._dataView.setBigInt64(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getInt(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_INT);
        }

        return this._dataView.getInt32(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putInt(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_INT);

        this._dataView.setInt32(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getDouble(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_DOUBLE);
        }

        return this._dataView.getFloat64(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putDouble(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_DOUBLE);

        this._dataView.setFloat64(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getFloat(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_FLOAT);
        }

        return this._dataView.getFloat32(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putFloat(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_FLOAT);

        this._dataView.setFloat32(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getShort(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_SHORT);
        }

        return this._dataView.getInt16(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putShort(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_SHORT);

        this._dataView.setInt16(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getByte(index: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_BYTE);
        }

        return this._dataView.getInt8(this._addressOffset + index);
    }

    public putByte(index: number, value: number): void {
        this.ensureCapacity(index, SIZE_OF_BYTE);

        this._dataView.setInt8(this._addressOffset + index, value);
    }

    public getBytes(index: number, dst: Uint8Array): void;
    public getBytes(index: number, dst: Uint8Array, offset: number, length: number): void;
    public getBytes(index: number, dstBuffer: MutableDirectBuffer, dstIndex: number, length: number): void;
    public getBytes(index: number, dst: Uint8Array | MutableDirectBuffer, offset?: number, length?: number): void {
        if (dst instanceof Uint8Array) {
            if (undefined === offset) {
                if (SHOULD_BOUNDS_CHECK) {
                    this.boundsCheck0(index, dst.length);
                }

                copyMemory(this._byteArray, this._addressOffset + index, dst, ARRAY_BASE_OFFSET, dst.length);
            } else {
                if (SHOULD_BOUNDS_CHECK) {
                    this.boundsCheck0(index, length!);
                    Objects.checkFromIndexSize(offset, length!, dst.length);
                }

                copyMemory(this._byteArray, this._addressOffset + index, dst, ARRAY_BASE_OFFSET + offset, length!);
            }
        } else {
            dst.putBytes(offset!, this, index, length!);
        }
    }

    public putBytes(index: number, src: Uint8Array): void;
    public putBytes(index: number, src: Uint8Array, offset: number, length: number): void;
    public putBytes(index: number, srcBuffer: DirectBuffer, srcIndex: number, length: number): void;
    public putBytes(index: number, src: Uint8Array | DirectBuffer, offset?: number, length?: number): void {
        if (src instanceof Uint8Array) {
            if (undefined === offset) {
                this.ensureCapacity(index, src.length);

                copyMemory(src, ARRAY_BASE_OFFSET, this._byteArray, this._addressOffset + index, src.length);
            } else {
                this.ensureCapacity(index, length!);
                if (SHOULD_BOUNDS_CHECK) {
                    Objects.checkFromIndexSize(offset, length!, src.length);
                }

                copyMemory(src, ARRAY_BASE_OFFSET + offset, this._byteArray, this._addressOffset + index, length!);
            }
        } else {
            this.ensureCapacity(index, length!);
            if (SHOULD_BOUNDS_CHECK) {
                src.boundsCheck(offset!, length!);
            }

            copyMemory(
                src.byteArray(),
                src.addressOffset() + offset!,
                this._byteArray,
                this._addressOffset + index,
                length!,
            );
        }
    }

    public getChar(index: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, SIZE_OF_CHAR);
        }

        return this._dataView.getUint16(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public putChar(index: number, value: number, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): void {
        this.ensureCapacity(index, SIZE_OF_CHAR);

        this._dataView.setUint16(this._addressOffset + index, value, ByteOrder.LITTLE_ENDIAN === byteOrder);
    }

    public getStringAscii(index: number): string;
    public getStringAscii(index: number, appendable: Appendable): number;
    public getStringAscii(index: number, byteOrder: ByteOrder): string;
    public getStringAscii(index: number, appendable: Appendable, byteOrder: ByteOrder): number;
    public getStringAscii(index: number, length: number): string;
    public getStringAscii(index: number, length: number, appendable: Appendable): number;
    public getStringAscii(
        index: number,
        arg1?: number | ByteOrder | Appendable,
        arg2?: Appendable | ByteOrder,
    ): string | number {
        if (undefined === arg1) {
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, true);
            if (0 === length) {
                return '';
            }

            return this.getStringWithoutLengthAscii(index + STR_HEADER_LEN, length);
        } else if (typeof arg1 === 'number') {
            const length = arg1;
            if (undefined === arg2) {
                if (SHOULD_BOUNDS_CHECK) {
                    this.boundsCheck0(index + STR_HEADER_LEN, length);
                }

                if (0 === length) {
                    return '';
                }

                return newStringAscii(this._byteArray, this._addressOffset + index + STR_HEADER_LEN, length);
            } else {
                const appendable = arg2 as Appendable;
                if (SHOULD_BOUNDS_CHECK) {
                    this.boundsCheck0(index, length + STR_HEADER_LEN);
                }

                const array = this._dataView;
                const offset = this._addressOffset;
                for (let i = index + STR_HEADER_LEN, limit = index + STR_HEADER_LEN + length; i < limit; i++) {
                    const c = array.getInt8(offset + i) & 0xffff;
                    appendable.append(String.fromCharCode(c > 127 ? '?'.charCodeAt(0) : c));
                }

                return length;
            }
        } else if (arg1 instanceof ByteOrder) {
            const byteOrder = arg1;
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
            if (0 === length) {
                return '';
            }

            return this.getStringWithoutLengthAscii(index + STR_HEADER_LEN, length);
        } else if (undefined === arg2) {
            const appendable = arg1;
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, true);
            if (0 === length) {
                return 0;
            }

            return this.getStringWithoutLengthAscii(index + STR_HEADER_LEN, length, appendable);
        } else {
            const appendable = arg1;
            const byteOrder = arg2 as ByteOrder;
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
            if (0 === length) {
                return 0;
            }

            return this.getStringWithoutLengthAscii(index + STR_HEADER_LEN, length, appendable);
        }
    }

    public putStringAscii(index: number, value: string | null, byteOrder: ByteOrder = NATIVE_BYTE_ORDER): number {
        if (null === value) {
            this.ensureCapacity(index, STR_HEADER_LEN);

            this._dataView.setInt32(this._addressOffset + index, 0, true);

            return STR_HEADER_LEN;
        } else {
            const length = value.length;
            this.ensureCapacity(index, length + STR_HEADER_LEN);

            const array = this._dataView;
            const offset = this._addressOffset + index;
            array.setInt32(offset, length, ByteOrder.LITTLE_ENDIAN === byteOrder);

            for (let i = 0; i < length; i++) {
                let c = value.charCodeAt(i);
                if (c > 127) {
                    c = '?'.charCodeAt(0);
                }

                array.setInt8(offset + STR_HEADER_LEN + i, c);
            }

            return STR_HEADER_LEN + length;
        }
    }

    public getStringWithoutLengthAscii(index: number, length: number): string;
    public getStringWithoutLengthAscii(index: number, length: number, appendable: Appendable): number;
    public getStringWithoutLengthAscii(index: number, length: number, appendable?: Appendable): string | number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (undefined === appendable) {
            if (0 === length) {
                return '';
            }

            return newStringAscii(this._byteArray, this._addressOffset + index, length);
        }

        const array = this._dataView;
        const offset = this._addressOffset;
        for (let i = index, limit = index + length; i < limit; i++) {
            const c = array.getInt8(offset + i) & 0xffff;
            appendable.append(String.fromCharCode(c > 127 ? '?'.charCodeAt(0) : c));
        }

        return length;
    }

    public putStringWithoutLengthAscii(index: number, value: string | null): number;
    public putStringWithoutLengthAscii(
        index: number,
        value: string | null,
        valueOffset: number,
        length: number,
    ): number;
    public putStringWithoutLengthAscii(
        index: number,
        value: string | null,
        valueOffset?: number,
        length?: number,
    ): number {
        if (null === value) {
            return 0;
        }

        const len = undefined === valueOffset ? value.length : Math.min(value.length - valueOffset, length!);
        this.ensureCapacity(index, len);

        const array = this._dataView;
        const offset = this._addressOffset + index;
        const valueStart = undefined === valueOffset ? 0 : valueOffset;
        for (let i = 0; i < len; i++) {
            let c = value.charCodeAt(valueStart + i);
            if (c > 127) {
                c = '?'.charCodeAt(0);
            }

            array.setInt8(offset + i, c);
        }

        return len;
    }

    public getStringUtf8(index: number): string;
    public getStringUtf8(index: number, byteOrder: ByteOrder): string;
    public getStringUtf8(index: number, length: number): string;
    public getStringUtf8(index: number, arg1?: ByteOrder | number): string {
        if (undefined === arg1) {
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, true);
            if (0 === length) {
                return '';
            }

            return this.getStringWithoutLengthUtf8(index + STR_HEADER_LEN, length);
        } else if (arg1 instanceof ByteOrder) {
            const byteOrder = arg1;
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index, STR_HEADER_LEN);
            }

            const length = this._dataView.getInt32(this._addressOffset + index, ByteOrder.LITTLE_ENDIAN === byteOrder);
            if (0 === length) {
                return '';
            }

            return this.getStringWithoutLengthUtf8(index + STR_HEADER_LEN, length);
        } else {
            const length = arg1;
            if (SHOULD_BOUNDS_CHECK) {
                this.boundsCheck0(index + STR_HEADER_LEN, length);
            }

            const offset = this._addressOffset + index + STR_HEADER_LEN;
            return UTF_8_DECODER.decode(this._byteArray.subarray(offset, offset + length));
        }
    }

    public putStringUtf8(index: number, value: string | null): number;
    public putStringUtf8(index: number, value: string | null, byteOrder: ByteOrder): number;
    public putStringUtf8(index: number, value: string | null, maxEncodedLength: number): number;
    public putStringUtf8(index: number, value: string | null, byteOrder: ByteOrder, maxEncodedLength: number): number;
    public putStringUtf8(index: number, value: string | null, arg1?: ByteOrder | number, arg2?: number): number {
        if (undefined === arg1) {
            return this.putStringUtf8(index, value, Integer.MAX_VALUE);
        } else if (arg1 instanceof ByteOrder) {
            const byteOrder = arg1;
            if (undefined === arg2) {
                return this.putStringUtf8(index, value, byteOrder, Integer.MAX_VALUE);
            }

            const maxEncodedLength = arg2;
            const bytes = value !== null ? UTF_8_ENCODER.encode(value) : NULL_BYTES;
            if (bytes.length > maxEncodedLength) {
                throw new IllegalArgumentException('Encoded string larger than maximum size: ' + maxEncodedLength);
            }

            this.ensureCapacity(index, STR_HEADER_LEN + bytes.length);

            const array = this._byteArray;
            const offset = this._addressOffset + index;
            this._dataView.setInt32(offset, bytes.length, ByteOrder.LITTLE_ENDIAN === byteOrder);
            copyMemory(bytes, ARRAY_BASE_OFFSET, array, offset + STR_HEADER_LEN, bytes.length);

            return STR_HEADER_LEN + bytes.length;
        } else {
            const maxEncodedLength = arg1;
            const bytes = value !== null ? UTF_8_ENCODER.encode(value) : NULL_BYTES;
            if (bytes.length > maxEncodedLength) {
                throw new IllegalArgumentException('Encoded string larger than maximum size: ' + maxEncodedLength);
            }

            this.ensureCapacity(index, STR_HEADER_LEN + bytes.length);

            const array = this._byteArray;
            const offset = this._addressOffset + index;
            this._dataView.setInt32(offset, bytes.length, true);
            copyMemory(bytes, ARRAY_BASE_OFFSET, array, offset + STR_HEADER_LEN, bytes.length);

            return STR_HEADER_LEN + bytes.length;
        }
    }

    public getStringWithoutLengthUtf8(index: number, length: number): string {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (0 === length) {
            return '';
        }

        const offset = this._addressOffset + index;
        return UTF_8_DECODER.decode(this._byteArray.subarray(offset, offset + length));
    }

    public putStringWithoutLengthUtf8(index: number, value: string | null): number {
        const bytes = value !== null ? UTF_8_ENCODER.encode(value) : NULL_BYTES;
        this.ensureCapacity(index, bytes.length);

        copyMemory(bytes, ARRAY_BASE_OFFSET, this._byteArray, this._addressOffset + index, bytes.length);

        return bytes.length;
    }

    public parseNaturalIntAscii(index: number, length: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        if (length < INT_MAX_DIGITS) {
            return this.parsePositiveIntAscii(index, length, index, index + length);
        } else {
            const tally = this.parsePositiveIntAsciiOverflowCheck(index, length, index, index + length);
            if (tally >= INTEGER_ABSOLUTE_MIN_VALUE) {
                this.throwParseIntOverflowError(index, length);
            }

            return tally | 0;
        }
    }

    public parseNaturalLongAscii(index: number, length: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        if (length < LONG_MAX_DIGITS) {
            return longToNumber(this.parsePositiveLongAscii(index, length, index, index + length));
        } else {
            return longToNumber(
                this.parseLongAsciiOverflowCheck(index, length, LONG_MAX_VALUE_DIGITS, index, index + length),
            );
        }
    }

    public parseIntAscii(index: number, length: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        const negative = MINUS_SIGN === this._dataView.getInt8(this._addressOffset + index);
        let i = index;
        if (negative) {
            i++;
            if (1 === length) {
                this.throwParseIntError(index, length);
            }
        }

        const end = index + length;
        if (end - i < INT_MAX_DIGITS) {
            const tally = this.parsePositiveIntAscii(index, length, i, end);
            return negative ? -tally | 0 : tally;
        } else {
            const tally = this.parsePositiveIntAsciiOverflowCheck(index, length, i, end);
            if (tally > INTEGER_ABSOLUTE_MIN_VALUE || (INTEGER_ABSOLUTE_MIN_VALUE === tally && !negative)) {
                this.throwParseIntOverflowError(index, length);
            }

            return (negative ? -tally : tally) | 0;
        }
    }

    public parseLongAscii(index: number, length: number): number {
        if (SHOULD_BOUNDS_CHECK) {
            this.boundsCheck0(index, length);
        }

        if (length <= 0) {
            throw new AsciiNumberFormatException('empty string: index=' + index + ' length=' + length);
        }

        const negative = MINUS_SIGN === this._dataView.getInt8(this._addressOffset + index);
        let i = index;
        if (negative) {
            i++;
            if (1 === length) {
                this.throwParseLongError(index, length);
            }
        }

        const end = index + length;
        if (end - i < LONG_MAX_DIGITS) {
            const tally = this.parsePositiveLongAscii(index, length, i, end);
            return longToNumber(negative ? -tally : tally);
        } else if (negative) {
            return longToNumber(
                BigInt.asIntN(64, -this.parseLongAsciiOverflowCheck(index, length, LONG_MIN_VALUE_DIGITS, i, end)),
            );
        } else {
            return longToNumber(this.parseLongAsciiOverflowCheck(index, length, LONG_MAX_VALUE_DIGITS, i, end));
        }
    }

    public putIntAscii(index: number, value: number): number {
        if (0 === value) {
            this.putByte(index, ZERO);
            return 1;
        }

        let offset: number;
        let quotient = value;
        let digitCount: number, length: number;
        if (value < 0) {
            if (Integer.MIN_VALUE === value) {
                this.putBytes(index, MIN_INTEGER_VALUE);

                return MIN_INTEGER_VALUE.length;
            }

            quotient = -quotient;
            digitCount = AsciiEncoding.digitCount(quotient);
            length = digitCount + 1;

            this.ensureCapacity(index, length);

            offset = this._addressOffset + index;
            this._dataView.setInt8(offset, MINUS_SIGN);
            offset++;
        } else {
            length = digitCount = AsciiEncoding.digitCount(quotient);

            this.ensureCapacity(index, length);

            offset = this._addressOffset + index;
        }

        AbstractMutableDirectBuffer.putPositiveIntAscii(this._dataView, offset, quotient, digitCount);

        return length;
    }

    public putNaturalIntAscii(index: number, value: number): number {
        if (0 === value) {
            this.putByte(index, ZERO);
            return 1;
        }

        const digitCount = AsciiEncoding.digitCount(value);

        this.ensureCapacity(index, digitCount);

        AbstractMutableDirectBuffer.putPositiveIntAscii(this._dataView, this._addressOffset + index, value, digitCount);

        return digitCount;
    }

    public putNaturalPaddedIntAscii(offset: number, length: number, value: number): void {
        this.ensureCapacity(offset, length);

        const array = this._dataView;
        const addressOffset = this._addressOffset;
        const end = offset + length;

        let remainder = value;
        for (let index = end - 1; index >= offset; index--) {
            const digit = remainder % 10;
            remainder = Math.trunc(remainder / 10);
            array.setInt8(addressOffset + index, ZERO + digit);
        }

        if (remainder !== 0) {
            throw new NumberFormatException('Cannot write ' + value + ' in ' + length + ' bytes');
        }
    }

    public putNaturalIntAsciiFromEnd(value: number, endExclusive: number): number {
        const length = AsciiEncoding.digitCount(value);

        this.ensureCapacity(endExclusive - length, length);

        const array = this._dataView;
        const addressOffset = this._addressOffset;

        let remainder = value;
        let index = endExclusive;
        while (remainder > 0) {
            index--;
            const digit = remainder % 10;
            remainder = Math.trunc(remainder / 10);
            array.setInt8(addressOffset + index, ZERO + digit);
        }

        return index;
    }

    public putNaturalLongAscii(index: number, value: number): number {
        Long.checkSafe(value);
        if (0 === value) {
            this.putByte(index, ZERO);
            return 1;
        }

        const digitCount = AsciiEncoding.digitCountLong(value);

        this.ensureCapacity(index, digitCount);

        AbstractMutableDirectBuffer.putPositiveLongAscii(
            this._dataView,
            this._addressOffset + index,
            value,
            digitCount,
        );

        return digitCount;
    }

    public putLongAscii(index: number, value: number): number {
        Long.checkSafe(value);
        if (0 === value) {
            this.putByte(index, ZERO);
            return 1;
        }

        let offset: number;
        let quotient = value;
        let digitCount: number, length: number;
        if (value < 0) {
            // Long.MIN_VALUE, which cannot be negated, is not a safe integer: no special case
            quotient = -quotient;
            digitCount = AsciiEncoding.digitCountLong(quotient);
            length = digitCount + 1;

            this.ensureCapacity(index, length);

            offset = this._addressOffset + index;
            this._dataView.setInt8(offset, MINUS_SIGN);
            offset++;
        } else {
            length = digitCount = AsciiEncoding.digitCountLong(quotient);

            this.ensureCapacity(index, length);

            offset = this._addressOffset + index;
        }

        AbstractMutableDirectBuffer.putPositiveLongAscii(this._dataView, offset, quotient, digitCount);

        return length;
    }

    public boundsCheck(index: number, length: number): void {
        this.boundsCheck0(index, length);
    }

    public equals(obj: unknown): boolean {
        if (this === obj) {
            return true;
        }

        if (obj === null || obj === undefined || (obj as object).constructor !== this.constructor) {
            return false;
        }

        const that = obj as AbstractMutableDirectBuffer;

        const length = this._capacity;
        if (length !== that._capacity) {
            return false;
        }

        const thisArray = this._dataView;
        const thatArray = that._dataView;
        const thisOffset = this._addressOffset;
        const thatOffset = that._addressOffset;

        let i = 0;
        for (const end = length & ~7; i < end; i += 8) {
            if (
                thisArray.getInt32(thisOffset + i, true) !== thatArray.getInt32(thatOffset + i, true) ||
                thisArray.getInt32(thisOffset + i + 4, true) !== thatArray.getInt32(thatOffset + i + 4, true)
            ) {
                return false;
            }
        }

        for (; i < length; i++) {
            if (thisArray.getInt8(thisOffset + i) !== thatArray.getInt8(thatOffset + i)) {
                return false;
            }
        }

        return true;
    }

    public hashCode(): number {
        const array = this._dataView;
        const addressOffset = this._addressOffset;
        const length = this._capacity;

        let i = 0,
            hashCode = 19;
        for (const end = length & ~7; i < end; i += 8) {
            // Long.hashCode: the high word xor the low word
            hashCode =
                (31 * hashCode +
                    (array.getInt32(addressOffset + i, true) ^ array.getInt32(addressOffset + i + 4, true))) |
                0;
        }

        for (; i < length; i++) {
            hashCode = (31 * hashCode + array.getInt8(addressOffset + i)) | 0;
        }

        return hashCode;
    }

    public compareTo(that: DirectBuffer): number {
        if (this === that) {
            return 0;
        }

        const thisCapacity = this._capacity;
        const thatCapacity = that.capacity();
        const thisArray = this._dataView;
        const thatByteArray = that.byteArray();
        const thatArray =
            that instanceof AbstractMutableDirectBuffer
                ? that._dataView
                : new DataView(thatByteArray.buffer, thatByteArray.byteOffset, thatByteArray.byteLength);
        const thisOffset = this._addressOffset;
        const thatOffset = that.addressOffset();

        const length = Math.min(thisCapacity, thatCapacity);

        let i = 0;
        for (const end = length & ~7; i < end; i += 8) {
            // Long.compare of two longs: the signed high words, then the unsigned low words
            let cmp = Integer.compare(
                thisArray.getInt32(thisOffset + i + 4, true),
                thatArray.getInt32(thatOffset + i + 4, true),
            );
            if (0 === cmp) {
                cmp = Integer.compare(
                    thisArray.getUint32(thisOffset + i, true),
                    thatArray.getUint32(thatOffset + i, true),
                );
            }

            if (0 !== cmp) {
                return cmp;
            }
        }

        for (; i < length; i++) {
            const cmp = Byte.compare(thisArray.getInt8(thisOffset + i), thatArray.getInt8(thatOffset + i));
            if (0 !== cmp) {
                return cmp;
            }
        }

        return Integer.compare(thisCapacity, thatCapacity);
    }

    protected boundsCheck0(index: number, length: number): void {
        Objects.checkFromIndexSize(index, length, this._capacity);
    }

    protected abstract ensureCapacity(index: number, length: number): void;

    private parsePositiveIntAscii(index: number, length: number, startIndex: number, end: number): number {
        const offset = this._addressOffset;
        const array = this._dataView;

        let i = startIndex;
        let tally = 0,
            quartet: number;
        while (end - i >= 4 && isFourDigitsAsciiEncodedNumber((quartet = array.getInt32(offset + i, true)))) {
            tally = tally * 10_000 + parseFourDigitsLittleEndian(quartet);
            i += 4;
        }

        let digit: number;
        while (i < end && isDigit((digit = array.getInt8(offset + i)))) {
            tally = tally * 10 + (digit - 0x30);
            i++;
        }

        if (i !== end) {
            this.throwParseIntError(index, length);
        }

        return tally;
    }

    private parsePositiveIntAsciiOverflowCheck(index: number, length: number, startIndex: number, end: number): number {
        if (end - startIndex > INT_MAX_DIGITS) {
            this.throwParseIntOverflowError(index, length);
        }

        const offset = this._addressOffset;
        const array = this._dataView;

        let i = startIndex;
        let tally = 0;
        const octet = array.getBigInt64(offset + i, true);
        if (isEightDigitAsciiEncodedNumber(octet)) {
            tally = parseEightDigitsLittleEndian(octet);
            i += 8;

            let digit: number;
            while (i < end && isDigit((digit = array.getInt8(offset + i)))) {
                tally = tally * 10 + (digit - 0x30);
                i++;
            }
        }

        if (i !== end) {
            this.throwParseIntError(index, length);
        }

        return tally;
    }

    private throwParseIntError(index: number, length: number): never {
        throw new AsciiNumberFormatException('error parsing int: ' + this.getStringWithoutLengthAscii(index, length));
    }

    private throwParseIntOverflowError(index: number, length: number): never {
        throw new AsciiNumberFormatException(
            'int overflow parsing: ' + this.getStringWithoutLengthAscii(index, length),
        );
    }

    private parsePositiveLongAscii(index: number, length: number, startIndex: number, end: number): bigint {
        const offset = this._addressOffset;
        const array = this._dataView;

        let i = startIndex;
        let tally = 0n,
            octet: bigint;
        while (end - i >= 8 && isEightDigitAsciiEncodedNumber((octet = array.getBigInt64(offset + i, true)))) {
            tally = tally * 100_000_000n + BigInt(parseEightDigitsLittleEndian(octet));
            i += 8;
        }

        let quartet: number;
        while (end - i >= 4 && isFourDigitsAsciiEncodedNumber((quartet = array.getInt32(offset + i, true)))) {
            tally = tally * 10_000n + BigInt(parseFourDigitsLittleEndian(quartet));
            i += 4;
        }

        let digit: number;
        while (i < end && isDigit((digit = array.getInt8(offset + i)))) {
            tally = tally * 10n + BigInt(digit - 0x30);
            i++;
        }

        if (i !== end) {
            this.throwParseLongError(index, length);
        }

        return tally;
    }

    private parseLongAsciiOverflowCheck(
        index: number,
        length: number,
        maxValue: Int32Array,
        startIndex: number,
        end: number,
    ): bigint {
        if (end - startIndex > LONG_MAX_DIGITS) {
            this.throwParseLongOverflowError(index, length);
        }

        const offset = this._addressOffset;
        const array = this._dataView;

        let i = startIndex,
            k = 0;
        let checkOverflow = true;
        let tally = 0n,
            octet: bigint;
        while (end - i >= 8 && isEightDigitAsciiEncodedNumber((octet = array.getBigInt64(offset + i, true)))) {
            const eightDigits = parseEightDigitsLittleEndian(octet);
            if (checkOverflow) {
                if (eightDigits > maxValue[k]!) {
                    this.throwParseLongOverflowError(index, length);
                } else if (eightDigits < maxValue[k]!) {
                    checkOverflow = false;
                }
                k++;
            }

            tally = BigInt.asIntN(64, tally * 100_000_000n + BigInt(eightDigits));
            i += 8;
        }

        let digit: number;
        let lastDigits = 0;
        while (i < end && isDigit((digit = array.getInt8(offset + i)))) {
            lastDigits = lastDigits * 10 + (digit - 0x30);
            i++;
        }

        if (i !== end) {
            this.throwParseLongError(index, length);
        } else if (checkOverflow && lastDigits > maxValue[k]!) {
            this.throwParseLongOverflowError(index, length);
        }

        return BigInt.asIntN(64, tally * 1000n + BigInt(lastDigits));
    }

    private throwParseLongError(index: number, length: number): never {
        throw new AsciiNumberFormatException('error parsing long: ' + this.getStringWithoutLengthAscii(index, length));
    }

    private throwParseLongOverflowError(index: number, length: number): never {
        throw new AsciiNumberFormatException(
            'long overflow parsing: ' + this.getStringWithoutLengthAscii(index, length),
        );
    }

    private static putPositiveIntAscii(dest: DataView, offset: number, value: number, digitCount: number): void {
        let i = digitCount;
        let quotient = value;

        while (quotient >= 10_000) {
            const lastFourDigits = quotient % 10_000;
            quotient = Math.trunc(quotient / 10_000);

            const p1 = Math.trunc(lastFourDigits / 100) << 1;
            const p2 = (lastFourDigits % 100) << 1;

            i -= 4;

            dest.setInt8(offset + i, ASCII_DIGITS[p1]!);
            dest.setInt8(offset + i + 1, ASCII_DIGITS[p1 + 1]!);
            dest.setInt8(offset + i + 2, ASCII_DIGITS[p2]!);
            dest.setInt8(offset + i + 3, ASCII_DIGITS[p2 + 1]!);
        }

        if (quotient >= 100) {
            const position = (quotient % 100) << 1;
            quotient = Math.trunc(quotient / 100);
            dest.setInt8(offset + i - 1, ASCII_DIGITS[position + 1]!);
            dest.setInt8(offset + i - 2, ASCII_DIGITS[position]!);
        }

        if (quotient >= 10) {
            const position = quotient << 1;
            dest.setInt8(offset + 1, ASCII_DIGITS[position + 1]!);
            dest.setInt8(offset, ASCII_DIGITS[position]!);
        } else {
            dest.setInt8(offset, ZERO + quotient);
        }
    }

    private static putPositiveLongAscii(dest: DataView, offset: number, value: number, digitCount: number): void {
        let quotient = value;
        let i = digitCount;

        while (quotient >= 100_000_000) {
            const lastEightDigits = quotient % 100_000_000;
            quotient = (quotient - lastEightDigits) / 100_000_000;

            const upperPart = Math.trunc(lastEightDigits / 10_000);
            const lowerPart = lastEightDigits % 10_000;

            const u1 = Math.trunc(upperPart / 100) << 1;
            const u2 = (upperPart % 100) << 1;
            const l1 = Math.trunc(lowerPart / 100) << 1;
            const l2 = (lowerPart % 100) << 1;

            i -= 8;

            dest.setInt8(offset + i, ASCII_DIGITS[u1]!);
            dest.setInt8(offset + i + 1, ASCII_DIGITS[u1 + 1]!);
            dest.setInt8(offset + i + 2, ASCII_DIGITS[u2]!);
            dest.setInt8(offset + i + 3, ASCII_DIGITS[u2 + 1]!);
            dest.setInt8(offset + i + 4, ASCII_DIGITS[l1]!);
            dest.setInt8(offset + i + 5, ASCII_DIGITS[l1 + 1]!);
            dest.setInt8(offset + i + 6, ASCII_DIGITS[l2]!);
            dest.setInt8(offset + i + 7, ASCII_DIGITS[l2 + 1]!);
        }

        AbstractMutableDirectBuffer.putPositiveIntAscii(dest, offset, quotient, i);
    }
}
