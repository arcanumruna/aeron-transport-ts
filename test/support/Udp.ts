// UDP helpers for the socket tests: sockets created the way the driver creates them (a synchronous `lookup` that
// accepts IP literals only), waits on events and conditions with a hard time cap that fails the test instead of hanging
// it, a collector of the datagrams a socket receives, and a fake socket for the tests that must control the libuv send
// queue. Nothing here sleeps for synchronization: every wait ends on an event or a condition, or fails at its cap.
import dgram from 'node:dgram';
import { isIP } from 'node:net';
import type { RemoteInfo, Socket } from 'node:dgram';
import { afterEach } from 'vitest';
import { parseSendArgs } from './SendArgs.js';

/** The hard cap of every wait in these helpers. A wait that reaches it fails the test. */
export const WAIT_CAP_MS = 5_000;

/**
 * The `lookup` of every socket of the driver: IP literals only, answered synchronously, so that `bind`, `connect` and
 * the send hand-off all run inside the call (spec 4.2, N2).
 */
export function syncLookup(
    hostname: string,
    options: unknown,
    callback?: (err: Error | null, address: string, family: number) => void,
): void {
    const cb = (typeof options === 'function' ? options : callback) as (
        err: Error | null,
        address: string,
        family: number,
    ) => void;
    const family = isIP(hostname);
    if (0 === family) {
        cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname), { code: 'ENOTFOUND' }), '', 0);
        return;
    }

    cb(null, hostname, family);
}

const open = new Set<Socket>();

afterEach(() => {
    for (const socket of open) {
        try {
            socket.close();
        } catch {
            // already closed
        }
    }
    open.clear();
});

/** A socket with the synchronous lookup that is closed after the test. `default` lookup when `sync` is false. */
export function newSocket(type: 'udp4' | 'udp6' = 'udp4', sync = true): Socket {
    const socket = dgram.createSocket(sync ? { type, lookup: syncLookup } : { type });
    open.add(socket);
    return socket;
}

/** Closes the socket now (and does not close it again after the test). */
export function closeSocket(socket: Socket): void {
    open.delete(socket);
    try {
        socket.close();
    } catch {
        // already closed
    }
}

/**
 * Waits until `condition()` is true. The condition is tested after each turn of the event loop, so that a wait ends
 * as soon as the event it waits for has been delivered; it fails at `capMs`.
 */
export async function waitUntil(condition: () => boolean, what: string, capMs = WAIT_CAP_MS): Promise<void> {
    const deadline = performance.now() + capMs;
    while (!condition()) {
        if (performance.now() > deadline) {
            throw new Error('timed out after ' + capMs + ' ms waiting for ' + what);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

/** The most event loop turns `waitUntilTurns` takes by default. */
export const WAIT_CAP_TURNS = 1_000_000;

/**
 * Like {@link waitUntil}, but bounded by a count of event loop turns instead of a deadline on the wall clock: the
 * condition is tested after each `setImmediate` turn (no busy spin), and the wait fails after `capTurns` turns.
 */
export async function waitUntilTurns(condition: () => boolean, what: string, capTurns = WAIT_CAP_TURNS): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
        if (turn >= capTurns) {
            throw new Error('gave up after ' + capTurns + ' event loop turns waiting for ' + what);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

/** Resolves with the arguments of the next `event` of the emitter; rejects at `capMs`. */
export function nextEvent<T extends unknown[]>(
    emitter: { once(event: string, listener: (...args: T) => void): unknown; off(event: string, l: never): unknown },
    event: string,
    capMs = WAIT_CAP_MS,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('timed out after ' + capMs + ' ms waiting for ' + event)),
            capMs,
        );
        emitter.once(event, (...args: T) => {
            clearTimeout(timer);
            resolve(args);
        });
    });
}

export type Received = { message: Buffer; rinfo: RemoteInfo };

/** A socket bound to a loopback port of its own that collects what it receives. */
export class Collector {
    public readonly received: Received[] = [];
    public readonly errors: Error[] = [];
    public readonly socket: Socket;
    public readonly port: number;

    public constructor(type: 'udp4' | 'udp6' = 'udp4') {
        this.socket = newSocket(type);
        this.socket.on('message', (message, rinfo) => this.received.push({ message, rinfo }));
        this.socket.on('error', (err) => this.errors.push(err));
        this.socket.bind(0, 'udp4' === type ? '127.0.0.1' : '::1');
        this.port = this.socket.address().port;
    }

