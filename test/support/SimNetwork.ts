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
    /** a copy for one member of a multicast group (D117), otherwise null: the socket bound to `toPort` */
    member: Member | null;
}

/**
 * A socket that receives multicast datagrams: its own seeded draws (D117), so that one receiver's loss is not another's.
 * Made when the socket first joins a group or first receives a group's datagram, in that order, which the seed fixes.
 */
interface Member {
    readonly socket: SimSocket;
    readonly ordinal: number;
    readonly random: () => number;
    burstLeft: number;
    lost: number;
    delivered: number;
}

/** What one member of a multicast group has seen. */
export interface MemberStats {
    lost: number;
    delivered: number;
}

type MessageListener = (message: Uint8Array, rinfo: RemoteInfo) => void;
type ErrorListener = (error: Error) => void;
type SendCallback = (error: Error | null, bytes: number) => void;

const LOOPBACK = '127.0.0.1';

/** An IPv4 multicast address: 224.0.0.0 to 239.255.255.255. */
export function isMulticastAddress(address: string): boolean {
    const first = Number(address.split('.')[0]);
    return /^\d+\.\d+\.\d+\.\d+$/.test(address) && first >= 224 && first <= 239;
}
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
    /** sockets made with `reuseAddr` share a port; the last to bind gets the unicast datagrams, as on Linux */
    private readonly shared = new Map<number, SimSocket[]>();
    /** the multicast group memberships, in the order they were made */
    private readonly joined: { socket: SimSocket; group: string }[] = [];
    /** the faults and counts of each socket that has received a group's datagrams, kept after it closes */
    private readonly members = new Map<SimSocket, Member>();
    private nextMemberOrdinal = 0;
    private readonly sockets = new Set<SimSocket>();
    private nextId = 0;
    private nextPort = FIRST_EPHEMERAL_PORT;
    private burstLeft = 0;
    private newestDelivered = new Map<SimSocket, number>();

    private readonly seed: number;
    private readonly model: FaultModel;
    private readonly clock: SimClock;
    public constructor(seed: number, model: FaultModel, clock: SimClock) {
        this.seed = seed;
        this.model = model;
        this.clock = clock;
        this.random = mulberry32(seed);
    }

    /** The socket that `dgram.createSocket` answers. */
    public newSocket(options: { reuseAddr?: boolean } = {}): SimSocket {
        const socket = new SimSocket(this, options.reuseAddr === true);
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
            const destination = null !== datagram.member ? datagram.member.socket : this.lookup(datagram.toPort);
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
            if (null !== datagram.member) {
                datagram.member.delivered++;
                this.trace = Math.imul((this.trace ^ (datagram.member.ordinal + 1)) >>> 0, 16777619);
            }
            destination.deliver(datagram.bytes, datagram.from.port());
        }

        return delivered;
    }

    // --- used by SimSocket ---

    /** @internal */
    public bind(socket: SimSocket, port: number): number {
        const chosen = 0 === port ? this.nextPort++ : port;
        const existing = this.bound.get(chosen);
        const sharing = this.shared.get(chosen);
        const inUse =
            (undefined !== existing && !existing.isClosed()) ||
            (undefined !== sharing && sharing.some((other) => !other.isClosed()));
        if (inUse && !(socket.reuses() && undefined === existing)) {
            throw sysError('EADDRINUSE', 'bind EADDRINUSE 0.0.0.0:' + chosen);
        }

        if (socket.reuses()) {
            const list = (sharing ?? []).filter((other) => !other.isClosed());
            list.push(socket);
            this.shared.set(chosen, list);
        } else {
            this.bound.set(chosen, socket);
        }
        return chosen;
    }

    /** @internal */
    public unbind(socket: SimSocket, port: number): void {
        if (this.bound.get(port) === socket) {
            this.bound.delete(port);
        }
        const sharing = this.shared.get(port);
        if (undefined !== sharing) {
            const remaining = sharing.filter((other) => other !== socket);
            if (remaining.length > 0) {
                this.shared.set(port, remaining);
            } else {
                this.shared.delete(port);
            }
        }
        for (let i = this.joined.length - 1; i >= 0; i--) {
            if ((this.joined[i] as { socket: SimSocket }).socket === socket) {
                this.joined.splice(i, 1);
            }
        }
        this.newestDelivered.delete(socket);
    }

    /** @internal The socket that a unicast datagram to the port reaches. */
    private lookup(port: number): SimSocket | undefined {
        const exclusive = this.bound.get(port);
        if (undefined !== exclusive) {
            return exclusive;
        }
        const sharing = this.shared.get(port);
        return undefined === sharing ? undefined : sharing[sharing.length - 1];
    }

    /** @internal The socket joins the group; a second join of one group by one socket is an `EADDRINUSE`, as in the kernel. */
    public join(socket: SimSocket, group: string): void {
        if (!isMulticastAddress(group)) {
            throw sysError('EINVAL', 'addMembership EINVAL');
        }
        if (this.joined.some((entry) => entry.socket === socket && entry.group === group)) {
            throw sysError('EADDRINUSE', 'addMembership EADDRINUSE');
        }

        this.memberOf(socket);
        this.joined.push({ socket, group });
    }

    /** @internal */
    public leave(socket: SimSocket, group: string): void {
        const index = this.joined.findIndex((entry) => entry.socket === socket && entry.group === group);
        if (index < 0) {
            throw sysError('EADDRNOTAVAIL', 'dropMembership EADDRNOTAVAIL');
        }
        this.joined.splice(index, 1);
    }

    private memberOf(socket: SimSocket): Member {
        let member = this.members.get(socket);
        if (undefined === member) {
            const ordinal = this.members.size;
            // the draws of a receiver come from the seed of the network and the order in which receivers appear: the same
            // seed and the same sockets give the same losses for each receiver, and no two receivers share a stream
            const random = mulberry32(((this.seed * 0x9e3779b1) ^ Math.imul(ordinal + 1, 0x85ebca6b)) >>> 0);
            member = { socket, ordinal, random, burstLeft: 0, lost: 0, delivered: 0 };
            this.members.set(socket, member);
        }
        return member;
    }

    /** The groups a socket is a member of. */
    public groupsOf(socket: SimSocket): string[] {
        return this.joined.filter((entry) => entry.socket === socket).map((entry) => entry.group);
    }

    /** What the copies for one socket (in all the groups it was in) have done: lost and delivered. */
    public statsOfMember(socket: SimSocket): MemberStats {
        const member = this.members.get(socket);
        return { lost: member?.lost ?? 0, delivered: member?.delivered ?? 0 };
    }

    /** The sockets bound to the port that a datagram to the group reaches, in the order they bound. */
    private receiversOfGroup(group: string, port: number): SimSocket[] {
        const candidates: SimSocket[] = [];
        const exclusive = this.bound.get(port);
        if (undefined !== exclusive) {
            candidates.push(exclusive);
        }
        candidates.push(...(this.shared.get(port) ?? []));
        return candidates.filter(
            (socket) => !socket.isClosed() && (null === socket.boundHost() || group === socket.boundHost()),
        );
    }

    /** @internal Send a datagram into the network: apply the faults, and schedule the deliveries that remain. */
    public send(from: SimSocket, toPort: number, bytes: Uint8Array, toAddress?: string): void {
        const model = this.model;
        const sentId = this.nextId++;
        this.stats.sent++;

        if (undefined !== toAddress && isMulticastAddress(toAddress)) {
            this.sendToGroup(from, toAddress, toPort, bytes, sentId);
            return;
        }

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

        this.schedule(from, toPort, bytes, sentId, false, this.random, null);
        if (this.random() < model.duplicateRate) {
            this.stats.duplicated++;
            this.schedule(from, toPort, bytes.slice(), sentId, true, this.random, null);
        }
    }

    /**
     * A datagram sent to a group (D117): every socket that is a member of the group and bound to the port gets a copy
     * (the sender too, if it is a member: loopback is on), and each copy has its own draw of loss, burst, duplication,
     * reordering and delay from the member's own stream.
     */
    private sendToGroup(from: SimSocket, group: string, toPort: number, bytes: Uint8Array, sentId: number): void {
        const model = this.model;
        // as on Linux (IP_MULTICAST_ALL is on): once any socket of the host has joined the group, every socket bound to the
        // port (to the wildcard address or the group) gets its datagrams, joined or not, and a socket that left the group
        // keeps getting them while another one is in it. The transports bind and join together, so they see no difference.
        if (!this.joined.some((entry) => entry.group === group && !entry.socket.isClosed())) {
            this.stats.undeliverable++;
            return;
        }

        for (const socket of this.receiversOfGroup(group, toPort)) {
            const member = this.memberOf(socket);
            const random = member.random;
            if (member.burstLeft > 0) {
                member.burstLeft--;
                member.lost++;
                this.stats.lost++;
                this.stats.burstLost++;
                continue;
            }

            if (random() < model.lossRate) {
                member.lost++;
                this.stats.lost++;
                if (random() < model.burstRate) {
                    member.burstLeft = model.burstLength;
                }
                continue;
            }

            this.schedule(from, toPort, bytes.slice(), sentId, false, random, member);
            if (random() < model.duplicateRate) {
                this.stats.duplicated++;
                this.schedule(from, toPort, bytes.slice(), sentId, true, random, member);
            }
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

    private schedule(
        from: SimSocket,
        toPort: number,
        bytes: Uint8Array,
        sentId: number,
        isCopy: boolean,
        random: () => number,
        member: Member | null,
    ): void {
        const model = this.model;
        let delay = model.delayNs + Math.floor(random() * (model.jitterNs + 1));
        if (random() < model.reorderRate) {
            delay += Math.floor(random() * (model.reorderDelayNs + 1));
        }
        if (isCopy) {
            delay += Math.floor(random() * (model.jitterNs + model.reorderDelayNs + 1));
        }

        const datagram: InFlight = {
            at: this.clock.nanoTime() + delay,
            id: this.nextId++,
            sentId,
            from,
            toPort,
            bytes,
            member,
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
    private boundHost_: string | null = null;
    private remote: { port: number; host: string } | null = null;
    private closed = false;
    private sendBuffer = OS_DEFAULT_BUFFER;
    private recvBuffer = OS_DEFAULT_BUFFER;
    private blockedUntil = -1;
    private pendingCallbacks: { callback: SendCallback; bytes: number; at: number }[] = [];

    private multicastTtlValue = 1;
    private multicastLoopbackValue = true;
    private multicastInterfaceValue: string | null = null;

    private readonly network: SimNetwork;
    private readonly reuseAddr;
    public constructor(network: SimNetwork, reuseAddr = false) {
        this.network = network;
        this.reuseAddr = reuseAddr;
    }

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
            this.boundPort = this.network.bind(this, port);
            this.boundHost_ = host ?? null;
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
        return { address: this.boundHost_ ?? '0.0.0.0', family: 'IPv4', port: this.boundPort };
    }

    public connect(port: number, host: string): void {
        if (0 === this.boundPort) {
            this.boundPort = this.network.bind(this, 0);
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

        const { offset, length, port, address, callback: done } = parseSendArgs(slot, args);
        const toPort = port ?? this.remote?.port;
        if (undefined === toPort) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_CONNECTED', 'Not connected');
        }
        if (0 === this.boundPort) {
            this.boundPort = this.network.bind(this, 0);
        }

        // libuv reads the slot later, node's callback says when it is free again: the network keeps a copy, as the kernel does
        this.network.send(this, toPort, slot.slice(offset, offset + length), address ?? this.remote?.host);

        const now = this.network.now();
        const blockNs = this.network.sendBlockNs();
        if (blockNs > 0) {
            this.blockedUntil = Math.max(this.blockedUntil, now + blockNs);
        }
        if (undefined !== done) {
            this.pendingCallbacks.push({ callback: done, bytes: length, at: Math.max(now + 1, this.blockedUntil) });
        }
    }

    /** Join a group; like node's it needs a bound socket (the kernel's join does not, but the transports bind first). */
    public addMembership(group: string, multicastInterface?: string): void {
        if (0 === this.boundPort) {
            throw sysError('EBADF', 'addMembership EBADF');
        }
        this.network.join(this, group);
        void multicastInterface;
    }

    public dropMembership(group: string, multicastInterface?: string): void {
        this.network.leave(this, group);
        void multicastInterface;
    }

    public setMulticastInterface(multicastInterface: string): void {
        if (0 === this.boundPort) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
        }
        this.multicastInterfaceValue = multicastInterface;
    }

    public setMulticastTTL(ttl: number): number {
        if (0 === this.boundPort) {
            throw sysError('ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running');
        }
        if (!Number.isInteger(ttl) || ttl < 0 || ttl > 255) {
            throw sysError('EINVAL', 'setMulticastTTL EINVAL');
        }
        this.multicastTtlValue = ttl;
        return ttl;
    }

    public setMulticastLoopback(flag: boolean): boolean {
        this.multicastLoopbackValue = flag;
        return flag;
    }

    public multicastTtl(): number {
        return this.multicastTtlValue;
    }

    public multicastLoopback(): boolean {
        return this.multicastLoopbackValue;
    }

    public multicastInterface(): string | null {
        return this.multicastInterfaceValue;
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

    /** @internal the address the socket was bound to, null for the wildcard address */
    public boundHost(): string | null {
        return null === this.boundHost_ || '0.0.0.0' === this.boundHost_ ? null : this.boundHost_;
    }

    /** @internal */
    public isClosed(): boolean {
        return this.closed;
    }

    /** @internal a socket made with `reuseAddr` */
    public reuses(): boolean {
        return this.reuseAddr;
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
