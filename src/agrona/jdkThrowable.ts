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
// JDK stand-ins for printing a Throwable (`Throwable.printStackTrace`, `Throwable.toString`, `PrintStream`,
// `System.err`) that the error log and the error handlers use (spec D10).
// Not part of Agrona: there is no Java file behind this one (see docs/mapping.md "Sources").

/**
 * The part of `java.io.PrintStream` (and of a `PrintWriter`) that printing a stack trace uses: one line at a time.
 */
export interface PrintStream {
    println(line: string): void;
}

/**
 * `System.err`: each line goes to `console.error`.
 */
export const SystemErr: PrintStream = {
    println(line: string): void {
        console.error(line);
    },
};

/**
 * `Throwable.toString()`: the class name, then `: ` and the message if there is one. The class name is the simple JS
 * name (spec D10): the `name` of an `Exception` is its class, a JS `Error` has the name of its type. A JS message of
 * `""` is Java's `null` message.
 */
export function throwableToString(error: Error): string {
    const name = error.name;
    const message = error.message;

    return '' === message || undefined === message ? name : name + ': ' + message;
}

const FRAMES_START = '\n    at ';

/**
 * The frames of the stack trace of an error, as V8 prints them in `error.stack` after the header (the name and the
 * message), each line starting with four spaces and `at`: the text from the first frame on, or `''` if the error has
 * no stack (an error whose Java `fillInStackTrace` is overridden to do nothing sets `stack` to `undefined`). Two
 * errors made at the same place have the same frames: it is Java's `Throwable.getStackTrace()` as text.
 */
export function stackTraceFrames(error: Error): string {
    const stack = error.stack;
    if ('string' !== typeof stack) {
        return '';
    }

    const head = throwableToString(error);
    const start = stack.indexOf(FRAMES_START, stack.startsWith(head) ? head.length : 0);

    return -1 === start ? '' : stack.substring(start);
}

/**
 * The cause of an error, or null: `Throwable.getCause()`.
 */
export function getCause(error: Error): Error | null {
    const cause = (error as { cause?: unknown }).cause;

    return cause instanceof Error ? cause : null;
}

/**
 * The lines `Throwable.printStackTrace` prints: `toString()`, then a `\tat ...` line for each frame, then
 * `Caused by: ...` and the same for each cause. Differences from Java (recorded in spec D18): the frames are V8's
 * (`\tat fn (file:line:col)`, not `\tat pkg.Class.method(File.java:line)`), the lines of a cause that Java elides as
 * `... n more` (the frames it has in common with the enclosing trace) are all printed, and suppressed exceptions are
 * not printed.
 */
function traceLines(error: Error): string[] {
    const lines: string[] = [];
    const seen = new Set<Error>();

    let current: Error | null = error;
    let caption = '';
    while (null !== current && !seen.has(current)) {
        seen.add(current);

        lines.push(caption + throwableToString(current));
        const frames = stackTraceFrames(current);
        if ('' !== frames) {
            for (const frame of frames.substring(1).split('\n')) {
                lines.push(frame.startsWith('    at ') ? '\t' + frame.substring(4) : frame);
            }
        }

        current = getCause(current);
        caption = 'Caused by: ';
    }

    return lines;
}

/**
 * `Throwable.printStackTrace(PrintStream)`: each line of the trace through `println`.
 *
 * @param error to print.
 * @param out   to print to.
 */
export function printStackTrace(error: Error, out: PrintStream): void {
    for (const line of traceLines(error)) {
        out.println(line);
    }
}

/**
 * The text `Throwable.printStackTrace(new PrintWriter(stringWriter))` leaves in the `StringWriter`: the lines of the
 * trace, each ended by a newline (`\n`, the `System.lineSeparator()` of Linux and macOS).
 */
export function stackTraceString(error: Error): string {
    let text = '';
    for (const line of traceLines(error)) {
        text += line + '\n';
    }

    return text;
}
