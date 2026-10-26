// Not in Aeron: the interaction matrix of the assemblers (plan, "Interaction matrix", row "Assemblers (T11)") and of
// `BufferBuilder`. Every one of the four assemblers runs the same table: unfragmented, BEGIN, MIDDLE x n, END and every
// flag combination, END without BEGIN, BEGIN twice, a missing or out of order fragment, a message larger than the
// initial capacity, the actions of the controlled ones, per-session builders and two images side by side, and a seeded
// random model of loss. `BufferBuilder` gets its reset, its limit and its growth at the maximum.
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import { ArithmeticException, IllegalArgumentException, IllegalStateException } from '../../../src/agrona/jdk.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { BufferBuilder } from '../../../src/client/BufferBuilder.js';
import { ControlledFragmentAssembler } from '../../../src/client/ControlledFragmentAssembler.js';
import { FragmentAssembler } from '../../../src/client/FragmentAssembler.js';
import { ImageControlledFragmentAssembler } from '../../../src/client/ImageControlledFragmentAssembler.js';
import { ImageFragmentAssembler } from '../../../src/client/ImageFragmentAssembler.js';
import { Action } from '../../../src/client/logbuffer/ControlledFragmentHandler.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { assertThrowsExactly } from '../../support/Assertions.js';
import { mulberry32 } from '../../support/Random.js';

const { BEGIN_FRAG_FLAG, END_FRAG_FLAG, FRAME_ALIGNMENT, UNFRAGMENTED } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { INIT_MIN_CAPACITY, MAX_CAPACITY } = BufferBuilder;

const INITIAL_TERM_ID = 3;
const POSITION_BITS_TO_SHIFT = 16;
const MIDDLE = 0;

const byte = (value: number): number => (value << 24) >> 24;

/** A call of the delegate; the header is live (the builder resets it), so its values are read at the time of the call. */
type Call = {
    buffer: DirectBuffer;
    offset: number;
    length: number;
    header: Header;
    bytes: number[];
    flags: number;
    sessionId: number;
    frameLength: number;
    fragmentedFrameLength: number;
    position: number;
    context: unknown;
};

/** A frame source for one session: the term offsets advance by the aligned frame length, as in a term. */
class Stream {
    public termOffset = 0;
    public readonly flyweight = new DataHeaderFlyweight();
    public readonly header = new Header(INITIAL_TERM_ID, POSITION_BITS_TO_SHIFT);

    public readonly sessionId: number;
    private readonly assembler: { onFragment(b: DirectBuffer, o: number, l: number, h: Header): unknown };
    public readonly termId;
    public constructor(
        sessionId: number,
        assembler: { onFragment(b: DirectBuffer, o: number, l: number, h: Header): unknown },
        termId = INITIAL_TERM_ID,
    ) {
        this.sessionId = sessionId;
        this.assembler = assembler;
        this.termId = termId;
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        this.flyweight.wrap(buffer, 16, HEADER_LENGTH);
        this.header.buffer(buffer);
        this.header.offset(16);
    }

    /** Deliver a fragment at the current term offset, then advance it (the fragment of a frame that is lost: `skip`). */
    public send(flags: number, payload: number[], extraFlags = 0, skip = false): unknown {
        const frameLength = HEADER_LENGTH + payload.length;
        const termOffset = this.termOffset;
        this.termOffset = BitUtil.align(termOffset + frameLength, FRAME_ALIGNMENT);
        if (skip) {
            return undefined;
        }

        this.flyweight.sessionId(this.sessionId).termOffset(termOffset).termId(this.termId);
        this.flyweight.frameLength(frameLength).flags(flags | extraFlags);
        const src = new UnsafeBuffer(new Uint8Array(payload.length + 64));
        src.putBytes(40, Uint8Array.from(payload));
        return this.assembler.onFragment(src, 40, payload.length, this.header);
    }
}

function payload(seed: number, length: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < length; i++) {
        out.push((seed * 31 + i * 7) & 0xff);
    }
    return out;
}

interface Kind {
    readonly name: string;
    readonly sessions: boolean;
    readonly controlled: boolean;
    construct(handler: unknown, initialLength?: number, isDirect?: boolean): AssemblerUnderTest;
}

interface AssemblerUnderTest {
    onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): unknown;
    delegate(): unknown;
    bufferBuilder?(): BufferBuilder;
    freeSessionBuffer?(sessionId: number): boolean;
    clear?(): void;
    isDirectByteBuffer?(): boolean;
}

function record(delegate: (call: Call) => Action | void): {
    onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): Action;
} {
    return {
        onFragment: (buffer, offset, length, header) => {
            const bytes: number[] = [];
            for (let i = 0; i < length; i++) {
                bytes.push(buffer.getByte(offset + i) & 0xff);
            }
            return (
                delegate({
                    buffer,
                    offset,
                    length,
                    header,
                    bytes,
                    flags: header.flags(),
                    sessionId: header.sessionId(),
                    frameLength: header.frameLength(),
                    fragmentedFrameLength: header.fragmentedFrameLength(),
                    position: header.position(),
                    context: header.context(),
                }) ?? Action.CONTINUE
            );
        },
    };
}

