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

/**
 * Stand-in for `java.lang.Integer`.
 */
export const Integer = {
    MIN_VALUE: -2147483648,
    MAX_VALUE: 2147483647,
    SIZE: 32,

    numberOfLeadingZeros(i: number): number {
        return Math.clz32(i);
    },

    /** `Integer.parseInt(String)`: decimal ASCII digits only. */
    parseInt(s: string | null): number {
        if (null === s) {
            throw new NumberFormatException('Cannot parse null string: null');
        }

        if (!/^[+-]?[0-9]+$/.test(s)) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        const result = Number(s);
        if (result < Integer.MIN_VALUE || result > Integer.MAX_VALUE) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        return result + 0;
    },

    toHexString(i: number): string {
        return (i >>> 0).toString(16);
    },

    /** `Integer.compare(int, int)`. */
    compare(x: number, y: number): number {
        return x < y ? -1 : x === y ? 0 : 1;
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

/**
 * Stand-in for `java.lang.Long`. A Java `long` that is held in a `number` is exact to +/-(2^53 - 1) (spec 5.2), so
 * {@link Long.MAX_VALUE} and {@link Long.MIN_VALUE} are the largest and smallest values that can be held.
 */
export const Long = {
    MIN_VALUE: Number.MIN_SAFE_INTEGER,
    MAX_VALUE: Number.MAX_SAFE_INTEGER,
    SIZE: 64,

    /**
     * `Long.parseLong(String)` (and `Long.valueOf(String)`): an optional sign and decimal ASCII digits. A value outside
     * Java's `long` is a `NumberFormatException`; one inside it but outside +/-(2^53 - 1) is a {@link LongOverflowError}
     * carrying the exact value (spec D5).
     */
    parseLong(s: string | null): number {
        if (null === s) {
            throw new NumberFormatException('Cannot parse null string: null');
        }

        if (!/^[+-]?[0-9]+$/.test(s)) {
            throw new NumberFormatException('For input string: "' + s + '"');
        }

        const value = BigInt(s);
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
        if (value < -(2n ** 63n) || value > 2n ** 63n - 1n) {
            throw new RangeError('long value is outside [-2^63, 2^63 - 1]: ' + value);
        }

        return value;
    },

    /** `Long.compare(long, long)` for two `number`s holding safe integers. */
    compare(x: number, y: number): number {
        return x < y ? -1 : x === y ? 0 : 1;
    },

    /** The 64-bit `a & b` for two `number`s holding safe integers. */
    and(a: number, b: number): number {
        const hi = (Math.floor(a / TWO_POW_32) & Math.floor(b / TWO_POW_32)) | 0;
        const lo = (a & b) >>> 0;
        return hi * TWO_POW_32 + lo;
    },
} as const;

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
 * - any other architecture (ARM64): `Atomics.add(FENCE, 0, 0)`, a sequentially consistent read-modify-write
 *   (`ldaddal` on ARM64), which orders the stores before it ahead of the stores after it. The module instance is per
 *   worker, so the word is never contended.
 */
export class VarHandle {
    /** `VarHandle.releaseFence()`: no earlier load or store is reordered with a later store. */
    public static readonly releaseFence: () => void = RELEASE_FENCE_IS_NO_OP
        ? (): void => {}
        : (): void => {
              Atomics.add(FENCE, 0, 0);
          };
}
