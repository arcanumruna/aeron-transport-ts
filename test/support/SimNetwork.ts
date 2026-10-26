// The deterministic network simulation of spec 8.2 (T22): an in-memory stand-in for the `dgram` sockets of the transports, with a
// seeded fault model (loss, bursts of loss, reordering, duplication, delay, and a send queue that fills for a while) on a clock
// the test advances. `SimNetwork.newSocket` replaces `dgram.createSocket` (the real transports, rings and send slots run
// over it), a datagram is delivered when `deliverDue` finds its time has come, and nothing else moves it: no timer, no
// event loop, no wall time. One seed, one network: the same sends give the same deliveries.
import type { RemoteInfo } from 'node:dgram';
import { mulberry32 } from './Random.js';
import { parseSendArgs } from './SendArgs.js';

/** The faults of a network. Every rate is the probability for one datagram. */
export interface FaultModel {
    /** a datagram is lost */
    readonly lossRate: number;
    /** after a loss, the next `burstLength` datagrams are lost too, with this probability */
    readonly burstRate: number;
    readonly burstLength: number;
    /** a datagram arrives twice (the copy takes its own delay) */
    readonly duplicateRate: number;
    /** a datagram takes up to `reorderDelayNs` more, so that later ones overtake it */
    readonly reorderRate: number;
    readonly reorderDelayNs: number;
    /** every datagram takes at least this long, and up to `jitterNs` more */
    readonly delayNs: number;
    readonly jitterNs: number;
    /** a send leaves the send queue of its socket non-empty for `sendBlockNs`: the transport sends nothing meanwhile */
    readonly sendBlockRate: number;
    readonly sendBlockNs: number;
}

export const NO_FAULTS: FaultModel = {
    lossRate: 0,
    burstRate: 0,
    burstLength: 0,
    duplicateRate: 0,
    reorderRate: 0,
    reorderDelayNs: 0,
    delayNs: 0,
    jitterNs: 0,
    sendBlockRate: 0,
    sendBlockNs: 0,
};

export interface NetworkStats {
    sent: number;
    lost: number;
    burstLost: number;
    duplicated: number;
    reordered: number;
    delivered: number;
    /** not delivered because no socket was bound to the port, or the receiver is connected to another peer */
    undeliverable: number;
    sendsBlocked: number;
    maxInFlight: number;
}

/** The clock of a simulation: the test advances it. */
export interface SimClock {
    nanoTime(): number;
}

interface InFlight {
    at: number;
    id: number;
    sentId: number;
    from: SimSocket;
    toPort: number;
    bytes: Uint8Array;
}

type MessageListener = (message: Uint8Array, rinfo: RemoteInfo) => void;
type ErrorListener = (error: Error) => void;
type SendCallback = (error: Error | null, bytes: number) => void;

const LOOPBACK = '127.0.0.1';
const FIRST_EPHEMERAL_PORT = 49152;
const OS_DEFAULT_BUFFER = 212992;
const OS_MAX_BUFFER = 4194304;

function sysError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

export class SimNetwork {
    public readonly stats: NetworkStats = {
        sent: 0,
        lost: 0,
        burstLost: 0,
        duplicated: 0,
        reordered: 0,
        delivered: 0,
        undeliverable: 0,
        sendsBlocked: 0,
        maxInFlight: 0,
    };

    /** A hash of every delivery (time, ports, length): two runs of one seed have the same one. */
    public trace = 2166136261;

    private readonly random: () => number;
    private readonly inFlight: InFlight[] = [];
    private readonly bound = new Map<number, SimSocket>();
    private readonly sockets = new Set<SimSocket>();
    private nextId = 0;
    private nextPort = FIRST_EPHEMERAL_PORT;
    private burstLeft = 0;
    private newestDelivered = new Map<SimSocket, number>();

    public constructor(
        seed: number,
        private readonly model: FaultModel,
        private readonly clock: SimClock,
    ) {
        this.random = mulberry32(seed);
    }

    /** The socket that `dgram.createSocket` answers. */
    public newSocket(): SimSocket {
        const socket = new SimSocket(this);
        this.sockets.add(socket);
        return socket;
    }

    public inFlightCount(): number {
        return this.inFlight.length;
    }

    /** The time of the next delivery, or null if nothing is in flight. */
    public nextDeliveryNs(): number | null {
        return this.inFlight.length > 0 ? (this.inFlight[0] as InFlight).at : null;
    }

