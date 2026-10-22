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
// Port of org/agrona/concurrent/errors/LoggingErrorHandler.java @ Agrona 2.6.1
import type { ErrorHandler } from '../../ErrorHandler.js';
import type { AutoCloseable } from '../../jdkLang.js';
import { requireNonNull } from '../../jdkLang.js';
import { printStackTrace, SystemErr, type PrintStream } from '../../jdkThrowable.js';
import type { DistinctErrorLog } from './DistinctErrorLog.js';

/**
 * A logging {@link ErrorHandler} that records to a {@link DistinctErrorLog} and if the log is full then overflows
 * to a {@link PrintStream}. If closed then error will be sent to {@link LoggingErrorHandler.errorOverflow}.
 * <p>
 * The {@code PrintStream} is anything with a {@code println(line)} method (the {@code jdkThrowable} stand-in); the
 * default, {@code System.err}, is {@code console.error}.
 */
export class LoggingErrorHandler implements ErrorHandler, AutoCloseable {
    private closed = false;
    private readonly log: DistinctErrorLog;
    private readonly _errorOverflow: PrintStream;

    /**
     * Construct error handler wrapping a {@link DistinctErrorLog} and {@link PrintStream} for error overflow, with a
     * default of {@code System.err} for the {@link LoggingErrorHandler.errorOverflow}.
     *
     * @param log           to wrap.
     * @param errorOverflow to be used if the log fills.
     */
    public constructor(log: DistinctErrorLog, errorOverflow: PrintStream = SystemErr) {
        requireNonNull(log, 'log');
        // Java checks `log` twice (`Objects.requireNonNull(log, "errorOverflow")`): the overflow is not checked there.

        this.log = log;
        this._errorOverflow = errorOverflow;
    }

    /**
     * Close error handler so that is does not attempt to write to underlying storage which may be unmapped.
     */
    public close(): void {
        this.closed = true;
    }

    /**
     * Is this {@link LoggingErrorHandler} closed.
     *
     * @return true if {@link LoggingErrorHandler.close} has been called otherwise false.
     */
    public isClosed(): boolean {
        return this.closed;
    }

    /**
     * The wrapped log.
     *
     * @return the wrapped log.
     */
    public distinctErrorLog(): DistinctErrorLog {
        return this.log;
    }

    /**
     * The wrapped {@link PrintStream} for error log overflow when the log is full.
     *
     * @return wrapped {@link PrintStream} for error log overflow when the log is full.
     */
    public errorOverflow(): PrintStream {
        return this._errorOverflow;
    }

    public onError(throwable: Error): void {
        if (this.closed) {
            this._errorOverflow.println('error log is closed');
            printStackTrace(throwable, this._errorOverflow);
        } else if (!this.log.record(throwable)) {
            this._errorOverflow.println('error log is full, consider increasing length of error buffer');
            printStackTrace(throwable, this._errorOverflow);
        }
    }
}
