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
// Port of io/aeron/command/PublicationBuffersReadyFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;

/**
 * Message to denote that new buffers for a publication are ready.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5).
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                       Correlation ID                          |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                      Registration ID                          |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Session ID                            |
 *  +---------------------------------------------------------------+
 *  |                          Stream ID                            |
 *  +---------------------------------------------------------------+
 *  |                 Position Limit Counter Id                     |
 *  +---------------------------------------------------------------+
 *  |                 Channel Status Indicator ID                   |
 *  +---------------------------------------------------------------+
 *  |                      Log File Length                          |
 *  +---------------------------------------------------------------+
 *  |                      Log File Name (ASCII)                   ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class PublicationBuffersReadyFlyweight {
    private static readonly CORRELATION_ID_OFFSET = 0;
    private static readonly REGISTRATION_ID_OFFSET =
        PublicationBuffersReadyFlyweight.CORRELATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly SESSION_ID_OFFSET = PublicationBuffersReadyFlyweight.REGISTRATION_ID_OFFSET + SIZE_OF_LONG;
    private static readonly STREAM_ID_FIELD_OFFSET = PublicationBuffersReadyFlyweight.SESSION_ID_OFFSET + SIZE_OF_INT;
    private static readonly PUBLICATION_LIMIT_COUNTER_ID_OFFSET =
        PublicationBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET + SIZE_OF_INT;
    private static readonly CHANNEL_STATUS_INDICATOR_ID_OFFSET =
        PublicationBuffersReadyFlyweight.PUBLICATION_LIMIT_COUNTER_ID_OFFSET + SIZE_OF_INT;
    private static readonly LOGFILE_FIELD_OFFSET =
        PublicationBuffersReadyFlyweight.CHANNEL_STATUS_INDICATOR_ID_OFFSET + SIZE_OF_INT;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): PublicationBuffersReadyFlyweight {
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
    public correlationId(correlationId: number): PublicationBuffersReadyFlyweight;
    public correlationId(correlationId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + PublicationBuffersReadyFlyweight.CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + PublicationBuffersReadyFlyweight.CORRELATION_ID_OFFSET, correlationId);

        return this;
    }

    /**
     * Get the registration id field.
     *
     * @return registration id field.
     */
    public registrationId(): number;
    /**
     * Set the registration id field.
     *
     * @param registrationId field value.
     * @return this for a fluent API.
     */
    public registrationId(registrationId: number): PublicationBuffersReadyFlyweight;
    public registrationId(registrationId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + PublicationBuffersReadyFlyweight.REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + PublicationBuffersReadyFlyweight.REGISTRATION_ID_OFFSET, registrationId);

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
    public sessionId(sessionId: number): PublicationBuffersReadyFlyweight;
    public sessionId(sessionId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === sessionId) {
            return this.buffer.getInt(this.offset + PublicationBuffersReadyFlyweight.SESSION_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + PublicationBuffersReadyFlyweight.SESSION_ID_OFFSET, sessionId);

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
    public streamId(streamId: number): PublicationBuffersReadyFlyweight;
    public streamId(streamId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === streamId) {
            return this.buffer.getInt(this.offset + PublicationBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET);
        }

        this.buffer.putInt(this.offset + PublicationBuffersReadyFlyweight.STREAM_ID_FIELD_OFFSET, streamId);

        return this;
    }

    /**
     * Get the publication limit counter id field.
     *
     * @return publication limit counter id field.
     */
    public publicationLimitCounterId(): number;
    /**
     * Set the publication limit counter id field.
     *
     * @param positionCounterId field value.
     * @return this for a fluent API.
     */
    public publicationLimitCounterId(positionCounterId: number): PublicationBuffersReadyFlyweight;
    public publicationLimitCounterId(positionCounterId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === positionCounterId) {
            return this.buffer.getInt(
                this.offset + PublicationBuffersReadyFlyweight.PUBLICATION_LIMIT_COUNTER_ID_OFFSET,
            );
        }

        this.buffer.putInt(
            this.offset + PublicationBuffersReadyFlyweight.PUBLICATION_LIMIT_COUNTER_ID_OFFSET,
            positionCounterId,
        );

        return this;
    }

    /**
     * Get the channel status counter id field.
     *
     * @return channel status counter id field.
     */
    public channelStatusCounterId(): number;
    /**
     * Set the channel status counter id field.
     *
     * @param counterId field value.
     * @return this for a fluent API.
     */
    public channelStatusCounterId(counterId: number): PublicationBuffersReadyFlyweight;
    public channelStatusCounterId(counterId?: number): number | PublicationBuffersReadyFlyweight {
        if (undefined === counterId) {
            return this.buffer.getInt(
                this.offset + PublicationBuffersReadyFlyweight.CHANNEL_STATUS_INDICATOR_ID_OFFSET,
            );
        }

        this.buffer.putInt(
            this.offset + PublicationBuffersReadyFlyweight.CHANNEL_STATUS_INDICATOR_ID_OFFSET,
            counterId,
        );

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
    public logFileName(logFileName: string): PublicationBuffersReadyFlyweight;
    public logFileName(logFileName?: string): string | PublicationBuffersReadyFlyweight {
        if (undefined === logFileName) {
            return this.buffer.getStringAscii(this.offset + PublicationBuffersReadyFlyweight.LOGFILE_FIELD_OFFSET);
        }

        this.buffer.putStringAscii(this.offset + PublicationBuffersReadyFlyweight.LOGFILE_FIELD_OFFSET, logFileName);

        return this;
    }

    /**
     * Append the log file name to an `Appendable`.
     *
     * @param appendable to append the log file name to.
     */
    public appendLogFileName(appendable: Appendable): void {
        this.buffer.getStringAscii(this.offset + PublicationBuffersReadyFlyweight.LOGFILE_FIELD_OFFSET, appendable);
    }

    /**
     * Length of the message in bytes. Only valid after the log file name has been set.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return (
            this.buffer.getInt(this.offset + PublicationBuffersReadyFlyweight.LOGFILE_FIELD_OFFSET) +
            PublicationBuffersReadyFlyweight.LOGFILE_FIELD_OFFSET +
            SIZE_OF_INT
        );
    }
}
