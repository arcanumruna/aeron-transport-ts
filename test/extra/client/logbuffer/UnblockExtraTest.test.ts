// Not in Aeron: the interaction matrix row "Unblock" of T10 (plan "Interaction matrix"). `TermUnblocker.unblock` and
// `LogBufferUnblocker.unblock` with the blocked frame at the start, in the middle and at the last frame of a term,
// across a term boundary, before and after the tail moves, with the initial term id at 1, INT32_MAX and INT32_MIN (so
// that the term id wraps within the first terms) and at term counts 0 to 3 (so that the partitions wrap).
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { LogBufferUnblocker } from '../../../../src/client/logbuffer/LogBufferUnblocker.js';
import { TermUnblocker } from '../../../../src/client/logbuffer/TermUnblocker.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';

const { NO_ACTION, UNBLOCKED, UNBLOCKED_TO_END } = TermUnblocker.Status;
const {
    LOG_META_DATA_LENGTH,
    PARTITION_COUNT,
    TERM_MIN_LENGTH,
    activeTermCount,
    computePosition,
    indexByTermCount,
    initialTermId,
    initialiseTailWithTermId,
    packTail,
    rawTail,
    rawTailVolatile,
    storeDefaultFrameHeader,
    termId,
    termOffset,
} = LogBufferDescriptor;

const TERM_LENGTH = TERM_MIN_LENGTH;
const SESSION_ID = 77;
const STREAM_ID = 88;
const MESSAGE = 128;
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const BITS = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);

type Where = 'start' | 'middle' | 'last';
type Hole = 'uncommitted' | 'zeros, tail not past the hole' | 'zeros, committed frame after the hole';

const OFFSETS: Record<Where, number> = { start: 0, middle: 4096, last: TERM_LENGTH - MESSAGE };

class Log {
    public readonly meta = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
    public readonly terms: UnsafeBuffer[] = [];

    public constructor(
        public readonly initial: number,
        public readonly count: number,
    ) {
        for (let i = 0; i < PARTITION_COUNT; i++) {
            this.terms.push(new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH)));
        }
        initialTermId(this.meta, initial);
        storeDefaultFrameHeader(this.meta, DataHeaderFlyweight.createDefaultHeader(SESSION_ID, STREAM_ID, initial));
        // the partitions hold the terms of counts count - 2 .. count (a negative count is the term id that the rotation
        // expects, as in Java's setUp), and the next term to rotate to takes the place of count - 2
        for (let d = 0; d < PARTITION_COUNT; d++) {
            const termCount = count - d;
            initialiseTailWithTermId(this.meta, ((termCount % 3) + 3) % 3, (initial + termCount) | 0);
        }
        activeTermCount(this.meta, count);
    }

    public activeIndex(): number {
        return indexByTermCount(this.count);
    }

    public activeTermId(): number {
        return (this.initial + this.count) | 0;
    }

    public setTail(offset: number): void {
        rawTail(this.meta, this.activeIndex(), packTail(this.activeTermId(), offset));
    }

    public position(offset: number): number {
        return computePosition(this.activeTermId(), offset, BITS, this.initial);
    }
}

function expectPadding(term: UnsafeBuffer, offset: number, length: number, expectedTermId: number): void {
    expect(FrameDescriptor.frameLength(term, offset)).toBe(length);
    expect(FrameDescriptor.frameType(term, offset)).toBe(FrameDescriptor.PADDING_FRAME_TYPE);
    expect(FrameDescriptor.frameTermId(term, offset)).toBe(expectedTermId);
    expect(term.getInt(offset + FrameDescriptor.TERM_OFFSET)).toBe(offset);
    expect(FrameDescriptor.frameSessionId(term, offset)).toBe(SESSION_ID);
}

