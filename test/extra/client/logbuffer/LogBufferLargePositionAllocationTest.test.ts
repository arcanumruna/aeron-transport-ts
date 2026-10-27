// Not in Aeron: the log buffer descriptor, the header and the term readers allocate nothing per call at a position of
// about 2^40 (a term id of 2^24 for the 64 KiB terms), where the position is outside V8's 31-bit small integers and a
// call that is not inlined would box it in a heap number (spec 5.3, issue #19). Over an ArrayBuffer and a
// SharedArrayBuffer log in the same process, each from position 0 as well, so that the large case is not the only
// one the JIT has seen. `TermReader.read` with a `currentPosition` takes the position as an argument, which a call
// that is not inlined would box.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Position } from '../../../../src/agrona/concurrent/status/Position.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../../src/client/logbuffer/Header.js';
import { HeaderWriter } from '../../../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermGapFiller } from '../../../../src/client/logbuffer/TermGapFiller.js';
import { TermGapScanner } from '../../../../src/client/logbuffer/TermGapScanner.js';
import type { GapHandler } from '../../../../src/client/logbuffer/TermGapScanner.js';
import { TermReader } from '../../../../src/client/logbuffer/TermReader.js';
import { TermRebuilder } from '../../../../src/client/logbuffer/TermRebuilder.js';
import { TermScanner } from '../../../../src/client/logbuffer/TermScanner.js';
import { TermUnblocker } from '../../../../src/client/logbuffer/TermUnblocker.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { ARRAY_BACKING, SHARED_BACKING, type Backing } from '../../../support/Backing.js';

const { HEADER_LENGTH } = DataHeaderFlyweight;
const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);
/** The term id (initial term id 0) whose begin position is 2^40. */
const LARGE_TERM_ID = 2 ** 40 / TERM_LENGTH;
const ITERATIONS = 500_000;

const sum = new Float64Array(1);

/** A position that keeps the last value in a typed array, so that storing a long does not allocate. */
class CountingPosition extends Position {
    public readonly last = new Float64Array(1);
    public id(): number {
        return 0;
    }
    public get(): number {
        return this.last[0] as number;
    }
    public getVolatile(): number {
        return this.last[0] as number;
    }
    public getAcquire(): number {
        return this.last[0] as number;
    }
    public getOpaque(): number {
        return this.last[0] as number;
    }
    public isClosed(): boolean {
        return false;
    }
    public close(): void {}
    public setVolatile(value: number): void {
        this.last[0] = value;
    }
    public setOrdered(value: number): void {
        this.last[0] = value;
    }
    public setRelease(value: number): void {
        this.last[0] = value;
    }
    public setOpaque(value: number): void {
        this.last[0] = value;
    }
    public set(value: number): void {
        this.last[0] = value;
    }
    public proposeMax(): boolean {
        return false;
    }
    public proposeMaxOrdered(): boolean {
        return false;
    }
    public proposeMaxRelease(): boolean {
        return false;
    }
    public proposeMaxOpaque(): boolean {
        return false;
    }
}

/** Frames of 0, 1, 100 and 1376 bytes of payload, then padding to the end of the term, all of term id `termId`. */
function filledTerm(backing: Backing, termId: number): UnsafeBuffer {
    const term = new UnsafeBuffer(backing.arrayBuffer(TERM_LENGTH));
    let offset = 0;
    for (const payload of [0, 1, 100, 1376]) {
        term.putInt(offset, HEADER_LENGTH + payload);
        FrameDescriptor.frameType(term, offset, HeaderFlyweight.HDR_TYPE_DATA);
        term.putInt(offset + DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, termId);
        term.putInt(offset + DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET, offset);
        offset += Math.ceil((HEADER_LENGTH + payload) / 32) * 32;
    }
    term.putInt(offset, TERM_LENGTH - offset);
    FrameDescriptor.frameType(term, offset, FrameDescriptor.PADDING_FRAME_TYPE);
    return term;
}

const handler = {
    onFragment: (_buffer: UnsafeBuffer, offset: number, length: number): void => {
        sum[0] = (sum[0]! + offset + length) | 0;
    },
};
const errorHandler = {
    onError: (): void => {
        sum[0] = -1;
    },
};

/** Runs the cases below over both backings and both positions once, so that the type feedback has seen all of them. */
function exerciseEverything(): void {
    for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
        for (const termId of [0, LARGE_TERM_ID]) {
            const term = filledTerm(backing, termId);
            const header = new Header(0, SHIFT);
            const position = new CountingPosition();
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            for (let i = 0; i < 2_000; i++) {
                sum[0] =
                    sum[0]! +
                    TermReader.read(term, 0, handler, 10, header, errorHandler, termId * TERM_LENGTH, position);
                sum[0] = sum[0]! + TermReader.read(term, 0, handler, 10, header, errorHandler);
                header.buffer(term).offset(0);
                sum[0] = sum[0]! + header.position();
                LogBufferDescriptor.endOfStreamPosition(meta, termId * TERM_LENGTH + i);
                sum[0] = sum[0]! + LogBufferDescriptor.endOfStreamPosition(meta);
            }
        }
    }
}

