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
// Port of io/aeron/protocol/StatusMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Long } from '../../agrona/jdk.js';
import { AeronException } from '../exceptions/AeronException.js';
import { FrameDescriptor } from '../logbuffer/FrameDescriptor.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Flyweight for a Status Message Frame.
 * <p>
 * <a target="_blank" href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#status-messages">
 * Status Message</a> wiki page.
 */
export class StatusMessageFlyweight extends HeaderFlyweight {
    /**
     * Length of the Status Message Frame.
     */
    public static readonly HEADER_LENGTH = 36;

    /**
     * Publisher should send SETUP frame.
     */
    public static readonly SEND_SETUP_FLAG = 0x80;

    /**
     * Publisher should treat Subscriber as going away.
     */
    public static readonly END_OF_STREAM_FLAG = 0x40;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    private static readonly SESSION_ID_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    private static readonly STREAM_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the consumption term-id field begins.
     */
    private static readonly CONSUMPTION_TERM_ID_FIELD_OFFSET = 16;

    /**
     * Offset in the frame at which the consumption term-offset field begins.
     */
    private static readonly CONSUMPTION_TERM_OFFSET_FIELD_OFFSET = 20;

    /**
     * Offset in the frame at which the receiver window length field begins.
     */
    private static readonly RECEIVER_WINDOW_FIELD_OFFSET = 24;

    /**
     * Offset in the frame at which the receiver-id field begins.
     */
    private static readonly RECEIVER_ID_FIELD_OFFSET = 28;

    /**
     * Offset in the frame at which the ASF field begins.
     */
    private static readonly APP_SPECIFIC_FEEDBACK_FIELD_OFFSET = 36;

