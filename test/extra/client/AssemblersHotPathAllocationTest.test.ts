// Not in Aeron: the four fragment assemblers sit on the image `poll` path, so once a builder has grown to the size of
// the message they allocate nothing per message (spec 5.3), neither for an unfragmented message (passed through) nor
// for a fragmented one (BEGIN, MIDDLE, END copied into the builder, the complete header filled in and the builder reset).
// Each loop is one assembler, so that the calls fit the inlining budget of the optimizing compiler, and the values stay
// below 2^30 so that no int is boxed.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import { ControlledFragmentAssembler } from '../../../src/client/ControlledFragmentAssembler.js';
import { FragmentAssembler } from '../../../src/client/FragmentAssembler.js';
import { ImageControlledFragmentAssembler } from '../../../src/client/ImageControlledFragmentAssembler.js';
import { ImageFragmentAssembler } from '../../../src/client/ImageFragmentAssembler.js';
import { Action } from '../../../src/client/logbuffer/ControlledFragmentHandler.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../src/client/logbuffer/Header.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const { BEGIN_FRAG_FLAG, END_FRAG_FLAG, UNFRAGMENTED } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;

const ITERATIONS = 1_000_000;
const PAYLOAD = 1376; // an MTU of 1408 less the header
const FRAME_LENGTH = HEADER_LENGTH + PAYLOAD;
const sum = new Int32Array(1);

/** A handler that only reads what it is given; `onAssembled` runs for each delivery of 3 * PAYLOAD bytes. */
class SumHandler {
    private readonly onAssembled: () => void;
    public constructor(onAssembled: () => void = () => {}) {
        this.onAssembled = onAssembled;
    }

    public onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): void {
        sum[0] = (sum[0]! + length + offset + header.sessionId()) | 0;
        if (3 * PAYLOAD === length) {
            this.onAssembled();
        }
    }
}

class SumControlledHandler {
    private readonly onAssembled: () => void;
    public constructor(onAssembled: () => void = () => {}) {
        this.onAssembled = onAssembled;
    }

    public onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): Action {
        sum[0] = (sum[0]! + length + offset + header.sessionId()) | 0;
        if (3 * PAYLOAD === length) {
            this.onAssembled();
        }
        return Action.CONTINUE;
    }
}

type Assembler = { onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): unknown };

function fixture(): { flyweight: DataHeaderFlyweight; header: Header; src: UnsafeBuffer } {
    const flyweight = new DataHeaderFlyweight();
    const buffer = new UnsafeBuffer(new Uint8Array(64));
    flyweight.wrap(buffer, 16, HEADER_LENGTH);
    const header = new Header(3, 16);
    header.buffer(buffer);
    header.offset(flyweight.wrapAdjustment());
    flyweight.sessionId(777);
    return { flyweight, header, src: new UnsafeBuffer(new Uint8Array(4 * 1408)) };
}

type Make = (onAssembled?: () => void) => Assembler;

const sessionAssemblers: [string, Make][] = [
    ['FragmentAssembler', (f) => new FragmentAssembler(new SumHandler(f))],
    ['ControlledFragmentAssembler', (f) => new ControlledFragmentAssembler(new SumControlledHandler(f))],
];

const assemblers: [string, Make][] = [
    ...sessionAssemblers,
    ['ImageFragmentAssembler', (f) => new ImageFragmentAssembler(new SumHandler(f))],
    ['ImageControlledFragmentAssembler', (f) => new ImageControlledFragmentAssembler(new SumControlledHandler(f))],
];

describe('AssemblersHotPathAllocationTest', () => {
    it.each(assemblers)('%s unfragmentedMessageAllocatesNothing', async (_name, make) => {
        const assembler = make();
        const { flyweight, header, src } = fixture();
        flyweight.termOffset(0);
        flyweight.frameLength(FRAME_LENGTH).flags(UNFRAGMENTED);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
            }
        }, ITERATIONS);
    });

    it.each(assemblers)('%s fragmentedMessageAllocatesNothingOnceTheBuilderHasGrown', async (_name, make) => {
        let assembled = 0;
        const assembler = make(() => {
            assembled++;
        });
        const { flyweight, header, src } = fixture();
        let fed = 0;

        // BEGIN, MIDDLE, END of 3 * PAYLOAD bytes; the first pass grows the builder, the warm up of the check runs more
        const feed = (n: number): void => {
            for (let i = 0; i < n; i++) {
                flyweight.frameLength(FRAME_LENGTH);
                flyweight.termOffset(0).flags(BEGIN_FRAG_FLAG);
                assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                flyweight.termOffset(FRAME_LENGTH).flags(0);
                assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                flyweight.termOffset(2 * FRAME_LENGTH).flags(END_FRAG_FLAG);
                assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                fed++;
            }
        };
        feed(4);

        await expectNoAllocation(feed, ITERATIONS / 4);

        // not vacuous: every message that was fed was assembled, in full
        expect(assembled).toBe(fed);
    });

    it.each(sessionAssemblers)('%s interleavedSessionsAllocateNothingOnceTheBuildersHaveGrown', async (_name, make) => {
        let assembled = 0;
        const assembler = make(() => {
            assembled++;
        });
        const sessions = [11, 22, 33];
        const { flyweight, header, src } = fixture();
        let fed = 0;

        // the three sessions are interleaved fragment by fragment, so the map is read with three different keys
        const feed = (n: number): void => {
            for (let i = 0; i < n; i++) {
                flyweight.frameLength(FRAME_LENGTH);
                flyweight.termOffset(0).flags(BEGIN_FRAG_FLAG);
                for (const sessionId of sessions) {
                    flyweight.sessionId(sessionId);
                    assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                }
                flyweight.termOffset(FRAME_LENGTH).flags(0);
                for (const sessionId of sessions) {
                    flyweight.sessionId(sessionId);
                    assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                }
                flyweight.termOffset(2 * FRAME_LENGTH).flags(END_FRAG_FLAG);
                for (const sessionId of sessions) {
                    flyweight.sessionId(sessionId);
                    assembler.onFragment(src, HEADER_LENGTH, PAYLOAD, header);
                }
                fed += sessions.length;
            }
        };
        feed(4);

        await expectNoAllocation(feed, ITERATIONS / 12);

        expect(assembled).toBe(fed);
    });
});
