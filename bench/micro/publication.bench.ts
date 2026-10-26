// Micro benches of the client publications and images (T20): `offer` and `tryClaim` + `commit` of a
// `ConcurrentPublication` (one atomic add of the raw tail) and of an `ExclusivePublication` (a plain store of it), and
// `Image.poll` and `controlledPoll` of one fragment. The log is in memory (`SharedArrayBuffer`) as in the driver, the
// messages are 64 bytes (frames of 96), the limit never back pressures, and a term that is full is rotated by the
// publication (one `offer` in 680 is the `ADMIN_ACTION` of the rotation and is part of the figure). The poll benches read
// a term of 600 frames that the setup wrote and move the subscriber back to its start when it has read them all (one
// operation in 600). Positions stay below 2^30 over a run, so they are small integers.
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { ControlledFragmentHandler } from '../../src/client/logbuffer/ControlledFragmentHandler.js';
import { SHARED_BACKING } from '../../test/support/Backing.js';
import { ClientRig } from '../../test/support/ClientRig.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const FRAMES = 600;
const { CONTINUE } = ControlledFragmentHandler.Action;

/** Keeps the work of the handlers alive. */
let sink = 0;

class Sum {
    public onFragment(_buffer: unknown, offset: number, length: number): typeof CONTINUE {
        sink = (sink + offset + length) | 0;
        return CONTINUE;
    }
}

function offerBench(name: string, exclusive: boolean): SyncBench {
    let rig: ClientRig;
    const src = new UnsafeBuffer(new Uint8Array(64));
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = new ClientRig({ backing: SHARED_BACKING, exclusive });
        },
        op: () => {
            sink = rig.publication.offer(src, 0, 64);
        },
    };
}

function tryClaimBench(name: string, exclusive: boolean): SyncBench {
    let rig: ClientRig;
    const claim = new BufferClaim();
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = new ClientRig({ backing: SHARED_BACKING, exclusive });
        },
        op: () => {
            const position = rig.publication.tryClaim(64, claim);
            if (position > 0) {
                claim.commit();
            }
            sink = position;
        },
    };
}

function pollBench(name: string, poll: (rig: ClientRig, handler: Sum) => number): SyncBench {
    let rig: ClientRig;
    let read = 0;
    const handler = new Sum();
    const src = new UnsafeBuffer(new Uint8Array(64));
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            rig = new ClientRig({ backing: SHARED_BACKING });
            for (let i = 0; i < FRAMES; i++) {
                rig.publication.offer(src, 0, 64);
            }
            read = 0;
        },
        op: () => {
            read += poll(rig, handler);
            if (FRAMES === read) {
                rig.subscriberPosition.setRelease(0);
                read = 0;
            }
        },
    };
}

export const benches: SyncBench[] = [
    offerBench('ConcurrentPublication offer 64 B (claim the tail, header, copy, publish the length)', false),
    offerBench('ExclusivePublication offer 64 B (store the tail, header, copy, publish the length)', true),
    tryClaimBench('ConcurrentPublication tryClaim + commit 64 B', false),
    tryClaimBench('ExclusivePublication tryClaim + commit 64 B', true),
    pollBench('Image poll: one fragment of 64 B', (rig, handler) => rig.image.poll(handler, 1)),
    pollBench('Image controlledPoll: one fragment of 64 B', (rig, handler) => rig.image.controlledPoll(handler, 1)),
];
