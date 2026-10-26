// JDK stand-ins for the java.lang / java.nio / java.util.concurrent types that Agrona and its tests use.
// Not part of Agrona: there is no Java file behind this one (see docs/mapping.md "Notes").

/**
 * Stand-in for `java.nio.ByteOrder`.
 */
export class ByteOrder {
    public static readonly BIG_ENDIAN: ByteOrder = new ByteOrder('BIG_ENDIAN');
    public static readonly LITTLE_ENDIAN: ByteOrder = new ByteOrder('LITTLE_ENDIAN');

    private readonly name: string;

    private constructor(name: string) {
        this.name = name;
    }

    public static nativeOrder(): ByteOrder {
        return ByteOrder.LITTLE_ENDIAN;
    }

    public toString(): string {
        return this.name;
    }
}

/**
 * Stand-in for `java.lang.Throwable` and its subclasses. Every class sets `name` to its own class name.
 */
export class Exception extends Error {
    public constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
    }

    /** `Throwable.addSuppressed(Throwable)`. */
    public addSuppressed(exception: Error): void {
        addSuppressed(this, exception);
    }

    /** `Throwable.getSuppressed()`. */
    public getSuppressed(): readonly Error[] {
        return getSuppressed(this);
    }
}

const SUPPRESSED = new WeakMap<Error, Error[]>();

/**
 * `Throwable.addSuppressed(Throwable)` for any thrown error, as a JS `Error` that is not an {@link Exception} has no
 * such method.
 */
export function addSuppressed(error: Error, suppressed: Error): void {
    if (error === suppressed) {
        throw new IllegalArgumentException('Self-suppression not permitted');
    }

    const list = SUPPRESSED.get(error);
    if (undefined === list) {
        SUPPRESSED.set(error, [suppressed]);
    } else {
        list.push(suppressed);
    }
}

/**
 * `Throwable.getSuppressed()` for any thrown error.
 */
export function getSuppressed(error: Error): readonly Error[] {
    return SUPPRESSED.get(error) ?? [];
}

export class RuntimeException extends Exception {}

export class IllegalArgumentException extends RuntimeException {}

export class IllegalStateException extends RuntimeException {}

export class NumberFormatException extends IllegalArgumentException {}

export class ArithmeticException extends RuntimeException {}

export class NullPointerException extends RuntimeException {}

export class UnsupportedOperationException extends RuntimeException {}

export class IndexOutOfBoundsException extends RuntimeException {}

export class ArrayIndexOutOfBoundsException extends IndexOutOfBoundsException {}

export class StringIndexOutOfBoundsException extends IndexOutOfBoundsException {}

export class NegativeArraySizeException extends RuntimeException {}

/**
 * `java.lang.ClassNotFoundException`: a checked exception in Java, thrown by `Class.forName`. The message is the class
 * name.
 */
export class ClassNotFoundException extends Exception {}

/**
 * A Java `long` result or stored value outside +/-(2^53 - 1), which a `number` cannot hold (spec D5). `value` is the
 * exact 64-bit value that Java would have returned.
 */
export class LongOverflowError extends RangeError {
    public readonly value: bigint;

    public constructor(value: bigint) {
        super('long value is outside +/-(2^53 - 1): ' + value);
        this.name = 'LongOverflowError';
        this.value = value;
    }
}

/**
 * The system properties of `System` (see `jdkLang.ts`): the one module-level store behind `System.getProperty`,
 * `setProperty` and `clearProperty` and behind {@link Integer.getInteger}, {@link Long.getLong} and
 * {@link Boolean.getBoolean}. It lives here, and not beside `System`, so that those readers need no import of
 * `jdkLang.ts` (which imports this file). It starts empty and never reads `process.env` (docs/mapping.md, "Notes").
 */
export const systemProperties: Map<string, string> = new Map<string, string>();

/**
 * `Integer.decode` and `Long.decode`: an optional sign, then `0x` / `0X` / `#` (hex), a leading `0` (octal) or decimal
 * digits. A value outside [min, max] is a `NumberFormatException`, as in Java.
 */
