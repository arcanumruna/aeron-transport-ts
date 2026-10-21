// Port of org/agrona/collections/CharSequenceKey.java (a test source) @ Agrona 2.6.1
import { IllegalArgumentException } from '../../../src/agrona/jdk.js';
import { stringHashCode } from '../../../src/agrona/jdkUtil.js';

/**
 * A `CharSequence` is a `string` or a {@link CharSequenceKey}.
 */
export type CharSequence = string | CharSequenceKey;

/**
 * A `CharSequence` whose `equals` is not reflexive: it throws for the same instance, so that a test can show that a
 * collection compares with the value stored in it and never an instance with itself.
 */
export class CharSequenceKey {
    private readonly data: string;

    public constructor(data: string) {
        this.data = data;
    }

    public length(): number {
        return this.data.length;
    }

    public charAt(index: number): string {
        return this.data.charAt(index);
    }

    public subSequence(start: number, end: number): CharSequence {
        return this.data.substring(start, end);
    }

    public equals(o: unknown): boolean {
        if (this === o) {
            throw new IllegalArgumentException('This equality violation!');
        } else if (o instanceof CharSequenceKey) {
            return this.data === o.data;
        } else if (typeof o === 'string') {
            return this.data === o;
        }

        return false;
    }

    public hashCode(): number {
        return stringHashCode(this.data);
    }

    public toString(): string {
        return this.data;
    }
}
