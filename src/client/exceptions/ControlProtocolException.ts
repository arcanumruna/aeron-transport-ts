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
// Port of io/aeron/exceptions/ControlProtocolException.java @ 1.53.3
import { ErrorCode } from '../ErrorCode.js';
import { AeronException, Category } from './AeronException.js';

/**
 * Indicates an invalid use of the control protocol when sending commands from the client to driver.
 */
export class ControlProtocolException extends AeronException {
    /**
     * The {@link ErrorCode} indicating more specific issue experienced by the media driver.
     */
    private readonly code: ErrorCode;

    /**
     * Construct an exception to indicate an invalid command has been sent to the media driver.
     *
     * @param code for the type of error.
     * @param msg  providing more detail.
     */
    public constructor(code: ErrorCode, msg: string);
    /**
     * Construct an exception to indicate an invalid command has been sent to the media driver.
     *
     * @param code      for the type of error.
     * @param rootCause of the error.
     */
    public constructor(code: ErrorCode, rootCause: Error);
    /**
     * Construct an exception to indicate an invalid command has been sent to the media driver.
     *
     * @param code      for the type of error.
     * @param msg       providing more detail.
     * @param rootCause of the error.
     */
    public constructor(code: ErrorCode, msg: string, rootCause: Error);
    public constructor(code: ErrorCode, msgOrCause: string | Error, rootCause?: Error) {
        const category = ControlProtocolException.errorToCategory(code);
        super(...(ControlProtocolException.superArgs(msgOrCause, rootCause, category) as [string, Error, Category]));
        this.code = code;
    }

    /**
     * The {@link ErrorCode} indicating more specific issue experienced by the media driver.
     *
     * @return the {@link ErrorCode} indicating more specific issue experienced by the media driver.
     */
    public errorCode(): ErrorCode {
        return this.code;
    }

    /**
     * Package-private in Java: used by {@link RegistrationException}.
     *
     * @param errorCode to map.
     * @return the {@link Category} for the code.
     */
    public static errorToCategory(errorCode: ErrorCode): Category {
        return ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE === errorCode ? Category.WARN : Category.ERROR;
    }

    private static superArgs(msgOrCause: string | Error, rootCause: Error | undefined, category: Category): unknown[] {
        if (undefined === rootCause) {
            return [msgOrCause, category];
        }

        return [msgOrCause, rootCause, category];
    }
}
