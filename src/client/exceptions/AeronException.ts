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
// Port of io/aeron/exceptions/AeronException.java @ 1.53.3
import { RuntimeException } from '../../agrona/jdk.js';

/**
 * Category of {@link AeronException}: the nested Java enum `AeronException.Category`, also reachable as
 * `AeronException.Category`.
 */
export class Category {
    private static nextOrdinal = 0;

    /**
     * Exception indicates a fatal condition. Recommendation is to terminate process immediately to avoid
     * state corruption.
     */
    public static readonly FATAL: Category = new Category('FATAL');

    /**
     * Exception is an error. Corrective action is recommended if understood, otherwise treat as fatal.
     */
    public static readonly ERROR: Category = new Category('ERROR');

    /**
     * Exception is a warning. Action has been, or will be, taken to handle the condition.
     * Additional corrective action by the application may be needed.
     */
    public static readonly WARN: Category = new Category('WARN');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = Category.nextOrdinal++;
    }

    public static values(): Category[] {
        return [Category.FATAL, Category.ERROR, Category.WARN];
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
}

type CategoryType = Category;

/**
 * Base Aeron exception for catching all Aeron specific errors.
 * <p>
 * The Java constructors with `enableSuppression` and `writableStackTrace` are accepted and the two flags ignored:
 * JS has no suppression switch and the stack of an `Error` is always writable.
 */
export class AeronException extends RuntimeException {
    /**
     * The nested enum `AeronException.Category`.
     */
    public static readonly Category = Category;

    /**
     * {@link Category} of the exception to help the client decide how they should proceed.
     */
    private readonly _category: Category;

    /**
     * Default Aeron exception as {@link Category.ERROR}.
     */
    public constructor();
    /**
     * Default Aeron exception with provided {@link Category}.
     *
     * @param category of this exception.
     */
    public constructor(category: Category);
    /**
     * Aeron exception with provided message and {@link Category.ERROR}.
     *
     * @param message to detail the exception.
     */
    public constructor(message: string);
    /**
     * Aeron exception with provided cause and {@link Category.ERROR}.
     *
     * @param cause of the error.
     */
    public constructor(cause: Error | null);
    /**
     * Aeron exception with a detailed message and provided {@link Category}.
     *
     * @param message  providing detail on the error.
     * @param category of the exception.
     */
    public constructor(message: string, category: Category);
    /**
     * Aeron exception with a detailed message, cause, and {@link Category.ERROR}.
     *
     * @param message providing detail on the error.
     * @param cause   of the error.
     */
    public constructor(message: string, cause: Error | null);
    /**
     * Aeron exception with cause and provided {@link Category}.
     *
     * @param cause    of the error.
     * @param category of the exception.
     */
    public constructor(cause: Error | null, category: Category);
    /**
     * Aeron exception with a detailed message, cause, and {@link Category}.
     *
     * @param message  providing detail on the error.
     * @param cause    of the error.
     * @param category of the exception.
     */
    public constructor(message: string, cause: Error | null, category: Category);
    /**
     * Constructs a new Aeron exception with a detail message, cause, suppression enabled or disabled,
     * and writable stack trace enabled or disabled, in the category {@link Category.ERROR}.
     *
     * @param message            providing detail on the error.
     * @param cause              of the error.
     * @param enableSuppression  is suppression enabled or not.
     * @param writableStackTrace is the stack trace writable or not.
     */
    public constructor(message: string, cause: Error | null, enableSuppression: boolean, writableStackTrace: boolean);
    /**
     * Constructs a new Aeron exception with a detail message, cause, suppression enabled or disabled,
     * writable stack trace enabled or disabled, an {@link Category}.
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
        // The message is "<category> - <message>" when one is given; a bare cause gives Throwable(cause)'s message.
        const last = args[args.length - 1];
        const category = last instanceof Category ? last : Category.ERROR;
        const first = args[0];
        const cause = typeof first === 'string' ? args[1] : first;
        super(
            typeof first === 'string'
                ? category.name() + ' - ' + first
                : first instanceof Error
                  ? first.toString()
                  : undefined,
            cause instanceof Error ? { cause } : undefined,
        );
        this._category = category;
    }

    /**
     * {@link Category} of exception for determining what follow-up action can be taken.
     *
     * @return {@link Category} of exception for determining what follow-up action can be taken.
     */
    public category(): Category {
        return this._category;
    }

    /**
     * Determines if a {@link Error} is a {@link Category.FATAL} if an {@link AeronException}.
     *
     * @param t throwable to check if fatal.
     * @return true if this is an AeronException with a category set to {@link Category.FATAL},
     * false otherwise.
     */
    public static isFatal(t: Error): boolean {
        return t instanceof AeronException && Category.FATAL === t._category;
    }
}

// Declaration merging: `AeronException.Category` is a type as well as a value, as the nested Java enum is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AeronException {
    export type Category = CategoryType;
}
