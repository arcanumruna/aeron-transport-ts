// Not in Agrona or Aeron: the system property stand-ins of T7b (`System`, `Integer.getInteger`, `Long.getLong`,
// `Boolean.getBoolean`, `Math.multiplyExact` as `multiplyExact`) and `SystemUtil.getSizeAsInt`, `getSizeAsLong` and
// `getDurationInNanos`. Each test names the mutation of the port that turns it red.
import { afterEach, describe, expect, it } from 'vitest';
import {
    ArithmeticException,
    Boolean,
    Integer,
    Long,
    LongOverflowError,
    multiplyExact,
    NumberFormatException,
    TimeUnit,
} from '../../../src/agrona/jdk.js';
import { System } from '../../../src/agrona/jdkLang.js';
import { SystemUtil } from '../../../src/agrona/SystemUtil.js';
import { assertThrows, assertThrowsExactly } from '../../support/Assertions.js';

const KEY = 'aeron.test.system.properties.extra';

describe('SystemPropertiesExtraTest', () => {
    afterEach(() => {
        System.clearProperty(KEY);
    });

    describe('System', () => {
        it('aPropertyIsNullUntilItIsSet', () => {
            // mutation: getProperty returns "" or undefined for a missing key
            expect(System.getProperty(KEY)).toBeNull();
        });

        it('getPropertyReturnsTheDefaultOnlyWhenTheKeyIsMissing', () => {
            // mutation: the default wins over a set value, or an empty value counts as missing
            expect(System.getProperty(KEY, 'dflt')).toBe('dflt');
            System.setProperty(KEY, '');
            expect(System.getProperty(KEY, 'dflt')).toBe('');
            System.setProperty(KEY, 'v');
            expect(System.getProperty(KEY, 'dflt')).toBe('v');
        });

        it('setPropertyAndClearPropertyReturnThePreviousValueOrNull', () => {
            // mutation: setProperty returns the new value, or clearProperty returns nothing
            expect(System.setProperty(KEY, 'a')).toBeNull();
            expect(System.setProperty(KEY, 'b')).toBe('a');
            expect(System.clearProperty(KEY)).toBe('b');
            expect(System.clearProperty(KEY)).toBeNull();
            expect(System.getProperty(KEY)).toBeNull();
        });

        it('theEnvironmentIsNeverRead', () => {
            // mutation: getProperty falls back to process.env
            process.env['AERON_TEST_ENV_ONLY'] = 'x';
            try {
                expect(System.getProperty('AERON_TEST_ENV_ONLY')).toBeNull();
            } finally {
                delete process.env['AERON_TEST_ENV_ONLY'];
            }
        });
    });

    describe('Integer.getInteger', () => {
        it.each([
            ['10', 10],
            ['-10', -10],
            ['+10', 10],
            ['0', 0],
            ['0x10', 16],
            ['0X1f', 31],
            ['#ff', 255],
            ['-0x10', -16],
            ['010', 8],
            ['-010', -8],
            ['2147483647', 2147483647],
            ['-2147483648', -2147483648],
        ])('decodes %s as %i', (text, expected) => {
            // mutation: the radix prefix is ignored (decimal parse), or the sign is dropped
            System.setProperty(KEY, text);
            expect(Integer.getInteger(KEY, 99)).toBe(expected);
        });

        it.each(['', ' 1', '1 ', 'abc', '0x', '#', '--1', '+-1', '0x-1', '09', '2147483648', '-2147483649', '1.5'])(
            'returns the default for the malformed or out of range value "%s"',
            (text) => {
                // mutation: the range check is dropped, or a NumberFormatException escapes
                System.setProperty(KEY, text);
                expect(Integer.getInteger(KEY, 99)).toBe(99);
            },
        );

        it('returnsTheDefaultForAMissingPropertyAndNullWithoutOne', () => {
            expect(Integer.getInteger(KEY, 7)).toBe(7);
            expect(Integer.getInteger(KEY)).toBeNull();
            expect(Integer.getInteger(KEY, null)).toBeNull();
        });
    });

    describe('Long.getLong', () => {
        it.each([
            ['10', 10],
            ['0x10', 16],
            ['#ff', 255],
            ['010', 8],
            ['-9007199254740991', -9007199254740991],
            ['9007199254740991', 9007199254740991],
            ['0x1fffffffffffff', 9007199254740991],
        ])('decodes %s as %i', (text, expected) => {
            System.setProperty(KEY, text);
            expect(Long.getLong(KEY, 99)).toBe(expected);
        });

        it.each(['', 'abc', '0x', '9223372036854775808', '-9223372036854775809', '0x8000000000000000'])(
            'returns the default for the malformed or out of Java long range value "%s"',
            (text) => {
                // mutation: the range check is the safe range, so a Java NumberFormatException becomes a LongOverflowError
                System.setProperty(KEY, text);
                expect(Long.getLong(KEY, 99)).toBe(99);
                expect(Long.getLong(KEY, null)).toBeNull();
            },
        );

        it.each([
            ['9007199254740992', 9007199254740992n],
            ['-9007199254740992', -9007199254740992n],
            ['9223372036854775807', 9223372036854775807n],
            ['-9223372036854775808', -9223372036854775808n],
        ])('a value %s inside Java long but outside the safe range is a LongOverflowError (D5)', (text, exact) => {
            // mutation: the value is rounded to a double
            System.setProperty(KEY, text);
            const error = assertThrows(LongOverflowError, () => Long.getLong(KEY, 99));
            expect(error.value).toBe(exact);
        });

        it('returnsTheDefaultForAMissingProperty', () => {
            expect(Long.getLong(KEY, 7)).toBe(7);
            expect(Long.getLong(KEY, null)).toBeNull();
            expect(Long.getLong(KEY)).toBeNull();
        });
    });

    describe('Boolean.getBoolean', () => {
        it.each([
            ['true', true],
            ['TRUE', true],
            ['True', true],
            ['false', false],
            ['yes', false],
            ['1', false],
            ['', false],
            [' true', false],
        ])('"%s" is %s', (text, expected) => {
            // mutation: only the exact string "true" counts, or "yes"/"1" count
            System.setProperty(KEY, text);
            expect(Boolean.getBoolean(KEY)).toBe(expected);
        });

        it('aMissingPropertyIsFalse', () => {
            expect(Boolean.getBoolean(KEY)).toBe(false);
        });
    });

    describe('multiplyExact', () => {
        it.each([
            [0, 0, 0],
            [3, 4, 12],
            [-3, 4, -12],
            [-3, -4, 12],
            [94906265, 94906265, 9007199136250225],
            [1, 9007199254740991, 9007199254740991],
            [-1, 9007199254740991, -9007199254740991],
            [5000000000, 1, 5000000000],
        ])('%i * %i = %i', (a, b, expected) => {
            expect(multiplyExact(a, b)).toBe(expected);
        });

        it('aProductOutsideJavaLongIsAnArithmeticExceptionWithJavasMessage', () => {
            // mutation: the product is a double and is silently rounded, or the message differs
            const e = assertThrowsExactly(ArithmeticException, () => multiplyExact(5000000000, 1000000000000));
            expect(e.message).toBe('long overflow');
            assertThrowsExactly(ArithmeticException, () => multiplyExact(-5000000000, 1000000000000));
            assertThrowsExactly(ArithmeticException, () => multiplyExact(9007199254740991, 9007199254740991));
        });

        it('aProductInsideJavaLongButOutsideTheSafeRangeIsALongOverflowErrorWithTheExactValue', () => {
            // mutation: the check against Java's range is the safe range, so ArithmeticException is thrown instead
            const e = assertThrows(LongOverflowError, () => multiplyExact(9007199254740991, 1000));
            expect(e.value).toBe(9007199254740991000n);
            const n = assertThrows(LongOverflowError, () => multiplyExact(-9007199254740991, 1000));
            expect(n.value).toBe(-9007199254740991000n);
        });

        it('theBoundsOfJavasLongAreExact', () => {
            // 2^53 - 1 times 1024 is 2^63 - 1024: inside Java's long
            expect(() => multiplyExact(9007199254740991, 1024)).toThrow(LongOverflowError);
            // 3037000500^2 = 9223372037000250000 > 2^63 - 1
            assertThrowsExactly(ArithmeticException, () => multiplyExact(3037000500, 3037000500));
            // 3037000499^2 = 9223372030926249001 <= 2^63 - 1 but above the safe range
            const e = assertThrows(LongOverflowError, () => multiplyExact(3037000499, 3037000499));
            expect(e.value).toBe(9223372030926249001n);
        });
    });

    describe('SystemUtil property readers', () => {
        it('getSizeAsIntReturnsTheDefaultWhenTheKeyIsMissingAndParsesTheSuffixes', () => {
            // mutation: the suffix is ignored
            expect(SystemUtil.getSizeAsInt(KEY, 17)).toBe(17);
            System.setProperty(KEY, '4k');
            expect(SystemUtil.getSizeAsInt(KEY, 17)).toBe(4096);
            System.setProperty(KEY, '2m');
            expect(SystemUtil.getSizeAsInt(KEY, 17)).toBe(2 * 1024 * 1024);
            System.setProperty(KEY, '1g');
            expect(SystemUtil.getSizeAsInt(KEY, 17)).toBe(1024 * 1024 * 1024);
            System.setProperty(KEY, '2147483647');
            expect(SystemUtil.getSizeAsInt(KEY, 17)).toBe(Integer.MAX_VALUE);
        });

        it('getSizeAsIntRejectsAValueAboveIntegerMaxValueWithAgronasMessage', () => {
            // mutation: the bound is not checked, or the message differs
            System.setProperty(KEY, '2147483648');
            const e = assertThrowsExactly(NumberFormatException, () => SystemUtil.getSizeAsInt(KEY, 17));
            expect(e.message).toBe(KEY + ' must positive and less than Integer.MAX_VALUE: 2147483648');
            System.setProperty(KEY, '2g');
            assertThrowsExactly(NumberFormatException, () => SystemUtil.getSizeAsInt(KEY, 17));
        });

        it('getSizeAsIntRejectsMalformedAndNegativeValues', () => {
            for (const text of ['', '-1', '1x', 'k', '1.5k']) {
                System.setProperty(KEY, text);
                assertThrows(NumberFormatException, () => SystemUtil.getSizeAsInt(KEY, 17));
            }
        });

        it('getSizeAsLongReturnsTheDefaultOrParsesAndKeepsTheLongRange', () => {
            expect(SystemUtil.getSizeAsLong(KEY, 17)).toBe(17);
            System.setProperty(KEY, '3g');
            expect(SystemUtil.getSizeAsLong(KEY, 17)).toBe(3 * 1024 * 1024 * 1024);
            System.setProperty(KEY, '9007199254740991');
            expect(SystemUtil.getSizeAsLong(KEY, 17)).toBe(9007199254740991);
            System.setProperty(KEY, '9007199254740992');
            assertThrows(LongOverflowError, () => SystemUtil.getSizeAsLong(KEY, 17));
        });

        it('getDurationInNanosReturnsTheDefaultOrParsesTheSuffixes', () => {
            // mutation: the default is returned when the key is set, or the suffix scale is wrong
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(17);
            System.setProperty(KEY, '5');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(5);
            System.setProperty(KEY, '5ns');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(5);
            System.setProperty(KEY, '5us');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(5_000);
            System.setProperty(KEY, '5ms');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(5_000_000);
            System.setProperty(KEY, '5s');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(5_000_000_000);
        });

        it('getDurationInNanosSaturatesAtLongMaxValueAndRejectsNegativeAndMalformed', () => {
            System.setProperty(KEY, '9007199254740993s');
            expect(SystemUtil.getDurationInNanos(KEY, 17)).toBe(Long.MAX_VALUE);
            for (const text of ['', '-1s', '5x', 'ms', 's']) {
                System.setProperty(KEY, text);
                assertThrows(NumberFormatException, () => SystemUtil.getDurationInNanos(KEY, 17));
            }
        });
    });
});

