// Tests the port adds: the ring buffers keep Java's 64-bit positions and heartbeat, so a position and a heartbeat past
// 2^32 must work on both backings. Single threaded; the cross-worker tests are in RingBufferCrossWorkerExtraTest.
import { describe, expect, it } from 'vitest';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import { RecordDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RecordDescriptor.js';
import type { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { RingBufferDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { MessageHandler } from '../../../../../src/agrona/concurrent/MessageHandler.js';
import { BACKINGS } from '../../../../support/Backing.js';

const { ALIGNMENT, HEADER_LENGTH } = RecordDescriptor;
const {
    CONSUMER_HEARTBEAT_OFFSET,
    CORRELATION_COUNTER_OFFSET,
    HEAD_CACHE_POSITION_OFFSET,
    HEAD_POSITION_OFFSET,
    TAIL_POSITION_OFFSET,
    TRAILER_LENGTH,
} = RingBufferDescriptor;

const CAPACITY = 4096;
const TAIL = CAPACITY + TAIL_POSITION_OFFSET;
const HEAD = CAPACITY + HEAD_POSITION_OFFSET;
const HEAD_CACHE = CAPACITY + HEAD_CACHE_POSITION_OFFSET;

const RINGS = [
    ['many-to-one', (buffer: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(buffer)],
    ['one-to-one', (buffer: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(buffer)],
] as const;

function startAt(buffer: UnsafeBuffer, position: number): void {
    buffer.putLong(TAIL, position);
    buffer.putLong(HEAD, position);
    buffer.putLong(HEAD_CACHE, position);
}

describe.each(BACKINGS)('RingBufferExtraTest over $name', (backing) => {
    const newBuffer = (): UnsafeBuffer => new UnsafeBuffer(backing.arrayBuffer(CAPACITY + TRAILER_LENGTH));

    describe.each(RINGS)('%s', (_name, create) => {
        it('theHeartbeatKeepsItsOwnSlotAndRoundTripsLongs', () => {
            expect(CONSUMER_HEARTBEAT_OFFSET - CORRELATION_COUNTER_OFFSET).toBe(128);
            expect(CONSUMER_HEARTBEAT_OFFSET + 128).toBe(TRAILER_LENGTH);

            const buffer = newBuffer();
            const ring = create(buffer);
            const before = new Uint8Array(CAPACITY + TRAILER_LENGTH);
            buffer.getBytes(0, before);

            for (const time of [0, 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 7, 2 ** 40 + 3, 2 ** 53 - 1, -1, -(2 ** 33)]) {
                ring.consumerHeartbeatTime(time);
                expect(ring.consumerHeartbeatTime()).toBe(time);
            }

            const after = new Uint8Array(CAPACITY + TRAILER_LENGTH);
            buffer.getBytes(0, after);
            const heartbeat = CAPACITY + CONSUMER_HEARTBEAT_OFFSET;
            for (let i = 0; i < after.length; i++) {
                if (i < heartbeat || i >= heartbeat + 8) {
                    expect(after[i], 'byte ' + i).toBe(before[i]);
                }
            }
        });

        it('theCorrelationIdCountsUpAndTheOtherFieldsDoNotDisturbIt', () => {
            const buffer = newBuffer();
            const ring = create(buffer);

            ring.consumerHeartbeatTime(2 ** 36 + 5);
            expect(ring.nextCorrelationId()).toBe(0);
            expect(ring.nextCorrelationId()).toBe(1);
            expect(ring.write(1, new UnsafeBuffer(new Uint8Array(8)), 0, 8)).toBe(true);
            expect(ring.read({ onMessage: () => {} })).toBe(1);

            expect(ring.consumerHeartbeatTime()).toBe(2 ** 36 + 5);
            expect(ring.nextCorrelationId()).toBe(2);
        });

        it('thePositionsPast2Pow32AreExactAndTheBacklogIsTheirDifference', () => {
            const buffer = newBuffer();
            const ring = create(buffer);
            const src = new UnsafeBuffer(new Uint8Array(64));
            startAt(buffer, 2 ** 32 - 256);
            const received: number[] = [];
            const handler: MessageHandler = { onMessage: (_t, b, index) => void received.push(b.getInt(index)) };

            for (let i = 0; i < 3 * (CAPACITY / 64); i++) {
                src.putInt(0, i);
                expect(ring.write(5, src, 0, 20)).toBe(true);
                expect(ring.size()).toBeGreaterThanOrEqual(HEADER_LENGTH + 20);
                expect(ring.size()).toBeLessThanOrEqual(CAPACITY);
                // a read that finds the padding of the buffer end returns having read no message: try again
                ring.read(handler);
                ring.read(handler);
                expect(ring.size()).toBe(0);
            }
            expect(received).toEqual(Array.from({ length: 3 * (CAPACITY / 64) }, (_, i) => i));
            expect(ring.producerPosition()).toBe(ring.consumerPosition());
            expect(ring.producerPosition()).toBeGreaterThan(2 ** 32);
            expect(buffer.getLong(TAIL)).toBe(ring.producerPosition());
        });
    });

    it('theRecordAlignmentIsTheHeaderLengthAndTheTrailerIsAMultipleOfTheCacheLine', () => {
        expect(ALIGNMENT).toBe(HEADER_LENGTH);
        expect(TRAILER_LENGTH % 64).toBe(0);
    });
});
