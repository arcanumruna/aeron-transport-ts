// JDK stand-ins added with the agents and counters (phase 1, T5): `Thread` and its interrupt flag, the exceptions and
// error that the agent code catches by type, `AutoCloseable`, `Objects.requireNonNull` and `Charset`.
// Not part of Agrona: there is no Java file behind this one. It sits beside `jdk.ts` (spec D10, docs/mapping.md).
import { Exception, NullPointerException } from './jdk.js';

/**
 * `java.lang.AutoCloseable`. A try-with-resources block becomes try / finally with an explicit `close()`.
 */
export interface AutoCloseable {
    close(): void;
}

/**
 * `java.lang.InterruptedException`.
 */
export class InterruptedException extends Exception {}

/**
 * `java.nio.channels.ClosedByInterruptException`.
 */
export class ClosedByInterruptException extends Exception {}

/**
 * Stand-in for `java.lang.Error`, the throwable that is not an `Exception` (`OutOfMemoryError`, `AssertionError`, ...)
 * and that Agrona's agent code reports and then rethrows. A JS `Error` that is not a {@link JavaError}, such as a
 * `TypeError` or `RangeError`, corresponds to a Java `RuntimeException`: it is reported and the agent goes on.
 */
export class JavaError extends Error {
    public constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
    }
}

/**
 * `Objects.requireNonNull(obj, message)`: `null` and `undefined` are both Java's `null`.
 */
export function requireNonNull<T>(obj: T | null | undefined, message?: string): T {
    if (null === obj || undefined === obj) {
        throw new NullPointerException(message);
    }

    return obj;
}

/**
 * Stand-in for `java.lang.Thread` on a single JS thread (spec D3, D11). There is one JS thread, so a "thread" is a
 * logical one: an identity with an interrupt flag and an alive flag. `Thread.currentThread()` is the thread that is
 * running now: the main thread, or the thread of the {@link AgentRunner} while it runs a duty cycle. The runner
 * switches the current thread with {@link Thread.switchTo} around each cycle.
 */
export class Thread {
    private static current: Thread;

    private readonly name: string;
    private interruptFlag = false;
    private alive: boolean;

    public constructor(name = '', alive = false) {
        this.name = name;
        this.alive = alive;
    }

    /** `Thread.currentThread()`. */
    public static currentThread(): Thread {
        return Thread.current;
    }

    /** `Thread.interrupted()`: whether the current thread is interrupted, clearing the flag. */
    public static interrupted(): boolean {
        const thread = Thread.current;
        const wasInterrupted = thread.interruptFlag;
        thread.interruptFlag = false;
        return wasInterrupted;
    }

    /** `Thread.onSpinWait()`: nothing to do on one thread. */
    public static onSpinWait(): void {}

    /**
     * Not in Java. Make `thread` the current thread, as the runner's thread is while it runs a duty cycle.
     *
     * @return the thread that was current, to pass to {@link Thread.switchTo} when the cycle is over.
     */
    public static switchTo(thread: Thread): Thread {
        const previous = Thread.current;
        Thread.current = thread;
        return previous;
    }

    /** `Thread.getName()`. */
    public getName(): string {
        return this.name;
    }

    /** `Thread.interrupt()`. */
    public interrupt(): void {
        this.interruptFlag = true;
    }

    /** `Thread.isInterrupted()`: does not clear the flag. */
    public isInterrupted(): boolean {
        return this.interruptFlag;
    }

    /** `Thread.isAlive()`. */
    public isAlive(): boolean {
        return this.alive;
    }

    /** Not in Java. The runner marks its thread alive when it starts and dead when its loop ends. */
    public setAlive(alive: boolean): void {
        this.alive = alive;
    }

    public toString(): string {
        return 'Thread[' + this.name + ']';
    }

    static {
        Thread.current = new Thread('main', true);
    }
}

/**
 * Stand-in for `java.nio.charset.Charset`: the two standard charsets that the counters labels use.
 */
export class Charset {
    private readonly charsetName: string;

    private constructor(name: string) {
        this.charsetName = name;
    }

    /** @internal Created once for each standard charset. */
    public static create(name: string): Charset {
        return new Charset(name);
    }

    public name(): string {
        return this.charsetName;
    }

    /** `String.getBytes(Charset)`. ASCII encodes a character above 127 as '?'. */
    public encode(value: string): Uint8Array {
        if (this === StandardCharsets.UTF_8) {
            return UTF_8_ENCODER.encode(value);
        }

        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i);
            bytes[i] = c > 127 ? 0x3f : c;
        }

        return bytes;
    }

    /** `new String(bytes, Charset)`. ASCII decodes a byte above 127 as U+FFFD. */
    public decode(bytes: Uint8Array): string {
        if (this === StandardCharsets.UTF_8) {
            return UTF_8_DECODER.decode(bytes);
        }

        let result = '';
        for (const byte of bytes) {
            result += byte > 127 ? '�' : String.fromCharCode(byte);
        }

        return result;
    }

    public toString(): string {
        return this.charsetName;
    }
}

const UTF_8_ENCODER = new TextEncoder();
const UTF_8_DECODER = new TextDecoder('utf-8');

/**
 * `java.nio.charset.StandardCharsets`.
 */
export const StandardCharsets = {
    US_ASCII: Charset.create('US-ASCII'),
    UTF_8: Charset.create('UTF-8'),
} as const;
