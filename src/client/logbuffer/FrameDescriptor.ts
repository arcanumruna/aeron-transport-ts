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
// Port of io/aeron/logbuffer/FrameDescriptor.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../protocol/HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Description of the structure for message framing in a log buffer.
 * <p>
 * All messages are logged in frames that have a minimum header layout as follows plus a reserve then
 * the encoded message follows:
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |R|                       Frame Length                          |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-------------------------------+
 *  |  Version      |B|E| Flags     |             Type              |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-------------------------------+
 *  |R|                       Term Offset                           |
 *  +-+-------------------------------------------------------------+
 *  |                      Additional Fields                       ...
 * ...                                                              |
 *  +---------------------------------------------------------------+
 *  |                        Encoded Message                       ...
 * ...                                                              |
 *  +---------------------------------------------------------------+
 * </pre>
 * <p>
 * The (B)egin and (E)nd flags are used for message fragmentation. R is for reserved bit.
 * Both (B)egin and (E)nd flags are set for a message that does not span frames.
 */
export class FrameDescriptor {
    private constructor() {}

    /**
     * Set a pragmatic maximum message length regardless of term length to encourage better design.
     * Messages larger than half the cache size should be broken up into chunks and streamed.
     */
    public static readonly MAX_MESSAGE_LENGTH = 16 * 1024 * 1024;

    /**
     * Alignment as a multiple of bytes for each frame. The length field will store the unaligned length in bytes.
     */
    public static readonly FRAME_ALIGNMENT = 32;

    /**
     * Beginning fragment of a frame. A signed `byte`, as in Java: `(byte)0b1000_0000` is -128.
     */
    public static readonly BEGIN_FRAG_FLAG = -128;

    /**
     * End fragment of a frame.
     */
    public static readonly END_FRAG_FLAG = 0b0100_0000;

    /**
     * Unfragmented frame. A signed `byte`: -128 | 64 is -64.
     */
    public static readonly UNFRAGMENTED = FrameDescriptor.BEGIN_FRAG_FLAG | FrameDescriptor.END_FRAG_FLAG;

    /**
     * Offset within a frame at which the version field begins.
     */
    public static readonly VERSION_OFFSET = DataHeaderFlyweight.VERSION_FIELD_OFFSET;

    /**
     * Offset within a frame at which the flags field begins.
     */
    public static readonly FLAGS_OFFSET = DataHeaderFlyweight.FLAGS_FIELD_OFFSET;

    /**
     * Offset within a frame at which the type field begins.
     */
    public static readonly TYPE_OFFSET = DataHeaderFlyweight.TYPE_FIELD_OFFSET;

    /**
     * Offset within a frame at which the term offset field begins.
     */
    public static readonly TERM_OFFSET = DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET;

    /**
     * Offset within a frame at which the term id field begins.
     */
    public static readonly TERM_ID_OFFSET = DataHeaderFlyweight.TERM_ID_FIELD_OFFSET;

    /**
     * Offset within a frame at which the session id field begins.
     */
    public static readonly SESSION_ID_OFFSET = DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET;

    /**
     * Padding frame type to indicate the message should be ignored.
     */
    public static readonly PADDING_FRAME_TYPE = HeaderFlyweight.HDR_TYPE_PAD;

    /**
     * Compute the maximum supported message length for a buffer of given termLength.
     *
     * @param termLength of the log buffer.
     * @return the maximum supported length for a message.
     */
    public static computeMaxMessageLength(termLength: number): number {
        return Math.min(termLength >> 3, FrameDescriptor.MAX_MESSAGE_LENGTH);
    }

    /**
     * The buffer offset at which the length field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the length field begins.
     */
    public static lengthOffset(termOffset: number): number {
        return termOffset;
    }