function decode(nm: string, min: bigint, max: bigint): bigint {
    if (0 === nm.length) {
        throw new NumberFormatException('Zero length string');
    }

    let radix = 10;
    let index = 0;
    let negative = false;
    const firstChar = nm.charAt(0);
    if ('-' === firstChar) {
        negative = true;
        index++;
    } else if ('+' === firstChar) {
        index++;
    }

    if (nm.startsWith('0x', index) || nm.startsWith('0X', index)) {
        index += 2;
        radix = 16;
    } else if (nm.startsWith('#', index)) {
        index++;
        radix = 16;
    } else if (nm.startsWith('0', index) && nm.length > 1 + index) {
        index++;
        radix = 8;
    }

    if (nm.startsWith('-', index) || nm.startsWith('+', index)) {
        throw new NumberFormatException('Sign character in wrong position');
    }

    const digits = nm.substring(index);
    const pattern = 16 === radix ? /^[0-9a-fA-F]+$/ : 8 === radix ? /^[0-7]+$/ : /^[0-9]+$/;
    if (!pattern.test(digits)) {
        throw new NumberFormatException('For input string: "' + (negative ? '-' : '') + digits + '"');
    }

    const magnitude = BigInt((16 === radix ? '0x' : 8 === radix ? '0o' : '') + digits);
    const value = negative ? -magnitude : magnitude;
    if (value < min || value > max) {
        throw new NumberFormatException('For input string: "' + (negative ? '-' : '') + digits + '"');
    }

    return value;
}

const DECIMAL_DIGITS: Uint8Array = (() => {
    const table = new Uint8Array(0x10000);
    const nd = /^\p{Nd}$/u;
    for (let ch = 0; ch < 0x10000; ch++) {
        table[ch] = nd.test(String.fromCharCode(ch)) ? 1 : 0;
    }
    return table;
})();

/**
 * Stand-in for `java.lang.Character`. A Java `char` is a UTF-16 code unit held in a `number`.
 */
export const Character = {
    /** `Character.isDigit(char)`: the Unicode general category Nd, from a table built once. */
    isDigit(ch: number): boolean {
        return 1 === DECIMAL_DIGITS[ch & 0xffff];
    },
} as const;

function getInteger(name: string): number | null;
function getInteger(name: string, def: number): number;
function getInteger(name: string, def: number | null): number | null;
function getInteger(name: string, def: number | null = null): number | null {
    const value = systemProperties.get(name);
    if (undefined !== value) {
        try {
            return Number(decode(value, BigInt(-2147483648), BigInt(2147483647)));
        } catch (ex) {
            if (!(ex instanceof NumberFormatException)) {
                throw ex;
            }
        }
    }

    return def;
}

/**
 * Stand-in for `java.lang.Integer`.
 */
/**
 * The ASCII spelling of a string whose decimal digits may be any Unicode `Nd` code point, which is what
 * `Character.digit(ch, 10)` accepts (a run of `Nd` code points is made of sets of ten, the first of which is zero).
 * Not on a hot path: the ASCII case is answered by the caller's own test.
 */
function toAsciiDigits(s: string): string {
    return s.replace(/\p{Nd}/gu, (ch) => {
        let cp = ch.codePointAt(0)!;
        const here = cp;
        while (cp > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(cp - 1))) {
            cp--;
        }

        return String((here - cp) % 10);
    });
}

export const Integer = {
    MIN_VALUE: -2147483648,
    MAX_VALUE: 2147483647,
    SIZE: 32,

    numberOfLeadingZeros(i: number): number {
        return Math.clz32(i);
    },

    /** `Integer.parseInt(String)`: decimal digits, ASCII or any Unicode `Nd` as `Character.digit` accepts (issue 17). */
    parseInt(s: string | null): number {
        if (null === s) {
            throw new NumberFormatException('Cannot parse null string: null');
        }

        const text = /^[+-]?[0-9]+$/.test(s) ? s : toAsciiDigits(s);
        if (!/^[+-]?[0-9]+$/.test(text)) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        const result = Number(text);
        if (result < Integer.MIN_VALUE || result > Integer.MAX_VALUE) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        return result + 0;
    },

    /**
     * `Integer.parseUnsignedInt(String)`: decimal digits (a leading `+` is allowed) holding 0 to 2^32 - 1, returned as
     * the `int` with those 32 bits, so 4294967295 is -1 as in Java. A leading `-` or a value over 2^32 - 1 is a
     * {@link NumberFormatException}.
     */
    parseUnsignedInt(s: string | null): number {
        if (null === s) {
            throw new NumberFormatException('Cannot parse null string: null');
        }

        if (0 === s.length) {
            throw new NumberFormatException('For input string: ""');
        }

        if ('-' === s.charAt(0)) {
            throw new NumberFormatException('Illegal leading minus sign on unsigned string ' + s + '.');
        }

        if (!/^\+?[0-9]+$/.test(s)) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        const result = Number(s);
        if (result > 0xffffffff) {
            throw new NumberFormatException('String value ' + s + ' exceeds range of unsigned int.');
        }

        return result | 0;
    },

    toHexString(i: number): string {
        return (i >>> 0).toString(16);
    },

    /** `Integer.compare(int, int)`. */
    compare(x: number, y: number): number {
        return x < y ? -1 : x === y ? 0 : 1;
    },

    /**
     * `Integer.getInteger(String, Integer)`: the system property `name` decoded as an `int` (`Integer.decode`), or
     * `def` if there is no such property or it is not a number.
     */
    getInteger,
} as const;

