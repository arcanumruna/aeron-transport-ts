// The CI probe of phase 3 (plan decision 2): can this host send to a multicast group on the loopback interface and
// receive it on two sockets that share the port? A runner that cannot fails here, with the reason, before the suite
// runs, so that a red multicast test is never just a missing route. Group 224.20.30.39, interface 127.0.0.1.
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