/** What the matrix runs: a kind with `make`, which wraps the delegate in a recording handler. */
type MatrixKind = Kind & {
    make(delegate: (call: Call) => Action | void, initialLength?: number, isDirect?: boolean): AssemblerUnderTest;
};

const baseKinds: Kind[] = [
    {
        name: 'FragmentAssembler',
        sessions: true,
        controlled: false,
        construct: (handler, initialLength = 0, isDirect = false) =>
            new FragmentAssembler(handler as never, initialLength, isDirect),
    },
    {
        name: 'ControlledFragmentAssembler',
        sessions: true,
        controlled: true,
        construct: (handler, initialLength = 0, isDirect = false) =>
            new ControlledFragmentAssembler(handler as never, initialLength, isDirect),
    },
    {
        name: 'ImageFragmentAssembler',
        sessions: false,
        controlled: false,
        construct: (handler, initialLength = 0, isDirect = false) =>
            new ImageFragmentAssembler(handler as never, initialLength, isDirect),
    },
    {
        name: 'ImageControlledFragmentAssembler',
        sessions: false,
        controlled: true,
        construct: (handler, initialLength = 0, isDirect = false) =>
            new ImageControlledFragmentAssembler(handler as never, initialLength, isDirect),
    },
];

const kinds: MatrixKind[] = baseKinds.map((k) => ({
    ...k,
    make: (delegate: (call: Call) => Action | void, initialLength = 0, isDirect = false) =>
        k.construct(record(delegate), initialLength, isDirect),
}));

