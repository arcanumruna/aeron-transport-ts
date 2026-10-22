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
// Port of io/aeron/command/DestinationMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Message to denote a request to add or remove a destination to or from an existing publication or subscription.
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
 *  |        Registration ID of the Publication or Subscription     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                       Channel Length                          |
 *  +---------------------------------------------------------------+
 *  |                       Channel (ASCII)                        ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class DestinationMessageFlyweight extends CorrelatedMessageFlyweight {
    private static readonly REGISTRATION_CORRELATION_ID_OFFSET =
        CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly CHANNEL_OFFSET =
        DestinationMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly MINIMUM_LENGTH = DestinationMessageFlyweight.CHANNEL_OFFSET + SIZE_OF_INT;

    private lengthOfChannel = 0;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): DestinationMessageFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Get the registration correlation id of the publication or subscription.
     *
     * @return registration correlation id of the publication or subscription.
     */
    public registrationCorrelationId(): number;
    /**
     * Set the registration correlation id of the publication or subscription.
     *
     * @param correlationId registration correlation id of the publication or subscription.
     * @return this for a fluent API.
     */
    public registrationCorrelationId(correlationId: number): DestinationMessageFlyweight;
    public registrationCorrelationId(correlationId?: number): number | DestinationMessageFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + DestinationMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(
            this.offset + DestinationMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET,
            correlationId,
        );

        return this;
    }

    /**
     * Get the channel field.
     *
     * @return channel field.
     */
    public channel(): string;
    /**
     * Set the channel field.
     *
     * @param channel field value.
     * @return this for a fluent API.
     */
    public channel(channel: string): DestinationMessageFlyweight;
    public channel(channel?: string): string | DestinationMessageFlyweight {
        if (undefined === channel) {
            return this.buffer.getStringAscii(this.offset + DestinationMessageFlyweight.CHANNEL_OFFSET);
        }

        this.lengthOfChannel = this.buffer.putStringAscii(
            this.offset + DestinationMessageFlyweight.CHANNEL_OFFSET,
            channel,
        );

        return this;
    }

    /**
     * Append the channel to an `Appendable`.
     *
     * @param appendable to append the channel to.
     */
    public appendChannel(appendable: Appendable): void {
        this.buffer.getStringAscii(this.offset + DestinationMessageFlyweight.CHANNEL_OFFSET, appendable);
    }

    /**
     * Length of the message in bytes. Only valid after the channel has been set.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return DestinationMessageFlyweight.CHANNEL_OFFSET + this.lengthOfChannel;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < DestinationMessageFlyweight.MINIMUM_LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }

        if (
            length - DestinationMessageFlyweight.MINIMUM_LENGTH <
            this.buffer.getInt(this.offset + DestinationMessageFlyweight.CHANNEL_OFFSET)
        ) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short for channel: length=' + length,
            );
        }
    }

    /**
     * Compute the length of the message for a channel of a given length.
     *
     * @param channelLength length of the channel in bytes.
     * @return length of the message in bytes.
     */
    public static computeLength(channelLength: number): number {
        return DestinationMessageFlyweight.MINIMUM_LENGTH + channelLength;
    }
}
