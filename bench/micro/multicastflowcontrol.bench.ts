// Micro benches of the multicast flow control strategies (phase 3, T4): `onStatusMessage` from a receiver the strategy
// already tracks and `onIdle`, for the max, min and tagged strategies with 1, 8 and 64 receivers (max tracks none, so its
// figure does not depend on the count: the rows show that), and the sender's work on a manual MDC publication with 1, 4
// and 16 destinations: the destination timeout and re-resolution check (`ControlTransportPoller.checkForReResolutions`,
// which `Sender.doWork` runs every `reResolutionCheckInterval`) and `Sender.doWork` sending a data frame to every
// destination. The receiver ids are `(0, n)`, the positions and times stay below 2^30 and so are small integers, and
// the socket of the sender is a sink.
import type { Socket } from 'node:dgram';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import type { FlowControl } from '../../src/driver/FlowControl.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MaxMulticastFlowControl } from '../../src/driver/MaxMulticastFlowControl.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../src/driver/MinMulticastFlowControl.js';
import { TaggedMulticastFlowControl } from '../../src/driver/TaggedMulticastFlowControl.js';
import { SenderRig } from '../../test/support/SenderRig.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const WINDOW_LENGTH = 16 * 1024;
const TERM_OFFSET = 4096;
const GROUP_TAG = 123n;
const RECEIVER_COUNTS = [1, 8, 64];
const DESTINATION_COUNTS = [1, 4, 16];
const FRAME = 1024;
const FRAMES = 40;
const DESTINATION_REGISTRATION_ID = 1000;

interface Strategy {
    name: string;
    newFlowControl(): FlowControl;
    uri: string;
    tag: bigint | null;
}

const STRATEGIES: Strategy[] = [
    {
        name: 'max',
        newFlowControl: () => new MaxMulticastFlowControl(),
        uri: 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=max',
        tag: null,
    },
    {
        name: 'min',
        newFlowControl: () => new MinMulticastFlowControl(),
        uri: 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min',
        tag: null,
    },
    {
        name: 'tagged',
        newFlowControl: () => new TaggedMulticastFlowControl(),
        uri: 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123',
        tag: GROUP_TAG,
    },
];

function newCountersManager(length: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(length * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH))),
        new UnsafeBuffer(new ArrayBuffer(length)),
    );
}

/** A strategy that has seen a status message from each of `receivers` receivers, and the message to send again. */
function newTracking(
    strategy: Strategy,
    receivers: number,
): { flowControl: FlowControl; flyweight: StatusMessageFlyweight } {
    const flowControl = strategy.newFlowControl();
    const context = new MediaDriver.Context().tempBuffer(new UnsafeBuffer(new ArrayBuffer(8192)));
    flowControl.initialize(context, newCountersManager(16 * 1024), UdpChannel.parse(strategy.uri), 0, 0, 0, 0, 0);
    const flyweight = new StatusMessageFlyweight(new Uint8Array(1024));
    flyweight.consumptionTermId(0);
    flyweight.consumptionTermOffset(TERM_OFFSET);
    flyweight.receiverWindowLength(WINDOW_LENGTH);
    flyweight.groupTag(strategy.tag);
    for (let i = 1; i <= receivers; i++) {
        flyweight.receiverIdLow(i);
        flowControl.onStatusMessage(flyweight, null as never, 0, 0, 0, 0);
    }

    return { flowControl, flyweight };
}

function statusMessageBench(strategy: Strategy, receivers: number): SyncBench {
    let flowControl: FlowControl;
    let flyweight: StatusMessageFlyweight;
    let limit = 0;
    const mask = receivers - 1;
    return {
        name: `Flow control ${strategy.name}: onStatusMessage from a known receiver, ${receivers} receivers`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ flowControl, flyweight } = newTracking(strategy, receivers));
        },
        op: (i) => {
            flyweight.receiverIdLow((i & mask) + 1);
            limit = flowControl.onStatusMessage(flyweight, null as never, limit & 0xffff, 0, 0, 0);
        },
        teardown: () => flowControl.close(),
    };
}

function idleBench(strategy: Strategy, receivers: number): SyncBench {
    let flowControl: FlowControl;
    let limit = 0;
    return {
        name: `Flow control ${strategy.name}: onIdle, ${receivers} receivers`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ flowControl } = newTracking(strategy, receivers));
        },
        op: (i) => {
            limit = flowControl.onIdle(i & 0xffff, limit & 0xffff, 0, false);
        },
        teardown: () => flowControl.close(),
    };
}

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

/** A sender rig of a manual MDC publication (`control-mode=manual`) with `destinations` destinations and 40 frames. */
function newMdcRig(destinations: number): { rig: SenderRig; end: number; sink: SinkSocket } {
    const uri = 'aeron:udp?control-mode=manual';
    const rig = new SenderRig({ uri });
    const context = rig.context;
    rig.endpoint.allocateDestinationsCounterForMdc(
        context.tempBuffer() as MutableDirectBuffer,
        context.countersManager() as CountersManager,
        SenderRig.REGISTRATION_ID,
        uri,
    );
    for (let i = 0; i < destinations; i++) {
        const port = 41000 + i;
        rig.endpoint.addDestination(
            ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:' + port),
            new InetSocketAddress('127.0.0.1', port),
            DESTINATION_REGISTRATION_ID + i,
        );
    }
    let end = 0;
    for (let i = 0; i < FRAMES; i++) {
        end = rig.producer.offer(new Uint8Array(FRAME - 32));
    }
    const sink = new SinkSocket();
    rig.endpoint.sendDatagramChannel = sink as unknown as Socket;
    rig.senderLimit.set(1 << 20);

    return { rig, end, sink };
}

function mdcDataBench(destinations: number): SyncBench {
    let rig: SenderRig;
    let end = 0;
    let sink: SinkSocket;
    return {
        name: `Sender doWork: one data frame of 1024 B to a manual MDC publication of ${destinations} destinations`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ rig, end, sink } = newMdcRig(destinations));
            rig.sender.doWork();
            if (sink.sends < destinations) {
                throw new Error('the MDC publication did not send to its ' + destinations + ' destinations');
            }
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

function mdcTimeoutsBench(destinations: number): SyncBench {
    let rig: SenderRig;
    return {
        name: `Sender destination timeouts (checkForReResolutions): manual MDC publication of ${destinations} destinations`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ rig } = newMdcRig(destinations));
        },
        op: () => {
            // the destinations are all live: the timeout is 5 s and the clock stays at the time they were added
            rig.poller.checkForReResolutions(rig.clock.nanoTime(), rig.conductorProxy as DriverConductorProxy);
        },
        teardown: () => rig.close(),
    };
}

export const benches: SyncBench[] = [
    ...STRATEGIES.flatMap((strategy) => RECEIVER_COUNTS.map((receivers) => statusMessageBench(strategy, receivers))),
    ...STRATEGIES.flatMap((strategy) => RECEIVER_COUNTS.map((receivers) => idleBench(strategy, receivers))),
    ...DESTINATION_COUNTS.map(mdcTimeoutsBench),
    ...DESTINATION_COUNTS.map(mdcDataBench),
];
