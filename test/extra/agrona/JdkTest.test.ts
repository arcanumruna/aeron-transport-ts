// Not in Agrona: the JDK stand-ins in src/agrona/jdk.ts and the DataView long helpers.
import { describe, expect, it } from 'vitest';
import { Strings } from '../../../src/agrona/Strings.js';
import {
    Character,
    dataViewGetLong,
    dataViewSetLong,
    IndexOutOfBoundsException,
    Integer,
    Long,
    LongOverflowError,
    newStringAscii,
    NumberFormatException,
    Objects,
    TimeUnit,
} from '../../../src/agrona/jdk.js';
import { assertThrows } from '../../support/Assertions.js';

const SAFE = BigInt(Long.MAX_VALUE);
const LONGS: bigint[] = [
    0n,
    1n,
    -1n,
    255n,
    256n,
    -256n,
    0x7fffffffn,
    0x80000000n,
    0xffffffffn,
    0x100000000n,
    -0x100000000n,
    -0x100000001n,
    0x123456789abcdn,
    -0x123456789abcdn,
    SAFE,
    -SAFE,
    SAFE - 1n,
    -SAFE + 1n,
];

describe('dataViewGetLong / dataViewSetLong', () => {
    for (const littleEndian of [true, false]) {
        const order = littleEndian ? 'LE' : 'BE';

        it(`roundTripsBoundaryLongs ${order}`, () => {
            const view = new DataView(new ArrayBuffer(24));
            for (const value of LONGS) {
                dataViewSetLong(view, 8, Number(value), littleEndian);

                expect(view.getBigInt64(8, littleEndian)).toBe(value);
                expect(dataViewGetLong(view, 8, littleEndian)).toBe(Number(value));
            }
        });

        it(`readsLongsWrittenAsRawBytes ${order}`, () => {
            const view = new DataView(new ArrayBuffer(24));
            for (const value of LONGS) {
                view.setBigInt64(8, value, littleEndian);

                expect(dataViewGetLong(view, 8, littleEndian)).toBe(Number(value));
            }
        });

        it(`readsAStoredLongOutsideTheSafeRangeAsLongOverflowError ${order}`, () => {
            const view = new DataView(new ArrayBuffer(16));
            for (const value of [
                -(2n ** 63n),
                2n ** 63n - 1n,
                2n ** 53n,
                -(2n ** 53n),
                -(2n ** 53n) - 1n,
                2n ** 53n + 1n,
            ]) {
                view.setBigInt64(0, value, littleEndian);

                const error = assertThrows(LongOverflowError, () => dataViewGetLong(view, 0, littleEndian));
                expect(error.value).toBe(value);
            }
        });

        it(`writesNothingForAnUnsafeValue ${order}`, () => {
            const view = new DataView(new ArrayBuffer(16));
            view.setBigInt64(0, 0x0102030405060708n, littleEndian);
            const before = new Uint8Array(view.buffer.slice(0));
            for (const value of [2 ** 53, -(2 ** 53), 2 ** 63, NaN, Infinity, -Infinity, 1.5, 0.1]) {
                expect(() => dataViewSetLong(view, 0, value, littleEndian)).toThrow(RangeError);
                expect(new Uint8Array(view.buffer)).toEqual(before);
            }
        });
    }

    it('storesTheHighWordSignedWithFloorForNegativeValues', () => {
        const view = new DataView(new ArrayBuffer(8));

        dataViewSetLong(view, 0, -1, true);
        expect(view.getUint32(0, true)).toBe(0xffffffff);
        expect(view.getInt32(4, true)).toBe(-1);

        dataViewSetLong(view, 0, -0x100000001, true);
        expect(view.getUint32(0, true)).toBe(0xffffffff);
        expect(view.getInt32(4, true)).toBe(-2);

        dataViewSetLong(view, 0, -0x100000000, false);
        expect(view.getInt32(0, false)).toBe(-1);
        expect(view.getUint32(4, false)).toBe(0);
    });

    it('readsTheLowWordUnsigned', () => {
        const view = new DataView(new ArrayBuffer(8));
        view.setUint32(0, 0x80000000, true);
        view.setInt32(4, 1, true);

        expect(dataViewGetLong(view, 0, true)).toBe(0x180000000);
    });
});

