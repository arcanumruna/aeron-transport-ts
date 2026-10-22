// Not in Aeron: the interaction matrix row for flyweights (plan, "Interaction matrix"): every field at 0, 1, max, -1
// and INT32_MIN, flags all set and none, `bigint` fields at 0, 2^63 - 1 and -2^63, and encode -> decode -> re-encode
// byte identity, for the five flyweights of T8.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { type Appendable, IllegalArgumentException, IllegalStateException } from '../../../../src/agrona/jdk.js';
import { LogUtil } from '../../../../src/client/logging/LogUtil.js';
import { ErrorFlyweight } from '../../../../src/client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { ResolutionEntryFlyweight } from '../../../../src/client/protocol/ResolutionEntryFlyweight.js';
import { ResponseSetupFlyweight } from '../../../../src/client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../../src/client/protocol/SetupFlyweight.js';
import { assertThrows } from '../../../support/Assertions.js';

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const INTS = [0, 1, INT32_MAX, -1, INT32_MIN];
const LONGS = [0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)];

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

class StringBuilder implements Appendable {
    private text = '';

    public append(c: string): StringBuilder {
        this.text += c;
        return this;
    }

    public toString(): string {
        return this.text;
    }
}

/** The two-way table of one int field: [name, offset, getter/setter pair]. */
type IntAccessor<T> = readonly [string, number, (f: T) => number, (f: T, v: number) => T];
type LongAccessor<T> = readonly [string, number, (f: T) => bigint, (f: T, v: bigint) => T];

