// Extra tests of phase 3 T1 (port-only, spec 5.3): the per-message methods of the multicast flow control strategies
// allocate nothing in the port's own code. The receivers are added first (the control plane); the loops then send
// status messages from receivers the strategy knows and call onIdle, with the positions below 2^30 so that no number
// is boxed.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import type { FlowControl } from '../../../src/driver/FlowControl.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../../src/driver/MinMulticastFlowControl.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const ITERATIONS = 1_000_000;
const WINDOW_LENGTH = 16 * 1024;
const TERM_OFFSET = 4096;

function newCountersManager(length: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(length * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH))),
        new UnsafeBuffer(new ArrayBuffer(length)),
    );
}

function newStatusMessage(): StatusMessageFlyweight {
    const flyweight = new StatusMessageFlyweight(new Uint8Array(1024));
    flyweight.consumptionTermId(0);
    flyweight.consumptionTermOffset(TERM_OFFSET);
    flyweight.receiverWindowLength(WINDOW_LENGTH);
    return flyweight;
}

/** A strategy that tracks `receivers` receivers, whose ids are `(0, 1)` to `(0, receivers)`. */
function newTracking(
    flowControl: FlowControl,
    uri: string,
    receivers: number,
    tag: bigint | null,
): StatusMessageFlyweight {
    const context = new MediaDriver.Context().tempBuffer(new UnsafeBuffer(new ArrayBuffer(8192)));
    flowControl.initialize(context, newCountersManager(16 * 1024), UdpChannel.parse(uri), 0, 0, 0, 0, 0);
    const flyweight = newStatusMessage();
    flyweight.groupTag(tag);
    for (let i = 1; i <= receivers; i++) {
        flyweight.receiverIdLow(i);
        flowControl.onStatusMessage(flyweight, null as never, 0, 0, 0, 0);
    }
    return flyweight;
}

const MIN_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min';

describe('MulticastFlowControlAllocationTest', () => {
    describe('MinMulticastFlowControl', () => {
        it('onStatusMessage from a known receiver allocates nothing', async () => {
            const flowControl = new MinMulticastFlowControl();
            const receivers = 8;
            const flyweight = newTracking(flowControl, MIN_URI, receivers, null);
            let limit = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    flyweight.receiverIdLow((i & 7) + 1);
                    limit = flowControl.onStatusMessage(flyweight, null as never, limit & 0xffff, 0, 0, 0);
                }
            }, ITERATIONS);

            expect(limit).toBe(TERM_OFFSET + WINDOW_LENGTH);
            expect(flowControl.hasRequiredReceivers()).toBe(true);
        });

        it.each([1, 8, 64])('onIdle with %i receivers allocates nothing', async (receivers) => {
            const flowControl = new MinMulticastFlowControl();
            newTracking(flowControl, MIN_URI, receivers, null);
            let limit = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    limit = flowControl.onIdle(i & 0xffff, limit & 0xffff, 0, false);
                }
            }, ITERATIONS);

            expect(limit).toBe(TERM_OFFSET + WINDOW_LENGTH);
        });
    });
});
