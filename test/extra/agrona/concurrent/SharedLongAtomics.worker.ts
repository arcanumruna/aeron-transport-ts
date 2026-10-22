// The worker script of SharedLongAtomicsWorkersExtraTest (run through test/support/Workers.ts): the 64-bit atomics of
// UnsafeBuffer on a SharedArrayBuffer (spec D16). Every loop has a hard iteration cap, so that a bug fails the test
// instead of hanging it.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { TermRebuilder } from '../../../../src/client/logbuffer/TermRebuilder.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';

interface Data {
    kind: string;
    buffer: SharedArrayBuffer;
    workers: number;
    /** byte index of the barrier int */
    barrier: number;
    /** byte index of the long */
    index: number;
    /** byte index of the second long (same-stripe test) */
    index2: number;
    count: number;
    multiplier: number;
    multiplier2: number;
    start: number;
}

const MAX_SPINS = 400_000_000;
const MAX_READS = 400_000_000;
const MAX_SCANS = 5_000_000;
const TWO_POW_32 = 4294967296;

const data = workerData as Data;
const buffer = new UnsafeBuffer(data.buffer);

/** Waits until all the workers have started, so that they contend. */
function barrier(): void {
    buffer.getAndAddInt(data.barrier, 1);
    let spins = 0;
    while (buffer.getIntVolatile(data.barrier) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

/** Writes k * multiplier for k = 1 .. count with putLongRelease: both halves change on every write. */
function patternWriter(): number {
    barrier();
    for (let k = 1; k <= data.count; k++) {
        buffer.putLongRelease(data.index, k * data.multiplier);
    }
    return data.count;
}

interface ReaderResult {
    reads: number;
    violations: number;
    first: string;
    sawFinal: boolean;
}

/** Reads the longs of the patterns until their final values are seen: each is a multiple of its multiplier and never decreases. */
function patternReader(): ReaderResult {
    barrier();
    const indexes = [data.index, data.index2];
    const multipliers = [data.multiplier, data.multiplier2];
    const finals = [data.count * data.multiplier, data.count * data.multiplier2];
    const previous = [0, 0];
    const count = 0 === data.multiplier2 ? 1 : 2;
    let violations = 0;
    let first = '';
    let reads = 0;
    let finalSeen = 0;
    for (; reads < MAX_READS && finalSeen < count; reads++) {
        finalSeen = 0;
        for (let i = 0; i < count; i++) {
            const v = buffer.getLongVolatile(indexes[i]!);
            // v is k * m for a whole k: no fmod here, so that the reader spends its time in the read
            const m = multipliers[i]!;
            if (Math.round(v / m) * m !== v || v < previous[i]!) {
                if (++violations === 1) {
                    first = 'long ' + i + ' read ' + v + ' after ' + previous[i];
                }
            }
            previous[i] = v;
            if (v === finals[i]) {
                finalSeen++;
            }
        }
    }
    return { reads, violations, first, sawFinal: finalSeen === count };
}

/** getAndAddLong(index, 1) count times; the sum of the returned old values. */
function addLong(): number {
    barrier();
    let sum = 0;
    let previous = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.count; i++) {
        const old = buffer.getAndAddLong(data.index, 1);
        if (old <= previous) {
            throw new Error('getAndAddLong returned ' + old + ' after ' + previous);
        }
        previous = old;
        sum += old;
    }
    return sum;
}

/** count compareAndSetLong increments, each retried until it succeeds; the number of failed attempts. */
function casLong(): number {
    barrier();
    let failures = 0;
    for (let i = 0; i < data.count; i++) {
        let attempts = 0;
        for (;;) {
            const value = buffer.getLongVolatile(data.index);
            if (buffer.compareAndSetLong(data.index, value, value + 1)) {
                break;
            }
            failures++;
            if (++attempts > 10_000_000) {
                throw new Error('compareAndSetLong never succeeded');
            }
        }
    }
    return failures;
}

/**
 * Writes k * 2^32 + k for k = 1 .. count, so that the high half of a write is never smaller than its low half. Aeron
 * readers read only the low int of a word (frameLengthVolatile) and then the rest of it: the high half must be visible
 * once the low half is, so a striped write stores the HIGH half first and the LOW half last.
 */
function lowWriter(): number {
    barrier();
    for (let k = 1; k <= data.count; k++) {
        buffer.putLongRelease(data.index, k * TWO_POW_32 + k);
    }
    return data.count;
}

interface LowResult {
    reads: number;
    nonZero: number;
    violations: number;
    first: string;
    sawFinal: boolean;
}

/** lo = getIntVolatile(index), then hi = getIntVolatile(index + 4): whenever lo is not 0, hi >= lo. */
function lowReader(): LowResult {
    barrier();
    let violations = 0;
    let nonZero = 0;
    let first = '';
    let reads = 0;
    for (; reads < MAX_SPINS; reads++) {
        const lo = buffer.getIntVolatile(data.index);
        const hi = buffer.getIntVolatile(data.index + 4);
        if (0 !== lo) {
            nonZero++;
            if (hi < lo && ++violations === 1) {
                first = 'lo=' + lo + ' hi=' + hi;
            }
        }
        if (lo === data.count) {
            return { reads, nonZero, violations, first, sawFinal: true };
        }
    }
    return { reads, nonZero, violations, first, sawFinal: false };
}

const FRAME_LENGTH = 64;
const FRAMES = 4096;

/** Inserts DATA frames with TermRebuilder.insert into a shared term, then clears their lengths and does it again. */
function frameWriter(): number {
    barrier();
    const packet = new UnsafeBuffer(new Uint8Array(FRAME_LENGTH));
    packet.putInt(0, FRAME_LENGTH);
    FrameDescriptor.frameFlags(packet, 0, 0xc0 - 256);
    FrameDescriptor.frameType(packet, 0, HeaderFlyweight.HDR_TYPE_DATA);
    let inserted = 0;
    for (let pass = 0; pass < data.count; pass++) {
        for (let f = 0; f < FRAMES; f++) {
            buffer.putIntVolatile(f * FRAME_LENGTH, 0);
        }
        for (let f = 0; f < FRAMES; f++) {
            TermRebuilder.insert(buffer, f * FRAME_LENGTH, packet, FRAME_LENGTH);
            inserted++;
        }
        buffer.putIntVolatile(FRAMES * FRAME_LENGTH, pass + 1);
    }
    return inserted;
}

interface FrameResult {
    scans: number;
    frames: number;
    violations: number;
    first: string;
}

/** Spins on one frame, for at most this many reads, waiting for the writer to publish its length. */
const FRAME_WAIT_SPINS = 5000;

/**
 * Follows the writer through the term: for each frame it spins on the length until the writer publishes it, and reads
 * the type at once. A frame with a positive length must have the type DATA, never 0 (padding). Spinning on the frame
 * that is being written (the length and the type share a cache line) is what makes a type stored after the length
 * visible to the reader almost every time, where a scan that merely passes by would catch it rarely.
 */
function frameReader(): FrameResult {
    barrier();
    let violations = 0;
    let frames = 0;
    let first = '';
    let scans = 0;
    for (; scans < MAX_SCANS; scans++) {
        const done = buffer.getIntVolatile(FRAMES * FRAME_LENGTH) === data.count;
        for (let f = 0; f < FRAMES; f++) {
            const offset = f * FRAME_LENGTH;
            let length = FrameDescriptor.frameLengthVolatile(buffer, offset);
            for (let spins = 0; 0 === length && spins < FRAME_WAIT_SPINS && !done; spins++) {
                length = FrameDescriptor.frameLengthVolatile(buffer, offset);
            }
            if (length > 0) {
                frames++;
                const type = FrameDescriptor.frameType(buffer, offset);
                if (type !== HeaderFlyweight.HDR_TYPE_DATA && ++violations === 1) {
                    first = 'frame ' + f + ' length ' + length + ' type ' + type;
                }
            }
        }
        if (done) {
            break;
        }
    }
    return { scans, frames, violations, first };
}

const result = (() => {
    switch (data.kind) {
        case 'pattern-writer':
            return patternWriter();
        case 'pattern-reader':
            return patternReader();
        case 'add':
            return addLong();
        case 'cas':
            return casLong();
        case 'low-writer':
            return lowWriter();
        case 'low-reader':
            return lowReader();
        case 'frame-writer':
            return frameWriter();
        case 'frame-reader':
            return frameReader();
        default:
            throw new Error('unknown kind ' + data.kind);
    }
})();

parentPort!.postMessage(result);
