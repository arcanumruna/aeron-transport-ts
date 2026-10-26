// Extra tests of issue #52 (port-only, spec D113): what one send through a transport allocates on a real loopback
// socket, compared with the least that node allocates for the same datagram. `socket.send(slot, 0, length, ...)` makes
// node slice the buffer (a view per send) and a host string goes through the socket's lookup, so the transport calls
// the form that does neither: a view of exactly the datagram length from a cache, the callback made once, and no host
// on a connected socket. What is left per send (the list, the closure of `afterDns`, the tick of the completion
// callback) is node's own, and is what the control socket allocates when it is sent the same datagram in the same form.
//
// The measure is the sampling heap profiler, as `bench:e2e` has it (spec D112): the bytes allocated under a frame of
// `src/` or of node's send, with the objects already freed counted. The loop yields to the event loop every BATCH
// sends, since the ticks of the completion callbacks run there. Each round measures the control and then the transport,
// and the median over the rounds of their difference is asserted: a heap profile of a run is noisy by a few tens of
// bytes per send (what V8 had optimized when), the slice and the lookup that the test is after are about 100.
import dgram from 'node:dgram';
import inspector from 'node:inspector/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import type { DataPacketDispatcher } from '../../../../src/driver/DataPacketDispatcher.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { syncLookup } from '../../../support/Udp.js';

const SENDS = 40_000;
const WARM_UP_SENDS = 30_000;
const BATCH = 100;
const LENGTH = 1408;
const ROUNDS = 7;

/**
 * What the transport may allocate per send above the control. The heap profile is bimodal in exact steps of 40 bytes
 * (570 or 610 bytes per send, by what V8 had optimized when), so the median of the paired differences is 0 or about
 * 40.5 at most, and a slack of 40 is borderline by construction. The slice of `Socket.send` that this test guards
 * measures a median of about 97 bytes above the control (mutation: `send(slot, 0, length, cb)`), so 60 sits between the
 * noise step and the defect, with margin on both sides. Allocations inlined into the caller (e.g. in `dispatch`) are
 * not attributed to a frame of `src/` or of node's send, so this test guards node's send slice specifically.
 */
const SLACK_BYTES = 60;

interface ProfileNode {
    callFrame: { url: string; functionName: string };
    selfSize: number;
    children: ProfileNode[];
}

/** A frame of the send: a function of `src/`, or the part of node's `dgram` that a send runs. */
function isSendFrame(frame: ProfileNode['callFrame']): boolean {
    return (
        frame.url.includes('/src/') ||
        ('node:dgram' === frame.url && /^(Socket\.send|doSend|afterDns|enqueue)$/.test(frame.functionName))
    );
}

/**
 * The bytes in a profile that were allocated under a frame of the send. V8 leaves the frames that it inlined out of the
 * sample, so the port's own frames can be missing from a stack that `Socket.send` is on: that frame counts too. The
 * datagrams the receiving socket gets are allocated under its 'message' event and do not count.
 */
function bytesUnderSend(node: ProfileNode, underSend: boolean): number {
    const isSend = underSend || isSendFrame(node.callFrame);
    let bytes = isSend ? node.selfSize : 0;
    for (const child of node.children) {
        bytes += bytesUnderSend(child, isSend);
    }
    return bytes;
}

let receiver: dgram.Socket;
let endpoint: SendChannelEndpoint;
let unconnected: ReceiveChannelEndpoint;
let controlConnected: dgram.Socket;
let controlUnconnected: dgram.Socket;
let context: MediaDriver.Context;
let errors: Error[];

beforeEach(async () => {
    errors = [];
    context = new MediaDriver.Context().errorHandler({ onError: (e) => errors.push(e) }).conclude();
    receiver = dgram.createSocket({ type: 'udp4', lookup: syncLookup });
    await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
    receiver.on('message', () => {});
    const port = receiver.address().port;

    endpoint = new SendChannelEndpoint(
        UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:' + port),
        context.countersManager()!.newCounter('status'),
        context,
    );
    endpoint.openDatagramChannel(null);
    unconnected = new ReceiveChannelEndpoint(
        UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
        {} as unknown as DataPacketDispatcher,
        context.countersManager()!.newCounter('status'),
        context,
    );
    unconnected.openDatagramChannel(null);

    controlConnected = dgram.createSocket({ type: 'udp4', lookup: syncLookup });
    await new Promise<void>((resolve) => controlConnected.connect(port, '127.0.0.1', resolve));
    controlUnconnected = dgram.createSocket({ type: 'udp4', lookup: syncLookup });
    await new Promise<void>((resolve) => controlUnconnected.bind(0, '127.0.0.1', resolve));
});

afterEach(() => {
    endpoint.close();
    unconnected.close();
    controlConnected.close();
    controlUnconnected.close();
    receiver.close();
    context.close();
    expect(errors).toEqual([]);
});

/** Bytes allocated under the send per send, over SENDS sends after a warm up. */
async function bytesPerSend(send: () => number): Promise<number> {
    const run = async (sends: number): Promise<number> => {
        let sent = 0;
        for (let done = 0; done < sends; done += BATCH) {
            for (let i = 0; i < BATCH; i++) {
                sent += send();
            }
            await new Promise((resolve) => setImmediate(resolve));
        }
        return sent;
    };

    await run(WARM_UP_SENDS);
    const session = new inspector.Session();
    session.connect();
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', {
        samplingInterval: 32,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
    } as never);
    const sent = await run(SENDS);
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();

    expect(sent).toBe(SENDS * LENGTH);
    return bytesUnderSend(profile.head as ProfileNode, false) / SENDS;
}

/** The median of `values`. */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return 1 === (sorted.length & 1)
        ? (sorted[middle] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * The median over ROUNDS paired rounds of the bytes per send of the transport minus those of the control, each round
 * measuring the control and then the transport, so that a drift of the heap profile hits both of a pair.
 */
async function compare(transport: () => number, control: () => number): Promise<{ delta: number; control: number }> {
    const deltas: number[] = [];
    const controls: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
        const controlBytes = await bytesPerSend(control);
        const transportBytes = await bytesPerSend(transport);
        controls.push(controlBytes);
        deltas.push(transportBytes - controlBytes);
    }

    return { delta: median(deltas), control: median(controls) };
}

describe('UdpChannelTransportSendAllocationTest', () => {
    it('Regression: a connected send allocates what node does for the datagram and no more (no slice)', async () => {
        const buffer = new UnsafeBuffer(new Uint8Array(2048));
        const view = new Uint8Array(LENGTH);
        const done = (): void => {};

        const { delta, control } = await compare(
            () => endpoint.send(buffer, 0, LENGTH),
            () => {
                controlConnected.send(view, done);
                return LENGTH;
            },
        );

        expect(delta, `median bytes per connected send above node's (node: ${control})`).toBeLessThan(SLACK_BYTES);
    }, 120_000);

    it('Regression: a send to an address allocates what node does for the datagram and no more (no slice, no lookup)', async () => {
        const buffer = new UnsafeBuffer(new Uint8Array(2048));
        const view = new Uint8Array(LENGTH);
        const done = (): void => {};
        const port = receiver.address().port;
        const target = new InetSocketAddress('127.0.0.1', port);

        const { delta, control } = await compare(
            () => unconnected.sendTo(buffer, 0, LENGTH, target),
            () => {
                controlUnconnected.send(view, port, '127.0.0.1', done);
                return LENGTH;
            },
        );

        expect(delta, `median bytes per sendTo above node's (node: ${control})`).toBeLessThan(SLACK_BYTES);
    }, 120_000);
});
