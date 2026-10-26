// Extra tests of T21 (port-only, spec 5.3): the drop check allocates nothing per packet, in the generators (after the
// first frame of a stream and session, which makes its entry) and in the debug endpoints that call them. The endpoint
// each debug endpoint extends is replaced on its prototype by a function that does nothing, so that only the code of
// this task is measured, and the counters and the socket stay out.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CachedNanoClock } from '../../../../src/agrona/concurrent/CachedNanoClock.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { DataPacketDispatcher } from '../../../../src/driver/DataPacketDispatcher.js';
import { DebugChannelEndpointConfiguration } from '../../../../src/driver/ext/DebugChannelEndpointConfiguration.js';
import { DebugReceiveChannelEndpoint } from '../../../../src/driver/ext/DebugReceiveChannelEndpoint.js';
import { DebugSendChannelEndpoint } from '../../../../src/driver/ext/DebugSendChannelEndpoint.js';
import { FixedLossGenerator } from '../../../../src/driver/ext/FixedLossGenerator.js';
import type { LossGenerator } from '../../../../src/driver/ext/LossGenerator.js';
import { MultiGapLossGenerator } from '../../../../src/driver/ext/MultiGapLossGenerator.js';
import { RandomLossGenerator } from '../../../../src/driver/ext/RandomLossGenerator.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../../../src/driver/media/WildcardPortManager.js';
import { SystemCounters } from '../../../../src/driver/status/SystemCounters.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { newPlainConductorProxy } from '../../../support/ConductorProxyFake.js';
import { mock } from '../../../support/Mockito.js';

const ITERATIONS = 500_000;
const SOURCE = new InetSocketAddress('127.0.0.1', 40224);

/** Drops every other call, with a counter that wraps and no allocation. */
class AlternatingLossGenerator implements LossGenerator {
    public calls = 0;

    public shouldDropFrame(
        _address: InetSocketAddress | null,
        _buffer: UnsafeBuffer | null,
        _a: number,
        _b?: number,
        _c?: number,
        _d?: number,
        _e?: number,
    ): boolean {
        return 0 !== (++this.calls & 1);
    }
}

describe('LossGeneratorAllocationTest', () => {
    it('the fixed generator allocates nothing once a stream has its entry', async () => {
        const generator = new FixedLossGenerator(7, 1408, 4 * 1408);
        let drops = 0;
        generator.shouldDropFrame(null, null, 1, 2, 7, 0, 1408);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (generator.shouldDropFrame(null, null, 1, 2, 7, (i & 63) * 1408, 1408)) {
                    drops++;
                }
                if (generator.shouldDropFrame(null, null, 3 + (i & 7), -2 - (i & 3), 7, 5 * 1408, 1408)) {
                    drops++;
                }
            }
        }, ITERATIONS);

        expect(drops).toBeGreaterThanOrEqual(0);
    });

    it('the multi gap generator allocates nothing once a stream has its entry', async () => {
        const generator = new MultiGapLossGenerator(7, 1024, 256, 1000);
        let drops = 0;
        generator.shouldDropFrame(null, null, 1, 2, 7, 0, 128);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (generator.shouldDropFrame(null, null, 1, 2, 7, (i & 0xfffff) * 128 + 128, 128)) {
                    drops++;
                }
                generator.shouldDropFrame(null, null, 1, 2, 6, i, 128);
            }
        }, ITERATIONS);

        expect(drops).toBeGreaterThanOrEqual(0);
    });

    it('the random generator allocates nothing per frame', async () => {
        const generator = new RandomLossGenerator(0.2, 4242);
        let drops = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (generator.shouldDropFrame(null, null, 1408)) {
                    drops++;
                }
                if (generator.shouldDropFrame(null, null, 1, 2, 3, i, 1408)) {
                    drops++;
                }
            }
        }, ITERATIONS);

        expect(drops).toBeGreaterThan(0);
    });

    it('the generator of a rate of zero allocates nothing per frame', async () => {
        const generator = DebugChannelEndpointConfiguration.lossGeneratorSupplier(0, -1);
        let drops = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (generator.shouldDropFrame(null, null, 1408)) {
                    drops++;
                }
            }
        }, ITERATIONS);

        expect(drops).toBe(0);
    });
});

