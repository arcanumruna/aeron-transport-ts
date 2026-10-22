/*
 * Golden wire vectors (plan T13). test/golden/frames.json holds every datagram that two real Aeron 1.53.3 C drivers
 * exchanged on loopback (see scripts/capture-golden.mjs). The field values stored next to each datagram were decoded
 * by an independent DataView decoder in the capture script, not by these flyweights, so decoding here is a real
 * cross-check. No C driver is needed to run this test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../src/client/protocol/NakFlyweight.js';
import { RttMeasurementFlyweight } from '../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';

interface GoldenFrame {
    offset: number;
    frameLength: number;
    version: number;
    flags: number;
    type: number;
    typeName: string;
    /** Names of the set flag bits, from the C header constants copied into the capture script. */
    flagNames: string[];
    fields: Record<string, number | string>;
    /** Fixed header length of the frame type (C header). */
    fixedLength: number;
    /** Bytes of the frame present in the datagram (a PAD is sent as its bare header). */
    presentLength: number;
    /** Bytes after the fixed header that are present: a DATA payload or an SM's application specific feedback. */
    trailingLength: number;
}

interface GoldenDatagram {
    scenario: string;
    seq: number;
    direction: 'pub->sub' | 'sub->pub';
    hex: string;
    dropped?: boolean;
    retransmitOf?: number;
    frames: GoldenFrame[];
}

interface Golden {
    config: { sessionId: number; streamId: number; initialTermId: number; termLength: number; mtu: number };
    scenarios: { name: string }[];
    datagrams: GoldenDatagram[];
}

const golden = JSON.parse(readFileSync(new URL('./frames.json', import.meta.url), 'utf8')) as Golden;

// The coverage block below uses the literals of aeron_udp_protocol.h, not these TS constants, so that a wrong TS
// constant cannot satisfy its own coverage check; GoldenFramesConstants pins the TS constants to the same literals.
const { HDR_TYPE_PAD, HDR_TYPE_DATA, HDR_TYPE_NAK, HDR_TYPE_SM, HDR_TYPE_SETUP, HDR_TYPE_RTTM } = HeaderFlyweight;

/** The bytes after the fixed header of `frame` in `datagram`. */
const trailing = (datagram: Uint8Array, frame: GoldenFrame): Uint8Array =>
    datagram.subarray(frame.offset + frame.fixedLength, frame.offset + frame.fixedLength + frame.trailingLength);

const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Walks the frames of a datagram the way a receiver does: FRAME_ALIGNMENT stepping, a heartbeat ends the walk. */
function walk(datagram: Uint8Array): { offset: number; frameLength: number }[] {
    const buffer = new UnsafeBuffer(datagram);
    const frames: { offset: number; frameLength: number }[] = [];
    let offset = 0;
    while (offset < datagram.length) {
        const frameLength = buffer.getInt(offset, ByteOrder.LITTLE_ENDIAN);
        frames.push({ offset, frameLength });
        if (frameLength === 0) {
            expect(DataHeaderFlyweight.isHeartbeat(buffer, datagram.length - offset)).toBe(true);
            break;
        }
        offset += BitUtil.align(frameLength, FrameDescriptor.FRAME_ALIGNMENT);
    }
    return frames;
}

const big = (v: number | string): bigint => BigInt(v);

