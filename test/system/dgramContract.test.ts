// The measured behaviour of Node's `dgram` that the UDP I/O model relies on (spec 4.2, N1 to N8). These are contract
// tests: they assert what Node does today, so that a Node upgrade that changes any of it fails CI instead of silently
// breaking the send slot (D2) or the receive ring (D1). They exercise `node:dgram` only, no port code.
import type { RemoteInfo, Socket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import {
    Collector,
    closeSocket,
    freeUdpPort,
    nextEvent,
    newSocket,
    skipUnlessRequired,
    waitUntil,
} from '../support/Udp.js';

/** An address that no host owns (TEST-NET-1, RFC 5737), so a datagram to it goes to the default route if there is one. */
const OFF_HOST = '192.0.2.1';
const OFF_HOST_PORT = 9;
const BURST = 2_000;
/** The most datagrams `offHostBurst` sends while it waits for the kernel send buffer to fill. */
const BURST_CAP = 50_000;
const MTU_PAYLOAD = 1_400;
/** A small SO_SNDBUF (Linux doubles it and enforces a floor), so a few datagrams fill the kernel buffer on any host. */
const SMALL_SNDBUF = 4_096;

/** The number of datagrams libuv reads from a socket in one loop iteration (`uv__udp_recvmsg`: 32 messages). */
const UV_RECV_BATCH = 32;

function datagram(text: string): Buffer {
    return Buffer.from(text, 'latin1');
}

/**
 * Sends datagrams to the off-host address from an unconnected socket until BURST of them are queued. Returns the queue count, or skips the
 * test (fails it under AERON_TS_REQUIRE_NET=1) when the host has no route off the host (the sends fail instead of queueing).
 */
function offHostBurst(socket: Socket, ctx: TestContext): number {
    socket.bind(0, '0.0.0.0');
    socket.setSendBufferSize(SMALL_SNDBUF);
    const chunk = Buffer.alloc(MTU_PAYLOAD);
    try {
        // synchronously, so the kernel cannot drain the buffer while it fills: it is full after a few hundred datagrams
        for (let i = 0; i < BURST_CAP && socket.getSendQueueCount() < BURST; i++) {
            socket.send(chunk, 0, chunk.length, OFF_HOST_PORT, OFF_HOST, () => {});
        }
    } catch (e) {
        const reason = 'no route off the host (' + (e as Error).message + ')';
        skipUnlessRequired(ctx, reason);
    }

    const queued = socket.getSendQueueCount();
    if (0 === queued) {
        const reason = 'no route off the host (the kernel took all ' + BURST_CAP + ' datagrams or refused them)';
        skipUnlessRequired(ctx, reason);
    }

    return queued;
}

describe('dgram contract (spec 4.2)', () => {
    // N1: with the default lookup, send(buf, port, ip) reads buf after send() returns.
    it('N1 default lookup reads the buffer after send returns', async () => {
        const receiver = new Collector();
        const sender = newSocket('udp4', false);
        const buffer = datagram('AAAA');

        sender.send(buffer, receiver.port, '127.0.0.1');
        buffer.write('BBBB', 0, 'latin1');

        await receiver.waitFor(1);
        expect(receiver.bytes(0)).toBe('BBBB');
    });

    // N2: with a synchronous lookup and IP literals, bind, connect and the send hand-off all run inside the call, and the
    // bytes are in the kernel when send() returns.
    it('N2 synchronous lookup runs bind, connect and send inside the call', async () => {
        const receiver = new Collector();
        const sender = newSocket();

        sender.bind(0, '127.0.0.1');
        expect(sender.address().port).toBeGreaterThan(0); // bound already: address() throws before the bind completes

        const connected = newSocket();
        connected.bind(0, '127.0.0.1');
        connected.connect(receiver.port, '127.0.0.1');
        expect(connected.remoteAddress()).toEqual(
            expect.objectContaining({ address: '127.0.0.1', port: receiver.port }),
        );

        const buffer = datagram('CCCC');
        sender.send(buffer, 0, buffer.length, receiver.port, '127.0.0.1');
        expect(sender.getSendQueueCount()).toBe(0); // libuv's queue was empty: uv_udp_try_send took it
        buffer.write('DDDD', 0, 'latin1');

        const second = datagram('EEEE');
        connected.send(second, 0, second.length);
        second.write('FFFF', 0, 'latin1');

        await receiver.waitFor(2);
        const texts = [receiver.bytes(0), receiver.bytes(1)].sort();
        expect(texts).toEqual(['CCCC', 'EEEE']);
    });

    // N3: with the kernel send buffer full, send() does not fail, libuv queues the datagram without limit and keeps a
    // reference to the caller's buffer. Needs a route off the host.
    it('N3 a full kernel send buffer queues datagrams without limit', async (ctx) => {
        const sender = newSocket();
        const queued = offHostBurst(sender, ctx);

        // The kernel takes what SO_SNDBUF holds and libuv queues the rest: many datagrams, with no limit and no error
        // (the measurement was 1,997 of 2,000 on the first host; here the loop runs until BURST are queued).
        expect(queued).toBeGreaterThanOrEqual(BURST);
        expect(sender.getSendQueueSize()).toBeGreaterThan(0);

        // Each further send queues exactly one request that holds its datagram's bytes (queue count +1, queue size
        // +length), and changing the caller's buffer afterwards neither errors nor changes that accounting: libuv keeps
        // its own reference to the buffer, so the caller may not reuse it until the callback (spec D2, which is why the
        // transport sends from a slot that it holds back).
        const countBefore = sender.getSendQueueCount();
        const sizeBefore = sender.getSendQueueSize();
        const tail = Buffer.alloc(MTU_PAYLOAD, 0x41);
        let completed = 0;
        sender.send(tail, 0, tail.length, OFF_HOST_PORT, OFF_HOST, () => completed++);
        tail.fill(0x42);
        expect(sender.getSendQueueCount()).toBe(countBefore + 1);
        expect(sender.getSendQueueSize()).toBe(sizeBefore + MTU_PAYLOAD);
        // a send callback never runs synchronously, so look one loop turn later: still queued behind the burst, not sent
        await new Promise((resolve) => setImmediate(resolve));
        expect(completed).toBe(0);
    });

    // N4: a send error arrives only through the callback, on a later tick; with no callback it is dropped silently.
    it('N4 send errors arrive only through the callback, on a later tick', async () => {
        const receiver = new Collector();
        const sender = newSocket();
        sender.bind(0, '127.0.0.1');
        const errors: Error[] = [];
        sender.on('error', (e) => errors.push(e));
        const tooBig = Buffer.alloc(70_000); // EMSGSIZE: over the 65,507-byte datagram limit

        let calledBackDuringSend = false;
        let inSend = true;
        let error: (Error & { code?: string }) | null = null;
        let called = false;
        sender.send(tooBig, 0, tooBig.length, receiver.port, '127.0.0.1', (err) => {
            calledBackDuringSend = inSend;
            error = err;
            called = true;
        });
        inSend = false; // send() returned without throwing

        expect(called).toBe(false);
        await waitUntil(() => called, 'the send callback');
        expect(calledBackDuringSend).toBe(false);
        expect((error as unknown as { code: string }).code).toBe('EMSGSIZE');

        // without a callback the error is dropped: nothing thrown, no 'error' event
        sender.send(tooBig, 0, tooBig.length, receiver.port, '127.0.0.1');
        const sentinel = datagram('OK');
        sender.send(sentinel, 0, sentinel.length, receiver.port, '127.0.0.1');
        await receiver.waitFor(1);
        expect(receiver.bytes(0)).toBe('OK');
        expect(errors).toEqual([]);
        expect(receiver.received.length).toBe(1);
    });

    // N5: on a connected socket an ICMP port-unreachable arrives as an 'error' event (ECONNREFUSED); an unconnected socket
    // never sees it.
    it('N5 a connected socket gets ECONNREFUSED as an error event, an unconnected one does not', async () => {
        const closedPort = freeUdpPort();

        const connected = newSocket();
        connected.bind(0, '127.0.0.1');
        connected.connect(closedPort, '127.0.0.1');
        const refused = nextEvent<[Error & { code?: string }]>(connected, 'error');
        connected.send(datagram('ping'), 0, 4);
        const [error] = await refused;
        expect(error.code).toBe('ECONNREFUSED');
        expect(error.message).toContain('recvmsg');

        // the unconnected socket sends to the same closed port, then to itself as a sentinel: the sentinel arrives and
        // no 'error' event came before it
        const unconnected = newSocket();
        const events: string[] = [];
        unconnected.on('error', () => events.push('error'));
        unconnected.on('message', () => events.push('message'));
        unconnected.bind(0, '127.0.0.1');
        unconnected.send(datagram('ping'), 0, 4, closedPort, '127.0.0.1');
        unconnected.send(datagram('self'), 0, 4, unconnected.address().port, '127.0.0.1');
        await waitUntil(() => events.length > 0, 'the sentinel');
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(events).toEqual(['message']);
    });

    // N6: with a synchronous lookup a bind failure is emitted as 'error' inside bind(), and socket options work right
    // after bind().
    it('N6 a bind failure is emitted inside bind and options work right after it', () => {
        const first = newSocket();
        first.bind(0, '127.0.0.1');
        const port = first.address().port;

        const second = newSocket();
        const events: string[] = [];
        second.on('error', (e: Error & { code?: string }) => events.push('error:' + e.code));
        second.bind(port, '127.0.0.1');
        expect(events).toEqual(['error:EADDRINUSE']); // already there when bind() returned

        const sizes = newSocket();
        sizes.bind(0, '127.0.0.1');
        sizes.setRecvBufferSize(64 * 1024);
        sizes.setSendBufferSize(64 * 1024);
        expect(sizes.getRecvBufferSize()).toBeGreaterThanOrEqual(64 * 1024);
        expect(sizes.getSendBufferSize()).toBeGreaterThanOrEqual(64 * 1024);
    });

    // N7: each 'message' brings a newly allocated Buffer and rinfo that the handler owns, and libuv delivers them in
    // bursts, never during synchronous JS.
    it('N7 each message has its own buffer and rinfo, delivered in bursts and never during synchronous JS', async () => {
        const receiver = new Collector();
        const sender = newSocket();
        sender.bind(0, '127.0.0.1');
        const perTurn: number[] = [];
        let seen = 0;
        const total = 300;

        for (let i = 0; i < total; i++) {
            const buffer = datagram('m' + String(i).padStart(4, '0'));
            sender.send(buffer, 0, buffer.length, receiver.port, '127.0.0.1');
        }

        // synchronous JS: nothing is delivered until we yield, however long we hold the thread
        const until = performance.now() + 20;
        while (performance.now() < until) {
            // hold the thread
        }
        expect(receiver.received.length).toBe(0);

        await waitUntil(() => {
            perTurn.push(receiver.received.length - seen);
            seen = receiver.received.length;
            return seen >= total / 2; // loopback may drop what overflows the receive buffer
        }, 'half of the burst');

        const messages = receiver.received.map((r) => r.message);
        const rinfos = receiver.received.map((r: { rinfo: RemoteInfo }) => r.rinfo);
        expect(new Set(messages).size).toBe(messages.length); // a Buffer per message
        expect(new Set(rinfos).size).toBe(rinfos.length); // an rinfo object per message
        // the first buffer still holds its datagram: the handler owns it
        expect(receiver.bytes(0)).toMatch(/^m\d{4}$/);
        // delivered in bursts of exactly libuv's batch of 32 datagrams per read loop, never more (a vacuous "> 1" would
        // pass for a burst of two)
        expect(Math.max(...perTurn)).toBe(UV_RECV_BATCH);
        expect(perTurn.every((n) => n <= UV_RECV_BATCH)).toBe(true);
    });

    // N8: close() cancels queued sends; their callbacks get ECANCELED. Needs a route off the host.
    it('N8 close cancels queued sends with ECANCELED', async (ctx) => {
        const sender = newSocket();
        const queued = offHostBurst(sender, ctx);

        // a fresh set of sends, now with callbacks, behind the queue
        const codes: (string | undefined)[] = [];
        const chunk = Buffer.alloc(MTU_PAYLOAD);
        for (let i = 0; i < 10; i++) {
            sender.send(chunk, 0, chunk.length, OFF_HOST_PORT, OFF_HOST, (err) =>
                codes.push((err as (Error & { code?: string }) | null)?.code ?? 'ok'),
            );
        }
        expect(sender.getSendQueueCount()).toBeGreaterThanOrEqual(queued);

        closeSocket(sender);
        await waitUntil(() => codes.length === 10, 'the callbacks of the queued sends');
        expect(codes.every((c) => 'ECANCELED' === c)).toBe(true);
    });
});
