// JDK stand-ins for the java.lang.Object / java.util types that the Agrona collections use (spec D10).
// Not part of Agrona: there is no Java file behind this one (see docs/mapping.md "Sources").
import {
    NegativeArraySizeException,
    RuntimeException,
    IndexOutOfBoundsException,
    NullPointerException,
} from './jdk.js';

/**
 * `java.util.NoSuchElementException`.
 */
export class NoSuchElementException extends RuntimeException {}

/**
 * The `hashCode` / `equals` protocol of a Java object. A key or a value that has these methods is hashed and compared
 * with them; a `string`, `number`, `boolean` or `bigint` is hashed as Java's `String`, `Integer` / `Double`,
 * `Boolean` and `Long` are; any other object has an identity hash.
 */
export interface HashCoded {
    hashCode(): number;
    equals(other: unknown): boolean;
}

const TWO_POW_32 = 4294967296;

const doubleBits = new Float64Array(1);
const doubleWords = new Int32Array(doubleBits.buffer);

const identityHashes = new WeakMap<object, number>();
let nextIdentityHash = 0x1b873593;

/**
 * `String.hashCode()`.
 */
export function stringHashCode(s: string): number {
    let h = 0;
    for (let i = 0, length = s.length; i < length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }

    return h;
}

/**
 * `Long.hashCode(long)` for a `long` held in a `number`: the high word xor the low word.
 */
export function longHashCode(value: number): number {
    const lo = value >>> 0;
    const hi = ((value - lo) / TWO_POW_32) | 0;

    return hi ^ lo;
}

/**
 * `Object.hashCode()` of anything (null is 0, as `Objects.hashCode`). A `number` that is an `int` is hashed as an
 * `Integer`, any other `number` as a `Double`.
 */
export function hashCodeOf(o: unknown): number {
    if (null === o || undefined === o) {
        return 0;
    }

    switch (typeof o) {
        case 'string':
            return stringHashCode(o);
        case 'number':
            if ((o | 0) === o) {
                return o;
            }
            doubleBits[0] = o;
            return doubleWords[0]! ^ doubleWords[1]!;
        case 'boolean':
            return o ? 1231 : 1237;
        case 'bigint':
            return Number(BigInt.asIntN(32, BigInt.asUintN(64, o) ^ (BigInt.asUintN(64, o) >> 32n)));
        case 'object':
        case 'function': {
            const hashCode = (o as { hashCode?: unknown }).hashCode;
            if ('function' === typeof hashCode) {
                return (hashCode as () => number).call(o);
            }

            let identity = identityHashes.get(o);
            if (undefined === identity) {
                identity = nextIdentityHash;
                nextIdentityHash = (Math.imul(nextIdentityHash, 0x5bd1e995) + 0x2545f491) | 0;
                identityHashes.set(o, identity);
            }

            return identity;
        }
        default:
            return 0;
    }
}

/**
 * `a.equals(b)` for a non-null `a`: the `equals` method if it has one, identity otherwise.
 */
export function instanceEquals(a: unknown, b: unknown): boolean {
    if ('object' === typeof a || 'function' === typeof a) {
        const equals = (a as { equals?: unknown } | null)?.equals;
        if ('function' === typeof equals) {
            return (equals as (other: unknown) => boolean).call(a, b);
        }
    }

    return a === b;
}

/**
 * `java.util.Objects.equals(a, b)`.
 */
export function objectsEquals(a: unknown, b: unknown): boolean {
    return a === b || (null !== a && undefined !== a && instanceEquals(a, b));
}

/**
 * `java.util.Objects.requireNonNull(obj, message)`; `undefined` is as null.
 */
export function requireNonNull<T>(obj: T | null | undefined, message?: string): T {
    if (null === obj || undefined === obj) {
        throw new NullPointerException(message);
    }

    return obj;
}

/**
 * `java.util.Iterator`.
 */
export interface JIterator<T> {
    hasNext(): boolean;
    next(): T;
    remove(): void;
}

/**
 * `java.util.Map.Entry`.
 */
export interface Entry<K, V> {
    getKey(): K;
    getValue(): V;
    setValue(value: V): V;
}

/**
 * `o instanceof Map.Entry`.
 */
export function isEntry(o: unknown): o is Entry<unknown, unknown> {
    return (
        'object' === typeof o &&
        null !== o &&
        'function' === typeof (o as Entry<unknown, unknown>).getKey &&
        'function' === typeof (o as Entry<unknown, unknown>).getValue
    );
}

/**
 * The part of `java.util.Map` that the maps use of another map.
 */
export interface JMap<K, V> {
    size(): number;
    isEmpty(): boolean;
    get(key: K): V | null;
    entrySet(): AbstractSet<Entry<K, V>>;
}

/**
 * `o instanceof Map`.
 */
