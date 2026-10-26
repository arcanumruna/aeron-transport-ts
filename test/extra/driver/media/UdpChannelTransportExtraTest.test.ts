/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Extra tests of T12 (port-only): the UDP I/O model of spec 4.2 on `UdpChannelTransport`. The send slot (D2): a buffer
// changed after `send` arrives unchanged on the synchronous and on the queued path, a send while libuv still holds a
// datagram returns 0 and leaves the slot alone, deferred send and socket errors reach the error handler at the next
// poll while `ECONNREFUSED` and `ECANCELED` never do. The receive ring (D1): one datagram per poll, overflow drops and
// counts, `close()` clears it. A bind failure throws synchronously. The last sender's address is reused, with
// `expectNoAllocation` on the receive and the send path. And the real thing: two transports over loopback.
import type { RemoteInfo, Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorHandler } from '../../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { AeronEvent } from '../../../../src/client/exceptions/AeronEvent.js';
import { AeronException } from '../../../../src/client/exceptions/AeronException.js';
import { ChannelEndpointStatus } from '../../../../src/client/status/ChannelEndpointStatus.js';
import { InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import type { PortManager } from '../../../../src/driver/media/PortManager.js';
import { ReceiveRing } from '../../../../src/driver/media/ReceiveRing.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { UdpChannelTransport } from '../../../../src/driver/media/UdpChannelTransport.js';
import { WildcardPortManager } from '../../../../src/driver/media/WildcardPortManager.js';
import { SystemCounterDescriptor } from '../../../../src/driver/status/SystemCounterDescriptor.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { assertThrows } from '../../../support/Assertions.js';
import { Collector, FakeSocket, freeUdpPort, hasIpv6Loopback, waitUntil } from '../../../support/Udp.js';

const LOOPBACK = '127.0.0.1';
const RECEIVE_CAPACITY = 2048;

class TestTransport extends UdpChannelTransport {
    public constructor(
        udpChannel: UdpChannel,
        endPointAddress: InetSocketAddress | null,
        bindAddress: InetSocketAddress | null,
        connectAddress: InetSocketAddress | null,
        portManager: PortManager | null,
        context: MediaDriver.Context,
        socketRcvbufLength?: number,
        socketSndbufLength?: number,
    ) {
        super(
            udpChannel,
            endPointAddress,
            bindAddress,
            connectAddress,
            portManager,
            context,
            socketRcvbufLength,
            socketSndbufLength,
        );
    }
}

let context: MediaDriver.Context;
let errors: Error[];
let transports: TestTransport[];

const noPortManager: PortManager = {
    getManagedPort: (_channel, address) => address,
    freeManagedPort: () => {},
};

function channel(uri = 'aeron:udp?endpoint=127.0.0.1:0'): UdpChannel {
    return UdpChannel.parse(uri);
}

/** A transport that is not opened. */
function newTransport(
    options: {
        connect?: InetSocketAddress | null;
        portManager?: PortManager;
        rcvbuf?: number;
        sndbuf?: number;
        bindPort?: number;
    } = {},
): TestTransport {
    const udpChannel = channel();
    const transport = new TestTransport(
        udpChannel,
        udpChannel.remoteData(),
        new InetSocketAddress(LOOPBACK, options.bindPort ?? 0),
        options.connect ?? null,
        options.portManager ?? noPortManager,
        context,
        options.rcvbuf,
        options.sndbuf,
    );
    transports.push(transport);
    return transport;
}

function newOpenTransport(options: Parameters<typeof newTransport>[0] = {}): TestTransport {
    const transport = newTransport(options);
    transport.openDatagramChannel(null);
    return transport;
}

/** The local port of an opened transport. */
function portOf(transport: TestTransport): number {
    return ((transport.receiveDatagramChannel() as Socket).address() as { port: number }).port;
}

function bufferOf(text: string): UnsafeBuffer {
    const buffer = new UnsafeBuffer(new Uint8Array(Math.max(text.length, 1)));
    for (let i = 0; i < text.length; i++) {
        buffer.putByte(i, text.charCodeAt(i));
    }
    return buffer;
}

function textOf(buffer: UnsafeBuffer, length: number): string {
    let text = '';
    for (let i = 0; i < length; i++) {
        text += String.fromCharCode(buffer.getByte(i) & 0xff);
    }
    return text;
}

function rinfoOf(address: string, port: number, size = 4): RemoteInfo {
    return { address, family: 'IPv4', port, size };
}

/** Polls `receive` until a datagram arrives, failing at the cap of `waitUntil`. */
async function receiveOne(
    transport: TestTransport,
    buffer: UnsafeBuffer,
): Promise<{ address: InetSocketAddress; length: number }> {
    let address: InetSocketAddress | null = null;
    await waitUntil(() => {
        address = transport.receive(buffer);
        return null !== address;
    }, 'a datagram on the transport');
    return { address: address as unknown as InetSocketAddress, length: transport.receivedLength() };
}

function ringDrops(): number {
    return (context.systemCounters()?.get(SystemCounterDescriptor.RECEIVE_RING_DROPS) as AtomicCounter).get();
}

beforeEach(() => {
    errors = [];
    transports = [];
    const handler: ErrorHandler = { onError: (e) => errors.push(e) };
    context = new MediaDriver.Context().errorHandler(handler).conclude();
});

afterEach(() => {
    for (const transport of transports) {
        transport.close();
    }
    context.close();
});

describe('AeronEvent', () => {
    it('is a WARN event with no stack trace', () => {
        const event = new AeronEvent('something happened');
        expect(event).toBeInstanceOf(AeronException);
        expect(event.category()).toBe(AeronException.Category.WARN);
        expect(event.message).toContain('something happened');
        expect(event.stack).toBeUndefined();

        const error = new AeronEvent('bad', AeronException.Category.ERROR);
        expect(error.category()).toBe(AeronException.Category.ERROR);
    });
});

describe('ReceiveRing', () => {
    const address = new InetSocketAddress(LOOPBACK, 1);

    it('is a FIFO that wraps around', () => {
        const ring = new ReceiveRing(4096, 4);
        expect(ring.capacity()).toBe(4);
        expect(ring.isEmpty()).toBe(true);

        let next = 0;
        let expected = 0;
        for (let round = 0; round < 50; round++) {
            for (let i = 0; i < 3; i++) {
                expect(ring.offer(Uint8Array.of(next, 1, 2), 3, address)).toBe(true);
                next = (next + 1) & 0xff;
            }
            for (let i = 0; i < 3; i++) {
                expect(ring.headBuffer()[0]).toBe(expected);
                expect(ring.headLength()).toBe(3);
                ring.advance();
                expected = (expected + 1) & 0xff;
            }
        }
        expect(ring.isEmpty()).toBe(true);
        expect(ring.byteSize()).toBe(0);
    });

    it('refuses a datagram at the slot limit and at the byte limit, and takes one that fits', () => {
        const slots = new ReceiveRing(1_000_000, 4);
        for (let i = 0; i < 4; i++) {
            expect(slots.offer(new Uint8Array(1), 1, address)).toBe(true);
        }
        expect(slots.offer(new Uint8Array(1), 1, address)).toBe(false);
        expect(slots.size()).toBe(4);
        slots.advance();
        expect(slots.offer(new Uint8Array(1), 1, address)).toBe(true);

        const bytes = new ReceiveRing(100, 64);
        expect(bytes.offer(new Uint8Array(60), 60, address)).toBe(true);
        expect(bytes.offer(new Uint8Array(41), 41, address)).toBe(false); // 101 > 100
        expect(bytes.offer(new Uint8Array(40), 40, address)).toBe(true); // exactly 100
        expect(bytes.byteSize()).toBe(100);
        expect(bytes.offer(new Uint8Array(1), 1, address)).toBe(false);
        bytes.advance(); // frees 60
        expect(bytes.byteSize()).toBe(40);
        expect(bytes.offer(new Uint8Array(60), 60, address)).toBe(true);
    });

    it('derives its slot count from the byte budget, between 64 and 16,384, rounded up to a power of two', () => {
        expect(ReceiveRing.slotsFor(1)).toBe(ReceiveRing.MIN_SLOTS);
        expect(ReceiveRing.slotsFor(212_992)).toBe(3328);
        expect(ReceiveRing.slotsFor(2 ** 30)).toBe(ReceiveRing.MAX_SLOTS);
        expect(new ReceiveRing(212_992).capacity()).toBe(4096);
        expect(new ReceiveRing(1).capacity()).toBe(64);
        expect(new ReceiveRing(212_992).byteCapacity()).toBe(212_992);
    });

    it('clear removes every datagram and lets go of the buffers', () => {
        const ring = new ReceiveRing(4096, 8);
        for (let i = 0; i < 5; i++) {
            ring.offer(new Uint8Array(10), 10, address);
        }
        ring.clear();
        expect(ring.isEmpty()).toBe(true);
        expect(ring.size()).toBe(0);
        expect(ring.byteSize()).toBe(0);
        expect(ring.offer(new Uint8Array(10), 10, address)).toBe(true);
    });
});

describe('send slot (D2, spec 4.2)', () => {
    it('a buffer changed after send arrives unchanged: the synchronous path over loopback', async () => {
        const receiver = new Collector();
        const transport = newOpenTransport();
        const buffer = bufferOf('AAAAAAAA');
        const target = new InetSocketAddress(LOOPBACK, receiver.port);

        expect(transport.sendTo(buffer, 0, 8, target)).toBe(8);
        buffer.putBytes(0, new TextEncoder().encode('BBBBBBBB'));
        expect(transport.sendTo(buffer, 0, 8, target)).toBe(8);
        buffer.putBytes(0, new TextEncoder().encode('CCCCCCCC'));

        await receiver.waitFor(2);
        expect([receiver.bytes(0), receiver.bytes(1)]).toEqual(['AAAAAAAA', 'BBBBBBBB']);
    });

    it('a buffer changed after send arrives unchanged: the queued path, where libuv holds the slot', () => {
        const transport = newTransport();
        const socket = new FakeSocket();
        transport.sendDatagramChannel = socket as unknown as Socket;
        const buffer = bufferOf('AAAAAAAA');
        const target = new InetSocketAddress(LOOPBACK, 4444);

        expect(transport.sendTo(buffer, 0, 8, target)).toBe(8);
        // libuv has not read the slot yet: the caller reuses its buffer at once
        buffer.putBytes(0, new TextEncoder().encode('BBBBBBBB'));
        const sent = socket.sent[0]!;
        expect(Buffer.from(sent.slot.subarray(sent.offset, sent.offset + sent.length)).toString('latin1')).toBe(
            'AAAAAAAA',
        );
        expect(sent.port).toBe(4444);
        expect(sent.address).toBe(LOOPBACK);
    });

    it('a send while the libuv queue is not empty returns 0 and leaves the slot untouched', () => {
        const transport = newTransport();
        const socket = new FakeSocket();
        transport.sendDatagramChannel = socket as unknown as Socket;
        const target = new InetSocketAddress(LOOPBACK, 4444);

        expect(transport.sendTo(bufferOf('FIRST!!!'), 0, 8, target)).toBe(8);
        socket.queueCount = 1; // libuv still holds the slot

        expect(transport.sendTo(bufferOf('SECOND!!'), 0, 8, target)).toBe(0);
        expect(transport.send(bufferOf('THIRD!!!'), 0, 8)).toBe(0);
        expect(socket.sent.length).toBe(1);
        const sent = socket.sent[0]!;
        expect(Buffer.from(sent.slot.subarray(0, 8)).toString('latin1')).toBe('FIRST!!!'); // not overwritten

        socket.queueCount = 0; // drained
        expect(transport.sendTo(bufferOf('FOURTH!!'), 0, 8, target)).toBe(8);
        expect(socket.sent.length).toBe(2);
        expect(Buffer.from(socket.sent[1]!.slot.subarray(0, 8)).toString('latin1')).toBe('FOURTH!!');
    });

    it('one buffer sent to several addresses in a loop reaches each unchanged', async () => {
        const receivers = [new Collector(), new Collector(), new Collector()];
        const transport = newOpenTransport();
        const buffer = bufferOf('STATUS-MESSAGE');

        for (const receiver of receivers) {
            expect(transport.sendTo(buffer, 0, 14, new InetSocketAddress(LOOPBACK, receiver.port))).toBe(14);
            buffer.putBytes(0, new TextEncoder().encode('XXXXXXXXXXXXXX')); // the caller reuses the buffer
            buffer.putBytes(0, new TextEncoder().encode('STATUS-MESSAGE'));
        }

        for (const receiver of receivers) {
            await receiver.waitFor(1);
            expect(receiver.bytes(0)).toBe('STATUS-MESSAGE');
        }
    });

    it('send on a connected socket carries no address, and a connected socket gets what it sends', async () => {
        const receiver = new Collector();
        const transport = newOpenTransport({ connect: new InetSocketAddress(LOOPBACK, receiver.port) });

        expect(transport.send(bufferOf('connected'), 0, 9)).toBe(9);
        await receiver.waitFor(1);
        expect(receiver.bytes(0)).toBe('connected');

        const fake = new FakeSocket();
        transport.sendDatagramChannel = fake as unknown as Socket;
        expect(transport.send(bufferOf('x'), 0, 1)).toBe(1);
        expect(fake.sent[0]!.port).toBeUndefined();
        expect(fake.sent[0]!.address).toBeUndefined();
    });

    it('sends from an offset of the caller buffer, and a zero length datagram', async () => {
        const receiver = new Collector();
        const transport = newOpenTransport();
        const target = new InetSocketAddress(LOOPBACK, receiver.port);

        expect(transport.sendTo(bufferOf('0123456789'), 3, 4, target)).toBe(4);
        expect(transport.sendTo(bufferOf('0123456789'), 3, 0, target)).toBe(0);
        await receiver.waitFor(2);
        expect(receiver.bytes(0)).toBe('3456');
        expect(receiver.received[1]!.message.length).toBe(0);
    });

    it('returns 0 after close and before open, and reports a send that node refuses', () => {
        const unopened = newTransport();
        expect(unopened.sendTo(bufferOf('x'), 0, 1, new InetSocketAddress(LOOPBACK, 9))).toBe(0);

        const transport = newTransport();
        const socket = new FakeSocket();
        transport.sendDatagramChannel = socket as unknown as Socket;
        socket.throwOnSend = Object.assign(new Error('bad port'), { code: 'ERR_SOCKET_BAD_PORT' });

        expect(transport.sendTo(bufferOf('x'), 0, 1, new InetSocketAddress(LOOPBACK, 9))).toBe(0);
        expect(errors.length).toBe(1);
        expect(errors[0]).toBeInstanceOf(AeronEvent);
        expect(errors[0]!.message).toContain('failed to send datagram to /127.0.0.1:9, cause: ');
        expect(errors[0]!.message).toContain('bad port');

        transport.close();
        expect(transport.sendTo(bufferOf('x'), 0, 1, new InetSocketAddress(LOOPBACK, 9))).toBe(0);
        expect(socket.sent.length).toBe(0);
    });

    it('a datagram longer than the send slot is not sent and is reported', () => {
        const transport = newOpenTransport();
        const big = new UnsafeBuffer(new Uint8Array(70_000));

        expect(transport.sendTo(big, 0, 70_000, new InetSocketAddress(LOOPBACK, 9))).toBe(0);
        expect(errors.length).toBe(1);
        expect(errors[0]).toBeInstanceOf(AeronEvent);
    });

    it('the largest datagram, MAX_UDP_PAYLOAD_LENGTH, goes through', async () => {
        const receiver = new Collector();
        const transport = newOpenTransport();
        const big = new UnsafeBuffer(new Uint8Array(65504).fill(7));

        expect(transport.sendTo(big, 0, 65504, new InetSocketAddress(LOOPBACK, receiver.port))).toBe(65504);
        await receiver.waitFor(1);
        expect(receiver.received[0]!.message.length).toBe(65504);
    });
});

describe('deferred errors (D2, spec 4.2)', () => {
    function withFakeSocket(): { transport: TestTransport; socket: FakeSocket } {
        const transport = newOpenTransport();
        const socket = new FakeSocket();
        transport.sendDatagramChannel = socket as unknown as Socket;
        return { transport, socket };
    }

    function completeWith(socket: FakeSocket, error: Error | null, index = 0): void {
        (socket.sent[index]!.callback as (e: Error | null, bytes: number) => void)(error, 0);
    }

    it('a send error reaches the error handler at the next poll, not at once', () => {
        const { transport, socket } = withFakeSocket();
        const receiveBuffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const target = new InetSocketAddress(LOOPBACK, 4444);

        expect(transport.sendTo(bufferOf('x'), 0, 1, target)).toBe(1);
        completeWith(socket, Object.assign(new Error('send EMSGSIZE'), { code: 'EMSGSIZE' }));
        expect(errors).toEqual([]);

        expect(transport.receive(receiveBuffer)).toBeNull();
        expect(errors.length).toBe(1);
        expect(errors[0]).toBeInstanceOf(AeronEvent);
        expect(errors[0]!.message).toContain('failed to send datagram to');
        expect(errors[0]!.message).toContain('EMSGSIZE');

        transport.receive(receiveBuffer);
        expect(errors.length).toBe(1); // reported once
    });

    it('the destination of a late send error is the address node names', () => {
        const { transport, socket } = withFakeSocket();
        transport.sendTo(bufferOf('x'), 0, 1, new InetSocketAddress(LOOPBACK, 4444));
        completeWith(
            socket,
            Object.assign(new Error('send EINVAL'), { code: 'EINVAL', address: '10.1.2.3', port: 77 }),
        );
        transport.receive(new UnsafeBuffer(new Uint8Array(16)));

        expect(errors[0]!.message).toContain('failed to send datagram to /10.1.2.3:77, cause: ');
    });

    it('ECONNREFUSED and ECANCELED on a send, and a send that succeeded, never reach the error handler', () => {
        const { transport, socket } = withFakeSocket();
        const receiveBuffer = new UnsafeBuffer(new Uint8Array(16));
        const target = new InetSocketAddress(LOOPBACK, 4444);

        for (let i = 0; i < 3; i++) {
            transport.sendTo(bufferOf('x'), 0, 1, target);
        }
        completeWith(socket, Object.assign(new Error('send ECONNREFUSED'), { code: 'ECONNREFUSED' }), 0);
        completeWith(socket, Object.assign(new Error('send ECANCELED'), { code: 'ECANCELED' }), 1);
        completeWith(socket, null, 2);

        transport.receive(receiveBuffer);
        expect(errors).toEqual([]);
    });

    it('only the first of several send errors in one cycle is held', () => {
        const { transport, socket } = withFakeSocket();
        const target = new InetSocketAddress(LOOPBACK, 4444);
        for (let i = 0; i < 3; i++) {
            transport.sendTo(bufferOf('x'), 0, 1, target);
            completeWith(socket, Object.assign(new Error('send E' + i), { code: 'E' + i }), i);
        }

        transport.receive(new UnsafeBuffer(new Uint8Array(16)));
        expect(errors.length).toBe(1);
        expect(errors[0]!.message).toContain('E0');
    });

    it('a socket error event is held for the next poll; ECONNREFUSED never reaches the error handler', () => {
        const { transport } = withFakeSocket();
        transport
            .receiveDatagramChannel()!
            .emit('error', Object.assign(new Error('recvmsg ECONNREFUSED'), { code: 'ECONNREFUSED' }));
        transport.receive(new UnsafeBuffer(new Uint8Array(16)));
        expect(errors).toEqual([]);

        const failure = Object.assign(new Error('recvmsg EIO'), { code: 'EIO' });
        transport.receiveDatagramChannel()!.emit('error', failure);
        expect(errors).toEqual([]); // not at once
        transport.receive(new UnsafeBuffer(new Uint8Array(16)));
        expect(errors).toEqual([failure]);
    });

    it('a real connected socket sends to a closed port: the ICMP error is ignored', async () => {
        const closedPort = freeUdpPort();
        const transport = newOpenTransport({ connect: new InetSocketAddress(LOOPBACK, closedPort) });
        const socket = transport.receiveDatagramChannel() as Socket;
        let refused = 0;
        socket.on('error', (e: Error & { code?: string }) => {
            if ('ECONNREFUSED' === e.code) {
                refused++;
            }
        });

        // the first send provokes the ICMP, which node reports as an error event on the connected socket
        await waitUntil(() => {
            transport.send(bufferOf('ping'), 0, 4);
            return refused > 0;
        }, 'the ECONNREFUSED event');

        transport.receive(new UnsafeBuffer(new Uint8Array(16)));
        expect(errors).toEqual([]);
    });

    it('after close, late socket and send completion errors are ignored', () => {
        const { transport, socket } = withFakeSocket();
        transport.sendTo(bufferOf('x'), 0, 1, new InetSocketAddress(LOOPBACK, 4444));
        const real = transport.receiveDatagramChannel() as Socket;
        transport.close();

        completeWith(socket, Object.assign(new Error('send EIO'), { code: 'EIO' }));
        real.emit('error', new Error('late'));
        transport.receive(new UnsafeBuffer(new Uint8Array(16)));
        expect(errors).toEqual([]);
    });
});

describe('receive ring (D1, spec 4.2)', () => {
    it('hands out one datagram per poll, in order, and 0 bytes when there is none', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const rinfo = rinfoOf('10.0.0.1', 5000);

        for (const text of ['one', 'second', 'third!']) {
            transport.onMessage(Buffer.from(text), rinfo);
        }

        const seen: string[] = [];
        for (let i = 0; i < 3; i++) {
            const address = transport.receive(buffer);
            expect(address).not.toBeNull();
            seen.push(textOf(buffer, transport.receivedLength()));
        }
        expect(seen).toEqual(['one', 'second', 'third!']);

        expect(transport.receive(buffer)).toBeNull();
        expect(transport.receivedLength()).toBe(0);
    });

    it('the source address is the sender of that datagram', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));

        transport.onMessage(Buffer.from('a'), rinfoOf('10.0.0.1', 5000));
        transport.onMessage(Buffer.from('b'), rinfoOf('10.0.0.2', 5001));

        expect(transport.receive(buffer)!.equals(new InetSocketAddress('10.0.0.1', 5000))).toBe(true);
        expect(transport.receive(buffer)!.equals(new InetSocketAddress('10.0.0.2', 5001))).toBe(true);
    });

    it('a datagram longer than the receive buffer is cut to it, as a ByteBuffer receive cuts it', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(8));

        transport.onMessage(Buffer.from('0123456789ABCDEF'), rinfoOf('10.0.0.1', 5000));
        expect(transport.receive(buffer)).not.toBeNull();
        expect(transport.receivedLength()).toBe(8);
        expect(textOf(buffer, 8)).toBe('01234567');
    });

    it('overflow drops the datagram and counts it in RECEIVE_RING_DROPS: the byte budget', () => {
        const transport = newOpenTransport({ rcvbuf: 4096 });
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const rinfo = rinfoOf('10.0.0.1', 5000);
        const before = ringDrops();

        for (let i = 0; i < 5; i++) {
            transport.onMessage(Buffer.alloc(1000, i), rinfo); // 4 x 1000 fit in 4096, the fifth does not
        }
        expect(ringDrops() - before).toBe(1);

        for (let i = 0; i < 4; i++) {
            expect(transport.receive(buffer)).not.toBeNull();
            expect(buffer.getByte(0)).toBe(i); // the first four, in order
        }
        expect(transport.receive(buffer)).toBeNull();

        transport.onMessage(Buffer.alloc(1000), rinfo); // room again
        expect(ringDrops() - before).toBe(1);
    });

    it('overflow drops the datagram and counts it in RECEIVE_RING_DROPS: the slot limit', () => {
        const transport = newOpenTransport({ rcvbuf: 4096 }); // 4096 / 64 = 64 slots
        const rinfo = rinfoOf('10.0.0.1', 5000);
        const before = ringDrops();

        for (let i = 0; i < 70; i++) {
            transport.onMessage(Buffer.alloc(1), rinfo);
        }
        expect(ringDrops() - before).toBe(6);
    });

    it('a transport that is not open takes no datagram', () => {
        const transport = newTransport();
        const before = ringDrops();
        transport.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(transport.receive(new UnsafeBuffer(new Uint8Array(16)))).toBeNull();
        expect(ringDrops()).toBe(before);
    });

    it('a transport starts with the wake-up function of its context (spec D8, D100)', () => {
        const wake = vi.fn();
        context.wakeUp(wake);
        const withWake = newOpenTransport();
        withWake.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(1);

        // the function of the context is read when the transport is made: a later change is not seen, setWakeUp replaces it
        context.wakeUp(null);
        withWake.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(2);
        const without = newOpenTransport();
        without.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(2);
        withWake.setWakeUp(null);
        withWake.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(2);
    });

    it('close clears the ring: unread datagrams are discarded and nothing more is taken', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const rinfo = rinfoOf('10.0.0.1', 5000);
        transport.onMessage(Buffer.from('unread'), rinfo);
        transport.onMessage(Buffer.from('unread'), rinfo);

        transport.close();

        expect(transport.receive(buffer)).toBeNull();
        expect(transport.receivedLength()).toBe(0);
        transport.onMessage(Buffer.from('late'), rinfo);
        expect(transport.receive(buffer)).toBeNull();
    });

    it('the wake-up function is called for a datagram, and when a full send queue has drained', () => {
        const transport = newOpenTransport();
        const wake = vi.fn();
        transport.setWakeUp(wake);

        transport.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(1);

        const socket = new FakeSocket();
        transport.sendDatagramChannel = socket as unknown as Socket;
        const target = new InetSocketAddress(LOOPBACK, 4444);
        transport.sendTo(bufferOf('x'), 0, 1, target);
        const complete = socket.sent[0]!.callback as (e: Error | null, bytes: number) => void;
        complete(null, 1);
        expect(wake).toHaveBeenCalledTimes(1); // a send that was not blocked wakes nobody

        socket.queueCount = 1;
        expect(transport.sendTo(bufferOf('x'), 0, 1, target)).toBe(0); // blocked
        complete(null, 1);
        expect(wake).toHaveBeenCalledTimes(1); // the queue is still not empty

        socket.queueCount = 0;
        complete(null, 1);
        expect(wake).toHaveBeenCalledTimes(2); // drained after a blocked send
        complete(null, 1);
        expect(wake).toHaveBeenCalledTimes(2); // once

        transport.setWakeUp(null);
        transport.onMessage(Buffer.from('x'), rinfoOf('10.0.0.1', 5000));
        expect(wake).toHaveBeenCalledTimes(2);
    });
});

