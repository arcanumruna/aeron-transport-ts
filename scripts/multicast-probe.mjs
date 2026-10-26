// The CI probe of phase 3 (plan decision 2): can this host send to a multicast group on the loopback interface and
// receive it on two sockets that share the port? A runner that cannot fails here, with the reason, before the suite
// runs, so that a red multicast test is never just a missing route. Group 224.20.30.39, interface 127.0.0.1.
//
// An IPv6 leg follows (Linux only: group ff05::11:77 on the interface `lo`, or MULTICAST_PROBE_IPV6_INTERFACE). The IPv6
// multicast tests skip on a host that cannot do it, so the leg reports it (a warning, and an annotation on GitHub); with
// REQUIRE_IPV6_MULTICAST=1, which CI sets, it fails like the IPv4 leg (issue #64).
import { Buffer } from 'node:buffer';
import dgram from 'node:dgram';
import { setImmediate } from 'node:timers';

const GROUP = '224.20.30.39';
const INTERFACE = '127.0.0.1';
const TURN_CAP = 2_000_000;

function fail(reason) {
    console.error('multicast probe FAILED: ' + reason);
    console.error(
        'group ' + GROUP + ', interface ' + INTERFACE + ': the multicast system tests cannot run on this host',
    );
    process.exit(1);
}

const received = [0, 0];
const sockets = [0, 1].map((i) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', () => void received[i]++);
    socket.on('error', (e) => fail(String(e)));
    return socket;
});

const first = sockets[0];
await new Promise((resolve) => first.bind(0, resolve));
const port = first.address().port;
await new Promise((resolve) => sockets[1].bind(port, resolve));
try {
    for (const socket of sockets) {
        socket.addMembership(GROUP, INTERFACE);
    }
    const sender = dgram.createSocket({ type: 'udp4' });
    sender.on('error', (e) => fail(String(e)));
    await new Promise((resolve) => sender.bind(0, resolve));
    sender.setMulticastInterface(INTERFACE);
    sender.send(Buffer.from('probe'), port, GROUP);
    for (let turn = 0; turn < TURN_CAP && (received[0] < 1 || received[1] < 1); turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    sender.close();
} catch (e) {
    fail(String(e));
}

for (const socket of sockets) {
    socket.close();
}
if (received[0] < 1 || received[1] < 1) {
    fail('the datagram sent to the group reached ' + received[0] + ' and ' + received[1] + ' of the 2 members');
}
console.log('multicast probe ok: group ' + GROUP + ' on ' + INTERFACE + ', port ' + port + ', 2 members');

// The IPv6 leg.
const IPV6_GROUP = 'ff05::11:77';
const IPV6_INTERFACE = process.env['MULTICAST_PROBE_IPV6_INTERFACE'] ?? 'lo';

/** Binds to an ephemeral port; rejects when the bind fails (a host without IPv6 emits the error and never calls back). */
function bound(socket) {
    return new Promise((resolve, reject) => {
        socket.once('listening', resolve);
        socket.once('error', reject);
        socket.bind(0);
    });
}

/** Resolves with null when a datagram sent to the group reaches a socket that joined it, otherwise with the reason. */
async function probeIpv6() {
    if ('linux' !== process.platform) {
        return 'not checked on ' + process.platform;
    }

    const receiver = dgram.createSocket({ type: 'udp6', reuseAddr: true });
    const sender = dgram.createSocket({ type: 'udp6' });
    let got = false;
    let error = null;
    receiver.on('message', () => (got = true));
    receiver.on('error', (e) => (error = String(e)));
    sender.on('error', (e) => (error = String(e)));
    try {
        await bound(receiver);
        receiver.addMembership(IPV6_GROUP, '::%' + IPV6_INTERFACE);
        await bound(sender);
        sender.setMulticastInterface('::%' + IPV6_INTERFACE);
        sender.setMulticastLoopback(true);
        sender.send(Buffer.from('probe'), receiver.address().port, IPV6_GROUP);
        for (let turn = 0; turn < TURN_CAP && !got && null === error; turn++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    } catch (e) {
        error = String(e);
    } finally {
        receiver.close();
        sender.close();
    }

    if (got) {
        return null;
    }

    return error ?? 'the datagram sent to the group did not arrive';
}

const ipv6Reason = await probeIpv6();
if (null === ipv6Reason) {
    console.log('multicast probe ok: IPv6 group ' + IPV6_GROUP + ' on ' + IPV6_INTERFACE);
} else if ('1' === process.env['REQUIRE_IPV6_MULTICAST']) {
    console.error('multicast probe FAILED: IPv6 group ' + IPV6_GROUP + ' on ' + IPV6_INTERFACE + ': ' + ipv6Reason);
    console.error('REQUIRE_IPV6_MULTICAST=1: the IPv6 multicast tests cannot run on this host');
    process.exit(1);
} else {
    const message = 'IPv6 multicast probe unavailable on ' + IPV6_INTERFACE + ': ' + ipv6Reason;
    console.log('multicast probe: ' + message + ' (the IPv6 multicast tests skip)');
    if ('true' === process.env['GITHUB_ACTIONS']) {
        console.log('::warning title=IPv6 multicast::' + message);
    }
}
