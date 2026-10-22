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
// Port of io/aeron/exceptions/RegistrationException.java @ 1.53.3
import type { ErrorCode } from '../ErrorCode.js';
import { AeronException } from './AeronException.js';
import { ControlProtocolException } from './ControlProtocolException.js';

/**
 * Caused when an error occurs during addition, modification, or release of client resources such as
 * Publications, Subscriptions, or Counters.
 */
export class RegistrationException extends AeronException {
    /**
     * The correlation id of the command to register the resource action. A `bigint`: an opaque 64-bit wire value
     * (spec 5.2).
     */
    private readonly _correlationId: bigint;

    /**
     * Value of the {@link errorCode} encoded as an int.
     */
    private readonly _errorCodeValue: number;

    /**
     * The {@link ErrorCode} for the specific exception.
     */
    private readonly _errorCode: ErrorCode;

    /**
     * Construct an exception to represent an error which occurred during registration of a resource such as a
     * Publication, Subscription, or Counter.
     *
     * @param correlationId  of the command to register the resource.
     * @param errorCodeValue in case the {@link ErrorCode} is unknown to the client version.
     * @param errorCode      indicating type of error experienced by the media driver.
     * @param msg            proving more detail.
     */
    public constructor(correlationId: bigint, errorCodeValue: number, errorCode: ErrorCode, msg: string);
    /**
     * Construct a from another to be nested, useful when exceptions are reported asynchronously and need to be
     * rethrown from other places in the code.
     *
     * @param cause original RegistrationException to be stored as the exception cause.
     */
    public constructor(cause: RegistrationException);
    public constructor(
        correlationIdOrCause: bigint | RegistrationException,
        errorCodeValue?: number,
        errorCode?: ErrorCode,
        msg?: string,
    ) {
        if (correlationIdOrCause instanceof RegistrationException) {
            const cause = correlationIdOrCause;
            super(RegistrationException.stripCategoryName(cause.message), cause, cause.category());
            this._correlationId = cause._correlationId;
            this._errorCode = cause._errorCode;
            this._errorCodeValue = cause._errorCodeValue;
        } else {
            super(
                RegistrationException.stripCategoryName(msg!) + ', errorCodeValue=' + errorCodeValue!,
                ControlProtocolException.errorToCategory(errorCode!),
            );
            this._correlationId = correlationIdOrCause;
            this._errorCode = errorCode!;
            this._errorCodeValue = errorCodeValue!;
        }
    }

    /**
     * Get the correlation id of the command to register the resource action.
     *
     * @return the correlation id of the command to register the resource action.
     */
    public correlationId(): bigint {
        return this._correlationId;
    }

    /**
     * Get the {@link ErrorCode} for the specific exception.
     *
     * @return the {@link ErrorCode} for the specific exception.
     */
    public errorCode(): ErrorCode {
        return this._errorCode;
    }

    /**
     * Value of the {@link errorCode} encoded as an int. This can provide additional information when a
     * {@link ErrorCode.UNKNOWN_CODE_VALUE} is returned.
     *
     * @return value of the errorCode encoded as an int.
     */
    public errorCodeValue(): number {
        return this._errorCodeValue;
    }

    private static stripCategoryName(msg: string): string {
        if (null != msg && msg.length > 7) {
            if (msg.startsWith('ERROR - ') || msg.startsWith('FATAL - ')) {
                return msg.substring(8);
            }

            if (msg.startsWith('WARN - ')) {
                return msg.substring(7);
            }
        }

        return msg;
    }
}