describe('Unblock extra: LogBufferUnblocker', () => {
    const rows: Array<[number, number, Where, Hole]> = [];
    for (const initial of [1, INT32_MAX, INT32_MIN]) {
        for (const count of [0, 1, 2, 3]) {
            for (const where of ['start', 'middle', 'last'] as const) {
                for (const hole of [
                    'uncommitted',
                    'zeros, tail not past the hole',
                    'zeros, committed frame after the hole',
                ] as const) {
                    rows.push([initial, count, where, hole]);
                }
            }
        }
    }

    it.each(rows)('initial term id %i, term count %i, blocked at the %s, %s', (initial, count, where, hole) => {
        const log = new Log(initial, count);
        const term = log.terms[log.activeIndex()] as UnsafeBuffer;
        const blockedOffset = OFFSETS[where];
        const blockedPosition = log.position(blockedOffset);
        const rotated = (log.initial + count + 1) | 0;

        let expected: boolean;
        let length = MESSAGE;
        let toEnd = false;
        switch (hole) {
            case 'uncommitted':
                // a claimed frame whose length is the negated claim: always patched, the tail is past it
                term.putInt(blockedOffset, -MESSAGE);
                log.setTail(Math.min(blockedOffset + MESSAGE, TERM_LENGTH));
                expected = true;
                break;
            case 'zeros, tail not past the hole':
                // the claim has bumped the tail, but the header has not been written and nothing follows
                log.setTail(Math.min(blockedOffset + MESSAGE, TERM_LENGTH));
                toEnd = 'last' === where;
                length = TERM_LENGTH - blockedOffset;
                expected = toEnd;
                break;
            default:
                log.setTail(Math.min(blockedOffset + 2 * MESSAGE, TERM_LENGTH + MESSAGE));
                if ('last' === where) {
                    // nothing can follow the last frame: the hole runs to the end of the term
                    toEnd = true;
                    length = TERM_LENGTH - blockedOffset;
                } else {
                    term.putInt(blockedOffset + MESSAGE, MESSAGE);
                }
                expected = true;
        }

        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(expected);

        if (expected) {
            expectPadding(term, blockedOffset, length, log.activeTermId());
        } else {
            expect(term.getInt(blockedOffset)).toBe(0);
        }

        if (expected && toEnd) {
            // unblocked to the end of the term: the log has rotated
            expect(activeTermCount(log.meta)).toBe(count + 1);
            const tail = rawTailVolatile(log.meta);
            expect(termId(tail)).toBe(rotated);
            expect(termOffset(tail, TERM_LENGTH)).toBe(0);
        } else {
            expect(activeTermCount(log.meta)).toBe(count);
        }
    });

    it.each([1, INT32_MAX, INT32_MIN])(
        'across a term boundary: the position at the start of the next term rotates the log once (initial term id %i)',
        (initial) => {
            for (const count of [0, 1, 2, 3]) {
                const log = new Log(initial, count);
                // the last frame of the term is complete and the tail has moved to the end of it
                log.setTail(TERM_LENGTH);
                const blockedPosition = log.position(0) + TERM_LENGTH;

                // before the rotation: the unblock does it
                expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(true);
                expect(activeTermCount(log.meta)).toBe(count + 1);
                expect(termId(rawTailVolatile(log.meta))).toBe((initial + count + 1) | 0);

                // after: the log is rotated, the next term is empty and the same position has nothing to unblock
                expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(false);
                expect(activeTermCount(log.meta)).toBe(count + 1);
            }
        },
    );

    it('before and after the tail moves: a hole with nothing behind it is left, and patched once a frame follows', () => {
        const log = new Log(INT32_MAX, 1);
        const term = log.terms[log.activeIndex()] as UnsafeBuffer;
        const blockedOffset = 1024;
        const blockedPosition = log.position(blockedOffset);

        // the claim of the blocked frame has moved the tail past the hole, nothing follows
        log.setTail(blockedOffset + MESSAGE);
        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(false);
        expect(term.getInt(blockedOffset)).toBe(0);

        // another publisher claims after it and commits
        log.setTail(blockedOffset + 2 * MESSAGE);
        term.putInt(blockedOffset + MESSAGE, MESSAGE);
        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(true);
        expectPadding(term, blockedOffset, MESSAGE, log.activeTermId());

        // the padding is a complete frame now: unblocking again takes no action
        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(false);
        expect(FrameDescriptor.frameLength(term, blockedOffset)).toBe(MESSAGE);
    });
});

describe('Unblock extra: LogBufferUnblocker with a large term count', () => {
    // 64 KiB terms: count 32768 puts the position at 2^31, 40000 above it, 65536 at 2^32 and 2^31 - 2 at about 2^47,
    // where the position is not an int and the term count is Java's `(int)(position >> bits)`
    const counts = [32768, 40000, 65536, INT32_MAX - 1];
    const rows: Array<[number, number]> = [];
    for (const initial of [1, INT32_MAX]) {
        for (const count of counts) {
            rows.push([initial, count]);
        }
    }

    it.each(rows)('initial term id %i, term count %i: patches an uncommitted frame', (initial, count) => {
        const log = new Log(initial, count);
        const term = log.terms[log.activeIndex()] as UnsafeBuffer;
        const blockedOffset = 4096;
        const blockedPosition = log.position(blockedOffset);
        expect(blockedPosition).toBeGreaterThanOrEqual(2 ** 31);

        term.putInt(blockedOffset, -MESSAGE);
        log.setTail(blockedOffset + MESSAGE);

        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(true);
        expectPadding(term, blockedOffset, MESSAGE, log.activeTermId());
        expect(activeTermCount(log.meta)).toBe(count);
    });

    it.each(rows)('initial term id %i, term count %i: rotates at the term boundary once', (initial, count) => {
        const log = new Log(initial, count);
        log.setTail(TERM_LENGTH);
        const blockedPosition = log.position(0) + TERM_LENGTH;
        expect(blockedPosition).toBeGreaterThanOrEqual(2 ** 31);

        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(true);
        expect(activeTermCount(log.meta)).toBe(count + 1);
        expect(termId(rawTailVolatile(log.meta))).toBe((initial + count + 1) | 0);

        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(false);
        expect(activeTermCount(log.meta)).toBe(count + 1);
    });
});