    /** Deliver the datagrams whose time has come, in the order of their times, and complete the sends. Returns the number delivered. */
    public deliverDue(): number {
        const now = this.clock.nanoTime();
        for (const socket of this.sockets) {
            socket.completeSends(now);
        }

        let delivered = 0;
        while (this.inFlight.length > 0 && (this.inFlight[0] as InFlight).at <= now) {
            const datagram = this.inFlight.shift() as InFlight;
            const destination = this.bound.get(datagram.toPort);
            if (
                undefined === destination ||
                destination.isClosed() ||
                (null !== destination.connectedPort && destination.connectedPort !== datagram.from.port())
            ) {
                this.stats.undeliverable++;
                continue;
            }

            const newest = this.newestDelivered.get(destination) ?? -1;
            if (datagram.sentId < newest) {
                this.stats.reordered++;
            } else {
                this.newestDelivered.set(destination, datagram.sentId);
            }

            this.stats.delivered++;
            delivered++;
            this.trace = Math.imul(
                (this.trace ^ (datagram.at & 0x7fffffff) ^ (datagram.from.port() << 3) ^ datagram.bytes.length) >>> 0,
                16777619,
            );
            destination.deliver(datagram.bytes, datagram.from.port());
        }

        return delivered;
    }

    // --- used by SimSocket ---

    /** @internal */
    public bind(socket: SimSocket, port: number, reuse: boolean): number {
        const chosen = 0 === port ? this.nextPort++ : port;
        const existing = this.bound.get(chosen);
        if (undefined !== existing && !existing.isClosed() && !(reuse && existing.reuses())) {
            throw sysError('EADDRINUSE', 'bind EADDRINUSE 0.0.0.0:' + chosen);
        }

        this.bound.set(chosen, socket);
        return chosen;
    }

    /** @internal */
    public unbind(socket: SimSocket, port: number): void {
        if (this.bound.get(port) === socket) {
            this.bound.delete(port);
        }
        this.newestDelivered.delete(socket);
    }

    /** @internal Send a datagram into the network: apply the faults, and schedule the deliveries that remain. */
    public send(from: SimSocket, toPort: number, bytes: Uint8Array): void {
        const model = this.model;
        const sentId = this.nextId++;
        this.stats.sent++;

        if (this.burstLeft > 0) {
            this.burstLeft--;
            this.stats.lost++;
            this.stats.burstLost++;
            return;
        }

        if (this.random() < model.lossRate) {
            this.stats.lost++;
            if (this.random() < model.burstRate) {
                this.burstLeft = model.burstLength;
            }
            return;
        }

        this.schedule(from, toPort, bytes, sentId, false);
        if (this.random() < model.duplicateRate) {
            this.stats.duplicated++;
            this.schedule(from, toPort, bytes.slice(), sentId, true);
        }
    }

    /** @internal Whether this send keeps the send queue of the socket non-empty, and for how long. */
    public sendBlockNs(): number {
        if (this.model.sendBlockRate > 0 && this.random() < this.model.sendBlockRate) {
            this.stats.sendsBlocked++;
            return this.model.sendBlockNs;
        }
        return 0;
    }

    /** @internal */
    public now(): number {
        return this.clock.nanoTime();
    }

    private schedule(from: SimSocket, toPort: number, bytes: Uint8Array, sentId: number, isCopy: boolean): void {
        const model = this.model;
        let delay = model.delayNs + Math.floor(this.random() * (model.jitterNs + 1));
        if (this.random() < model.reorderRate) {
            delay += Math.floor(this.random() * (model.reorderDelayNs + 1));
        }
        if (isCopy) {
            delay += Math.floor(this.random() * (model.jitterNs + model.reorderDelayNs + 1));
        }

        const datagram: InFlight = {
            at: this.clock.nanoTime() + delay,
            id: this.nextId++,
            sentId,
            from,
            toPort,
            bytes,
        };
        // sorted by time, and by the order of the sends for equal times
        let low = 0;
        let high = this.inFlight.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const other = this.inFlight[middle] as InFlight;
            if (other.at < datagram.at || (other.at === datagram.at && other.id < datagram.id)) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        this.inFlight.splice(low, 0, datagram);
        this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.inFlight.length);
    }

    /** @internal */
    public forget(socket: SimSocket): void {
        this.sockets.delete(socket);
    }
}

/**
 * The part of a node `dgram.Socket` that the transports use, over a {@link SimNetwork}. A socket with a synchronous lookup binds
 * and connects inside the call (the transports rely on it, spec 4.2 N2); a send is accepted at once, its callback comes at the
 * next step, and the send queue of the socket is non-empty only when the network says a send is held.
 */
