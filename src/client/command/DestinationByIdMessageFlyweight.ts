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
// Port of io/aeron/command/DestinationByIdMessageFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ErrorCode } from '../ErrorCode.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Message to denote a request to remove a destination by registration id.
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
 *  |                  Resource Registration ID                     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                Destination Registration ID                    |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class DestinationByIdMessageFlyweight extends CorrelatedMessageFlyweight {
    private static readonly RESOURCE_REGISTRATION_ID_OFFSET =
        CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;
    private static readonly DESTINATION_REGISTRATION_ID_OFFSET =
        DestinationByIdMessageFlyweight.RESOURCE_REGISTRATION_ID_OFFSET + SIZE_OF_LONG;

    /**
     * Length of the message in bytes.
     */
    public static readonly MESSAGE_LENGTH = CorrelatedMessageFlyweight.LENGTH + 2 * SIZE_OF_LONG;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): DestinationByIdMessageFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Get the registration id of the resource (publication or subscription) the destination belongs to.
     *
     * @return registration id of the resource.
     */
    public resourceRegistrationId(): number;
    /**
     * Set the registration id of the resource (publication or subscription) the destination belongs to.
     *
     * @param registrationId of the resource.
     * @return this for a fluent API.
     */
    public resourceRegistrationId(registrationId: number): DestinationByIdMessageFlyweight;
    public resourceRegistrationId(registrationId?: number): number | DestinationByIdMessageFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + DestinationByIdMessageFlyweight.RESOURCE_REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(
            this.offset + DestinationByIdMessageFlyweight.RESOURCE_REGISTRATION_ID_OFFSET,
            registrationId,
        );

        return this;
    }

    /**
     * Get the registration id of the destination to remove.
     *
     * @return registration id of the destination.
     */
    public destinationRegistrationId(): number;
    /**
     * Set the registration id of the destination to remove.
     *
     * @param destinationRegistrationId of the destination.
     * @return this for a fluent API.
     */
    public destinationRegistrationId(destinationRegistrationId: number): DestinationByIdMessageFlyweight;
    public destinationRegistrationId(destinationRegistrationId?: number): number | DestinationByIdMessageFlyweight {
        if (undefined === destinationRegistrationId) {
            return this.buffer.getLong(
                this.offset + DestinationByIdMessageFlyweight.DESTINATION_REGISTRATION_ID_OFFSET,
            );
        }

        this.buffer.putLong(
            this.offset + DestinationByIdMessageFlyweight.DESTINATION_REGISTRATION_ID_OFFSET,
            destinationRegistrationId,
        );

        return this;
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < DestinationByIdMessageFlyweight.MESSAGE_LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }
    }
}
