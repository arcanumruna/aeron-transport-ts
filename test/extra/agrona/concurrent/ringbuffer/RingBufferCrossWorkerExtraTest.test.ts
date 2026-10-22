// Tests the port adds (spec D16, 8.2): the ring buffers over a SharedArrayBuffer, across worker_threads. The Java tests
// are single threaded, so nothing else exercises the Atomics paths of the ring buffers concurrently.
import { describe, expect, it } from 'vitest';
import { BufferUtil } from '../../../../../src/agrona/BufferUtil.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import { RingBufferDescriptor } from '../../../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import type { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { runWorkers } from '../../../../support/Workers.js';
import { indexOf, PASS_LENGTH, PASSES, valueAt } from '../SharedAtomicsLayout.js';
import {
    abortedCount,
    type ConsumerResult,
    HEARTBEAT_DONE,
    HEARTBEAT_PROGRESS,
    type ProducerResult,
    RING_CAPACITY,
    type RingBufferWorkerData,
} from './RingBufferLayout.js';

const SCRIPT = new URL('./RingBuffer.worker.ts', import.meta.url);
const TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 30_000;
const SEED = 0x5eed1234;

const PRODUCERS = 4;
/**
 * Messages per producer. The plan asks for 4 x 250k with many producers; that takes about 30 s of the file here, so the
 * four producers write 100k each (400k messages), and the one producer of the one-to-one ring 250k. The claim variants
 * run 100k as well: a claim and a commit cost more than a write.
 */
const PER_PRODUCER_MANY = 100_000;
const PER_PRODUCER_ONE = 250_000;
const PER_PRODUCER_CLAIM = 100_000;

/** The positions of the boundary runs: 64 KiB below 2^32, so that they cross it during the run. */
const BELOW_2_POW_32 = 2 ** 32 - 65536;

type Kind = RingBufferWorkerData['ring'];

function newRing(kind: Kind, sab: SharedArrayBuffer): RingBuffer {
    const buffer = new UnsafeBuffer(sab);
    return 'many-to-one' === kind ? new ManyToOneRingBuffer(buffer) : new OneToOneRingBuffer(buffer);
}

function newShared(): SharedArrayBuffer {
    return BufferUtil.allocateShared(RING_CAPACITY + RingBufferDescriptor.TRAILER_LENGTH, 64);
}

/** Starts the head, the tail and the head cache at `position`, written as the low `int` of their slot. */
function startAt(sab: SharedArrayBuffer, position: number): void {
    const buffer = new UnsafeBuffer(sab);
    buffer.putLong(RING_CAPACITY + RingBufferDescriptor.TAIL_POSITION_OFFSET, position);
    buffer.putLong(RING_CAPACITY + RingBufferDescriptor.HEAD_POSITION_OFFSET, position);
    buffer.putLong(RING_CAPACITY + RingBufferDescriptor.HEAD_CACHE_POSITION_OFFSET, position);
}

interface Stress {
    ring: Kind;
    producers: number;
    perProducer: number;
    claim: boolean;
    /** Where the positions start; 0 when omitted. */
    start?: number;
}

/** `producers` workers write `perProducer` seeded messages each to one ring, and one worker reads them all. */
async function stress(options: Stress): Promise<{ sab: SharedArrayBuffer; consumer: ConsumerResult; retries: number }> {
    const sab = newShared();
    const control = new SharedArrayBuffer(16);
    const start = options.start ?? 0;
    startAt(sab, start);

    const workers = options.producers + 1;
    const base = {
        ring: options.ring,
        buffer: sab,
        control,
        workers,
        seed: SEED,
        producers: options.producers,
        perProducer: options.perProducer,
        claim: options.claim,
        iterations: 0,
    };
    const results = await runWorkers(
        SCRIPT,
        [
            { ...base, kind: 'consumer', id: -1 },
            ...Array.from({ length: options.producers }, (_, id) => ({ ...base, kind: 'producer', id })),
        ],
        TIMEOUT_MS,
    );

    const consumer = results[0] as ConsumerResult;
    let total = 0;
    for (let p = 0; p < options.producers; p++) {
        total += options.perProducer - (options.claim ? abortedCount(SEED, p, options.perProducer) : 0);
    }
    expect(consumer.error).toBeNull();
    expect(consumer.delivered).toBe(total);

    const ring = newRing(options.ring, sab);
    // the consumer stops at its last message, and the aborted claims after it are padding that it has not read yet
    expect(ring.read({ onMessage: () => expect.fail('a message after the last') })).toBe(0);
    expect(ring.producerPosition()).toBe(ring.consumerPosition());
    expect(ring.size()).toBe(0);
    if (0 !== start) {
        // the positions went at least 64 KiB past where they started, over 2^32
        expect(ring.consumerPosition()).toBeGreaterThan(start + 65536);
        expect(ring.consumerPosition()).toBeGreaterThan(2 ** 32);
    }
    const retries = (results.slice(1) as ProducerResult[]).reduce((sum, r) => sum + r.retries, 0);
    return { sab, consumer, retries };
}

describe('RingBufferCrossWorkerExtraTest', () => {
    describe.each([
        ['many-to-one', PRODUCERS, PER_PRODUCER_MANY],
        ['one-to-one', 1, PER_PRODUCER_ONE],
    ] as const)('%s', (ring, producers, perProducer) => {
        it(
            'everyMessageArrivesOnceInProducerOrderWithItsBytesIntact',
            async () => {
                const { retries } = await stress({ ring, producers, perProducer, claim: false });

                // the ring (4 KiB) is much smaller than the traffic, so the producers did wait for the consumer
                expect(retries).toBeGreaterThan(0);
            },
            TEST_TIMEOUT_MS,
        );

        it(
            'everyMessageArrivesOnceWhenThePositionsCross2Pow32',
            async () => {
                const start = BELOW_2_POW_32;
                await stress({ ring, producers, perProducer, claim: false, start });
            },
            TEST_TIMEOUT_MS,
        );

        it(
            'claimedMessagesArriveOnceAndAbortedOnesNeverArrive',
            async () => {
                await stress({ ring, producers, perProducer: PER_PRODUCER_CLAIM, claim: true });
            },
            TEST_TIMEOUT_MS,
        );

        it(
            'claimedMessagesArriveOnceAndAbortedOnesNeverArriveWhenThePositionsCross2Pow32',
            async () => {
                const start = BELOW_2_POW_32;
                await stress({ ring, producers, perProducer: PER_PRODUCER_CLAIM, claim: true, start });
            },
            TEST_TIMEOUT_MS,
        );
    });

    it(
        'theConsumerGetsPastAProducerThatDiedBetweenClaimAndCommitAfterUnblock',
        async () => {
            const sab = newShared();
            const control = new SharedArrayBuffer(16);
            const base = {
                ring: 'many-to-one' as const,
                buffer: sab,
                control,
                workers: 1,
                seed: SEED,
                producers: 1,
                perProducer: 0,
                claim: false,
            };
            const ring = newRing('many-to-one', sab);
            const scratch = new UnsafeBuffer(new Uint8Array(64));

            // two messages, then a claim of a worker that exits without committing it, then three more
            expect(ring.write(1, scratch, 0, 16)).toBe(true);
            expect(ring.write(1, scratch, 0, 24)).toBe(true);
            const [claimed] = (await runWorkers(
                SCRIPT,
                [{ ...base, kind: 'claim-and-exit', id: 8, iterations: 40 }],
                TIMEOUT_MS,
            )) as [{ index: number }];
            expect(claimed.index).toBeGreaterThan(0);
            expect(ring.write(2, scratch, 0, 8)).toBe(true);
            expect(ring.write(2, scratch, 0, 0)).toBe(true);
            expect(ring.write(2, scratch, 0, 32)).toBe(true);

            const lengths: number[] = [];
            const handler = {
                onMessage: (_type: number, _buffer: unknown, _index: number, length: number) =>
                    void lengths.push(length),
            };
            // the consumer reads the two messages before the claim and is stuck at it
            expect(ring.read(handler)).toBe(2);
            expect(ring.read(handler)).toBe(0);
            expect(lengths).toEqual([16, 24]);
            expect(ring.size()).toBeGreaterThan(0);

            expect(ring.unblock()).toBe(true);
            expect(ring.read(handler)).toBe(3);
            expect(lengths).toEqual([16, 24, 8, 0, 32]);
            expect(ring.size()).toBe(0);
            expect(ring.unblock()).toBe(false);

            // and later messages from other workers arrive, in order, in the same ring
            const start = ring.consumerPosition();
            const control2 = new SharedArrayBuffer(16);
            const later = { ...base, control: control2, workers: 4, producers: 3, perProducer: 20_000 };
            const results = await runWorkers(
                SCRIPT,
                [
                    { ...later, kind: 'consumer', id: -1 },
                    ...[0, 1, 2].map((id) => ({ ...later, kind: 'producer', id })),
                ],
                TIMEOUT_MS,
            );
            expect((results[0] as ConsumerResult).error).toBeNull();
            expect((results[0] as ConsumerResult).delivered).toBe(3 * 20_000);
            expect(ring.producerPosition()).toBe(ring.consumerPosition());
            expect((ring.consumerPosition() - start) | 0).toBeGreaterThan(0);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'nextCorrelationIdFromFourWorkersGivesEveryIdOnce',
        async () => {
            const sab = newShared();
            const control = new SharedArrayBuffer(16);
            const per = 5_000;
            const base = {
                ring: 'many-to-one' as const,
                buffer: sab,
                control,
                workers: PRODUCERS,
                seed: SEED,
                producers: 1,
                perProducer: 0,
                claim: false,
                iterations: per,
            };
            const results = (await runWorkers(
                SCRIPT,
                Array.from({ length: PRODUCERS }, (_, id) => ({ ...base, kind: 'correlation', id })),
                TIMEOUT_MS,
            )) as number[][];

            const seen = new Set<number>();
            for (const ids of results) {
                for (let i = 1; i < ids.length; i++) {
                    expect(ids[i] as number).toBeGreaterThan(ids[i - 1] as number);
                }
                ids.forEach((id) => seen.add(id));
            }
            expect(seen.size).toBe(PRODUCERS * per);
            for (let id = 0; id < PRODUCERS * per; id++) {
                expect(seen.has(id), 'id ' + id).toBe(true);
            }
            expect(newRing('many-to-one', sab).nextCorrelationId()).toBe(PRODUCERS * per);
        },
        TEST_TIMEOUT_MS,
    );

    it(
        'theConsumerHeartbeatReadFromTheMainThreadIsNeverTornAcrossEvery2Pow32BoundaryBelow2Pow40',
        async () => {
            const sab = newShared();
            const control = new SharedArrayBuffer(16);
            const reader = newRing('many-to-one', sab);
            const buffer = reader.buffer();
            const done = runWorkers(
                SCRIPT,
                [
                    {
                        kind: 'heartbeat-writer',
                        ring: 'many-to-one',
                        buffer: sab,
                        control,
                        workers: 1,
                        seed: SEED,
                        id: 0,
                        producers: 0,
                        perProducer: 0,
                        claim: false,
                        iterations: 0,
                    },
                ],
                TIMEOUT_MS,
            );

            // the same progress window check as SharedAtomicsExtraTest: the value read is one the writer wrote at a position
            // from the last write that was complete before the read to the one that may have been under way after it
            let reads = 0;
            let torn = 0;
            let firstTorn = '';
            let finished = false;
            for (let spins = 0; spins < 400_000_000 && !finished; spins++) {
                finished = 0 !== buffer.getIntVolatile(HEARTBEAT_DONE);
                const before = buffer.getIntVolatile(HEARTBEAT_PROGRESS);
                const value = reader.consumerHeartbeatTime();
                const after = buffer.getIntVolatile(HEARTBEAT_PROGRESS);
                reads++;

                const first = Math.max(before - 1, 0);
                const index = indexOf(value);
                let valid = index >= 0;
                if (valid) {
                    const position = first + ((((index - first) % PASS_LENGTH) + PASS_LENGTH) % PASS_LENGTH);
                    valid = position <= after;
                }
                if (!valid && ++torn === 1) {
                    firstTorn = value + ' (progress ' + before + ' .. ' + after + ')';
                }
            }

            const [written] = (await done) as [number];
            expect(finished).toBe(true);
            expect(written).toBe(PASSES * PASS_LENGTH);
            expect(torn, firstTorn).toBe(0);
            expect(reads).toBeGreaterThan(0);
            expect(reader.consumerHeartbeatTime()).toBe(valueAt(PASS_LENGTH - 1));
        },
        TEST_TIMEOUT_MS,
    );
});
