// Not in Aeron: the per-message paths of the term readers allocate nothing (spec 5.3, plan "Review focus"):
// `TermReader.read` (with a position and the packed form), `TermScanner.scanForAvailability`,
// `TermBlockScanner.scan`, `TermRebuilder.insert`, `TermGapScanner.scanForGap` and `TermGapFiller.tryFillGap`.
// The packed outcomes (spec D13) are numbers above 2^31, which V8 boxes in a heap number when a call is not inlined,
// so the loops that return one are allowed that one heap number per iteration; the others none.
import { describe, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Position } from '../../../../src/agrona/concurrent/status/Position.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermBlockScanner } from '../../../../src/client/logbuffer/TermBlockScanner.js';
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

const { frameType } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { HDR_TYPE_DATA } = HeaderFlyweight;

const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const ITERATIONS = 500_000;
const sum = new Int32Array(1);

/** A position that keeps the last value in a typed array, so that storing a long does not allocate. */
class CountingPosition extends Position {
    public readonly last = new Float64Array(1);
    public releases = 0;
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
        this.releases++;
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

/** Frames of 0, 1, 100 and 1376 bytes of payload, then padding to the end of the term. */
function filledTerm(): UnsafeBuffer {
    const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
    let offset = 0;
    for (const payload of [0, 1, 100, 1376]) {
        term.putInt(offset, HEADER_LENGTH + payload);
        frameType(term, offset, HDR_TYPE_DATA);
        offset += Math.ceil((HEADER_LENGTH + payload) / 32) * 32;
    }
    term.putInt(offset, TERM_LENGTH - offset);
    frameType(term, offset, FrameDescriptor.PADDING_FRAME_TYPE);
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

describe('TermReadersHotPathAllocationTest', () => {
    it('TermReader.read with a position allocates nothing', async () => {
        const term = filledTerm();
        const header = new Header(0, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));
        const position = new CountingPosition();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sum[0] = (sum[0]! + TermReader.read(term, 0, handler, 10, header, errorHandler, 0, position)) | 0;
                sum[0] = (sum[0]! + TermReader.read(term, 0, handler, 2, header, errorHandler, 0, position)) | 0;
            }
        }, ITERATIONS);
    });

    it('TermReader.read in the packed form and its accessors allocate at most the packed number', async () => {
        const term = filledTerm();
        const header = new Header(0, LogBufferDescriptor.positionBitsToShift(TERM_LENGTH));

        await expectNoAllocation(
            (n) => {
                for (let i = 0; i < n; i++) {
                    const outcome = TermReader.read(term, 0, handler, 10, header, errorHandler);
                    sum[0] = (sum[0]! + TermReader.fragmentsRead(outcome) + TermReader.offset(outcome)) | 0;
                }
            },
            ITERATIONS,
            1,
        );
    });

    it('TermScanner.scanForAvailability and its accessors allocate at most the packed number', async () => {
        const term = filledTerm();

        await expectNoAllocation(
            (n) => {
                for (let i = 0; i < n; i++) {
                    const outcome = TermScanner.scanForAvailability(term, 0, 1408 + (i & 1) * 4096);
                    sum[0] = (sum[0]! + TermScanner.available(outcome) + TermScanner.padding(outcome)) | 0;
                }
            },
            ITERATIONS,
            1,
        );
    });

    it('TermBlockScanner.scan allocates nothing', async () => {
        const term = filledTerm();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sum[0] =
                    (sum[0]! + TermBlockScanner.scan(term, 0, TERM_LENGTH) + TermBlockScanner.scan(term, 32, 4096)) | 0;
            }
        }, ITERATIONS);
    });

    it('TermRebuilder.insert allocates nothing', async () => {
        const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        const packet = new UnsafeBuffer(new ArrayBuffer(1408));
        packet.putInt(0, 1408);
        for (let i = 4; i < 1408; i++) {
            packet.putByte(i, i & 0x7f);
        }

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const termOffset = (i & 31) * 1408;
                // a frame goes in once; the next round finds it there, which is the duplicate path
                TermRebuilder.insert(term, termOffset, packet, 1408);
                if (31 === (i & 31)) {
                    term.setMemory(0, 32 * 1408, 0);
                }
            }
        }, ITERATIONS);
    });

    it('TermGapScanner.scanForGap allocates nothing', async () => {
        const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        for (let offset = 0; offset < 4096; offset += 64) {
            if (offset !== 1024) {
                term.putInt(offset, 64);
            }
        }
        const handlerOfGaps: GapHandler = {
            onGap: (_termId, offset, length) => {
                sum[0] = (sum[0]! + offset + length) | 0;
            },
        };

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sum[0] = (sum[0]! + TermGapScanner.scanForGap(term, 3, 0, 4096, handlerOfGaps)) | 0;
            }
        }, ITERATIONS);
    });

    it('TermGapFiller.tryFillGap and TermUnblocker.unblock allocate nothing', async () => {
        const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        const meta = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        LogBufferDescriptor.storeDefaultFrameHeader(meta, DataHeaderFlyweight.createDefaultHeader(1, 2, 3));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const offset = (i & 15) * 256;
                sum[0] = (sum[0]! + (TermGapFiller.tryFillGap(meta, term, 3, offset, 128) ? 1 : 0)) | 0;
                // the padding that was written is a complete frame: nothing to unblock; clear it for the next round
                sum[0] = (sum[0]! + TermUnblocker.unblock(meta, term, offset, offset + 256, 3).ordinal()) | 0;
                term.putInt(offset, 0);
            }
        }, ITERATIONS);
    });
});