/** Decodes the frame at `offset` with the TS flyweights, returning the same field record the capture script wrote. */
function decode(datagram: Uint8Array, frame: GoldenFrame): Record<string, number | string> {
    const length = datagram.length - frame.offset;
    const wrap = <T extends HeaderFlyweight>(flyweight: T): T => {
        flyweight.wrap(datagram, frame.offset, length);
        return flyweight;
    };

    switch (frame.type) {
        case HDR_TYPE_PAD:
        case HDR_TYPE_DATA: {
            const f = wrap(new DataHeaderFlyweight());
            return {
                termOffset: f.termOffset(),
                sessionId: f.sessionId(),
                streamId: f.streamId(),
                termId: f.termId(),
                reservedValue: f.reservedValue().toString(),
            };
        }
        case HDR_TYPE_NAK: {
            const f = wrap(new NakFlyweight());
            return {
                sessionId: f.sessionId(),
                streamId: f.streamId(),
                termId: f.termId(),
                termOffset: f.termOffset(),
                length: f.length(),
            };
        }
        case HDR_TYPE_SM: {
            const f = wrap(new StatusMessageFlyweight());
            return {
                sessionId: f.sessionId(),
                streamId: f.streamId(),
                consumptionTermId: f.consumptionTermId(),
                consumptionTermOffset: f.consumptionTermOffset(),
                receiverWindowLength: f.receiverWindowLength(),
                receiverId: f.receiverId().toString(),
            };
        }
        case HDR_TYPE_SETUP: {
            const f = wrap(new SetupFlyweight());
            return {
                termOffset: f.termOffset(),
                sessionId: f.sessionId(),
                streamId: f.streamId(),
                initialTermId: f.initialTermId(),
                activeTermId: f.activeTermId(),
                termLength: f.termLength(),
                mtuLength: f.mtuLength(),
                ttl: f.ttl(),
            };
        }
        case HDR_TYPE_RTTM: {
            const f = wrap(new RttMeasurementFlyweight());
            return {
                sessionId: f.sessionId(),
                streamId: f.streamId(),
                echoTimestampNs: f.echoTimestampNs().toString(),
                receptionDelta: f.receptionDelta().toString(),
                receiverId: f.receiverId().toString(),
            };
        }
        default:
            throw new Error(`unexpected frame type ${frame.type}`);
    }
}

/** Encodes `frame` from its recorded fields into `buffer` (zero filled) at `frame.offset`, with the TS flyweights. */
function encode(buffer: Uint8Array, frame: GoldenFrame): void {
    const f = frame.fields;
    const n = (name: string): number => f[name] as number;
    const b = (name: string): bigint => big(f[name] as number | string);
    const length = buffer.length - frame.offset;
    const header = (flyweight: HeaderFlyweight): void => {
        flyweight.wrap(buffer, frame.offset, length);
        flyweight.frameLength(frame.frameLength).version(frame.version).flags(frame.flags).headerType(frame.type);
    };

    switch (frame.type) {
        case HDR_TYPE_PAD:
        case HDR_TYPE_DATA: {
            const w = new DataHeaderFlyweight();
            header(w);
            w.termOffset(n('termOffset')).sessionId(n('sessionId')).streamId(n('streamId')).termId(n('termId'));
            w.reservedValue(b('reservedValue'));
            break;
        }
        case HDR_TYPE_NAK: {
            const w = new NakFlyweight();
            header(w);
            w.sessionId(n('sessionId')).streamId(n('streamId')).termId(n('termId')).termOffset(n('termOffset'));
            w.length(n('length'));
            break;
        }
        case HDR_TYPE_SM: {
            const w = new StatusMessageFlyweight();
            header(w);
            w.sessionId(n('sessionId')).streamId(n('streamId'));
            w.consumptionTermId(n('consumptionTermId')).consumptionTermOffset(n('consumptionTermOffset'));
            w.receiverWindowLength(n('receiverWindowLength')).receiverId(b('receiverId'));
            break;
        }
        case HDR_TYPE_SETUP: {
            const w = new SetupFlyweight();
            header(w);
            w.termOffset(n('termOffset')).sessionId(n('sessionId')).streamId(n('streamId'));
            w.initialTermId(n('initialTermId')).activeTermId(n('activeTermId')).termLength(n('termLength'));
            w.mtuLength(n('mtuLength')).ttl(n('ttl'));
            break;
        }
        case HDR_TYPE_RTTM: {
            const w = new RttMeasurementFlyweight();
            header(w);
            w.sessionId(n('sessionId')).streamId(n('streamId'));
            w.echoTimestampNs(b('echoTimestampNs')).receptionDelta(b('receptionDelta')).receiverId(b('receiverId'));
            break;
        }
        default:
            throw new Error(`unexpected frame type ${frame.type}`);
    }
}