describe('DebugEndpointsAllocationTest', () => {
    const nanoClock = new CachedNanoClock();
    const systemCounters = mock(SystemCounters).mock;
    const counter = mock(AtomicCounter).mock;
    const dispatcher = mock(DataPacketDispatcher).mock;
    const conductorProxy = newPlainConductorProxy();
    const context = new MediaDriver.Context()
        .systemCounters(systemCounters)
        .cachedNanoClock(nanoClock)
        .senderCachedNanoClock(nanoClock)
        .receiverCachedNanoClock(nanoClock)
        .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
        .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
        .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));

    const frame = new UnsafeBuffer(new Uint8Array(4096));
    const statusMessage = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const nak = new NakFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const dataHeader = new DataHeaderFlyweight(new UnsafeBuffer(new Uint8Array(64)));

    // The members of the two endpoints, saved to be put back, and the no-ops that replace them.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const sendProto = SendChannelEndpoint.prototype as any;
    const receiveProto = ReceiveChannelEndpoint.prototype as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const saved: [object, string, unknown][] = [];

    function replace(proto: object, name: string, replacement: unknown): void {
        saved.push([proto, name, (proto as Record<string, unknown>)[name]]);
        (proto as Record<string, unknown>)[name] = replacement;
    }

    beforeAll(() => {
        vi.mocked(systemCounters.get).mockReturnValue(counter);
        replace(sendProto, 'send', (_buffer: unknown, _offset: number, length: number): number => length);
        replace(sendProto, 'onStatusMessage', (): void => {});
        replace(sendProto, 'onNakMessage', (): void => {});
        replace(receiveProto, 'sendTo', (_buffer: unknown, _offset: number, length: number): number => length);
        replace(receiveProto, 'onDataPacket', (): number => 1);
    });

    afterAll(() => {
        for (const [proto, name, original] of saved.reverse()) {
            (proto as Record<string, unknown>)[name] = original;
        }
    });

    it('the debug send endpoint allocates nothing per data frame or control frame', async () => {
        const data = new AlternatingLossGenerator();
        const control = new AlternatingLossGenerator();
        const channel = UdpChannel.parse('aeron:udp?interface=localhost:40224|endpoint=localhost:40223');
        const endpoint = new DebugSendChannelEndpoint(channel, counter, context, data, control);
        let sent = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sent += endpoint.send(frame, (i & 31) * 64, 64);
                endpoint.onStatusMessage(statusMessage, frame, 36, SOURCE, conductorProxy);
                endpoint.onNakMessage(nak, frame, 28, SOURCE);
            }
        }, ITERATIONS);

        expect(sent).toBeGreaterThan(0);
        expect(data.calls).toBeGreaterThan(ITERATIONS);
        expect(control.calls).toBeGreaterThan(2 * ITERATIONS);
    });

    it('the debug receive endpoint allocates nothing per data packet or control frame', async () => {
        const data = new AlternatingLossGenerator();
        const control = new AlternatingLossGenerator();
        const channel = UdpChannel.parse('aeron:udp?endpoint=localhost:40223');
        const endpoint = new DebugReceiveChannelEndpoint(channel, dispatcher, counter, context, data, control);
        dataHeader.streamId(1).sessionId(2).termId(3).termOffset(0);
        let applied = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                applied += endpoint.onDataPacket(dataHeader, frame, 1408, SOURCE, 0);
                applied += endpoint.sendTo(frame, (i & 31) * 64, 32, SOURCE);
            }
        }, ITERATIONS);

        expect(applied).toBeGreaterThan(0);
        expect(data.calls).toBeGreaterThan(ITERATIONS);
        expect(control.calls).toBeGreaterThan(ITERATIONS);
    });

    it('the debug endpoints with the default generators allocate nothing per packet', async () => {
        const sendChannel = UdpChannel.parse('aeron:udp?interface=localhost:40224|endpoint=localhost:40223');
        const receiveChannel = UdpChannel.parse('aeron:udp?endpoint=localhost:40223');
        const send = new DebugSendChannelEndpoint(sendChannel, counter, context);
        const receive = new DebugReceiveChannelEndpoint(receiveChannel, dispatcher, counter, context);
        let total = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                total += send.send(frame, 0, 64);
                total += receive.onDataPacket(dataHeader, frame, 1408, SOURCE, 0);
            }
        }, ITERATIONS);

        expect(total).toBeGreaterThan(0);
    });
});
