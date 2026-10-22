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
// Port of io/aeron/driver/exceptions/InvalidChannelException.java @ 1.53.3
import { ErrorCode } from '../../client/ErrorCode.js';
import { ControlProtocolException } from '../../client/exceptions/ControlProtocolException.js';

export class InvalidChannelException extends ControlProtocolException {
    /**
     * Exception with provided message and {@link ErrorCode#INVALID_CHANNEL}.
     *
     * @param message to detail the exception.
     */
    public constructor(message: string);
    /**
     * Exception with provided cause and {@link ErrorCode#INVALID_CHANNEL}.
     *
     * @param cause of the exception.
     */
    public constructor(cause: Error);
    /**
     * Exception with provided message, cause and {@link ErrorCode#INVALID_CHANNEL}.
     *
     * @param message to detail the exception.
     * @param cause   of the exception.
     */
    public constructor(message: string, cause: Error);
    public constructor(messageOrCause: string | Error, cause?: Error) {
        if (undefined !== cause) {
            super(ErrorCode.INVALID_CHANNEL, messageOrCause as string, cause);
        } else if (typeof messageOrCause === 'string') {
            super(ErrorCode.INVALID_CHANNEL, messageOrCause);
        } else {
            super(ErrorCode.INVALID_CHANNEL, messageOrCause);
        }
    }
}