describe('open and close', () => {
    it('a bind failure throws synchronously, sets the status indicator and closes what it opened', () => {
        const first = newOpenTransport();
        const port = portOf(first);
        const statusIndicator = { setRelease: vi.fn() } as unknown as AtomicCounter;
        const second = newTransport({ bindPort: port });

        const error = assertThrows(AeronException, () => second.openDatagramChannel(statusIndicator));

        expect(error.message).toContain('channel error - ');
        expect(error.message).toContain('EADDRINUSE');
        expect(error.message).toContain('aeron:udp?endpoint=127.0.0.1:0');
        expect(statusIndicator.setRelease).toHaveBeenCalledWith(ChannelEndpointStatus.ERRORED);
        expect(second.receiveDatagramChannel()).toBeNull();
        expect(second.receive(new UnsafeBuffer(new Uint8Array(16)))).toBeNull();
        expect(errors).toEqual([]); // the late error event of the failed socket is not reported
    });

    it('a failed open leaves the managed port to close(), which frees it once (D28) Regression', () => {
        const port = freeUdpPort();
        const blocker = newOpenTransport({ bindPort: port });
        const manager = new WildcardPortManager([port, port], false);
        let frees = 0;
        const counting: PortManager = {
            getManagedPort: (channel, address) => manager.getManagedPort(channel, address),
            freeManagedPort: (address) => {
                frees++;
                manager.freeManagedPort(address);
            },
        };
        const failing = newTransport({ portManager: counting });

        assertThrows(AeronException, () => failing.openDatagramChannel(null));
        expect(manager.portSet.contains(port)).toBe(true); // the failed open does not free it, as in Java

        failing.close(); // what DriverConductor does through closeAll after a failed open
        expect(manager.portSet.contains(port)).toBe(false);
        expect(frees).toBe(1);

        manager.portSet.add(port); // someone else took the port since: a second close must not free it again
        failing.close();
        expect(frees).toBe(1);
        expect(manager.portSet.contains(port)).toBe(true);

        blocker.close();
        manager.portSet.remove(port);
        const again = newOpenTransport({ portManager: manager });
        expect(portOf(again)).toBe(port);
    });

    it('binds an ephemeral port, reports it, and can be reopened after close elsewhere on the same port', () => {
        const transport = newOpenTransport();
        const port = portOf(transport);
        expect(port).toBeGreaterThan(0);
        expect(transport.bindAddressAndPort()).toBe(LOOPBACK + ':' + port);
        transport.close();

        const again = newOpenTransport({ bindPort: port });
        expect(portOf(again)).toBe(port);
    });

    it('bindAddressAndPort of a transport that is not open is empty', () => {
        expect(newTransport().bindAddressAndPort()).toBe('');
    });

    it('close is idempotent and frees a managed port once', () => {
        const freed: number[] = [];
        const portManager: PortManager = {
            getManagedPort: (_channel, address) => address,
            freeManagedPort: (address) => freed.push(address.getPort()),
        };
        const transport = newOpenTransport({ portManager });

        transport.close();
        transport.close();

        expect(freed.length).toBe(1);
        expect(transport.receiveDatagramChannel()).not.toBeNull(); // the closed socket stays, as a closed channel does
    });

    it('binds through the port manager: a wildcard range allocates and close frees the port', () => {
        const range = freeUdpPort();
        const manager = new WildcardPortManager([range, range], false);
        const transport = newOpenTransport({ portManager: manager });

        expect(portOf(transport)).toBe(range);
        expect(manager.portSet.contains(range)).toBe(true);

        transport.close();
        expect(manager.portSet.contains(range)).toBe(false);
    });

    it('a port manager that refuses the bind fails the open, with the status set', () => {
        const manager = new WildcardPortManager([40000, 40000], false);
        manager.portSet.add(40000);
        const statusIndicator = { setRelease: vi.fn() } as unknown as AtomicCounter;
        const udpChannel = channel();
        const transport = new TestTransport(
            udpChannel,
            udpChannel.remoteData(),
            new InetSocketAddress(LOOPBACK, 0),
            null,
            manager,
            context,
        );
        transports.push(transport);

        const error = assertThrows(AeronException, () => transport.openDatagramChannel(statusIndicator));
        expect(error.message).toContain('no available ports in range 40000 40000');
        expect(statusIndicator.setRelease).toHaveBeenCalledWith(ChannelEndpointStatus.ERRORED);
    });

    it('takes its socket buffer lengths from the channel, then the context, unless given', () => {
        const fromContext = new TestTransport(
            channel(),
            null,
            new InetSocketAddress(LOOPBACK, 0),
            null,
            noPortManager,
            context,
        );
        expect(fromContext.socketRcvbufLength()).toBe(context.socketRcvbufLength());
        expect(fromContext.socketSndbufLength()).toBe(context.socketSndbufLength());

        const fromChannel = new TestTransport(
            channel('aeron:udp?endpoint=127.0.0.1:0|so-rcvbuf=65536|so-sndbuf=32768'),
            null,
            new InetSocketAddress(LOOPBACK, 0),
            null,
            noPortManager,
            context,
        );
        expect(fromChannel.socketRcvbufLength()).toBe(65536);
        expect(fromChannel.socketSndbufLength()).toBe(32768);

        const given = newTransport({ rcvbuf: 1234, sndbuf: 5678 });
        expect(given.socketRcvbufLength()).toBe(1234);
        expect(given.socketSndbufLength()).toBe(5678);
    });

    it('sets the socket buffer sizes it is given', () => {
        const transport = newOpenTransport({ rcvbuf: 65536, sndbuf: 65536 });
        const socket = transport.receiveDatagramChannel() as Socket;
        expect(socket.getRecvBufferSize()).toBeGreaterThanOrEqual(65536);
        expect(socket.getSendBufferSize()).toBeGreaterThanOrEqual(65536);
    });

    it('updateEndpoint moves a connected transport to the new address and sets the status indicator ACTIVE', async () => {
        const first = new Collector();
        const second = new Collector();
        const transport = newOpenTransport({ connect: new InetSocketAddress(LOOPBACK, first.port) });
        const statusIndicator = { setRelease: vi.fn() } as unknown as AtomicCounter;

        transport.send(bufferOf('to-first'), 0, 8);
        await first.waitFor(1);

        transport.updateEndpoint(new InetSocketAddress(LOOPBACK, second.port), statusIndicator);
        expect(statusIndicator.setRelease).toHaveBeenCalledWith(ChannelEndpointStatus.ACTIVE);

        transport.send(bufferOf('to-second'), 0, 9);
        await second.waitFor(1);
        expect(second.bytes(0)).toBe('to-second');
        expect(first.received.length).toBe(1);
    });

    it('updateEndpoint on an unconnected transport connects it, and a bad address fails it with the status ERRORED', () => {
        const transport = newOpenTransport();
        const statusIndicator = { setRelease: vi.fn() } as unknown as AtomicCounter;

        transport.updateEndpoint(new InetSocketAddress(LOOPBACK, 9), statusIndicator);
        expect(statusIndicator.setRelease).toHaveBeenLastCalledWith(ChannelEndpointStatus.ACTIVE);

        // an IPv6 address on an IPv4 socket: node reports the connect failure
        const bad = new InetSocketAddress(InetAddress.getByName('::1'), 9);
        const error = assertThrows(AeronException, () => transport.updateEndpoint(bad, statusIndicator));
        expect(error.message).toContain('re-resolve endpoint channel error - ');
        expect(statusIndicator.setRelease).toHaveBeenLastCalledWith(ChannelEndpointStatus.ERRORED);
    });

    it('opens an IPv6 loopback transport', async (ctx) => {
        if (!hasIpv6Loopback()) {
            ctx.skip('no IPv6 loopback on this host');
        }

        const udpChannel = channel('aeron:udp?endpoint=[::1]:0');
        const transport = new TestTransport(
            udpChannel,
            udpChannel.remoteData(),
            new InetSocketAddress(InetAddress.getByName('::1'), 0),
            null,
            noPortManager,
            context,
        );
        transports.push(transport);
        transport.openDatagramChannel(null);
        const receiver = new Collector('udp6');

        expect(
            transport.sendTo(bufferOf('v6'), 0, 2, new InetSocketAddress(InetAddress.getByName('::1'), receiver.port)),
        ).toBe(2);
        await receiver.waitFor(1);
        expect(receiver.bytes(0)).toBe('v6');
    });
});