describe('Long', () => {
    it('andMatchesTheSixtyFourBitAnd', () => {
        const values = [...LONGS, 0x7fffffffffffn, -0x7fffffffffffn, 0x40000000n, -64n, -8n, 63n, 0x1fffffffffffffn];
        for (const a of values) {
            for (const b of values) {
                expect(Long.and(Number(a), Number(b))).toBe(Number(BigInt.asIntN(64, a & b)));
            }
        }
    });

    it('numberOfLeadingZerosOfANumber', () => {
        expect(Long.numberOfLeadingZeros(0)).toBe(64);
        expect(Long.numberOfLeadingZeros(1)).toBe(63);
        expect(Long.numberOfLeadingZeros(2)).toBe(62);
        expect(Long.numberOfLeadingZeros(0x7fffffff)).toBe(33);
        expect(Long.numberOfLeadingZeros(0xffffffff)).toBe(32);
        expect(Long.numberOfLeadingZeros(0x100000000)).toBe(31);
        expect(Long.numberOfLeadingZeros(2 ** 52)).toBe(11);
        expect(Long.numberOfLeadingZeros(Long.MAX_VALUE)).toBe(11);
        expect(Long.numberOfLeadingZeros(-1)).toBe(0);
        expect(Long.numberOfLeadingZeros(-(2 ** 40))).toBe(0);
    });

    it('numberOfLeadingZerosOfABigInt', () => {
        expect(Long.numberOfLeadingZeros(0n)).toBe(64);
        expect(Long.numberOfLeadingZeros(1n)).toBe(63);
        expect(Long.numberOfLeadingZeros(0xffffffffn)).toBe(32);
        expect(Long.numberOfLeadingZeros(0x100000000n)).toBe(31);
        expect(Long.numberOfLeadingZeros(2n ** 63n - 1n)).toBe(1);
        expect(Long.numberOfLeadingZeros(-1n)).toBe(0);
        expect(Long.numberOfLeadingZeros(-(2n ** 63n))).toBe(0);
    });

    it('checkSafeAcceptsTheBoundsAndRefusesTheRest', () => {
        expect(Long.checkSafe(Long.MAX_VALUE)).toBe(Long.MAX_VALUE);
        expect(Long.checkSafe(Long.MIN_VALUE)).toBe(Long.MIN_VALUE);
        expect(() => Long.checkSafe(2 ** 53)).toThrow(RangeError);
        expect(() => Long.checkSafe(-(2 ** 53))).toThrow(RangeError);
        expect(() => Long.checkSafe(0.5)).toThrow(RangeError);
    });

    it('compare', () => {
        expect(Long.compare(1, 2)).toBe(-1);
        expect(Long.compare(2, 2)).toBe(0);
        expect(Long.compare(3, 2)).toBe(1);
    });
});

describe('Integer', () => {
    it('parseIntAcceptsADecimalWithAnOptionalSign', () => {
        expect(Integer.parseInt('0')).toBe(0);
        expect(Integer.parseInt('+5')).toBe(5);
        expect(Integer.parseInt('-5')).toBe(-5);
        expect(Object.is(Integer.parseInt('-0'), 0)).toBe(true);
        expect(Integer.parseInt('2147483647')).toBe(2147483647);
        expect(Integer.parseInt('-2147483648')).toBe(-2147483648);
        expect(Integer.parseInt('0007')).toBe(7);
    });

    it('parseIntRefusesWhatJavaRefuses', () => {
        for (const value of [
            '',
            '+',
            '-',
            '2147483648',
            '-2147483649',
            ' 1',
            '1 ',
            '1.0',
            '0x1',
            'a',
            '1_0',
            '99999999999999999999',
        ]) {
            const error = assertThrows(NumberFormatException, () => Integer.parseInt(value));
            expect(error.message).toBe('For input string: "' + value + '"');
        }

        expect(assertThrows(NumberFormatException, () => Integer.parseInt(null)).message).toBe(
            'Cannot parse null string: null',
        );
    });

    it('compareToHexStringAndLeadingZeros', () => {
        expect(Integer.compare(1, 2)).toBe(-1);
        expect(Integer.compare(2, 2)).toBe(0);
        expect(Integer.compare(3, 2)).toBe(1);
        expect(Integer.toHexString(-1)).toBe('ffffffff');
        expect(Integer.toHexString(255)).toBe('ff');
        expect(Integer.numberOfLeadingZeros(0)).toBe(32);
        expect(Integer.numberOfLeadingZeros(-1)).toBe(0);
        expect(Integer.numberOfLeadingZeros(1)).toBe(31);
    });
});