describe('SystemPropertiesBatchDRegression', () => {
    afterEach(() => {
        System.clearProperty(KEY);
    });

    // issue #30 item 2: mutation: remove the LongOverflowError catch in getSizeAsInt
    it('getSizeAsIntOf2Pow53PlusOneIsAnAgronaNumberFormatExceptionRegression', () => {
        System.setProperty(KEY, '9007199254740993');
        const e = assertThrowsExactly(NumberFormatException, () => SystemUtil.getSizeAsInt(KEY, 1));
        expect(e.message).toBe(KEY + ' must positive and less than Integer.MAX_VALUE: 9007199254740993');
    });

    // issue #30 item 3: mutation: go through toNanos again
    it('timeUnitConvertsByTheRatioOfTheScalesRegression', () => {
        expect(TimeUnit.SECONDS.toMillis(1e10)).toBe(1e13);
        expect(TimeUnit.MILLISECONDS.convert(1e10, TimeUnit.SECONDS)).toBe(1e13);
        expect(TimeUnit.SECONDS.convert(1e13, TimeUnit.MILLISECONDS)).toBe(1e10);
        expect(TimeUnit.DAYS.toMillis(1e12)).toBe(Long.MAX_VALUE);
        expect(TimeUnit.DAYS.toMillis(-1e12)).toBe(Long.MIN_VALUE);
        expect(TimeUnit.NANOSECONDS.convert(-1e10, TimeUnit.SECONDS)).toBe(Long.MIN_VALUE);
        expect(TimeUnit.SECONDS.convert(-1_999_999_999, TimeUnit.NANOSECONDS)).toBe(-1);
        expect(TimeUnit.MILLISECONDS.toMillis(5)).toBe(5);
    });
});
