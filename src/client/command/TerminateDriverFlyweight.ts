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
// Port of io/aeron/command/TerminateDriverFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type DirectBuffer } from '../../agrona/DirectBuffer.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ErrorCode } from '../ErrorCode.js';
import { ConfigurationException } from '../exceptions/ConfigurationException.js';
import { ControlProtocolException } from '../exceptions/ControlProtocolException.js';
import { CorrelatedMessageFlyweight } from './CorrelatedMessageFlyweight.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { MALFORMED_COMMAND } = ErrorCode;

/**
 * Message to denote a request to terminate the driver.
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
 *  |                       Token Length                            |
 *  +---------------------------------------------------------------+
 *  |                       Token Buffer                           ...
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class TerminateDriverFlyweight extends CorrelatedMessageFlyweight {
    private static readonly TOKEN_LENGTH_OFFSET = CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Package-private in Java: the offset of the token buffer.
     */
    public static readonly TOKEN_BUFFER_OFFSET = TerminateDriverFlyweight.TOKEN_LENGTH_OFFSET + SIZE_OF_INT;

    private static readonly MINIMUM_LENGTH = TerminateDriverFlyweight.TOKEN_LENGTH_OFFSET + SIZE_OF_INT;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): TerminateDriverFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Offset in the message at which the token buffer begins.
     *
     * @return offset of the token buffer.
     */
    public tokenBufferOffset(): number {
        return TerminateDriverFlyweight.TOKEN_BUFFER_OFFSET;
    }

    /**
     * Length of the token buffer.
     *
     * @return length of the token buffer.
     */
    public tokenBufferLength(): number {
        return this.buffer.getInt(this.offset + TerminateDriverFlyweight.TOKEN_LENGTH_OFFSET);
    }

    /**
     * Set the token buffer.
     *
     * @param tokenBuffer containing the token, or `null` for none.
     * @param tokenOffset within the buffer at which the token begins.
     * @param tokenLength length of the token in bytes.
     * @return this for a fluent API.
     */
    public tokenBuffer(
        tokenBuffer: DirectBuffer | null,
        tokenOffset: number,
        tokenLength: number,
    ): TerminateDriverFlyweight {
        this.buffer.putInt(this.offset + TerminateDriverFlyweight.TOKEN_LENGTH_OFFSET, tokenLength);
        if (null !== tokenBuffer && tokenLength > 0) {
            this.buffer.putBytes(this.offset + this.tokenBufferOffset(), tokenBuffer, tokenOffset, tokenLength);
        }

        return this;
    }

    /**
     * Length of the message in bytes.
     *
     * @return length of the message in bytes.
     */
    public length(): number {
        return TerminateDriverFlyweight.TOKEN_BUFFER_OFFSET + this.tokenBufferLength();
    }

    /**
     * Validate that the length of the message is sufficient for the fields it has.
     *
     * @param msgTypeId type of the message, for the exception message.
     * @param length    of the message in bytes.
     * @throws ControlProtocolException if the length is too short.
     */
    public override validateLength(msgTypeId: number, length: number): void {
        if (length < TerminateDriverFlyweight.MINIMUM_LENGTH) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short: length=' + length,
            );
        }

        if (
            length - TerminateDriverFlyweight.MINIMUM_LENGTH <
            this.buffer.getInt(this.offset + TerminateDriverFlyweight.TOKEN_LENGTH_OFFSET)
        ) {
            throw new ControlProtocolException(
                MALFORMED_COMMAND,
                'command=' + msgTypeId + ' too short for token buffer: length=' + length,
            );
        }
    }

    /**
     * Compute the length of the message for a token of a given length.
     *
     * @param tokenLength length of the token in bytes.
     * @return length of the message in bytes.
     * @throws ConfigurationException if the token length is negative.
     */
    public static computeLength(tokenLength: number): number {
        if (tokenLength < 0) {
            throw new ConfigurationException('token length must be >= 0: ' + tokenLength);
        }

        return CorrelatedMessageFlyweight.LENGTH + SIZE_OF_INT + tokenLength;
    }
}