/** The bytes after the fixed header: a DATA payload or a status message's application specific feedback. */
const FIXED_LENGTH = new Map<number, number>([
    [HDR_TYPE_PAD, DataHeaderFlyweight.HEADER_LENGTH],
    [HDR_TYPE_DATA, DataHeaderFlyweight.HEADER_LENGTH],
    [HDR_TYPE_NAK, NakFlyweight.HEADER_LENGTH],
    [HDR_TYPE_SM, StatusMessageFlyweight.HEADER_LENGTH],
    [HDR_TYPE_SETUP, SetupFlyweight.HEADER_LENGTH],
    [HDR_TYPE_RTTM, RttMeasurementFlyweight.HEADER_LENGTH],
]);

describe('GoldenFrames', () => {
    it('shouldHaveCapturedDatagramsFromTheCDriver', () => {
        expect(golden.datagrams.length).toBeGreaterThan(100);
        expect(golden.config.mtu).toBe(1408);
        for (const d of golden.datagrams) {
            expect(d.hex.length).toBeGreaterThan(0);
            expect(d.hex.length % 2).toBe(0);
        }
    });

    describe.each(
        golden.datagrams.map(
            (d) => [`${d.scenario}#${d.seq} ${d.direction} ${d.frames.map((f) => f.typeName).join('+')}`, d] as const,
        ),
    )('%s', (_name, d) => {
        const datagram = fromHex(d.hex);

        it('shouldWalkTheFramesWithFrameAlignment', () => {
            const walked = walk(datagram);
            expect(walked).toEqual(d.frames.map((f) => ({ offset: f.offset, frameLength: f.frameLength })));
        });

        it('shouldDecodeEveryFrameWithTheFlyweights', () => {
            for (const frame of d.frames) {
                const header = new HeaderFlyweight();
                header.wrap(datagram, frame.offset, datagram.length - frame.offset);
                expect(header.frameLength()).toBe(frame.frameLength);
                expect(header.version()).toBe(frame.version);
                expect(header.flags()).toBe(frame.flags);
                expect(header.headerType()).toBe(frame.type);

                // the TS fixed header length is the C one, and a frame of a fixed size type has exactly that length
                const fixed = FIXED_LENGTH.get(frame.type) as number;
                expect(fixed).toBe(frame.fixedLength);
                if (frame.type === HDR_TYPE_SETUP || frame.type === HDR_TYPE_NAK || frame.type === HDR_TYPE_RTTM) {
                    expect(frame.frameLength).toBe(fixed);
                    expect(frame.trailingLength).toBe(0);
                }
                // DATA and SM carry what follows the fixed header; a heartbeat and a PAD are sent as the bare header
                if ((frame.type === HDR_TYPE_DATA && frame.frameLength > 0) || frame.type === HDR_TYPE_SM) {
                    expect(frame.trailingLength).toBe(frame.frameLength - fixed);
                    expect(frame.presentLength).toBe(frame.frameLength);
                }

                expect(decode(datagram, frame)).toEqual(frame.fields);
            }
        });

        it('shouldReEncodeToIdenticalBytes', () => {
            const fresh = new Uint8Array(datagram.length);
            for (const frame of d.frames) {
                encode(fresh, frame);
                // the bytes after the fixed header (payload, application specific feedback) are copied as is
                const fixed = FIXED_LENGTH.get(frame.type) as number;
                fresh.set(trailing(datagram, frame), frame.offset + fixed);
            }
            expect(toHex(fresh)).toBe(d.hex);
        });
    });

    it('shouldUseThePinnedChannelParameters', () => {
        // pinned in the capture script so that a swapped, truncated or unsigned read shows up: 0x87654321 as an int
        expect(golden.config.sessionId).toBe(-2023406815);
        expect(golden.config.streamId).toBe(0x12345678);
        for (const d of golden.datagrams) {
            for (const frame of d.frames) {
                if (frame.type === HDR_TYPE_SETUP) {
                    expect(frame.fields.sessionId).toBe(golden.config.sessionId);
                    expect(frame.fields.streamId).toBe(golden.config.streamId);
                    expect(frame.fields.initialTermId).toBe(golden.config.initialTermId);
                    // the publication starts one term after the initial term: the two fields must not be swapped
                    expect(frame.fields.activeTermId).toBe(golden.config.initialTermId + 1);
                    expect(frame.fields.termLength).toBe(golden.config.termLength);
                    expect(frame.fields.mtuLength).toBe(golden.config.mtu);
                }
            }
        }
    });
});