describe('SetupFlyweight extra', () => {
    const FIELDS: readonly IntAccessor<SetupFlyweight>[] = [
        ['termOffset', 8, (f) => f.termOffset(), (f, v) => f.termOffset(v)],
        ['sessionId', 12, (f) => f.sessionId(), (f, v) => f.sessionId(v)],
        ['streamId', 16, (f) => f.streamId(), (f, v) => f.streamId(v)],
        ['initialTermId', 20, (f) => f.initialTermId(), (f, v) => f.initialTermId(v)],
        ['activeTermId', 24, (f) => f.activeTermId(), (f, v) => f.activeTermId(v)],
        ['termLength', 28, (f) => f.termLength(), (f, v) => f.termLength(v)],
        ['mtuLength', 32, (f) => f.mtuLength(), (f, v) => f.mtuLength(v)],
        ['ttl', 36, (f) => f.ttl(), (f, v) => f.ttl(v)],
    ];

    it('constants', () => {
        expect(SetupFlyweight.HEADER_LENGTH).toBe(40);
        expect(SetupFlyweight.SEND_RESPONSE_SETUP_FLAG).toBe(0x80);
        expect(SetupFlyweight.GROUP_FLAG).toBe(0x40);
        expect(SetupFlyweight.MAX_UDP_PAYLOAD_LENGTH).toBe(65504);
    });

    for (const [name, offset, get, set] of FIELDS) {
        it.each(INTS)(`${name} %d is little-endian at offset ${offset}`, (value) => {
            const flyweight = new SetupFlyweight(new Uint8Array(SetupFlyweight.HEADER_LENGTH));

            expect(set(flyweight, value)).toBe(flyweight);
            expect(get(flyweight)).toBe(value);
            const expected = new Array<number>(SetupFlyweight.HEADER_LENGTH).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, SetupFlyweight.HEADER_LENGTH)).toEqual(expected);
        });
    }

    it('encode, decode, re-encode is byte-identical for seeded random frames', () => {
        const next = lcg(8);
        for (let n = 0; n < 200; n++) {
            const source = new Uint8Array(SetupFlyweight.HEADER_LENGTH);
            for (let i = 0; i < source.length; i++) {
                source[i] = next() >>> 24;
            }
            const decoded = new SetupFlyweight(source.slice());
            const copy = new SetupFlyweight(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
            copy.frameLength(decoded.frameLength())
                .version(decoded.version())
                .flags(decoded.flags())
                .headerType(decoded.headerType());
            copy.termOffset(decoded.termOffset())
                .sessionId(decoded.sessionId())
                .streamId(decoded.streamId())
                .initialTermId(decoded.initialTermId())
                .activeTermId(decoded.activeTermId())
                .termLength(decoded.termLength())
                .mtuLength(decoded.mtuLength())
                .ttl(decoded.ttl());

            expect(bytesOf(copy, SetupFlyweight.HEADER_LENGTH)).toEqual([...source]);
        }
    });

    it('isValid accepts the term length bounds and rejects one beyond them', () => {
        const flyweight = new SetupFlyweight(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
        flyweight.mtuLength(1408).termOffset(0);

        for (const [termLength, valid] of [
            [64 * 1024, true],
            [1024 * 1024 * 1024, true],
            [32 * 1024, false],
            [2 * 1024 * 1024 * 1024 - 1, false],
            [INT32_MIN, false],
            [-1, false],
        ] as const) {
            expect(flyweight.termLength(termLength).isValid()).toBe(valid);
        }
    });

    it('isValid accepts the MTU bounds and rejects one frame beyond them', () => {
        const flyweight = new SetupFlyweight(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
        flyweight.termOffset(0).termLength(64 * 1024);

        for (const [mtu, valid] of [
            [32, true],
            [65504, true],
            [64, true],
            [65504 + 32, false],
            [0, false],
            [INT32_MIN, false],
            [-32, false],
            [INT32_MAX, false],
        ] as const) {
            expect(flyweight.mtuLength(mtu).isValid()).toBe(valid);
        }
    });

    it('toString names every field', () => {
        const flyweight = new SetupFlyweight(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
        flyweight
            .frameLength(40)
            .version(0)
            .flags(SetupFlyweight.GROUP_FLAG | SetupFlyweight.SEND_RESPONSE_SETUP_FLAG)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP);
        flyweight.termOffset(64).sessionId(-1).streamId(7).initialTermId(INT32_MIN).activeTermId(INT32_MAX);
        flyweight.termLength(65536).mtuLength(1408).ttl(8);

        expect(flyweight.toString()).toBe(
            'SETUP{frame-length=40 version=0 flags=11000000 type=5 term-offset=64 session-id=-1 stream-id=7 ' +
                'initial-term-id=-2147483648 active-term-id=2147483647 term-length=65536 mtu-length=1408 ttl=8}',
        );
    });
});

describe('RttMeasurementFlyweight extra', () => {
    const INT_FIELDS: readonly IntAccessor<RttMeasurementFlyweight>[] = [
        ['sessionId', 8, (f) => f.sessionId(), (f, v) => f.sessionId(v)],
        ['streamId', 12, (f) => f.streamId(), (f, v) => f.streamId(v)],
    ];
    const LONG_FIELDS: readonly LongAccessor<RttMeasurementFlyweight>[] = [
        ['echoTimestampNs', 16, (f) => f.echoTimestampNs(), (f, v) => f.echoTimestampNs(v)],
        ['receptionDelta', 24, (f) => f.receptionDelta(), (f, v) => f.receptionDelta(v)],
        ['receiverId', 32, (f) => f.receiverId(), (f, v) => f.receiverId(v)],
    ];
    const LENGTH = RttMeasurementFlyweight.HEADER_LENGTH;

    it('constants', () => {
        expect(RttMeasurementFlyweight.REPLY_FLAG).toBe(0x80);
        expect(RttMeasurementFlyweight.HEADER_LENGTH).toBe(40);
    });

    for (const [name, offset, get, set] of INT_FIELDS) {
        it.each(INTS)(`${name} %d is little-endian at offset ${offset}`, (value) => {
            const flyweight = new RttMeasurementFlyweight(new Uint8Array(LENGTH));

            expect(set(flyweight, value)).toBe(flyweight);
            expect(get(flyweight)).toBe(value);
            const expected = new Array<number>(LENGTH).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
        });
    }

    for (const [name, offset, get, set] of LONG_FIELDS) {
        it.each(LONGS)(`${name} %d is a little-endian bigint at offset ${offset}`, (value) => {
            const flyweight = new RttMeasurementFlyweight(new Uint8Array(LENGTH));

            expect(set(flyweight, value)).toBe(flyweight);
            expect(get(flyweight)).toBe(value);
            const expected = new Array<number>(LENGTH).fill(0);
            expected.splice(offset, 8, ...longLE(value));
            expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
        });
    }

    it('a bigint outside 64 bits wraps as a Java long does', () => {
        const flyweight = new RttMeasurementFlyweight(new Uint8Array(LENGTH));

        flyweight.receiverId(2n ** 63n);

        expect(flyweight.receiverId()).toBe(-(2n ** 63n));
    });

    it('the reply flag and each header field are independent of the body', () => {
        const flyweight = new RttMeasurementFlyweight(new Uint8Array(LENGTH));

        flyweight.frameLength(LENGTH).version(0).flags(RttMeasurementFlyweight.REPLY_FLAG);
        flyweight.headerType(HeaderFlyweight.HDR_TYPE_RTTM);
        flyweight.sessionId(INT32_MIN).streamId(INT32_MAX).echoTimestampNs(-1n).receptionDelta(1n).receiverId(0n);

        expect(flyweight.flags()).toBe(0x80);
        expect(flyweight.headerType()).toBe(6);
        expect(flyweight.toString()).toBe(
            'RTTM{frame-length=40 version=0 flags=10000000 type=6 session-id=-2147483648 stream-id=2147483647 ' +
                'echo-timestamp=-1 reception-delta=1 receiver-id=0}',
        );
    });

    it('encode, decode, re-encode is byte-identical for seeded random frames', () => {
        const next = lcg(9);
        for (let n = 0; n < 200; n++) {
            const source = new Uint8Array(LENGTH);
            for (let i = 0; i < source.length; i++) {
                source[i] = next() >>> 24;
            }
            const decoded = new RttMeasurementFlyweight(source.slice());
            const copy = new RttMeasurementFlyweight(new Uint8Array(LENGTH));
            copy.frameLength(decoded.frameLength())
                .version(decoded.version())
                .flags(decoded.flags())
                .headerType(decoded.headerType());
            copy.sessionId(decoded.sessionId())
                .streamId(decoded.streamId())
                .echoTimestampNs(decoded.echoTimestampNs())
                .receptionDelta(decoded.receptionDelta())
                .receiverId(decoded.receiverId());

            expect(bytesOf(copy, LENGTH)).toEqual([...source]);
        }
    });
});

describe('ResponseSetupFlyweight extra', () => {
    const FIELDS: readonly IntAccessor<ResponseSetupFlyweight>[] = [
        ['sessionId', 8, (f) => f.sessionId(), (f, v) => f.sessionId(v)],
        ['streamId', 12, (f) => f.streamId(), (f, v) => f.streamId(v)],
        ['responseSessionId', 16, (f) => f.responseSessionId(), (f, v) => f.responseSessionId(v)],
    ];
    const LENGTH = ResponseSetupFlyweight.HEADER_LENGTH;

    it('constants', () => {
        expect(ResponseSetupFlyweight.HEADER_LENGTH).toBe(20);
    });

    for (const [name, offset, get, set] of FIELDS) {
        it.each(INTS)(`${name} %d is little-endian at offset ${offset}`, (value) => {
            const flyweight = new ResponseSetupFlyweight(new Uint8Array(LENGTH));

            expect(set(flyweight, value)).toBe(flyweight);
            expect(get(flyweight)).toBe(value);
            const expected = new Array<number>(LENGTH).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
        });
    }

    it('the three fields do not overlap', () => {
        const flyweight = new ResponseSetupFlyweight(new Uint8Array(LENGTH));

        flyweight.sessionId(-1).streamId(INT32_MIN).responseSessionId(INT32_MAX);

        expect(flyweight.sessionId()).toBe(-1);
        expect(flyweight.streamId()).toBe(INT32_MIN);
        expect(flyweight.responseSessionId()).toBe(INT32_MAX);
    });
});

describe('ErrorFlyweight extra', () => {
    const LENGTH = ErrorFlyweight.MAX_ERROR_FRAME_LENGTH;

    it('constants', () => {
        expect(ErrorFlyweight.SESSION_ID_FIELD_OFFSET).toBe(8);
        expect(ErrorFlyweight.STREAM_ID_FIELD_OFFSET).toBe(12);
        expect(ErrorFlyweight.RECEIVER_ID_FIELD_OFFSET).toBe(16);
        expect(ErrorFlyweight.GROUP_TAG_FIELD_OFFSET).toBe(24);
        expect(ErrorFlyweight.ERROR_CODE_FIELD_OFFSET).toBe(32);
        expect(ErrorFlyweight.ERROR_STRING_FIELD_OFFSET).toBe(36);
        expect(ErrorFlyweight.HEADER_LENGTH).toBe(40);
        expect(ErrorFlyweight.MAX_ERROR_MESSAGE_LENGTH).toBe(1023);
        expect(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH).toBe(1063);
        expect(ErrorFlyweight.HAS_GROUP_ID_FLAG).toBe(0x08);
    });

    const INT_FIELDS: readonly IntAccessor<ErrorFlyweight>[] = [
        ['sessionId', 8, (f) => f.sessionId(), (f, v) => f.sessionId(v)],
        ['streamId', 12, (f) => f.streamId(), (f, v) => f.streamId(v)],
        ['errorCode', 32, (f) => f.errorCode(), (f, v) => f.errorCode(v)],
    ];
    for (const [name, offset, get, set] of INT_FIELDS) {
        it.each(INTS)(`${name} %d is little-endian at offset ${offset}`, (value) => {
            const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));

            expect(set(flyweight, value)).toBe(flyweight);
            expect(get(flyweight)).toBe(value);
            const expected = new Array<number>(LENGTH).fill(0);
            expected.splice(offset, 4, ...intLE(value));
            expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
        });
    }

    it.each(LONGS)('receiverId %d is a little-endian bigint at offset 16', (value) => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));

        expect(flyweight.receiverId(value)).toBe(flyweight);
        expect(flyweight.receiverId()).toBe(value);
        const expected = new Array<number>(LENGTH).fill(0);
        expected.splice(16, 8, ...longLE(value));
        expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
    });

    it.each(LONGS)('groupTag %d is a little-endian bigint at offset 24 and sets the flag', (value) => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
        expect(flyweight.hasGroupTag()).toBe(false);

        expect(flyweight.groupTag(value)).toBe(flyweight);

        expect(flyweight.hasGroupTag()).toBe(true);
        expect(flyweight.groupTag()).toBe(value);
        const expected = new Array<number>(LENGTH).fill(0);
        expected.splice(24, 8, ...longLE(value));
        expected[5] = ErrorFlyweight.HAS_GROUP_ID_FLAG;
        expect(bytesOf(flyweight, LENGTH)).toEqual(expected);
    });

    it('clearing the group tag keeps the tag bytes and the other flags', () => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
        flyweight.flags(0xf7);
        flyweight.groupTag(5n);
        expect(flyweight.flags()).toBe(0xff);

        flyweight.groupTag(null);

        expect(flyweight.flags()).toBe(0xf7);
        expect(flyweight.hasGroupTag()).toBe(false);
        expect(flyweight.groupTag()).toBe(5n);
    });

    it('flags all set and none', () => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));

        flyweight.flags(0xff);
        expect(flyweight.hasGroupTag()).toBe(true);
        flyweight.flags(0);
        expect(flyweight.hasGroupTag()).toBe(false);
    });

    it.each([0, 1, 2, 1022, 1023, 1024, 5000])('errorMessage of %d characters is truncated to 1023', (n) => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
        const message = 'a'.repeat(n);

        flyweight.errorMessage(message);

        const kept = Math.min(n, 1023);
        expect(flyweight.errorMessage()).toBe('a'.repeat(kept));
        expect(flyweight.frameLength()).toBe(40 + kept);
        expect(flyweight.isValid()).toBe(true);
    });

    it('errorMessage rewritten shorter leaves a valid frame of the new length', () => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
        flyweight.errorMessage('a long first message');

        flyweight.errorMessage('b');

        expect(flyweight.errorMessage()).toBe('b');
        expect(flyweight.frameLength()).toBe(41);
        expect(flyweight.isValid()).toBe(true);
    });

    it('a message too long for the buffer throws', () => {
        const flyweight = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.HEADER_LENGTH + 2));

        expect(() => flyweight.errorMessage('abc')).toThrow();
    });

    it('toString names every field', () => {
        const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
        flyweight.headerType(HeaderFlyweight.HDR_TYPE_ERR);
        flyweight.sessionId(1).streamId(2).errorCode(3).errorMessage('boom');

        expect(flyweight.toString()).toBe(
            'ERROR{frame-length=44 version=0 flags=00000000 type=4 session-id=1 stream-id=2 error-code=3 ' +
                'error-message=boom}',
        );
    });

    it('encode, decode, re-encode is byte-identical for seeded random frames', () => {
        const next = lcg(10);
        for (let n = 0; n < 200; n++) {
            const messageLength = next() % 1024;
            let message = '';
            for (let i = 0; i < messageLength; i++) {
                message += String.fromCharCode(32 + (next() % 95));
            }
            const flyweight = new ErrorFlyweight(new Uint8Array(LENGTH));
            flyweight.headerType(HeaderFlyweight.HDR_TYPE_ERR);
            flyweight.sessionId(next() | 0).streamId(next() | 0);
            flyweight.receiverId(BigInt.asIntN(64, (BigInt(next()) << 32n) | BigInt(next())));
            flyweight.groupTag(BigInt.asIntN(64, (BigInt(next()) << 32n) | BigInt(next())));
            flyweight.errorCode(next() | 0).errorMessage(message);
            const frame = bytesOf(flyweight, flyweight.frameLength());

            const decoded = new ErrorFlyweight(new Uint8Array(frame));
            const copy = new ErrorFlyweight(new Uint8Array(LENGTH));
            copy.headerType(decoded.headerType()).flags(decoded.flags());
            copy.sessionId(decoded.sessionId())
                .streamId(decoded.streamId())
                .receiverId(decoded.receiverId())
                .errorCode(decoded.errorCode())
                .errorMessage(decoded.errorMessage());
            copy.putLongBigInt(ErrorFlyweight.GROUP_TAG_FIELD_OFFSET, decoded.groupTag());

            expect(decoded.isValid()).toBe(true);
            expect(bytesOf(copy, decoded.frameLength())).toEqual(frame);
        }
    });
});

