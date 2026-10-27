// Not in Agrona: write, tryClaim, commit, abort and read allocate nothing per message over a SharedArrayBuffer (spec
// 5.3, D16), for both ring buffers; the handler of the reads only sums. A minor garbage collection happens only after
// something is allocated, so the test counts the collections over a long loop (see test/support/Allocation.ts).
// Each case runs twice: from position 0, where it allocates nothing, and from 2^40 (the `LargePosition` cases), where
// the positions are outside V8's 31-bit small integers and are boxed into heap numbers across calls that are not inlined.
import { describe, it } from 'vitest';
import { ARRAY_BACKING, SHARED_BACKING } from '../../../../support/Backing.js';
import type { ControlledMessageHandler } from '../../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import { Action } from '../../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import type { MessageHandler } from '../../../../../src/agrona/concurrent/MessageHandler.js';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import { RingBufferDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import type { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { expectNoAllocation } from '../../../../support/Allocation.js';

const CAPACITY = 64 * 1024;
const LENGTH = 64;
const TYPE = 7;

/** The positions of the `LargePosition` cases start here: a safe integer far outside the 31-bit small integers. */
const LARGE_POSITION = 2 ** 40;

type Case = 'writeAndRead' | 'tryClaimCommitAndRead' | 'tryClaimAbortAndRead' | 'controlledRead' | 'sizeAndPositions';

/**
 * Upper bounds of the `LargePosition` cases (spec D127): the heap numbers per iteration (write + read, claim + commit +
 * read and so on) that a case may allocate, each the minimum bound that passes over an ArrayBuffer, in the order of this
 * file (many-to-one measures 4 or 5 depending on how V8 inlines the loop, so 5; one-to-one 4; `size`, the positions
 * and the heartbeat: 4). The ring buffers keep Java's code, which calls up to five `long` operations of `UnsafeBuffer`
 * of 370 to 600 bytecode bytes each, and V8 inlines 920 in all: the operations that are not inlined box the position they
 * take or return (issue #19). The SharedArrayBuffer cases use the same bounds, except where
 * `SHARED_LARGE_POSITION_HEAP_NUMBERS` overrides them.
 */
export const LARGE_POSITION_HEAP_NUMBERS: Readonly<Record<'many-to-one' | 'one-to-one', Record<Case, number>>> = {
    'many-to-one': {
        writeAndRead: 5,
        tryClaimCommitAndRead: 5,
        tryClaimAbortAndRead: 5,
        controlledRead: 5,
        sizeAndPositions: 4,
    },
    'one-to-one': {
        writeAndRead: 4,
        tryClaimCommitAndRead: 4,
        tryClaimAbortAndRead: 4,
        controlledRead: 4,
        sizeAndPositions: 4,
    },
};

/**
 * Overrides of `LARGE_POSITION_HEAP_NUMBERS` for a SharedArrayBuffer, each the minimum bound that passes: one-to-one
 * `size`, the positions and the heartbeat box 5 per iteration on node 24 (1 on node 22), one more than over an
 * ArrayBuffer (issue #19, spec D127).
 */
const SHARED_LARGE_POSITION_HEAP_NUMBERS: Readonly<
    Record<'many-to-one' | 'one-to-one', Partial<Record<Case, number>>>
> = {
    'many-to-one': {},
    'one-to-one': { sizeAndPositions: 5 },
};

/** Keeps the values of the loops alive. */
let sink = 0;

class Sum implements MessageHandler, ControlledMessageHandler {
    public total = 0;

    public onMessage(msgTypeId: number, _buffer: unknown, index: number, length: number): Action {
        this.total = (this.total + msgTypeId + index + length) | 0;
        sink = this.total;
        return Action.CONTINUE;
    }
}

describe.each([
    [
        'many-to-one ArrayBuffer',
        'many-to-one',
        ARRAY_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(buffer),
    ],
    [
        'one-to-one ArrayBuffer',
        'one-to-one',
        ARRAY_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(buffer),
    ],
    [
        'many-to-one SharedArrayBuffer',
        'many-to-one',
        SHARED_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(buffer),
    ],
    [
        'one-to-one SharedArrayBuffer',
        'one-to-one',
        SHARED_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(buffer),
    ],
] as const)('RingBufferHotPathAllocation %s', (_name, kind, backing, create) => {
    const suffix = backing.shared ? 'SharedNoAllocation' : '';

    describe.each([
        ['', 0],
        ['LargePosition', LARGE_POSITION],
    ] as const)('%s', (where, start) => {
        const setUp = (): { ring: RingBuffer; src: UnsafeBuffer; sum: Sum } => {
            const sab = backing.aligned(CAPACITY + RingBufferDescriptor.TRAILER_LENGTH, 64);
            const buffer = new UnsafeBuffer(sab);
            if (0 !== start) {
                // as startAt of RingBufferExtraTest: the tail, the head and the head cache, on a capacity boundary
                buffer.putLong(CAPACITY + RingBufferDescriptor.TAIL_POSITION_OFFSET, start);
                buffer.putLong(CAPACITY + RingBufferDescriptor.HEAD_POSITION_OFFSET, start);
                buffer.putLong(CAPACITY + RingBufferDescriptor.HEAD_CACHE_POSITION_OFFSET, start);
            }
            const src = new UnsafeBuffer(new Uint8Array(LENGTH));
            src.putInt(0, 42);
            return { ring: create(buffer), src, sum: new Sum() };
        };
        const bound = (name: Case): number =>
            0 === start
                ? 0
                : ((backing.shared ? SHARED_LARGE_POSITION_HEAP_NUMBERS[kind][name] : undefined) ??
                  LARGE_POSITION_HEAP_NUMBERS[kind][name]);
        const title = (name: string): string => name + where + suffix;

        it(title('writeAndReadAllocateNothing'), async () => {
            const { ring, src, sum } = setUp();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        if (!ring.write(TYPE, src, 0, LENGTH)) {
                            throw new Error('full');
                        }
                        ring.read(sum);
                    }
                },
                undefined,
                bound('writeAndRead'),
            );
        });

        it(title('tryClaimCommitAndReadAllocateNothing'), async () => {
            const { ring, sum } = setUp();
            const buffer = ring.buffer();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        const index = ring.tryClaim(TYPE, LENGTH);
                        if (index <= 0) {
                            throw new Error('full');
                        }
                        buffer.putInt(index, i);
                        ring.commit(index);
                        ring.read(sum);
                    }
                },
                undefined,
                bound('tryClaimCommitAndRead'),
            );
        });

        it(title('tryClaimAbortAndReadAllocateNothing'), async () => {
            const { ring, sum } = setUp();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        const index = ring.tryClaim(TYPE, LENGTH);
                        if (index <= 0) {
                            throw new Error('full');
                        }
                        ring.abort(index);
                        ring.read(sum);
                    }
                },
                undefined,
                bound('tryClaimAbortAndRead'),
            );
        });

        it(title('controlledReadAllocatesNothing'), async () => {
            const { ring, src, sum } = setUp();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        if (!ring.write(TYPE, src, 0, LENGTH)) {
                            throw new Error('full');
                        }
                        ring.controlledRead(sum);
                    }
                },
                undefined,
                bound('controlledRead'),
            );
        });

        it(title('sizeAndThePositionsAndTheHeartbeatAllocateNothing'), async () => {
            const { ring, src } = setUp();
            ring.write(TYPE, src, 0, LENGTH);

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        ring.consumerHeartbeatTime(i);
                        sink =
                            (sink +
                                ring.consumerHeartbeatTime() +
                                ring.size() +
                                ring.producerPosition() +
                                ring.consumerPosition()) |
                            0;
                    }
                },
                undefined,
                bound('sizeAndPositions'),
            );
        });
    });
});
