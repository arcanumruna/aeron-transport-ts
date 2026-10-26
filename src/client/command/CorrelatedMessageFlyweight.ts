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
// Port of io/aeron/command/CorrelatedMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';

const { SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Header for the commands that are correlated: a client id and a correlation id.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5): a value outside it throws `RangeError`.
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
 * </pre>
 */
export class CorrelatedMessageFlyweight {
    /**
     * Length of the header.
     */
    public static readonly LENGTH = 2 * SIZE_OF_LONG;

    private static readonly CLIENT_ID_FIELD_OFFSET = 0;

    /**
     * Package-private in Java: the offset of the correlation id, used by the flyweights that extend this one.
     */
    public static readonly CORRELATION_ID_FIELD_OFFSET =
        CorrelatedMessageFlyweight.CLIENT_ID_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Package-private in Java.
     */
    protected buffer!: MutableDirectBuffer;

    /**
     * Package-private in Java.
     */
    protected offset = 0;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): CorrelatedMessageFlyweight {
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
    public clientId(clientId: number): CorrelatedMessageFlyweight;
    public clientId(clientId?: number): number | CorrelatedMessageFlyweight {
        if (undefined === clientId) {
            return this.buffer.getLong(this.offset + CorrelatedMessageFlyweight.CLIENT_ID_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + CorrelatedMessageFlyweight.CLIENT_ID_FIELD_OFFSET, clientId);

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
    public correlationId(correlationId: number): CorrelatedMessageFlyweight;
    public correlationId(correlationId?: number): number | CorrelatedMessageFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET, correlationId);

        return this;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public validateLength(msgTypeId: number, length: number): void {
        if (length < CorrelatedMessageFlyweight.LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }
    }
}
