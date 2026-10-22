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
// Port of io/aeron/protocol/ErrorFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { DirectBuffer } from '../../agrona/DirectBuffer.js';
import { ByteOrder, Long } from '../../agrona/jdk.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { STR_HEADER_LEN } = DirectBuffer;

/**
 * Flyweight for general Aeron network protocol error frame
 * <pre>
 *    0                   1                   2                   3
 *    0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *    +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * 0  |R|                 Frame Length (varies)                       |
 *    +---------------+---------------+-------------------------------+
 * 4  |   Version     |     Flags     |         Type (=0x04)          |
 *    +---------------+---------------+-------------------------------+
 * 8  |                          Session ID                           |
 *    +---------------------------------------------------------------+
 * 12 |                           Stream ID                           |
 *    +---------------------------------------------------------------+
 * 16 |                          Receiver ID                          |
 *    |                                                               |
 *    +---------------------------------------------------------------+
 * 24 |                           Group Tag                           |
 *    |                                                               |
 *    +---------------------------------------------------------------+
 * 32 |                          Error Code                           |
 *    +---------------------------------------------------------------+
 * 36 |                     Error String Length                       |
 *    +---------------------------------------------------------------+
 * 40 |                         Error String (ASCII)                ...
 *    +---------------------------------------------------------------+
 *    ...                                                             |
 *    +---------------------------------------------------------------+
 * </pre>
 *
 * @since 1.47.0
 */
export class ErrorFlyweight extends HeaderFlyweight {
    /**
     * Offset in the frame at which the session-id field begins.
     */
    public static readonly SESSION_ID_FIELD_OFFSET = HeaderFlyweight.MIN_HEADER_LENGTH;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    public static readonly STREAM_ID_FIELD_OFFSET = ErrorFlyweight.SESSION_ID_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset in the frame at which the receiver-id field begins.
     */
    public static readonly RECEIVER_ID_FIELD_OFFSET = ErrorFlyweight.STREAM_ID_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset in the frame at which the group-tag field begins.
     */
    public static readonly GROUP_TAG_FIELD_OFFSET = ErrorFlyweight.RECEIVER_ID_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the frame at which the error-code field begins.
     */
    public static readonly ERROR_CODE_FIELD_OFFSET = ErrorFlyweight.GROUP_TAG_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the frame at which the error-string field begins.
     */
    public static readonly ERROR_STRING_FIELD_OFFSET = ErrorFlyweight.ERROR_CODE_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Length of the header of the frame, the fixed fields before the error string.
     */
    public static readonly HEADER_LENGTH = ErrorFlyweight.ERROR_STRING_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Maximum length of the error message in bytes.
     */
    public static readonly MAX_ERROR_MESSAGE_LENGTH = 1023;

    /**
     * Maximum length of the frame in bytes.
     */
    public static readonly MAX_ERROR_FRAME_LENGTH =
        ErrorFlyweight.HEADER_LENGTH + ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH;

