// Not in Aeron: the interaction matrix row for flyweights (plan, "Interaction matrix"): every field at 0, 1, max, -1
// and INT32_MIN, flags all set and none, `bigint` fields at 0, 2^63 - 1 and -2^63, and encode -> decode -> re-encode
// byte identity, for the four flyweights of T7.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IndexOutOfBoundsException } from '../../../../src/agrona/jdk.js';
import { AeronException, Category } from '../../../../src/client/exceptions/AeronException.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { assertThrows } from '../../../support/Assertions.js';

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const INTS = [0, 1, INT32_MAX, -1, INT32_MIN];
const LONGS = [0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)];

/** Bytes of a flyweight's window as an array, for exact comparison. */
function bytesOf(buffer: UnsafeBuffer, length: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < length; i++) {
        out.push(buffer.getByte(i) & 0xff);
    }
    return out;
}

function intLE(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function longLE(value: bigint): number[] {
    const u = BigInt.asUintN(64, value);
    const out: number[] = [];
    for (let i = 0n; i < 8n; i++) {
        out.push(Number((u >> (8n * i)) & 0xffn));
    }
    return out;
}

/** A small deterministic generator, so the random frames repeat on every run. */
function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
}

describe('HeaderFlyweight extra', () => {
    it('constants', () => {
        expect(HeaderFlyweight.HDR_TYPE_PAD).toBe(0x00);
        expect(HeaderFlyweight.HDR_TYPE_DATA).toBe(0x01);
        expect(HeaderFlyweight.HDR_TYPE_NAK).toBe(0x02);
        expect(HeaderFlyweight.HDR_TYPE_SM).toBe(0x03);
        expect(HeaderFlyweight.HDR_TYPE_ERR).toBe(0x04);
        expect(HeaderFlyweight.HDR_TYPE_SETUP).toBe(0x05);
        expect(HeaderFlyweight.HDR_TYPE_RTTM).toBe(0x06);
        expect(HeaderFlyweight.HDR_TYPE_RES).toBe(0x07);
        expect(HeaderFlyweight.HDR_TYPE_ATS_DATA).toBe(0x08);
        expect(HeaderFlyweight.HDR_TYPE_ATS_SM).toBe(0x09);
        expect(HeaderFlyweight.HDR_TYPE_ATS_SETUP).toBe(0x0a);
        expect(HeaderFlyweight.HDR_TYPE_RSP_SETUP).toBe(0x0b);
        expect(HeaderFlyweight.HDR_TYPE_EXT).toBe(0xffff);
        expect(HeaderFlyweight.CURRENT_VERSION).toBe(0);
        expect(HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET).toBe(0);
        expect(HeaderFlyweight.VERSION_FIELD_OFFSET).toBe(4);
        expect(HeaderFlyweight.FLAGS_FIELD_OFFSET).toBe(5);
        expect(HeaderFlyweight.TYPE_FIELD_OFFSET).toBe(6);
        expect(HeaderFlyweight.MIN_HEADER_LENGTH).toBe(8);
    });

    it.each(INTS)('frameLength %d is little-endian at offset 0', (value) => {
        const flyweight = new HeaderFlyweight(new Uint8Array(8));

        expect(flyweight.frameLength(value)).toBe(flyweight);
        expect(flyweight.frameLength()).toBe(value);
        expect(bytesOf(flyweight, 8)).toEqual([...intLE(value), 0, 0, 0, 0]);
    });

    it.each([0, 1, 127, 128, 255, -1, 256, 257, -128])('version %d is one unsigned byte at offset 4', (value) => {
        const flyweight = new HeaderFlyweight(new Uint8Array(8));

        flyweight.version(value);

        expect(flyweight.version()).toBe(value & 0xff);
        expect(bytesOf(flyweight, 8)).toEqual([0, 0, 0, 0, value & 0xff, 0, 0, 0]);
    });

    it.each([0, 1, 0x80, 0xc0, 0xff, -1, 0x55, 0xaa])('flags %d is one unsigned byte at offset 5', (value) => {
        const flyweight = new HeaderFlyweight(new Uint8Array(8));

        flyweight.flags(value);

        expect(flyweight.flags()).toBe(value & 0xff);
        expect(bytesOf(flyweight, 8)).toEqual([0, 0, 0, 0, 0, value & 0xff, 0, 0]);
    });

    it.each([0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xffff, -1])(
        'headerType %d is two unsigned bytes at offset 6',
        (value) => {
            const flyweight = new HeaderFlyweight(new Uint8Array(8));

            flyweight.headerType(value);

            expect(flyweight.headerType()).toBe(value & 0xffff);
            expect(bytesOf(flyweight, 8)).toEqual([0, 0, 0, 0, 0, 0, value & 0xff, (value >> 8) & 0xff]);
        },
    );

    it('flagsToCharsForNoneAndAllSet', () => {
        expect(HeaderFlyweight.flagsToChars(0).join('')).toBe('00000000');
        expect(HeaderFlyweight.flagsToChars(0xff).join('')).toBe('11111111');
        expect(HeaderFlyweight.flagsToChars(0x80).join('')).toBe('10000000');
        expect(HeaderFlyweight.flagsToChars(0x01).join('')).toBe('00000001');
        expect(HeaderFlyweight.flagsToChars(DataHeaderFlyweight.BEGIN_AND_END_FLAGS).join('')).toBe('11000000');

        for (let flags = 0; flags < 256; flags++) {
            expect(HeaderFlyweight.flagsToChars(flags).join('')).toBe(flags.toString(2).padStart(8, '0'));
        }
    });

    it('appendFlagsAsCharsMatchesFlagsToChars', () => {
        for (let flags = 0; flags < 256; flags++) {
            let text = '';
            const appendable = {
                append(c: string) {
                    text += c;
                    return appendable;
                },
            };

            HeaderFlyweight.appendFlagsAsChars(flags, appendable);

            expect(text).toBe(HeaderFlyweight.flagsToChars(flags).join(''));
        }
    });

    it('setterOutsideTheWindowThrows', () => {
        const flyweight = new HeaderFlyweight(new Uint8Array(7));

        assertThrows(IndexOutOfBoundsException, () => flyweight.headerType(1));
        assertThrows(IndexOutOfBoundsException, () => flyweight.headerType());
        expect(new HeaderFlyweight(new Uint8Array(8)).headerType(1).frameLength(0)).toBeInstanceOf(HeaderFlyweight);
    });

    it('wrapsAnArrayBufferAndAnUnsafeBufferOverTheSameBytes', () => {
        const arrayBuffer = new ArrayBuffer(8);
        const fromArrayBuffer = new HeaderFlyweight(arrayBuffer);
        const fromUnsafeBuffer = new HeaderFlyweight(new UnsafeBuffer(arrayBuffer));

        fromArrayBuffer.frameLength(0x01020304);

        expect(fromUnsafeBuffer.frameLength()).toBe(0x01020304);
        expect(new Uint8Array(arrayBuffer).slice(0, 4)).toEqual(new Uint8Array([4, 3, 2, 1]));
    });
});

