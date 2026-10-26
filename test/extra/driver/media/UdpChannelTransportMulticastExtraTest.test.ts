// Extra tests of phase 3, T6 (port-only, D119): two multicast transports on one port and different groups, on a real
// socket on the loopback interface. Java's `DatagramChannel` turns IP_MULTICAST_ALL off, so a socket bound to the wildcard
// address sees only the groups it joined; node cannot set the option, and a socket bound to the wildcard address of Linux
// sees the datagrams of every group that any socket of the host has joined. The transport therefore binds a multicast
// socket to the group address, where the kernel does the filtering (IPv4, and IPv6 with the scope of the interface for a
// link-local group). Linux only: elsewhere node's sockets already filter (macOS) or cannot bind a group (Windows).
import dgram from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import type { PortManager } from '../../../../src/driver/media/PortManager.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { UdpChannelTransport } from '../../../../src/driver/media/UdpChannelTransport.js';
import { waitUntilTurns } from '../../../support/Udp.js';

const PORT = 20123;
const IS_LINUX = 'linux' === process.platform;

interface Family {
    readonly name: string;
    readonly groupA: string;
    readonly groupB: string;
    readonly endpoint: (group: string) => string;
    readonly interface: string;
}

const IPV4: Family = {
    name: 'IPv4',
    groupA: '239.192.11.87',
    groupB: '239.192.11.91',
    endpoint: (group) => group,
    interface: '127.0.0.1',
};
const IPV6: Family = {
    name: 'IPv6',
    groupA: 'ff05::11:87',
    groupB: 'ff05::11:91',
    endpoint: (group) => '[' + group + ']',
    interface: '[::1]',
};
const IPV6_LINK_LOCAL: Family = {
    name: 'IPv6 link-local',
    groupA: 'ff02::11:87',
    groupB: 'ff02::11:91',
    endpoint: (group) => '[' + group + ']',
    interface: '[::1]',
};

/** Resolves when the socket is bound; rejects when its bind fails (no IPv6 on the host). */
function listening(socket: dgram.Socket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        socket.once('listening', () => resolve());
        socket.once('error', reject);
    });
}

/** Whether this host passes IPv6 multicast over `lo`: a datagram to a group is received by a socket that joined it. */
async function ipv6MulticastWorks(): Promise<boolean> {
    if (!IS_LINUX) {
        return false;
    }
    const receiver = dgram.createSocket({ type: 'udp6', reuseAddr: true });
    const sender = dgram.createSocket({ type: 'udp6' });
    receiver.on('error', () => {});
    sender.on('error', () => {});
    let got = false;
    try {
        receiver.on('message', () => (got = true));
        receiver.bind(0);
        await listening(receiver);
        receiver.addMembership('ff05::11:77', '::%lo');
        sender.bind(0);
        await listening(sender);
        sender.setMulticastInterface('::%lo');
        sender.setMulticastLoopback(true);
        sender.send('x', receiver.address().port, 'ff05::11:77');
        await waitUntilTurns(() => got, 'the probe datagram', 50_000);
    } catch {
        return false;
    } finally {
        receiver.close();
        sender.close();
    }
    return got;
}

const ipv6Works = await ipv6MulticastWorks();

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

