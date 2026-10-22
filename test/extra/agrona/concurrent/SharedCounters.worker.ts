// The worker script of SharedCountersExtraTest (run through test/support/Workers.ts): an AtomicCounter on a shared
// counters buffer (spec D16). Every loop has a hard iteration cap, so that a bug fails the test instead of hanging it.
import { parentPort, workerData } from 'node:worker_threads';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BARRIER, COUNTER_ID, DONE, READERS, START, WRITES } from './SharedCountersLayout.js';

interface Data {
    kind: 'writer' | 'position' | 'reader' | 'counter';
    buffer: SharedArrayBuffer;
}

const MAX_SPINS = 400_000_000;

const data = workerData as Data;
const buffer = new UnsafeBuffer(data.buffer);

/** Waits until the writer and the readers have started, so that they overlap. */
function barrier(): void {
    buffer.getAndAddInt(BARRIER, 1);
    let spins = 0;
    while (buffer.getIntVolatile(BARRIER) < 1 + READERS) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

function writer(): number {
    const counter = new AtomicCounter(buffer, COUNTER_ID);
    barrier();
    for (let i = 0; i < WRITES; i++) {
        counter.increment();
    }
    buffer.putIntVolatile(DONE, 1);
    return WRITES;
}

interface ReaderResult {
    reads: number;
    bad: number;
    firstBad: string;
    last: number;
}

/** Reads until the final value is seen: never torn (inside [START, START + WRITES]) and never decreasing. */
function reader(read: () => number): ReaderResult {
    barrier();
    let reads = 0;
    let bad = 0;
    let firstBad = '';
    let previous = START;
    for (let spins = 0; spins < MAX_SPINS; spins++) {
        const value = read();
        reads++;
        if (value < previous || value > START + WRITES) {
            if (++bad === 1) {
                firstBad = value + ' after ' + previous;
            }
        }
        previous = value;
        if (START + WRITES === value) {
            break;
        }
    }
    return { reads, bad, firstBad, last: previous };
}

const result = (() => {
    switch (data.kind) {
        case 'writer':
            return writer();
        case 'position': {
            const position = new UnsafeBufferPosition(buffer, COUNTER_ID);
            return reader(() => position.getVolatile());
        }
        case 'reader': {
            const counters = new CountersReader(
                new UnsafeBuffer(new Uint8Array(2 * CountersReader.METADATA_LENGTH)),
                buffer,
            );
            return reader(() => counters.getCounterValue(COUNTER_ID));
        }
        case 'counter': {
            const counter = new AtomicCounter(buffer, COUNTER_ID);
            return reader(() => counter.get());
        }
    }
})();

parentPort!.postMessage(result);