/**
 * Stand-in for `java.lang.Boolean`.
 */
export const Boolean = {
    /** `Boolean.getBoolean(String)`: whether the system property `name` exists and equals "true", ignoring case. */
    getBoolean(name: string): boolean {
        const value = systemProperties.get(name);
        return undefined !== value && 'true' === value.toLowerCase();
    },
} as const;

const TWO_POW_32 = 4294967296;

/**
 * Stand-in for `java.lang.Byte`.
 */
export const Byte = {
    MIN_VALUE: -128,
    MAX_VALUE: 127,

    /** `Byte.compare(byte, byte)`, which is the difference. */
    compare(x: number, y: number): number {
        return x - y;
    },
} as const;

/**
 * Stand-in for `java.lang.Short`.
 */
export const Short = {
    MIN_VALUE: -32768,
    MAX_VALUE: 32767,
} as const;

// The limits of a Java `long`, as constants: `-(2n ** 63n)` computed in `Long.checkInt64` allocated a `bigint` per call,
// on the path of every flyweight that writes a 64-bit field (the group tag of a status message, the RTT timestamps).
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function getLong(name: string): number | null;
function getLong(name: string, def: number): number;
function getLong(name: string, def: number | null): number | null;
function getLong(name: string, def: number | null = null): number | null {
    const value = systemProperties.get(name);
    if (undefined !== value) {
        try {
            return longToNumber(decode(value, -(2n ** 63n), 2n ** 63n - 1n));
        } catch (ex) {
            if (!(ex instanceof NumberFormatException)) {
                throw ex;
            }
        }
    }

    return def;
}

/**
 * Stand-in for `java.lang.Long`. A Java `long` that is held in a `number` is exact to +/-(2^53 - 1) (spec 5.2), so
 * {@link Long.MAX_VALUE} and {@link Long.MIN_VALUE} are the largest and smallest values that can be held.
 */
