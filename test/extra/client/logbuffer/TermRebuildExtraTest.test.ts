// Not in Aeron: the interaction matrix row "Term rebuild" of T10 (plan "Interaction matrix"). `TermRebuilder.insert`,
// `TermGapScanner.scanForGap`, `TermGapFiller.tryFillGap` and `TermReader.read` over frames of 0 (a heartbeat), 1 and
// MTU - 32 bytes of payload, padding at the end of the term and fragmented messages, inserted in order, reversed and
// in 200 seeded random shuffles with duplicates, and a gap filled before the frame that belongs in it arrives; plus
// gaps at every offset, the fragments limit, the term end, the term id wrap, the packed outcomes (spec D13) and the
// block scanner over padding.
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermBlockScanner } from '../../../../src/client/logbuffer/TermBlockScanner.js';
import { TermGapFiller } from '../../../../src/client/logbuffer/TermGapFiller.js';
import { TermGapScanner } from '../../../../src/client/logbuffer/TermGapScanner.js';
import { TermReader } from '../../../../src/client/logbuffer/TermReader.js';
import { TermRebuilder } from '../../../../src/client/logbuffer/TermRebuilder.js';
import { TermScanner } from '../../../../src/client/logbuffer/TermScanner.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { assertThrows } from '../../../support/Assertions.js';
import { MockPosition } from '../../../support/MockPosition.js';
import { mulberry32 } from '../../../support/Random.js';

const { FRAME_ALIGNMENT, PADDING_FRAME_TYPE, UNFRAGMENTED } = FrameDescriptor;
const { LITTLE_ENDIAN } = ByteOrder;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { HDR_TYPE_DATA } = HeaderFlyweight;
const { align } = BitUtil;

const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const MTU = 1408;
const SESSION_ID = 1234;
const STREAM_ID = 1001;
const INITIAL_TERM_ID = 5;
const TERM_ID = 9;
const BEGIN = 0x80;
const END = 0x40;
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/** One frame of the model: where it lives, what it carries, and the packet that delivers it. */
interface ModelFrame {
    readonly offset: number;
    readonly type: number;
    readonly flags: number;
    readonly payload: number;
    /** The length field of the frame; for the padding at the end of a term it is the whole padding. */
    readonly frameLength: number;
    /** The bytes the frame occupies in the packet: a padding frame is a header only. */
    readonly packetLength: number;
    readonly seed: number;
}

function payloadByte(frame: ModelFrame, i: number): number {
    return (frame.seed * 131 + i * 31 + 7) & 0xff;
}

function packetFor(frame: ModelFrame, termId = TERM_ID, corrupt = false): UnsafeBuffer {
    const packet = new UnsafeBuffer(new ArrayBuffer(frame.packetLength));
    packet.putInt(0, frame.frameLength, LITTLE_ENDIAN);
    packet.putByte(FrameDescriptor.VERSION_OFFSET, 0);
    packet.putByte(FrameDescriptor.FLAGS_OFFSET, frame.flags);
    packet.putShort(FrameDescriptor.TYPE_OFFSET, frame.type, LITTLE_ENDIAN);
    packet.putInt(FrameDescriptor.TERM_OFFSET, frame.offset, LITTLE_ENDIAN);
    packet.putInt(FrameDescriptor.SESSION_ID_OFFSET, SESSION_ID, LITTLE_ENDIAN);
    packet.putInt(DataHeaderFlyweight.STREAM_ID_FIELD_OFFSET, STREAM_ID, LITTLE_ENDIAN);
    packet.putInt(FrameDescriptor.TERM_ID_OFFSET, termId, LITTLE_ENDIAN);
    if (HDR_TYPE_DATA === frame.type) {
        for (let i = 0; i < frame.payload; i++) {
            packet.putByte(HEADER_LENGTH + i, payloadByte(frame, i) ^ (corrupt ? 0xff : 0));
        }
    }

    return packet;
}

