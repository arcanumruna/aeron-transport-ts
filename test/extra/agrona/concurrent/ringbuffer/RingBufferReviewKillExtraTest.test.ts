// Tests the port adds (T3 review kill tests): behaviour the Java tests leave unpinned, each killing a mutant that
// survives the ported suites. Target path: test/extra/agrona/concurrent/ringbuffer/RingBufferReviewKillExtraTest.test.ts
import { describe, expect, it } from 'vitest';
import { ControlledMessageHandler } from '../../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import type { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { RingBufferDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { mockUnsafeBuffer, when } from '../../../../support/MockBuffer.js';

const { HEAD_CACHE_POSITION_OFFSET, HEAD_POSITION_OFFSET, TAIL_POSITION_OFFSET, TRAILER_LENGTH } = RingBufferDescriptor;
const CAPACITY = 4096;
const HEAD = CAPACITY + HEAD_POSITION_OFFSET;
const TAIL = CAPACITY + TAIL_POSITION_OFFSET;

describe.each([
    ['many-to-one', (b: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(b)],
    ['one-to-one', (b: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(b)],
] as const)('RingBufferReviewKillExtraTest %s', (_name, create) => {
    it('sizeRereadsTheTailWhenTheHeadMovedDuringTheReadRegression', () => {
        const mocked = mockUnsafeBuffer();
        when(mocked.spies.capacity).thenReturn(CAPACITY + TRAILER_LENGTH);
        const ring = create(mocked.buffer);
        // head 0, then the consumer moves it to 64 between the two head reads; the tail read in between (32) is stale
        when(mocked.spies.getLongVolatile, HEAD).thenReturn(0, 64, 64);
        when(mocked.spies.getLongVolatile, TAIL).thenReturn(32, 128);

        // Java: loop again with head 64 and tail 128. Without the loop, 32 - 64 < 0 gives 0.
        expect(ring.size()).toBe(64);
        expect(mocked.spies.getLongVolatile).toHaveBeenCalledTimes(5);
    });
});

describe('RingBufferReviewKillExtraTest many-to-one unblock', () => {
    it('unblockScansOnlyUpToTheProducerIndexWhenItIsAheadOfTheConsumerRegression', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(CAPACITY + TRAILER_LENGTH));
        const ring = new ManyToOneRingBuffer(buffer);
        // a producer claimed [0, 64) and has not yet written its header; bytes past the tail are not part of the ring
        buffer.putLong(TAIL, 64);
        buffer.putInt(128, 99);

        // Java: the forward scan stops at producerIndex (64) and finds only zeros, so there is nothing to unblock.
        // Scanning to the capacity would find the int at 128 and pad [0, 128) over the in-flight claim.
        expect(ring.unblock()).toBe(false);
        expect(buffer.getInt(0)).toBe(0);
        expect(buffer.getInt(4)).toBe(0);
    });
});

describe('RingBufferReviewKillExtraTest many-to-one controlledRead', () => {
    it('controlledReadZeroesEveryCommittedRecordRegression', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(CAPACITY + TRAILER_LENGTH));
        const ring = new ManyToOneRingBuffer(buffer);
        const src = new UnsafeBuffer(new Uint8Array(64).fill(0xab));
        expect(ring.write(3, src, 0, 40)).toBe(true);
        expect(ring.write(3, src, 0, 24)).toBe(true);
        const used = ring.producerPosition();

        const handler: ControlledMessageHandler = { onMessage: () => ControlledMessageHandler.Action.COMMIT };
        expect(ring.controlledRead(handler)).toBe(2);
        expect(ring.consumerPosition()).toBe(used);

        // Java zeroes [headIndex, headIndex + bytesRead) at each COMMIT, as unblock and the next lap rely on zeros
        for (let i = 0; i < used; i += 4) {
            expect(buffer.getInt(i), 'int at ' + i).toBe(0);
        }
    });
});

describe('RingBufferReviewKillExtraTest many-to-one unblock race', () => {
    it('unblockDoesNotPadWhenTheConsumerSlotIsWrittenDuringTheScanRegression', () => {
        const mocked = mockUnsafeBuffer();
        when(mocked.spies.capacity).thenReturn(CAPACITY + TRAILER_LENGTH);
        const ring = new ManyToOneRingBuffer(mocked.buffer);
        when(mocked.spies.getLongVolatile, HEAD).thenReturn(0);
        when(mocked.spies.getLongVolatile, TAIL).thenReturn(64);
        // the consumer slot reads 0, then its producer writes the in-progress length before the scan back reaches it
        when(mocked.spies.getIntVolatile, 0).thenReturn(0, -16);
        when(mocked.spies.getIntVolatile, 8).thenReturn(-16);

        // Java's scanBackToConfirmStillZeroed checks down to and including the consumer index (i >= limit)
        expect(ring.unblock()).toBe(false);
        expect(mocked.spies.putIntRelease).not.toHaveBeenCalled();
    });
});

describe.each([
    ['many-to-one', (b: UnsafeBuffer): RingBuffer => new ManyToOneRingBuffer(b)],
    ['one-to-one', (b: UnsafeBuffer): RingBuffer => new OneToOneRingBuffer(b)],
] as const)('RingBufferReviewKillExtraTest %s large capacity', (_name, create) => {
    it('aRingOf2Pow17IndexesPast64KiBWithPositionsPast2Pow33Regression', () => {
        const capacity = 1 << 17;
        const buffer = new UnsafeBuffer(new ArrayBuffer(capacity + TRAILER_LENGTH));
        const start = 2 ** 33 + 70_000; // index 70000: past 0xffff
        for (const offset of [TAIL_POSITION_OFFSET, HEAD_POSITION_OFFSET, HEAD_CACHE_POSITION_OFFSET]) {
            buffer.putLong(capacity + offset, start);
        }
        const ring = create(buffer);
        const src = new UnsafeBuffer(new Uint8Array(16));
        src.putInt(0, 0x1234567);
        expect(ring.write(9, src, 0, 16)).toBe(true);
        expect(buffer.getInt(70_000)).toBe(24);

        const seen: number[] = [];
        expect(ring.read({ onMessage: (type, b, index) => void seen.push(type, index, b.getInt(index)) })).toBe(1);
        expect(seen).toEqual([9, 70_008, 0x1234567]);
        expect(ring.consumerPosition()).toBe(start + 24);
        expect(ring.size()).toBe(0);
    });
});
