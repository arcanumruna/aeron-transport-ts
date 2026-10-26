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
// Port of io/aeron/logbuffer/Header.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { NULL_VALUE } from '../NullValue.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';
import { LogBufferDescriptor } from './LogBufferDescriptor.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const {
    FLAGS_FIELD_OFFSET,
    RESERVED_VALUE_OFFSET,
    SESSION_ID_FIELD_OFFSET,
    STREAM_ID_FIELD_OFFSET,
    TERM_ID_FIELD_OFFSET,
    TERM_OFFSET_FIELD_OFFSET,
    TYPE_FIELD_OFFSET,
} = DataHeaderFlyweight;
const { computePosition } = LogBufferDescriptor;

/**
 * Represents the header of the data frame for accessing metadata fields.
 */
export class Header {
    // The Java fields share their names with the accessors, so here they carry an underscore.
    private _context: unknown;
    private _positionBitsToShift: number = 0;
    private _initialTermId: number = 0;
    private _offset = 0;
    private _buffer!: DirectBuffer;
    private _fragmentedFrameLength: number = NULL_VALUE;

    /**
     * Construct a header that references a buffer for the log. The two constructors of Java are one.
     *
     * @param initialTermId       this stream started at.
     * @param positionBitsToShift for calculating positions.
     * @param context             for storing state when which can be accessed with {@link context}; `null` if none.
     */
    public constructor(initialTermId: number, positionBitsToShift: number, context: unknown = null) {
        this._initialTermId = initialTermId;
        this._positionBitsToShift = positionBitsToShift;
        this._context = context;
    }

    /**
     * Context for storing state related to the context of the callback where the header is used.
     *
     * @return context for storing state related to the context of the callback where the header is used.
     */
    public context(): unknown;
    /**
     * Assign context for storing state related to the context of the callback where the header is used. A call with
     * `undefined` is a read: use `null` for no context.
     *
     * @param context for storing state related to the context of the callback where the header is used.
     * @return this for a fluent API.
     */
    public context(context: unknown): Header;
    public context(context?: unknown): unknown {
        if (undefined === context) {
            return this._context;
        }

        this._context = context;
        return this;
    }

    /**
     * Get the current position to which the image has advanced on reading this message.
     *
     * @return the current position to which the image has advanced on reading this message.
     */
    public position(): number {
        return computePosition(this.termId(), this.nextTermOffset(), this._positionBitsToShift, this._initialTermId);
    }

    /**
     * The number of times to left shift the term count to multiply by term length.
     *
     * @return number of times to left shift the term count to multiply by term length.
     */
    public positionBitsToShift(): number;
    /**
     * Set the number of times to left shift the term count to multiply by term length.
     *
     * @param positionBitsToShift number of times to left shift the term count to multiply by term length.
     * @return this for a fluent API.
     */
    public positionBitsToShift(positionBitsToShift: number): Header;
    public positionBitsToShift(positionBitsToShift?: number): number | Header {
        if (undefined === positionBitsToShift) {
            return this._positionBitsToShift;
        }

        this._positionBitsToShift = positionBitsToShift;
        return this;
    }

    /**
     * Get the initial term id this stream started at.
     *
     * @return the initial term id this stream started at.
     */
    public initialTermId(): number;
    /**
     * Set the initial term id this stream started at.
     *
     * @param initialTermId the initial term id this stream started at.
     * @return this for a fluent API.
     */
    public initialTermId(initialTermId: number): Header;
    public initialTermId(initialTermId?: number): number | Header {
        if (undefined === initialTermId) {
            return this._initialTermId;
        }

        this._initialTermId = initialTermId;
        return this;
    }

    /**
     * Set the offset at which the header begins in the buffer.
     *
     * @param offset at which the header begins in the buffer.
     * @return this for a fluent API.
     */
    public offset(offset: number): Header;
    /**
     * The offset at which the frame begins in the buffer.
     *
     * @return offset at which the frame begins in the buffer.
     */
    public offset(): number;
    public offset(offset?: number): number | Header {
        if (undefined === offset) {
            return this._offset;
        }

        this._offset = offset;
        return this;
    }

