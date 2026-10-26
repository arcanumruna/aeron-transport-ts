// The end-to-end bench harness of T24 (spec 5.3, D110): two `MediaDriver`s and two `Aeron` clients of one process on the
// loopback, as the system tests of T22 run them (the drivers run themselves on the event loop, D100; the clients are
// polled by the bench), a ping/pong and a one-way stream over them, the raw `dgram` floor with the same sizes, the
// first message after the runner has been idle (D101), and the allocation figures of a run.
//
// One process, one thread: a round trip is two datagrams and four turns of the event loop at least, so these figures are
// this port's cost on top of the event loop and the kernel, and the `dgram` floor is what the same ping/pong costs with
// no Aeron at all.
import dgram from 'node:dgram';
import inspector from 'node:inspector/promises';
import { PerformanceObserver } from 'node:perf_hooks';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { Aeron } from '../../src/client/Aeron.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { median, percentile } from './stats.js';
import { MAX_TURNS, TurnCap } from './turnCap.js';

/** The longest an end-to-end wait takes before it fails instead of hanging, in ms. */
const WAIT_CAP_MS = 20_000;
const PING_STREAM = 1001;
const PONG_STREAM = 1002;
const TERM_LENGTH = 1 << 20;
/** The largest message that fits one datagram of the default MTU (1408 - the 32 byte header). */
export const MAX_UNFRAGMENTED = 1376;

/** A `MediaDriver` and an `Aeron` client of this process, on the default configuration (D100). */
export class Node {
    public readonly errors: Error[] = [];
    public readonly driver: MediaDriver;
    public readonly aeron: Aeron;

    public constructor() {
        this.driver = MediaDriver.launch(
            new MediaDriver.Context().errorHandler({ onError: (e) => void this.errors.push(e) }),
        );
        this.aeron = Aeron.connect(
            new Aeron.Context().mediaDriver(this.driver).errorHandler({ onError: (e) => void this.errors.push(e) }),
        );
    }

    public close(): void {
        this.aeron.close();
        this.driver.close();
    }
}

/** One turn of the event loop. */
export function turn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A free UDP port of the loopback: bind to port 0, read it, close. */
export async function freePort(): Promise<number> {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise<void>((resolve) => socket.close(resolve));
    return port;
}

/** Turns of the event loop until the condition holds; fails at the cap of time. */
export async function until(condition: () => boolean, what: string): Promise<void> {
    const deadline = performance.now() + WAIT_CAP_MS;
    while (!condition()) {
        if (performance.now() > deadline) {
            throw new Error('no ' + what + ' after ' + WAIT_CAP_MS + ' ms');
        }
        await turn();
    }
}

/**
 * Publisher node A, subscriber node B, and (with `echo`) the way back: B's handler offers every message it reads on the
 * pong stream, and A polls that. The message is the same bytes both ways.
 */
export class Loopback {
    public readonly a = new Node();
    public readonly b = new Node();
    public pingPublication!: Publication;
    public pingSubscription!: Subscription;
    public pongPublication?: Publication;
    public pongSubscription?: Subscription;
    /** Messages read by the end of the path: B for a one-way stream, A for a ping/pong. */
    public received = 0;
    /** The bytes of those messages. */
    public receivedBytes = 0;
    /** After every offer, wake the runner of the driver that has work now (D101): what an application that cannot wait does. */
    public wake = true;
    private pongOfferFailures = 0;

    private readonly onPong: FragmentHandler = {
        onFragment: (_buffer, _offset, length): void => {
            this.received++;
            this.receivedBytes += length;
        },
    };

    private readonly onPing: FragmentHandler = {
        onFragment: (buffer, offset, length): void => {
            if (undefined === this.pongPublication) {
                this.received++;
                this.receivedBytes += length;
                return;
            }
            let result = this.pongPublication.offer(buffer, offset, length);
            while (result < 0) {
                if (++this.pongOfferFailures > 1_000_000 || Publication.NOT_CONNECTED === result) {
                    throw new Error('the echo offer answered ' + result);
                }
                result = this.pongPublication.offer(buffer, offset, length);
            }
            if (this.wake) {
                this.b.driver.wake();
            }
        },
    };