describe('DataHeaderFlyweight extra', () => {
    it('constants', () => {
        expect(DataHeaderFlyweight.HEADER_LENGTH).toBe(32);
        expect(DataHeaderFlyweight.BEGIN_FLAG).toBe(0x80);
        expect(DataHeaderFlyweight.END_FLAG).toBe(0x40);
        expect(DataHeaderFlyweight.BEGIN_AND_END_FLAGS).toBe(0xc0);
        expect(DataHeaderFlyweight.EOS_FLAG).toBe(0x20);
        expect(DataHeaderFlyweight.BEGIN_END_AND_EOS_FLAGS).toBe(0xe0);
        expect(DataHeaderFlyweight.REVOKED_FLAG).toBe(0x10);
        expect(DataHeaderFlyweight.BEGIN_END_EOS_AND_REVOKED_FLAGS).toBe(0xf0);
        expect(DataHeaderFlyweight.DEFAULT_RESERVE_VALUE).toBe(0n);
        expect(DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET).toBe(8);
        expect(DataHeaderFlyweight.SESSION_ID_FIELD_OFFSET).toBe(12);
        expect(DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET).toBe(16);
        expect(DataHeaderFlyweight.TERM_ID_FIELD_OFFSET).toBe(20);
        expect(DataHeaderFlyweight.RESERVED_VALUE_OFFSET).toBe(24);
        expect(DataHeaderFlyweight.DATA_OFFSET).toBe(32);
    });

    const FIELDS: [string, number][] = [
        ['termOffset', 8],
        ['sessionId', 12],
        ['streamId', 16],
        ['termId', 20],
    ];

    for (const [field, offset] of FIELDS) {
        it.each(INTS)(`${field} %d is little-endian at offset ${offset} and touches no other byte`, (value) => {
            const flyweight = new DataHeaderFlyweight(new Uint8Array(32));
            const setter = (flyweight as unknown as Record<string, (v?: number) => unknown>)[field]!.bind(flyweight);

            expect(setter(value)).toBe(flyweight);
            expect(setter()).toBe(value);

            const expected = new Array<number>(32).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, 32)).toEqual(expected);

            // the static reader at a frame offset reads the same field
            const term = new UnsafeBuffer(new Uint8Array(64));
            term.putBytes(32, new Uint8Array(bytesOf(flyweight, 32)));
            const staticReader = (
                DataHeaderFlyweight as unknown as Record<string, (b: UnsafeBuffer, o: number) => number>
            )[field]!;
            expect(staticReader(term, 32)).toBe(value);
        });
    }

    it.each(LONGS)('reservedValue %d is a little-endian bigint at offset 24', (value) => {
        const flyweight = new DataHeaderFlyweight(new Uint8Array(32));

        expect(flyweight.reservedValue(value)).toBe(flyweight);

        expect(flyweight.reservedValue()).toBe(value);
        expect(bytesOf(flyweight, 32)).toEqual([...new Array<number>(24).fill(0), ...longLE(value)]);

        const term = new UnsafeBuffer(new Uint8Array(64));
        term.putBytes(32, new Uint8Array(bytesOf(flyweight, 32)));
        expect(DataHeaderFlyweight.reservedValue(term, 32)).toBe(value);
    });

    it('reservedValueWrapsToSixtyFourBitsLikeAJavaLong', () => {
        const flyweight = new DataHeaderFlyweight(new Uint8Array(32));

        flyweight.reservedValue(2n ** 63n);
        expect(flyweight.reservedValue()).toBe(-(2n ** 63n));

        flyweight.reservedValue(2n ** 64n + 5n);
        expect(flyweight.reservedValue()).toBe(5n);
    });

    it('flagsAllSetAndNone', () => {
        const flyweight = new DataHeaderFlyweight(new Uint8Array(32));

        flyweight.flags(0xff);
        expect(flyweight.flags()).toBe(0xff);
        expect(DataHeaderFlyweight.isEndOfStream(flyweight)).toBe(true);
        expect(DataHeaderFlyweight.isRevoked(flyweight)).toBe(true);

        flyweight.flags(0);
        expect(flyweight.flags()).toBe(0);
        expect(DataHeaderFlyweight.isEndOfStream(flyweight)).toBe(false);
        expect(DataHeaderFlyweight.isRevoked(flyweight)).toBe(false);

        flyweight.flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(DataHeaderFlyweight.isEndOfStream(flyweight)).toBe(false);
        expect(DataHeaderFlyweight.isRevoked(flyweight)).toBe(false);

        flyweight.flags(DataHeaderFlyweight.EOS_FLAG);
        expect(DataHeaderFlyweight.isEndOfStream(flyweight)).toBe(true);
        expect(DataHeaderFlyweight.isRevoked(flyweight)).toBe(false);

        flyweight.flags(DataHeaderFlyweight.REVOKED_FLAG);
        expect(DataHeaderFlyweight.isEndOfStream(flyweight)).toBe(false);
        expect(DataHeaderFlyweight.isRevoked(flyweight)).toBe(true);
    });

    it.each(INTS)('fragmentLength %d reads the frame length at a frame offset', (value) => {
        const term = new UnsafeBuffer(new Uint8Array(96));
        term.putInt(64, value);

        expect(DataHeaderFlyweight.fragmentLength(term, 64)).toBe(term.getInt(64));
        expect(DataHeaderFlyweight.fragmentLength(term, 64)).toBe(value);
    });

    it('isHeartbeat', () => {
        const packet = new UnsafeBuffer(new Uint8Array(64));

        expect(DataHeaderFlyweight.isHeartbeat(packet, 32)).toBe(true);
        expect(DataHeaderFlyweight.isHeartbeat(packet, 31)).toBe(false);
        expect(DataHeaderFlyweight.isHeartbeat(packet, 33)).toBe(false);
        expect(DataHeaderFlyweight.isHeartbeat(packet, 0)).toBe(false);

        packet.putInt(0, 1);
        expect(DataHeaderFlyweight.isHeartbeat(packet, 32)).toBe(false);

        packet.putInt(0, 0);
        expect(DataHeaderFlyweight.isHeartbeat(packet, 32)).toBe(true);
    });

    it('createDefaultHeader', () => {
        const header = DataHeaderFlyweight.createDefaultHeader(INT32_MIN, -1, INT32_MAX);

        expect(header.capacity()).toBe(32);
        expect(bytesOf(header, 32)).toEqual([
            0,
            0,
            0,
            0, // frame length
            0, // version
            0xc0, // flags
            1,
            0, // type DATA
            0,
            0,
            0,
            0, // term offset
            ...intLE(INT32_MIN), // session id
            ...intLE(-1), // stream id
            ...intLE(INT32_MAX), // term id
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0, // reserved value
        ]);
    });

    it('toStringFormat', () => {
        const flyweight = new DataHeaderFlyweight(new Uint8Array(32));
        flyweight
            .version(1)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(DataHeaderFlyweight.HEADER_LENGTH);
        flyweight
            .termOffset(64)
            .sessionId(-5)
            .streamId(7)
            .termId(9)
            .reservedValue(-(2n ** 63n));

        expect(flyweight.toString()).toBe(
            'DATA Header{frame-length=32 version=1 flags=11000000 type=1 term-offset=64 session-id=-5 stream-id=7 ' +
                'term-id=9 reserved-value=-9223372036854775808}',
        );
    });
});

