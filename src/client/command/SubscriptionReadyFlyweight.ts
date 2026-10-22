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
// Port of io/aeron/command/SubscriptionReadyFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;

/**
 * Message to denote that a Subscription has been successfully set up.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                     Correlation ID                            |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                  Channel Status Indicator Id                  |
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class SubscriptionReadyFlyweight {
    /**
     * Length of the message in bytes.
     */
    public static readonly LENGTH = SIZE_OF_LONG + SIZE_OF_INT;

    private static readonly CORRELATION_ID_OFFSET = 0;
    private static readonly CHANNEL_STATUS_INDICATOR_ID_OFFSET =
        SubscriptionReadyFlyweight.CORRELATION_ID_OFFSET + SIZE_OF_LONG;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): SubscriptionReadyFlyweight {
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
    public correlationId(correlationId: number): SubscriptionReadyFlyweight;
    public correlationId(correlationId?: number): number | SubscriptionReadyFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + SubscriptionReadyFlyweight.CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + SubscriptionReadyFlyweight.CORRELATION_ID_OFFSET, correlationId);

        return this;
    }

    /**
     * Get the channel status counter id.
     *
     * @return channel status counter id.
     */
    public channelStatusCounterId(): number;
    /**
     * Set the channel status counter id.
     *
     * @param counterId of the channel status counter.
     * @return this for a fluent API.
     */
    public channelStatusCounterId(counterId: number): SubscriptionReadyFlyweight;
    public channelStatusCounterId(counterId?: number): number | SubscriptionReadyFlyweight {
        if (undefined === counterId) {
            return this.buffer.getInt(this.offset + SubscriptionReadyFlyweight.CHANNEL_STATUS_INDICATOR_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + SubscriptionReadyFlyweight.CHANNEL_STATUS_INDICATOR_ID_OFFSET, counterId);

        return this;
    }
}
