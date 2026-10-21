// Port of org/agrona/collections/ArrayUtilTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { ArrayUtil } from '../../../src/agrona/collections/ArrayUtil.js';

describe('ArrayUtilTest', () => {
    // Reference Equality
    const ONE = 1;
    const TWO = 2;
    const THREE = 3;

    const values = [ONE, TWO];

    it('shouldNotRemoveMissingElement', () => {
        const result = ArrayUtil.remove(values, THREE);

        expect(result).toEqual(values);
    });

    it('shouldRemovePresentElementAtEnd', () => {
        const result = ArrayUtil.remove(values, TWO);

        expect(result).toEqual([ONE]);
    });

    it('shouldRemovePresentElementAtStart', () => {
        const result = ArrayUtil.remove(values, ONE);

        expect(result).toEqual([TWO]);
    });

    it('shouldRemoveByIndex', () => {
        const result = ArrayUtil.removeAt(values, 0);

        expect(result).toEqual([TWO]);
    });
});
