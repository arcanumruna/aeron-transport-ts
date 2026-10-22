// The worker script of RawTailAtomicityExtraTest (run through test/support/Workers.ts): producers add to a raw tail and
// the rotating thread CASes it (spec D12, D16). Every loop has a hard iteration cap.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';

interface Data {
    kind: 'add' | 'rotate';
    buffer: SharedArrayBuffer;
    partition: number;
    count: number;
}

const data = workerData as Data;
const buffer = new UnsafeBuffer(data.buffer);
const BARRIER = 2048;
const MAX_SPINS = 400_000_000;
/** The raw tail with the unsigned 32 bit `low` (packTail sign-extends a negative int offset, as Java does). */
function raw(termId: number, low: number): bigint {
    return BigInt.asIntN(64, (BigInt(termId) << 32n) | BigInt(low >>> 0));
}

const MAX_CAS_ATTEMPTS = 1_000_000;

function barrier(): void {
    buffer.getAndAddInt(BARRIER, 1);
    let spins = 0;
    while (buffer.getIntVolatile(BARRIER) < 2) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

/** count getAndAddRawTailOffset(+32), recording the (term id, term offset) of each. */
function add(): { termIds: Int32Array; offsets: Float64Array } {
    const termIds = new Int32Array(data.count);
    const offsets = new Float64Array(data.count);
    const holder = new Int32Array(1);
    const slot = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + 8 * data.partition;
    barrier();
    for (let i = 0; i < data.count; i++) {
        offsets[i] = LogBufferDescriptor.getAndAddRawTailOffset(buffer, slot, 32, holder);
        termIds[i] = holder[0]!;
    }
    return { termIds, offsets };
}

/** count rotations: raw tail (t, any) -> (t + 1, (t + 1) << 20) with casRawTail; returns the failed CASes. */
function rotate(): number {
    let failures = 0;
    barrier();
    for (let i = 0; i < data.count; i++) {
        let attempts = 0;
        for (;;) {
            const current = LogBufferDescriptor.rawTailVolatile(buffer, data.partition);
            const t = LogBufferDescriptor.termId(current);
            if (LogBufferDescriptor.casRawTail(buffer, data.partition, current, raw(t + 1, (t + 1) << 20))) {
                break;
            }
            failures++;
            if (++attempts > MAX_CAS_ATTEMPTS) {
                throw new Error('casRawTail never succeeded');
            }
        }
    }
    return failures;
}

parentPort!.postMessage('add' === data.kind ? add() : rotate());