describe('two transports over loopback (the real path)', () => {
    it('a datagram goes from one transport to the other with its source address, in both directions', async () => {
        const a = newOpenTransport();
        const b = newOpenTransport();
        const aSocketPort = portOf(a);
        const bSocketPort = portOf(b);
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));

        expect(a.sendTo(bufferOf('hello b'), 0, 7, new InetSocketAddress(LOOPBACK, bSocketPort))).toBe(7);
        const atB = await receiveOne(b, buffer);
        expect(textOf(buffer, atB.length)).toBe('hello b');
        expect(atB.address.equals(new InetSocketAddress(LOOPBACK, aSocketPort))).toBe(true);

        expect(b.sendTo(bufferOf('hello a'), 0, 7, atB.address)).toBe(7); // reply to the source address
        const atA = await receiveOne(a, buffer);
        expect(textOf(buffer, atA.length)).toBe('hello a');
        expect(atA.address.equals(new InetSocketAddress(LOOPBACK, bSocketPort))).toBe(true);
    });

    it('a burst arrives in order and nothing is lost within the ring', async () => {
        const a = newOpenTransport();
        const b = newOpenTransport({ rcvbuf: 1 << 20 });
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const target = new InetSocketAddress(LOOPBACK, portOf(b));
        const count = 100;

        for (let i = 0; i < count; i++) {
            expect(a.sendTo(bufferOf('m' + String(i).padStart(4, '0')), 0, 5, target)).toBe(5);
        }

        let received = 0;
        let last = -1;
        await waitUntil(() => {
            while (null !== b.receive(buffer)) {
                const n = Number(textOf(buffer, b.receivedLength()).substring(1));
                expect(n).toBeGreaterThan(last);
                last = n;
                received++;
            }
            return received >= count - 5; // loopback may drop what overflows the kernel buffer
        }, 'the burst');
        expect(ringDrops()).toBe(0);
    });

    it('the same address object is handed out while the sender stays the same', async () => {
        const a = newOpenTransport();
        const b = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const target = new InetSocketAddress(LOOPBACK, portOf(b));

        a.sendTo(bufferOf('1'), 0, 1, target);
        a.sendTo(bufferOf('2'), 0, 1, target);
        const first = await receiveOne(b, buffer);
        const second = await receiveOne(b, buffer);

        expect(second.address).toBe(first.address);
    });
});

