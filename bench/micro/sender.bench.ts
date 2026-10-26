// Micro benches of the sender (T15): `Sender.doWork` with a data frame to send (the scan of the term, the copy to the
// send slot of the endpoint and the socket hand-off), the heartbeat, and the retransmit of two frames. The socket is a
// sink, the clock is moved by the bench, the log is in memory (`SharedArrayBuffer`) as in the driver. The positions
// stay below 2^30 and so are small integers.
import type { Socket } from 'node:dgram';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { SenderRig } from '../../test/support/SenderRig.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const FRAME = 1024;
const FRAMES = 40;

class SinkSocket {
    public sends = 0;

    public getSendQueueCount(): number {
        return 0;
    }

    public send(): void {
        this.sends++;
    }

    public close(): void {}
}

function newRig(): { rig: SenderRig; end: number } {
    const rig = new SenderRig();
    rig.sender.doWork();
    rig.sendStatusMessage(0, LogBufferDescriptor.TERM_MIN_LENGTH / 2);
    rig.sender.doWork();
    let end = 0;
    for (let i = 0; i < FRAMES; i++) {
        end = rig.producer.offer(new Uint8Array(FRAME - 32));
    }
    rig.endpoint.sendDatagramChannel = new SinkSocket() as unknown as Socket;
    rig.senderLimit.set(1 << 20);

    return { rig, end };
}

function dataBench(): SyncBench {
    let rig: SenderRig;
    let end = 0;
    return {
        name: 'Sender doWork: one data frame of 1024 B (scan, copy to the send slot, socket)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ rig, end } = newRig());
        },
        op: () => {
            if (rig.senderPosition.get() >= end) {
                rig.senderPosition.set(0);
            }
            rig.sender.doWork();
        },
        teardown: () => rig.close(),
    };
}

function heartbeatBench(): SyncBench {
    let rig: SenderRig;
    let end = 0;
    return {
        name: 'Sender doWork: a data frame at t=0 then a heartbeat at t=2 x timeout (two cycles per operation)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ rig, end } = newRig());
        },
        op: () => {
            rig.senderPosition.set(end - FRAME);
            rig.clock.update(0);
            rig.sender.doWork();
            rig.clock.update(2 * Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS);
            rig.sender.doWork();
        },
        teardown: () => rig.close(),
    };
}

function resendBench(): SyncBench {
    let rig: SenderRig;
    return {
        name: 'NetworkPublication resend: 2 frames of 1024 B',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ rig } = newRig());
            rig.senderPosition.set(FRAMES * FRAME);
        },
        op: (i) => {
            rig.publication.resend(rig.initialTermId, (i & 15) * FRAME, 2 * FRAME);
        },
        teardown: () => rig.close(),
    };
}

export const benches: SyncBench[] = [dataBench(), heartbeatBench(), resendBench()];