/** The frames of a message: BEGIN, MIDDLE x n and END, or one unfragmented frame. */
function sizes(rnd: () => number): number {
    const pick = Math.floor(rnd() * 5);
    return [0, 1, MTU - HEADER_LENGTH, Math.floor(rnd() * (MTU - HEADER_LENGTH)), 100][pick] as number;
}

function makeCase(seed: number): ModelFrame[] {
    const rnd = mulberry32(seed);
    const frames: ModelFrame[] = [];
    let offset = 0;
    const messages = 1 + Math.floor(rnd() * 6);
    for (let m = 0; m < messages; m++) {
        const fragments = 1 + Math.floor(rnd() * 3);
        for (let f = 0; f < fragments; f++) {
            const payload = sizes(rnd);
            const flags = 1 === fragments ? UNFRAGMENTED & 0xff : 0 === f ? BEGIN : f === fragments - 1 ? END : 0;
            const frameLength = HEADER_LENGTH + payload;
            frames.push({
                offset,
                type: HDR_TYPE_DATA,
                flags,
                payload,
                frameLength,
                packetLength: frameLength,
                seed: seed + frames.length,
            });
            offset += align(frameLength, FRAME_ALIGNMENT);
        }
    }

    if (rnd() < 0.4) {
        // padding to the end of the term: its packet is a header, its length field is the rest of the term
        frames.push({
            offset,
            type: PADDING_FRAME_TYPE,
            flags: UNFRAGMENTED & 0xff,
            payload: 0,
            frameLength: TERM_LENGTH - offset,
            packetLength: HEADER_LENGTH,
            seed: 0,
        });
    }

    return frames;
}

function endOf(frame: ModelFrame): number {
    return frame.offset + align(frame.frameLength, FRAME_ALIGNMENT);
}

interface Read {
    offset: number;
    length: number;
    flags: number;
    termOffset: number;
    termId: number;
    sessionId: number;
    streamId: number;
    frameLength: number;
    type: number;
    bytes: number[];
}

