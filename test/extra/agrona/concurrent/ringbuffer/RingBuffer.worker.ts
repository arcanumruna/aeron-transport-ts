// The worker script of RingBufferCrossWorkerExtraTest (run through test/support/Workers.ts). One script, one `kind` per
// role. Every loop has a hard iteration cap, so that a bug fails the test instead of hanging it.
import { parentPort, workerData } from 'node:worker_threads';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { MessageHandler } from '../../../../../src/agrona/concurrent/MessageHandler.js';
import { ManyToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { OneToOneRingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/OneToOneRingBuffer.js';
import { RingBuffer } from '../../../../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import {
    abortedCount,
    checkMessage,
    type ConsumerResult,
    fillMessage,
    HEARTBEAT_DONE,
    HEARTBEAT_PROGRESS,
    isAborted,
    lengthOf,
    type ProducerResult,
    type RingBufferWorkerData,
} from './RingBufferLayout.js';
import { PASS_LENGTH, PASSES, valueAt } from '../SharedAtomicsLayout.js';

const { INSUFFICIENT_CAPACITY } = RingBuffer;

const MAX_SPINS = 400_000_000;
/** Reads that find nothing, in a row, before the consumer gives up: the producers stopped or the ring is stuck. */
const MAX_IDLE_READS = 200_000_000;

const data = workerData as RingBufferWorkerData;
const buffer = new UnsafeBuffer(data.buffer);
const ring = 'many-to-one' === data.ring ? new ManyToOneRingBuffer(buffer) : new OneToOneRingBuffer(buffer);
const control = new Int32Array(data.control);

/** Waits until all the workers have started, so that they contend. */
function barrier(): void {
    Atomics.add(control, 0, 1);
    let spins = 0;
    while (Atomics.load(control, 0) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

/** A short park once in a while, so that spinning workers on a loaded host let the others run. */
function backoff(spins: number): void {
    if (127 === (spins & 127)) {
        Atomics.wait(control, 1, 0, 0.02);
    }
}

function producer(): ProducerResult {
    const scratch = new Uint8Array(ring.maxMsgLength());
    const scratchBuffer = new UnsafeBuffer(scratch);
    const ringBytes = new Uint8Array(data.buffer);
    const type = data.id + 1;
    let retries = 0;

    barrier();
    for (let s = 0; s < data.perProducer; s++) {
        const length = lengthOf(data.seed, data.id, s, ring.maxMsgLength());
        let spins = 0;
        if (data.claim) {
            let index = ring.tryClaim(type, length);
            while (INSUFFICIENT_CAPACITY === index) {
                retries++;
                if (++spins > MAX_SPINS) {
                    throw new Error('tryClaim: the ring stayed full');
                }
                backoff(spins);
                index = ring.tryClaim(type, length);
            }
            // in place: the bytes go straight into the shared ring
            fillMessage(ringBytes, index, data.seed, data.id, s, length);
            if (isAborted(data.seed, data.id, s)) {
                ring.abort(index);
            } else {
                ring.commit(index);
            }
        } else {
            fillMessage(scratch, 0, data.seed, data.id, s, length);
            while (!ring.write(type, scratchBuffer, 0, length)) {
                retries++;
                if (++spins > MAX_SPINS) {
                    throw new Error('write: the ring stayed full');
                }
                backoff(spins);
            }
        }
    }
    return { retries };
}

function consumer(): ConsumerResult {
    const ringBytes = new Uint8Array(data.buffer);
    const maxMsgLength = ring.maxMsgLength();
    const next = new Int32Array(data.producers);
    let total = 0;
    for (let p = 0; p < data.producers; p++) {
        total += data.perProducer - (data.claim ? abortedCount(data.seed, p, data.perProducer) : 0);
    }
    let delivered = 0;
    let error: string | null = null;

    const handler: MessageHandler = {
        onMessage(msgTypeId, _buffer, index, length): void {
            const p = msgTypeId - 1;
            if (p < 0 || p >= data.producers) {
                error ??= 'message of type ' + msgTypeId;
                return;
            }
            let s = next[p] as number;
            // an aborted claim is never delivered: the next message of the producer is the next one it committed
            while (data.claim && s < data.perProducer && isAborted(data.seed, p, s)) {
                s++;
            }
            if (s >= data.perProducer) {
                error ??= 'extra message of producer ' + p + ' after ' + data.perProducer;
                return;
            }
            next[p] = s + 1;
            const expectedLength = lengthOf(data.seed, p, s, maxMsgLength);
            if (length !== expectedLength) {
                error ??= 'producer ' + p + ' message ' + s + ' has length ' + length + ', expected ' + expectedLength;
                return;
            }
            error ??= checkMessage(ringBytes, index, data.seed, p, s, length);
            delivered++;
        },
    };

    barrier();
    let idle = 0;
    while (delivered < total && null === error) {
        if (0 === ring.read(handler, 64)) {
            if (++idle > MAX_IDLE_READS) {
                error = 'stalled after ' + delivered + ' of ' + total + ' messages';
            }
            backoff(idle);
        } else {
            idle = 0;
        }
    }
    if (null === error) {
        // nothing more may come: every producer has been drained
        for (let p = 0; p < data.producers; p++) {
            let s = next[p] as number;
            while (data.claim && s < data.perProducer && isAborted(data.seed, p, s)) {
                s++;
            }
            if (s !== data.perProducer) {
                error = 'producer ' + p + ' delivered up to ' + s + ' of ' + data.perProducer;
            }
        }
    }
    return { delivered, error };
}

/** Claims a record and leaves without committing it: the producer that dies in the act of offering. */
function claimAndExit(): { index: number } {
    const index = ring.tryClaim(data.id + 1, data.iterations);
    return { index };
}

/** Takes `iterations` correlation ids. */
function correlation(): number[] {
    barrier();
    const ids: number[] = new Array<number>(data.iterations);
    for (let i = 0; i < data.iterations; i++) {
        ids[i] = ring.nextCorrelationId();
    }
    return ids;
}

/** Writes the heartbeat across every 2^32 boundary below 2^40, as SharedAtomicsExtraTest does. */
function heartbeatWriter(): number {
    barrier();
    let n = 0;
    for (let pass = 0; pass < PASSES; pass++) {
        for (let i = 0; i < PASS_LENGTH; i++) {
            ring.consumerHeartbeatTime(valueAt(i));
            buffer.putIntOrdered(HEARTBEAT_PROGRESS, ++n);
        }
    }
    buffer.putIntVolatile(HEARTBEAT_DONE, 1);
    return n;
}

const result = (() => {
    switch (data.kind) {
        case 'producer':
            return producer();
        case 'consumer':
            return consumer();
        case 'claim-and-exit':
            return claimAndExit();
        case 'correlation':
            return correlation();
        case 'heartbeat-writer':
            return heartbeatWriter();
    }
})();

parentPort!.postMessage(result);
