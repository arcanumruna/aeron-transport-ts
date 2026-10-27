// A `dgram` replacement for the allocation tests of the whole path (issue #52): unicast on 127.0.0.1, sockets by port, and
// no allocation per datagram once it has seen its datagram sizes. A datagram sent goes into a slot of a preallocated ring and is
// delivered by `deliverDue()` (the event loop turn): the 'message' listeners get the slot's Buffer and a reused `rinfo`, and the
// send callback of the sender runs then. A datagram to a port with no socket is dropped, as the kernel does; a full ring drops
// too and counts it in `dropped` (a test asserts it stays 0).
//
// What the real `dgram` allocates (the Buffer of each datagram, the SendWrap and the request list of each send) is node's and
// is not in this fake, so a loop over drivers wired with it measures the code of `src/` alone.
import dgram from 'node:dgram';

const LOOPBACK = '127.0.0.1';
const SLOT_SIZE = 2048;

type MessageListener = (message: Buffer, rinfo: dgram.RemoteInfo) => void;
type SendCallback = (error: Error | null, bytes: number) => void;

interface Slot {
    readonly bytes: Buffer;
    /** The Buffer of exactly one length that the 'message' listeners get, made when a length is first delivered. */
    readonly views: Map<number, Buffer>;
    to: LoopbackSocket | null;
    from: LoopbackSocket | null;
    length: number;
    callback: SendCallback | undefined;
}

export class LoopbackNetwork {
    /** Datagrams dropped because the ring was full. */
    public dropped = 0;
    /** Datagrams delivered. */
    public delivered = 0;
    private nextPort = 40_000;
    private readonly sockets = new Map<number, LoopbackSocket>();
    private readonly ring: Slot[] = [];
    private head = 0;
    private tail = 0;
    private count = 0;

    public constructor(capacity = 4096) {
        for (let i = 0; i < capacity; i++) {
            this.ring.push({
                bytes: Buffer.alloc(SLOT_SIZE),
                views: new Map(),
                to: null,
                from: null,
                length: 0,
                callback: undefined,
            });
        }
    }

    public newSocket(): LoopbackSocket {
        return new LoopbackSocket(this);
    }

    /** @internal */
    public bind(socket: LoopbackSocket, port: number): number {
        const bound = 0 === port ? this.nextPort++ : port;
        if (this.sockets.has(bound)) {
            throw Object.assign(new Error('bind EADDRINUSE'), { code: 'EADDRINUSE' });
        }
        this.sockets.set(bound, socket);
        return bound;
    }

    /** @internal */
    public unbind(port: number): void {
        this.sockets.delete(port);
    }

    /** @internal */
    public send(from: LoopbackSocket, toPort: number, view: Uint8Array, callback: SendCallback | undefined): void {
        if (this.count === this.ring.length) {
            this.dropped++;
            return;
        }
        const slot = this.ring[this.tail] as Slot;
        this.tail = this.tail + 1 === this.ring.length ? 0 : this.tail + 1;
        this.count++;
        slot.bytes.set(view, 0);
        slot.length = view.length;
        slot.from = from;
        slot.to = this.sockets.get(toPort) ?? null;
        slot.callback = callback;
    }

    /** Deliver every datagram that was sent before this call, then run their send callbacks. */
    public deliverDue(): void {
        let n = this.count;
        while (n-- > 0) {
            const slot = this.ring[this.head] as Slot;
            this.head = this.head + 1 === this.ring.length ? 0 : this.head + 1;
            this.count--;
            const to = slot.to;
            if (null !== to) {
                to.deliver(slot.bytes, slot.length, slot.from as LoopbackSocket, slot);
                this.delivered++;
            }
            const callback = slot.callback;
            slot.to = null;
            slot.from = null;
            slot.callback = undefined;
            if (undefined !== callback) {
                callback(null, slot.length);
            }
        }
    }

    /** @internal */
    public static viewOf(slot: Slot, length: number): Buffer {
        let view = slot.views.get(length);
        if (undefined === view) {
            view = slot.bytes.subarray(0, length);
            slot.views.set(length, view);
        }
        return view;
    }
}

export class LoopbackSocket {
    private readonly listeners: MessageListener[] = [];
    private port = 0;
    private remotePort = 0;
    private closed = false;
    private readonly rinfo: dgram.RemoteInfo = { address: LOOPBACK, family: 'IPv4', port: 0, size: 0 };
    private readonly network: LoopbackNetwork;

    public constructor(network: LoopbackNetwork) {
        this.network = network;
    }

    public on(event: string, listener: (...args: never[]) => void): this {
        if ('message' === event) {
            this.listeners.push(listener as unknown as MessageListener);
        }
        return this;
    }

    public bind(port: number): void {
        this.port = this.network.bind(this, port);
        this.rinfo.port = this.port;
    }

    public address(): { address: string; family: string; port: number } {
        return { address: LOOPBACK, family: 'IPv4', port: this.port };
    }

    public connect(port: number): void {
        if (0 === this.port) {
            this.bind(0);
        }
        this.remotePort = port;
    }

    public remoteAddress(): { address: string; family: string; port: number } {
        return { address: LOOPBACK, family: 'IPv4', port: this.remotePort };
    }

    /** `send(view, callback)` on a connected socket, or `send(view, port, address, callback)`. */
    public send(view: Uint8Array, a?: unknown, _address?: unknown, c?: unknown): void {
        if (0 === this.port) {
            this.bind(0);
        }
        if (typeof a === 'number') {
            this.network.send(this, a, view, c as SendCallback | undefined);
        } else {
            this.network.send(this, this.remotePort, view, a as SendCallback | undefined);
        }
    }

    public getSendQueueCount(): number {
        return 0;
    }

    public setSendBufferSize(): void {}

    public setRecvBufferSize(): void {}

    public getSendBufferSize(): number {
        return 1 << 20;
    }

    public getRecvBufferSize(): number {
        return 1 << 20;
    }

    public close(): void {
        if (!this.closed) {
            this.closed = true;
            this.network.unbind(this.port);
        }
    }

    /** @internal */
    public deliver(_bytes: Buffer, length: number, from: LoopbackSocket, slot: Slot): void {
        const rinfo = this.rinfo;
        // the source of the datagram is the port the sender is bound to, as the kernel reports it
        rinfo.port = from.port;
        rinfo.size = length;
        const message = LoopbackNetwork.viewOf(slot, length);
        for (let i = 0; i < this.listeners.length; i++) {
            (this.listeners[i] as MessageListener)(message, rinfo);
        }
    }
}

/** Replaces `dgram.createSocket` by the sockets of a new network until the returned function is called. */
export function installLoopbackDgram(capacity?: number): { network: LoopbackNetwork; restore: () => void } {
    const network = new LoopbackNetwork(capacity);
    const original = dgram.createSocket;
    (dgram as { createSocket: unknown }).createSocket = () => network.newSocket();
    return {
        network,
        restore: () => {
            (dgram as { createSocket: unknown }).createSocket = original;
        },
    };
}