function readAll(
    termBuffer: UnsafeBuffer,
    fragmentsLimit = INT32_MAX,
): { reads: Read[]; fragments: number; to: number } {
    const reads: Read[] = [];
    const header = new Header(INITIAL_TERM_ID, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
    const errors: Error[] = [];
    const outcome = TermReader.read(
        termBuffer,
        0,
        {
            onFragment: (buffer, offset, length, h) => {
                const bytes: number[] = [];
                for (let i = 0; i < length; i++) {
                    bytes.push(buffer.getByte(offset + i) & 0xff);
                }
                reads.push({
                    offset,
                    length,
                    flags: h.flags() & 0xff,
                    termOffset: h.termOffset(),
                    termId: h.termId(),
                    sessionId: h.sessionId(),
                    streamId: h.streamId(),
                    frameLength: h.frameLength(),
                    type: h.type(),
                    bytes,
                });
            },
        },
        fragmentsLimit,
        header,
        { onError: (e) => errors.push(e) },
    );
    expect(errors).toEqual([]);

    return { reads, fragments: TermReader.fragmentsRead(outcome), to: TermReader.offset(outcome) };
}

function expectReads(expected: readonly ModelFrame[], result: ReturnType<typeof readAll>, to: number): void {
    const data = expected.filter((f) => HDR_TYPE_DATA === f.type);
    expect(result.fragments).toBe(data.length);
    expect(result.reads.length).toBe(data.length);
    expect(result.to).toBe(to);
    data.forEach((f, i) => {
        const r = result.reads[i] as Read;
        expect(r.offset).toBe(f.offset + HEADER_LENGTH);
        expect(r.length).toBe(f.payload);
        expect(r.flags).toBe(f.flags);
        expect(r.termOffset).toBe(f.offset);
        expect(r.termId).toBe(TERM_ID);
        expect(r.sessionId).toBe(SESSION_ID);
        expect(r.streamId).toBe(STREAM_ID);
        expect(r.frameLength).toBe(f.frameLength);
        expect(r.type).toBe(HDR_TYPE_DATA);
        expect(r.bytes).toEqual(Array.from({ length: f.payload }, (_, j) => payloadByte(f, j)));
    });
}

function newTerm(): UnsafeBuffer {
    return new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
}

function newMetaData(): UnsafeBuffer {
    const metaData = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
    LogBufferDescriptor.initialTermId(metaData, INITIAL_TERM_ID);
    LogBufferDescriptor.storeDefaultFrameHeader(
        metaData,
        DataHeaderFlyweight.createDefaultHeader(SESSION_ID, STREAM_ID, INITIAL_TERM_ID),
    );
    return metaData;
}

interface Gap {
    termId: number;
    offset: number;
    length: number;
}

function scanGaps(termBuffer: UnsafeBuffer, limit: number): { stop: number; gaps: Gap[] } {
    const gaps: Gap[] = [];
    const stop = TermGapScanner.scanForGap(termBuffer, TERM_ID, 0, limit, {
        onGap: (termId, offset, length) => gaps.push({ termId, offset, length }),
    });
    return { stop, gaps };
}

/** What the scanner must report after `inserted` have arrived: the model of a gap and of the high-water mark. */
function modelGap(frames: readonly ModelFrame[], inserted: ReadonlySet<number>): { hwm: number; gap?: Gap } {
    let hwm = 0;
    inserted.forEach((i) => (hwm = Math.max(hwm, endOf(frames[i] as ModelFrame))));
    let prefixEnd = 0;
    for (let i = 0; i < frames.length && inserted.has(i); i++) {
        prefixEnd = endOf(frames[i] as ModelFrame);
    }

    if (prefixEnd >= hwm) {
        return { hwm };
    }

    let next = hwm;
    inserted.forEach((i) => {
        const f = frames[i] as ModelFrame;
        if (f.offset >= prefixEnd && f.offset < next) {
            next = f.offset;
        }
    });

    return { hwm, gap: { termId: TERM_ID, offset: prefixEnd, length: next - prefixEnd } };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
}

describe('Term rebuild extra: orderings', () => {
    function rebuild(frames: readonly ModelFrame[], order: readonly number[], checkGaps: boolean): UnsafeBuffer {
        const termBuffer = newTerm();
        const inserted = new Set<number>();
        for (const index of order) {
            const frame = frames[index] as ModelFrame;
            if (inserted.has(index)) {
                // a duplicate with other payload bytes must not overwrite the frame that is there
                TermRebuilder.insert(termBuffer, frame.offset, packetFor(frame, TERM_ID, true), frame.packetLength);
            } else {
                TermRebuilder.insert(termBuffer, frame.offset, packetFor(frame), frame.packetLength);
            }
            inserted.add(index);

            if (checkGaps) {
                const model = modelGap(frames, inserted);
                const { stop, gaps } = scanGaps(termBuffer, model.hwm);
                if (undefined === model.gap) {
                    expect(gaps).toEqual([]);
                    expect(stop).toBe(model.hwm);
                } else {
                    expect(gaps).toEqual([model.gap]);
                    expect(stop).toBe(model.gap.offset);
                }
            }
        }
        return termBuffer;
    }

    function finish(frames: readonly ModelFrame[], termBuffer: UnsafeBuffer): void {
        const last = frames[frames.length - 1] as ModelFrame;
        expectReads(frames, readAll(termBuffer), endOf(last));
        expect(scanGaps(termBuffer, endOf(last))).toEqual({ stop: endOf(last), gaps: [] });
    }

    for (const payload of [0, 1, MTU - HEADER_LENGTH]) {
        it(`a single frame of ${payload} bytes of payload is rebuilt and read`, () => {
            const frame: ModelFrame = {
                offset: 0,
                type: HDR_TYPE_DATA,
                flags: UNFRAGMENTED & 0xff,
                payload,
                frameLength: HEADER_LENGTH + payload,
                packetLength: HEADER_LENGTH + payload,
                seed: 17,
            };
            finish([frame], rebuild([frame], [0], true));
        });
    }

    it('in order', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const frames = makeCase(seed);
            finish(
                frames,
                rebuild(
                    frames,
                    frames.map((_, i) => i),
                    true,
                ),
            );
        }
    });

    it('reversed', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const frames = makeCase(seed);
            finish(
                frames,
                rebuild(
                    frames,
                    frames.map((_, i) => frames.length - 1 - i),
                    true,
                ),
            );
        }
    });

    it('200 seeded random shuffles with duplicates', () => {
        for (let seed = 1000; seed < 1200; seed++) {
            const rnd = mulberry32(seed);
            const frames = makeCase(seed);
            const order = shuffle(
                frames.map((_, i) => i),
                rnd,
            );
            const duplicates = Math.floor(rnd() * 4);
            for (let d = 0; d < duplicates; d++) {
                order.splice(Math.floor(rnd() * (order.length + 1)), 0, Math.floor(rnd() * frames.length));
            }
            // a duplicate that comes before the original is the original: the first arrival wins either way
            finish(frames, rebuild(frames, order, true));
        }
    });

    it('a duplicate frame leaves the frame that is there untouched, and a late padding frame too', () => {
        const frames = makeCase(77);
        const termBuffer = rebuild(
            frames,
            frames.map((_, i) => i),
            false,
        );
        const before = termBuffer.byteArray().slice();
        for (const frame of frames) {
            TermRebuilder.insert(termBuffer, frame.offset, packetFor(frame, TERM_ID, true), frame.packetLength);
        }
        expect(termBuffer.byteArray()).toEqual(before);
    });
});

