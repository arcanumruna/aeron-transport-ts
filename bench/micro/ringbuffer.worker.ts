// The producer worker of the many-to-one ring buffer bench (ringbuffer.bench.ts). It writes a warm-up round and then the
// measured round of 64 byte messages, each round after a barrier that the consumer (the main thread) joins. Every loop
// has a hard iteration cap.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ManyToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';

interface Data {
    buffer: SharedArrayBuffer;
    control: SharedArrayBuffer;
    /** Producers and the consumer. */
    workers: number;
    warmUp: number;
    count: number;
    length: number;
}

const MAX_SPINS = 400_000_000;

const data = workerData as Data;
const ring = new ManyToOneRingBuffer(new UnsafeBuffer(data.buffer));
const control = new Int32Array(data.control);
const src = new UnsafeBuffer(new Uint8Array(data.length));

function barrier(index: number): void {
    Atomics.add(control, index, 1);
    let spins = 0;
    while (Atomics.load(control, index) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

function write(count: number): void {
    for (let i = 0; i < count; i++) {
        src.putInt(0, i);
        let spins = 0;
        while (!ring.write(1, src, 0, data.length)) {
            if (++spins > MAX_SPINS) {
                throw new Error('write: the ring stayed full');
            }
            // a short park once in a while, so that a loaded host lets the consumer run
            if (0 === (spins & 1023)) {
                Atomics.wait(control, 15, 0, 0.01);
            }
        }
    }
}

barrier(0);
write(data.warmUp);
barrier(1);
write(data.count);

parentPort!.postMessage(data.count);