describe('GoldenFramesConstants', () => {
    it('shouldPinTheTsConstantsToTheCHeader', () => {
        expect(HeaderFlyweight.HDR_TYPE_PAD).toBe(0x00);
        expect(HeaderFlyweight.HDR_TYPE_DATA).toBe(0x01);
        expect(HeaderFlyweight.HDR_TYPE_NAK).toBe(0x02);
        expect(HeaderFlyweight.HDR_TYPE_SM).toBe(0x03);
        expect(HeaderFlyweight.HDR_TYPE_ERR).toBe(0x04);
        expect(HeaderFlyweight.HDR_TYPE_SETUP).toBe(0x05);
        expect(HeaderFlyweight.HDR_TYPE_RTTM).toBe(0x06);
        expect(HeaderFlyweight.HDR_TYPE_RES).toBe(0x07);
        expect(HeaderFlyweight.HDR_TYPE_RSP_SETUP).toBe(0x0b);
        expect(DataHeaderFlyweight.BEGIN_FLAG).toBe(0x80);
        expect(DataHeaderFlyweight.END_FLAG).toBe(0x40);
        expect(DataHeaderFlyweight.EOS_FLAG).toBe(0x20);
        expect(DataHeaderFlyweight.REVOKED_FLAG).toBe(0x10);
        expect(DataHeaderFlyweight.BEGIN_AND_END_FLAGS).toBe(0xc0);
        expect(StatusMessageFlyweight.SEND_SETUP_FLAG).toBe(0x80);
        expect(StatusMessageFlyweight.END_OF_STREAM_FLAG).toBe(0x40);
        expect(RttMeasurementFlyweight.REPLY_FLAG).toBe(0x80);
    });
});

