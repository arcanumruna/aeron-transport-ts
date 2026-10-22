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
// Port of io/aeron/command/ErrorResponseFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type Appendable } from '../../agrona/jdk.js';
import { ErrorCode } from '../ErrorCode.js';

/**
 * Control message flyweight for any errors sent from driver to clients.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |              Offending Command Correlation ID                 |
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
export class ErrorResponseFlyweight {
    private static readonly OFFENDING_COMMAND_CORRELATION_ID_OFFSET = 0;
    private static readonly ERROR_CODE_OFFSET =
        ErrorResponseFlyweight.OFFENDING_COMMAND_CORRELATION_ID_OFFSET + BitUtil.SIZE_OF_LONG;
    private static readonly ERROR_MESSAGE_OFFSET = ErrorResponseFlyweight.ERROR_CODE_OFFSET + BitUtil.SIZE_OF_INT;

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
    public wrap(buffer: MutableDirectBuffer, offset: number): ErrorResponseFlyweight {
        this.buffer = buffer;
        this.offset = offset;

        return this;
    }

    /**
     * Get the correlation id of the command that was in error.
     *
     * @return correlation id of the command that was in error.
     */
    public offendingCommandCorrelationId(): number;
    /**
     * Set the correlation id of the command that was in error.
     *
     * @param correlationId of the command that was in error.
     * @return this for a fluent API.
     */
    public offendingCommandCorrelationId(correlationId: number): ErrorResponseFlyweight;
    public offendingCommandCorrelationId(correlationId?: number): number | ErrorResponseFlyweight {
        if (undefined === correlationId) {
            return this.buffer.getLong(this.offset + ErrorResponseFlyweight.OFFENDING_COMMAND_CORRELATION_ID_OFFSET);
        }

        this.buffer.putLong(
            this.offset + ErrorResponseFlyweight.OFFENDING_COMMAND_CORRELATION_ID_OFFSET,
            correlationId,
        );

        return this;
    }

    /**
     * Get the error code.
     *
     * @return error code for the command.
     */
    public errorCode(): ErrorCode;
    /**
     * Set the error code.
     *
     * @param code for the error.
     * @return this for a fluent API.
     */
    public errorCode(code: ErrorCode): ErrorResponseFlyweight;
    public errorCode(code?: ErrorCode): ErrorCode | ErrorResponseFlyweight {
        if (undefined === code) {
            return ErrorCode.get(this.buffer.getInt(this.offset + ErrorResponseFlyweight.ERROR_CODE_OFFSET));
        }

        this.buffer.putInt(this.offset + ErrorResponseFlyweight.ERROR_CODE_OFFSET, code.value());

        return this;
    }

    /**
     * Get the error code value as an `int`.
     *
     * @return error code value.
     */
    public errorCodeValue(): number {
        return this.buffer.getInt(this.offset + ErrorResponseFlyweight.ERROR_CODE_OFFSET);
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
    public errorMessage(message: string): ErrorResponseFlyweight;
    public errorMessage(message?: string): string | ErrorResponseFlyweight {
        if (undefined === message) {
            return this.buffer.getStringAscii(this.offset + ErrorResponseFlyweight.ERROR_MESSAGE_OFFSET);
        }

        this.buffer.putStringAscii(this.offset + ErrorResponseFlyweight.ERROR_MESSAGE_OFFSET, message);

        return this;
    }

    /**
     * Append the error message to an `Appendable`.
     *
     * @param appendable to append the error message to.
     * @return the number of bytes in the message.
     */
    public appendMessage(appendable: Appendable): number {
        return this.buffer.getStringAscii(this.offset + ErrorResponseFlyweight.ERROR_MESSAGE_OFFSET, appendable);
    }

    /**
     * Length of the message in bytes.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return (
            ErrorResponseFlyweight.ERROR_MESSAGE_OFFSET +
            BitUtil.SIZE_OF_INT +
            this.buffer.getInt(this.offset + ErrorResponseFlyweight.ERROR_MESSAGE_OFFSET)
        );
    }
}
