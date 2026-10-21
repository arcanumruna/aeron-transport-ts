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
// Port of org/agrona/concurrent/AgentTerminationException.java @ Agrona 2.6.1
import { RuntimeException } from '../jdk.js';

/**
 * Exception to be thrown by an {@link Agent} when it wishes to terminate and have the runner or invoker close it.
 * <p>
 * The ten Java constructors are one constructor with overloads. `enableSuppression` and `writableStackTrace` have no
 * JS counterpart and are accepted and ignored.
 */
export class AgentTerminationException extends RuntimeException {
    private readonly _isExpected: boolean;

    /**
     * Constructs an exception that is not expected.
     */
    public constructor();

    /**
     * Constructs an exception with the {@code isExpected} flag.
     */
    public constructor(isExpected: boolean);

    /**
     * Constructs an exception with a message that is not expected.
     */
    public constructor(message: string);

    public constructor(message: string, isExpected: boolean);

    public constructor(message: string, cause: Error);

    public constructor(message: string, cause: Error, isExpected: boolean);

    public constructor(cause: Error);

    public constructor(cause: Error, isExpected: boolean);

    public constructor(message: string, cause: Error, enableSuppression: boolean, writableStackTrace: boolean);

    public constructor(
        message: string,
        cause: Error,
        isExpected: boolean,
        enableSuppression: boolean,
        writableStackTrace: boolean,
    );

    public constructor(
        arg0?: string | boolean | Error,
        arg1?: Error | boolean,
        arg2?: boolean,
        arg3?: boolean,
        arg4?: boolean,
    ) {
        let message: string | undefined;
        let cause: Error | undefined;
        let isExpected = false;

        if ('boolean' === typeof arg0) {
            isExpected = arg0;
        } else if ('string' === typeof arg0) {
            message = arg0;
            if ('boolean' === typeof arg1) {
                isExpected = arg1;
            } else if (undefined !== arg1) {
                cause = arg1;
                if (undefined !== arg2) {
                    if (undefined === arg3) {
                        isExpected = arg2;
                    } else if (undefined !== arg4) {
                        isExpected = arg2;
                    }
                    // else: (message, cause, enableSuppression, writableStackTrace) is not expected
                }
            }
        } else if (undefined !== arg0) {
            cause = arg0;
            if ('boolean' === typeof arg1) {
                isExpected = arg1;
            }
        }

        super(message, undefined === cause ? undefined : { cause });
        this._isExpected = isExpected;
    }

    /**
     * Is this an expected termination and so not to be reported as an error?
     *
     * @return {@code true} if the termination is expected.
     */
    public isExpected(): boolean {
        return this._isExpected;
    }
}