describe('Term rebuild extra: gap filled, then the frame arrives late', () => {
    it('200 seeded cases: every gap is padded, and the late frames are skipped by the reader', () => {
        for (let seed = 5000; seed < 5200; seed++) {
            const rnd = mulberry32(seed);
            const frames = makeCase(seed);
            const metaData = newMetaData();
            const termBuffer = newTerm();

            const arrivedOnTime = new Set<number>();
            frames.forEach((_, i) => {
                // the first frame always arrives; the others with a probability of one half
                if (0 === i || rnd() < 0.5) {
                    arrivedOnTime.add(i);
                }
            });
            for (const i of arrivedOnTime) {
                const frame = frames[i] as ModelFrame;
                TermRebuilder.insert(termBuffer, frame.offset, packetFor(frame), frame.packetLength);
            }

            // fill every gap, in order, as the loss handling does
            const model = modelGap(frames, arrivedOnTime);
            const filled: Gap[] = [];
            let from = 0;
            for (let guard = 0; guard < 100; guard++) {
                const gaps: Gap[] = [];
                const stop = TermGapScanner.scanForGap(termBuffer, TERM_ID, from, model.hwm, {
                    onGap: (termId, offset, length) => gaps.push({ termId, offset, length }),
                });
                if (0 === gaps.length) {
                    expect(stop).toBe(model.hwm);
                    break;
                }
                const gap = gaps[0] as Gap;
                expect(TermGapFiller.tryFillGap(metaData, termBuffer, TERM_ID, gap.offset, gap.length)).toBe(true);
                // a gap is filled once: the padding frame is a frame now
                expect(TermGapFiller.tryFillGap(metaData, termBuffer, TERM_ID, gap.offset, gap.length)).toBe(false);
                filled.push(gap);
                from = gap.offset;
            }

            // the frames that were lost arrive late, in a random order
            const late = shuffle(
                frames.map((_, i) => i).filter((i) => !arrivedOnTime.has(i)),
                rnd,
            );
            for (const i of late) {
                const frame = frames[i] as ModelFrame;
                TermRebuilder.insert(termBuffer, frame.offset, packetFor(frame), frame.packetLength);
            }

            // the reader sees every frame that is not inside a padded gap: those the gap held are skipped, whether the
            // late frame landed on the padding header (ignored) or inside the gap (written, but jumped over), and the
            // frames after the high-water mark, which no gap covered, are read as they arrived
            const onTime = frames.filter(
                (f) =>
                    HDR_TYPE_DATA === f.type &&
                    !filled.some((g) => f.offset >= g.offset && f.offset < g.offset + g.length),
            );
            const result = readAll(termBuffer);
            expect(result.reads.map((r) => r.termOffset)).toEqual(onTime.map((f) => f.offset));
            expect(result.fragments).toBe(onTime.length);
            expect(result.to).toBe(endOf(frames[frames.length - 1] as ModelFrame));
            for (const g of filled) {
                expect(FrameDescriptor.frameType(termBuffer, g.offset)).toBe(PADDING_FRAME_TYPE);
                expect(FrameDescriptor.frameLength(termBuffer, g.offset)).toBe(g.length);
                expect(FrameDescriptor.frameTermId(termBuffer, g.offset)).toBe(TERM_ID);
                expect(FrameDescriptor.frameSessionId(termBuffer, g.offset)).toBe(SESSION_ID);
            }
        }
    });

    it('a gap that holds data is not filled, at the first, a middle and the last frame of the gap', () => {
        for (const dataAt of [0, 32, 64, 96]) {
            const metaData = newMetaData();
            const termBuffer = newTerm();
            termBuffer.putInt(256 + dataAt, 1);
            expect(TermGapFiller.tryFillGap(metaData, termBuffer, TERM_ID, 256, 128)).toBe(false);
            // nothing was written
            expect(FrameDescriptor.frameType(termBuffer, 256)).toBe(0);
            expect(FrameDescriptor.frameLength(termBuffer, 256)).toBe(dataAt === 0 ? 1 : 0);
        }
    });
});

