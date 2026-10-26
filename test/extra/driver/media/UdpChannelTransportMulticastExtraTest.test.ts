// Extra tests of phase 3, T6 (port-only, D119): two multicast transports on one port and different groups, on a real
// socket on the loopback interface. Java's `DatagramChannel` turns IP_MULTICAST_ALL off, so a socket bound to the wildcard
// address sees only the groups it joined; node cannot set the option, and a socket bound to the wildcard address of Linux
// sees the datagrams of every group that any socket of the host has joined. The transport therefore binds a multicast
// socket to the group address, where the kernel does the filtering.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import type { PortManager } from '../../../../src/driver/media/PortManager.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { UdpChannelTransport } from '../../../../src/driver/media/UdpChannelTransport.js';
import { waitUntil } from '../../../support/Udp.js';

const GROUP_A = '239.192.11.87';
const GROUP_B = '239.192.11.91';
const PORT = 20123;

const noPortManager: PortManager = {
    getManagedPort: (_channel, address) => address,
    freeManagedPort: () => {},
};

class TestTransport extends UdpChannelTransport {
    public constructor(udpChannel: UdpChannel, context: MediaDriver.Context) {
        super(udpChannel, udpChannel.remoteData(), udpChannel.remoteData(), null, noPortManager, context);
    }
}

let context: MediaDriver.Context;
let transports: TestTransport[];

function open(group: string): TestTransport {
    const transport = new TestTransport(
        UdpChannel.parse('aeron:udp?endpoint=' + group + ':' + PORT + '|interface=127.0.0.1'),
        context,
    );
    transports.push(transport);
    transport.openDatagramChannel(null);
    return transport;
}

function bufferOf(text: string): UnsafeBuffer {
    const buffer = new UnsafeBuffer(new Uint8Array(text.length));
    for (let i = 0; i < text.length; i++) {
        buffer.putByte(i, text.charCodeAt(i));
    }
    return buffer;
}

async function receiveText(transport: TestTransport): Promise<string> {
    const buffer = new UnsafeBuffer(new Uint8Array(2048));
    await waitUntil(() => null !== transport.receive(buffer), 'a datagram');
    let text = '';
    for (let i = 0; i < transport.receivedLength(); i++) {
        text += String.fromCharCode(buffer.getByte(i));
    }
    return text;
}

beforeEach(() => {
    transports = [];
    context = new MediaDriver.Context().errorHandler({ onError: () => {} }).conclude();
});

afterEach(() => {
    for (const transport of transports) {
        transport.close();
    }
    context.close();
});

describe('multicast transports on one port', () => {
    it('aDatagramToOneGroupIsNotSeenByTheTransportOfAnotherGroupOnTheSamePort Regression', async () => {
        const a = open(GROUP_A);
        const b = open(GROUP_B);

        a.sendTo(bufferOf('to b'), 0, 4, new InetSocketAddress(GROUP_B, PORT));
        expect(await receiveText(b)).toBe('to b');
        a.sendTo(bufferOf('to a'), 0, 4, new InetSocketAddress(GROUP_A, PORT));
        // the datagram to the group A was sent after the one to the group B: a is first to see "to a", if it saw "to b" it
        // is the first text it gets
        expect(await receiveText(a)).toBe('to a');
    });

    it('aTransportOfAGroupStillReceivesFromItsOwnGroupAndSendsToIt Regression', async () => {
        const a = open(GROUP_A);
        const b = open(GROUP_A);

        b.sendTo(bufferOf('hello'), 0, 5, new InetSocketAddress(GROUP_A, PORT));

        expect(await receiveText(a)).toBe('hello');
        expect(await receiveText(b)).toBe('hello');
    });
});
