// Not in Aeron (issue #21, spec D5): what a ring buffer does at position 2^53.
import { describe, expect, it } from 'vitest';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import type { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { RingBufferDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';

const { HEAD_CACHE_POSITION_OFFSET, HEAD_POSITION_OFFSET, TAIL_POSITION_OFFSET, TRAILER_LENGTH } = RingBufferDescriptor;
const CAPACITY = 4096;
const RECORD = 512;
const LIMIT = 2 ** 53;

describe.each([
    ['many-to-one', (b: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(b)],
    ['one-to-one', (b: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(b)],
] as const)('RingBufferPositionLimitRegressionExtraTest %s', (_name, create) => {
    it('theProducerThrowsAtTwoToThe53AndTheConsumerNeverRedeliversRegression', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(CAPACITY + TRAILER_LENGTH));
        const ring = create(buffer);
        const start = LIMIT - CAPACITY;
        buffer.putLong(CAPACITY + HEAD_POSITION_OFFSET, start);
        buffer.putLong(CAPACITY + HEAD_CACHE_POSITION_OFFSET, start);
        buffer.putLong(CAPACITY + TAIL_POSITION_OFFSET, start);
        const src = new UnsafeBuffer(new Uint8Array(RECORD).fill(0xab));

        const received: number[] = [];
        const handler = {
            onMessage: (type: number, _b: unknown, _i: number, length: number): void =>
                void received.push(type * 1000 + length),
        };
        for (let i = 0; i < CAPACITY / RECORD - 1; i++) {
            expect(ring.write(1 + i, src, 0, RECORD - 8)).toBe(true);
        }
        expect(ring.producerPosition()).toBe(LIMIT - RECORD);

        // the consumer reads everything that was published, up to 2^53 - 512, and its head store is within range
        expect(ring.read(handler)).toBe(7);
        expect(received).toEqual([1, 2, 3, 4, 5, 6, 7].map((type) => type * 1000 + RECORD - 8));
        expect(ring.consumerPosition()).toBe(LIMIT - RECORD);

        // the producer is the one that fails: the store of the tail at 2^53 throws and the tail stays where it was
        expect(() => ring.write(9, src, 0, RECORD - 8)).toThrow(RangeError);
        expect(ring.producerPosition()).toBe(LIMIT - RECORD);

        // so the consumer has nothing to redeliver and its head never has to reach 2^53: a read finds no message and
        // does not throw, however often it is called
        for (let i = 0; i < 3; i++) {
            expect(ring.read(handler)).toBe(0);
        }
        expect(received.length).toBe(7);
        expect(ring.consumerPosition()).toBe(LIMIT - RECORD);
    });
});