describe('Unblock extra: LogBufferUnblocker one term behind', () => {
    it('the active count is the blocked count - 1 but the blocked offset is not 0: no rotation', () => {
        // position = computePosition(8, 64, 16, 7) is term count 1, offset 64, with the active count at 0
        const log = new Log(7, 0);
        const blockedPosition = computePosition(8, 64, BITS, 7);
        expect(blockedPosition).toBe(TERM_LENGTH + 64);
        const tailBefore = rawTailVolatile(log.meta, 1);

        expect(LogBufferUnblocker.unblock(log.terms, log.meta, blockedPosition, TERM_LENGTH)).toBe(false);
        expect(activeTermCount(log.meta)).toBe(0);
        expect(rawTailVolatile(log.meta, 1)).toBe(tailBefore);
        expect(rawTailVolatile(log.meta, 0)).toBe(packTail(7, 0));
    });
});

describe('Unblock extra: TermUnblocker', () => {
    const TERM_ID = INT32_MIN;

    function setup(): { term: UnsafeBuffer; meta: UnsafeBuffer } {
        const meta = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
        storeDefaultFrameHeader(meta, DataHeaderFlyweight.createDefaultHeader(SESSION_ID, STREAM_ID, TERM_ID));
        return { term: new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH)), meta };
    }

    it.each(['start', 'middle', 'last'] as const)('status of every state of the blocked frame at the %s', (where) => {
        const blockedOffset = OFFSETS[where];

        // complete frame: no action, whatever the tail
        {
            const { term, meta } = setup();
            term.putInt(blockedOffset, MESSAGE);
            for (const tail of [blockedOffset, blockedOffset + MESSAGE, TERM_LENGTH]) {
                expect(TermUnblocker.unblock(meta, term, blockedOffset, tail, TERM_ID)).toBe(NO_ACTION);
            }
        }

        // uncommitted frame: unblocked, whatever the tail, with the claimed length
        {
            const { term, meta } = setup();
            term.putInt(blockedOffset, -MESSAGE);
            expect(TermUnblocker.unblock(meta, term, blockedOffset, blockedOffset + MESSAGE, TERM_ID)).toBe(UNBLOCKED);
            expectPadding(term, blockedOffset, MESSAGE, TERM_ID);
        }

        // zeros, nothing behind them before the tail: no action, except that a hole that runs to the end of the term
        // is unblocked to the end
        {
            const { term, meta } = setup();
            const status = TermUnblocker.unblock(meta, term, blockedOffset, blockedOffset + MESSAGE, TERM_ID);
            if ('last' === where) {
                expect(status).toBe(UNBLOCKED_TO_END);
                expectPadding(term, blockedOffset, MESSAGE, TERM_ID);
            } else {
                expect(status).toBe(NO_ACTION);
                expect(term.getInt(blockedOffset)).toBe(0);
            }
        }

        // zeros, then a frame (complete or uncommitted) before the tail: unblocked up to that frame
        if ('last' !== where) {
            for (const next of [MESSAGE, -MESSAGE]) {
                const { term, meta } = setup();
                term.putInt(blockedOffset + 3 * FrameDescriptor.FRAME_ALIGNMENT, next);
                expect(TermUnblocker.unblock(meta, term, blockedOffset, blockedOffset + 2 * MESSAGE, TERM_ID)).toBe(
                    UNBLOCKED,
                );
                expectPadding(term, blockedOffset, 3 * FrameDescriptor.FRAME_ALIGNMENT, TERM_ID);
            }
        }
    });

    it('a frame behind the tail is not looked at', () => {
        const { term, meta } = setup();
        term.putInt(1024 + 4 * 32, MESSAGE);
        // the tail is at 1024 + 128: the frame at 1024 + 128 is at the tail, not before it
        expect(TermUnblocker.unblock(meta, term, 1024, 1024 + 128, TERM_ID)).toBe(NO_ACTION);
        expect(term.getInt(1024)).toBe(0);
    });

    it('Status has the ordinals, names and values of the Java enum', () => {
        expect(TermUnblocker.Status.values().map((s) => [s.name(), s.ordinal(), String(s)])).toEqual([
            ['NO_ACTION', 0, 'NO_ACTION'],
            ['UNBLOCKED', 1, 'UNBLOCKED'],
            ['UNBLOCKED_TO_END', 2, 'UNBLOCKED_TO_END'],
        ]);
    });
});