    private readonly echo: boolean;
    private constructor(echo: boolean) {
        this.echo = echo;
    }

    public static async create(echo: boolean, wake = true): Promise<Loopback> {
        const lb = new Loopback(echo);
        lb.wake = wake;
        try {
            await lb.connect();
        } catch (e) {
            lb.close();
            throw e;
        }
        return lb;
    }

    private async connect(): Promise<void> {
        const portB = await freePort();
        const params = '|term-length=' + TERM_LENGTH;
        this.pingSubscription = this.b.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + portB, PING_STREAM);
        this.pingPublication = this.a.aeron.addPublication(
            'aeron:udp?endpoint=127.0.0.1:' + portB + params,
            PING_STREAM,
        ) as Publication;
        if (this.echo) {
            const portA = await freePort();
            this.pongSubscription = this.a.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + portA, PONG_STREAM);
            this.pongPublication = this.b.aeron.addPublication(
                'aeron:udp?endpoint=127.0.0.1:' + portA + params,
                PONG_STREAM,
            ) as Publication;
        }
        await until(
            () =>
                this.pingPublication.isConnected() &&
                this.pingSubscription.imageCount() > 0 &&
                (undefined === this.pongPublication ||
                    (this.pongPublication.isConnected() && (this.pongSubscription?.imageCount() ?? 0) > 0)),
            'connected stream',
        );
    }

    /** Offer on the ping stream; retries while it is back pressured. Returns false if the stream is not connected. */
    public offer(buffer: UnsafeBuffer, length: number): boolean {
        for (let attempts = 0; attempts < 1_000_000; attempts++) {
            const result = this.pingPublication.offer(buffer, 0, length);
            if (result > 0) {
                if (this.wake) {
                    this.a.driver.wake();
                }
                return true;
            }
            if (Publication.NOT_CONNECTED === result) {
                return false;
            }
        }
        throw new Error('offer is back pressured for good');
    }

    /** One try to offer; the result of `Publication.offer`. */
    public tryOffer(buffer: UnsafeBuffer, length: number): number {
        return this.pingPublication.offer(buffer, 0, length);
    }

    /** One poll of what the path ends at. */
    public pollEnd(limit = 64): number {
        return (this.pongSubscription ?? this.pingSubscription).poll(this.echo ? this.onPong : this.onPing, limit);
    }

    /** One poll of B's ping subscription (the echo, or the consumer of a one-way stream). */
    public pollPing(limit = 64): number {
        return this.pingSubscription.poll(this.onPing, limit);
    }

    public errors(): Error[] {
        return [...this.a.errors, ...this.b.errors];
    }

    public close(): void {
        this.a.close();
        this.b.close();
    }
}

/** A message buffer of `length` bytes with a pattern in it. */
export function message(length: number): UnsafeBuffer {
    const bytes = new Uint8Array(Math.max(length, 8));
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (i * 7 + 3) & 0xff;
    }
    return new UnsafeBuffer(bytes);
}

/** `n` round trips of `size` bytes (offer, echo, read), the time of each in ns in `out`. Returns the number done. */
export async function roundTrips(lb: Loopback, size: number, out: Float64Array, maxTurns = MAX_TURNS): Promise<void> {
    const buffer = message(size);
    for (let i = 0; i < out.length; i++) {
        const t0 = performance.now();
        const target = lb.received + 1;
        if (!lb.offer(buffer, size)) {
            throw new Error('the ping stream is not connected');
        }
        const cap = new TurnCap(
            'round trips of ' + size + ' bytes',
            () => 'received ' + lb.received + '/' + target,
            maxTurns,
        );
        while (lb.received < target) {
            cap.tick();
            await turn();
            lb.pollPing(1);
            lb.pollEnd(1);
        }
        out[i] = (performance.now() - t0) * 1e6;
    }
}

