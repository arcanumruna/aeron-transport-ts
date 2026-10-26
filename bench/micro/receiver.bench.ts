// Micro benches of the receiver (T16): one datagram from the transport ring to the image (`Receiver.doWork`: the poll of
// the data transport, the endpoint, the dispatcher, `PublicationImage.insertPacket` and `TermRebuilder.insert`), the
// heartbeat, and a cycle with nothing to do. The socket is a sink, the clock is moved by the bench, the log is in memory
// (`SharedArrayBuffer`) as in the driver. The conductor's `trackRebuild` runs every 64 frames and is part of the figure
// of the data bench (one in 64 operations). Positions stay below 2^30 over a run (64-byte frames) and so are small integers.
// The MTU bench (issue #43) moves frames of 1408 B, which pass 2^30 within a run of the harness (6 million operations are
// 8.7 GB), so it has the rigs of the whole run made in `setup` and moves to the next one before the positions of the
// current one pass 2^30: a rig takes milliseconds to make, which a timed sample must not contain.
import type { Socket } from 'node:dgram';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { ReceiverRig } from '../../test/support/ReceiverRig.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const MASK = TERM - 1;
const MTU_FRAME = 1408;
/** Frames of one rig of the MTU bench: 985 MB, below 2^30. */
const MTU_FRAMES_PER_RIG = 700_000;
/** The rigs made in `setup`: the warm-up and the 3 runs of 2000 samples of the default (bench/lib/runner.ts) need 9. */
const MTU_RIGS = 10;

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

/** One MTU frame (a data frame of 1408 B, or the padding frame at the end of the term) and the conductor cycle every 4. */
function mtuBench(): SyncBench {
    let rigs: ReceiverRig[] = [];
    let rig: ReceiverRig;
    let header: DataHeaderFlyweight;
    let paddingHeader: DataHeaderFlyweight;
    let bytes: Uint8Array;
    let padding: Uint8Array;
    let inRig = 0;
    let position = 0;
    let count = 0;

    const useRig = (next: ReceiverRig): void => {
        rig = next;
        bytes = rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: new Uint8Array(MTU_FRAME - 32) });
        header = new DataHeaderFlyweight(new UnsafeBuffer(bytes));
        padding = rig.padding(rig.initialTermId, 0, 32);
        paddingHeader = new DataHeaderFlyweight(new UnsafeBuffer(padding));
        inRig = 0;
        position = 0;
    };

    return {
        name: 'Receiver doWork: one data frame of 1408 B (the MTU), padding at the end of each term, positions of 1 GB per rig',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rigs = [];
            for (let i = 0; i < MTU_RIGS; i++) {
                rigs.push(newRig());
            }
            count = 0;
            useRig(rigs.shift() as ReceiverRig);
        },
        op: () => {
            if (++inRig > MTU_FRAMES_PER_RIG) {
                rig.close();
                // beyond the rigs made in setup (a run with more samples than the default) a rig is made here
                useRig(rigs.shift() ?? newRig());
            }
            const termOffset = position & MASK;
            const termId = (rig.initialTermId + (position >>> 16)) | 0;
            const left = TERM - termOffset;
            if (left < MTU_FRAME) {
                paddingHeader.termOffset(termOffset);
                paddingHeader.termId(termId);
                paddingHeader.frameLength(left);
                rig.endpoint.onMessage(padding, ReceiverRig.SOURCE);
                position += left;
            } else {
                header.termOffset(termOffset);
                header.termId(termId);
                rig.endpoint.onMessage(bytes, ReceiverRig.SOURCE);
                position += MTU_FRAME;
            }
            rig.receiver.doWork();
            rig.clock.advance(10);
            if (0 === ++count % 4) {
                rig.image.trackRebuild(rig.clock.nanoTime());
                rig.subscriberPosition.setRelease(rig.rebuildPosition.get());
            }
        },
        teardown: () => {
            rig.close();
            for (const spare of rigs) {
                spare.close();
            }
        },
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

export const benches: SyncBench[] = [dataBench(), mtuBench(), heartbeatBench(), idleBench()];