describe('NakFlyweight extra', () => {
    it('headerLength', () => {
        expect(NakFlyweight.HEADER_LENGTH).toBe(28);
    });

    const FIELDS: [string, number][] = [
        ['sessionId', 8],
        ['streamId', 12],
        ['termId', 16],
        ['termOffset', 20],
        ['length', 24],
    ];

    for (const [field, offset] of FIELDS) {
        it.each(INTS)(`${field} %d is little-endian at offset ${offset} and touches no other byte`, (value) => {
            const flyweight = new NakFlyweight(new Uint8Array(28));
            const setter = (flyweight as unknown as Record<string, (v?: number) => unknown>)[field]!.bind(flyweight);

            expect(setter(value)).toBe(flyweight);
            expect(setter()).toBe(value);

            const expected = new Array<number>(28).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, 28)).toEqual(expected);
        });
    }

    it('isValidBoundaries', () => {
        const flyweight = new NakFlyweight(new Uint8Array(28));
        const termLength = 65536;

        flyweight.termOffset(0).length(0);
        expect(flyweight.isValid(termLength)).toBe(true);

        flyweight.termOffset(termLength - 32).length(32);
        expect(flyweight.isValid(termLength)).toBe(true);

        flyweight.termOffset(termLength - 32).length(33);
        expect(flyweight.isValid(termLength)).toBe(false);

        flyweight.termOffset(termLength).length(0);
        expect(flyweight.isValid(termLength)).toBe(false);

        // offset + length does not wrap an int: INT32_MAX + 32 is above the term length
        flyweight.termOffset(32).length(INT32_MAX);
        expect(flyweight.isValid(termLength)).toBe(false);
        flyweight.termOffset(termLength - 32).length(INT32_MAX);
        expect(flyweight.isValid(termLength)).toBe(false);
    });

    it('toStringFormat', () => {
        const flyweight = new NakFlyweight(new Uint8Array(28));
        flyweight.version(0).flags(0).headerType(HeaderFlyweight.HDR_TYPE_NAK).frameLength(28);
        flyweight.sessionId(1).streamId(2).termId(3).termOffset(4).length(5);

        expect(flyweight.toString()).toBe(
            'NAK{frame-length=28 version=0 flags=00000000 type=2 term-offset=4 session-id=1 stream-id=2 term-id=3 length=5}',
        );
    });
});

