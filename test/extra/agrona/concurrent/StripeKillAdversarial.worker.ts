// Kill-test worker (review of T2b): striped 64-bit writes that the main thread may terminate at any instant, and
// halves writers for the low-half-last rule.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';

interface Data {
    kind: string;
    buffer: SharedArrayBuffer;
    index: number;
    count: number;
    barrier: number;
    workers: number;
    /** probe: the spin cap to lower to, so that the dead-holder rule fires quickly */
    spinCap?: number;
}
const data = workerData as Data;
const buffer = new UnsafeBuffer(data.buffer);
const MAX_SPINS = 400_000_000;

function barrier(): void {
    buffer.getAndAddInt(data.barrier, 1);
    let spins = 0;
    while (buffer.getIntVolatile(data.barrier) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier');
        }
    }
}

function spinWriter(): number {
    parentPort!.postMessage('started');
    let k = 0;
    for (let i = 0; i < data.count; i++) {
        buffer.putLongRelease(data.index, (i & 0xffff) * 4294967296 + i);
        k = (k + buffer.getAndAddLong(data.index + 8, 1)) | 0;
        buffer.compareAndSetLong(data.index + 16, i - 1, i);
    }
    return k;
}

function halvesWriter(): number {
    barrier();
    const out = new Int32Array(2);
    for (let k = 1; k <= data.count; k++) {
        switch (k % 3) {
            case 0:
                buffer.putLongVolatileHalves(data.index, k, k);
                break;
            case 1:
                buffer.getLongVolatileHalves(data.index, out);
                buffer.compareAndSetLongHalves(data.index, out[0]!, out[1]!, k, k);
                break;
            default:
                // a carry: (k - (2^31 - 1), k - 1) + (2^31 - 1) = (k, k); the high half must be stored first
                buffer.putLongVolatileHalves(data.index, (k - 0x7fffffff) | 0, k - 1);
                buffer.getAndAddLongHalves(data.index, 0x7fffffff, out);
                break;
        }
    }
    return data.count;
}

function lowReader(): { nonZero: number; violations: number; first: string } {
    barrier();
    let violations = 0;
    let nonZero = 0;
    let first = '';
    for (let reads = 0; reads < MAX_SPINS; reads++) {
        const lo = buffer.getIntVolatile(data.index);
        const hi = buffer.getIntVolatile(data.index + 4);
        if (0 !== lo) {
            nonZero++;
            if (hi < lo && ++violations === 1) {
                first = 'lo=' + lo + ' hi=' + hi;
            }
        }
        if (lo === data.count) {
            break;
        }
    }
    return { nonZero, violations, first };
}

const result =
    'spin-writer' === data.kind ? spinWriter() : 'halves-writer' === data.kind ? halvesWriter() : lowReader();
parentPort!.postMessage(result);