    /**
     * The buffer offset at which the version field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the version field begins.
     */
    public static versionOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.VERSION_OFFSET;
    }

    /**
     * The buffer offset at which the flags field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the flags field begins.
     */
    public static flagsOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.FLAGS_OFFSET;
    }

    /**
     * The buffer offset at which the type field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the type field begins.
     */
    public static typeOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.TYPE_OFFSET;
    }

    /**
     * The buffer offset at which the term offset field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the term offset field begins.
     */
    public static termOffsetOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.TERM_OFFSET;
    }

    /**
     * The buffer offset at which the term id field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the term id field begins.
     */
    public static termIdOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.TERM_ID_OFFSET;
    }

    /**
     * The buffer offset at which the session id field begins.
     *
     * @param termOffset at which the frame begins.
     * @return the offset at which the session id field begins.
     */
    public static sessionIdOffset(termOffset: number): number {
        return termOffset + FrameDescriptor.SESSION_ID_OFFSET;
    }

    /**
     * Read the type of the frame from header.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value of the frame type header.
     */
    public static frameVersion(buffer: UnsafeBuffer, termOffset: number): number {
        return buffer.getByte(termOffset + FrameDescriptor.VERSION_OFFSET);
    }

    /**
     * Get the flags field for a frame, a signed `byte`.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value of the flags.
     */
    public static frameFlags(buffer: UnsafeBuffer, termOffset: number): number;
    /**
     * Write the flags field for a frame.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @param flags      value for the frame.
     */
    public static frameFlags(buffer: UnsafeBuffer, termOffset: number, flags: number): void;
    public static frameFlags(buffer: UnsafeBuffer, termOffset: number, flags?: number): number | void {
        if (undefined === flags) {
            return buffer.getByte(termOffset + FrameDescriptor.FLAGS_OFFSET);
        }

        buffer.putByte(termOffset + FrameDescriptor.FLAGS_OFFSET, flags);
    }

    /**
     * Read the type of the frame from header.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value of the frame type header.
     */
    public static frameType(buffer: UnsafeBuffer, termOffset: number): number;
    /**
     * Write the type field for a frame.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @param type       type value for the frame.
     */
    public static frameType(buffer: UnsafeBuffer, termOffset: number, type: number): void;
    public static frameType(buffer: UnsafeBuffer, termOffset: number, type?: number): number | void {
        if (undefined === type) {
            return buffer.getShort(termOffset + FrameDescriptor.TYPE_OFFSET, LITTLE_ENDIAN) & 0xffff;
        }

        buffer.putShort(termOffset + FrameDescriptor.TYPE_OFFSET, type, LITTLE_ENDIAN);
    }

    /**
     * Is the frame starting at the termOffset a padding frame at the end of a buffer?
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return true if the frame is a padding frame otherwise false.
     */
    public static isPaddingFrame(buffer: UnsafeBuffer, termOffset: number): boolean {
        return buffer.getShort(termOffset + FrameDescriptor.TYPE_OFFSET) === FrameDescriptor.PADDING_FRAME_TYPE;
    }

    /**
     * Get the length of a frame from the header.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value for the frame length.
     */
    public static frameLength(buffer: UnsafeBuffer, termOffset: number): number {
        return buffer.getInt(termOffset, LITTLE_ENDIAN);
    }

    /**
     * Get the term id of a frame from the header.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value for the term id field.
     */
    public static frameTermId(buffer: UnsafeBuffer, termOffset: number): number;
    /**
     * Write the term id field for a frame.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @param termId     value for the frame.
     */
    public static frameTermId(buffer: UnsafeBuffer, termOffset: number, termId: number): void;
    public static frameTermId(buffer: UnsafeBuffer, termOffset: number, termId?: number): number | void {
        if (undefined === termId) {
            return buffer.getInt(termOffset + FrameDescriptor.TERM_ID_OFFSET, LITTLE_ENDIAN);
        }

        buffer.putInt(termOffset + FrameDescriptor.TERM_ID_OFFSET, termId, LITTLE_ENDIAN);
    }

    /**
     * Get the session id of a frame from the header.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value for the session id field.
     */
    public static frameSessionId(buffer: UnsafeBuffer, termOffset: number): number;
    /**
     * Write the session id field for a frame.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @param sessionId  value for the frame.
     */
    public static frameSessionId(buffer: UnsafeBuffer, termOffset: number, sessionId: number): void;
    public static frameSessionId(buffer: UnsafeBuffer, termOffset: number, sessionId?: number): number | void {
        if (undefined === sessionId) {
            return buffer.getInt(termOffset + FrameDescriptor.SESSION_ID_OFFSET, LITTLE_ENDIAN);
        }

        buffer.putInt(termOffset + FrameDescriptor.SESSION_ID_OFFSET, sessionId, LITTLE_ENDIAN);
    }

    /**
     * Get the length of a frame from the header as a volatile read. The `reverseBytes` branch of Java (a big-endian
     * platform) is not ported: the byte order of the port is little-endian.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     * @return the value for the frame length.
     */
    public static frameLengthVolatile(buffer: UnsafeBuffer, termOffset: number): number {
        return buffer.getIntVolatile(termOffset);
    }

    /**
     * Write the length header for a frame in a memory ordered fashion. The `reverseBytes` branch of Java is not
     * ported (as in {@link frameLengthVolatile}).
     *
     * @param buffer      containing the frame.
     * @param termOffset  at which a frame begins.
     * @param frameLength field to be set for the frame.
     */
    public static frameLengthOrdered(buffer: UnsafeBuffer, termOffset: number, frameLength: number): void {
        buffer.putIntRelease(termOffset, frameLength);
    }

    /**
     * Write the term offset field for a frame.
     *
     * @param buffer     containing the frame.
     * @param termOffset at which a frame begins.
     */
    public static frameTermOffset(buffer: UnsafeBuffer, termOffset: number): void {
        buffer.putInt(termOffset + FrameDescriptor.TERM_OFFSET, termOffset, LITTLE_ENDIAN);
    }

    /**
     * Check if specified `length` is frame-aligned.
     *
     * @param length to check.
     * @return `true` if properly aligned.
     */
    public static isFrameAligned(length: number): boolean {
        return 0 === (length & (FrameDescriptor.FRAME_ALIGNMENT - 1));
    }
}