export const Long = {
    MIN_VALUE: Number.MIN_SAFE_INTEGER,
    MAX_VALUE: Number.MAX_SAFE_INTEGER,
    SIZE: 64,

    /**
     * `Long.parseLong(String)` (and `Long.valueOf(String)`): an optional sign and decimal digits (ASCII or any Unicode `Nd`, as `Character.digit`). A value outside
     * Java's `long` is a `NumberFormatException`; one inside it but outside +/-(2^53 - 1) is a {@link LongOverflowError}
     * carrying the exact value (spec D5).
     */
    parseLong(s: string | null): number {
        if (null === s) {
            throw new NumberFormatException('Cannot parse null string: null');
        }

        const text = /^[+-]?[0-9]+$/.test(s) ? s : toAsciiDigits(s);
        if (!/^[+-]?[0-9]+$/.test(text)) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        const value = BigInt(text);
        if (value < -(2n ** 63n) || value > 2n ** 63n - 1n) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        return longToNumber(value) + 0;
    },

    /** `Long.numberOfLeadingZeros(long)` for a `number` holding a safe integer, or a `bigint` holding a long. */
    numberOfLeadingZeros(i: number | bigint): number {
        if (typeof i === 'bigint') {
            if (i < 0n) {
                return 0;
            }

            const hi = Number(i >> 32n);
            return 0 !== hi ? Math.clz32(hi) : 32 + Math.clz32(Number(i & 0xffffffffn));
        }

        if (i < 0) {
            return 0;
        }

        const hi = Math.floor(i / TWO_POW_32);
        return 0 !== hi ? Math.clz32(hi) : 32 + Math.clz32(i >>> 0);
    },

    /** A `long` held in a `number`: the value, or a `RangeError` if it is not a safe integer. */
    checkSafe(value: number): number {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError('long value is not a safe integer: ' + value);
        }

        return value;
    },

    /** A `long` held in a `bigint`: the value, or a `RangeError` if it is outside [-2^63, 2^63 - 1]; it never wraps. */
    checkInt64(value: bigint): bigint {
        if (value < INT64_MIN || value > INT64_MAX) {
            throw new RangeError('long value is outside [-2^63, 2^63 - 1]: ' + value);
        }

        return value;
    },

    /** `Long.compare(long, long)` for two `number`s holding safe integers. */
    compare(x: number, y: number): number {
        return x < y ? -1 : x === y ? 0 : 1;
    },

    /**
     * `Long.getLong(String, Long)`: the system property `name` decoded as a `long` (`Long.decode`), or `def` if there
     * is no such property or it is not a number. A value inside Java's `long` but outside +/-(2^53 - 1) is a
     * {@link LongOverflowError} (spec D5).
     */
    getLong,

    /** The 64-bit `a & b` for two `number`s holding safe integers. */
    and(a: number, b: number): number {
        const hi = (Math.floor(a / TWO_POW_32) & Math.floor(b / TWO_POW_32)) | 0;
        const lo = (a & b) >>> 0;
        return hi * TWO_POW_32 + lo;
    },
} as const;

/**
 * Java's `(long)` cast of a `double`: truncates toward zero, maps NaN to 0 and saturates at `Long.MAX_VALUE` /
 * `Long.MIN_VALUE`, which are the +/-(2^53 - 1) of {@link Long} here (spec D5), never wrapping and never NaN.
 */
export function doubleToLong(value: number): number {
    if (value !== value) {
        return 0;
    }
    if (value >= Long.MAX_VALUE) {
        return Long.MAX_VALUE;
    }
    if (value <= Long.MIN_VALUE) {
        return Long.MIN_VALUE;
    }

    return Math.trunc(value) + 0;
}

/** Java's `(int)` cast of a `double`: truncates toward zero, maps NaN to 0 and saturates at the `int` range. */
export function doubleToInt(value: number): number {
    if (value !== value) {
        return 0;
    }
    if (value >= 2147483647) {
        return 2147483647;
    }
    if (value <= -2147483648) {
        return -2147483648;
    }

    return value | 0;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A Java `long` held in a `number`: the exact value, or a `RangeError` if it is outside +/-(2^53 - 1) (spec 5.2).
 */
export function longToNumber(value: bigint): number {
    if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
        throw new LongOverflowError(value);
    }

    return Number(value);
}

/**
 * `Math.multiplyExact(long, long)` for two `number`s holding safe integers. The product is computed with `bigint`: a
 * result outside Java's `long` is an `ArithmeticException("long overflow")`, as in Java; one inside it but outside
 * +/-(2^53 - 1) is a {@link LongOverflowError} carrying the exact product (spec D5).
 */
export function multiplyExact(a: number, b: number): number {
    const product = BigInt(a) * BigInt(b);
    if (product < -(2n ** 63n) || product > 2n ** 63n - 1n) {
        throw new ArithmeticException('long overflow');
    }

    return longToNumber(product);
}

/**
 * `BigInteger.longValueExact()`.
 */
export function longValueExact(value: bigint): bigint {
    if (BigInt.asIntN(64, value) !== value) {
        throw new ArithmeticException('BigInteger out of long range');
    }

    return value;
}

/**
 * Stand-in for `java.util.concurrent.TimeUnit`: the conversions to nanoseconds, saturating at
 * {@link Long.MAX_VALUE} and {@link Long.MIN_VALUE} as the JDK does.
 */
export class TimeUnit {
    public static readonly NANOSECONDS: TimeUnit = new TimeUnit(1);
    public static readonly MICROSECONDS: TimeUnit = new TimeUnit(1_000);
    public static readonly MILLISECONDS: TimeUnit = new TimeUnit(1_000_000);
    public static readonly SECONDS: TimeUnit = new TimeUnit(1_000_000_000);
    public static readonly MINUTES: TimeUnit = new TimeUnit(60_000_000_000);
    public static readonly HOURS: TimeUnit = new TimeUnit(3_600_000_000_000);
    public static readonly DAYS: TimeUnit = new TimeUnit(86_400_000_000_000);