    /**
     * Flag set when the frame carries a group tag.
     */
    public static readonly HAS_GROUP_ID_FLAG = 0x08;

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
     * The session id of the stream the error relates to.
     *
     * @return session id.
     */
    public sessionId(): number;
    /**
     * Set the session id of the stream the error relates to.
     *
     * @param sessionId session id.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): ErrorFlyweight;
    public sessionId(sessionId?: number): number | ErrorFlyweight {
        if (undefined === sessionId) {
            return this.getInt(ErrorFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ErrorFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The stream id the error relates to.
     *
     * @return stream id.
     */
    public streamId(): number;
    /**
     * Set the stream id the error relates to.
     *
     * @param streamId stream id.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): ErrorFlyweight;
    public streamId(streamId?: number): number | ErrorFlyweight {
        if (undefined === streamId) {
            return this.getInt(ErrorFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ErrorFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The receiver id of the receiver that sent the error. An opaque 64-bit wire value, a `bigint` (spec 5.2).
     *
     * @return receiver id.
     */
    public receiverId(): bigint;
    /**
     * Set the receiver id of the receiver that sent the error.
     *
     * @param receiverId receiver id.
     * @return this for a fluent API.
     */
    public receiverId(receiverId: bigint): ErrorFlyweight;
    public receiverId(receiverId?: bigint): bigint | ErrorFlyweight {
        if (undefined === receiverId) {
            return this.getLongBigInt(ErrorFlyweight.RECEIVER_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putLongBigInt(ErrorFlyweight.RECEIVER_ID_FIELD_OFFSET, Long.checkInt64(receiverId), LITTLE_ENDIAN);

        return this;
    }

    /**
     * The group tag of the receiver that sent the error, valid when {@link hasGroupTag}. A `bigint` (spec 5.2).
     *
     * @return group tag.
     */
    public groupTag(): bigint;
    /**
     * Set the group tag, or clear it when `null`.
     *
     * @param groupTag group tag, or `null` for none.
     * @return this for a fluent API.
     */
    public groupTag(groupTag: bigint | null): ErrorFlyweight;
    public groupTag(groupTag?: bigint | null): bigint | ErrorFlyweight {
        if (undefined === groupTag) {
            return this.getLongBigInt(ErrorFlyweight.GROUP_TAG_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        if (null === groupTag) {
            this.flags(~ErrorFlyweight.HAS_GROUP_ID_FLAG & this.flags());
        } else {
            // checked before any write, so a throw changes nothing (spec D5)
            Long.checkInt64(groupTag);
            this.putLongBigInt(ErrorFlyweight.GROUP_TAG_FIELD_OFFSET, groupTag);
            this.flags(ErrorFlyweight.HAS_GROUP_ID_FLAG | this.flags());
        }

        return this;
    }

    /**
     * Whether the frame carries a group tag.
     *
     * @return `true` if the group tag flag is set.
     */
    public hasGroupTag(): boolean {
        return ErrorFlyweight.HAS_GROUP_ID_FLAG === (ErrorFlyweight.HAS_GROUP_ID_FLAG & this.flags());
    }

    /**
     * The error code.
     *
     * @return error code.
     */
    public errorCode(): number;
    /**
     * Set the error code.
     *
     * @param errorCode error code.
     * @return this for a fluent API.
     */
    public errorCode(errorCode: number): ErrorFlyweight;
    public errorCode(errorCode?: number): number | ErrorFlyweight {
        if (undefined === errorCode) {
            return this.getInt(ErrorFlyweight.ERROR_CODE_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ErrorFlyweight.ERROR_CODE_FIELD_OFFSET, errorCode, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The error message.
     *
     * @return error message.
     */
    public errorMessage(): string;
    /**
     * Set the error message, truncated to {@link MAX_ERROR_MESSAGE_LENGTH}, and the frame length with it.
     *
     * @param errorMessage error message, or `null` for none.
     * @return this for a fluent API.
     */
    public errorMessage(errorMessage: string | null): ErrorFlyweight;
    public errorMessage(errorMessage?: string | null): string | ErrorFlyweight {
        if (undefined === errorMessage) {
            return this.getStringAscii(ErrorFlyweight.ERROR_STRING_FIELD_OFFSET);
        }

        let length: number;
        if (null === errorMessage) {
            length = 0;
            this.putInt(ErrorFlyweight.ERROR_STRING_FIELD_OFFSET, length, LITTLE_ENDIAN);
        } else {
            length = Math.min(ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH, errorMessage.length);
            this.putInt(ErrorFlyweight.ERROR_STRING_FIELD_OFFSET, length, LITTLE_ENDIAN);
            this.putStringWithoutLengthAscii(
                ErrorFlyweight.ERROR_STRING_FIELD_OFFSET + STR_HEADER_LEN,
                errorMessage,
                0,
                length,
            );
        }

        this.frameLength(ErrorFlyweight.HEADER_LENGTH + length);

        return this;
    }

    /**
     * Check if the error frame is valid.
     *
     * @return `true` if valid.
     */
    public isValid(): boolean {
        const errorLength = this.getInt(ErrorFlyweight.ERROR_STRING_FIELD_OFFSET, LITTLE_ENDIAN);
        return (
            errorLength >= 0 &&
            errorLength <= ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH &&
            ErrorFlyweight.HEADER_LENGTH + errorLength <= this.frameLength()
        );
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'ERROR{' +
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
            ' error-code=' +
            this.errorCode() +
            ' error-message=' +
            this.errorMessage() +
            '}'
        );
    }
}
