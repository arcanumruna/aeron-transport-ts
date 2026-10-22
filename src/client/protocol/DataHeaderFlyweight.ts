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
// Port of io/aeron/protocol/DataHeaderFlyweight.java @ 1.53.3
import { BufferUtil } from '../../agrona/BufferUtil.js';
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Long } from '../../agrona/jdk.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { CACHE_LINE_LENGTH } = BitUtil;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Flyweight for Data Frame header of a message fragment.
 * <p>
 * <a target="_blank"
 * href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#data-frame">Data Frame</a>
 * wiki page.
 */
export class DataHeaderFlyweight extends HeaderFlyweight {
    /**
     * Length of the Data Header.
     */
    public static readonly HEADER_LENGTH = 32;

    /**
     * (B) - Fragment that Begins a message Flag.
     */
    public static readonly BEGIN_FLAG = 0x80;

    /**
     * (E) - Fragment that Ends a message Flag.
     */
    public static readonly END_FLAG = 0x40;

    /**
     * Begin and End Flags.
     */
    public static readonly BEGIN_AND_END_FLAGS = DataHeaderFlyweight.BEGIN_FLAG | DataHeaderFlyweight.END_FLAG;

    /**
     * (S) - End of Stream (EOS) Flag for heartbeats after the publication is closed.
     */
    public static readonly EOS_FLAG = 0x20;

    /**
     * Begin, End, and EOS Flags.
     */
    public static readonly BEGIN_END_AND_EOS_FLAGS =
        DataHeaderFlyweight.BEGIN_FLAG | DataHeaderFlyweight.END_FLAG | DataHeaderFlyweight.EOS_FLAG;

    /**
     * (R) - Revoked Flag for heartbeats after the publication is revoked.
     */
    public static readonly REVOKED_FLAG = 0x10;

    /**
     * Begin, End, EOS, and Revoked Flags.
     */
    public static readonly BEGIN_END_EOS_AND_REVOKED_FLAGS =
        DataHeaderFlyweight.BEGIN_FLAG |
        DataHeaderFlyweight.END_FLAG |
        DataHeaderFlyweight.EOS_FLAG |
        DataHeaderFlyweight.REVOKED_FLAG;

    /**
     * Default value to be placed in the reserved value field. A `bigint`: an opaque 64-bit wire value (spec 5.2).
     */
    public static readonly DEFAULT_RESERVE_VALUE = 0n;

    /**
     * Offset in the frame at which the term-offset field begins.
     */
    public static readonly TERM_OFFSET_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    public static readonly SESSION_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    public static readonly STREAM_ID_FIELD_OFFSET = 16;

    /**
     * Offset in the frame at which the term-id field begins.
     */
    public static readonly TERM_ID_FIELD_OFFSET = 20;

    /**
     * Offset in the frame at which the reserved value field begins.
     */
    public static readonly RESERVED_VALUE_OFFSET = 24;

    /**
     * Offset in the frame at which the data payload begins.
     */
    public static readonly DATA_OFFSET = DataHeaderFlyweight.HEADER_LENGTH;

    /**
     * Default constructor which can later be used to wrap a frame, or construct the flyweight over a frame. The
     * `ByteBuffer` overload of Java is an `ArrayBuffer` or a `Uint8Array` here (spec D9).
     *
     * @param buffer containing the frame.
     */
    public constructor(buffer?: UnsafeBuffer | Uint8Array | ArrayBuffer) {
        super(buffer);
    }