    private readonly scale: number;

    private constructor(scale: number) {
        this.scale = scale;
    }

    /** `toMillis(duration)`: truncated towards zero, saturating at {@link Long.MAX_VALUE} and {@link Long.MIN_VALUE}. */
    public toMillis(duration: number): number {
        return TimeUnit.MILLISECONDS.convert(duration, this);
    }

    /**
     * `convert(sourceDuration, sourceUnit)`: `sourceDuration` of `sourceUnit` in this unit, truncated towards zero.
     * It converts by the ratio of the two scales (every scale divides the larger ones exactly), as Java does, and
     * not through nanoseconds, which would saturate early.
     */
    public convert(sourceDuration: number, sourceUnit: TimeUnit): number {
        const source = sourceUnit.scale;
        const target = this.scale;
        if (source < target) {
            return Math.trunc(sourceDuration / (target / source));
        }

        const ratio = source / target;
        const max = Math.floor(Long.MAX_VALUE / ratio);
        if (sourceDuration > max) {
            return Long.MAX_VALUE;
        }
        if (sourceDuration < -max) {
            return Long.MIN_VALUE;
        }

        return sourceDuration * ratio;
    }

    public toNanos(duration: number | bigint): number {
        if (typeof duration === 'bigint') {
            // Java saturates at 2^63 - 1; every result above 2^53 - 1 saturates here, so the 64-bit bound is moot
            const nanos = duration * BigInt(this.scale);
            if (nanos > MAX_SAFE_BIGINT) {
                return Long.MAX_VALUE;
            }
            return nanos < -MAX_SAFE_BIGINT ? Long.MIN_VALUE : Number(nanos);
        }

        const max = Math.floor(Long.MAX_VALUE / this.scale);
        if (duration > max) {
            return Long.MAX_VALUE;
        }
        if (duration < -max) {
            return Long.MIN_VALUE;
        }

        return duration * this.scale;
    }
}

/**
 * Stand-in for `java.util.concurrent.ThreadLocalRandom` (there is one thread, so one generator).
 */
export class ThreadLocalRandom {
    private static readonly INSTANCE: ThreadLocalRandom = new ThreadLocalRandom();

    public static current(): ThreadLocalRandom {
        return ThreadLocalRandom.INSTANCE;
    }

    /**
     * A random `int` over [{@link Integer.MIN_VALUE}, {@link Integer.MAX_VALUE}], or over [origin, bound) if given.
     */
    public nextInt(origin?: number, bound?: number): number {
        if (undefined === origin) {
            return Math.floor(Math.random() * TWO_POW_32) | 0;
        }

        return origin + Math.floor(Math.random() * (bound! - origin));
    }

    // xorshift128 state (Marsaglia), seeded from Math.random. `Math.random()` allocates a heap number per call in V8, so
    // `nextDouble`, which the feedback delay generators call per NAK, runs on its own integer generator instead.
    private s0 = Math.floor(Math.random() * TWO_POW_32) | 1;
    private s1 = Math.floor(Math.random() * TWO_POW_32) | 0;
    private s2 = Math.floor(Math.random() * TWO_POW_32) | 0;
    private s3 = Math.floor(Math.random() * TWO_POW_32) | 0;

    private nextBits(): number {
        let t = this.s3;
        const s = this.s0;
        this.s3 = this.s2;
        this.s2 = this.s1;
        this.s1 = s;
        t ^= t << 11;
        t ^= t >>> 8;
        this.s0 = t ^ s ^ (s >>> 19);
        return this.s0 >>> 0;
    }

    /** `Random.nextDouble()`: a uniform `double` in [0, 1) with 53 random bits, as Java's. */
    public nextDouble(): number {
        const high = this.nextBits() >>> 5;
        const low = this.nextBits() >>> 6;
        return (high * 67108864 + low) / 9007199254740992;
    }

    /** `Random.nextBoolean()`. */
    public nextBoolean(): boolean {
        return Math.random() < 0.5;
    }