/**
 * A one-way stream of `size` byte messages from A to B, continuously, until `windows` windows of `window` messages have
 * been read; `out[k]` is the ns per message of window k (the time between the reads of its first and last message).
 * Returns the messages and the bytes read.
 */
export async function oneWay(
    lb: Loopback,
    size: number,
    window: number,
    out: Float64Array,
    maxTurns = MAX_TURNS,
): Promise<{ messages: number; bytes: number }> {
    const buffer = message(size);
    const startMessages = lb.received;
    const startBytes = lb.receivedBytes;
    const total = window * out.length;
    let sent = 0;
    let mark = 0;
    let t0 = performance.now();
    const cap = new TurnCap(
        'one-way stream of ' + size + ' bytes',
        () => 'received ' + (lb.received - startMessages) + '/' + total + ', sent ' + sent,
        maxTurns,
    );
    while (mark < out.length) {
        cap.tick();
        for (let i = 0; i < 32 && sent < total; i++) {
            const result = lb.tryOffer(buffer, size);
            if (result > 0) {
                sent++;
            } else if (Publication.NOT_CONNECTED === result) {
                throw new Error('the stream is not connected');
            } else {
                break;
            }
        }
        if (lb.wake) {
            lb.a.driver.wake();
        }
        await turn();
        lb.pollPing(64);
        while (mark < out.length && lb.received - startMessages >= (mark + 1) * window) {
            const t = performance.now();
            out[mark++] = ((t - t0) * 1e6) / window;
            t0 = t;
        }
    }
    return { messages: lb.received - startMessages, bytes: lb.receivedBytes - startBytes };
}

/**
 * A promise that a datagram callback resolves, rejected after `WAIT_CAP_MS`: a datagram that is lost on the loopback would
 * wait for ever otherwise.
 */
function withinCap<T = void>(what: string, start: (resolve: (value: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no ' + what + ' after ' + WAIT_CAP_MS + ' ms')), WAIT_CAP_MS);
        start((value) => {
            clearTimeout(timer);
            resolve(value);
        });
    });
}

/** The raw `dgram` floor: two sockets of the loopback, the echo in the 'message' handler of the second. */
export class DgramPair {
    private readonly one = dgram.createSocket('udp4');
    private readonly two = dgram.createSocket('udp4');
    private port1 = 0;
    private port2 = 0;
    private resolve: (() => void) | null = null;
    public receivedByTwo = 0;
    public bytesReceivedByTwo = 0;
    private echoing = true;
    private credit: (() => void) | null = null;

    public static async create(): Promise<DgramPair> {
        const pair = new DgramPair();
        await Promise.all([
            new Promise<void>((r) => pair.one.bind(0, '127.0.0.1', r)),
            new Promise<void>((r) => pair.two.bind(0, '127.0.0.1', r)),
        ]);
        pair.port1 = pair.one.address().port;
        pair.port2 = pair.two.address().port;
        pair.one.on('message', () => {
            pair.resolve?.();
        });
        pair.two.on('message', (msg) => {
            pair.receivedByTwo++;
            pair.bytesReceivedByTwo += msg.length;
            if (pair.echoing) {
                pair.two.send(msg, pair.port1, '127.0.0.1');
            } else {
                pair.credit?.();
            }
        });
        return pair;
    }

    /** `out.length` round trips of `size` bytes, ns each. */
    public async roundTrips(size: number, out: Float64Array): Promise<void> {
        this.echoing = true;
        const buffer = Buffer.alloc(Math.max(size, 8), 7);
        const payload = buffer.subarray(0, size);
        for (let i = 0; i < out.length; i++) {
            const t0 = performance.now();
            await withinCap('raw dgram round trip of ' + size + ' bytes', (resolve) => {
                this.resolve = resolve;
                this.one.send(payload, this.port2, '127.0.0.1');
            });
            out[i] = (performance.now() - t0) * 1e6;
        }
    }

