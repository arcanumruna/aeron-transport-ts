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
// Port of io/aeron/exceptions/TimeoutException.java @ 1.53.3
import { AeronException, type Category } from './AeronException.js';

/**
 * Generic timeout has occurred while waiting on some action or event.
 */
export class TimeoutException extends AeronException {
    /**
     * Default timeout exception as {@link Category.ERROR}.
     */
    public constructor();
    /**
     * Timeout exception with provided message and {@link Category.ERROR}.
     *
     * @param message to detail the exception.
     */
    public constructor(message: string);
    /**
     * Timeout Aeron exception with provided {@link Category}.
     *
     * @param category of this exception.
     */
    public constructor(category: Category);
    /**
     * Timeout exception with a detailed message and provided {@link Category}.
     *
     * @param message  providing detail on the error.
     * @param category of the exception.
     */
    public constructor(message: string, category: Category);
    /**
     * Timeout exception with cause and provided {@link Category}.
     *
     * @param cause    of the error.
     * @param category of the exception.
     */
    public constructor(cause: Error | null, category: Category);
    /**
     * Timeout exception with a detailed message, cause, and {@link Category}.
     *
     * @param message  providing detail on the error.
     * @param cause    of the error.
     * @param category of the exception.
     */
    public constructor(message: string, cause: Error | null, category: Category);
    /**
     * Constructs a new timeout exception with the detail message, cause, suppression enabled or disabled,
     * writable stack trace enabled or disabled, an {@link Category}. Protected in Java.
     *
     * @param message            providing detail on the error.
     * @param cause              of the error.
     * @param enableSuppression  is suppression enabled or not.
     * @param writableStackTrace is the stack trace writable or not.
     * @param category           of the exception.
     */
    public constructor(
        message: string,
        cause: Error | null,
        enableSuppression: boolean,
        writableStackTrace: boolean,
        category: Category,
    );
    public constructor(...args: unknown[]) {
        // the overloads are those of AeronException, so the arguments pass straight through
        super(...(args as [string, Error | null, boolean, boolean, Category]));
    }
}
