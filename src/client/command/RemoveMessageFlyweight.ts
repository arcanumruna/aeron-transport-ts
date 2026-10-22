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
// Port of io/aeron/command/RemoveMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Command message flyweight to remove a publication, subscription or counter: a registration id after the
 * correlated header.
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
 *  |                  Registration ID to be removed                |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 * </pre>
 */
export abstract class RemoveMessageFlyweight extends CorrelatedMessageFlyweight {
    /**
     * Package-private in Java: the offset of the registration id.
     */
    public static readonly REGISTRATION_ID_FIELD_OFFSET =
        CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;

    private static readonly MINIMUM_LENGTH = RemoveMessageFlyweight.REGISTRATION_ID_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): RemoveMessageFlyweight {
        super.wrap(buffer, offset);

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
    public registrationId(registrationId: number): RemoveMessageFlyweight;
    public registrationId(registrationId?: number): number | RemoveMessageFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + RemoveMessageFlyweight.REGISTRATION_ID_FIELD_OFFSET);
        }

        this.buffer.putLong(this.offset + RemoveMessageFlyweight.REGISTRATION_ID_FIELD_OFFSET, registrationId);

        return this;
    }

    /**
     * Length of the message in bytes.
     *
     * @return length of the message in bytes.
     */
    public static override length(): number {
        return CorrelatedMessageFlyweight.LENGTH + SIZE_OF_LONG;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < RemoveMessageFlyweight.MINIMUM_LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }
    }
}
