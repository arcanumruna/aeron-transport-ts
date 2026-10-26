// Extra tests of T16 (port-only, spec 5.3): the receive path of the image allocates nothing in the port's own code: a
// datagram from the ring to `PublicationImage.insertPacket` and `TermRebuilder.insert` through `Receiver.doWork` (data
// frames of 64 and 1408 bytes, the padding frame at the end of the term, a term rotation with the cleaning of the term
// behind, the heartbeat), the steady state of `Receiver.doWork` (idle, with the status message that repeats on its
// timeout) and the status message that follows the subscriber. The receive timestamp, and the NAK and the gap fill, are
// in files of their own (`PublicationImageTimestampAllocationTest.test.ts`, `PublicationImageLossAllocationTest.test.ts`):
// whether a loop of the port's code allocates can depend on what ran in the process before it (the state of the
// optimizing compiler), and each file has a process of its own. The socket is a sink that counts (a `vi.fn` allocates), the clock a `CachedNanoClock`, and the
// positions and times stay below 2^30, so that no number is boxed. Node's own allocation per datagram is outside the
// loops.
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const ITERATIONS = 300_000;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const MASK = TERM - 1;

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

let rig: ReceiverRig;
let sink: SinkSocket;

/** A joined image whose status messages go to the sink, and the first one is out. */
function newRig(options: ConstructorParameters<typeof ReceiverRig>[0] = {}): void {
    rig = new ReceiverRig(options);
    rig.join();
    sink = new SinkSocket();
    rig.endpoint.sendDatagramChannel = sink as unknown as Socket;
    rig.cycle(1);
}

/** A data header over `bytes` (a frame of `bytes.length`), to be moved along the log: no allocation to set a position. */
function frameHeader(length: number): { bytes: Uint8Array; header: DataHeaderFlyweight } {
    const bytes = rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: new Uint8Array(length - 32) });
    return { bytes, header: new DataHeaderFlyweight(new UnsafeBuffer(bytes)) };
}

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('PublicationImageAllocationTest', () => {
    it('data frames of 64 bytes through Receiver.doWork: the rebuild, the rotation of the terms and the status messages', async () => {
        newRig();
        const { bytes, header } = frameHeader(64);
        const image = rig.image;
        const receiver = rig.receiver;
        const clock = rig.clock;
        const endpoint = rig.endpoint;
        const subscriber = rig.subscriberPosition;
        const rebuild = rig.rebuildPosition;
        const initialTermId = rig.initialTermId;
        let frames = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const position = frames * 64;
                frames++;
                header.termOffset(position & MASK);
                header.termId((initialTermId + (position >>> 16)) | 0);
                endpoint.onMessage(bytes, ReceiverRig.SOURCE);
                receiver.doWork();
                clock.advance(100);
                if (0 === frames % 64) {
                    // the conductor tracks the rebuild; the client consumes what is rebuilt
                    image.trackRebuild(clock.nanoTime());
                    subscriber.setRelease(rebuild.get());
                }
            }
        }, ITERATIONS);

        expect(rig.hwmPosition.get()).toBe(frames * 64);
        expect(frames * 64).toBeGreaterThan(4 * TERM);
        expect(rig.counter(SystemCounterDescriptor.FLOW_CONTROL_OVER_RUNS)).toBe(0);
        expect(sink.sends).toBeGreaterThan(frames / 400); // a status message for every 8192 bytes
    });

    it('data frames of the MTU and the padding frame at the end of each term', async () => {
        newRig();
        const { bytes, header } = frameHeader(1408);
        const padding = rig.padding(rig.initialTermId, 0, 32);
        const paddingHeader = new DataHeaderFlyweight(new UnsafeBuffer(padding));
        const image = rig.image;
        const receiver = rig.receiver;
        const clock = rig.clock;
        const endpoint = rig.endpoint;
        const subscriber = rig.subscriberPosition;
        const rebuild = rig.rebuildPosition;
        const initialTermId = rig.initialTermId;
        let position = 0;
        let count = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const termOffset = position & MASK;
                const termId = (initialTermId + (position >>> 16)) | 0;
                const left = TERM - termOffset;
                if (left < 1408) {
                    paddingHeader.termOffset(termOffset);
                    paddingHeader.termId(termId);
                    paddingHeader.frameLength(left);
                    endpoint.onMessage(padding, ReceiverRig.SOURCE);
                    position += left;
                } else {
                    header.termOffset(termOffset);
                    header.termId(termId);
                    endpoint.onMessage(bytes, ReceiverRig.SOURCE);
                    position += 1408;
                }
                receiver.doWork();
                clock.advance(100);
                if (0 === ++count % 4) {
                    image.trackRebuild(clock.nanoTime());
                    subscriber.setRelease(rebuild.get());
                }
            }
        }, 100_000);

        expect(rig.hwmPosition.get()).toBe(position);
        expect(position).toBeGreaterThan(2 * TERM);
        expect(rig.counter(SystemCounterDescriptor.FLOW_CONTROL_OVER_RUNS)).toBe(0);
        expect(rig.counter(SystemCounterDescriptor.INVALID_PACKETS)).toBe(0);
    });

    it('heartbeats of 0 bytes', async () => {
        newRig();
        const heartbeat = rig.heartbeat(rig.initialTermId, 0);
        const receiver = rig.receiver;
        const endpoint = rig.endpoint;
        const clock = rig.clock;
        const before = rig.counter(SystemCounterDescriptor.HEARTBEATS_RECEIVED);
        let heartbeats = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(heartbeat, ReceiverRig.SOURCE);
                receiver.doWork();
                clock.advance(10);
            }
            heartbeats += n;
        }, ITERATIONS);

        expect(rig.counter(SystemCounterDescriptor.HEARTBEATS_RECEIVED) - before).toBe(heartbeats);
    });

    it('Receiver.doWork at rest: idle cycles, the status message that repeats on its timeout, nothing else', async () => {
        newRig();
        const receiver = rig.receiver;
        const clock = rig.clock;
        const sentBefore = sink.sends;
        let work = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                clock.advance(1000);
                work += receiver.doWork();
            }
        }, ITERATIONS);

        // the clock went over the 200 ms timeout: a status message, and no other work
        expect(sink.sends - sentBefore).toBeGreaterThanOrEqual(1);
        expect(work).toBe(sink.sends - sentBefore);
    });

    it('a status message in every cycle (a timeout of 1 microsecond): the send path of the image', async () => {
        newRig({ statusMessageTimeoutNs: 1000 });
        const receiver = rig.receiver;
        const clock = rig.clock;
        const sentBefore = sink.sends;
        let cycles = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                clock.advance(1001);
                receiver.doWork();
            }
            cycles += n;
        }, 100_000);

        expect(sink.sends - sentBefore).toBeGreaterThanOrEqual(cycles);
    });
});
