// Micro benches of the receiver (T16): one datagram from the transport ring to the image (`Receiver.doWork`: the poll of
// the data transport, the endpoint, the dispatcher, `PublicationImage.insertPacket` and `TermRebuilder.insert`), the
// heartbeat, and a cycle with nothing to do. The socket is a sink, the clock is moved by the bench, the log is in memory
// (`SharedArrayBuffer`) as in the driver. The conductor's `trackRebuild` runs every 64 frames and is part of the figure
// of the data bench (one in 64 operations). Positions stay below 2^30 over a run (64-byte frames) and so are small integers.
import type { Socket } from 'node:dgram';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { ReceiverRig } from '../../test/support/ReceiverRig.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const MASK = LogBufferDescriptor.TERM_MIN_LENGTH - 1;

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

function newRig(): ReceiverRig {
    const rig = new ReceiverRig();
    rig.join();
    rig.endpoint.sendDatagramChannel = new SinkSocket() as unknown as Socket;
    rig.cycle(1);

    return rig;
}

function dataBench(): SyncBench {
    let rig: ReceiverRig;
    let header: DataHeaderFlyweight;
    let bytes: Uint8Array;
    let frames = 0;
    return {
        name: 'Receiver doWork: one data frame of 64 B (ring, validate, route, insertPacket, rebuild, status message)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = newRig();
            bytes = rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: new Uint8Array(32) });
            header = new DataHeaderFlyweight(new UnsafeBuffer(bytes));
            frames = 0;
        },
        op: () => {
            const position = frames * 64;
            frames++;
            header.termOffset(position & MASK);
            header.termId((rig.initialTermId + (position >>> 16)) | 0);
            rig.endpoint.onMessage(bytes, ReceiverRig.SOURCE);
            rig.receiver.doWork();
            rig.clock.advance(10);
            if (0 === frames % 64) {
                rig.image.trackRebuild(rig.clock.nanoTime());
                rig.subscriberPosition.setRelease(rig.rebuildPosition.get());
            }
        },
        teardown: () => rig.close(),
    };
}

function heartbeatBench(): SyncBench {
    let rig: ReceiverRig;
    let heartbeat: Uint8Array;
    return {
        name: 'Receiver doWork: one heartbeat (frame length 0)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = newRig();
            heartbeat = rig.heartbeat(rig.initialTermId, 0);
        },
        op: () => {
            rig.endpoint.onMessage(heartbeat, ReceiverRig.SOURCE);
            rig.receiver.doWork();
            rig.clock.advance(10);
        },
        teardown: () => rig.close(),
    };
}

function idleBench(): SyncBench {
    let rig: ReceiverRig;
    return {
        name: 'Receiver doWork: an idle cycle (no command, no datagram, the image has nothing to send)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = newRig();
        },
        op: () => {
            rig.clock.advance(10);
            rig.receiver.doWork();
        },
        teardown: () => rig.close(),
    };
}

export const benches: SyncBench[] = [dataBench(), heartbeatBench(), idleBench()];
