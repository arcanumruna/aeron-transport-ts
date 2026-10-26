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
// Port of io/aeron/ErrorCode.java @ 1.53.3
import { AeronException } from './exceptions/AeronException.js';

/**
 * Error codes between the client and the media driver, as the Java enum `ErrorCode`: the constants keep their
 * ordinal order and `value()` is the code on the wire.
 */
export class ErrorCode {
    private static nextOrdinal = 0;

    /**
     * Old generic value, no longer used (0 value clashes with success). Retained for version compatibility.
     */
    public static readonly UNUSED: ErrorCode = new ErrorCode('UNUSED', 0);

    /**
     * A failure occurred creating a new channel or parsing the channel string.
     */
    public static readonly INVALID_CHANNEL: ErrorCode = new ErrorCode('INVALID_CHANNEL', 1);

    /**
     * Attempted to reference a subscription, but it was not found.
     */
    public static readonly UNKNOWN_SUBSCRIPTION: ErrorCode = new ErrorCode('UNKNOWN_SUBSCRIPTION', 2);

    /**
     * Attempted to reference a publication, but it was not found.
     */
    public static readonly UNKNOWN_PUBLICATION: ErrorCode = new ErrorCode('UNKNOWN_PUBLICATION', 3);

    /**
     * Channel Endpoint could not be successfully opened.
     */
    public static readonly CHANNEL_ENDPOINT_ERROR: ErrorCode = new ErrorCode('CHANNEL_ENDPOINT_ERROR', 4);

    /**
     * Attempted to reference a counter, but it was not found.
     */
    public static readonly UNKNOWN_COUNTER: ErrorCode = new ErrorCode('UNKNOWN_COUNTER', 5);

    /**
     * Attempted to send a command unknown by the driver.
     */
    public static readonly UNKNOWN_COMMAND_TYPE_ID: ErrorCode = new ErrorCode('UNKNOWN_COMMAND_TYPE_ID', 6);

    /**
     * Attempted to send a command that is malformed. Typically, too short.
     */
    public static readonly MALFORMED_COMMAND: ErrorCode = new ErrorCode('MALFORMED_COMMAND', 7);

    /**
     * Attempted to send a command known by the driver, but not currently supported.
     */
    public static readonly NOT_SUPPORTED: ErrorCode = new ErrorCode('NOT_SUPPORTED', 8);

    /**
     * Attempted to send a command that had a hostname that could not be resolved.
     */
    public static readonly UNKNOWN_HOST: ErrorCode = new ErrorCode('UNKNOWN_HOST', 9);

    /**
     * Attempted to send a command that referred to a resource that currently was unavailable.
     */
    public static readonly RESOURCE_TEMPORARILY_UNAVAILABLE: ErrorCode = new ErrorCode(
        'RESOURCE_TEMPORARILY_UNAVAILABLE',
        10,
    );

    /**
     * Aeron encountered an error condition.
     */
    public static readonly GENERIC_ERROR: ErrorCode = new ErrorCode('GENERIC_ERROR', 11);

    /**
     * Aeron encountered insufficient storage space while adding a resource.
     */
    public static readonly STORAGE_SPACE: ErrorCode = new ErrorCode('STORAGE_SPACE', 12);

    /**
     * An image was rejected.
     */
    public static readonly IMAGE_REJECTED: ErrorCode = new ErrorCode('IMAGE_REJECTED', 13);

    /**
     * A publication was revoked.
     */
    public static readonly PUBLICATION_REVOKED: ErrorCode = new ErrorCode('PUBLICATION_REVOKED', 14);

    // *** Insert new codes above here.

    /**
     * A code value returned was not known.
     */
    public static readonly UNKNOWN_CODE_VALUE: ErrorCode = new ErrorCode('UNKNOWN_CODE_VALUE', -1);

    static readonly ERROR_CODES: ErrorCode[] = ErrorCode.newErrorCodes();

    private readonly _name: string;
    private readonly _ordinal: number = 0;
    private readonly _value: number = 0;

    private constructor(name: string, value: number) {
        this._name = name;
        this._ordinal = ErrorCode.nextOrdinal++;
        this._value = value;
    }

    /**
     * The constants of the enum in ordinal order.
     *
     * @return a new array of the constants.
     */
    public static values(): ErrorCode[] {
        return [
            ErrorCode.UNUSED,
            ErrorCode.INVALID_CHANNEL,
            ErrorCode.UNKNOWN_SUBSCRIPTION,
            ErrorCode.UNKNOWN_PUBLICATION,
            ErrorCode.CHANNEL_ENDPOINT_ERROR,
            ErrorCode.UNKNOWN_COUNTER,
            ErrorCode.UNKNOWN_COMMAND_TYPE_ID,
            ErrorCode.MALFORMED_COMMAND,
            ErrorCode.NOT_SUPPORTED,
            ErrorCode.UNKNOWN_HOST,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            ErrorCode.GENERIC_ERROR,
            ErrorCode.STORAGE_SPACE,
            ErrorCode.IMAGE_REJECTED,
            ErrorCode.PUBLICATION_REVOKED,
            ErrorCode.UNKNOWN_CODE_VALUE,
        ];
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }

    /**
     * Get the value of this ErrorCode.
     *
     * @return The value.
     */
    public value(): number {
        return this._value;
    }

    private static newErrorCodes(): ErrorCode[] {
        const errorCodes = ErrorCode.values();
        const byValue = new Array<ErrorCode>(errorCodes.length);

        for (const errorCode of errorCodes) {
            const value = errorCode._value;

            if (value === ErrorCode.UNKNOWN_CODE_VALUE._value) {
                continue;
            }

            if (undefined !== byValue[value]) {
                throw new AeronException('value already in use: ' + value);
            }

            byValue[value] = errorCode;
        }

        return byValue;
    }

    /**
     * Get the ErrorCode that corresponds to the given value.
     *
     * @param value of the ErrorCode
     * @return ErrorCode
     */
    public static get(value: number): ErrorCode {
        if (0 <= value && value <= ErrorCode.ERROR_CODES.length - 2) {
            return ErrorCode.ERROR_CODES[value]!;
        }

        return ErrorCode.UNKNOWN_CODE_VALUE;
    }
}
