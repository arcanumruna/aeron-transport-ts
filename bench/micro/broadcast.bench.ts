// Micro benches of the Agrona broadcast buffer over a SharedArrayBuffer of 64 KiB (phase 2, T4): transmit + receiveNext
// (with the getters and validate) and transmit + CopyBroadcastReceiver.receive of a 64 byte message in one thread.
import { BufferUtil } from '../../src/agrona/BufferUtil.js';
import { BroadcastBufferDescriptor } from '../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastReceiver } from '../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { BroadcastTransmitter } from '../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { CopyBroadcastReceiver } from '../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { MessageHandler } from '../../src/agrona/concurrent/MessageHandler.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { SyncBench } from '../lib/types.js';

const CAPACITY = 64 * 1024;
const LENGTH = 64;
const TYPE_ID = 1;
const OPS_PER_SAMPLE = 1_000;

/** Only sums, so that the handler is not what is measured. */
class Sum implements MessageHandler {
    public total = 0;

    public onMessage(msgTypeId: number, _buffer: unknown, _index: number, length: number): void {
        this.total = (this.total + msgTypeId + length) | 0;
    }
}

function newBuffer(): UnsafeBuffer {
    return new UnsafeBuffer(BufferUtil.allocateShared(CAPACITY + BroadcastBufferDescriptor.TRAILER_LENGTH, 64));
}

function transmitAndReceiveNext(): SyncBench {
    let transmitter: BroadcastTransmitter;
    let receiver: BroadcastReceiver;
    let src: UnsafeBuffer;
    let sink = 0;
    return {
        name: 'BroadcastTransmitter transmit + BroadcastReceiver receiveNext 64B',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            const buffer = newBuffer();
            transmitter = new BroadcastTransmitter(buffer);
            receiver = new BroadcastReceiver(buffer);
            src = new UnsafeBuffer(new Uint8Array(LENGTH));
        },
        op: (i) => {
            src.putInt(0, i);
            transmitter.transmit(TYPE_ID, src, 0, LENGTH);
            if (!receiver.receiveNext()) {
                throw new Error('nothing to receive');
            }
            sink = (sink + receiver.typeId() + receiver.offset() + receiver.length()) | 0;
            if (!receiver.validate()) {
                throw new Error('lapped');
            }
        },
    };
}

function transmitAndCopyReceive(): SyncBench {
    let transmitter: BroadcastTransmitter;
    let receiver: CopyBroadcastReceiver;
    let src: UnsafeBuffer;
    const sum = new Sum();
    return {
        name: 'BroadcastTransmitter transmit + CopyBroadcastReceiver receive 64B',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            const buffer = newBuffer();
            transmitter = new BroadcastTransmitter(buffer);
            receiver = new CopyBroadcastReceiver(new BroadcastReceiver(buffer));
            src = new UnsafeBuffer(new Uint8Array(LENGTH));
        },
        op: (i) => {
            src.putInt(0, i);
            transmitter.transmit(TYPE_ID, src, 0, LENGTH);
            if (1 !== receiver.receive(sum)) {
                throw new Error('nothing to receive');
            }
        },
    };
}

export const benches: SyncBench[] = [transmitAndReceiveNext(), transmitAndCopyReceive()];
