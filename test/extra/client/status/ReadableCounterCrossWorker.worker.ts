// The worker script of ReadableCounterCrossWorkerExtraTest (run through test/support/Workers.ts; issue #24): one worker
// writes a counter with AtomicCounter.set(k * (2^32 + 1)), the other reads it with ReadableCounter.get(). Every loop has
// a hard iteration cap.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { ReadableCounter } from '../../../../src/client/status/ReadableCounter.js';

interface Data {
    kind: 'write' | 'read';
    metadata: SharedArrayBuffer;
    values: SharedArrayBuffer;
    control: SharedArrayBuffer;
    counterId: number;
    writes: number;
    /** The reads that the reader has made when the writer is half way: the two overlap whatever the speed of the host. */
    overlapReads: number;
}

const data = workerData as Data;
const metadata = new UnsafeBuffer(data.metadata);
const values = new UnsafeBuffer(data.values);
const control = new UnsafeBuffer(data.control);
const STARTED = 0;
const READS = 4;
const DONE = 8;
const MAX_SPINS = 400_000_000;
const TWO_32 = 2 ** 32;

function barrier(): void {
    control.getAndAddInt(STARTED, 1);
    for (let spins = 0; control.getIntVolatile(STARTED) < 2; spins++) {
        if (spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

function write(): number {
    const counter = new AtomicCounter(values, data.counterId);
    barrier();
    for (let k = 1; k <= data.writes; k++) {
        counter.set(k * (TWO_32 + 1));
        if (k === data.writes >> 1) {
            for (let spins = 0; control.getIntVolatile(READS) < data.overlapReads; spins++) {
                if (spins > MAX_SPINS) {
                    control.putIntVolatile(DONE, 1);
                    throw new Error('write: the reader made no progress');
                }
            }
        }
    }
    control.putIntVolatile(DONE, 1);
    return data.writes;
}

function read(): { reads: number; torn: number; first: string; distinct: number; last: number } {
    const counter = new ReadableCounter(new CountersManager(metadata, values), data.counterId);
    let reads = 0;
    let torn = 0;
    let first = '';
    let distinct = 0;
    let previous = -1;
    barrier();
    // read until the writer is done, then once more: the last read must see the last write
    for (let done = false; !done && reads < 2_000_000_000;) {
        done = 0 !== control.getIntVolatile(DONE);
        const value = counter.get();
        reads++;
        control.putIntVolatile(READS, reads);
        const high = Math.floor(value / TWO_32);
        const low = value % TWO_32;
        if (high !== low && ++torn === 1) {
            first = 'value ' + value + ' high ' + high + ' low ' + low;
        }
        if (value !== previous) {
            distinct++;
            previous = value;
        }
    }
    return { reads, torn, first, distinct, last: counter.get() };
}

parentPort!.postMessage('write' === data.kind ? write() : read());
