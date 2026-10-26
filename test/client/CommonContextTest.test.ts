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
// Port of io/aeron/CommonContextTest.java @ 1.53.3
import { describe, expect, it, vi } from 'vitest';
import { LoggingErrorHandler } from '../../src/agrona/concurrent/errors/LoggingErrorHandler.js';
import { DistinctErrorLog } from '../../src/agrona/concurrent/errors/DistinctErrorLog.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { JavaError, System } from '../../src/agrona/jdkLang.js';
import { SystemErr, SystemOut, throwableToString } from '../../src/agrona/jdkThrowable.js';
import type { PrintStream } from '../../src/agrona/jdkThrowable.js';
import { CommonContext } from '../../src/client/CommonContext.js';
import { ConcurrentConcludeException } from '../../src/client/exceptions/ConcurrentConcludeException.js';
import { InOrder } from '../support/InOrder.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';
import { mock } from '../support/Mockito.js';

const { FALLBACK_LOGGER_PROP_NAME } = CommonContext;

/** `java.lang.AssertionError`, the error that the user error handler throws. */
class AssertionError extends JavaError {}

describe('CommonContextTest', () => {
    it('shouldNotAllowConcludeMoreThanOnce', () => {
        const ctx = new CommonContext();
        ctx.conclude();

        assertThrows(ConcurrentConcludeException, () => ctx.conclude());
    });

    it('setupErrorHandlerReturnsALoggingErrorHandlerInstanceIfNoUserErrorHandlerSupplied', () => {
        const distinctErrorLog = mock(DistinctErrorLog).mock;

        const errorHandler = CommonContext.setupErrorHandler(null, distinctErrorLog);

        expect(errorHandler).not.toBeNull();
        expect(errorHandler).toBeInstanceOf(LoggingErrorHandler);
        const loggingErrorHandler = errorHandler as LoggingErrorHandler;
        expect(loggingErrorHandler.distinctErrorLog()).toBe(distinctErrorLog);
        expect(loggingErrorHandler.errorOverflow()).toBe(SystemErr);
    });

    it('setupErrorHandlerUsesAFallBackLoggingHandlerForTheOverflow', () => {
        System.setProperty(FALLBACK_LOGGER_PROP_NAME, 'no_op');
        try {
            const distinctErrorLog = mock(DistinctErrorLog).mock;

            const errorHandler = CommonContext.setupErrorHandler(null, distinctErrorLog);

            expect(errorHandler).not.toBeNull();
            expect(errorHandler).toBeInstanceOf(LoggingErrorHandler);
            const loggingErrorHandler = errorHandler as LoggingErrorHandler;
            expect(loggingErrorHandler.distinctErrorLog()).toBe(distinctErrorLog);
            expect(loggingErrorHandler.errorOverflow()).toBe(CommonContext.fallbackLogger());
        } finally {
            System.clearProperty(FALLBACK_LOGGER_PROP_NAME);
        }
    });

    it('setupErrorHandlerReturnsAnErrorHandlerThatFirstInvokesLoggingErrorHandlerBeforeCallingSuppliedErrorHandler', () => {
        const throwable = new Error('Hello, world!');
        const userHandlerError = new AssertionError('user handler error');
        const userErrorHandler: ErrorHandler = {
            onError: vi.fn((_: Error) => {
                throw userHandlerError;
            }),
        };
        const distinctErrorLog = mock(DistinctErrorLog).mock;
        vi.mocked(distinctErrorLog.record).mockReturnValue(true);
        const inOrder = new InOrder(userErrorHandler, distinctErrorLog);

        const errorHandler = CommonContext.setupErrorHandler(userErrorHandler, distinctErrorLog);

        expect(errorHandler).not.toBeNull();
        expect(errorHandler).not.toBe(userErrorHandler);

        const error = assertThrowsExactly(AssertionError, () => errorHandler.onError(throwable));
        expect(error).toBe(userHandlerError);

        inOrder.verify(distinctErrorLog.record, 1, throwable);
        inOrder.verify(userErrorHandler.onError, 1, throwable);
        inOrder.verifyNoMoreInteractions();
    });

    it('setupErrorHandlerShouldCloseUserErrorHandlerAfterClosingTheLoggingErrorHandler', () => {
        // Java mocks the Throwable and verifies printStackTrace(fallbackErrorStream); a JS error is printed through
        // the stream, line by line (spec D18), so the first line is the toString of the error
        const throwable = new Error('stack trace');
        const userErrorHandler = {
            onError: vi.fn((_: Error) => {}),
            close: vi.fn(() => {
                throw new Error('failed to close');
            }),
        };
        const distinctErrorLog = mock(DistinctErrorLog).mock;
        vi.mocked(distinctErrorLog.record).mockReturnValue(true);
        const fallbackErrorStream: PrintStream = { println: vi.fn((_: string) => {}) };

        const inOrder = new InOrder(userErrorHandler, distinctErrorLog, fallbackErrorStream);

        const errorHandler = CommonContext.setupErrorHandler(userErrorHandler, distinctErrorLog, fallbackErrorStream);
        expect(typeof (errorHandler as unknown as { close?: unknown }).close).toBe('function');

        (errorHandler as unknown as { close(): void }).close();

        errorHandler.onError(throwable);

        inOrder.verify(userErrorHandler.close, 1);
        inOrder.verify(fallbackErrorStream.println, 1, 'error log is closed');
        inOrder.verify(fallbackErrorStream.println, 1, throwableToString(throwable));
        inOrder.verify(userErrorHandler.onError, 1, throwable);
        // the lines of the stack trace after the first are printed to the stream before the user handler is called
        expect(vi.mocked(fallbackErrorStream.println).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Needs the file system: `saveExistingErrors` writes the errors of an old error log next to its mark file (spec D4).
    it.skip('saveExistingErrorsIsANoOpIfErrorBufferIsEmpty', () => {});

    it.skip('saveExistingErrorsCreatesErrorFileInTheSameDirectoryAsTheCorrespondingMarkFile', () => {});

    it('fallbackLoggerReturnsSystemErrorIfNothingSpecified', () => {
        System.clearProperty(FALLBACK_LOGGER_PROP_NAME);
        expect(CommonContext.fallbackLogger()).toBe(SystemErr);
    });

    it.each(['', 'stderr', 'gaga'])('fallbackLoggerReturnsSystemError "%s"', (logger) => {
        System.setProperty(FALLBACK_LOGGER_PROP_NAME, logger);
        try {
            expect(CommonContext.fallbackLogger()).toBe(SystemErr);
        } finally {
            System.clearProperty(FALLBACK_LOGGER_PROP_NAME);
        }
    });

    it('fallbackLoggerReturnsSystemOutIfConfigured', () => {
        System.setProperty(FALLBACK_LOGGER_PROP_NAME, 'stdout');
        try {
            expect(CommonContext.fallbackLogger()).toBe(SystemOut);
        } finally {
            System.clearProperty(FALLBACK_LOGGER_PROP_NAME);
        }
    });

    it('fallbackLoggerReturnsNoOpLoggerIfConfigured', () => {
        System.setProperty(FALLBACK_LOGGER_PROP_NAME, 'no_op');
        try {
            const logger = CommonContext.fallbackLogger();
            expect(logger).not.toBeNull();
            expect(logger).not.toBe(SystemErr);
            expect(logger).not.toBe(SystemOut);
            expect(CommonContext.fallbackLogger()).toBe(logger);
        } finally {
            System.clearProperty(FALLBACK_LOGGER_PROP_NAME);
        }
    });

    // The Aeron directory is not ported (spec D4): no `aeronDirectoryName`, `aeronDirectory` or `concludeAeronDirectory`.
    it.skip('shouldConcludeAeronDirectory', () => {});

    it.skip('shouldCanonicalizeAeronDirectoryPath', () => {});
});