    /**
     * A one-way stream, `windows` windows of `window` datagrams, with a credit of `IN_FLIGHT` datagrams: the sender sends
     * one more for each one the receiver has read, so the receive buffer never overflows.
     */
    public async oneWay(size: number, window: number, out: Float64Array): Promise<{ messages: number; bytes: number }> {
        this.echoing = false;
        const IN_FLIGHT = 64;
        const buffer = Buffer.alloc(Math.max(size, 8), 7).subarray(0, size);
        const total = window * out.length;
        const start = this.receivedByTwo;
        const startBytes = this.bytesReceivedByTwo;
        let sent = 0;
        let mark = 0;
        let t0 = performance.now();
        await withinCap('raw dgram stream of ' + size + ' bytes', (done) => {
            this.credit = () => {
                const read = this.receivedByTwo - start;
                while (mark < out.length && read >= (mark + 1) * window) {
                    const t = performance.now();
                    out[mark++] = ((t - t0) * 1e6) / window;
                    t0 = t;
                }
                if (read >= total) {
                    done();
                } else if (sent < total) {
                    sent++;
                    this.one.send(buffer, this.port2, '127.0.0.1');
                }
            };
            for (; sent < IN_FLIGHT && sent < total; sent++) {
                this.one.send(buffer, this.port2, '127.0.0.1');
            }
        });
        this.credit = null;
        return { messages: this.receivedByTwo - start, bytes: this.bytesReceivedByTwo - startBytes };
    }

    /** One datagram of `size` bytes from the first socket to the second: the ns from `send` to the 'message' event. */
    public firstMessage(size: number): Promise<number> {
        this.echoing = false;
        const payload = Buffer.alloc(Math.max(size, 8), 7).subarray(0, size);
        const t0 = performance.now();
        return withinCap<number>('raw dgram first message', (resolve) => {
            this.credit = () => {
                this.credit = null;
                resolve((performance.now() - t0) * 1e6);
            };
            this.one.send(payload, this.port2, '127.0.0.1');
        });
    }

    public close(): void {
        this.one.close();
        this.two.close();
    }
}

/** p50, p99 and p99.9 of the samples of one run (ns). */
export function summarize(samples: Float64Array): { p50: number; p99: number; p999: number; mean: number } {
    const sorted = Float64Array.from(samples).sort();
    let sum = 0;
    for (const s of samples) {
        sum += s;
    }
    return {
        p50: percentile(sorted, 0.5),
        p99: percentile(sorted, 0.99),
        p999: percentile(sorted, 0.999),
        mean: sum / samples.length,
    };
}

/** The median per field of the summaries of several runs. */
export function medianOfRuns(runs: readonly ReturnType<typeof summarize>[]): ReturnType<typeof summarize> {
    return {
        p50: median(runs.map((r) => r.p50)),
        p99: median(runs.map((r) => r.p99)),
        p999: median(runs.map((r) => r.p999)),
        mean: median(runs.map((r) => r.mean)),
    };
}

/**
 * The first message after the runners have been idle (D101): the time from `offer` to the read by the subscriber, ns, of
 * `count` messages, each after `idleMs` of nothing (the runners go back to the park of 1 ms). With `wake` the application
 * calls `MediaDriver.wake()` right after the offer. Returns one sample per message.
 */
export async function firstMessageAfterIdle(
    lb: Loopback,
    count: number,
    idleMs: number,
    wake: boolean,
): Promise<Float64Array> {
    const out = new Float64Array(count);
    const buffer = message(32);
    const saved = lb.wake;
    lb.wake = false;
    try {
        for (let i = 0; i < count; i++) {
            await sleep(idleMs);
            const target = lb.received + 1;
            const t0 = performance.now();
            if (!lb.offer(buffer, 32)) {
                throw new Error('the stream is not connected');
            }
            if (wake) {
                lb.a.driver.wake();
            }
            const cap = new TurnCap('first message after idle', () => 'received ' + lb.received + '/' + target);
            while (lb.received < target) {
                cap.tick();
                await turn();
                lb.pollPing(1);
            }
            out[i] = (performance.now() - t0) * 1e6;
        }
    } finally {
        lb.wake = saved;
    }
    return out;
}

