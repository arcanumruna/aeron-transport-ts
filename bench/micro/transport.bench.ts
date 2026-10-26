// Micro benches of the per-datagram paths of UdpChannelTransport (phase 2, T12, spec 4.2): the receive path (the
// 'message' handler puts a datagram in the ring, `receive` copies it into the poller's buffer), for a repeated sender and
// for two senders that alternate (the source address is rebuilt on each change), and the send path (copy to the send slot,
// hand to the socket) with a socket that takes the datagram and does nothing, so the number is this port's own cost and
// not the kernel's.
import type { RemoteInfo, Socket } from 'node:dgram';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { UdpChannelTransport } from '../../src/driver/media/UdpChannelTransport.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const DATAGRAM_LENGTH = 128;
const MTU = 1408;

class BenchTransport extends UdpChannelTransport {
    public constructor(context: MediaDriver.Context) {
        const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0');
        super(
            channel,
            channel.remoteData(),
            new InetSocketAddress('127.0.0.1', 0),
            null,
            { getManagedPort: (_channel, address) => address, freeManagedPort: () => {} },
            context,
        );
    }
}

function rinfo(address: string, port: number): RemoteInfo {
    return { address, family: 'IPv4', port, size: DATAGRAM_LENGTH };
}

function newTransport(): { context: MediaDriver.Context; transport: BenchTransport } {
    const context = new MediaDriver.Context().conclude();
    return { context, transport: new BenchTransport(context) };
}

function receiveBench(name: string, alternate: boolean): SyncBench {
    let context: MediaDriver.Context;
    let transport: BenchTransport;
    let buffer: UnsafeBuffer;
    const message = new Uint8Array(DATAGRAM_LENGTH);
    const a = rinfo('10.0.0.1', 5000);
    const b = rinfo('10.0.0.2', 5001);
    let sink = 0;
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ context, transport } = newTransport());
            transport.openDatagramChannel(null);
            buffer = new UnsafeBuffer(new ArrayBuffer(65504));
        },
        op: (i) => {
            transport.onMessage(message, alternate && (i & 1) === 1 ? b : a);
            if (null === transport.receive(buffer)) {
                throw new Error('lost');
            }
            sink = (sink + transport.receivedLength()) & 0xffff;
        },
        teardown: () => {
            transport.close();
            context.close();
            if (sink < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function sendBench(name: string, connected: boolean): SyncBench {
    let context: MediaDriver.Context;
    let transport: BenchTransport;
    let buffer: UnsafeBuffer;
    const target = new InetSocketAddress('127.0.0.1', 4444);
    let sends = 0;
    const socket = {
        getSendQueueCount: () => 0,
        send: () => {
            sends++;
        },
        close: () => {},
    };
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            ({ context, transport } = newTransport());
            transport.sendDatagramChannel = socket as unknown as Socket;
            buffer = new UnsafeBuffer(new ArrayBuffer(MTU));
        },
        op: () => {
            const sent = connected ? transport.send(buffer, 0, MTU) : transport.sendTo(buffer, 0, MTU, target);
            if (MTU !== sent) {
                throw new Error('short');
            }
        },
        teardown: () => {
            transport.close();
            context.close();
            if (sends < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

export const benches: SyncBench[] = [
    receiveBench('UdpChannelTransport onMessage+receive 128B, repeated sender', false),
    receiveBench('UdpChannelTransport onMessage+receive 128B, two senders alternating', true),
    sendBench('UdpChannelTransport sendTo 1408B (slot copy + socket.send)', false),
    sendBench('UdpChannelTransport send 1408B, connected (slot copy + socket.send)', true),
];