describe('ResolutionEntryFlyweight extra', () => {
    const IP4 = ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD;
    const IP6 = ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD;

    function entry(resType: number, nameLength = 16): ResolutionEntryFlyweight {
        const flyweight = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(64 + nameLength)));
        return flyweight.resType(resType);
    }

    it('constants', () => {
        expect(IP4).toBe(1);
        expect(IP6).toBe(2);
        expect(ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4).toBe(4);
        expect(ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6).toBe(16);
        expect(ResolutionEntryFlyweight.SELF_FLAG).toBe(0x80);
        expect(ResolutionEntryFlyweight.RES_TYPE_FIELD_OFFSET).toBe(0);
        expect(ResolutionEntryFlyweight.RES_FLAGS_FIELD_OFFSET).toBe(1);
        expect(ResolutionEntryFlyweight.UDP_PORT_FIELD_OFFSET).toBe(2);
        expect(ResolutionEntryFlyweight.AGE_IN_MS_FIELD_OFFSET).toBe(4);
        expect(ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET).toBe(8);
        expect(ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP4).toBe(12);
        expect(ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP6).toBe(24);
        expect(ResolutionEntryFlyweight.MAX_NAME_LENGTH).toBe(512);
        expect(ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH).toBe(14);
        expect(ResolutionEntryFlyweight.MIN_IPV6_FRAME_LENGTH).toBe(26);
    });

    it.each([IP4, IP6, 0, 3, 127, -1, -128])('resType %d is one signed byte at offset 0', (value) => {
        const flyweight = entry(0);

        expect(flyweight.resType(value)).toBe(flyweight);

        expect(flyweight.resType()).toBe(value);
        expect(flyweight.getByte(0)).toBe(value);
    });

    it.each([0, 1, 0x7f, 0x80, 0xff, -1])('flags %d is one unsigned byte at offset 1', (value) => {
        const flyweight = entry(IP4);

        expect(flyweight.flags(value)).toBe(flyweight);

        expect(flyweight.flags()).toBe(value & 0xff);
        expect(flyweight.getByte(1) & 0xff).toBe(value & 0xff);
        expect(flyweight.getByte(0)).toBe(IP4);
    });

    it.each([0, 1, 0x7fff, 0x8000, 0xffff, 65535, 12345])(
        'udpPort %d is unsigned little-endian at offset 2',
        (value) => {
            const flyweight = entry(IP4);

            expect(flyweight.udpPort(value)).toBe(flyweight);

            expect(flyweight.udpPort()).toBe(value);
            expect(flyweight.getByte(2) & 0xff).toBe(value & 0xff);
            expect(flyweight.getByte(3) & 0xff).toBe(value >> 8);
        },
    );

    it.each(INTS)('ageInMs %d is little-endian at offset 4', (value) => {
        const flyweight = entry(IP4);

        expect(flyweight.ageInMs(value)).toBe(flyweight);

        expect(flyweight.ageInMs()).toBe(value);
        expect([4, 5, 6, 7].map((i) => flyweight.getByte(i) & 0xff)).toEqual(intLE(value));
    });

    it('putAddress and getAddress round trip IPv4 and IPv6', () => {
        const a4 = Uint8Array.of(192, 168, 0, 255);
        const a6 = Uint8Array.from({ length: 16 }, (_, i) => 0xf0 + i);

        const e4 = entry(IP4);
        expect(e4.putAddress(a4)).toBe(e4);
        const out4 = new Uint8Array(8);
        expect(e4.getAddress(out4)).toBe(4);
        expect([...out4.subarray(0, 4)]).toEqual([...a4]);
        expect([...out4.subarray(4)]).toEqual([0, 0, 0, 0]);

        const e6 = entry(IP6);
        e6.putAddress(a6);
        const out6 = new Uint8Array(16);
        expect(e6.getAddress(out6)).toBe(16);
        expect([...out6]).toEqual([...a6]);
    });

    it('putAddress and getAddress reject wrong lengths and unknown types', () => {
        assertThrows(IllegalArgumentException, () => entry(IP4).putAddress(new Uint8Array(3)));
        assertThrows(IllegalArgumentException, () => entry(IP4).putAddress(new Uint8Array(5)));
        assertThrows(IllegalArgumentException, () => entry(IP6).putAddress(new Uint8Array(4)));
        assertThrows(IllegalArgumentException, () => entry(IP6).putAddress(new Uint8Array(17)));
        assertThrows(IllegalStateException, () => entry(0).putAddress(new Uint8Array(4)));
        assertThrows(IllegalArgumentException, () => entry(IP4).getAddress(new Uint8Array(3)));
        assertThrows(IllegalArgumentException, () => entry(IP6).getAddress(new Uint8Array(15)));
        assertThrows(IllegalStateException, () => entry(-1).getAddress(new Uint8Array(16)));
    });

    it('appendAddress formats IPv4, IPv6 and an unknown type', () => {
        const e4 = entry(IP4).putAddress(Uint8Array.of(0, 127, 128, 255));
        const sb4 = new StringBuilder();
        e4.appendAddress(sb4);
        expect(sb4.toString()).toBe('0.127.128.255');

        const unknown = new StringBuilder();
        entry(9).appendAddress(unknown);
        expect(unknown.toString()).toBe('unknown RES_TYPE=9');

        const negative = new StringBuilder();
        entry(-3).appendAddress(negative);
        expect(negative.toString()).toBe('unknown RES_TYPE=-3');
    });

    it.each([
        ['00000000000000000000000000000000', '[::]'],
        ['00000000000000000000000000000001', '[::0001]'],
        ['00010000000000000000000000000000', '[0001::]'],
        ['fe800000000000000000000000000001', '[fe80::0001]'],
        ['20010db8000000000000000000000001', '[2001:0db8::0001]'],
        ['20010db8000100000000000100000001', '[2001:0db8:0001::0001:0000:0001]'],
        ['20010db8000000010000000000000001', '[2001:0db8:0000:0001::0001]'],
        ['00000001000000000000000200000000', '[0000:0001::0002:0000:0000]'],
        ['00000001000100010001000100010001', '[0000:0001:0001:0001:0001:0001:0001:0001]'],
        ['ffffffffffffffffffffffffffffffff', '[ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]'],
    ])('appendIpV6Address %s is %s', (hex, expected) => {
        const bytes = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
        const buffer = new UnsafeBuffer(new Uint8Array(4 + 16));
        buffer.putBytes(4, bytes);
        const sb = new StringBuilder();

        LogUtil.appendIpV6Address(sb, buffer, 4);

        expect(sb.toString()).toBe(expected);
    });

    it('putName, getName, appendName and entryLength', () => {
        for (const [resType, nameOffset] of [
            [IP4, 12],
            [IP6, 24],
        ] as const) {
            for (const name of ['a', 'test name', 'x'.repeat(512)]) {
                const flyweight = entry(resType, 512);
                const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0));

                expect(flyweight.putName(bytes)).toBe(flyweight);

                const out = new Uint8Array(name.length + 3);
                expect(flyweight.getName(out)).toBe(name.length);
                expect([...out.subarray(0, name.length)]).toEqual([...bytes]);
                const sb = new StringBuilder();
                flyweight.appendName(sb);
                expect(sb.toString()).toBe(name);
                expect(flyweight.entryLength()).toBe(Math.ceil((nameOffset + 2 + name.length) / 8) * 8);
                expect(ResolutionEntryFlyweight.entryLengthRequired(resType, name.length)).toBe(
                    flyweight.entryLength(),
                );
            }
        }
    });

    it('getName rejects a destination that is too short', () => {
        const flyweight = entry(IP4).putName(Uint8Array.of(97, 98, 99));

        assertThrows(IllegalArgumentException, () => flyweight.getName(new Uint8Array(2)));
    });

    it('nameOffset, addressLength and entryLengthRequired reject an unknown type', () => {
        expect(ResolutionEntryFlyweight.nameOffset(IP4)).toBe(12);
        expect(ResolutionEntryFlyweight.nameOffset(IP6)).toBe(24);
        expect(ResolutionEntryFlyweight.addressLength(IP4)).toBe(4);
        expect(ResolutionEntryFlyweight.addressLength(IP6)).toBe(16);
        for (const bad of [0, 3, -1, 127, -128]) {
            assertThrows(IllegalStateException, () => ResolutionEntryFlyweight.nameOffset(bad));
            assertThrows(IllegalStateException, () => ResolutionEntryFlyweight.addressLength(bad));
            assertThrows(IllegalStateException, () => ResolutionEntryFlyweight.entryLengthRequired(bad, 1));
            assertThrows(IllegalStateException, () => entry(bad).entryLength());
        }
    });

    it('isValid at the name length limits', () => {
        for (const [resType, minLength, nameOffset] of [
            [IP4, 14, 12],
            [IP6, 26, 24],
        ] as const) {
            for (const [nameLength, valid] of [
                [1, true],
                [512, true],
                [513, false],
                [0, false],
                [-1, false],
            ] as const) {
                const flyweight = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(minLength + 600)));
                flyweight.resType(resType);
                flyweight.putShort(nameOffset, nameLength);

                expect(flyweight.isValid()).toBe(valid);
            }

            // exactly enough capacity, and one byte too few
            const exact = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(minLength + 5)));
            exact.resType(resType);
            exact.putShort(nameOffset, 5);
            expect(exact.isValid()).toBe(true);
            const tight = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(minLength + 4)));
            tight.resType(resType);
            tight.putShort(nameOffset, 5);
            expect(tight.isValid()).toBe(false);
        }
    });

    it('isAnyLocalAddress', () => {
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(new Uint8Array(4), 4)).toBe(true);
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(Uint8Array.of(0, 0, 0, 1), 4)).toBe(false);
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(Uint8Array.of(1, 0, 0, 0), 4)).toBe(false);
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(new Uint8Array(16), 16)).toBe(true);
        for (let i = 0; i < 16; i++) {
            const address = new Uint8Array(16);
            address[i] = 0x80;
            expect(ResolutionEntryFlyweight.isAnyLocalAddress(address, 16)).toBe(false);
        }
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(new Uint8Array(16), 8)).toBe(false);
        expect(ResolutionEntryFlyweight.isAnyLocalAddress(new Uint8Array(16), 0)).toBe(false);
    });
});