export function isMap(o: unknown): o is JMap<unknown, unknown> {
    return (
        'object' === typeof o &&
        null !== o &&
        'function' === typeof (o as JMap<unknown, unknown>).entrySet &&
        'function' === typeof (o as JMap<unknown, unknown>).size
    );
}

/**
 * `java.util.AbstractCollection`. A JavaScript `for ... of` over a collection uses its `iterator()`.
 */
export abstract class AbstractCollection<T> implements Iterable<T> {
    public abstract iterator(): JIterator<T>;

    public abstract size(): number;

    public isEmpty(): boolean {
        return 0 === this.size();
    }

    public contains(o: unknown): boolean {
        const it = this.iterator();
        while (it.hasNext()) {
            if (objectsEquals(o, it.next())) {
                return true;
            }
        }

        return false;
    }

    public containsAll(c: Iterable<unknown>): boolean {
        for (const e of c) {
            if (!this.contains(e)) {
                return false;
            }
        }

        return true;
    }

    public toArray(): unknown[];
    public toArray<A>(a: A[]): A[];
    public toArray<A>(a?: A[]): unknown[] | A[] {
        const size = this.size();
        const array: unknown[] = undefined === a || a.length < size ? new Array<unknown>(size).fill(null) : a;
        const it = this.iterator();
        let i = 0;
        for (; i < array.length && it.hasNext(); i++) {
            array[i] = it.next();
        }
        if (i < array.length) {
            array[i] = null;
        }

        return array;
    }

    /**
     * `Collection.removeIf(Predicate)`.
     */
    public removeIf(filter: (e: T) => boolean): boolean {
        let removed = false;
        const it = this.iterator();
        while (it.hasNext()) {
            if (filter(it.next())) {
                it.remove();
                removed = true;
            }
        }

        return removed;
    }

    /**
     * `Iterable.forEach(Consumer)`.
     */
    public forEach(action: (e: T) => void): void {
        const it = this.iterator();
        while (it.hasNext()) {
            action(it.next());
        }
    }

    public *[Symbol.iterator](): Iterator<T> {
        const it = this.iterator();
        while (it.hasNext()) {
            yield it.next();
        }
    }

    public toString(): string {
        const it = this.iterator();
        if (!it.hasNext()) {
            return '[]';
        }

        let s = '[';
        for (;;) {
            s += String(it.next());
            if (!it.hasNext()) {
                return s + ']';
            }
            s += ', ';
        }
    }
}

/**
 * `java.util.AbstractSet`.
 */
export abstract class AbstractSet<T> extends AbstractCollection<T> {
    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (!(o instanceof AbstractSet)) {
            return false;
        }

        const c = o as AbstractSet<unknown>;
        if (c.size() !== this.size()) {
            return false;
        }

        return this.containsAll(c);
    }

    public hashCode(): number {
        let h = 0;
        const it = this.iterator();
        while (it.hasNext()) {
            h = (h + hashCodeOf(it.next())) | 0;
        }

        return h;
    }
}

/**
 * `java.util.Arrays.copyOf(T[], int)`: the array padded with null, or cut, to the new length.
 */
export function arraysCopyOf<T>(original: readonly T[], newLength: number): T[] {
    if (newLength < 0) {
        throw new NegativeArraySizeException(String(newLength));
    }

    const copy = new Array<T>(newLength);
    const n = Math.min(original.length, newLength);
    for (let i = 0; i < n; i++) {
        copy[i] = original[i]!;
    }
    for (let i = n; i < newLength; i++) {
        copy[i] = null as T;
    }

    return copy;
}

/**
 * The `IndexOutOfBoundsException` of `ArrayList.get`, `set` and `remove`.
 */
export function outOfBounds(index: number, length: number): IndexOutOfBoundsException {
    return new IndexOutOfBoundsException(`Index ${index} out of bounds for length ${length}`);
}

/**
 * `Float.toString(float)` for a float held in a `number`: the shortest decimal that reads back as the same float, with
 * a fraction part (`0.1`, `1.0`) between 1e-3 and 1e7 and `d.dddE[-]n` outside.
 */
export function floatToString(value: number): string {
    if (Number.isNaN(value)) {
        return 'NaN';
    }

    if (!Number.isFinite(value)) {
        return value > 0 ? 'Infinity' : '-Infinity';
    }

    if (0 === value) {
        return Object.is(value, -0) ? '-0.0' : '0.0';
    }

    const f = Math.fround(value);
    let digits = '';
    for (let precision = 1; precision <= 9; precision++) {
        digits = f.toExponential(precision - 1);
        if (Math.fround(Number(digits)) === f) {
            break;
        }
    }

    const abs = Math.abs(f);
    if (abs >= 1e-3 && abs < 1e7) {
        const plain = Number(digits).toString();
        return plain.includes('.') ? plain : plain + '.0';
    }

    const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(digits)!;
    return `${m[1]}${m[2]}.${m[3] ?? '0'}E${Number(m[4])}`;
}
