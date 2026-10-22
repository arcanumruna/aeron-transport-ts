// Not in Agrona: cases the Java AsciiEncodingTest does not have, and the index checks of charAt.
import { describe, expect, it } from 'vitest';
import { AsciiEncoding } from '../../../src/agrona/AsciiEncoding.js';
import { AsciiNumberFormatException } from '../../../src/agrona/AsciiNumberFormatException.js';
import {
    Integer,
    IndexOutOfBoundsException,
    Long,
    LongOverflowError,
    StringIndexOutOfBoundsException,
} from '../../../src/agrona/jdk.js';
import { assertParsedLong, assertThrows } from '../../support/Assertions.js';
import { mulberry32 } from '../../support/Random.js';

const { parseIntAscii, parseLongAscii } = AsciiEncoding;

const parseLong = (s: string): number => parseLongAscii(s, 0, s.length);
const parseInt_ = (s: string): number => parseIntAscii(s, 0, s.length);

describe('AsciiEncodingExtra', () => {
    it('isDigitRefusesTheNeighboursOfZeroAndNine', () => {
        for (const [code, expected] of [
            [0x2f, false],
            [0x30, true],
            [0x39, true],
            [0x3a, false],
            [-1, false],
            [0xff, false],
        ] as const) {
            expect(AsciiEncoding.isDigit(code)).toBe(expected);
        }
    });

    it('getDigitMessageDistinguishesAByteFromAChar', () => {
        expect(assertThrows(AsciiNumberFormatException, () => AsciiEncoding.getDigit(3, 0x3a)).message).toBe(
            "':' is not a valid digit @ 3",
        );
        expect(assertThrows(AsciiNumberFormatException, () => AsciiEncoding.getDigit(0, 0x2f)).message).toBe(
            "'/' is not a valid digit @ 0",
        );
        // a byte -56 is the char U+FFC8 in Java, the char 200 is U+00C8
        expect(assertThrows(AsciiNumberFormatException, () => AsciiEncoding.getDigit(0, -56)).message).toBe(
            "'￈' is not a valid digit @ 0",
        );
        expect(assertThrows(AsciiNumberFormatException, () => AsciiEncoding.getDigit(0, 200)).message).toBe(
            "'È' is not a valid digit @ 0",
        );
        expect(AsciiEncoding.getDigit(0, 0x30)).toBe(0);
        expect(AsciiEncoding.getDigit(0, 0x39)).toBe(9);
    });

    it('parseIntRefusesColonAndSlashInAnyPosition', () => {
        for (const s of ['1:3', ':', '/1', '12/', '1234:', '12345678:', '123456789:', '1234567890:', '12345:78']) {
            expect(assertThrows(AsciiNumberFormatException, () => parseInt_(s)).message).toContain(s);
        }
        expect(assertThrows(AsciiNumberFormatException, () => parseInt_('1:3')).message).toBe('error parsing int: 1:3');
        expect(assertThrows(AsciiNumberFormatException, () => parseLong('12345678:')).message).toBe(
            'error parsing long: 12345678:',
        );
        expect(assertThrows(AsciiNumberFormatException, () => parseLong('1234567890123456:')).message).toBe(
            'error parsing long: 1234567890123456:',
        );
        expect(assertThrows(AsciiNumberFormatException, () => parseLong('123456789012345678:')).message).toBe(
            'error parsing long: 123456789012345678:',
        );
    });

    it('parseIntAtEveryDigitCountAndWithLeadingZeros', () => {
        for (const s of [
            '0',
            '9',
            '10',
            '99',
            '123',
            '1234',
            '12345',
            '123456',
            '1234567',
            '12345678',
            '123456789',
            '2147483647',
            '0000000001',
            '0002147483',
        ]) {
            expect(parseInt_(s)).toBe(Number(s));
            expect(parseInt_('-' + s)).toBe(-Number(s) + 0);
        }
        expect(parseInt_('0000000000')).toBe(0);
        expect(parseIntAscii('x1234567890y', 1, 10)).toBe(1234567890);
        expect(parseIntAscii('x-1234567890y', 1, 11)).toBe(-1234567890);
    });

    it('parseLongAtEveryDigitCount', () => {
        for (let digits = 1; digits <= 16; digits++) {
            if (digits < 16) {
                const s = '9'.repeat(digits);
                expect(parseLong(s)).toBe(Number(s));
                expect(parseLong('-' + s)).toBe(-Number(s));
            }
            const t = '1' + '0'.repeat(digits - 1);
            expect(parseLong(t)).toBe(Number(t));
            expect(parseLong('-' + t)).toBe(-Number(t));
        }
        expect(parseLong('9007199254740991')).toBe(Long.MAX_VALUE);
        expect(parseLong('-9007199254740991')).toBe(Long.MIN_VALUE);
        expect(parseLong('0000000000000000001')).toBe(1);
        expect(parseLong('-0000000000000000001')).toBe(-1);
        expect(parseLong('00000000000000000009007199254740991'.slice(0, 19))).toBe(0);
        expect(parseLong('0009007199254740991')).toBe(Long.MAX_VALUE);
        expect(parseLongAscii('x123456789012y', 1, 12)).toBe(123456789012);
    });

    it('parseLongOutsideTheSafeRangeCarriesTheExactJavaValue', () => {
        const cases: [string, bigint][] = [
            ['9007199254740992', 9007199254740992n],
            ['-9007199254740992', -9007199254740992n],
            ['9999999999999999', 9999999999999999n],
            ['12345678901234567', 12345678901234567n],
            ['-12345678901234567', -12345678901234567n],
            ['123456789012345678', 123456789012345678n],
            ['1000000000000000000', 1000000000000000000n],
            ['-1000000000000000000', -1000000000000000000n],
            ['9223372036854775807', 9223372036854775807n],
            ['9223372036854775806', 9223372036854775806n],
            ['-9223372036854775807', -9223372036854775807n],
            ['-9223372036854775808', -9223372036854775808n],
            ['8000000000000000000', 8000000000000000000n],
        ];
        for (const [s, expected] of cases) {
            assertParsedLong(expected, () => parseLong(s));
            expect(assertThrows(LongOverflowError, () => parseLong(s)).value).toBe(expected);
        }
    });

    it('parseLongRefusesWhatOverflowsAJavaLong', () => {
        for (const s of [
            '9223372036854775808',
            '-9223372036854775809',
            '99999999999999999999',
            '10000000000000000000',
            '9300000000000000000',
            '9223372036854775810',
        ]) {
            expect(assertThrows(AsciiNumberFormatException, () => parseLong(s)).message).toBe(
                'long overflow parsing: ' + s,
            );
        }
    });

    it('parseIntRefusesWhatOverflowsAnInt', () => {
        for (const s of ['2147483648', '-2147483649', '99999999999', '9999999999']) {
            expect(assertThrows(AsciiNumberFormatException, () => parseInt_(s)).message).toBe(
                'int overflow parsing: ' + s,
            );
        }
        expect(parseInt_('-2147483648')).toBe(Integer.MIN_VALUE);
    });

    it('digitCountOfAnIntAtEveryBoundary', () => {
        expect(AsciiEncoding.digitCount(0)).toBe(1);
        let power = 1;
        for (let digits = 1; digits <= 10; digits++) {
            const next = power * 10;
            expect(AsciiEncoding.digitCount(power)).toBe(digits);
            expect(AsciiEncoding.digitCount(Math.min(next - 1, Integer.MAX_VALUE))).toBe(digits);
            power = next;
        }
    });

    it('digitCountLongAtEveryBoundaryForANumberAndABigInt', () => {
        const d = AsciiEncoding.digitCountLong;
        expect(d(0)).toBe(1);
        expect(d(0n)).toBe(1);
        for (let digits = 1; digits <= 16; digits++) {
            const low = 10 ** (digits - 1);
            const high = 10 ** digits - 1;
            expect(d(low)).toBe(digits);
            expect(d(low + 1)).toBe(digits);
            expect(d(Math.min(high, Long.MAX_VALUE))).toBe(digits);
            expect(d(BigInt(low))).toBe(digits);
            expect(d(BigInt(Math.min(high, Long.MAX_VALUE)))).toBe(digits);
            if (digits > 1) {
                expect(d(low - 1)).toBe(digits - 1);
                expect(d(BigInt(low) - 1n)).toBe(digits - 1);
            }
        }
        expect(d(2 ** 53 - 1)).toBe(16);
        expect(d(2 ** 52)).toBe(16);
        expect(d(2 ** 40)).toBe(13);
        expect(d(2 ** 32)).toBe(10);
        expect(d(2 ** 32 - 1)).toBe(10);
        expect(d(999999999)).toBe(9);
        expect(d(2n ** 63n - 1n)).toBe(19);
        expect(d(10n ** 18n)).toBe(19);
        expect(d(10n ** 18n - 1n)).toBe(18);
    });

    it('digitCountLongAgreesWithTheStringLengthForRandomNumbers', () => {
        const random = mulberry32(0x5eed01);
        for (let i = 0; i < 20000; i++) {
            const value = Math.floor(random() * 2 ** Math.floor(random() * 53));
            expect(AsciiEncoding.digitCountLong(value)).toBe(String(value).length);
        }
    });

    it('digitCountLongOfANegativeNumberIsThatOfItsBigintAndOfLongMinValue', () => {
        // Java: a negative long has 19 digits (its bits are those of an unsigned value above 2^63)
        expect(AsciiEncoding.digitCountLong(-1)).toBe(AsciiEncoding.digitCountLong(-1n));
        expect(AsciiEncoding.digitCountLong(-1)).toBe(19);
        expect(AsciiEncoding.digitCountLong(-1n)).toBe(19);
    });

    it('aCharAbove255SpillsIntoTheNextByteAsInJava', () => {
        // 'ĳ' is U+0133: in Java's readEightBytesLittleEndian its bit 8 is or-ed into the byte of '4' (0x34 -> 0x35),
        // and its low byte 0x33 reads as '3': 1,2,3,3,5,5,6,7. In readFourBytesLittleEndian (int) the bit is shifted out.
        expect(AsciiEncoding.parseLongAscii('123ĳ4567', 0, 8)).toBe(12335567);
        expect(AsciiEncoding.parseIntAscii('123ĳ4567', 0, 8)).toBe(12334567);
    });

    it('endOffset', () => {
        expect(AsciiEncoding.endOffset(1234)).toBe(3);
        expect(AsciiEncoding.endOffsetLong(1234567890123)).toBe(12);
        expect(AsciiEncoding.endOffsetLong(10n ** 18n)).toBe(18);
    });

    it('theFourAndEightDigitChecksRefuseEveryNeighbourOfTheDigits', () => {
        const c0 = 0x30;
        for (const bad of [0x2f, 0x3a, 0x00, 0x80, 0xff, 0xb9, 0xba]) {
            for (let position = 0; position < 4; position++) {
                const bytes = [c0 + 1, c0 + 2, c0 + 3, c0 + 4];
                bytes[position] = bad;
                const word = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24);
                expect(AsciiEncoding.isFourDigitsAsciiEncodedNumber(word)).toBe(false);
            }
            for (let position = 0; position < 8; position++) {
                const bytes = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => c0 + d);
                bytes[position] = bad;
                let word = 0n;
                for (let i = 7; i >= 0; i--) {
                    word = (word << 8n) | BigInt(bytes[i]!);
                }
                expect(AsciiEncoding.isEightDigitAsciiEncodedNumber(BigInt.asIntN(64, word))).toBe(false);
            }
        }
        expect(AsciiEncoding.isFourDigitsAsciiEncodedNumber(0x39393939)).toBe(true);
        expect(AsciiEncoding.isFourDigitsAsciiEncodedNumber(0x30303030)).toBe(true);
        expect(AsciiEncoding.isEightDigitAsciiEncodedNumber(0x3939393939393939n)).toBe(true);
        expect(AsciiEncoding.isEightDigitAsciiEncodedNumber(0x3030303030303030n)).toBe(true);
    });

    it('parseFourAndEightDigitsLittleEndian', () => {
        expect(AsciiEncoding.parseFourDigitsLittleEndian(0x34333231)).toBe(1234);
        expect(AsciiEncoding.parseFourDigitsLittleEndian(0x39393939)).toBe(9999);
        expect(AsciiEncoding.parseFourDigitsLittleEndian(0x30303030)).toBe(0);
        expect(AsciiEncoding.parseEightDigitsLittleEndian(0x3837363534333231n)).toBe(12345678);
        expect(AsciiEncoding.parseEightDigitsLittleEndian(0x3939393939393939n)).toBe(99999999);
        expect(AsciiEncoding.parseEightDigitsLittleEndian(0x3030303030303030n)).toBe(0);
        expect(AsciiEncoding.parseEightDigitsLittleEndian(0x3030303030303031n)).toBe(10000000);
        expect(AsciiEncoding.parseEightDigitsLittleEndian(0x3130303030303030n)).toBe(1);
        expect(AsciiEncoding.parseEightDigitsLittleEndianWords(0x34333231, 0x38373635)).toBe(56781234);
    });

    it('theWordVersionsOfTheEightDigitHelpersAgreeWithTheLongVersions', () => {
        const cases: bigint[] = [
            0x3939393939393939n,
            0x3030303030303030n,
            0x30303030ffffffffn,
            0xffffffff30303030n,
            0x3939393900000000n,
        ];
        const random = mulberry32(0x5eed02);
        for (let i = 0; i < 20000; i++) {
            let word = 0n;
            for (let b = 0; b < 8; b++) {
                // mostly digits, with a bad byte now and then, so that carries and borrows occur
                const digit = random() < 0.9 ? 0x30 + Math.floor(random() * 10) : Math.floor(random() * 256);
                word = (word << 8n) | BigInt(digit);
            }
            cases.push(word);
        }
        for (const word of cases) {
            const high = Number(BigInt.asIntN(32, word >> 32n));
            const low = Number(BigInt.asIntN(32, word));
            const signed = BigInt.asIntN(64, word);
            const expected = AsciiEncoding.isEightDigitAsciiEncodedNumber(signed);
            expect(AsciiEncoding.isEightDigitAsciiEncodedNumberWords(high, low), word.toString(16)).toBe(expected);
            if (expected) {
                expect(AsciiEncoding.parseEightDigitsLittleEndianWords(high, low)).toBe(
                    AsciiEncoding.parseEightDigitsLittleEndian(signed),
                );
            }
        }
    });

    it('constants', () => {
        expect(AsciiEncoding.INT_MAX_DIGITS).toBe(10);
        expect(AsciiEncoding.LONG_MAX_DIGITS).toBe(19);
        expect(AsciiEncoding.INTEGER_ABSOLUTE_MIN_VALUE).toBe(2147483648);
        expect(new TextDecoder().decode(AsciiEncoding.MIN_INTEGER_VALUE)).toBe('-2147483648');
        expect(new TextDecoder().decode(AsciiEncoding.MAX_INTEGER_VALUE)).toBe('2147483647');
        expect(new TextDecoder().decode(AsciiEncoding.MIN_LONG_VALUE)).toBe('-9223372036854775808');
        expect(new TextDecoder().decode(AsciiEncoding.MAX_LONG_VALUE)).toBe('9223372036854775807');
        expect(AsciiEncoding.MINUS_SIGN).toBe(45);
        expect(AsciiEncoding.ZERO).toBe(48);
        expect(Array.from(AsciiEncoding.ASCII_DIGITS.slice(0, 6))).toEqual([48, 48, 48, 49, 48, 50]);
        expect(Array.from(AsciiEncoding.ASCII_DIGITS.slice(198))).toEqual([57, 57]);
        expect(AsciiEncoding.ASCII_DIGITS.length).toBe(200);
        expect(Array.from(AsciiEncoding.LONG_MAX_VALUE_DIGITS)).toEqual([92233720, 36854775, 807]);
        expect(Array.from(AsciiEncoding.LONG_MIN_VALUE_DIGITS)).toEqual([92233720, 36854775, 808]);
        expect(AsciiEncoding.LONG_POW_10.map(String)).toEqual(
            Array.from({ length: 19 }, (_, i) => '1' + '0'.repeat(i)),
        );
        expect(AsciiEncoding.INT_POW_10.map(String)).toEqual(Array.from({ length: 10 }, (_, i) => '1' + '0'.repeat(i)));
    });

    describe('index checks, where Java charAt and subSequence throw', () => {
        it('parseIntAscii', () => {
            expect(() => parseIntAscii('12', 2, 1)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseIntAscii('12', -1, 1)).toThrow(StringIndexOutOfBoundsException);
            // the loop reaches charAt(2)
            expect(() => parseIntAscii('12', 0, 3)).toThrow(StringIndexOutOfBoundsException);
            // the four-digit read reaches charAt(3)
            expect(() => parseIntAscii('12', 0, 5)).toThrow(StringIndexOutOfBoundsException);
            // the eight-byte read of the 10-digit path
            expect(() => parseIntAscii('123456789', 0, 10)).toThrow(StringIndexOutOfBoundsException);
            // the error message needs subSequence(0, 3) of a one character string
            expect(() => parseIntAscii('a', 0, 3)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseIntAscii('-', 0, 2)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseIntAscii('12', 0, 3)).toThrow(IndexOutOfBoundsException);
            expect(parseIntAscii('12', 0, 2)).toBe(12);
            expect(parseIntAscii('12', 1, 1)).toBe(2);
        });

        it('parseLongAscii', () => {
            expect(() => parseLongAscii('12', 2, 1)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('12', -1, 1)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('12', 0, 3)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('12', 0, 9)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('1234567', 0, 8)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('123456789012345678', 0, 19)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('a', 0, 3)).toThrow(StringIndexOutOfBoundsException);
            expect(() => parseLongAscii('', 0, 1)).toThrow(StringIndexOutOfBoundsException);
            expect(parseLongAscii('12', 0, 2)).toBe(12);
        });

        it('theMessageIsJavas', () => {
            expect(assertThrows(StringIndexOutOfBoundsException, () => parseIntAscii('12', 2, 1)).message).toBe(
                'Index 2 out of bounds for length 2',
            );
            expect(assertThrows(StringIndexOutOfBoundsException, () => parseIntAscii('a', 0, 3)).message).toBe(
                'begin 0, end 3, length 1',
            );
        });
    });
});
