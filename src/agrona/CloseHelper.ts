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
// Port of org/agrona/CloseHelper.java @ Agrona 2.6.1
import type { ErrorHandler } from './ErrorHandler.js';
import { addSuppressed, NullPointerException } from './jdk.js';
import type { AutoCloseable } from './jdkLang.js';
import { LangUtil } from './LangUtil.js';

type Closeables = (AutoCloseable | Iterable<AutoCloseable | null | undefined> | null | undefined)[];

/**
 * Helper functions for safely closing resources.
 * <p>
 * Java's overloads over a {@code Collection} and over varargs are one function that takes the closeables, or a
 * collection of them: {@code closeAll(a, b)} and {@code closeAll([a, b])} do the same. A {@code null} or
 * {@code undefined} closeable is skipped, as is a null collection. {@code close(errorHandler, closeable)} is told
 * from {@code close(closeable)} by its two arguments. Java's {@code closeAll(ErrorHandler, ...)} is
 * {@link closeAllWith}: Java picks the overload by the static type of the first argument, which an object that is
 * both an {@link ErrorHandler} and an {@link AutoCloseable} (a {@code CountedErrorHandler}, a context) makes
 * ambiguous at run time, so the two are separate entry points (spec D120).
 */
export class CloseHelper {
    private constructor() {}

    /**
     * Quietly close a {@link AutoCloseable} dealing with nulls and exceptions doing so.
     * <p>
     * This implementation catches all exceptions from {@link AutoCloseable.close} and ignores them.
     *
     * @param closeable to be closed.
     */
    public static quietClose(closeable: AutoCloseable | null | undefined): void {
        if (null !== closeable && undefined !== closeable) {
            try {
                closeable.close();
            } catch {
                // ignore
            }
        }
    }

    /**
     * Quietly close a collection of {@link AutoCloseable}s, or the closeables given as arguments, dealing with nulls
     * and exceptions doing so. Every closeable is attempted.
     *
     * @param closeables to be closed.
     */
    public static quietCloseAll(...closeables: Closeables): void {
        for (const closeable of CloseHelper.flatten(closeables)) {
            if (null !== closeable && undefined !== closeable) {
                try {
                    closeable.close();
                } catch {
                    // ignore
                }
            }
        }
    }

    /**
     * Close a {@link AutoCloseable} dealing with nulls and exceptions doing so.
     * <p>
     * The exception is rethrown.
     *
     * @param closeable to be closed.
     */
    public static close(closeable: AutoCloseable | null | undefined): void;

    /**
     * Close a {@link AutoCloseable} dealing with nulls and exceptions doing so.
     * <p>
     * The exception is passed to the {@link ErrorHandler}. If the handler is null, a
     * {@link NullPointerException} is thrown with the exception suppressed in it.
     *
     * @param errorHandler to which an exception is passed.
     * @param closeable    to be closed.
     */
    public static close(
        errorHandler: ErrorHandler | null | undefined,
        closeable: AutoCloseable | null | undefined,
    ): void;

    public static close(arg0: unknown, ...rest: unknown[]): void {
        if (0 === rest.length) {
            const closeable = arg0 as AutoCloseable | null | undefined;
            if (null !== closeable && undefined !== closeable) {
                try {
                    closeable.close();
                } catch (ex) {
                    LangUtil.rethrowUnchecked(ex as Error);
                }
            }
        } else {
            const errorHandler = arg0 as ErrorHandler | null | undefined;
            const closeable = rest[0] as AutoCloseable | null | undefined;
            if (null !== closeable && undefined !== closeable) {
                try {
                    closeable.close();
                } catch (ex) {
                    if (null === errorHandler || undefined === errorHandler) {
                        const error = new NullPointerException('errorHandler is null');
                        error.addSuppressed(ex as Error);
                        throw error;
                    }

                    errorHandler.onError(ex as Error);
                }
            }
        }
    }

    /**
     * Close all closeables in a collection, or given as arguments, dealing with nulls and exceptions. Every closeable
     * is attempted. The first exception is rethrown after all have been closed, with the others added to it as
     * suppressed.
     *
     * @param closeables to be closed.
     */
    public static closeAll(...closeables: Closeables): void {
        let error: Error | null = null;
        for (const closeable of CloseHelper.flatten(closeables)) {
            if (null !== closeable && undefined !== closeable) {
                try {
                    closeable.close();
                } catch (ex) {
                    if (null === error) {
                        error = ex as Error;
                    } else {
                        addSuppressed(error, ex as Error);
                    }
                }
            }
        }

        if (null !== error) {
            LangUtil.rethrowUnchecked(error);
        }
    }

    /**
     * Close all closeables in a collection, or given as arguments, dealing with nulls and exceptions. Every
     * closeable is attempted. Each exception is passed to the {@link ErrorHandler}. If the handler is null, a
     * {@link NullPointerException} with the exceptions suppressed in it is thrown after all have been closed.
     * <p>
     * Java's {@code closeAll(ErrorHandler, ...)}, a separate entry point so that an argument that is an
     * {@link ErrorHandler} and an {@link AutoCloseable} is never taken for the other (spec D120).
     *
     * @param errorHandler to which exceptions are passed.
     * @param closeables   to be closed.
     */
    public static closeAllWith(errorHandler: ErrorHandler | null | undefined, ...closeables: Closeables): void {
        let error: NullPointerException | null = null;
        for (const closeable of CloseHelper.flatten(closeables)) {
            if (null !== closeable && undefined !== closeable) {
                try {
                    closeable.close();
                } catch (ex) {
                    if (null !== errorHandler && undefined !== errorHandler) {
                        errorHandler.onError(ex as Error);
                    } else if (null === error) {
                        error = new NullPointerException('errorHandler is null');
                        error.addSuppressed(ex as Error);
                    } else {
                        error.addSuppressed(ex as Error);
                    }
                }
            }
        }

        if (null !== error) {
            throw error;
        }
    }

    /**
     * The closeables of a call: the arguments, with a collection given as an argument expanded in place. A null
     * collection contributes nothing.
     */
    private static flatten(closeables: Closeables): (AutoCloseable | null | undefined)[] {
        const result: (AutoCloseable | null | undefined)[] = [];
        for (const item of closeables) {
            if (null === item || undefined === item) {
                result.push(item);
            } else if ('function' === typeof (item as Iterable<unknown>)[Symbol.iterator]) {
                for (const closeable of item as Iterable<AutoCloseable | null | undefined>) {
                    result.push(closeable);
                }
            } else {
                result.push(item as AutoCloseable);
            }
        }

        return result;
    }
}
