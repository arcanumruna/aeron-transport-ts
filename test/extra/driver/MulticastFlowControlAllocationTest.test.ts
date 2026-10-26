// Extra tests of phase 3 T1 (port-only, spec 5.3): the per-message methods of the multicast flow control strategies
// allocate nothing in the port's own code. The receivers are added first (the control plane); the loops then send
// status messages from receivers the strategy knows and call onIdle, with the positions below 2^30 so that no number
// is boxed.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import type { FlowControl } from '../../../src/driver/FlowControl.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../../src/driver/MinMulticastFlowControl.js';
import { TaggedMulticastFlowControl } from '../../../src/driver/TaggedMulticastFlowControl.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { SenderRig } from '../../support/SenderRig.js';
import { ChannelUri } from '../../../src/client/ChannelUri.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import type { CountersManager as CountersManagerType } from '../../../src/agrona/concurrent/status/CountersManager.js';
import type { MutableDirectBuffer } from '../../../src/agrona/MutableDirectBuffer.js';
import type { Socket } from 'node:dgram';

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
const TAGGED_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123/1';

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

    describe('TaggedMulticastFlowControl', () => {
        it('onStatusMessage from a known tagged receiver allocates nothing', async () => {
            const flowControl = new TaggedMulticastFlowControl();
            const flyweight = newTracking(flowControl, TAGGED_URI, 8, 123n);
            let limit = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    flyweight.receiverIdLow((i & 7) + 1);
                    limit = flowControl.onStatusMessage(flyweight, null as never, limit & 0xffff, 0, 0, 0);
                }
            }, ITERATIONS);

            expect(limit).toBe(TERM_OFFSET + WINDOW_LENGTH);
        });

        it('onStatusMessage from an untagged receiver allocates nothing', async () => {
            const flowControl = new TaggedMulticastFlowControl();
            const tagged = newTracking(flowControl, TAGGED_URI, 8, 123n);
            const flyweight = newStatusMessage();
            flyweight.groupTag(null);
            let limit = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    flyweight.receiverIdLow(100 + (i & 7));
                    limit = flowControl.onStatusMessage(flyweight, null as never, limit & 0xffff, 0, 0, 0);
                }
            }, ITERATIONS);

            expect(limit).toBe(TERM_OFFSET + WINDOW_LENGTH);
            expect(tagged.groupTagLow()).toBe(123);
        });

        it('onStatusMessage and onTriggerSendSetup from a receiver with the wrong tag allocate nothing', async () => {
            const flowControl = new TaggedMulticastFlowControl();
            newTracking(flowControl, TAGGED_URI, 8, 123n);
            const flyweight = newStatusMessage();
            flyweight.groupTag(124n);
            let limit = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    flyweight.receiverIdLow(100 + (i & 7));
                    limit = flowControl.onStatusMessage(flyweight, null as never, limit & 0xffff, 0, 0, 0);
                    flowControl.onTriggerSendSetup(flyweight, null as never, 0);
                }
            }, ITERATIONS);

            expect(limit).toBe(TERM_OFFSET + WINDOW_LENGTH);
        });

        it('onError with a tag allocates nothing', async () => {
            const flowControl = new TaggedMulticastFlowControl();
            newTracking(flowControl, TAGGED_URI, 8, 123n);
            const error = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
            error.receiverIdHigh(0).receiverIdLow(1000).groupTag(123n);

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    flowControl.onError(error, null as never, 0);
                }
            }, ITERATIONS);

            expect(flowControl.hasRequiredReceivers()).toBe(true);
        });

        it.each([1, 8, 64])('onIdle with %i receivers allocates nothing', async (receivers) => {
            const flowControl = new TaggedMulticastFlowControl();
            newTracking(flowControl, TAGGED_URI, receivers, 123n);
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

describe('MDC sender paths', () => {
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

    function newMdcRig(destinations: number): { rig: SenderRig; sink: SinkSocket; end: number } {
        const uri = 'aeron:udp?control-mode=manual';
        const rig = new SenderRig({ uri });
        rig.endpoint.allocateDestinationsCounterForMdc(
            rig.context.tempBuffer() as MutableDirectBuffer,
            rig.context.countersManager() as CountersManagerType,
            SenderRig.REGISTRATION_ID,
            uri,
        );
        for (let i = 0; i < destinations; i++) {
            rig.endpoint.addDestination(
                ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:' + (41000 + i)),
                new InetSocketAddress('127.0.0.1', 41000 + i),
                1000 + i,
            );
        }
        let end = 0;
        for (let i = 0; i < 40; i++) {
            end = rig.producer.offer(new Uint8Array(992));
        }
        const sink = new SinkSocket();
        rig.endpoint.sendDatagramChannel = sink as unknown as Socket;
        rig.senderLimit.set(1 << 20);

        return { rig, sink, end };
    }

    it.each([1, 4, 16])('the destination timeout check of %i destinations allocates nothing', async (destinations) => {
        const { rig } = newMdcRig(destinations);
        const nowNs = rig.clock.nanoTime();
        try {
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    rig.poller.checkForReResolutions(nowNs, rig.conductorProxy as DriverConductorProxy);
                }
            }, ITERATIONS);
            expect(rig.conductorProxy.reResolveEndpoint).not.toHaveBeenCalled();
        } finally {
            rig.close();
        }
    });

    it.each([1, 4, 16])('Sender.doWork of a data frame to %i destinations allocates nothing', async (destinations) => {
        const { rig, sink, end } = newMdcRig(destinations);
        const position = rig.senderPosition;
        try {
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    if (position.get() >= end) {
                        position.set(0);
                    }
                    rig.sender.doWork();
                }
            }, 300_000);
            expect(sink.sends).toBeGreaterThan(destinations * 100_000);
            expect(rig.errors).toEqual([]);
        } finally {
            rig.close();
        }
    });
});