/** Where the bytes allocated during a run came from, by the file of the allocating function. */
export interface Allocation {
    messages: number;
    /** Bytes allocated by the code of this port (`src/`), per message. */
    portBytesPerMessage: number;
    /** Bytes allocated by node itself (`node:` modules: the dgram receive buffers, timers), per message. */
    nodeBytesPerMessage: number;
    /** Bytes allocated by this harness (`bench/`), per message: the promise and the `setImmediate` of each turn. */
    harnessBytesPerMessage: number;
    /** Everything else (native frames, the garbage collector's own), per message. */
    otherBytesPerMessage: number;
    /** Minor collections ("scavenges") during the run, per 1000 messages. */
    scavengesPer1000: number;
    /** The five functions of `src/` that allocated most, with their bytes per message. */
    portSites: { site: string; bytesPerMessage: number }[];
}

interface ProfileNode {
    callFrame: { url: string; functionName: string; lineNumber: number };
    selfSize: number;
    children: ProfileNode[];
}

/**
 * Runs `run` (which moves `messages` messages) under the sampling heap profiler, with the objects that were collected
 * counted, and under a `gc` observer. The profiler takes a sample every 256 bytes on average and scales the sizes, so the
 * figures are estimates (the bytes of an allocation site that allocates per message add up over many messages).
 */
export async function measureAllocation(run: () => Promise<number>): Promise<Allocation> {
    const session = new inspector.Session();
    session.connect();
    let scavenges = 0;
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            // detail.kind 1 is a minor collection (constants.NODE_PERFORMANCE_GC_MINOR)
            if (1 === (entry as unknown as { detail?: { kind: number } }).detail?.kind) {
                scavenges++;
            }
        }
    });
    observer.observe({ entryTypes: ['gc'] });
    try {
        await session.post('HeapProfiler.enable');
        await session.post('HeapProfiler.startSampling', {
            samplingInterval: 256,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        } as never);
        const messages = await run();
        const { profile } = await session.post('HeapProfiler.stopSampling');
        await turn();
        await turn();
        const sites = new Map<string, number>();
        const totals = { port: 0, node: 0, harness: 0, other: 0 };
        const walk = (n: ProfileNode): void => {
            const url = n.callFrame.url;
            if (n.selfSize > 0 && url.includes('/src/')) {
                const site = url.replace(/^.*\/src\//, 'src/') + ' ' + n.callFrame.functionName;
                sites.set(site, (sites.get(site) ?? 0) + n.selfSize);
            }
            if (url.includes('/src/')) {
                totals.port += n.selfSize;
            } else if (url.startsWith('node:')) {
                totals.node += n.selfSize;
            } else if (url.includes('/bench/')) {
                totals.harness += n.selfSize;
            } else {
                totals.other += n.selfSize;
            }
            n.children.forEach(walk);
        };
        walk(profile.head as unknown as ProfileNode);
        return {
            messages,
            portBytesPerMessage: totals.port / messages,
            nodeBytesPerMessage: totals.node / messages,
            harnessBytesPerMessage: totals.harness / messages,
            otherBytesPerMessage: totals.other / messages,
            scavengesPer1000: (scavenges * 1000) / messages,
            portSites: [...sites]
                .sort((x, y) => y[1] - x[1])
                .slice(0, 8)
                .map(([site, bytes]) => ({ site, bytesPerMessage: bytes / messages })),
        };
    } finally {
        observer.disconnect();
        session.disconnect();
    }
}
