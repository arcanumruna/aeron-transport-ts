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
// Port of io/aeron/command/ImageBuffersReadyFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;

/**
 * Message to denote that new image buffers are ready for a subscription.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5).
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                       Correlation ID                          |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Session ID                            |
 *  +---------------------------------------------------------------+
 *  |                          Stream ID                            |
 *  +---------------------------------------------------------------+
 *  |                Subscription Registration Id                   |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                  Subscriber Position Id                       |
 *  +---------------------------------------------------------------+
 *  |                       Log File Name Length                    |
 *  +---------------------------------------------------------------+
 *  |                       Log File Name (ASCII)                  ...
 *  +---------------------------------------------------------------+
 *  |                   Source identity Length                      |
 *  +---------------------------------------------------------------+
 *  |                   Source identity (ASCII)                    ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class ImageBuffersReadyFlyweight {
    private static readonly CORRELATION_ID_OFFSET = 0;
    private static readonly SESSION_ID_OFFSET = ImageBuffersReadyFlyweight.CORRELATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly STREAM_ID_FIELD_OFFSET = ImageBuffersReadyFlyweight.SESSION_ID_OFFSET + SIZE_OF_INT;
    private static readonly SUBSCRIPTION_REGISTRATION_ID_OFFSET =
        ImageBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET + SIZE_OF_INT;
    private static readonly SUBSCRIBER_POSITION_ID_OFFSET =
        ImageBuffersReadyFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly LOG_FILE_NAME_OFFSET =
        ImageBuffersReadyFlyweight.SUBSCRIBER_POSITION_ID_OFFSET + SIZE_OF_INT;

    private buffer!: MutableDirectBuffer;
    private offset = 0;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): ImageBuffersReadyFlyweight {
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
    public correlationId(correlationId: number): ImageBuffersReadyFlyweight;
    public correlationId(correlationId?: number): number | ImageBuffersReadyFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + ImageBuffersReadyFlyweight.CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + ImageBuffersReadyFlyweight.CORRELATION_ID_OFFSET, correlationId);

        return this;
    }

    /**
     * Get the session id field.
     *
     * @return session id field.
     */
    public sessionId(): number;
    /**
     * Set the session id field.
     *
     * @param sessionId field value.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): ImageBuffersReadyFlyweight;
    public sessionId(sessionId?: number): number | ImageBuffersReadyFlyweight {
        if (undefined === sessionId) {
            return this.buffer.getInt(this.offset + ImageBuffersReadyFlyweight.SESSION_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + ImageBuffersReadyFlyweight.SESSION_ID_OFFSET, sessionId);

        return this;
    }

    /**
     * Get the stream id field.
     *
     * @return stream id field.
     */
    public streamId(): number;
    /**
     * Set the stream id field.
     *
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): ImageBuffersReadyFlyweight;
    public streamId(streamId?: number): number | ImageBuffersReadyFlyweight {
        if (undefined === streamId) {
            return this.buffer.getInt(this.offset + ImageBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET);
        }

        this.buffer.putInt(this.offset + ImageBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET, streamId);

        return this;
    }

    /**
     * Set the position counter id of the subscriber.
     *
     * @param id of the subscriber position counter.
     * @return this for a fluent API.
     */
    public subscriberPositionId(id: number): ImageBuffersReadyFlyweight;
    /**
     * Get the position counter id of the subscriber.
     *
     * @return position counter id of the subscriber.
     */
    public subscriberPositionId(): number;
    public subscriberPositionId(id?: number): number | ImageBuffersReadyFlyweight {
        if (undefined === id) {
            return this.buffer.getInt(this.offset + ImageBuffersReadyFlyweight.SUBSCRIBER_POSITION_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + ImageBuffersReadyFlyweight.SUBSCRIBER_POSITION_ID_OFFSET, id);

        return this;
    }

    /**
     * Set the registration id of the subscription.
     *
     * @param id of the subscription.
     * @return this for a fluent API.
     */
    public subscriptionRegistrationId(id: number): ImageBuffersReadyFlyweight;
    /**
     * Get the registration id of the subscription.
     *
     * @return registration id of the subscription.
     */
    public subscriptionRegistrationId(): number;
    public subscriptionRegistrationId(id?: number): number | ImageBuffersReadyFlyweight {
        if (undefined === id) {
            return this.buffer.getLong(this.offset + ImageBuffersReadyFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + ImageBuffersReadyFlyweight.SUBSCRIPTION_REGISTRATION_ID_OFFSET, id);

        return this;
    }

    /**
     * Get the log file name field.
     *
     * @return log file name field.
     */
    public logFileName(): string;
    /**
     * Set the log file name field.
     *
     * @param logFileName field value.
     * @return this for a fluent API.
     */
    public logFileName(logFileName: string): ImageBuffersReadyFlyweight;
    public logFileName(logFileName?: string): string | ImageBuffersReadyFlyweight {
        if (undefined === logFileName) {
            return this.buffer.getStringAscii(this.offset + ImageBuffersReadyFlyweight.LOG_FILE_NAME_OFFSET);
        }

        this.buffer.putStringAscii(this.offset + ImageBuffersReadyFlyweight.LOG_FILE_NAME_OFFSET, logFileName);

        return this;
    }

    /**
     * Append the log file name to an `Appendable`.
     *
     * @param appendable to append the log file name to.
     */
    public appendLogFileName(appendable: Appendable): void {
        this.buffer.getStringAscii(this.offset + ImageBuffersReadyFlyweight.LOG_FILE_NAME_OFFSET, appendable);
    }

    /**
     * Get the source identity field.
     *
     * @return source identity field.
     */
    public sourceIdentity(): string;
    /**
     * Set the source identity field. Set the log file name first: the source identity follows it.
     *
     * @param value of the source identity.
     * @return this for a fluent API.
     */
    public sourceIdentity(value: string): ImageBuffersReadyFlyweight;
    public sourceIdentity(value?: string): string | ImageBuffersReadyFlyweight {
        if (undefined === value) {
            return this.buffer.getStringAscii(this.offset + this.sourceIdentityOffset());
        }

        this.buffer.putStringAscii(this.offset + this.sourceIdentityOffset(), value);

        return this;
    }

    /**
     * Append the source identity to an `Appendable`.
     *
     * @param appendable to append the source identity to.
     */
    public appendSourceIdentity(appendable: Appendable): void {
        this.buffer.getStringAscii(this.offset + this.sourceIdentityOffset(), appendable);
    }

    /**
     * Length of the message in bytes. Only valid after the source identity has been set.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        const sourceIdentityOffset = this.sourceIdentityOffset();

        return sourceIdentityOffset + this.buffer.getInt(this.offset + sourceIdentityOffset) + SIZE_OF_INT;
    }

    private sourceIdentityOffset(): number {
        const alignedLength = BitUtil.align(
            this.buffer.getInt(this.offset + ImageBuffersReadyFlyweight.LOG_FILE_NAME_OFFSET),
            SIZE_OF_INT,
        );

        return ImageBuffersReadyFlyweight.LOG_FILE_NAME_OFFSET + SIZE_OF_INT + alignedLength;
    }
}
