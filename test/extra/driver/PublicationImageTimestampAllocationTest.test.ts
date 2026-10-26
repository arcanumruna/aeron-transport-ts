// Extra tests of T16 (port-only, spec 5.3): the receive timestamp of the channel is written without allocation (the clock reads its two halves, spec D17).
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import type { EpochNanoClock } from '../../../src/agrona/concurrent/EpochNanoClock.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
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

describe('PublicationImageTimestampAllocationTest', () => {
    it('the receive timestamp of the channel: the halves of the clock are written in the begin frame of each datagram', async () => {
        // the system clock reads performance.now(), which returns a heap number of its own per call (spec D17): the clock
        // here writes fixed halves, so that what is measured is the port's code
        const clock: EpochNanoClock = {
            nanoTime: () => 0,
            nanoTimeHalves: (out: Int32Array) => {
                out[0] = 0x12345678;
                out[1] = 0x1234;
            },
        };
        newRig({
            uri: 'aeron:udp?endpoint=127.0.0.1:0|channel-rcv-ts-offset=reserved',
            channelReceiveTimestampClock: clock,
        });
        const { bytes, header } = frameHeader(64);
        const image = rig.image;
        const receiver = rig.receiver;
        const timeClock = rig.clock;
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
                timeClock.advance(100);
                if (0 === frames % 64) {
                    image.trackRebuild(timeClock.nanoTime());
                    subscriber.setRelease(rebuild.get());
                }
            }
        }, ITERATIONS);

        expect(rig.hwmPosition.get()).toBe(frames * 64);
        // the reserved value of the frames in the log is the clock's time: the two halves
        const termBuffer = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
        expect(termBuffer.getInt(24, ByteOrder.LITTLE_ENDIAN)).toBe(0x12345678);
        expect(termBuffer.getInt(28, ByteOrder.LITTLE_ENDIAN)).toBe(0x1234);
    });
});
