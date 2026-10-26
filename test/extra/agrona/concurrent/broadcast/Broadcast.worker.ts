// The worker script of BroadcastCrossWorkerExtraTest (run through test/support/Workers.ts). One script, one `kind` per
// role. Every loop has a hard iteration cap, so that a bug fails the test instead of hanging it.
import { parentPort, workerData } from 'node:worker_threads';
import { BroadcastReceiver } from '../../../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { BroadcastTransmitter } from '../../../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { CopyBroadcastReceiver } from '../../../../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { MessageHandler } from '../../../../../src/agrona/concurrent/MessageHandler.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalStateException, IndexOutOfBoundsException } from '../../../../../src/agrona/jdk.js';
import {
    type BroadcastWorkerData,
    checkPayload,
    CONTROL_BACKOFF,
    CONTROL_DONE,
    CONTROL_PROGRESS,
    CONTROL_STARTED,
    fillPayload,
    lengthOfMessage,
    type ReceiverResult,
    type TransmitterResult,
} from './BroadcastLayout.js';

const MAX_SPINS = 400_000_000;
/** Receives that find nothing, in a row, before a receiver gives up: the transmitter stopped or is stuck. */
const MAX_IDLE_RECEIVES = 200_000_000;
/** The slow receiver of 'copy-stalling' stalls after this many records, until the transmitter is this far ahead. */
const STALL_EVERY = 997;
const STALL_UNTIL_AHEAD_BY = 200;

const data = workerData as BroadcastWorkerData;
const buffer = new UnsafeBuffer(data.buffer);
const control = new Int32Array(data.control);

/** Waits until all the workers have started, so that they contend. */
function barrier(): void {
    Atomics.add(control, CONTROL_STARTED, 1);
    let spins = 0;
    while (Atomics.load(control, CONTROL_STARTED) < data.workers) {
        if (++spins > MAX_SPINS) {
            throw new Error('barrier: not all workers started');
        }
    }
}

/** A short park once in a while, so that spinning workers on a loaded host let the others run. */
function backoff(spins: number): void {
    if (127 === (spins & 127)) {
        Atomics.wait(control, CONTROL_BACKOFF, 0, 0.02);
    }
}

function transmitter(): TransmitterResult {
    const transmitter = new BroadcastTransmitter(buffer);
    const scratch = new Uint8Array(transmitter.maxMsgLength());
    const scratchBuffer = new UnsafeBuffer(scratch);

    barrier();
    for (let s = 0; s < data.messages; s++) {
        const length = lengthOfMessage(data.seed, s, transmitter.maxMsgLength());
        fillPayload(scratch, 0, data.seed, s, length);
        transmitter.transmit(s + 1, scratchBuffer, 0, length);
        if (63 === (s & 63)) {
            Atomics.store(control, CONTROL_PROGRESS, s + 1);
        }
    }
    Atomics.store(control, CONTROL_PROGRESS, data.messages);
    Atomics.store(control, CONTROL_DONE, 1);
    return { sent: data.messages };
}

/** Spins until the transmitter has finished or sent `ahead` more messages than at the call. */
function stall(ahead: number): void {
    const target = Atomics.load(control, CONTROL_PROGRESS) + ahead;
    let spins = 0;
    while (Atomics.load(control, CONTROL_PROGRESS) < target && 0 === Atomics.load(control, CONTROL_DONE)) {
        if (++spins > MAX_SPINS) {
            throw new Error('stall: the transmitter made no progress');
        }
        backoff(spins);
    }
}

function receiver(): ReceiverResult {
    const bytes = new Uint8Array(data.buffer);
    const broadcastReceiver = new BroadcastReceiver(buffer);
    const copyReceiver = new CopyBroadcastReceiver(broadcastReceiver, 4096);
    const maxMsgLength = broadcastReceiver.capacity() >> 3;
    const copy = new Uint8Array(maxMsgLength);

    let accepted = 0;
    let discarded = 0;
    let lastSequence = -1;
    let error: string | null = null;

    /** Checks the record whose type id and bytes are in `bytes` at `index`: it passed `validate()`, so it is intact. */
    const check = (msgTypeId: number, source: Uint8Array, index: number, length: number): void => {
        const s = msgTypeId - 1;
        if (s <= lastSequence || s >= data.messages) {
            error ??= 'sequence ' + s + ' after ' + lastSequence;
            return;
        }
        const expectedLength = lengthOfMessage(data.seed, s, maxMsgLength);
        if (length !== expectedLength) {
            error ??= 'message ' + s + ' has length ' + length + ', expected ' + expectedLength;
            return;
        }
        error ??= checkPayload(source, index, data.seed, s, length);
        lastSequence = s;
        accepted++;
    };

    const handler: MessageHandler = {
        onMessage(msgTypeId, scratchBuffer, index, length): void {
            check(msgTypeId, scratchBuffer.byteArray(), scratchBuffer.addressOffset() + index, length);
        },
    };

    barrier();
    let stalled = false;
    let idle = 0;
    for (let iteration = 0; iteration < MAX_IDLE_RECEIVES && null === error; iteration++) {
        // read before receiving: the transmitter sets it after its last transmit, so a receive that finds nothing after
        // it was seen set has seen the last record
        const transmitterDone = 1 === Atomics.load(control, CONTROL_DONE);
        let received = false;
        if ('copy-stalling' === data.style) {
            try {
                received = 1 === copyReceiver.receive(handler);
            } catch (e) {
                // As in Java, CopyBroadcastReceiver.receive reads the length of the record after receiveNext and before
                // validate(), so a record overwritten in between can have a torn length that putBytes rejects with an
                // IndexOutOfBoundsException: it is not delivered either.
                if (!(e instanceof IllegalStateException) && !(e instanceof IndexOutOfBoundsException)) {
                    throw e;
                }
                // lapped, or overwritten during the copy: the record is dropped, never delivered
                discarded++;
                received = true;
            }
            if (received && 0 === (accepted + discarded) % STALL_EVERY) {
                stall(STALL_UNTIL_AHEAD_BY);
            }
        } else if (broadcastReceiver.receiveNext()) {
            received = true;
            // a torn record can have any type id and length: they are only trusted after validate()
            const msgTypeId = broadcastReceiver.typeId();
            const length = broadcastReceiver.length();
            const offset = broadcastReceiver.offset();
            const sane = length >= 0 && length <= maxMsgLength;
            if (sane) {
                copy.set(bytes.subarray(offset, offset + length));
            }
            if (broadcastReceiver.validate()) {
                if (!sane) {
                    error ??= 'validate() accepted a record of length ' + length;
                } else {
                    check(msgTypeId, copy, 0, length);
                }
            } else {
                discarded++;
            }
            if ('stall-until-done' === data.style && !stalled && accepted >= 10) {
                // the transmitter wraps this receiver many times over: its next receiveNext reports a lap
                stalled = true;
                stall(data.messages);
            }
        }

        if (received) {
            idle = 0;
        } else {
            if (transmitterDone) {
                // the transmitter had finished before this receive and there is nothing more to receive
                break;
            }
            if (++idle > MAX_IDLE_RECEIVES) {
                error ??= 'stalled after ' + accepted + ' records';
            }
            backoff(idle);
        }
    }

    return {
        accepted,
        lapped: broadcastReceiver.lappedCount(),
        discarded,
        lastSequence,
        error,
    };
}

const result = 'transmitter' === data.kind ? transmitter() : receiver();

parentPort!.postMessage(result);
