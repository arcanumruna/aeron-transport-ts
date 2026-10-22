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
// Port of io/aeron/command/ClientTimeoutFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * Message to denote that a client has timed out by the driver.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                         Client ID                             |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class ClientTimeoutFlyweight {
    /**
     * Length of the message.
     */
    public static readonly LENGTH = SIZE_OF_LONG;

    private static readonly CLIENT_ID_FIELD_OFFSET = 0;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): ClientTimeoutFlyweight {
        this.buffer = buffer;
        this.offset = offset;

        return this;
    }

    /**
     * Get the client id field.
     *
     * @return client id field.
     */
    public clientId(): number;
    /**
     * Set the client id field.
     *
     * @param clientId field value.
     * @return this for a fluent API.
     */
    public clientId(clientId: number): ClientTimeoutFlyweight;
    public clientId(clientId?: number): number | ClientTimeoutFlyweight {
        if (undefined === clientId) {
            return this.buffer.getLong(this.offset + ClientTimeoutFlyweight.CLIENT_ID_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + ClientTimeoutFlyweight.CLIENT_ID_FIELD_OFFSET, clientId);

        return this;
    }
}