describe('StatusMessageFlyweight extra', () => {
    it('constants', () => {
        expect(StatusMessageFlyweight.HEADER_LENGTH).toBe(36);
        expect(StatusMessageFlyweight.SEND_SETUP_FLAG).toBe(0x80);
        expect(StatusMessageFlyweight.END_OF_STREAM_FLAG).toBe(0x40);
        expect(StatusMessageFlyweight.groupTagFieldOffset()).toBe(36);
    });

    const FIELDS: [string, number][] = [
        ['sessionId', 8],
        ['streamId', 12],
        ['consumptionTermId', 16],
        ['consumptionTermOffset', 20],
        ['receiverWindowLength', 24],
    ];

    for (const [field, offset] of FIELDS) {
        it.each(INTS)(`${field} %d is little-endian at offset ${offset} and touches no other byte`, (value) => {
            const flyweight = new StatusMessageFlyweight(new Uint8Array(36));
            const setter = (flyweight as unknown as Record<string, (v?: number) => unknown>)[field]!.bind(flyweight);

            expect(setter(value)).toBe(flyweight);
            expect(setter()).toBe(value);

            const expected = new Array<number>(36).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, 36)).toEqual(expected);
        });
    }

    it.each(LONGS)('receiverId %d is a little-endian bigint at the unaligned offset 28', (value) => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(36));

        expect(flyweight.receiverId(value)).toBe(flyweight);

        expect(flyweight.receiverId()).toBe(value);
        expect(bytesOf(flyweight, 36)).toEqual([...new Array<number>(28).fill(0), ...longLE(value)]);
    });

    it.each(LONGS)('getLongUnaligned and putLongUnaligned %d at every offset', (value) => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(24));

        for (let offset = 0; offset <= 16; offset++) {
            flyweight.putLongUnaligned(offset, value);

            expect(flyweight.getLongUnaligned(offset)).toBe(value);
            expect(bytesOf(flyweight, 24).slice(offset, offset + 8)).toEqual(longLE(value));
        }
    });

    it.each(LONGS)('groupTag %d is written after the header and sets the frame length', (value) => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(44));
        flyweight.frameLength(StatusMessageFlyweight.HEADER_LENGTH);

        expect(flyweight.groupTag()).toBe(0n);
        expect(flyweight.asfLength()).toBe(0);

        expect(flyweight.groupTag(value)).toBe(flyweight);

        expect(flyweight.frameLength()).toBe(44);
        expect(flyweight.asfLength()).toBe(8);
        expect(flyweight.groupTag()).toBe(value);
        expect(bytesOf(flyweight, 44).slice(36)).toEqual(longLE(value));

        // a null tag resets the frame length so a previous tag is ignored
        expect(flyweight.groupTag(null)).toBe(flyweight);
        expect(flyweight.frameLength()).toBe(36);
        expect(flyweight.asfLength()).toBe(0);
        expect(flyweight.groupTag()).toBe(0n);
    });

    it('groupTagWithLongerFeedbackThrows', () => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(64));

        flyweight.frameLength(36 + 8 + 1);

        const e = assertThrows(AeronException, () => flyweight.groupTag());
        expect(e.message).toBe('ERROR - SM has longer application specific feedback (9) than gtag');
        expect(e.category()).toBe(Category.ERROR);

        // shorter feedback than a tag but longer than the header still reads eight bytes, as Java does
        flyweight.frameLength(36 + 1);
        flyweight.putLongUnaligned(36, 77n);
        expect(flyweight.groupTag()).toBe(77n);
    });

    it('receiverIdOutsideTheWindowThrows', () => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(35));

        assertThrows(IndexOutOfBoundsException, () => flyweight.receiverId(1n));
        assertThrows(IndexOutOfBoundsException, () => flyweight.receiverId());
    });

    it('isValidBoundaries', () => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(36));
        const termLength = 65536;

        flyweight.consumptionTermOffset(0).receiverWindowLength(0);
        expect(flyweight.isValid(termLength)).toBe(true);

        flyweight.consumptionTermOffset(termLength - 32).receiverWindowLength(termLength >> 1);
        expect(flyweight.isValid(termLength)).toBe(true);

        flyweight.receiverWindowLength((termLength >> 1) + 1);
        expect(flyweight.isValid(termLength)).toBe(false);

        flyweight.consumptionTermOffset(termLength).receiverWindowLength(0);
        expect(flyweight.isValid(termLength)).toBe(false);

        flyweight.consumptionTermOffset(INT32_MIN).receiverWindowLength(0);
        expect(flyweight.isValid(termLength)).toBe(false);

        flyweight.consumptionTermOffset(0).receiverWindowLength(INT32_MIN);
        expect(flyweight.isValid(termLength)).toBe(false);
    });

    it('toStringFormat', () => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(36));
        flyweight.version(0).flags(StatusMessageFlyweight.SEND_SETUP_FLAG).headerType(HeaderFlyweight.HDR_TYPE_SM);
        flyweight.frameLength(36);
        flyweight.sessionId(1).streamId(2).consumptionTermId(3).consumptionTermOffset(4);
        flyweight.receiverWindowLength(5);

        expect(flyweight.toString()).toBe(
            'STATUS{frame-length=36 version=0 flags=10000000 type=3 session-id=1 stream-id=2 consumption-term-id=3 ' +
                'consumption-term-offset=4 receiver-window-length=5}',
        );
    });
});

