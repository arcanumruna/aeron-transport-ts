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
const DONE = 2056;
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

/** Adds beyond which the adder stops, whatever the rotator does (a hard cap on the loop). */
const MAX_ADDS = 5_000_000;
/** Offset within a term (20 bits) beyond which the adder waits for the rotation, so that it never carries into the term. */
const WAIT_OFFSET = 0xc0000;

/**
 * getAndAddRawTailOffset(+32) until the rotator sets DONE (at most MAX_ADDS times), counting the torn (term id, term
 * offset) pairs inline: the offset of a pair must carry its term id in bits 20 and up, as the rotator packs them.
 */
function add(): { adds: number; torn: number; first: string } {
    const holder = new Int32Array(1);
    const slot = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + 8 * data.partition;
    let torn = 0;
    let first = '';
    let adds = 0;
    barrier();
    while (0 === buffer.getIntVolatile(DONE) && adds < MAX_ADDS) {
        const offset = LogBufferDescriptor.getAndAddRawTailOffset(buffer, slot, 32, holder);
        const termId = holder[0]!;
        adds++;
        if (offset >>> 20 !== termId && ++torn === 1) {
            first = 'termId ' + termId + ' offset ' + offset;
        }
        if ((offset & 0xfffff) > WAIT_OFFSET) {
            // the rotator has to catch up: wait (capped) for the next term
            for (let spins = 0; spins < MAX_SPINS; spins++) {
                if (
                    LogBufferDescriptor.rawTailTermId(buffer, data.partition) !== termId ||
                    0 !== buffer.getIntVolatile(DONE)
                ) {
                    break;
                }
            }
        }
    }
    return { adds, torn, first };
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
                buffer.putIntVolatile(DONE, 1);
                throw new Error('casRawTail never succeeded');
            }
        }
    }
    buffer.putIntVolatile(DONE, 1);
    return failures;
}

parentPort!.postMessage('add' === data.kind ? add() : rotate());
