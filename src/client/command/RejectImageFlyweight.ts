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
// Port of io/aeron/command/RejectImageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Message to denote a request to reject an image.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5).
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                         Client ID                             |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                    Command Correlation ID                     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                    Image Correlation ID                       |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                          Position                             |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                       Reason Length                           |
 *  +---------------------------------------------------------------+
 *  |                       Reason (ASCII)                         ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class RejectImageFlyweight extends CorrelatedMessageFlyweight {
    private static readonly IMAGE_CORRELATION_ID_FIELD_OFFSET =
        CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly POSITION_FIELD_OFFSET =
        RejectImageFlyweight.IMAGE_CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly REASON_FIELD_OFFSET = RejectImageFlyweight.POSITION_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly MINIMUM_SIZE = RejectImageFlyweight.REASON_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): RejectImageFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Get the correlation id of the image to reject.
     *
     * @return correlation id of the image.
     */
    public imageCorrelationId(): number;
    /**
     * Set the correlation id of the image to reject.
     *
     * @param position correlation id of the image (the parameter is named `position` in Java).
     * @return this for a fluent API.
     */
    public imageCorrelationId(position: number): RejectImageFlyweight;
    public imageCorrelationId(position?: number): number | RejectImageFlyweight {
        if (undefined === position) {
            return this.buffer.getLong(this.offset + RejectImageFlyweight.IMAGE_CORRELATION_ID_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + RejectImageFlyweight.IMAGE_CORRELATION_ID_FIELD_OFFSET, position);

        return this;
    }

    /**
     * Get the position at which to reject the image.
     *
     * @return position.
     */
    public position(): number;
    /**
     * Set the position at which to reject the image.
     *
     * @param position at which to reject the image.
     * @return this for a fluent API.
     */
    public position(position: number): RejectImageFlyweight;
    public position(position?: number): number | RejectImageFlyweight {
        if (undefined === position) {
            return this.buffer.getLong(this.offset + RejectImageFlyweight.POSITION_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + RejectImageFlyweight.POSITION_FIELD_OFFSET, position);

        return this;
    }

    /**
     * Set the reason for the rejection.
     *
     * @param reason for the rejection.
     * @return this for a fluent API.
     */
    public reason(reason: string): RejectImageFlyweight;
    /**
     * Get the reason for the rejection.
     *
     * @return reason for the rejection.
     */
    public reason(): string;
    public reason(reason?: string): string | RejectImageFlyweight {
        if (undefined === reason) {
            return this.buffer.getStringAscii(this.offset + RejectImageFlyweight.REASON_FIELD_OFFSET);
        }

        this.buffer.putStringAscii(this.offset + RejectImageFlyweight.REASON_FIELD_OFFSET, reason);

        return this;
    }

    /**
     * Length of the reason in bytes, as stored in front of it.
     *
     * @return length of the reason in bytes.
     */
    public reasonBufferLength(): number {
        // This does make the assumption that the string is stored with the leading 4 bytes representing the length.
        return this.buffer.getInt(this.offset + RejectImageFlyweight.REASON_FIELD_OFFSET);
    }

    /**
     * {@inheritDoc}
     */
    public override clientId(): number;
    public override clientId(clientId: number): RejectImageFlyweight;
    public override clientId(clientId?: number): number | RejectImageFlyweight {
        if (undefined === clientId) {
            return super.clientId();
        }

        super.clientId(clientId);

        return this;
    }

    /**
     * {@inheritDoc}
     */
    public override correlationId(): number;
    public override correlationId(correlationId: number): RejectImageFlyweight;
    public override correlationId(correlationId?: number): number | RejectImageFlyweight {
        if (undefined === correlationId) {
            return super.correlationId();
        }

        super.correlationId(correlationId);

        return this;
    }

    /**
     * Compute the length of the message for a given reason.
     *
     * @param reason for the rejection.
     * @return length of the message in bytes.
     */
    public static computeLength(reason: string): number {
        return RejectImageFlyweight.MINIMUM_SIZE + reason.length;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < RejectImageFlyweight.MINIMUM_SIZE) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }

        if (length < RejectImageFlyweight.MINIMUM_SIZE + this.reasonBufferLength()) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }
    }
}