describe.each(kinds)('$name matrix', (kind) => {
    function setUp(initialLength = 0, isDirect = false) {
        const calls: Call[] = [];
        const assembler = kind.make(
            (call) => {
                calls.push(call);
            },
            initialLength,
            isDirect,
        );
        return { calls, assembler, stream: new Stream(777, assembler) };
    }

    it('passesAnUnfragmentedMessageThroughWithoutCopy', () => {
        const { calls, assembler, stream } = setUp();
        const data = payload(1, 100);
        const src = new UnsafeBuffer(new Uint8Array(200));
        src.putBytes(40, Uint8Array.from(data));
        stream.flyweight.flags(UNFRAGMENTED).frameLength(HEADER_LENGTH + 100);

        assembler.onFragment(src, 40, 100, stream.header);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.buffer).toBe(src);
        expect(calls[0]!.offset).toBe(40);
        expect(calls[0]!.length).toBe(100);
        expect(calls[0]!.header).toBe(stream.header);
        expect(calls[0]!.bytes).toEqual(data);
        if (!kind.sessions) {
            expect(assembler.bufferBuilder!().limit()).toBe(0);
            expect(assembler.bufferBuilder!().capacity()).toBe(0);
        }
    });

    if (kind.controlled) {
        it.each([Action.ABORT, Action.BREAK, Action.COMMIT, Action.CONTINUE])(
            'returnsTheActionOfTheDelegateForAnUnfragmentedMessage %s',
            (action) => {
                const assembler = kind.make(() => action);
                const stream = new Stream(777, assembler);
                stream.flyweight.flags(UNFRAGMENTED).frameLength(HEADER_LENGTH + 4);
                const result = assembler.onFragment(new UnsafeBuffer(new Uint8Array(64)), 0, 4, stream.header);
                expect(result).toBe(action);
            },
        );
    } else {
        it('returnsNothingForAnUnfragmentedMessage', () => {
            const { assembler, stream } = setUp();
            stream.flyweight.flags(UNFRAGMENTED).frameLength(HEADER_LENGTH + 4);
            const result = assembler.onFragment(new UnsafeBuffer(new Uint8Array(64)), 0, 4, stream.header);
            expect(result).toBeUndefined();
        });
    }

    it.each([0, 1, 2, 3, 5, 9])('assemblesBeginAndEndWithMiddleFragments %d', (middles) => {
        const { calls, stream } = setUp();
        const parts = [payload(1, 96)];
        for (let i = 0; i < middles; i++) {
            parts.push(payload(2 + i, 64 + i));
        }
        parts.push(payload(50, 33));

        stream.send(BEGIN_FRAG_FLAG, parts[0]!);
        for (let i = 1; i <= middles; i++) {
            stream.send(MIDDLE, parts[i]!);
            expect(calls).toHaveLength(0);
        }
        stream.send(END_FRAG_FLAG, parts[parts.length - 1]!);

        expect(calls).toHaveLength(1);
        const call = calls[0]!;
        expect(call.offset).toBe(0);
        expect(call.bytes).toEqual(parts.flat());
        expect(call.length).toBe(parts.flat().length);
        expect(call.flags).toBe(UNFRAGMENTED);
        expect(call.sessionId).toBe(777);
        expect(call.frameLength).toBe(HEADER_LENGTH + parts.flat().length);
        // Java's formula takes every fragment but the last to be as long as the first
        const fragmentedFrameLength = LogBufferDescriptor.computeFragmentedFrameLength(
            parts.flat().length,
            parts[0]!.length,
        );
        expect(call.fragmentedFrameLength).toBe(fragmentedFrameLength);
        expect(call.position).toBe(fragmentedFrameLength);
    });

    it.each([
        ['B', BEGIN_FRAG_FLAG, false],
        ['E', END_FRAG_FLAG, false],
        ['BE', UNFRAGMENTED, true],
        ['middle', MIDDLE, false],
    ])('flagCombination %s on its own', (_name, flags, delivered) => {
        const { calls, stream } = setUp();
        stream.send(flags, payload(1, 40));
        expect(calls).toHaveLength(delivered ? 1 : 0);
    });

    it.each([0x00, 0x01, 0x03, 0x04, 0x3f])(
        'reservedFlagBitsOfTheFirstAndLastFragmentsAreOredIntoTheCompleteHeader %d',
        (bits) => {
            const { calls, stream } = setUp();
            stream.send(BEGIN_FRAG_FLAG, payload(1, 40), 0x01);
            stream.send(MIDDLE, payload(2, 40), 0x02);
            stream.send(END_FRAG_FLAG, payload(3, 40), bits);

            expect(calls).toHaveLength(1);
            // the flags of the first frame are in the copied header and the last one is ORed in; a middle one is not looked at
            expect(calls[0]!.flags).toBe(byte(UNFRAGMENTED | 0x01 | bits));
        },
    );

    it('doesNothingForEndWithoutBeginAndForMiddleWithoutBegin', () => {
        const { calls, stream } = setUp();
        stream.send(MIDDLE, payload(1, 40));
        stream.send(END_FRAG_FLAG, payload(2, 40));
        expect(calls).toHaveLength(0);
    });

    it('restartsOnABeginTwice', () => {
        const { calls, stream } = setUp();
        const second = [payload(7, 50), payload(8, 60)];
        stream.send(BEGIN_FRAG_FLAG, payload(1, 40));
        stream.send(BEGIN_FRAG_FLAG, second[0]!);
        stream.send(END_FRAG_FLAG, second[1]!);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual(second.flat());
    });

    it('dropsAMessageWithAMissingMiddleFragmentAndRecoversOnTheNextBegin', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 40));
        stream.send(MIDDLE, payload(2, 40), 0, true); // lost
        stream.send(MIDDLE, payload(3, 40));
        stream.send(END_FRAG_FLAG, payload(4, 40));
        expect(calls).toHaveLength(0);

        const next = [payload(5, 70), payload(6, 20)];
        stream.send(BEGIN_FRAG_FLAG, next[0]!);
        stream.send(END_FRAG_FLAG, next[1]!);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual(next.flat());
    });

    it('dropsAMessageWithAMissingEndFragment', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 40));
        stream.send(END_FRAG_FLAG, payload(2, 40), 0, true); // lost
        stream.send(UNFRAGMENTED, payload(3, 40));
        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual(payload(3, 40));
    });

    it('dropsAMessageWithAMissingBeginFragment', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 40), 0, true); // lost
        stream.send(MIDDLE, payload(2, 40));
        stream.send(END_FRAG_FLAG, payload(3, 40));
        expect(calls).toHaveLength(0);
    });

    it('ignoresAnOutOfOrderEndFragmentAndTheFragmentsAfterIt', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 40));
        // END arrives at the term offset of the MIDDLE that has not arrived
        const skipped = stream.termOffset;
        stream.termOffset = BitUtil.align(skipped + HEADER_LENGTH + 40, FRAME_ALIGNMENT);
        stream.send(END_FRAG_FLAG, payload(2, 40));
        stream.termOffset = skipped;
        stream.send(MIDDLE, payload(3, 40));
        expect(calls).toHaveLength(0);
    });

    it('resetsOnATermOffsetMismatchSoTheRightEndFragmentAfterItIsIgnored', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 32)); // @0, the next term offset is 64
        stream.termOffset = 128; // a MIDDLE that is not the expected one
        stream.send(MIDDLE, payload(2, 32));
        stream.termOffset = 64; // the END that the first BEGIN was waiting for
        stream.send(END_FRAG_FLAG, payload(3, 32));
        expect(calls).toHaveLength(0);
    });

    it('resetsAfterTheEndFragmentSoTheEndFragmentAgainIsNotPartOfAMessage', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 32)); // @0
        stream.send(END_FRAG_FLAG, payload(2, 32)); // @64
        expect(calls).toHaveLength(1);
        stream.termOffset = 64;
        stream.send(END_FRAG_FLAG, payload(2, 32));
        expect(calls).toHaveLength(1);
    });

    it('assemblesAMessageLargerThanTheInitialCapacity', () => {
        const { calls, assembler, stream } = setUp(8);
        const parts = [payload(1, 100), payload(2, 5000), payload(3, 9000)];
        stream.send(BEGIN_FRAG_FLAG, parts[0]!);
        stream.send(MIDDLE, parts[1]!);
        stream.send(END_FRAG_FLAG, parts[2]!);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual(parts.flat());
        if (!kind.sessions) {
            expect(assembler.bufferBuilder!().capacity()).toBeGreaterThanOrEqual(parts.flat().length);
            expect(assembler.bufferBuilder!().limit()).toBe(0);
        }
    });

    it('assemblesInADirectBuilderAsInAHeapBuilder', () => {
        const heap = setUp(0, false);
        const direct = setUp(0, true);
        for (const t of [heap, direct]) {
            t.stream.send(BEGIN_FRAG_FLAG, payload(1, 5000));
            t.stream.send(END_FRAG_FLAG, payload(2, 5000));
        }
        expect(direct.calls).toHaveLength(1);
        expect(direct.calls[0]!.bytes).toEqual(heap.calls[0]!.bytes);
        if (kind.sessions) {
            expect(direct.assembler.isDirectByteBuffer!()).toBe(true);
            expect(heap.assembler.isDirectByteBuffer!()).toBe(false);
        }
    });

    it('anInsufficientCapacityThrowsFromOnFragmentAndTheNextBeginRecovers', () => {
        const { calls, assembler, stream } = setUp();
        const src = new UnsafeBuffer(new Uint8Array(64));
        stream.flyweight.termOffset(0);
        stream.flyweight.frameLength(HEADER_LENGTH + 10).flags(BEGIN_FRAG_FLAG);
        const error = assertThrowsExactly(IllegalStateException, () =>
            assembler.onFragment(src, 0, 2147483647, stream.header),
        );
        expect(error.message).toBe('insufficient capacity: maxCapacity=2147483639 limit=0 additionalLength=2147483647');

        stream.termOffset = 0;
        stream.send(BEGIN_FRAG_FLAG, payload(1, 30));
        stream.send(END_FRAG_FLAG, payload(2, 30));
        expect(calls).toHaveLength(1);
        expect(calls[0]!.length).toBe(60);
    });

    it('theCompleteHeaderCarriesTheContextOfTheLastFragmentAndIsClearedByReset', () => {
        const { calls, stream } = setUp();
        stream.header.context('first');
        stream.send(BEGIN_FRAG_FLAG, payload(1, 30));
        stream.header.context('last');
        stream.send(END_FRAG_FLAG, payload(2, 30));
        expect(calls[0]!.context).toBe('last');
        expect(calls[0]!.header).not.toBe(stream.header);

        // the next message does not see the context of the previous one in its header until it completes
        stream.header.context(null);
        stream.send(BEGIN_FRAG_FLAG, payload(3, 30));
        stream.send(END_FRAG_FLAG, payload(4, 30));
        expect(calls[1]!.context).toBeNull();
    });

    it('thePositionOfTheCompleteHeaderWrapsWithTheTermId', () => {
        const calls: Call[] = [];
        const assembler = kind.make((call) => {
            calls.push(call);
        });
        for (const termId of [INITIAL_TERM_ID + 1, 2147483647, -2147483648, -1]) {
            const stream = new Stream(777, assembler, termId);
            stream.send(BEGIN_FRAG_FLAG, payload(1, 64));
            stream.send(END_FRAG_FLAG, payload(2, 64));
            const position = calls[calls.length - 1]!.position;
            const expected = LogBufferDescriptor.computePosition(
                termId,
                stream.termOffset,
                POSITION_BITS_TO_SHIFT,
                INITIAL_TERM_ID,
            );
            expect(position).toBe(expected);
        }
    });

    it('emptyMiddleAndEndFragmentsAssemble', () => {
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, payload(1, 3));
        stream.send(MIDDLE, []);
        stream.send(END_FRAG_FLAG, []);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual(payload(1, 3));
    });

    it('anEmptyBeginFragmentThrowsAtTheEndAsJavaDoesAndTheNextBeginRecovers', () => {
        // computeFragmentedFrameLength divides by the length of the first payload: a BEGIN frame is never empty
        const { calls, stream } = setUp();
        stream.send(BEGIN_FRAG_FLAG, []);
        assertThrowsExactly(ArithmeticException, () => stream.send(END_FRAG_FLAG, payload(1, 3)));
        expect(calls).toHaveLength(0);

        stream.send(BEGIN_FRAG_FLAG, payload(2, 5));
        stream.send(END_FRAG_FLAG, payload(3, 5));
        expect(calls).toHaveLength(1);
        expect(calls[0]!.bytes).toEqual([...payload(2, 5), ...payload(3, 5)]);
    });

    if (kind.controlled) {
        it('anAbortOfAnEmptyEndFragmentThatFillsTheCapacityThrowsAsJavaDoes', () => {
            // BufferBuilder.limit(limit) rejects limit == capacity; Java has the same quirk in the ABORT path
            const calls: Call[] = [];
            const assembler = kind.make((call) => {
                calls.push(call);
                return Action.ABORT;
            }, 64);
            const stream = new Stream(777, assembler);
            stream.send(BEGIN_FRAG_FLAG, payload(1, 64)); // limit == capacity == 64
            const error = assertThrowsExactly(IllegalArgumentException, () => stream.send(END_FRAG_FLAG, []));
            expect(error.message).toBe('limit outside range: capacity=64 limit=64');
            expect(calls).toHaveLength(1);
            expect(calls[0]!.length).toBe(64);
        });
    }

    it('reusesTheBuilderForBackToBackMessages', () => {
        const { calls, stream } = setUp();
        for (let m = 0; m < 20; m++) {
            stream.send(BEGIN_FRAG_FLAG, payload(m, 50 + m));
            stream.send(END_FRAG_FLAG, payload(m + 100, 10));
        }
        expect(calls).toHaveLength(20);
        for (let m = 0; m < 20; m++) {
            expect(calls[m]!.bytes).toEqual([...payload(m, 50 + m), ...payload(m + 100, 10)]);
        }
    });

    it('exposesItsDelegate', () => {
        const handler = record(() => {});
        expect(kind.construct(handler).delegate()).toBe(handler);
    });

    if (kind.sessions) {
        it('keepsOneBuilderPerSessionForInterleavedSessions', () => {
            const { calls, assembler } = setUp();
            const a = new Stream(1, assembler);
            const b = new Stream(2, assembler);
            a.send(BEGIN_FRAG_FLAG, payload(1, 50));
            b.send(BEGIN_FRAG_FLAG, payload(2, 60));
            a.send(MIDDLE, payload(3, 70));
            b.send(END_FRAG_FLAG, payload(4, 80));
            a.send(END_FRAG_FLAG, payload(5, 90));

            expect(calls).toHaveLength(2);
            expect(calls[0]!.sessionId).toBe(2);
            expect(calls[0]!.bytes).toEqual([...payload(2, 60), ...payload(4, 80)]);
            expect(calls[1]!.sessionId).toBe(1);
            expect(calls[1]!.bytes).toEqual([...payload(1, 50), ...payload(3, 70), ...payload(5, 90)]);
        });

        it('aLostFragmentOfOneSessionDoesNotAffectTheOther', () => {
            const { calls, assembler } = setUp();
            const a = new Stream(1, assembler);
            const b = new Stream(2, assembler);
            a.send(BEGIN_FRAG_FLAG, payload(1, 50));
            b.send(BEGIN_FRAG_FLAG, payload(2, 60));
            a.send(MIDDLE, payload(3, 70), 0, true);
            b.send(MIDDLE, payload(4, 70));
            a.send(END_FRAG_FLAG, payload(5, 90));
            b.send(END_FRAG_FLAG, payload(6, 90));

            expect(calls).toHaveLength(1);
            expect(calls[0]!.sessionId).toBe(2);
        });

        it('freeSessionBufferDropsAPartialMessageOfThatSessionOnly', () => {
            const { calls, assembler } = setUp();
            const a = new Stream(1, assembler);
            const b = new Stream(2, assembler);
            a.send(BEGIN_FRAG_FLAG, payload(1, 50));
            b.send(BEGIN_FRAG_FLAG, payload(2, 60));

            expect(assembler.freeSessionBuffer!(1)).toBe(true);
            expect(assembler.freeSessionBuffer!(1)).toBe(false);
            expect(assembler.freeSessionBuffer!(99)).toBe(false);

            a.send(END_FRAG_FLAG, payload(3, 70));
            b.send(END_FRAG_FLAG, payload(4, 80));
            expect(calls).toHaveLength(1);
            expect(calls[0]!.sessionId).toBe(2);
        });

        it('clearDropsEverySessionAndTheAssemblerIsUsableAgain', () => {
            const { calls, assembler } = setUp();
            const a = new Stream(1, assembler);
            const b = new Stream(2, assembler);
            a.send(BEGIN_FRAG_FLAG, payload(1, 50));
            b.send(BEGIN_FRAG_FLAG, payload(2, 60));
            assembler.clear!();
            a.send(END_FRAG_FLAG, payload(3, 70));
            b.send(END_FRAG_FLAG, payload(4, 80));
            expect(calls).toHaveLength(0);
            expect(assembler.freeSessionBuffer!(1)).toBe(false);

            a.send(BEGIN_FRAG_FLAG, payload(5, 50));
            a.send(END_FRAG_FLAG, payload(6, 50));
            expect(calls).toHaveLength(1);
        });

        it('aSessionIdOfAnyValueIsAKey', () => {
            const { calls, assembler } = setUp();
            for (const sessionId of [0, 1, -1, 2147483647, -2147483648]) {
                const stream = new Stream(sessionId, assembler);
                stream.send(BEGIN_FRAG_FLAG, payload(1, 20));
                stream.send(END_FRAG_FLAG, payload(2, 20));
                expect(calls[calls.length - 1]!.sessionId).toBe(sessionId);
            }
            expect(calls).toHaveLength(5);
            for (const sessionId of [0, 1, -1, 2147483647, -2147483648]) {
                expect(assembler.freeSessionBuffer!(sessionId)).toBe(true);
            }
        });
    } else {
        it.each([false, true])('theBuilderOfTheImageAssemblerIsDirectOrHeap %s', (isDirect) => {
            const assembler = kind.make(() => {}, 0, isDirect);
            const builder = assembler.bufferBuilder!();
            builder.append(new UnsafeBuffer(new Uint8Array(5000).fill(0x55)), 0, 5000);
            builder.limit(10);
            builder.compact();
            // a heap resize is Arrays.copyOf (the bytes past the limit stay), a direct one copies `limit` bytes
            expect(builder.capacity()).toBe(INIT_MIN_CAPACITY);
            expect(builder.buffer().getByte(100)).toBe(isDirect ? 0 : 0x55);
        });

        it('twoImagesKeepTheirOwnBuilders', () => {
            const callsA: Call[] = [];
            const callsB: Call[] = [];
            const assemblerA = kind.make((call) => {
                callsA.push(call);
            });
            const assemblerB = kind.make((call) => {
                callsB.push(call);
            });
            const a = new Stream(1, assemblerA);
            const b = new Stream(2, assemblerB);
            a.send(BEGIN_FRAG_FLAG, payload(1, 50));
            b.send(BEGIN_FRAG_FLAG, payload(2, 60));
            a.send(MIDDLE, payload(3, 70));
            b.send(END_FRAG_FLAG, payload(4, 80));
            a.send(END_FRAG_FLAG, payload(5, 90));

            expect(callsB).toHaveLength(1);
            expect(callsB[0]!.bytes).toEqual([...payload(2, 60), ...payload(4, 80)]);
            expect(callsA).toHaveLength(1);
            expect(callsA[0]!.bytes).toEqual([...payload(1, 50), ...payload(3, 70), ...payload(5, 90)]);
            expect(assemblerA.bufferBuilder!()).not.toBe(assemblerB.bufferBuilder!());
        });

        it('doesNotLookAtTheSessionId', () => {
            const { calls, assembler } = setUp();
            const first = new Stream(1, assembler);
            first.send(BEGIN_FRAG_FLAG, payload(1, 50));
            first.flyweight.sessionId(2);
            first.send(END_FRAG_FLAG, payload(2, 50));
            expect(calls).toHaveLength(1);
            expect(calls[0]!.bytes).toEqual([...payload(1, 50), ...payload(2, 50)]);
        });

        it('aMiddleFragmentAfterTheCompletionOfAMessageIsIgnored', () => {
            const { calls, stream } = setUp();
            stream.send(BEGIN_FRAG_FLAG, payload(1, 50));
            stream.send(END_FRAG_FLAG, payload(2, 50));
            stream.send(MIDDLE, payload(3, 50));
            stream.send(END_FRAG_FLAG, payload(4, 50));
            expect(calls).toHaveLength(1);
        });
    }

    if (kind.controlled) {
        describe('actions of the delegate on the END fragment', () => {
            function run(action: Action) {
                const calls: Call[] = [];
                const assembler = kind.make((call) => {
                    calls.push(call);
                    return action;
                });
                const stream = new Stream(777, assembler);
                stream.send(BEGIN_FRAG_FLAG, payload(1, 50));
                stream.send(MIDDLE, payload(2, 50));
                return { calls, assembler, stream };
            }

            it.each([Action.BREAK, Action.COMMIT, Action.CONTINUE])('%s resets the builder', (action) => {
                const { calls, assembler, stream } = run(action);
                const result = stream.send(END_FRAG_FLAG, payload(3, 50));
                expect(result).toBe(action);
                expect(calls).toHaveLength(1);
                if (!kind.sessions) {
                    expect(assembler.bufferBuilder!().limit()).toBe(0);
                    expect(assembler.bufferBuilder!().nextTermOffset()).toBe(Aeron.NULL_VALUE);
                }
            });

            it('ABORT keeps the message, without the END fragment, so the END fragment can be delivered again', () => {
                const { calls, assembler, stream } = run(Action.ABORT);
                const endOffset = stream.termOffset;
                const result = stream.send(END_FRAG_FLAG, payload(3, 50));
                expect(result).toBe(Action.ABORT);
                expect(calls).toHaveLength(1);
                expect(calls[0]!.bytes).toEqual([...payload(1, 50), ...payload(2, 50), ...payload(3, 50)]);
                if (!kind.sessions) {
                    expect(assembler.bufferBuilder!().limit()).toBe(100);
                }

                // the poll delivers the same fragment again, as after an ABORT
                stream.termOffset = endOffset;
                expect(stream.send(END_FRAG_FLAG, payload(3, 50))).toBe(Action.ABORT);
                expect(calls).toHaveLength(2);
                expect(calls[1]!.bytes).toEqual(calls[0]!.bytes);
                expect(calls[1]!.length).toBe(150);
            });

            it('ABORT then CONTINUE on the retry delivers the message once more and resets', () => {
                let action = Action.ABORT;
                const calls: Call[] = [];
                const assembler = kind.make((call) => {
                    calls.push(call);
                    return action;
                });
                const stream = new Stream(777, assembler);
                stream.send(BEGIN_FRAG_FLAG, payload(1, 50));
                const endOffset = stream.termOffset;
                stream.send(END_FRAG_FLAG, payload(2, 50));
                action = Action.CONTINUE;
                stream.termOffset = endOffset;
                expect(stream.send(END_FRAG_FLAG, payload(2, 50))).toBe(Action.CONTINUE);
                expect(calls).toHaveLength(2);
                expect(calls[1]!.bytes).toEqual([...payload(1, 50), ...payload(2, 50)]);
                stream.termOffset = endOffset;
                stream.send(END_FRAG_FLAG, payload(2, 50));
                expect(calls).toHaveLength(2);
            });
        });
    }

    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 7919))('matchesTheModelOfLossForSeed %d', (seed) => {
        const random = mulberry32(seed);
        const calls: Call[] = [];
        const assembler = kind.make(
            (call) => {
                calls.push(call);
            },
            random() < 0.5 ? 0 : 16,
            random() < 0.5,
        );
        const sessionCount = kind.sessions ? 1 + Math.floor(random() * 3) : 1;
        const streams: Stream[] = [];
        for (let s = 0; s < sessionCount; s++) {
            streams.push(new Stream(100 + s, assembler));
        }
        const expected: Map<number, number[][]> = new Map();
        streams.forEach((stream) => expected.set(stream.sessionId, []));

        for (let message = 0; message < 40; message++) {
            const stream = streams[Math.floor(random() * streams.length)]!;
            const fragments = random() < 0.3 ? 1 : 2 + Math.floor(random() * 4);
            const parts: number[][] = [];
            let delivered = true;
            for (let f = 0; f < fragments; f++) {
                // the first payload of a fragmented message is never empty (see anEmptyBeginFragment...)
                const part = payload(message * 10 + f, Math.floor(random() * 200) + (0 === f ? 1 : 0));
                const flags =
                    1 === fragments
                        ? UNFRAGMENTED
                        : 0 === f
                          ? BEGIN_FRAG_FLAG
                          : f === fragments - 1
                            ? END_FRAG_FLAG
                            : MIDDLE;
                const lost = random() < 0.1;
                delivered = delivered && !lost;
                parts.push(part);
                stream.send(flags, part, 0, lost);
            }
            if (delivered) {
                expected.get(stream.sessionId)!.push(parts.flat());
            }
        }

        const actual = new Map<number, number[][]>();
        streams.forEach((stream) => actual.set(stream.sessionId, []));
        for (const call of calls) {
            actual.get(call.sessionId)!.push(call.bytes);
        }
        // the sessions are independent, so the order within one session is the order of the messages
        expect(actual).toEqual(expected);
    });
});

