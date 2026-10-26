// The CI probe for the dgram contract tests N3 and N8 (#38): does a burst of datagrams to the off-host address fill the
// kernel send buffer, so that libuv queues the rest? On a runner whose NIC drains every send at once it never does, and
// the tests would fail under AERON_TS_REQUIRE_NET=1 for a reason of the host, not the code. CI routes the address to a
// dummy interface behind a slow tbf qdisc first, which holds the datagrams charged to the socket; a host where that did
// not take effect fails here, with the reason, before the suite runs. Same constants as test/system/dgramContract.test.ts.
import { Buffer } from 'node:buffer';
import dgram from 'node:dgram';

const OFF_HOST = '192.0.2.1';
const OFF_HOST_PORT = 9;
const BURST = 2_000;
const BURST_CAP = 50_000;
const MTU_PAYLOAD = 1_400;
const SMALL_SNDBUF = 4_096;

const socket = dgram.createSocket({ type: 'udp4', lookup: (h, o, cb) => cb(null, h, 4) });
socket.bind(0, '0.0.0.0');
socket.setSendBufferSize(SMALL_SNDBUF);
const chunk = Buffer.alloc(MTU_PAYLOAD);
let sent = 0;
try {
    for (; sent < BURST_CAP && socket.getSendQueueCount() < BURST; sent++) {
        socket.send(chunk, 0, chunk.length, OFF_HOST_PORT, OFF_HOST, () => {});
    }
} catch (e) {
    console.error('off-host probe FAILED: no route to ' + OFF_HOST + ' (' + e.message + ')');
    process.exit(1);
}
const queued = socket.getSendQueueCount();
if (queued < BURST) {
    console.error(
        'off-host probe FAILED: ' +
            sent +
            ' datagrams to ' +
            OFF_HOST +
            ' queued only ' +
            queued +
            ' in libuv: the kernel drained the send buffer, so dgram contract tests N3 and N8 cannot run on this host',
    );
    process.exit(1);
}
console.log('off-host probe ok: ' + queued + ' of ' + sent + ' datagrams to ' + OFF_HOST + ' queued in libuv');
process.exit(0);