describe('last sender address (T8 review)', () => {
    it('is built once for a repeated sender, again when the host or the port changes, never by getByName per datagram', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const message = new Uint8Array(32);
        const getByName = vi.spyOn(InetAddress, 'getByName');
        try {
            const addresses: InetSocketAddress[] = [];
            const next = (host: string, port: number): InetSocketAddress => {
                transport.onMessage(message, rinfoOf(host, port));
                const address = transport.receive(buffer) as InetSocketAddress;
                addresses.push(address);
                return address;
            };

            const first = next('10.0.0.1', 5000);
            const calls = getByName.mock.calls.length;
            expect(calls).toBe(1);
            for (let i = 0; i < 100; i++) {
                expect(next('10.0.0.1', 5000)).toBe(first);
            }
            expect(getByName.mock.calls.length).toBe(calls); // not once more

            const otherPort = next('10.0.0.1', 5001);
            expect(otherPort).not.toBe(first);
            expect(otherPort.getPort()).toBe(5001);
            const otherHost = next('10.0.0.2', 5001);
            expect(otherHost).not.toBe(otherPort);
            expect(otherHost.getAddress()!.getHostAddress()).toBe('10.0.0.2');
            expect(getByName.mock.calls.length).toBe(calls + 2);

            // back to the first sender: the interned object, so a peer is found by identity too
            const back = next('10.0.0.1', 5000);
            expect(back).toBe(first);
            expect(getByName.mock.calls.length).toBe(calls + 2);
            // addresses already handed out are not changed by later datagrams
            expect(first.getPort()).toBe(5000);
            expect(otherPort.getPort()).toBe(5001);
        } finally {
            getByName.mockRestore();
        }
    });

    it('allocates nothing per datagram from a repeated sender (onMessage, then receive)', async () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const message = new Uint8Array(128);
        const rinfo = rinfoOf('10.0.0.1', 5000, 128);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                transport.onMessage(message, rinfo);
                if (null === transport.receive(buffer)) {
                    throw new Error('lost');
                }
            }
        });
    });

    it('allocates nothing per datagram from 2 alternating senders (interned source addresses) Regression', async () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const message = new Uint8Array(128);
        const infos = [rinfoOf('10.0.0.1', 5000, 128), rinfoOf('10.0.0.2', 5001, 128)];

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                transport.onMessage(message, infos[i & 1] as RemoteInfo);
                if (null === transport.receive(buffer)) {
                    throw new Error('lost');
                }
            }
        });
    });

    it('allocates nothing per datagram from as many senders as the intern table holds Regression', async () => {
        const capacity = 16; // the documented capacity
        expect(UdpChannelTransport.SOURCE_ADDRESS_CAPACITY).toBe(capacity);
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const message = new Uint8Array(128);
        const infos: RemoteInfo[] = [];
        for (let i = 0; i < capacity; i++) {
            infos.push(rinfoOf('10.0.1.' + i, 6000 + i, 128));
        }

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                transport.onMessage(message, infos[i % capacity] as RemoteInfo);
                if (null === transport.receive(buffer)) {
                    throw new Error('lost');
                }
            }
        });
    });

    it('a full intern table replaces round-robin: the evicted sender gets a new address, the others keep theirs', () => {
        const transport = newOpenTransport();
        const buffer = new UnsafeBuffer(new Uint8Array(RECEIVE_CAPACITY));
        const message = new Uint8Array(8);
        const capacity = UdpChannelTransport.SOURCE_ADDRESS_CAPACITY;
        const next = (i: number): InetSocketAddress => {
            transport.onMessage(message, rinfoOf('10.0.2.' + i, 7000 + i));
            return transport.receive(buffer) as InetSocketAddress;
        };

        const first = Array.from({ length: capacity }, (_, i) => next(i));
        const extra = next(capacity); // evicts sender 0
        expect(extra.getPort()).toBe(7000 + capacity);
        expect(next(1)).toBe(first[1]);
        expect(next(capacity)).toBe(extra);
        const again = next(0);
        expect(again).not.toBe(first[0]);
        expect(again.equals(first[0] as InetSocketAddress)).toBe(true);
    });

    it('allocates nothing per datagram on the send path (copy to the slot, hand to the socket)', async () => {
        const transport = newTransport();
        let sends = 0;
        const socket = {
            getSendQueueCount: () => 0,
            send: () => {
                sends++;
            },
            close: () => {},
        };
        transport.sendDatagramChannel = socket as unknown as Socket;
        const buffer = new UnsafeBuffer(new Uint8Array(1408));
        const target = new InetSocketAddress(LOOPBACK, 4444);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                if (1408 !== transport.sendTo(buffer, 0, 1408, target)) {
                    throw new Error('short');
                }
            }
        });
        expect(sends).toBeGreaterThan(0);
    });
});
