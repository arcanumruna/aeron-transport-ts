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
// Port of io/aeron/logbuffer/BufferClaim.java @ 1.53.3
import type { AtomicBuffer } from '../../agrona/concurrent/AtomicBuffer.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import { ByteOrder, Long } from '../../agrona/jdk.js';
import type { MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../protocol/HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { HEADER_LENGTH, RESERVED_VALUE_OFFSET } = DataHeaderFlyweight;
const { FLAGS_FIELD_OFFSET, FRAME_LENGTH_FIELD_OFFSET, HDR_TYPE_PAD, TYPE_FIELD_OFFSET } = HeaderFlyweight;

/**
 * Represents a claimed range in a buffer to be used for recording a message without copy semantics for later commit.
 * <p>
 * The claimed space is in {@link buffer} between {@link offset} and {@link offset} + {@link length}.
 * When the buffer is filled with message data, use {@link commit} to make it available to subscribers.
 * <p>
 * If the claimed space is no longer required it can be aborted by calling {@link abort}.
 *
 * @see Publication.tryClaim
 */
export class BufferClaim {
    // The Java field shares its name with the accessor, so here it carries an underscore. `new UnsafeBuffer(0, 0)`
    // (an address and a length) is an empty buffer.
    private readonly _buffer = new UnsafeBuffer();

    /**
     * An empty buffer claim, ready to be used with {@link Publication.tryClaim}.
     */
    public constructor() {}

    /**
     * Wrap a region of an underlying log buffer so can can represent a claimed space for use by a publisher.
     *
     * @param buffer to be wrapped.
     * @param offset at which the claimed region begins including space for the header.
     * @param length length of the underlying claimed region including space for the header.
     */
    public wrap(buffer: AtomicBuffer, offset: number, length: number): void {
        this._buffer.wrap(buffer, offset, length);
    }

    /**
     * The referenced buffer to be used.
     *
     * @return the referenced buffer to be used.
     */
    public buffer(): MutableDirectBuffer {
        return this._buffer;
    }

    /**
     * The offset in the buffer at which the claimed range begins.
     *
     * @return offset in the buffer at which the range begins.
     */
    public offset(): number {
        return HEADER_LENGTH;
    }

    /**
     * The length of the claimed range in the buffer.
     *
     * @return length of the range in the buffer.
     */
    public length(): number {
        return this._buffer.capacity() - HEADER_LENGTH;
    }

    /**
     * Get the value of the header type field. The lower 16 bits are valid.
     *
     * @return the value of the header type field.
     * @see DataHeaderFlyweight
     */
    public headerType(): number;
    /**
     * Set the value of the header type field. The lower 16 bits are valid.
     *
     * @param type value to be set in the header.
     * @return this for a fluent API.
     * @see DataHeaderFlyweight
     */
    public headerType(type: number): BufferClaim;
    public headerType(type?: number): number | BufferClaim {
        if (undefined === type) {
            return this._buffer.getShort(TYPE_FIELD_OFFSET, LITTLE_ENDIAN) & 0xffff;
        }

        this._buffer.putShort(TYPE_FIELD_OFFSET, type, LITTLE_ENDIAN);
        return this;
    }

    /**
     * Get the value of the flags field, a signed `byte`.
     *
     * @return the value of the header flags field.
     * @see DataHeaderFlyweight
     */
    public flags(): number;
    /**
     * Set the value of the header flags field.
     *
     * @param flags value to be set in the header.
     * @return this for a fluent API.
     * @see DataHeaderFlyweight
     */
    public flags(flags: number): BufferClaim;
    public flags(flags?: number): number | BufferClaim {
        if (undefined === flags) {
            return this._buffer.getByte(FLAGS_FIELD_OFFSET);
        }

        this._buffer.putByte(FLAGS_FIELD_OFFSET, flags);
        return this;
    }

    /**
     * Get the value stored in the reserve space at the end of a data frame header, a `bigint` (spec 5.2).
     * <p>
     * Note: The value is in little-endian format.
     *
     * @return the value stored in the reserve space at the end of a data frame header.
     * @see DataHeaderFlyweight
     */
    public reservedValue(): bigint;
    /**
     * Write the provided value into the reserved space at the end of the data frame header.
     * <p>
     * Note: The value will be written in little-endian format.
     *
     * @param value to be stored in the reserve space at the end of a data frame header.
     * @return this for fluent API semantics.
     * @see DataHeaderFlyweight
     */
    public reservedValue(value: bigint): BufferClaim;
    public reservedValue(value?: bigint): bigint | BufferClaim {
        if (undefined === value) {
            return this._buffer.getLongBigInt(RESERVED_VALUE_OFFSET, LITTLE_ENDIAN);
        }

        this._buffer.putLongBigInt(RESERVED_VALUE_OFFSET, Long.checkInt64(value), LITTLE_ENDIAN);
        return this;
    }

    /**
     * Put bytes into the claimed buffer space for a message. To write multiple parts then use {@link buffer}
     * and {@link offset}.
     *
     * @param srcBuffer to copy into the claimed space.
     * @param srcIndex  in the source buffer from which to copy.
     * @param length    of the source buffer to copy.
     * @return this for a fluent API.
     */
    public putBytes(srcBuffer: DirectBuffer, srcIndex: number, length: number): BufferClaim {
        this._buffer.putBytes(HEADER_LENGTH, srcBuffer, srcIndex, length);
        return this;
    }

    /**
     * Commit the message to the log buffer so that is it available to subscribers.
     * <p>
     * The `reverseBytes` branch of Java (a big-endian platform) is not ported: the byte order of the port is
     * little-endian.
     */
    public commit(): void {
        const frameLength = this._buffer.capacity();
        this._buffer.putIntRelease(FRAME_LENGTH_FIELD_OFFSET, frameLength);
    }

    /**
     * Abort a claim of the message space to the log buffer so that the log can progress by ignoring this claim.
     * <p>
     * The `reverseBytes` branch of Java is not ported (as in {@link commit}).
     */
    public abort(): void {
        const frameLength = this._buffer.capacity();
        this._buffer.putShort(TYPE_FIELD_OFFSET, HDR_TYPE_PAD, LITTLE_ENDIAN);
        this._buffer.putIntRelease(FRAME_LENGTH_FIELD_OFFSET, frameLength);
    }
}
