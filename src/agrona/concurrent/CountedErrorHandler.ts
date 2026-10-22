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
// Port of org/agrona/concurrent/CountedErrorHandler.java @ Agrona 2.6.1
import type { ErrorHandler } from '../ErrorHandler.js';
import { requireNonNull, type AutoCloseable } from '../jdkLang.js';
import { printStackTrace, SystemErr } from '../jdkThrowable.js';
import type { AtomicCounter } from './status/AtomicCounter.js';

/**
 * An {@link ErrorHandler} which calls {@link AtomicCounter.increment} before delegating the exception.
 */
export class CountedErrorHandler implements ErrorHandler, AutoCloseable {
    private readonly errorHandler: ErrorHandler;
    private readonly errorCounter: AtomicCounter;
    private closed = false;

    /**
     * Construct a counted error handler with a delegate and counter.
     *
     * @param errorHandler to delegate to.
     * @param errorCounter to increment before delegation.
     */
    public constructor(errorHandler: ErrorHandler, errorCounter: AtomicCounter) {
        requireNonNull(errorHandler, 'errorHandler');
        requireNonNull(errorCounter, 'errorCounter');

        this.errorHandler = errorHandler;
        this.errorCounter = errorCounter;
    }

    /**
     * Close so that {@link CountedErrorHandler.onError} will not delegate and instead print to {@code System.err}.
     */
    public close(): void {
        this.closed = true;
    }

    /**
     * Has this instance been closed.
     *
     * @return true if {@link CountedErrorHandler.close} has previously been called, otherwise false.
     */
    public isClosed(): boolean {
        return this.closed;
    }

    public onError(throwable: Error): void {
        if (this.closed) {
            printStackTrace(throwable, SystemErr);
        } else {
            if (!this.errorCounter.isClosed()) {
                this.errorCounter.increment();
            }

            this.errorHandler.onError(throwable);
        }
    }
}