describe('BufferBuilder matrix', () => {
    it.each([false, true])('compactCopiesTheBytesPastTheLimitOnlyInAHeapBuilder isDirect=%s', (isDirect) => {
        const builder = new BufferBuilder(0, isDirect);
        builder.append(new UnsafeBuffer(new Uint8Array(5000).fill(0x55)), 0, 5000);
        builder.limit(10);
        builder.compact();
        expect(builder.capacity()).toBe(INIT_MIN_CAPACITY);
        expect(builder.buffer().getByte(100)).toBe(isDirect ? 0 : 0x55);
        expect(builder.buffer().getByte(5)).toBe(0x55);
    });

    it('resetClearsTheLimitTheNextTermOffsetAndTheCompleteHeaderButKeepsTheCapacity', () => {
        const builder = new BufferBuilder();
        const flyweight = new DataHeaderFlyweight();
        flyweight.wrap(new Uint8Array(32));
        flyweight.frameLength(HEADER_LENGTH + 10).flags(UNFRAGMENTED);
        const header = new Header(INITIAL_TERM_ID, POSITION_BITS_TO_SHIFT, 'context');
        header.buffer(new UnsafeBuffer(flyweight.byteArray()));
        header.offset(0);

        builder.captureHeader(header).append(new UnsafeBuffer(new Uint8Array(10)), 0, 10);
        builder.nextTermOffset(64);
        builder.completeHeader(header);
        expect(builder._completeHeader.context()).toBe('context');
        expect(builder._completeHeader.fragmentedFrameLength()).not.toBe(Aeron.NULL_VALUE);

        expect(builder.reset()).toBe(builder);
        expect(builder.limit()).toBe(0);
        expect(builder.nextTermOffset()).toBe(Aeron.NULL_VALUE);
        expect(builder._completeHeader.context()).toBeNull();
        expect(builder._completeHeader.fragmentedFrameLength()).toBe(Aeron.NULL_VALUE);
        expect(builder.capacity()).toBe(INIT_MIN_CAPACITY);
    });

    it.each([
        [0, false],
        [1, true],
        [63, true],
        [64, false],
        [65, false],
        [-1, false],
    ])('limitAtTheEdgesOfACapacityOf64 %d', (limit, accepted) => {
        const builder = new BufferBuilder(64);
        if (accepted) {
            builder.limit(limit);
            expect(builder.limit()).toBe(limit);
        } else if (0 === limit) {
            builder.limit(0);
            expect(builder.limit()).toBe(0);
        } else {
            const error = assertThrowsExactly(IllegalArgumentException, () => builder.limit(limit));
            expect(error.message).toBe('limit outside range: capacity=64 limit=' + limit);
            expect(builder.limit()).toBe(0);
        }
    });

    it('limitOfAnEmptyBuilderIsRejectedEvenAtZero', () => {
        const builder = new BufferBuilder();
        assertThrowsExactly(IllegalArgumentException, () => builder.limit(0));
    });

    it.each([
        [MAX_CAPACITY, MAX_CAPACITY, MAX_CAPACITY],
        [MAX_CAPACITY - 1, MAX_CAPACITY, MAX_CAPACITY],
        [MAX_CAPACITY - 1, MAX_CAPACITY - 1, MAX_CAPACITY - 1],
        [1_431_655_759, 1_431_655_760, 2_147_483_638],
        [1_431_655_760, 1_431_655_761, MAX_CAPACITY],
        [1_431_655_758, 1_431_655_759, 2_147_483_637],
        [INIT_MIN_CAPACITY, INIT_MIN_CAPACITY + 1, 6144],
        [INIT_MIN_CAPACITY, INIT_MIN_CAPACITY, INIT_MIN_CAPACITY],
        [0, 1, INIT_MIN_CAPACITY],
        [0, 0, INIT_MIN_CAPACITY],
    ])('findSuitableCapacityAtTheMaximum %d %d %d', (capacity, required, expected) => {
        expect(BufferBuilder.findSuitableCapacity(capacity, required)).toBe(expected);
    });

    it('findSuitableCapacityIsAtLeastTheRequiredCapacityAndAtMostTheMaximum for seeded random values', () => {
        const random = mulberry32(2024);
        for (let i = 0; i < 20_000; i++) {
            const capacity = Math.floor(random() * random() * MAX_CAPACITY);
            const required = capacity + 1 + Math.floor(random() * random() * (MAX_CAPACITY - capacity));
            const result = BufferBuilder.findSuitableCapacity(capacity, required);
            expect(result).toBeGreaterThanOrEqual(required);
            expect(result).toBeLessThanOrEqual(MAX_CAPACITY);
            expect(result).toBeGreaterThanOrEqual(Math.max(capacity, INIT_MIN_CAPACITY));
        }
    });

    it('growsByAHalfEachTimeAndKeepsTheBytes', () => {
        const builder = new BufferBuilder();
        const capacities: number[] = [];
        const chunk = new UnsafeBuffer(Uint8Array.from(payload(9, 1000)));
        for (let i = 0; i < 60; i++) {
            builder.append(chunk, 0, 1000);
            if (capacities[capacities.length - 1] !== builder.capacity()) {
                capacities.push(builder.capacity());
            }
        }
        expect(capacities.slice(0, 4)).toEqual([4096, 6144, 9216, 13824]);
        const out = new Uint8Array(60_000);
        builder.buffer().getBytes(0, out, 0, 60_000);
        for (let i = 0; i < 60; i++) {
            expect(Array.from(out.subarray(i * 1000, (i + 1) * 1000))).toEqual(payload(9, 1000));
        }
    });

    it.each([false, true])('growsAndCompactsKeepingTheBytes %s', (isDirect) => {
        const builder = new BufferBuilder(10, isDirect);
        const data = payload(4, 20_000);
        builder.append(new UnsafeBuffer(Uint8Array.from(data)), 0, 20_000);
        expect(builder.capacity()).toBeGreaterThan(20_000);
        builder.compact();
        expect(builder.capacity()).toBe(20_000);
        const out = new Uint8Array(20_000);
        builder.buffer().getBytes(0, out, 0, 20_000);
        expect(Array.from(out)).toEqual(data);
        builder.append(new UnsafeBuffer(Uint8Array.from([1, 2, 3])), 0, 3);
        expect(builder.limit()).toBe(20_003);
        expect(builder.capacity()).toBeGreaterThanOrEqual(20_003);
    });

    it('anAppendThatWouldPassTheMaximumThrowsAndChangesNothing', () => {
        const builder = new BufferBuilder(64);
        builder.append(new UnsafeBuffer(new Uint8Array(16)), 0, 16);
        const buffer = builder.buffer();
        for (const length of [MAX_CAPACITY - 15, MAX_CAPACITY, 2147483647]) {
            const error = assertThrowsExactly(IllegalStateException, () =>
                builder.append(new UnsafeBuffer(new Uint8Array(16)), 0, length),
            );
            expect(error.message).toBe(
                'insufficient capacity: maxCapacity=2147483639 limit=16 additionalLength=' + length,
            );
            expect(builder.limit()).toBe(16);
            expect(builder.capacity()).toBe(64);
            expect(builder.buffer()).toBe(buffer);
        }
    });

    it('theInitialCapacityAtTheEdges', () => {
        expect(new BufferBuilder(0).capacity()).toBe(0);
        expect(new BufferBuilder(1).capacity()).toBe(1);
        for (const bad of [-1, MAX_CAPACITY + 1, 2147483647]) {
            assertThrowsExactly(IllegalArgumentException, () => new BufferBuilder(bad));
        }
    });

    it('theCompleteHeaderIsTheSameObjectEachTime', () => {
        const builder = new BufferBuilder();
        const flyweight = new DataHeaderFlyweight();
        flyweight.wrap(new Uint8Array(32));
        flyweight.frameLength(HEADER_LENGTH + 10).flags(END_FRAG_FLAG);
        const header = new Header(INITIAL_TERM_ID, POSITION_BITS_TO_SHIFT);
        header.buffer(new UnsafeBuffer(flyweight.byteArray()));
        header.offset(0);
        builder.captureHeader(header);
        const first = builder.completeHeader(header);
        expect(builder.completeHeader(header)).toBe(first);
        expect(first).toBe(builder._completeHeader);
    });
});
