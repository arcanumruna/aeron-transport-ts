// Extra tests of T16 (port-only, spec 5.3): the NAK of a gap that stays open and the gap fill of an unreliable image
// allocate nothing in the port's code.
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const ITERATIONS = 300_000;
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

describe('PublicationImageLossAllocationTest', () => {
    it('the NAK of a gap that stays open, repeated at the retry delay', async () => {
        newRig({ lossRetryDelayNs: 1000 });
        const image = rig.image;
        const receiver = rig.receiver;
        const clock = rig.clock;
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: new Uint8Array(32) }));
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 128, payload: new Uint8Array(32) })); // frame 1 is lost
        let naks = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                clock.advance(1000);
                image.trackRebuild(clock.nanoTime()); // the gap is reported again: its retry delay is over
                receiver.doWork(); // and the NAK is sent
            }
            naks += n;
        }, ITERATIONS);

        expect(rig.counter(SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThanOrEqual(naks);
        expect(rig.rebuildPosition.get()).toBe(64);
        expect(sink.sends).toBeGreaterThanOrEqual(naks);
    });

    it('the gap fill of an unreliable image', async () => {
        newRig({ isReliable: false });
        const { bytes, header } = frameHeader(64);
        const image = rig.image;
        const receiver = rig.receiver;
        const clock = rig.clock;
        const endpoint = rig.endpoint;
        const subscriber = rig.subscriberPosition;
        const rebuild = rig.rebuildPosition;
        const initialTermId = rig.initialTermId;
        let pairs = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const position = (2 * pairs + 1) * 64; // the frame before it is lost
                header.termOffset(position & MASK);
                header.termId((initialTermId + (position >>> 16)) | 0);
                endpoint.onMessage(bytes, ReceiverRig.SOURCE);
                receiver.doWork();
                clock.advance(1000);
                image.trackRebuild(clock.nanoTime()); // the gap is found
                receiver.doWork(); // and filled with a padding frame
                clock.advance(1000);
                image.trackRebuild(clock.nanoTime());
                subscriber.setRelease(rebuild.get());
                pairs++;
            }
        }, ITERATIONS / 2);

        expect(rig.counter(SystemCounterDescriptor.LOSS_GAP_FILLS)).toBe(pairs);
        expect(rig.counter(SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBe(0);
        expect(rig.rebuildPosition.get()).toBe(pairs * 128);
    });
});
