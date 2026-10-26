// Micro benches of the congestion and flow control hooks that run per status message or per rebuild (phase 2, batch 1
// fix): CubicCongestionControl.onTrackRebuild, StaticWindowCongestionControl.onTrackRebuild and
// UnicastFlowControl.onStatusMessage.
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { CubicCongestionControl } from '../../src/driver/ext/CubicCongestionControl.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { StaticWindowCongestionControl } from '../../src/driver/StaticWindowCongestionControl.js';
import { UnicastFlowControl } from '../../src/driver/UnicastFlowControl.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const TERM_LENGTH = 64 * 1024;
const MTU = 1408;
const URI = 'aeron:udp?endpoint=127.0.0.1:9999';
const SOURCE = new InetSocketAddress('127.0.0.1', 9999);

function newContext(): { context: MediaDriver.Context; counters: CountersManager } {
    const counters = new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(16 * CountersReader.METADATA_LENGTH)),
        new UnsafeBuffer(new ArrayBuffer(16 * CountersReader.COUNTER_LENGTH)),
    );
    const context = new MediaDriver.Context()
        .initialWindowLength(TERM_LENGTH / 2)
        .tempBuffer(new UnsafeBuffer(new ArrayBuffer(8192)));
    return { context, counters };
}

function cubicOnTrackRebuild(): SyncBench {
    let cc: CubicCongestionControl;
    let sink = 0;
    return {
        name: 'CubicCongestionControl onTrackRebuild',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            const { context, counters } = newContext();
            cc = new CubicCongestionControl(
                1,
                UdpChannel.parse(URI),
                2,
                3,
                TERM_LENGTH,
                MTU,
                SOURCE,
                SOURCE,
                new CachedNanoClock(),
                context,
                counters,
            );
        },
        op: (i) => {
            // 1 ms apart so that the window update interval passes; every 64th call reports a loss
            const position = i * 1024;
            const outcome = cc.onTrackRebuild(
                i * 1_000_000,
                position,
                position - 4096,
                position,
                position,
                position,
                0 === (i & 63),
            );
            sink = (sink + outcome) & 0xffff;
            if (sink < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function staticOnTrackRebuild(): SyncBench {
    let cc: StaticWindowCongestionControl;
    let sink = 0;
    return {
        name: 'StaticWindowCongestionControl onTrackRebuild',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            const { context } = newContext();
            cc = new StaticWindowCongestionControl(
                0,
                UdpChannel.parse(URI),
                2,
                3,
                TERM_LENGTH,
                MTU,
                SOURCE,
                SOURCE,
                null,
                context,
                null,
            );
        },
        op: (i) => {
            const position = i * 1024;
            sink =
                (sink + cc.onTrackRebuild(i, position, position - 4096, position, position, position, false)) & 0xffff;
            if (sink < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function unicastOnStatusMessage(): SyncBench {
    let flowControl: UnicastFlowControl;
    let sm: StatusMessageFlyweight;
    let limit = 0;
    return {
        name: 'UnicastFlowControl onStatusMessage',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            flowControl = new UnicastFlowControl();
            sm = new StatusMessageFlyweight(new UnsafeBuffer(new ArrayBuffer(64)));
            sm.consumptionTermId(5).consumptionTermOffset(0).receiverWindowLength(32768);
        },
        op: (i) => {
            sm.consumptionTermOffset((i & 1023) * 32);
            limit = flowControl.onStatusMessage(sm, SOURCE, limit & 0xffff, 5, 16, i);
        },
    };
}

export const benches: SyncBench[] = [cubicOnTrackRebuild(), staticOnTrackRebuild(), unicastOnStatusMessage()];
