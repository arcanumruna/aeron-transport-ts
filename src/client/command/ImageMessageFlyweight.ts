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
// Port of io/aeron/command/ImageMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;

/**
 * Message to denote that an Image has become unavailable for a given registration id.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                     Correlation ID                            |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                Subscription Registration ID                   |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Stream ID                             |
 *  +---------------------------------------------------------------+
 *  |                       Channel Length                          |
 *  +---------------------------------------------------------------+
 *  |                       Channel (ASCII)                        ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class ImageMessageFlyweight {
    private static readonly CORRELATION_ID_OFFSET = 0;
    private static readonly SUBSCRIPTION_REGISTRATION_ID_OFFSET =
        ImageMessageFlyweight.CORRELATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly STREAM_ID_FIELD_OFFSET =
        ImageMessageFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly CHANNEL_OFFSET = ImageMessageFlyweight.STREAM_ID_FIELD_OFFSET + SIZE_OF_INT;

    private buffer!: MutableDirectBuffer;
    private offset = 0;
    private lengthOfChannel = 0;

    /**
     * Create a flyweight that is wrapped over a buffer later.
     */
    public constructor() {}

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public wrap(buffer: MutableDirectBuffer, offset: number): ImageMessageFlyweight {
        this.buffer = buffer;
        this.offset = offset;

        return this;
    }

    /**
     * Get the correlation id field.
     *
     * @return correlation id field.
     */
    public correlationId(): number;
    /**
     * Set the correlation id field.
     *
     * @param correlationId field value.
     * @return this for a fluent API.
     */
    public correlationId(correlationId: number): ImageMessageFlyweight;
    public correlationId(correlationId?: number): number | ImageMessageFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + ImageMessageFlyweight.CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + ImageMessageFlyweight.CORRELATION_ID_OFFSET, correlationId);

        return this;
    }

    /**
     * Get the subscription registration id.
     *
     * @return subscription registration id.
     */
    public subscriptionRegistrationId(): number;
    /**
     * Set the subscription registration id.
     *
     * @param registrationId of the subscription.
     * @return this for a fluent API.
     */
    public subscriptionRegistrationId(registrationId: number): ImageMessageFlyweight;
    public subscriptionRegistrationId(registrationId?: number): number | ImageMessageFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + ImageMessageFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + ImageMessageFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET, registrationId);

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
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): ImageMessageFlyweight;
    public streamId(streamId?: number): number | ImageMessageFlyweight {
        if (undefined === streamId) {
            return this.buffer.getInt(this.offset + ImageMessageFlyweight.STREAM_ID_FIELD_OFFSET);
        }

        this.buffer.putInt(this.offset + ImageMessageFlyweight.STREAM_ID_FIELD_OFFSET, streamId);

        return this;
    }

    /**
     * Get the channel field. Reading it sets the length of the message to cover it.
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
    public channel(channel: string): ImageMessageFlyweight;
    public channel(channel?: string): string | ImageMessageFlyweight {
        if (undefined === channel) {
            const length = this.buffer.getInt(this.offset + ImageMessageFlyweight.CHANNEL_OFFSET);
            this.lengthOfChannel = SIZE_OF_INT + length;

            return this.buffer.getStringAscii(this.offset + ImageMessageFlyweight.CHANNEL_OFFSET, length);
        }

        this.lengthOfChannel = this.buffer.putStringAscii(this.offset + ImageMessageFlyweight.CHANNEL_OFFSET, channel);

        return this;
    }

    /**
     * Append the channel to an `Appendable`. It sets the length of the message to cover the channel.
     *
     * @param appendable to append the channel to.
     */
    public appendChannel(appendable: Appendable): void {
        const length = this.buffer.getInt(this.offset + ImageMessageFlyweight.CHANNEL_OFFSET);
        this.lengthOfChannel = SIZE_OF_INT + length;

        this.buffer.getStringAscii(this.offset + ImageMessageFlyweight.CHANNEL_OFFSET, appendable);
    }

    /**
     * Length of the message in bytes. Only valid after the channel has been set or read.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return ImageMessageFlyweight.CHANNEL_OFFSET + this.lengthOfChannel;
    }
}