    public async waitFor(count: number, what = 'datagrams'): Promise<void> {
        await waitUntil(() => this.received.length >= count, count + ' ' + what);
    }

    public bytes(i: number): string {
        return (this.received[i] as Received).message.toString('latin1');
    }
}

/** Whether the host can bind an IPv6 loopback socket. */
export function hasIpv6Loopback(): boolean {
    const socket = dgram.createSocket({ type: 'udp6', lookup: syncLookup });
    try {
        socket.bind(0, '::1');
        return true;
    } catch {
        return false;
    } finally {
        try {
            socket.close();
        } catch {
            // not bound
        }
    }
}

/** The ports a worker owns: below the kernel's ephemeral range (32768+), a slice of this many ports per worker. */
const PORT_SLICE = 300;
const PORT_BASE = 20_000;
const PORT_SLICES = 40;
let sliceNext = 0;
const issued = new Set<number>();

function workerSlice(): number {
    const id = Number(process.env['VITEST_POOL_ID'] ?? process.env['VITEST_WORKER_ID'] ?? process.pid);
    return (Number.isFinite(id) ? id : process.pid) % PORT_SLICES;
}

/** Whether `port` can be bound on the IPv4 loopback right now (the socket is released at once). */
function canBind(port: number): boolean {
    const socket = dgram.createSocket({ type: 'udp4', lookup: syncLookup });
    try {
        socket.bind(port, '127.0.0.1');
        return true;
    } catch {
        return false;
    } finally {
        try {
            socket.close();
        } catch {
            // not bound
        }
    }
}

/**
 * An unused loopback UDP port that no other test can take between this call and the test's own bind.
 * <p>
 * Binding port 0 and releasing it (the earlier version) hands the kernel's ephemeral port back to the pool, where a
 * parallel worker's `bind(0)` can take it before the caller does (a TOCTOU race). The callers hand the port to a
 * driver, so the socket cannot be handed over. Instead each worker draws from a slice of ports of its own, below the
 * ephemeral range (no kernel `bind(0)` is ever given one), never repeats a port within the process until its slice is used up, and skips a
 * port that is bound right now.
 */
export function freeUdpPort(): number {
    const base = PORT_BASE + workerSlice() * PORT_SLICE;
    for (let attempt = 0; attempt < 2 * PORT_SLICE; attempt++) {
        const port = base + (sliceNext++ % PORT_SLICE);
        if (issued.has(port)) {
            continue;
        }
        if (canBind(port)) {
            issued.add(port);
            return port;
        }
    }

    // the slice is used up: start it again, and still skip a port that is bound
    issued.clear();
    for (let i = 0; i < PORT_SLICE; i++) {
        const port = base + (sliceNext++ % PORT_SLICE);
        if (canBind(port)) {
            issued.add(port);
            return port;
        }
    }

    throw new Error('no free UDP port in ' + base + '..' + (base + PORT_SLICE - 1));
}

/**
 * A stand-in for the node `dgram` socket of a transport that records the sends and answers `getSendQueueCount` from a
 * field, so that a test can hold the libuv queue "non-empty" or "empty" while it calls `send`. A sent datagram is a
 * reference to the slot, as in libuv (spec 4.2, N3): `sent[i].slot` is what libuv would read later, and
 * `sent[i].bytesAtSend` what the slot held when `send` was called.
 */
export class FakeSocket {
    public queueCount = 0;
    public closed = false;
    public readonly sent: {
        slot: Uint8Array;
        offset: number;
        length: number;
        port: number | undefined;
        address: string | undefined;
        callback: ((err: Error | null, bytes: number) => void) | undefined;
        bytesAtSend: Uint8Array;
    }[] = [];
    public throwOnSend: Error | null = null;
    private readonly listeners = new Map<string, ((...args: never[]) => void)[]>();

    public send(slot: Uint8Array, ...args: unknown[]): void {
        if (null !== this.throwOnSend) {
            throw this.throwOnSend;
        }

        const { offset, length, port, address, callback } = parseSendArgs(slot, args);
        this.sent.push({
            slot,
            offset,
            length,
            port,
            address,
            callback,
            bytesAtSend: slot.slice(offset, offset + length),
        });
    }

    public getSendQueueCount(): number {
        return this.queueCount;
    }

    public on(event: string, listener: (...args: never[]) => void): this {
        const list = this.listeners.get(event) ?? [];
        list.push(listener);
        this.listeners.set(event, list);
        return this;
    }

    public emit(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            (listener as (...a: unknown[]) => void)(...args);
        }
    }

    public close(): void {
        this.closed = true;
    }
}
