// Extra tests of T15 (port-only, spec 5.3): the sender scan and send, the heartbeat, the retransmit, the status message
// and NAK handling of the publication and the conductor's cycle on it allocate nothing in the port's own code. The
// socket is a sink that counts (a `vi.fn` allocates), the clock a `CachedNanoClock` and the positions stay below 2^30,
// so that no number is boxed. Node's own allocation per datagram is outside these loops.
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import type { PublicationConductor } from '../../../src/driver/NetworkPublication.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { SenderRig } from '../../support/SenderRig.js';

const ITERATIONS = 300_000;
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

let rig: SenderRig;
let sink: SinkSocket;

/** A rig whose log holds `FRAMES` frames of 1024 bytes, connected, with the sink in place of the recording socket. */
function newRig(): number {
    rig = new SenderRig();
    rig.sender.doWork();
    rig.sendStatusMessage(0, LogBufferDescriptor.TERM_MIN_LENGTH / 2);
    rig.sender.doWork();
    let end = 0;
    for (let i = 0; i < FRAMES; i++) {
        end = rig.producer.offer(new Uint8Array(992));
    }
    sink = new SinkSocket();
    rig.endpoint.sendDatagramChannel = sink as unknown as Socket;
    rig.senderLimit.set(1 << 20);

    return end;
}

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('NetworkPublicationAllocationTest', () => {
    it('the sender scan and send of data frames allocates nothing', async () => {
        const end = newRig();
        const sender = rig.sender;
        const position = rig.senderPosition;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (position.get() >= end) {
                    position.set(0);
                }
                sender.doWork();
            }
        }, ITERATIONS);

        expect(sink.sends).toBeGreaterThan(ITERATIONS / 2);
    });

    it('the heartbeat allocates nothing', async () => {
        const end = newRig();
        const sender = rig.sender;
        const position = rig.senderPosition;
        const clock = rig.clock;
        const heartbeatTimeout = Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS;
        const heartbeats = (): number =>
            (rig.context.systemCounters() as SystemCounters).get(SystemCounterDescriptor.HEARTBEATS_SENT).get();
        const before = heartbeats();

        // a data frame at time 0 and a heartbeat at twice the timeout, so that the times stay small integers
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                position.set(end - FRAME);
                clock.update(0);
                sender.doWork();
                clock.update(2 * heartbeatTimeout);
                sender.doWork();
            }
        }, ITERATIONS / 2);

        expect(heartbeats() - before).toBeGreaterThan(ITERATIONS / 2);
    });

    it('a retransmit allocates nothing', async () => {
        const end = newRig();
        void end;
        rig.senderPosition.set(FRAMES * FRAME);
        const publication = rig.publication;
        const termId = rig.initialTermId;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                publication.resend(termId, (i & 15) * FRAME, 2 * FRAME);
            }
        }, ITERATIONS);

        expect(sink.sends).toBeGreaterThan(ITERATIONS);
    });

    it('status messages through the endpoint allocate nothing', async () => {
        newRig();
        rig.senderPosition.set(FRAMES * FRAME);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                rig.sendStatusMessageAt(rig.initialTermId, FRAMES * FRAME, 1000);
            }
        }, ITERATIONS / 2);
    });

    it('NAKs through the endpoint allocate nothing', async () => {
        newRig();
        rig.senderPosition.set(FRAMES * FRAME);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                rig.sendNak(rig.initialTermId, 0, 2 * FRAME);
            }
        }, ITERATIONS / 2);
    });

    it('the cycle of the conductor on the publication allocates nothing', async () => {
        newRig();
        const noop = (): void => {};
        const conductor: PublicationConductor = {
            cleanupSpies: noop,
            cleanupPublication: noop,
            notifyUnavailableImageLink: noop,
            notifyAvailableImageLink: noop,
        };
        const publication = rig.publication;
        const clock = rig.clock;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                publication.updatePublisherPositionAndLimit();
                publication.onTimeEvent(clock.nanoTime(), 0, conductor);
            }
        }, ITERATIONS);
    });
});
