// Tests the port adds (spec D16, 8.2): the broadcast buffer over a SharedArrayBuffer, across worker_threads. The Java
// tests are single threaded, so nothing else exercises the Atomics paths of the transmitter and the receivers
// concurrently.
//
// One transmitter worker sends seeded messages of random length (0 to maxMsgLength) into a 1 KiB buffer, with no regard
// for the receivers; three receiver workers read them, two of them deliberately slow so that the transmitter laps them.
// Whatever a receiver accepts (receiveNext, copy, validate() true; or CopyBroadcastReceiver.receive) must be an intact
// record of the right type, length and bytes, with a sequence that only goes up; a lap is reported by lappedCount and
// the record is dropped, never delivered torn.
import { describe, expect, it } from 'vitest';
import { BufferUtil } from '../../../../../src/agrona/BufferUtil.js';
import { BroadcastBufferDescriptor } from '../../../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { runWorkers } from '../../../../support/Workers.js';
import {
    BROADCAST_CAPACITY,
    type BroadcastWorkerData,
    FILL_BYTE,
    type ReceiverResult,
    type ReceiverStyle,
    type TransmitterResult,
} from './BroadcastLayout.js';

const SCRIPT = new URL('./Broadcast.worker.ts', import.meta.url);
const TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 30_000;
const SEED = 0x5eed4321;
const MESSAGES = 200_000;

const STYLES: readonly ReceiverStyle[] = ['fast', 'stall-until-done', 'copy-stalling'];

function newShared(): SharedArrayBuffer {
    return BufferUtil.allocateShared(BROADCAST_CAPACITY + BroadcastBufferDescriptor.TRAILER_LENGTH, 64);
}

/** Starts the tail intent, the tail and the latest counter at `position`, each written as a whole `long`. */
function startAt(sab: SharedArrayBuffer, position: number): void {
    const buffer = new UnsafeBuffer(sab);
    buffer.putLong(BROADCAST_CAPACITY + BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET, position);
    buffer.putLong(BROADCAST_CAPACITY + BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET, position);
    buffer.putLong(BROADCAST_CAPACITY + BroadcastBufferDescriptor.LATEST_COUNTER_OFFSET, position);
}

async function run(start: number): Promise<ReceiverResult[]> {
    const sab = newShared();
    const control = new SharedArrayBuffer(16);
    new Uint8Array(sab, 0, BROADCAST_CAPACITY).fill(FILL_BYTE);
    startAt(sab, start);

    const base = { buffer: sab, control, workers: 1 + STYLES.length, seed: SEED, messages: MESSAGES };
    const datas: BroadcastWorkerData[] = [
        { ...base, kind: 'transmitter', style: 'fast' },
        ...STYLES.map((style) => ({ ...base, kind: 'receiver' as const, style })),
    ];
    const results = await runWorkers(SCRIPT, datas, TIMEOUT_MS);

    expect((results[0] as TransmitterResult).sent).toBe(MESSAGES);
    const receivers = results.slice(1) as ReceiverResult[];

    // the tail counted every message and every padding record
    const buffer = new UnsafeBuffer(sab);
    const tail = buffer.getLongVolatile(BROADCAST_CAPACITY + BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET);
    expect(tail - start).toBeGreaterThan(MESSAGES * 8);
    expect(buffer.getLongVolatile(BROADCAST_CAPACITY + BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET)).toBe(
        tail,
    );

    receivers.forEach((r, i) => {
        // never a torn record, never a sequence that goes back
        expect(r.error, 'receiver ' + STYLES[i]).toBeNull();
        expect(r.accepted, 'receiver ' + STYLES[i] + ' accepted').toBeGreaterThan(0);
        expect(r.lastSequence, 'receiver ' + STYLES[i] + ' last sequence').toBeGreaterThanOrEqual(0);
    });
    // the slow receivers were lapped on purpose, and said so
    expect(receivers[1]!.lapped, 'stall-until-done lapped').toBeGreaterThan(0);
    expect(receivers[2]!.lapped, 'copy-stalling lapped').toBeGreaterThan(0);
    expect(receivers[2]!.discarded, 'copy-stalling dropped the records it was lapped on').toBeGreaterThan(0);
    // a receiver that stalled until the end has far fewer records than were sent: the lap lost at least a buffer's worth
    expect(receivers[1]!.accepted).toBeLessThan(MESSAGES);
    return receivers;
}

describe('BroadcastCrossWorkerExtraTest', () => {
    it(
        'everyAcceptedRecordIsIntactAndTheSlowReceiversAreLapped',
        async () => {
            await run(0);
        },
        TEST_TIMEOUT_MS,
    );

    // the positions start just below a power of two, so that the 32-bit part of the tail wraps during the run
    it.each([
        ['2^31', 2 ** 31 - 4096 + 24],
        ['2^32', 2 ** 32 - 4096 + 24],
        ['2^32 on a capacity boundary', 2 ** 32 - 65536],
    ])(
        'everyAcceptedRecordIsIntactWhenThePositionsCross%s',
        async (_name, start) => {
            await run(start);
        },
        TEST_TIMEOUT_MS,
    );
});