describe('Strings', () => {
    it('isEmpty', () => {
        expect(Strings.isEmpty(null)).toBe(true);
        expect(Strings.isEmpty(undefined)).toBe(true);
        expect(Strings.isEmpty('')).toBe(true);
        expect(Strings.isEmpty(' ')).toBe(false);
        expect(Strings.isEmpty('0')).toBe(false);
    });

    it('parseIntOrDefault', () => {
        expect(Strings.parseIntOrDefault(null, 7)).toBe(7);
        expect(Strings.parseIntOrDefault(undefined, 7)).toBe(7);
        expect(Strings.parseIntOrDefault('12', 7)).toBe(12);
        expect(Strings.parseIntOrDefault('-12', 7)).toBe(-12);
        expect(() => Strings.parseIntOrDefault('', 7)).toThrow(NumberFormatException);
        expect(() => Strings.parseIntOrDefault('x', 7)).toThrow(NumberFormatException);
    });
});

describe('Character.isDigit', () => {
    it('matchesTheUnicodeDecimalDigitCategoryForEveryCodeUnit', () => {
        for (let ch = 0; ch < 0x10000; ch++) {
            expect(Character.isDigit(ch), ch.toString(16)).toBe(/^\p{Nd}$/u.test(String.fromCharCode(ch)));
        }
    });

    it('acceptsNonAsciiDigitsAndRefusesTheNeighboursOfTheAsciiOnes', () => {
        expect(Character.isDigit(0x30)).toBe(true);
        expect(Character.isDigit(0x39)).toBe(true);
        expect(Character.isDigit(0x2f)).toBe(false);
        expect(Character.isDigit(0x3a)).toBe(false);
        expect(Character.isDigit(0x663)).toBe(true);
        expect(Character.isDigit(0xff13)).toBe(true);
        expect(Character.isDigit(0xd800)).toBe(false);
    });
});

describe('newStringAscii', () => {
    it('decodesAWindowAndReplacesBytesAbove127', () => {
        const bytes = new Uint8Array([0x61, 0x62, 0x80, 0xff, 0x7f, 0x63]);

        expect(newStringAscii(bytes, 0, 6)).toBe('ab��\x7fc');
        expect(newStringAscii(bytes, 1, 3)).toBe('b��');
        expect(newStringAscii(bytes, 2, 0)).toBe('');
    });
});

describe('TimeUnit', () => {
    it('toNanosSaturates', () => {
        expect(TimeUnit.NANOSECONDS.toNanos(5)).toBe(5);
        expect(TimeUnit.MINUTES.toNanos(1)).toBe(60e9);
        expect(TimeUnit.DAYS.toNanos(1)).toBe(86.4e12);
        expect(TimeUnit.DAYS.toNanos(104)).toBe(8985600000000000);
        expect(TimeUnit.DAYS.toNanos(105)).toBe(Long.MAX_VALUE);
        expect(TimeUnit.DAYS.toNanos(106752)).toBe(Long.MAX_VALUE);
        expect(TimeUnit.MICROSECONDS.toNanos(5)).toBe(5000);
        expect(TimeUnit.MILLISECONDS.toNanos(5)).toBe(5_000_000);
        expect(TimeUnit.SECONDS.toNanos(5)).toBe(5_000_000_000);
        expect(TimeUnit.SECONDS.toNanos(9007199)).toBe(9007199000000000);
        expect(TimeUnit.SECONDS.toNanos(9007200)).toBe(Long.MAX_VALUE);
        expect(TimeUnit.SECONDS.toNanos(-9007200)).toBe(Long.MIN_VALUE);
        expect(TimeUnit.MICROSECONDS.toNanos(9007199254741)).toBe(Long.MAX_VALUE);
    });
});

describe('Objects.checkFromIndexSize', () => {
    it('acceptsTheWholeRangeAndRefusesTheRest', () => {
        expect(Objects.checkFromIndexSize(2, 6, 8)).toBe(2);
        expect(Objects.checkFromIndexSize(8, 0, 8)).toBe(8);
        expect(Objects.checkFromIndexSize(0, 0, 0)).toBe(0);
        const error = assertThrows(IndexOutOfBoundsException, () => Objects.checkFromIndexSize(2, 7, 8));
        expect(error.message).toBe('Range [2, 2 + 7) out of bounds for length 8');
        expect(() => Objects.checkFromIndexSize(-1, 0, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => Objects.checkFromIndexSize(0, -1, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => Objects.checkFromIndexSize(0, 0, -1)).toThrow(IndexOutOfBoundsException);
        expect(() => Objects.checkFromIndexSize(2 ** 40, 1, 8)).toThrow(IndexOutOfBoundsException);
        expect(() => Objects.checkFromIndexSize(2 ** 53 - 4, 10, 8)).toThrow(IndexOutOfBoundsException);
    });
});