describe('GoldenFramesCoverage', () => {
    const all = golden.datagrams.flatMap((d) => d.frames.map((frame) => ({ d, frame })));
    const where = (pred: (frame: GoldenFrame, d: GoldenDatagram) => boolean) =>
        all.filter(({ d, frame }) => pred(frame, d));
    // C header literals (aeron_udp_protocol.h): type PAD 0, DATA 1, NAK 2, SM 3, SETUP 5, RTTM 6.
    const isHeartbeat = (f: GoldenFrame): boolean => f.type === 0x01 && f.frameLength === 0;
    const sameFlags = (f: GoldenFrame, bits: number, names: string[]): boolean =>
        f.flags === bits && f.flagNames.join('+') === names.join('+');
    const wrapSm = (d: GoldenDatagram, frame: GoldenFrame): StatusMessageFlyweight => {
        const sm = new StatusMessageFlyweight();
        sm.wrap(fromHex(d.hex), frame.offset, d.hex.length / 2 - frame.offset);
        return sm;
    };

    it('shouldCoverSetup', () => {
        expect(where((f) => f.type === 0x05).length).toBeGreaterThan(0);
    });

    it('shouldCoverStatusMessagePlain', () => {
        expect(where((f) => f.type === 0x03 && f.flags === 0 && f.flagNames.length === 0).length).toBeGreaterThan(0);
    });

    it('shouldCoverStatusMessageWithSendSetupFlag', () => {
        const found = where((f) => f.type === 0x03 && sameFlags(f, 0x80, ['SEND_SETUP']));
        expect(found.length).toBeGreaterThan(0);
        expect(found.every(({ d }) => d.direction === 'sub->pub')).toBe(true);
        // the flyweight constant selects exactly these status messages
        for (const { d, frame } of found) {
            expect(wrapSm(d, frame).flags() & StatusMessageFlyweight.SEND_SETUP_FLAG).not.toBe(0);
        }
        for (const { d, frame } of where((f) => f.type === 0x03 && !f.flagNames.includes('SEND_SETUP'))) {
            expect(wrapSm(d, frame).flags() & StatusMessageFlyweight.SEND_SETUP_FLAG).toBe(0);
        }
    });

    it('shouldCoverStatusMessageWithEndOfStreamFlag', () => {
        const found = where((f) => f.type === 0x03 && sameFlags(f, 0x40, ['EOS']));
        expect(found.length).toBeGreaterThan(0);
        for (const { d, frame } of found) {
            expect(wrapSm(d, frame).flags() & StatusMessageFlyweight.END_OF_STREAM_FLAG).not.toBe(0);
        }
        for (const { d, frame } of where((f) => f.type === 0x03 && !f.flagNames.includes('EOS'))) {
            expect(wrapSm(d, frame).flags() & StatusMessageFlyweight.END_OF_STREAM_FLAG).toBe(0);
        }
    });

    it('shouldCoverUnfragmentedData', () => {
        expect(
            where((f) => f.type === 0x01 && f.frameLength > 32 && sameFlags(f, 0xc0, ['BEGIN', 'END'])).length,
        ).toBeGreaterThan(0);
    });

    it('shouldCoverBeginMiddleAndEndFragmentsOfAThreeMtuMessage', () => {
        const data = where((f) => f.type === 0x01 && f.frameLength > 32);
        const begin = data.filter(({ frame }) => sameFlags(frame, 0x80, ['BEGIN']));
        const middle = data.filter(({ frame }) => sameFlags(frame, 0, []));
        const end = data.filter(({ frame }) => sameFlags(frame, 0x40, ['END']));
        expect(begin.length).toBeGreaterThan(0);
        expect(middle.length).toBeGreaterThan(0);
        expect(end.length).toBeGreaterThan(0);

        // a BEGIN frame, then a MIDDLE frame, then an END frame at consecutive term offsets: the payload lengths
        // (frame length - 32) of the three captured frames add up to the 3500 byte message
        const sums = begin.flatMap(({ frame }) => {
            const next = (offset: number, flags: number) =>
                data.find(
                    (x) =>
                        x.frame.fields.termId === frame.fields.termId &&
                        x.frame.fields.termOffset === offset &&
                        x.frame.flags === flags,
                );
            const mid = next((frame.fields.termOffset as number) + BitUtil.align(frame.frameLength, 32), 0);
            if (mid === undefined) return [];
            const last = next((mid.frame.fields.termOffset as number) + BitUtil.align(mid.frame.frameLength, 32), 0x40);
            if (last === undefined) return [];
            return [[frame, mid.frame, last.frame].reduce((sum, f) => sum + (f.frameLength - 32), 0)];
        });
        expect(sums.length).toBeGreaterThan(0);
        expect(sums.every((sum) => sum === 3500)).toBe(true);
    });

    it('shouldCoverPaddingAtTermEnd', () => {
        const pads = where((f) => f.type === 0x00);
        expect(pads.length).toBeGreaterThan(0);
        for (const { frame } of pads) {
            // the pad runs to the end of the term
            expect((frame.fields.termOffset as number) + frame.frameLength).toBe(golden.config.termLength);
        }
    });

    it('shouldCoverHeartbeat', () => {
        const hb = where((f) => isHeartbeat(f) && sameFlags(f, 0xc0, ['BEGIN', 'END']));
        expect(hb.length).toBeGreaterThan(0);
        for (const { d } of hb) {
            expect(d.hex.length).toBe(32 * 2);
            expect(DataHeaderFlyweight.isHeartbeat(new UnsafeBuffer(fromHex(d.hex)), 32)).toBe(true);
            expect(DataHeaderFlyweight.isHeartbeat(new UnsafeBuffer(fromHex(d.hex)), 33)).toBe(false);
        }
    });

    it('shouldCoverEndOfStream', () => {
        const eos = where((f) => isHeartbeat(f) && f.flagNames.includes('EOS'));
        expect(eos.length).toBeGreaterThan(0);
        for (const { frame } of eos) expect(sameFlags(frame, 0xe0, ['BEGIN', 'END', 'EOS'])).toBe(true);
    });

    it('shouldCoverNakAndTheRetransmittedData', () => {
        expect(where((f) => f.type === 0x02).length).toBeGreaterThan(0);

        const dropped = golden.datagrams.filter((d) => d.dropped === true);
        expect(dropped.length).toBe(1);
        const lost = dropped[0] as GoldenDatagram;
        const retransmits = golden.datagrams.filter((d) => d.retransmitOf === lost.seq);
        expect(retransmits.length).toBeGreaterThan(0);
        const lostFrame = lost.frames[0] as GoldenFrame;
        // the NAK asks for the dropped frame and the retransmit repeats it byte for byte
        const nak = golden.datagrams.find(
            (d) =>
                d.scenario === lost.scenario &&
                d.direction === 'sub->pub' &&
                d.frames[0]?.type === 0x02 &&
                d.frames[0]?.fields.termId === lostFrame.fields.termId &&
                d.frames[0]?.fields.termOffset === lostFrame.fields.termOffset,
        );
        expect(nak).toBeDefined();
        expect(nak?.seq).toBeGreaterThan(lost.seq);
        // the NAK covers the whole lost frame, rounded up to the frame alignment
        expect(nak?.frames[0]?.fields.length).toBe(BitUtil.align(lostFrame.frameLength, 32));
        expect((retransmits[0] as GoldenDatagram).hex).toBe(lost.hex);
        expect((retransmits[0] as GoldenDatagram).seq).toBeGreaterThan(nak?.seq ?? Infinity);
    });

    it('shouldCoverRttmRequestAndReply', () => {
        // the C receiver's request carries REPLY_FLAG (asks the sender to reply); the sender's reply clears it
        const requests = where((f, d) => f.type === 0x06 && d.direction === 'sub->pub');
        const replies = where((f, d) => f.type === 0x06 && d.direction === 'pub->sub');
        expect(requests.length).toBeGreaterThan(0);
        expect(replies.length).toBeGreaterThan(0);
        for (const { frame } of requests) expect(sameFlags(frame, 0x80, ['REPLY'])).toBe(true);
        for (const { frame } of replies) expect(sameFlags(frame, 0, [])).toBe(true);
        // a reply echoes the request timestamp
        const echoes = new Set(requests.map(({ frame }) => frame.fields.echoTimestampNs));
        expect(replies.some(({ frame }) => echoes.has(frame.fields.echoTimestampNs))).toBe(true);
    });

    it('shouldUseOneReceiverIdForTheStatusMessagesAndTheRttmFramesOfTheBasicScenario', () => {
        const basic = all.filter(({ d }) => d.scenario === 'basic');
        const sm = new Set(
            basic.filter(({ frame }) => frame.type === 0x03).map(({ frame }) => frame.fields.receiverId),
        );
        const rttm = basic.filter(({ frame }) => frame.type === 0x06);
        expect(sm.size).toBe(1);
        expect(rttm.length).toBeGreaterThan(0);
        for (const { frame } of rttm) expect(sm.has(frame.fields.receiverId)).toBe(true);
    });

    it('shouldCoverAMultiFrameDatagram', () => {
        // a data frame followed by the PAD header in one datagram exercises the FRAME_ALIGNMENT walk
        const multi = golden.datagrams.filter((d) => d.frames.length > 1);
        expect(multi.length).toBeGreaterThan(0);
        const withPad = multi.filter((d) => d.frames[0]?.type === 0x01 && d.frames[1]?.type === 0x00);
        expect(withPad.length).toBeGreaterThan(0);
        for (const d of withPad) {
            const [data, pad] = d.frames as [GoldenFrame, GoldenFrame];
            expect(pad.offset).toBe(BitUtil.align(data.frameLength, 32));
        }
    });

    it('shouldHaveEveryScenario', () => {
        expect(golden.scenarios.map((s) => s.name)).toEqual(['basic', 'fragmented', 'pad', 'loss', 'setup-elicit']);
        for (const s of golden.scenarios) {
            expect(golden.datagrams.some((d) => d.scenario === s.name)).toBe(true);
        }
    });
});