export class SimSocket {
    private readonly messageListeners: MessageListener[] = [];
    private readonly errorListeners: ErrorListener[] = [];
    private boundPort = 0;
    private boundHost: string | null = null;
    private remote: { port: number; host: string } | null = null;
    private closed = false;
    private sendBuffer = OS_DEFAULT_BUFFER;
    private recvBuffer = OS_DEFAULT_BUFFER;
    private blockedUntil = -1;
    private pendingCallbacks: { callback: SendCallback; bytes: number; at: number }[] = [];

    public constructor(private readonly network: SimNetwork) {}

    public on(event: string, listener: (...args: never[]) => void): this {
        if ('message' === event) {
            this.messageListeners.push(listener as unknown as MessageListener);
        } else if ('error' === event) {
            this.errorListeners.push(listener as unknown as ErrorListener);
        }
        return this;
    }

    public bind(port: number, host?: string): void {
        try {
            this.boundPort = this.network.bind(this, port, false);
            this.boundHost = host ?? null;
        } catch (ex) {
            for (const listener of this.errorListeners) {
                listener(ex as Error);
            }
        }
    }

    public address(): { address: string; family: string; port: number } {
        if (0 === this.boundPort) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
        }
        return { address: this.boundHost ?? '0.0.0.0', family: 'IPv4', port: this.boundPort };
    }

    public connect(port: number, host: string): void {
        if (0 === this.boundPort) {
            this.boundPort = this.network.bind(this, 0, false);
        }
        this.remote = { port, host };
    }

    public disconnect(): void {
        if (null === this.remote) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
        }
        this.remote = null;
    }

    public remoteAddress(): { address: string; family: string; port: number } {
        if (null === this.remote) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
        }
        return { address: this.remote.host, family: 'IPv4', port: this.remote.port };
    }

    public send(slot: Uint8Array, ...args: unknown[]): void {
        if (this.closed) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
        }

        const { offset, length, port, callback: done } = parseSendArgs(slot, args);
        const toPort = port ?? this.remote?.port;
        if (undefined === toPort) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
        }
        if (0 === this.boundPort) {
            this.boundPort = this.network.bind(this, 0, false);
        }

        // libuv reads the slot later, node's callback says when it is free again: the network keeps a copy, as the kernel does
        this.network.send(this, toPort, slot.slice(offset, offset + length));

        const now = this.network.now();
        const blockNs = this.network.sendBlockNs();
        if (blockNs > 0) {
            this.blockedUntil = Math.max(this.blockedUntil, now + blockNs);
        }
        if (undefined !== done) {
            this.pendingCallbacks.push({ callback: done, bytes: length, at: Math.max(now + 1, this.blockedUntil) });
        }
    }

    public getSendQueueCount(): number {
        return this.network.now() < this.blockedUntil ? 1 : 0;
    }

    public setSendBufferSize(size: number): void {
        this.sendBuffer = Math.min(size, OS_MAX_BUFFER);
    }

    public getSendBufferSize(): number {
        return this.sendBuffer;
    }

    public setRecvBufferSize(size: number): void {
        this.recvBuffer = Math.min(size, OS_MAX_BUFFER);
    }

    public getRecvBufferSize(): number {
        return this.recvBuffer;
    }

    public close(): void {
        if (this.closed) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
        }
        this.closed = true;
        this.network.unbind(this, this.boundPort);
        // node completes the sends that are still queued with ECANCELED
        const cancelled = this.pendingCallbacks;
        this.pendingCallbacks = [];
        for (const pending of cancelled) {
            pending.callback(sysError('ECANCELED', 'send ECANCELED'), 0);
        }
        this.network.forget(this);
    }

    // --- used by the network ---

    /** @internal */
    public get connectedPort(): number | null {
        return this.remote?.port ?? null;
    }

    /** @internal */
    public port(): number {
        return this.boundPort;
    }

    /** @internal */
    public isClosed(): boolean {
        return this.closed;
    }

    /** @internal a socket made with `reuseAddr` */
    public reuses(): boolean {
        return false;
    }

    /** @internal */
    public completeSends(now: number): void {
        if (this.pendingCallbacks.length === 0) {
            return;
        }

        const due = this.pendingCallbacks.filter((pending) => pending.at <= now);
        if (due.length > 0) {
            this.pendingCallbacks = this.pendingCallbacks.filter((pending) => pending.at > now);
            for (const pending of due) {
                pending.callback(null, pending.bytes);
            }
        }
    }

    /** @internal */
    public deliver(bytes: Uint8Array, fromPort: number): void {
        const rinfo: RemoteInfo = { address: LOOPBACK, family: 'IPv4', port: fromPort, size: bytes.length };
        // the datagram is the listener's to keep, as the Buffer that node allocates for it is
        const message = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
        for (const listener of this.messageListeners) {
            listener(message, rinfo);
        }
    }
}
