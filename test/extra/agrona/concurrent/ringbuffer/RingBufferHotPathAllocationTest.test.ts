// Not in Agrona: write, tryClaim, commit, abort and read allocate nothing per message over a SharedArrayBuffer (spec
// 5.3, D16), for both ring buffers; the handler of the reads only sums. A minor garbage collection happens only after
// something is allocated, so the test counts the collections over a long loop (see test/support/Allocation.ts).
// Values are int-sized: a long above 2^31 boxes in V8 whatever the code does.
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
    ['many-to-one ArrayBuffer', ARRAY_BACKING, (buffer: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(buffer)],
    ['one-to-one ArrayBuffer', ARRAY_BACKING, (buffer: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(buffer)],
    [
        'many-to-one SharedArrayBuffer',
        SHARED_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(buffer),
    ],
    [
        'one-to-one SharedArrayBuffer',
        SHARED_BACKING,
        (buffer: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(buffer),
    ],
] as const)('RingBufferHotPathAllocation %s', (_name, backing, create) => {
    const suffix = backing.shared ? 'SharedNoAllocation' : '';
    const setUp = (): { ring: RingBuffer; src: UnsafeBuffer; sum: Sum } => {
        const sab = backing.aligned(CAPACITY + RingBufferDescriptor.TRAILER_LENGTH, 64);
        const src = new UnsafeBuffer(new Uint8Array(LENGTH));
        src.putInt(0, 42);
        return { ring: create(new UnsafeBuffer(sab)), src, sum: new Sum() };
    };

    it('writeAndReadAllocateNothing' + suffix, async () => {
        const { ring, src, sum } = setUp();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (!ring.write(TYPE, src, 0, LENGTH)) {
                    throw new Error('full');
                }
                ring.read(sum);
            }
        });
    });

    it('tryClaimCommitAndReadAllocateNothing' + suffix, async () => {
        const { ring, sum } = setUp();
        const buffer = ring.buffer();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const index = ring.tryClaim(TYPE, LENGTH);
                if (index <= 0) {
                    throw new Error('full');
                }
                buffer.putInt(index, i);
                ring.commit(index);
                ring.read(sum);
            }
        });
    });

    it('tryClaimAbortAndReadAllocateNothing' + suffix, async () => {
        const { ring, sum } = setUp();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const index = ring.tryClaim(TYPE, LENGTH);
                if (index <= 0) {
                    throw new Error('full');
                }
                ring.abort(index);
                ring.read(sum);
            }
        });
    });

    it('controlledReadAllocatesNothing' + suffix, async () => {
        const { ring, src, sum } = setUp();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (!ring.write(TYPE, src, 0, LENGTH)) {
                    throw new Error('full');
                }
                ring.controlledRead(sum);
            }
        });
    });

    it('sizeAndThePositionsAndTheHeartbeatAllocateNothing' + suffix, async () => {
        const { ring, src } = setUp();
        ring.write(TYPE, src, 0, LENGTH);

        await expectNoAllocation((n) => {
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
        });
    });
});
