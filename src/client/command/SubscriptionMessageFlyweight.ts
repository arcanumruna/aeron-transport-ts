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
// Port of io/aeron/command/SubscriptionMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Message to denote a request to add a subscription.
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
 *  |           Registration Correlation ID (of the original)       |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Stream Id                             |
 *  +---------------------------------------------------------------+
 *  |                       Channel Length                          |
 *  +---------------------------------------------------------------+
 *  |                       Channel (ASCII)                        ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class SubscriptionMessageFlyweight extends CorrelatedMessageFlyweight {
    private static readonly REGISTRATION_CORRELATION_ID_OFFSET =
        CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly STREAM_ID_OFFSET =
        SubscriptionMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly CHANNEL_OFFSET = SubscriptionMessageFlyweight.STREAM_ID_OFFSET + SIZE_OF_INT;
    private static readonly MINIMUM_LENGTH = SubscriptionMessageFlyweight.CHANNEL_OFFSET + SIZE_OF_INT;

    private lengthOfChannel = 0;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): SubscriptionMessageFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Get the registration correlation id.
     *
     * @return registration correlation id.
     */
    public registrationCorrelationId(): number;
    /**
     * Set the registration correlation id.
     *
     * @param correlationId registration correlation id.
     * @return this for a fluent API.
     */
    public registrationCorrelationId(correlationId: number): SubscriptionMessageFlyweight;
    public registrationCorrelationId(correlationId?: number): number | SubscriptionMessageFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + SubscriptionMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(
            this.offset + SubscriptionMessageFlyweight.REGISTRATION_CORRELATION_ID_OFFSET,
            correlationId,
        );

        return this;
    }

    /**
     * Get the stream id.
     *
     * @return stream id.
     */
    public streamId(): number;
    /**
     * Set the stream id.
     *
     * @param streamId stream id.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): SubscriptionMessageFlyweight;
    public streamId(streamId?: number): number | SubscriptionMessageFlyweight {
        if (undefined === streamId) {
            return this.buffer.getInt(this.offset + SubscriptionMessageFlyweight.STREAM_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + SubscriptionMessageFlyweight.STREAM_ID_OFFSET, streamId);

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
    public channel(channel: string): SubscriptionMessageFlyweight;
    public channel(channel?: string): string | SubscriptionMessageFlyweight {
        if (undefined === channel) {
            return this.buffer.getStringAscii(this.offset + SubscriptionMessageFlyweight.CHANNEL_OFFSET);
        }

        this.lengthOfChannel = this.buffer.putStringAscii(
            this.offset + SubscriptionMessageFlyweight.CHANNEL_OFFSET,
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
        this.buffer.getStringAscii(this.offset + SubscriptionMessageFlyweight.CHANNEL_OFFSET, appendable);
    }

    /**
     * Length of the message in bytes. Only valid after the channel has been set.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return SubscriptionMessageFlyweight.CHANNEL_OFFSET + this.lengthOfChannel;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < SubscriptionMessageFlyweight.MINIMUM_LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }

        if (
            length - SubscriptionMessageFlyweight.MINIMUM_LENGTH <
            this.buffer.getInt(this.offset + SubscriptionMessageFlyweight.CHANNEL_OFFSET)
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
        return SubscriptionMessageFlyweight.MINIMUM_LENGTH + channelLength;
    }
}
