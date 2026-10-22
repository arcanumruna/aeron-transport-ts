// The worker script of SharedAtomicsExtraTest (run through test/support/Workers.ts). One script, one `kind` per role.
// Every loop has a hard iteration cap, so that a bug fails the test instead of hanging it.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import {
    BARRIER,
    COUNTER,
    DONE,
    indexOf,
    PASS_LENGTH,
    PASSES,
    PROGRESS,
    SEQ,
    SHORT_SLOTS,
    VALUE,
    valueAt,
} from './SharedAtomicsLayout.js';

interface Data {
    kind: 'cas-int' | 'add-int' | 'short' | 'seq-writer' | 'seq-reader';
    buffer: SharedArrayBuffer;
    workers: number;
    id: number;
    iterations: number;
}

const MAX_SPINS = 400_000_000;

const data = workerData as Data;
const buffer = new UnsafeBuffer(data.buffer);

/** Waits until all the workers have started, so that they contend. */
function barrier(): void {
    buffer.getAndAddInt(BARRIER, 1);
    let spins = 0;
    while (buffer.getIntVolatile(BARRIER) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

function casInt(): number {
    barrier();
    let failures = 0;
    for (let i = 0; i < data.iterations; i++) {
        let attempts = 0;
        for (;;) {
            const value = buffer.getIntVolatile(COUNTER);
            if (buffer.compareAndSetInt(COUNTER, value, value + 1)) {
                break;
            }
            failures++;
            if (++attempts > MAX_SPINS) {
                throw new Error('compareAndSetInt never succeeded');
            }
        }
    }
    return failures;
}

function addInt(): number {
    barrier();
    let previous = -1;
    for (let i = 0; i < data.iterations; i++) {
        const old = buffer.getAndAddInt(COUNTER, 1);
        if (old <= previous) {
            throw new Error('getAndAddInt returned ' + old + ' after ' + previous);
        }
        previous = old;
    }
    return previous;
}

/** Each worker owns one short of the same 8 bytes: an atomic short must never write its neighbours. */
function shortSlots(): number {
    const index = SHORT_SLOTS + 2 * data.id;
    barrier();
    let last = 0;
    for (let i = 1; i <= data.iterations; i++) {
        last = (i * 7 + data.id) & 0x7fff;
        buffer.putShortVolatile(index, last);
        const read = buffer.getShortVolatile(index);
        if (read !== last) {
            throw new Error('short slot ' + data.id + ' read ' + read + ' after writing ' + last);
        }
    }
    return last;
}

function seqWriter(): number {
    barrier();
    let n = 0;
    for (let pass = 0; pass < PASSES; pass++) {
        for (let i = 0; i < PASS_LENGTH; i++) {
            buffer.putLongReleaseSeq(VALUE, valueAt(i), SEQ);
            buffer.putIntOrdered(PROGRESS, ++n);
        }
    }
    buffer.putIntVolatile(DONE, 1);
    return n;
}

interface ReaderResult {
    reads: number;
    torn: number;
    firstTorn: string;
}

function seqReader(): ReaderResult {
    barrier();
    let reads = 0;
    let torn = 0;
    let firstTorn = '';
    for (let spins = 0; spins < MAX_SPINS; spins++) {
        const done = 0 !== buffer.getIntVolatile(DONE);
        const before = buffer.getIntVolatile(PROGRESS);
        const value = buffer.getLongVolatileSeq(VALUE, SEQ);
        const after = buffer.getIntVolatile(PROGRESS);
        reads++;

        // the value is one the writer wrote at a position from the last write that was complete before the read to the
        // one that may have been under way after it
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

        if (done) {
            break;
        }
    }
    return { reads, torn, firstTorn };
}

const result = (() => {
    switch (data.kind) {
        case 'cas-int':
            return casInt();
        case 'add-int':
            return addInt();
        case 'short':
            return shortSlots();
        case 'seq-writer':
            return seqWriter();
        case 'seq-reader':
            return seqReader();
    }
})();

parentPort!.postMessage(result);