function open(family: Family, group: string): TestTransport {
    const transport = new TestTransport(
        UdpChannel.parse(
            'aeron:udp?endpoint=' + family.endpoint(group) + ':' + PORT + '|interface=' + family.interface,
        ),
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
    await waitUntilTurns(() => null !== transport.receive(buffer), 'a datagram');
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

const IPV6_SKIP = 'IPv6 multicast over lo does not work on this host';

describe.skipIf(!IS_LINUX)('multicast transports on one port', () => {
    // Issue #64: the IPv6 rows below skip on a host without IPv6 multicast; CI sets REQUIRE_IPV6_MULTICAST=1 so that the
    // skip is a failure there (`scripts/multicast-probe.mjs` has the same rule).
    it.runIf('1' === process.env['REQUIRE_IPV6_MULTICAST'])(
        'ipv6MulticastIsAvailableWhenTheHostIsRequiredToHaveIt Regression',
        () => {
            expect(ipv6Works, 'REQUIRE_IPV6_MULTICAST=1 but ' + IPV6_SKIP).toBe(true);
        },
    );

    const cases: [Family, boolean][] = [
        [IPV4, true],
        [IPV6, ipv6Works],
        [IPV6_LINK_LOCAL, ipv6Works],
    ];
    for (const [family, enabled] of cases) {
        describe.skipIf(!enabled)(family.name + (enabled ? '' : ' (' + IPV6_SKIP + ')'), () => {
            it('aDatagramToOneGroupIsNotSeenByTheTransportOfAnotherGroupOnTheSamePort Regression', async () => {
                const a = open(family, family.groupA);
                const b = open(family, family.groupB);

                a.sendTo(bufferOf('to b'), 0, 4, new InetSocketAddress(family.groupB, PORT));
                expect(await receiveText(b)).toBe('to b');
                a.sendTo(bufferOf('to a'), 0, 4, new InetSocketAddress(family.groupA, PORT));
                // the datagram to the group A was sent after the one to the group B: a is first to see "to a", if it saw
                // "to b" it is the first text it gets
                expect(await receiveText(a)).toBe('to a');
            });

            it('aTransportOfAGroupStillReceivesFromItsOwnGroupAndSendsToIt Regression', async () => {
                const a = open(family, family.groupA);
                const b = open(family, family.groupA);

                b.sendTo(bufferOf('hello'), 0, 5, new InetSocketAddress(family.groupA, PORT));

                expect(await receiveText(a)).toBe('hello');
                expect(await receiveText(b)).toBe('hello');
            });
        });
    }

    // Documented difference of D119: Java's wildcard-bound socket receives unicast to its port, a socket bound to the
    // group does not.
    it('aTransportBoundToItsGroupDoesNotReceiveUnicastToThePort Regression', async () => {
        const a = open(IPV4, IPV4.groupA);
        const unicast = dgram.createSocket('udp4');
        try {
            await new Promise<void>((resolve) => unicast.send('unicast', PORT, '127.0.0.1', () => resolve()));
            a.sendTo(bufferOf('group'), 0, 5, new InetSocketAddress(IPV4.groupA, PORT));
            // the unicast datagram was sent first and on the same loopback path: it would be the first text
            expect(await receiveText(a)).toBe('group');
        } finally {
            unicast.close();
        }
    });

    // The host of the receive bind, without a socket (so also on a host without IPv6): the private selector, called directly.
    describe('the host of the receive bind of an IPv6 channel', () => {
        type Selector = (c: UdpChannel, a: InetSocketAddress, i: string | undefined) => string | null;
        const bindHostOf = (endpoint: string, scope: string | undefined): string | null => {
            const channel = UdpChannel.parse('aeron:udp?endpoint=' + endpoint + ':' + PORT);
            const select = (UdpChannelTransport as unknown as { multicastBindHost: Selector }).multicastBindHost;
            return select(channel, channel.remoteData(), scope);
        };

        it.skipIf(!IS_LINUX)('isTheSiteScopeGroupWithoutAScope Regression', () => {
            expect(bindHostOf('[ff05::11:87]', '::%lo')).toBe('ff05:0:0:0:0:0:11:87');
            expect(bindHostOf('[ff0e::11:87]', undefined)).toBe('ff0e:0:0:0:0:0:11:87');
        });

        it.skipIf(!IS_LINUX)('isTheLinkLocalGroupWithTheScopeOfTheInterface Regression', () => {
            expect(bindHostOf('[ff02::11:87]', '::%lo')).toBe('ff02:0:0:0:0:0:11:87%lo');
            expect(bindHostOf('[ff01::11:87]', '::%lo')).toBe('ff01:0:0:0:0:0:11:87%lo');
        });

        it.skipIf(!IS_LINUX)('isTheWildcardForALinkLocalGroupWithoutAnInterface Regression', () => {
            expect(bindHostOf('[ff02::11:87]', undefined)).toBeNull();
        });
    });
});