describe.each([
    [ARRAY_BACKING, ''],
    [SHARED_BACKING, 'Shared'],
] as const)('LogBufferLargePositionAllocation %s', (backing, suffix) => {
    describe.each([
        ['', 0],
        ['LargePosition', LARGE_TERM_ID],
    ] as const)('%s', (where, termId) => {
        const title = (name: string): string => name + where + suffix;
        const begin = termId * TERM_LENGTH;

        it(title('positionsOfTheDescriptor'), async () => {
            exerciseEverything();
            await expectNoAllocation((n) => {
                let acc = 0;
                for (let i = 0; i < n; i++) {
                    const position = LogBufferDescriptor.computePosition(termId + (i & 3), i & 0xfff, SHIFT, 0);
                    acc += position;
                    acc += LogBufferDescriptor.computeTermBeginPosition(termId + (i & 3), SHIFT, 0);
                    acc += LogBufferDescriptor.computeTermIdFromPosition(position, SHIFT, 0);
                    acc += LogBufferDescriptor.indexByPosition(position, SHIFT);
                }
                sum[0] = acc;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        // the getter (the image reads it on every poll) and the setter (the driver writes it once) are separate loops: the
        // optional `value` of the Java overloads makes one function of both, and a loop that calls both asks V8 to
        // inline the two bodies of a `long` operation into one function twice over (issue #19, spec 6)
        it(title('endOfStreamPositionGet'), async () => {
            exerciseEverything();
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            LogBufferDescriptor.endOfStreamPosition(meta, begin + 4096);
            await expectNoAllocation((n) => {
                let acc = 0;
                for (let i = 0; i < n; i++) {
                    acc += LogBufferDescriptor.endOfStreamPosition(meta);
                }
                sum[0] = acc;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('endOfStreamPositionSet'), async () => {
            exerciseEverything();
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    LogBufferDescriptor.endOfStreamPosition(meta, begin + (i & 0xffff));
                }
                sum[0] = begin;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('rawTailAndActiveTermCount'), async () => {
            exerciseEverything();
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            LogBufferDescriptor.initialiseTailWithTermId(meta, 0, termId);
            await expectNoAllocation((n) => {
                let acc = 0;
                for (let i = 0; i < n; i++) {
                    acc +=
                        LogBufferDescriptor.rawTailTermId(meta, 0) +
                        LogBufferDescriptor.rawTailTermOffset(meta, 0, TERM_LENGTH);
                    LogBufferDescriptor.activeTermCountOrdered(meta, termId + (i & 3));
                    acc += LogBufferDescriptor.activeTermCount(meta);
                }
                sum[0] = acc;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('headerPosition'), async () => {
            exerciseEverything();
            const term = filledTerm(backing, termId);
            const header = new Header(0, SHIFT).buffer(term);
            await expectNoAllocation((n) => {
                let acc = 0;
                for (let i = 0; i < n; i++) {
                    header.offset(0);
                    acc += header.position() + header.termId();
                }
                sum[0] = acc;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('headerWriter'), async () => {
            exerciseEverything();
            const term = filledTerm(backing, termId);
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            LogBufferDescriptor.storeDefaultFrameHeader(meta, DataHeaderFlyweight.createDefaultHeader(1, 2, 3));
            const writer = new HeaderWriter(LogBufferDescriptor.defaultFrameHeader(meta));
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    writer.write(term, 4096 + (i & 15) * 64, 64, termId);
                }
                sum[0] = termId;
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('termReadWithAPosition'), async () => {
            exerciseEverything();
            const term = filledTerm(backing, termId);
            const header = new Header(0, SHIFT);
            const position = new CountingPosition();
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + TermReader.read(term, 0, handler, 10, header, errorHandler, begin, position);
                    sum[0] = sum[0]! + TermReader.read(term, 0, handler, 2, header, errorHandler, begin, position);
                }
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('termReadPackedAndScanners'), async () => {
            exerciseEverything();
            const term = filledTerm(backing, termId);
            const header = new Header(0, SHIFT);
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    const outcome = TermReader.read(term, 0, handler, 10, header, errorHandler);
                    sum[0] = sum[0]! + TermReader.fragmentsRead(outcome) + TermReader.offset(outcome);
                    const scan = TermScanner.scanForAvailability(term, 0, 1408 + (i & 1) * 4096);
                    sum[0] = sum[0]! + TermScanner.available(scan) + TermScanner.padding(scan);
                }
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });

        it(title('termRebuilderGapScannerFillerAndUnblocker'), async () => {
            exerciseEverything();
            const term = new UnsafeBuffer(backing.arrayBuffer(TERM_LENGTH));
            const packet = new UnsafeBuffer(backing.arrayBuffer(1408));
            packet.putInt(0, 1408);
            packet.putInt(DataHeaderFlyweight.TERM_ID_FIELD_OFFSET, termId);
            const meta = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            LogBufferDescriptor.storeDefaultFrameHeader(meta, DataHeaderFlyweight.createDefaultHeader(1, 2, 3));
            const gaps: GapHandler = {
                onGap: (_termId, offset, length) => {
                    sum[0] = (sum[0]! + offset + length) | 0;
                },
            };
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    const offset = (i & 15) * 1408;
                    TermRebuilder.insert(term, offset, packet, 1408);
                    sum[0] = sum[0]! + TermGapScanner.scanForGap(term, termId, 0, 8192, gaps);
                    sum[0] = sum[0]! + (TermGapFiller.tryFillGap(meta, term, termId, 16384 + offset, 128) ? 1 : 0);
                    sum[0] =
                        sum[0]! +
                        TermUnblocker.unblock(meta, term, 16384 + offset, 16384 + offset + 256, termId).ordinal();
                    if (15 === (i & 15)) {
                        term.setMemory(0, TERM_LENGTH, 0);
                    }
                }
            }, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });
    });
});