describe('Term rebuild extra: gaps at every offset', () => {
    it('a gap of 1, 2 and 3 frames of 32 bytes at every offset of a 1 KiB run', () => {
        const run = 1024;
        for (const frames of [1, 2, 3]) {
            for (let gapAt = 0; gapAt < run; gapAt += FRAME_ALIGNMENT) {
                const termBuffer = newTerm();
                for (let offset = 0; offset < run; offset += FRAME_ALIGNMENT) {
                    if (offset < gapAt || offset >= gapAt + frames * FRAME_ALIGNMENT) {
                        termBuffer.putInt(offset, HEADER_LENGTH);
                    }
                }

                const { stop, gaps } = scanGaps(termBuffer, run);
                expect(stop).toBe(gapAt);
                expect(gaps).toEqual([
                    { termId: TERM_ID, offset: gapAt, length: Math.min(frames * FRAME_ALIGNMENT, run - gapAt) },
                ]);
            }
        }
    });

    it('the high-water mark inside a frame, and a gap right at the high-water mark, report nothing', () => {
        const termBuffer = newTerm();
        termBuffer.putInt(0, 96);
        // hwm at 64: the frame at 0 reaches 96, beyond the hwm
        expect(scanGaps(termBuffer, 64)).toEqual({ stop: 96, gaps: [] });
        // hwm at 96: nothing is missing
        expect(scanGaps(termBuffer, 96)).toEqual({ stop: 96, gaps: [] });
        // hwm at 128: 96..128 is missing
        expect(scanGaps(termBuffer, 128)).toEqual({ stop: 96, gaps: [{ termId: TERM_ID, offset: 96, length: 32 }] });
    });
});