    /**
     * The {@link DirectBuffer} containing the header.
     *
     * @return {@link DirectBuffer} containing the header.
     */
    public buffer(): DirectBuffer;
    /**
     * The {@link DirectBuffer} containing the header.
     *
     * @param buffer {@link DirectBuffer} containing the header.
     * @return this for a fluent API.
     */
    public buffer(buffer: DirectBuffer): Header;
    public buffer(buffer?: DirectBuffer): DirectBuffer | Header {
        if (undefined === buffer) {
            return this._buffer;
        }

        if (buffer !== this._buffer) {
            this._buffer = buffer;
        }
        return this;
    }

    /**
     * The total length of the frame including the header.
     *
     * @return the total length of the frame including the header.
     */
    public frameLength(): number {
        return this._buffer.getInt(this._offset, LITTLE_ENDIAN);
    }

    /**
     * The session ID to which the frame belongs.
     *
     * @return the session ID to which the frame belongs.
     */
    public sessionId(): number {
        return this._buffer.getInt(this._offset + SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * The stream ID to which the frame belongs.
     *
     * @return the stream ID to which the frame belongs.
     */
    public streamId(): number {
        return this._buffer.getInt(this._offset + STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * The term ID to which the frame belongs.
     *
     * @return the term ID to which the frame belongs.
     */
    public termId(): number {
        return this._buffer.getInt(this._offset + TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * The offset in the term at which the frame begins.
     *
     * @return the offset in the term at which the frame begins.
     */
    public termOffset(): number {
        return this._buffer.getInt(this._offset + TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Calculates the offset of the frame immediately after this one.
     *
     * @return the offset of the next frame.
     */
    public nextTermOffset(): number {
        return BitUtil.align(this.termOffset() + this.termOccupancyLength(), FRAME_ALIGNMENT);
    }

    /**
     * The type of the frame which should always be {@link DataHeaderFlyweight.HDR_TYPE_DATA}.
     *
     * @return type of the frame which should always be {@link DataHeaderFlyweight.HDR_TYPE_DATA}.
     */
    public type(): number {
        return this._buffer.getShort(this._offset + TYPE_FIELD_OFFSET, LITTLE_ENDIAN) & 0xffff;
    }

    /**
     * The flags for this frame, a signed `byte`. Valid flags are {@link DataHeaderFlyweight.BEGIN_FLAG}
     * and {@link DataHeaderFlyweight.END_FLAG}. A convenience flag {@link DataHeaderFlyweight.BEGIN_AND_END_FLAGS}
     * can be used for both flags.
     *
     * @return the flags for this frame.
     */
    public flags(): number {
        return this._buffer.getByte(this._offset + FLAGS_FIELD_OFFSET);
    }

    /**
     * Get the value stored in the reserve space at the end of a data frame header, a `bigint` (spec 5.2).
     * <p>
     * Note: The value is in little-endian format.
     *
     * @return the value stored in the reserve space at the end of a data frame header.
     * @see DataHeaderFlyweight
     */
    public reservedValue(): bigint {
        return this._buffer.getLongBigInt(this._offset + RESERVED_VALUE_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Total amount of space occupied by this message when it is within the term buffer. When fragmented this will
     * include the length of the header for each fragment. Used when doing reassembly of fragmented packets.
     *
     * @param fragmentedFrameLength total fragmented length of the message.
     */
    public fragmentedFrameLength(fragmentedFrameLength: number): void;
    /**
     * Total amount of space occupied by this message when it is within the term buffer. When fragmented this
     * will include the length of the header for each fragment. Used when doing reassembly of fragmented packets. If
     * the packet is not fragmented this will be {@link NULL_VALUE}.
     *
     * @return total fragmented length of this message or `NULL_VALUE` if not fragmented.
     */
    public fragmentedFrameLength(): number;
    public fragmentedFrameLength(fragmentedFrameLength?: number): number | void {
        if (undefined === fragmentedFrameLength) {
            return this._fragmentedFrameLength;
        }

        this._fragmentedFrameLength = fragmentedFrameLength;
    }

    private termOccupancyLength(): number {
        return NULL_VALUE === this._fragmentedFrameLength ? this.frameLength() : this._fragmentedFrameLength;
    }
}