    /** `Random.nextBytes(byte[])`. */
    public nextBytes(bytes: Uint8Array): void {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
}

/**
 * Stand-in for `java.util.Objects.checkFromIndexSize`.
 */
export const Objects = {
    checkFromIndexSize(fromIndex: number, size: number, length: number): number {
        if (fromIndex < 0 || size < 0 || length < 0 || size > length - fromIndex) {
            throw new IndexOutOfBoundsException(
                `Range [${fromIndex}, ${fromIndex} + ${size}) out of bounds for length ${length}`,
            );
        }

        return fromIndex;
    },
} as const;

/**
 * Stand-in for `java.lang.Appendable`, where a `char` is a one character string.
 */
export interface Appendable {
    append(c: string): Appendable;
}

/**
 * Stand-in for `new String(bytes, offset, length, StandardCharsets.US_ASCII)`: a byte above 127 is U+FFFD.
 */
export function newStringAscii(bytes: Uint8Array, offset: number, length: number): string {
    let s = '';
    for (let i = offset, limit = offset + length; i < limit; i++) {
        const b = bytes[i]!;
        s += String.fromCharCode(b > 127 ? 0xfffd : b);
    }

    return s;
}

/**
 * The 64-bit `long` at `offset` of a view, as a `number`: a `RangeError` if it is outside +/-(2^53 - 1). It reads two
 * 32-bit words, so nothing is allocated.
 */
export function dataViewGetLong(view: DataView, offset: number, littleEndian: boolean): number {
    const value = littleEndian
        ? view.getInt32(offset + 4, true) * TWO_POW_32 + view.getUint32(offset, true)
        : view.getInt32(offset, false) * TWO_POW_32 + view.getUint32(offset + 4, false);
    if (!Number.isSafeInteger(value)) {
        throw new LongOverflowError(view.getBigInt64(offset, littleEndian));
    }

    return value;
}

/**
 * Writes a `long` held in a `number` at `offset` of a view: a `RangeError`, with nothing written, if it is not a safe
 * integer.
 */
export function dataViewSetLong(view: DataView, offset: number, value: number, littleEndian: boolean): void {
    Long.checkSafe(value);

    const hi = Math.floor(value / TWO_POW_32);
    const lo = value >>> 0;
    if (littleEndian) {
        view.setUint32(offset, lo, true);
        view.setInt32(offset + 4, hi, true);
    } else {
        view.setInt32(offset, hi, false);
        view.setUint32(offset + 4, lo, false);
    }
}

/** True where `VarHandle.releaseFence()` is the empty function: x64, a total-store-order architecture. */
export const RELEASE_FENCE_IS_NO_OP: boolean = 'x64' === process.arch;

/** The word of the fence of the other architectures; private to the module, so private to the worker thread. */
const FENCE = new Int32Array(new SharedArrayBuffer(4));

/**
 * Stand-in for `java.lang.invoke.VarHandle`, which has the fences only (spec D21). `releaseFence()` is chosen once, at
 * module load:
 * - x64 (total store order): a later store cannot pass an earlier store, and V8 does not move a plain typed-array
 *   access across an `Atomics` operation in its IR, so the fence is the empty function;
 * - any other architecture (ARM64): `Atomics.add(FENCE, 0, 0)`, a sequentially consistent read-modify-write. With the
 *   LSE extension (ARMv8.1 and later) it is one `ldaddal`, a full barrier for the pairs the fences need. On ARMv8.0
 *   it is an `ldaxr` / `stlxr` loop, which the architecture does not guarantee to be a full fence (spec D21). Only
 *   x64 has been checked. The module instance is per worker, so the word is never contended.
 */
export class VarHandle {
    /** `VarHandle.releaseFence()`: no earlier load or store is reordered with a later store. */
    public static readonly releaseFence: () => void = RELEASE_FENCE_IS_NO_OP
        ? (): void => {}
        : (): void => {
              Atomics.add(FENCE, 0, 0);
          };

    /**
     * `VarHandle.acquireFence()`: no earlier load is reordered with a later load or store. Chosen like
     * `releaseFence()`: the empty function on x64 (loads are not reordered with later loads or stores, and V8 does not
     * move a plain typed-array access across an `Atomics` operation), a sequentially consistent read-modify-write on
     * any other architecture.
     */
    public static readonly acquireFence: () => void = RELEASE_FENCE_IS_NO_OP
        ? (): void => {}
        : (): void => {
              Atomics.add(FENCE, 0, 0);
          };
}