describe('Term rebuild extra: the fragments limit and the term end', () => {
    function frame(
        offset: number,
        payload: number,
        type = HDR_TYPE_DATA,
        frameLength = HEADER_LENGTH + payload,
    ): ModelFrame {
        return {
            offset,
            type,
            flags: UNFRAGMENTED & 0xff,
            payload,
            frameLength,
            packetLength: HEADER_LENGTH + (HDR_TYPE_DATA === type ? payload : 0),
            seed: offset,
        };
    }

    it('read stops at every fragments limit from 0 to past the end, and the position follows the bytes consumed', () => {
        const frames = [frame(0, 0), frame(32, 1), frame(96, 100), frame(256, 0)];
        const termBuffer = newTerm();
        for (const f of frames) {
            TermRebuilder.insert(termBuffer, f.offset, packetFor(f), f.packetLength);
        }
        const header = new Header(INITIAL_TERM_ID, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
        for (let limit = 0; limit <= 6; limit++) {
            const position = new MockPosition();
            const seen: number[] = [];
            const count = TermReader.read(
                termBuffer,
                0,
                { onFragment: (_b, offset) => seen.push(offset) },
                limit,
                header,
                { onError: () => expect.unreachable() },
                1000,
                position,
            );
            const expectedCount = Math.min(limit, 4);
            expect(count).toBe(expectedCount);
            expect(seen).toEqual(frames.slice(0, expectedCount).map((f) => f.offset + HEADER_LENGTH));
            if (0 === expectedCount) {
                expect(position.setReleaseSpy).not.toHaveBeenCalled();
            } else {
                expect(position.setReleaseSpy.mock.calls).toEqual([
                    [1000 + endOf(frames[expectedCount - 1] as ModelFrame)],
                ]);
            }
        }
    });

    it('a padding frame does not count against the limit, and a limit of 1 reads past it', () => {
        const termBuffer = newTerm();
        const padding = frame(0, 0, PADDING_FRAME_TYPE, 64);
        const data = frame(64, 5);
        TermRebuilder.insert(termBuffer, padding.offset, packetFor(padding), padding.packetLength);
        TermRebuilder.insert(termBuffer, data.offset, packetFor(data), data.packetLength);
        const result = readAll(termBuffer, 1);
        expect(result.fragments).toBe(1);
        expect(result.reads.map((r) => r.termOffset)).toEqual([64]);
        expect(result.to).toBe(endOf(data));
    });

    it('the last frame of a term is read and the read stops at the capacity', () => {
        const termBuffer = newTerm();
        const last = frame(TERM_LENGTH - 64, 5);
        TermRebuilder.insert(termBuffer, last.offset, packetFor(last), last.packetLength);
        const header = new Header(INITIAL_TERM_ID, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
        const outcome = TermReader.read(termBuffer, last.offset, { onFragment: () => {} }, INT32_MAX, header, {
            onError: () => expect.unreachable(),
        });
        expect(TermReader.fragmentsRead(outcome)).toBe(1);
        expect(TermReader.offset(outcome)).toBe(TERM_LENGTH);
    });

    it('padding to the end of the term is skipped and read reports the end of the term', () => {
        const termBuffer = newTerm();
        const data = frame(0, 10);
        const padding = frame(64, 0, PADDING_FRAME_TYPE, TERM_LENGTH - 64);
        TermRebuilder.insert(termBuffer, data.offset, packetFor(data), data.packetLength);
        TermRebuilder.insert(termBuffer, padding.offset, packetFor(padding), padding.packetLength);
        const result = readAll(termBuffer);
        expect(result.fragments).toBe(1);
        expect(result.to).toBe(TERM_LENGTH);
    });

    it('an error from the handler is reported, the fragment is counted, and the read stops there', () => {
        const termBuffer = newTerm();
        const a = frame(0, 1);
        const b = frame(64, 1);
        TermRebuilder.insert(termBuffer, a.offset, packetFor(a), a.packetLength);
        TermRebuilder.insert(termBuffer, b.offset, packetFor(b), b.packetLength);
        const header = new Header(INITIAL_TERM_ID, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
        const position = new MockPosition();
        const errors: Error[] = [];
        const failure = new Error('handler failed');
        const count = TermReader.read(
            termBuffer,
            0,
            {
                onFragment: () => {
                    throw failure;
                },
            },
            INT32_MAX,
            header,
            { onError: (e) => errors.push(e) },
            0,
            position,
        );
        // as in Java: the offset has moved past the frame that threw, and the position is released up to it
        expect(count).toBe(1);
        expect(errors).toEqual([failure]);
        expect(position.setReleaseSpy.mock.calls).toEqual([[endOf(a)]]);
    });
});

describe('Term rebuild extra: the term id wrap', () => {
    it('tryFillGap writes any int term id', () => {
        for (const termId of [0, 1, -1, INT32_MAX, INT32_MIN]) {
            const termBuffer = newTerm();
            expect(TermGapFiller.tryFillGap(newMetaData(), termBuffer, termId, 64, 96)).toBe(true);
            expect(FrameDescriptor.frameTermId(termBuffer, 64)).toBe(termId);
            expect(FrameDescriptor.frameLength(termBuffer, 64)).toBe(96);
            expect(FrameDescriptor.frameType(termBuffer, 64)).toBe(PADDING_FRAME_TYPE);
        }
    });

    it('scanForGap hands any int term id to the handler', () => {
        for (const termId of [0, -1, INT32_MAX, INT32_MIN]) {
            const termBuffer = newTerm();
            termBuffer.putInt(64, 32);
            const gaps: number[] = [];
            expect(TermGapScanner.scanForGap(termBuffer, termId, 0, 96, { onGap: (id) => gaps.push(id) })).toBe(0);
            expect(gaps).toEqual([termId]);
        }
    });

    it('the header of a fragment reports the term id of the frame across the wrap', () => {
        for (const termId of [INT32_MAX, INT32_MIN]) {
            const termBuffer = newTerm();
            const f: ModelFrame = {
                offset: 0,
                type: HDR_TYPE_DATA,
                flags: UNFRAGMENTED & 0xff,
                payload: 3,
                frameLength: 35,
                packetLength: 35,
                seed: 3,
            };
            TermRebuilder.insert(termBuffer, 0, packetFor(f, termId), 35);
            const ids: number[] = [];
            const header = new Header(INT32_MAX, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
            TermReader.read(termBuffer, 0, { onFragment: (_b, _o, _l, h) => ids.push(h.termId()) }, 1, header, {
                onError: () => expect.unreachable(),
            });
            expect(ids).toEqual([termId]);
        }
    });
});

describe('Term rebuild extra: packed outcomes (spec D13)', () => {
    it('TermReader.pack round trips offsets and counts at the boundaries', () => {
        for (const offset of [0, 32, 64, TERM_LENGTH, 1 << 24, 1 << 30, INT32_MAX - 31]) {
            for (const count of [0, 1, 2, 12345, (1 << 25) - 1, (1 << 26) - 1]) {
                const packed = TermReader.pack(offset, count);
                expect(Number.isSafeInteger(packed)).toBe(true);
                expect(TermReader.offset(packed)).toBe(offset);
                expect(TermReader.fragmentsRead(packed)).toBe(count);
            }
        }
    });

    it('TermReader.pack refuses what it cannot hold with a RangeError', () => {
        for (const [offset, count] of [
            [-32, 0],
            [31, 0],
            [33, 1],
            [INT32_MAX + 1, 0],
            [0, -1],
            [0, 1 << 26],
            [0.5, 0],
            [0, 0.5],
            [Number.NaN, 0],
            [0, Number.NaN],
        ] as const) {
            assertThrows(RangeError, () => TermReader.pack(offset, count));
        }
    });

    it('TermScanner.pack round trips padding and available at the boundaries', () => {
        const paddings = [0, 1, 77, 32, 1 << 20, 1 << 30];
        const availables = [0, 1, 65000, (1 << 21) - 1, -1, -32, -(1 << 21)];
        for (const padding of paddings) {
            for (const available of availables) {
                const packed = TermScanner.pack(padding, available);
                expect(Number.isSafeInteger(packed)).toBe(true);
                expect(TermScanner.available(packed)).toBe(available);
                // as in Java, a negative available sign extends over the padding half
                expect(TermScanner.padding(packed)).toBe(available < 0 ? -1 : padding);
            }
        }
    });

    it('TermScanner.pack refuses what it cannot hold with a RangeError', () => {
        for (const [padding, available] of [
            [0, 1 << 21],
            [0, -(1 << 21) - 1],
            [(1 << 30) + 1, 0],
            [-(1 << 30) - 1, 0],
            [0.5, 0],
            [0, 0.5],
            [Number.NaN, 0],
            [0, Number.NaN],
        ] as const) {
            assertThrows(RangeError, () => TermScanner.pack(padding, available));
        }
    });
});

describe('Term rebuild extra: scanners over padding and the term end', () => {
    function put(termBuffer: UnsafeBuffer, offset: number, frameLength: number, type = HDR_TYPE_DATA): void {
        termBuffer.putInt(offset, frameLength);
        FrameDescriptor.frameType(termBuffer, offset, type);
    }

    it('scanForAvailability stops after the padding header of padding at the end of the term, at every mtu', () => {
        for (const mtu of [64, 96, 128, 1024, MTU, 4096]) {
            const termBuffer = newTerm();
            const dataLength = 64;
            const paddingLength = 160;
            const offset = TERM_LENGTH - dataLength - paddingLength;
            put(termBuffer, offset, dataLength);
            put(termBuffer, offset + dataLength, paddingLength, PADDING_FRAME_TYPE);

            const outcome = TermScanner.scanForAvailability(termBuffer, offset, mtu);
            if (mtu >= dataLength + HEADER_LENGTH) {
                expect(TermScanner.available(outcome)).toBe(dataLength + HEADER_LENGTH);
                expect(TermScanner.padding(outcome)).toBe(paddingLength - HEADER_LENGTH);
            } else {
                expect(TermScanner.available(outcome)).toBe(dataLength);
                expect(TermScanner.padding(outcome)).toBe(0);
            }
        }
    });

    it('scanForAvailability at the last byte of the term, and with a max length of 0', () => {
        const termBuffer = newTerm();
        put(termBuffer, TERM_LENGTH - 32, 32);
        const last = TermScanner.scanForAvailability(termBuffer, TERM_LENGTH - 32, MTU);
        expect(TermScanner.available(last)).toBe(32);
        expect(TermScanner.padding(last)).toBe(0);

        put(termBuffer, 0, 32);
        const none = TermScanner.scanForAvailability(termBuffer, 0, 0);
        expect(TermScanner.available(none)).toBe(-32);
        expect(TermScanner.padding(none)).toBe(-1);
    });

    it('scan of blocks: a padding frame is a block of its own, at the start and after data', () => {
        const termBuffer = newTerm();
        put(termBuffer, 0, 64, PADDING_FRAME_TYPE);
        put(termBuffer, 64, 64);
        put(termBuffer, 128, 64);
        put(termBuffer, 192, 96, PADDING_FRAME_TYPE);
        expect(TermBlockScanner.scan(termBuffer, 0, TERM_LENGTH)).toBe(64);
        expect(TermBlockScanner.scan(termBuffer, 64, TERM_LENGTH)).toBe(192);
        expect(TermBlockScanner.scan(termBuffer, 192, TERM_LENGTH)).toBe(288);
        expect(TermBlockScanner.scan(termBuffer, 288, TERM_LENGTH)).toBe(288);
        // the limit cuts a block between frames
        expect(TermBlockScanner.scan(termBuffer, 64, 191)).toBe(128);
        expect(TermBlockScanner.scan(termBuffer, 64, 64)).toBe(64);
    });
});
