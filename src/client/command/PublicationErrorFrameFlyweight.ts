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
// Port of io/aeron/command/PublicationErrorFrameFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable, IllegalArgumentException, NullPointerException } from '../../agrona/jdk.js';
import {
    Inet4Address,
    Inet6Address,
    InetAddress,
    InetSocketAddress,
    UnknownHostException,
} from '../../driver/jdkNet.js';
import { ErrorCode } from '../ErrorCode.js';

/**
 * Message to denote that a publication has received an error frame from a receiver.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5).
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                      Registration ID                          |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                 Destination Registration ID                   |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Session ID                            |
 *  +---------------------------------------------------------------+
 *  |                          Stream ID                            |
 *  +---------------------------------------------------------------+
 *  |                         Receiver ID                           |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                          Group Tag                            |
 *  |                                                               |
 *  +-------------------------------+-------------------------------+
 *  |        Address Type           |           Port                |
 *  +-------------------------------+-------------------------------+
 *  |                  Source Address (16 bytes)                    |
 *  |                                                               |
 *  |                                                               |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Error Code                            |
 *  +---------------------------------------------------------------+
 *  |                   Error Message Length                        |
 *  +---------------------------------------------------------------+
 *  |                       Error Message (ASCII)                  ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class PublicationErrorFrameFlyweight {
    private static readonly REGISTRATION_ID_OFFSET = 0;
    private static readonly IPV6_ADDRESS_LENGTH = 16;
    private static readonly IPV4_ADDRESS_LENGTH = BitUtil.SIZE_OF_INT;

    private static readonly DESTINATION_REGISTRATION_ID_OFFSET =
        PublicationErrorFrameFlyweight.REGISTRATION_ID_OFFSET + BitUtil.SIZE_OF_LONG;
    private static readonly SESSION_ID_OFFSET =
        PublicationErrorFrameFlyweight.DESTINATION_REGISTRATION_ID_OFFSET + BitUtil.SIZE_OF_LONG;
    private static readonly STREAM_ID_OFFSET = PublicationErrorFrameFlyweight.SESSION_ID_OFFSET + BitUtil.SIZE_OF_INT;
    private static readonly RECEIVER_ID_OFFSET = PublicationErrorFrameFlyweight.STREAM_ID_OFFSET + BitUtil.SIZE_OF_INT;
    private static readonly GROUP_TAG_OFFSET = PublicationErrorFrameFlyweight.RECEIVER_ID_OFFSET + BitUtil.SIZE_OF_LONG;
    private static readonly ADDRESS_TYPE_OFFSET =
        PublicationErrorFrameFlyweight.GROUP_TAG_OFFSET + BitUtil.SIZE_OF_LONG;
    private static readonly ADDRESS_PORT_OFFSET =
        PublicationErrorFrameFlyweight.ADDRESS_TYPE_OFFSET + BitUtil.SIZE_OF_SHORT;
    private static readonly ADDRESS_OFFSET = PublicationErrorFrameFlyweight.ADDRESS_PORT_OFFSET + BitUtil.SIZE_OF_SHORT;
    private static readonly ERROR_CODE_OFFSET =
        PublicationErrorFrameFlyweight.ADDRESS_OFFSET + PublicationErrorFrameFlyweight.IPV6_ADDRESS_LENGTH;
    private static readonly ERROR_MESSAGE_OFFSET =
        PublicationErrorFrameFlyweight.ERROR_CODE_OFFSET + BitUtil.SIZE_OF_INT;

    private static readonly ADDRESS_TYPE_IPV4 = 1;
    private static readonly ADDRESS_TYPE_IPV6 = 2;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): PublicationErrorFrameFlyweight {
        this.buffer = buffer;
        this.offset = offset;

        return this;
    }

    /**
     * Get the registration id of the publication.
     *
     * @return registration id of the publication.
     */
    public registrationId(): number;
    /**
     * Set the registration id of the publication.
     *
     * @param registrationId of the publication.
     * @return this for a fluent API.
     */
    public registrationId(registrationId: number): PublicationErrorFrameFlyweight;
    public registrationId(registrationId?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + PublicationErrorFrameFlyweight.REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + PublicationErrorFrameFlyweight.REGISTRATION_ID_OFFSET, registrationId);

        return this;
    }

    /**
     * Get the registration id of the destination, for a manual MDC publication.
     *
     * @return registration id of the destination.
     */
    public destinationRegistrationId(): number;
    /**
     * Set the registration id of the destination, for a manual MDC publication.
     *
     * @param registrationId of the destination.
     * @return this for a fluent API.
     */
    public destinationRegistrationId(registrationId: number): PublicationErrorFrameFlyweight;
    public destinationRegistrationId(registrationId?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === registrationId) {
            return this.buffer.getLong(this.offset + PublicationErrorFrameFlyweight.DESTINATION_REGISTRATION_ID_OFFSET);
        }

        this.buffer.putLong(
            this.offset + PublicationErrorFrameFlyweight.DESTINATION_REGISTRATION_ID_OFFSET,
            registrationId,
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
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): PublicationErrorFrameFlyweight;
    public streamId(streamId?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === streamId) {
            return this.buffer.getInt(this.offset + PublicationErrorFrameFlyweight.STREAM_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + PublicationErrorFrameFlyweight.STREAM_ID_OFFSET, streamId);

        return this;
    }

    /**
     * Get the session id.
     *
     * @return session id.
     */
    public sessionId(): number;
    /**
     * Set the session id.
     *
     * @param sessionId field value.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): PublicationErrorFrameFlyweight;
    public sessionId(sessionId?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === sessionId) {
            return this.buffer.getInt(this.offset + PublicationErrorFrameFlyweight.SESSION_ID_OFFSET);
        }

        this.buffer.putInt(this.offset + PublicationErrorFrameFlyweight.SESSION_ID_OFFSET, sessionId);

        return this;
    }

    /**
     * Get the receiver id.
     *
     * @return receiver id.
     */
    public receiverId(): number;
    /**
     * Set the receiver id.
     *
     * @param receiverId field value.
     * @return this for a fluent API.
     */
    public receiverId(receiverId: number): PublicationErrorFrameFlyweight;
    public receiverId(receiverId?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === receiverId) {
            return this.buffer.getLong(this.offset + PublicationErrorFrameFlyweight.RECEIVER_ID_OFFSET);
        }

        this.buffer.putLong(this.offset + PublicationErrorFrameFlyweight.RECEIVER_ID_OFFSET, receiverId);

        return this;
    }

    /**
     * Get the group tag.
     *
     * @return group tag.
     */
    public groupTag(): number;
    /**
     * Set the group tag.
     *
     * @param groupTag field value.
     * @return this for a fluent API.
     */
    public groupTag(groupTag: number): PublicationErrorFrameFlyweight;
    public groupTag(groupTag?: number): number | PublicationErrorFrameFlyweight {
        if (undefined === groupTag) {
            return this.buffer.getLong(this.offset + PublicationErrorFrameFlyweight.GROUP_TAG_OFFSET);
        }

        this.buffer.putLong(this.offset + PublicationErrorFrameFlyweight.GROUP_TAG_OFFSET, groupTag);

        return this;
    }

    /**
     * Get the address of the source that sent the error frame.
     *
     * @return the address of the source.
     * @throws IllegalArgumentException if the address type is not known.
     */
    public sourceAddress(): InetSocketAddress;
    /**
     * Set the address of the source that sent the error frame.
     *
     * @param sourceAddress of the source.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the address is neither IPv4 nor IPv6.
     */
    public sourceAddress(sourceAddress: InetSocketAddress): PublicationErrorFrameFlyweight;
    public sourceAddress(sourceAddress?: InetSocketAddress): InetSocketAddress | PublicationErrorFrameFlyweight {
        if (undefined === sourceAddress) {
            return this.readSourceAddress();
        }

        // the (short)(port & 0xFFFF) of Java
        const sourcePort = ((sourceAddress.getPort() & 0xffff) << 16) >> 16;
        const address = sourceAddress.getAddress();
        if (null === address) {
            throw new NullPointerException();
        }

        this.buffer.putShort(this.offset + PublicationErrorFrameFlyweight.ADDRESS_PORT_OFFSET, sourcePort);
        this.buffer.putBytes(this.offset + PublicationErrorFrameFlyweight.ADDRESS_OFFSET, address.getAddress());

        if (address instanceof Inet4Address) {
            this.buffer.putShort(
                this.offset + PublicationErrorFrameFlyweight.ADDRESS_TYPE_OFFSET,
                PublicationErrorFrameFlyweight.ADDRESS_TYPE_IPV4,
            );
            this.buffer.setMemory(
                this.offset +
                    PublicationErrorFrameFlyweight.ADDRESS_OFFSET +
                    PublicationErrorFrameFlyweight.IPV4_ADDRESS_LENGTH,
                PublicationErrorFrameFlyweight.IPV6_ADDRESS_LENGTH - PublicationErrorFrameFlyweight.IPV4_ADDRESS_LENGTH,
                0,
            );
        } else if (address instanceof Inet6Address) {
            this.buffer.putShort(
                this.offset + PublicationErrorFrameFlyweight.ADDRESS_TYPE_OFFSET,
                PublicationErrorFrameFlyweight.ADDRESS_TYPE_IPV6,
            );
        } else {
            throw new IllegalArgumentException('Unknown address type:' + address.constructor.name);
        }

        return this;
    }

    private readSourceAddress(): InetSocketAddress {
        const addressType = this.buffer.getShort(this.offset + PublicationErrorFrameFlyweight.ADDRESS_TYPE_OFFSET);
        const port = this.buffer.getShort(this.offset + PublicationErrorFrameFlyweight.ADDRESS_PORT_OFFSET) & 0xffff;

        let address: Uint8Array;
        if (PublicationErrorFrameFlyweight.ADDRESS_TYPE_IPV4 === addressType) {
            address = new Uint8Array(PublicationErrorFrameFlyweight.IPV4_ADDRESS_LENGTH);
        } else if (PublicationErrorFrameFlyweight.ADDRESS_TYPE_IPV6 === addressType) {
            address = new Uint8Array(PublicationErrorFrameFlyweight.IPV6_ADDRESS_LENGTH);
        } else {
            throw new IllegalArgumentException('Unknown address type:' + addressType);
        }

        this.buffer.getBytes(this.offset + PublicationErrorFrameFlyweight.ADDRESS_OFFSET, address);

        try {
            // Java calls the one argument Inet4Address.getByAddress(byte[]), the static of InetAddress
            return new InetSocketAddress(InetAddress.getByAddress(null, address), port);
        } catch (ex) {
            if (ex instanceof UnknownHostException) {
                throw new IllegalArgumentException('Unknown address type:' + addressType, ex);
            }

            throw ex;
        }
    }

    /**
     * Get the error code.
     *
     * @return error code.
     */
    public errorCode(): ErrorCode;
    /**
     * Set the error code.
     *
     * @param code for the error.
     * @return this for a fluent API.
     */
    public errorCode(code: ErrorCode): PublicationErrorFrameFlyweight;
    public errorCode(code?: ErrorCode): ErrorCode | PublicationErrorFrameFlyweight {
        if (undefined === code) {
            return ErrorCode.get(this.buffer.getInt(this.offset + PublicationErrorFrameFlyweight.ERROR_CODE_OFFSET));
        }

        this.buffer.putInt(this.offset + PublicationErrorFrameFlyweight.ERROR_CODE_OFFSET, code.value());

        return this;
    }

    /**
     * Get the error code value as an `int`.
     *
     * @return error code value.
     */
    public errorCodeValue(): number {
        return this.buffer.getInt(this.offset + PublicationErrorFrameFlyweight.ERROR_CODE_OFFSET);
    }

    /**
     * Get the error message.
     *
     * @return error message.
     */
    public errorMessage(): string;
    /**
     * Set the error message.
     *
     * @param message to be sent.
     * @return this for a fluent API.
     */
    public errorMessage(message: string): PublicationErrorFrameFlyweight;
    public errorMessage(message?: string): string | PublicationErrorFrameFlyweight {
        if (undefined === message) {
            return this.buffer.getStringAscii(this.offset + PublicationErrorFrameFlyweight.ERROR_MESSAGE_OFFSET);
        }

        this.buffer.putStringAscii(this.offset + PublicationErrorFrameFlyweight.ERROR_MESSAGE_OFFSET, message);

        return this;
    }

    /**
     * Append the error message to an `Appendable`.
     *
     * @param appendable to append the error message to.
     * @return the number of bytes in the message.
     */
    public appendMessage(appendable: Appendable): number {
        return this.buffer.getStringAscii(
            this.offset + PublicationErrorFrameFlyweight.ERROR_MESSAGE_OFFSET,
            appendable,
        );
    }

    /**
     * Length of the message in bytes.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return (
            PublicationErrorFrameFlyweight.ERROR_MESSAGE_OFFSET +
            BitUtil.SIZE_OF_INT +
            this.buffer.getInt(this.offset + PublicationErrorFrameFlyweight.ERROR_MESSAGE_OFFSET)
        );
    }
}