describe('Flyweights encode, decode, re-encode', () => {
    it('dataHeaderRoundTripsByteForByte', () => {
        const next = lcg(1);

        for (let i = 0; i < 200; i++) {
            const source = new DataHeaderFlyweight(new Uint8Array(32));
            source
                .version(next() & 0xff)
                .flags(next() & 0xff)
                .headerType(next() & 0xffff)
                .frameLength(next() | 0);
            source
                .termOffset(next() | 0)
                .sessionId(next() | 0)
                .streamId(next() | 0)
                .termId(next() | 0);
            source.reservedValue(BigInt.asIntN(64, (BigInt(next()) << 32n) | BigInt(next())));

            const decoded = new DataHeaderFlyweight(new Uint8Array(source.byteArray()!.slice(0, 32)));
            const target = new DataHeaderFlyweight(new Uint8Array(32));
            target
                .version(decoded.version())
                .flags(decoded.flags())
                .headerType(decoded.headerType())
                .frameLength(decoded.frameLength());
            target
                .termOffset(decoded.termOffset())
                .sessionId(decoded.sessionId())
                .streamId(decoded.streamId())
                .termId(decoded.termId());
            target.reservedValue(decoded.reservedValue());

            expect(bytesOf(target, 32)).toEqual(bytesOf(source, 32));
            expect(target.toString()).toBe(source.toString());
        }
    });

    it('nakRoundTripsByteForByte', () => {
        const next = lcg(2);

        for (let i = 0; i < 200; i++) {
            const source = new NakFlyweight(new Uint8Array(28));
            source
                .version(next() & 0xff)
                .flags(next() & 0xff)
                .headerType(next() & 0xffff)
                .frameLength(next() | 0);
            source
                .sessionId(next() | 0)
                .streamId(next() | 0)
                .termId(next() | 0)
                .termOffset(next() | 0)
                .length(next() | 0);

            const target = new NakFlyweight(new Uint8Array(28));
            target
                .version(source.version())
                .flags(source.flags())
                .headerType(source.headerType())
                .frameLength(source.frameLength());
            target
                .sessionId(source.sessionId())
                .streamId(source.streamId())
                .termId(source.termId())
                .termOffset(source.termOffset())
                .length(source.length());

            expect(bytesOf(target, 28)).toEqual(bytesOf(source, 28));
            expect(target.toString()).toBe(source.toString());
        }
    });

    it('statusMessageRoundTripsByteForByte', () => {
        const next = lcg(3);

        for (let i = 0; i < 200; i++) {
            const withTag = 0 === (next() & 1);
            const length = withTag ? 44 : 36;
            const source = new StatusMessageFlyweight(new Uint8Array(length));
            source
                .version(next() & 0xff)
                .flags(next() & 0xff)
                .headerType(next() & 0xffff);
            source
                .sessionId(next() | 0)
                .streamId(next() | 0)
                .consumptionTermId(next() | 0)
                .consumptionTermOffset(next() | 0)
                .receiverWindowLength(next() | 0);
            source.receiverId(BigInt.asIntN(64, (BigInt(next()) << 32n) | BigInt(next())));
            if (withTag) {
                source.groupTag(BigInt.asIntN(64, (BigInt(next()) << 32n) | BigInt(next())));
            } else {
                source.groupTag(null);
            }

            const target = new StatusMessageFlyweight(new Uint8Array(length));
            target.version(source.version()).flags(source.flags()).headerType(source.headerType());
            target
                .sessionId(source.sessionId())
                .streamId(source.streamId())
                .consumptionTermId(source.consumptionTermId())
                .consumptionTermOffset(source.consumptionTermOffset())
                .receiverWindowLength(source.receiverWindowLength());
            target.receiverId(source.receiverId());
            target.groupTag(withTag ? source.groupTag() : null);

            expect(bytesOf(target, length)).toEqual(bytesOf(source, length));
            expect(target.toString()).toBe(source.toString());
            expect(target.groupTag()).toBe(source.groupTag());
        }
    });
});