    /**
     * Offset in the frame at which the gtag field begins.
     */
    private static readonly GROUP_TAG_FIELD_OFFSET = StatusMessageFlyweight.APP_SPECIFIC_FEEDBACK_FIELD_OFFSET;

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
     * The session-id for the stream.
     *
     * @return session-id for the stream.
     */
    public sessionId(): number;
    /**
     * Set the session-id of the stream.
     *
     * @param sessionId field value.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): StatusMessageFlyweight;
    public sessionId(sessionId?: number): number | StatusMessageFlyweight {
        if (undefined === sessionId) {
            return this.getInt(StatusMessageFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The stream-id for the stream.
     *
     * @return the session-id for the stream.
     */
    public streamId(): number;
    /**
     * Set the session-id for the stream.
     *
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): StatusMessageFlyweight;
    public streamId(streamId?: number): number | StatusMessageFlyweight {
        if (undefined === streamId) {
            return this.getInt(StatusMessageFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The highest consumption offset within the term.
     *
     * @return the highest consumption offset within the term.
     */
    public consumptionTermOffset(): number;
    /**
     * Set the highest consumption offset within the term.
     *
     * @param termOffset field value.
     * @return this for a fluent API.
     */
    public consumptionTermOffset(termOffset: number): StatusMessageFlyweight;
    public consumptionTermOffset(termOffset?: number): number | StatusMessageFlyweight {
        if (undefined === termOffset) {
            return this.getInt(StatusMessageFlyweight.CONSUMPTION_TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.CONSUMPTION_TERM_OFFSET_FIELD_OFFSET, termOffset, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The highest consumption term-id.
     *
     * @return highest consumption term-id.
     */
    public consumptionTermId(): number;
    /**
     * Set the highest consumption term-id.
     *
     * @param termId field value.
     * @return this for a fluent API.
     */
    public consumptionTermId(termId: number): StatusMessageFlyweight;
    public consumptionTermId(termId?: number): number | StatusMessageFlyweight {
        if (undefined === termId) {
            return this.getInt(StatusMessageFlyweight.CONSUMPTION_TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.CONSUMPTION_TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The receiver window length they will accept.
     *
     * @return receiver window length they will accept.
     */
    public receiverWindowLength(): number;
    /**
     * Set the receiver window length they will accept.
     *
     * @param receiverWindowLength field value.
     * @return this for a fluent API.
     */
    public receiverWindowLength(receiverWindowLength: number): StatusMessageFlyweight;
    public receiverWindowLength(receiverWindowLength?: number): number | StatusMessageFlyweight {
        if (undefined === receiverWindowLength) {
            return this.getInt(StatusMessageFlyweight.RECEIVER_WINDOW_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.RECEIVER_WINDOW_FIELD_OFFSET, receiverWindowLength, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Identifier for the receiver to distinguish them for FlowControl strategies, a `bigint`: an opaque 64-bit wire
     * value (spec 5.2).
     *
     * @return identifier for the receiver to distinguish them for FlowControl strategies.
     */
    public receiverId(): bigint;
    /**
     * Identifier for the receiver to distinguish them for FlowControl strategies.
     *
     * @param id for the receiver to distinguish them for FlowControl strategies.
     * @return this for a fluent API.
     */
    public receiverId(id: bigint): StatusMessageFlyweight;
    public receiverId(id?: bigint): bigint | StatusMessageFlyweight {
        if (undefined === id) {
            return this.getLongUnaligned(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET);
        }

        return this.putLongUnaligned(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET, id);
    }

    /**
     * The upper 32 bits of the receiver id, without a `bigint`: the high half of the 8 byte little endian field.
     * <p>
     * Not in Java (spec D14).
     *
     * @return the upper half of the receiver id, an `int`.
     */
    public receiverIdHigh(): number;
    /**
     * Set the upper 32 bits of the receiver id, without a `bigint`.
     * <p>
     * Not in Java (spec D14).
     *
     * @param high the upper half of the receiver id, an `int`.
     * @return this for a fluent API.
     */
    public receiverIdHigh(high: number): StatusMessageFlyweight;
    public receiverIdHigh(high?: number): number | StatusMessageFlyweight {
        if (undefined === high) {
            return this.getInt(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET + SIZE_OF_INT, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET + SIZE_OF_INT, high, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The lower 32 bits of the receiver id, without a `bigint`: the low half of the 8 byte little endian field.
     * <p>
     * Not in Java (spec D14).
     *
     * @return the lower half of the receiver id, an `int`.
     */
    public receiverIdLow(): number;
    /**
     * Set the lower 32 bits of the receiver id, without a `bigint`.
     * <p>
     * Not in Java (spec D14).
     *
     * @param low the lower half of the receiver id, an `int`.
     * @return this for a fluent API.
     */
    public receiverIdLow(low: number): StatusMessageFlyweight;
    public receiverIdLow(low?: number): number | StatusMessageFlyweight {
        if (undefined === low) {
            return this.getInt(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(StatusMessageFlyweight.RECEIVER_ID_FIELD_OFFSET, low, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The length of the Application Specific Feedback (or gtag).
     *
     * @return length, in bytes, of the Application Specific Feedback (or gtag).
     */
    public asfLength(): number {
        return this.frameLength() - StatusMessageFlyweight.HEADER_LENGTH;
    }

    /**
     * The group tag (if present) from the Status Message.
     *
     * @return the group tag value, a `bigint`, or 0 if not present.
     */
    public groupTag(): bigint;
    /**
     * Set the Receiver Group Tag for the Status Message.
     *
     * @param groupTag value to set if not null.
     * @return this for a fluent API.
     */
    public groupTag(groupTag: bigint | null): StatusMessageFlyweight;
    public groupTag(groupTag?: bigint | null): bigint | StatusMessageFlyweight {
        if (undefined === groupTag) {
            const frameLength = this.frameLength();

            if (frameLength > StatusMessageFlyweight.HEADER_LENGTH) {
                if (frameLength > StatusMessageFlyweight.HEADER_LENGTH + SIZE_OF_LONG) {
                    throw new AeronException(
                        'SM has longer application specific feedback (' +
                            (frameLength - StatusMessageFlyweight.HEADER_LENGTH) +
                            ') than gtag',
                    );
                }

                return this.getLongUnaligned(StatusMessageFlyweight.GROUP_TAG_FIELD_OFFSET);
            }

            return 0n;
        }

        if (null !== groupTag) {
            Long.checkInt64(groupTag);
            this.frameLength(StatusMessageFlyweight.HEADER_LENGTH + SIZE_OF_LONG);
            this.putLongUnaligned(StatusMessageFlyweight.GROUP_TAG_FIELD_OFFSET, groupTag);
        } else {
            // make sure to explicitly set the frameLength in case of previous tags used.
            this.frameLength(StatusMessageFlyweight.HEADER_LENGTH);
        }

        return this;
    }

    /**
     * Return the field offset within the flyweight for the group tag field.
     *
     * @return offset of group tag field
     */
    public static groupTagFieldOffset(): number {
        return StatusMessageFlyweight.GROUP_TAG_FIELD_OFFSET;
    }

    /**
     * Get long value from a field that is not aligned on an 8 byte boundary. A `bigint`.
     * <p>
     * The native byte order is little-endian, so the big-endian branch of Java is not ported; a `DataView` reads the
     * eight bytes in one call.
     *
     * @param offset of the field to get.
     * @return value of field.
     */
    public getLongUnaligned(offset: number): bigint {
        return this.getLongBigInt(offset, LITTLE_ENDIAN);
    }

    /**
     * Set long value into a field that is not aligned on an 8 byte boundary. As {@link getLongUnaligned}, the
     * little-endian branch only.
     *
     * @param offset of the field to put.
     * @param value  of the field to put, a `bigint`; a `RangeError` if it is outside [-2^63, 2^63 - 1] (spec D5).
     * @return this for fluent API.
     */
    public putLongUnaligned(offset: number, value: bigint): StatusMessageFlyweight {
        this.putLongBigInt(offset, Long.checkInt64(value), LITTLE_ENDIAN);

        return this;
    }

    /**
     * Check if the SM frame is valid given the `termLength`.
     *
     * @param termLength to check against.
     * @return `true` if valid.
     */
    public isValid(termLength: number): boolean {
        const termOffset = this.consumptionTermOffset();
        const receiverWindowLength = this.receiverWindowLength();
        return (
            termOffset >= 0 &&
            termOffset < termLength &&
            FrameDescriptor.isFrameAligned(termOffset) &&
            receiverWindowLength >= 0 &&
            receiverWindowLength <= termLength >> 1
        );
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'STATUS{' +
            'frame-length=' +
            this.frameLength() +
            ' version=' +
            this.version() +
            ' flags=' +
            HeaderFlyweight.flagsToChars(this.flags()).join('') +
            ' type=' +
            this.headerType() +
            ' session-id=' +
            this.sessionId() +
            ' stream-id=' +
            this.streamId() +
            ' consumption-term-id=' +
            this.consumptionTermId() +
            ' consumption-term-offset=' +
            this.consumptionTermOffset() +
            ' receiver-window-length=' +
            this.receiverWindowLength() +
            '}'
        );
    }
}
