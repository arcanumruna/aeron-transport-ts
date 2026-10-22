// Micro benches of the Agrona ring buffers over a SharedArrayBuffer of 64 KiB (phase 2, T3): write + read and
// tryClaim + commit + read of a 64 byte message in one thread, and four producer workers with one consumer.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { BufferUtil } from '../../src/agrona/BufferUtil.js';
import type { MessageHandler } from '../../src/agrona/concurrent/MessageHandler.js';
import { ManyToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import type { RingBuffer } from '../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { RingBufferDescriptor } from '../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { type Bench, NO_VERDICT_PREFIX, type RunSamples, type SyncBench } from '../lib/types.js';

const CAPACITY = 64 * 1024;
const LENGTH = 64;
const TYPE_ID = 1;
const OPS_PER_SAMPLE = 1_000;

/** Only sums, so that the handler is not what is measured. */
class Sum implements MessageHandler {
    public total = 0;

    public onMessage(msgTypeId: number, _buffer: unknown, _index: number, length: number): void {
        this.total = (this.total + msgTypeId + length) | 0;
    }
}

function newRingBuffer(create: (buffer: UnsafeBuffer) => RingBuffer): RingBuffer {
    return create(new UnsafeBuffer(BufferUtil.allocateShared(CAPACITY + RingBufferDescriptor.TRAILER_LENGTH, 64)));
}

function writeAndRead(name: string, create: (buffer: UnsafeBuffer) => RingBuffer): SyncBench {
    let ring: RingBuffer;
    let src: UnsafeBuffer;
    const sum = new Sum();
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ring = newRingBuffer(create);
            src = new UnsafeBuffer(new Uint8Array(LENGTH));
        },
        op: (i) => {
            src.putInt(0, i);
            if (!ring.write(TYPE_ID, src, 0, LENGTH)) {
                throw new Error('the ring is full');
            }
            ring.read(sum);
        },
    };
}

function claimCommitAndRead(name: string, create: (buffer: UnsafeBuffer) => RingBuffer): SyncBench {
    let ring: RingBuffer;
    const sum = new Sum();
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ring = newRingBuffer(create);
        },
        op: (i) => {
            const index = ring.tryClaim(TYPE_ID, LENGTH);
            if (index <= 0) {
                throw new Error('the ring is full');
            }
            ring.buffer().putInt(index, i);
            ring.commit(index);
            ring.read(sum);
        },
    };
}

/** Up to four producers, and two cores left for the consumer (the main thread) and the rest of the host. */
const PRODUCERS = Math.min(4, availableParallelism() - 2);
const WARM_UP_PER_PRODUCER = 50_000;
const PER_PRODUCER = 250_000;
const MAX_SPINS = 400_000_000;

/**
 * PRODUCERS (at most four) producer workers write 250k messages each to one ring buffer, and the main thread reads. With
 * fewer than three cores there is no producer and the bench gives NO_VERDICT. The throughput is the
 * messages read per second between the start of the measured round and the last message; a sample is the time per
 * message over a window of messages read.
 */
function manyProducers(): Bench {
    return {
        name: 'ManyToOneRingBuffer write 64B (producer workers, 1 consumer, throughput)',
        run: async ({ samples }): Promise<RunSamples> => {
            if (PRODUCERS < 1) {
                throw new Error(
                    NO_VERDICT_PREFIX + 'the host has ' + availableParallelism() + ' cores; the bench needs at least 3',
                );
            }
            const buffer = BufferUtil.allocateShared(CAPACITY + RingBufferDescriptor.TRAILER_LENGTH, 64);
            const control = new SharedArrayBuffer(64);
            const controlView = new Int32Array(control);
            const ring = new ManyToOneRingBuffer(new UnsafeBuffer(buffer));
            const registerUrl = new URL('../../test/support/workerRegister.mjs', import.meta.url).href;
            const script = new URL('./ringbuffer.worker.ts', import.meta.url);

            const workers: Worker[] = [];
            const done: Promise<unknown>[] = [];
            for (let id = 0; id < PRODUCERS; id++) {
                const worker = new Worker(script, {
                    workerData: {
                        buffer,
                        control,
                        workers: PRODUCERS + 1,
                        warmUp: WARM_UP_PER_PRODUCER,
                        count: PER_PRODUCER,
                        length: LENGTH,
                    },
                    execArgv: ['--import', registerUrl, '--no-warnings'],
                });
                workers.push(worker);
                done.push(
                    new Promise((resolve, reject) => {
                        worker.once('message', resolve);
                        worker.once('error', reject);
                    }),
                );
            }

            let consumed = 0;
            const handler: MessageHandler = {
                onMessage: () => {
                    consumed++;
                },
            };
            const barrier = (index: number): void => {
                Atomics.add(controlView, index, 1);
                let spins = 0;
                while (Atomics.load(controlView, index) < PRODUCERS + 1) {
                    if (++spins > MAX_SPINS) {
                        throw new Error('barrier: the producers did not start');
                    }
                }
            };
            const consume = (until: number, window: number, windows: Float64Array | null): number => {
                let idle = 0;
                let marked = consumed;
                let windowStart = performance.now();
                let n = 0;
                while (consumed < until) {
                    if (0 === ring.read(handler, 256)) {
                        if (++idle > MAX_SPINS) {
                            throw new Error('the producers stopped after ' + consumed + ' messages');
                        }
                    } else {
                        idle = 0;
                        if (null !== windows && consumed - marked >= window) {
                            const now = performance.now();
                            windows[n++] = ((now - windowStart) * 1e6) / (consumed - marked);
                            windowStart = now;
                            marked = consumed;
                        }
                    }
                }
                return n;
            };

            try {
                barrier(0);
                consume(PRODUCERS * WARM_UP_PER_PRODUCER, 0, null);

                const total = PRODUCERS * PER_PRODUCER;
                const window = Math.max(1, Math.floor(total / samples));
                const windows = new Float64Array(Math.ceil(total / window) + 1);
                barrier(1);
                const t0 = performance.now();
                const n = consume(PRODUCERS * WARM_UP_PER_PRODUCER + total, window, windows);
                const elapsedMs = performance.now() - t0;

                await Promise.all(done);
                return { samplesNsPerOp: Array.from(windows.subarray(0, n)), totalOps: total, elapsedMs };
            } finally {
                // every producer has finished and posted its result here, or the bench is failing and the process ends
                await Promise.all(workers.map((w) => w.terminate()));
            }
        },
    };
}

export const benches: Bench[] = [
    writeAndRead('OneToOneRingBuffer write+read 64B', (b) => new OneToOneRingBuffer(b)),
    claimCommitAndRead('OneToOneRingBuffer tryClaim+commit+read 64B', (b) => new OneToOneRingBuffer(b)),
    writeAndRead('ManyToOneRingBuffer write+read 64B (1 producer)', (b) => new ManyToOneRingBuffer(b)),
    claimCommitAndRead('ManyToOneRingBuffer tryClaim+commit+read 64B (1 producer)', (b) => new ManyToOneRingBuffer(b)),
    manyProducers(),
];