    /**
     * Get the fragment length field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the fragment length field from the header.
     */
    public static fragmentLength(termBuffer: UnsafeBuffer, frameOffset: number): number {
        return termBuffer.getInt(frameOffset + HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Is the frame at data frame at the beginning of packet a heartbeat message?
     *
     * @param packet containing the data frame.
     * @param length of the data frame.
     * @return true if a heartbeat otherwise false.
     */
    public static isHeartbeat(packet: UnsafeBuffer, length: number): boolean {
        return (
            DataHeaderFlyweight.HEADER_LENGTH === length &&
            0 === packet.getInt(HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN)
        );
    }

    /**
     * Does the data frame in the packet have the EOS flag set?
     *
     * @param packet containing the data frame.
     * @return true if the EOS flag is set otherwise false.
     */
    public static isEndOfStream(packet: UnsafeBuffer): boolean {
        return 0 !== (packet.getByte(HeaderFlyweight.FLAGS_FIELD_OFFSET) & DataHeaderFlyweight.EOS_FLAG);
    }

    /**
     * Does the data frame in the packet have the REVOKED flag set?
     *
     * @param packet containing the data frame
     * @return true if the REVOKED flag is set otherwise false.
     */
    public static isRevoked(packet: UnsafeBuffer): boolean {
        return 0 !== (packet.getByte(HeaderFlyweight.FLAGS_FIELD_OFFSET) & DataHeaderFlyweight.REVOKED_FLAG);
    }

    /**
     * Get the session-id field from the header.
     *
     * @return the session-id field from the header.
     */
    public sessionId(): number;
    /**
     * Set the session-id field in the header.
     *
     * @param sessionId value to set.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): DataHeaderFlyweight;
    public sessionId(sessionId?: number): number | DataHeaderFlyweight {
        if (undefined === sessionId) {
            return this.getInt(DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the session-id field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the session-id field from the header.
     */
    public static sessionId(termBuffer: UnsafeBuffer, frameOffset: number): number {
        return termBuffer.getInt(frameOffset + DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Get the stream-id field from the header.
     *
     * @return the stream-id field from the header.
     */
    public streamId(): number;
    /**
     * Set the stream-id field in the header.
     *
     * @param streamId value to set.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): DataHeaderFlyweight;
    public streamId(streamId?: number): number | DataHeaderFlyweight {
        if (undefined === streamId) {
            return this.getInt(DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the stream-id field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the stream-id field from the header.
     */
    public static streamId(termBuffer: UnsafeBuffer, frameOffset: number): number {
        return termBuffer.getInt(frameOffset + DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Get the term-id field from the header.
     *
     * @return the term-id field from the header.
     */
    public termId(): number;
    /**
     * Set the term-id field in the header.
     *
     * @param termId value to set.
     * @return this for a fluent API.
     */
    public termId(termId: number): DataHeaderFlyweight;
    public termId(termId?: number): number | DataHeaderFlyweight {
        if (undefined === termId) {
            return this.getInt(DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the term-id field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the term-id field from the header.
     */
    public static termId(termBuffer: UnsafeBuffer, frameOffset: number): number {
        return termBuffer.getInt(frameOffset + DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Get the term-offset field from the header.
     *
     * @return the term-offset field from the header.
     */
    public termOffset(): number;
    /**
     * Set the term-offset field in the header.
     *
     * @param termOffset value to set.
     * @return this for a fluent API.
     */
    public termOffset(termOffset: number): DataHeaderFlyweight;
    public termOffset(termOffset?: number): number | DataHeaderFlyweight {
        if (undefined === termOffset) {
            return this.getInt(DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET, termOffset, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the term-offset field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the term-offset field from the header.
     */
    public static termOffset(termBuffer: UnsafeBuffer, frameOffset: number): number {
        return termBuffer.getInt(frameOffset + DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Get the reserved value in LITTLE_ENDIAN format.
     *
     * @return value of the reserved value, a `bigint`.
     */
    public reservedValue(): bigint;
    /**
     * Set the reserved value in LITTLE_ENDIAN format.
     *
     * @param reservedValue to be stored, a `bigint`.
     * @return flyweight
     */
    public reservedValue(reservedValue: bigint): DataHeaderFlyweight;
    public reservedValue(reservedValue?: bigint): bigint | DataHeaderFlyweight {
        if (undefined === reservedValue) {
            return this.getLongBigInt(DataHeaderFlyweight.RESERVED_VALUE_OFFSET, LITTLE_ENDIAN);
        }

        this.putLongBigInt(DataHeaderFlyweight.RESERVED_VALUE_OFFSET, Long.checkInt64(reservedValue), LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the reserved value field from the header.
     *
     * @param termBuffer  containing the header.
     * @param frameOffset in the buffer where the header starts.
     * @return the reserved value field from the header, a `bigint`.
     */
    public static reservedValue(termBuffer: UnsafeBuffer, frameOffset: number): bigint {
        return termBuffer.getLongBigInt(frameOffset + DataHeaderFlyweight.RESERVED_VALUE_OFFSET, LITTLE_ENDIAN);
    }

    /**
     * Return offset in buffer for data.
     *
     * @return offset of data in the buffer.
     */
    public dataOffset(): number {
        return DataHeaderFlyweight.DATA_OFFSET;
    }

    /**
     * Return an initialised default Data Frame Header.
     *
     * @param sessionId for the header
     * @param streamId  for the header
     * @param termId    for the header
     * @return byte array containing the header
     */
    public static createDefaultHeader(sessionId: number, streamId: number, termId: number): UnsafeBuffer {
        const buffer = new UnsafeBuffer(
            BufferUtil.allocateDirectAligned(DataHeaderFlyweight.HEADER_LENGTH, CACHE_LINE_LENGTH),
        );

        buffer.putByte(HeaderFlyweight.VERSION_FIELD_OFFSET, HeaderFlyweight.CURRENT_VERSION);
        buffer.putByte(HeaderFlyweight.FLAGS_FIELD_OFFSET, DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        buffer.putShort(HeaderFlyweight.TYPE_FIELD_OFFSET, HeaderFlyweight.HDR_TYPE_DATA, LITTLE_ENDIAN);
        buffer.putInt(DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);
        buffer.putInt(DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);
        buffer.putInt(DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);
        buffer.putLongBigInt(DataHeaderFlyweight.RESERVED_VALUE_OFFSET, DataHeaderFlyweight.DEFAULT_RESERVE_VALUE);

        return buffer;
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'DATA Header{' +
            'frame-length=' +
            this.frameLength() +
            ' version=' +
            this.version() +
            ' flags=' +
            HeaderFlyweight.flagsToChars(this.flags()).join('') +
            ' type=' +
            this.headerType() +
            ' term-offset=' +
            this.termOffset() +
            ' session-id=' +
            this.sessionId() +
            ' stream-id=' +
            this.streamId() +
            ' term-id=' +
            this.termId() +
            ' reserved-value=' +
            this.reservedValue() +
            '}'
        );
    }
}
