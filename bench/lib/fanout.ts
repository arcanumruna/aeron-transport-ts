// The fan-out end-to-end harness of phase 3 T14 (D121), in the style of bench/lib/e2e.ts: real `MediaDriver`s and `Aeron`
// clients of one process on the real loopback, default configuration, the application waking the sending driver after an
// offer (D101). A scenario is one publisher node (A) and one or more subscriber nodes (B, C, ...), each with a driver of its
// own, so that every subscriber is a receiver of its own with its own receiver id for the flow control:
//
//   unicast        1 publication, 1 subscription (the reference: the same one-way measurement as the rest)
//   multicast N    1 publication on group 224.20.30.39 (interface=localhost), N subscriber nodes on the group
//   mdc-dynamic N  1 publication `control-mode=dynamic`, N subscriber nodes that join with `control=`
//   mdc-manual N   1 publication `control-mode=manual` with N destinations added with `addDestination`, N subscriber nodes
//   mds 2          1 subscription `control-mode=manual` with 2 destinations, 2 publications on node A (one for each
//                  destination, same stream), the offers alternating between them
//
// Every multicast and MDC publication has `fc=min,g:/N` (the interop rows of D116 use the same), so that the stream starts
// when all N receivers are counted and the slowest receiver paces it. A latency sample is the time from `offer` to the
// moment the LAST subscriber has read that message (one way, one process, one clock); a throughput window is the time
// between the moments the slowest subscriber has read the first and the last message of 100.
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { Node, freePort, message, turn, until } from './e2e.js';
import { MAX_TURNS, TurnCap } from './turnCap.js';

const STREAM_ID = 1003;
const TERM_LENGTH = 1 << 20;
export const MULTICAST_GROUP = '224.20.30.39';

export type FanoutKind = 'unicast' | 'multicast' | 'mdc-dynamic' | 'mdc-manual' | 'mds';

export interface FanoutScenario {
    kind: FanoutKind;
    /** Receivers (subscriber nodes) for the kinds that have them; destinations of the subscription for `mds`. */
    count: number;
    /** The name in the reports. */
    name: string;
}

export const FANOUT_SCENARIOS: readonly FanoutScenario[] = [
    { kind: 'unicast', count: 1, name: 'unicast, 1 subscription (reference)' },
    { kind: 'multicast', count: 1, name: 'multicast, 1 subscription' },
    { kind: 'multicast', count: 3, name: 'multicast, 3 subscriptions' },
    { kind: 'mdc-dynamic', count: 2, name: 'MDC dynamic, 2 destinations' },
    { kind: 'mdc-dynamic', count: 4, name: 'MDC dynamic, 4 destinations' },
    { kind: 'mdc-manual', count: 2, name: 'MDC manual, 2 destinations' },
    { kind: 'mdc-manual', count: 4, name: 'MDC manual, 4 destinations' },
    { kind: 'mds', count: 2, name: 'MDS, 2 destinations' },
];

export class Fanout {
    public readonly a = new Node();
    public readonly subscribers: Node[] = [];
    public readonly publications: Publication[] = [];
    public readonly subscriptions: Subscription[] = [];
    /** Messages read, per subscription. */
    public readonly received: number[] = [];
    public wake = true;
    private nextPublication = 0;
    private readonly handlers: FragmentHandler[] = [];

    public readonly scenario: FanoutScenario;
    private constructor(scenario: FanoutScenario) {
        this.scenario = scenario;
    }

    public static async create(scenario: FanoutScenario): Promise<Fanout> {
        const f = new Fanout(scenario);
        try {
            await f.connect();
        } catch (e) {
            f.close();
            throw e;
        }
        return f;
    }

    private newSubscription(node: Node, channel: string): Subscription {
        const index = this.subscriptions.length;
        this.received.push(0);
        this.handlers.push({
            onFragment: (): void => {
                this.received[index] = (this.received[index] as number) + 1;
            },
        });
        const subscription = node.aeron.addSubscription(channel, STREAM_ID);
        this.subscriptions.push(subscription);
        return subscription;
    }

    private async connect(): Promise<void> {
        const { kind, count } = this.scenario;
        const fc = '|fc=min,g:/' + count + '|term-length=' + TERM_LENGTH;
        switch (kind) {
            case 'unicast': {
                const port = await freePort();
                this.subscribers.push(new Node());
                this.newSubscription(this.subscribers[0] as Node, 'aeron:udp?endpoint=127.0.0.1:' + port);
                this.publications.push(
                    this.a.aeron.addPublication(
                        'aeron:udp?endpoint=127.0.0.1:' + port + '|term-length=' + TERM_LENGTH,
                        STREAM_ID,
                    ) as Publication,
                );
                break;
            }
            case 'multicast': {
                const port = await freePort();
                const endpoint = 'endpoint=' + MULTICAST_GROUP + ':' + port + '|interface=localhost';
                for (let i = 0; i < count; i++) {
                    this.subscribers.push(new Node());
                    this.newSubscription(this.subscribers[i] as Node, 'aeron:udp?' + endpoint);
                }
                this.publications.push(
                    this.a.aeron.addPublication('aeron:udp?' + endpoint + fc, STREAM_ID) as Publication,
                );
                break;
            }
            case 'mdc-dynamic': {
                const port = await freePort();
                for (let i = 0; i < count; i++) {
                    this.subscribers.push(new Node());
                    this.newSubscription(
                        this.subscribers[i] as Node,
                        'aeron:udp?control=127.0.0.1:' + port + '|group=true',
                    );
                }
                this.publications.push(
                    this.a.aeron.addPublication(
                        'aeron:udp?control=127.0.0.1:' + port + '|control-mode=dynamic' + fc,
                        STREAM_ID,
                    ) as Publication,
                );
                break;
            }
            case 'mdc-manual': {
                const publication = this.a.aeron.addPublication(
                    'aeron:udp?control-mode=manual' + fc,
                    STREAM_ID,
                ) as Publication;
                this.publications.push(publication);
                for (let i = 0; i < count; i++) {
                    const endpoint = 'aeron:udp?endpoint=127.0.0.1:' + (await freePort());
                    this.subscribers.push(new Node());
                    this.newSubscription(this.subscribers[i] as Node, endpoint + '|group=true');
                    publication.addDestination(endpoint);
                }
                break;
            }
            case 'mds': {
                this.subscribers.push(new Node());
                const subscription = this.newSubscription(this.subscribers[0] as Node, 'aeron:udp?control-mode=manual');
                for (let i = 0; i < count; i++) {
                    const endpoint = 'aeron:udp?endpoint=127.0.0.1:' + (await freePort());
                    subscription.addDestination(endpoint);
                    this.publications.push(
                        this.a.aeron.addPublication(endpoint + '|term-length=' + TERM_LENGTH, STREAM_ID) as Publication,
                    );
                }
                break;
            }
        }
        const images = 'mds' === kind ? count : 1;
        await until(
            () =>
                this.publications.every((p) => p.isConnected()) &&
                this.subscriptions.every((s) => s.imageCount() >= images),
            'connected ' + this.scenario.name,
        );
    }

    /** One try to offer, the publications taking turns; the result of `Publication.offer`. Wakes the sending driver. */
    public tryOffer(buffer: UnsafeBuffer, length: number): number {
        const publication = this.publications[this.nextPublication] as Publication;
        const result = publication.offer(buffer, 0, length);
        if (result > 0) {
            this.nextPublication = this.nextPublication + 1 === this.publications.length ? 0 : this.nextPublication + 1;
            if (this.wake) {
                this.a.driver.wake();
            }
        }
        return result;
    }

    /** Polls every subscription once. */
    public poll(limit = 64): number {
        let work = 0;
        for (let i = 0; i < this.subscriptions.length; i++) {
            work += (this.subscriptions[i] as Subscription).poll(this.handlers[i] as FragmentHandler, limit);
        }
        return work;
    }

    /** Messages read by the slowest subscription. */
    public minReceived(): number {
        let min = this.received[0] as number;
        for (let i = 1; i < this.received.length; i++) {
            min = Math.min(min, this.received[i] as number);
        }
        return min;
    }

    public errors(): Error[] {
        return [...this.a.errors, ...this.subscribers.flatMap((n) => n.errors)];
    }

    public close(): void {
        for (const s of this.subscribers) {
            s.close();
        }
        this.a.close();
    }
}

/** `out.length` messages of `size` bytes, one at a time: ns from `offer` until every subscriber has read it. */
export async function fanoutLatency(f: Fanout, size: number, out: Float64Array, maxTurns = MAX_TURNS): Promise<void> {
    const buffer = message(size);
    for (let i = 0; i < out.length; i++) {
        const t0 = performance.now();
        const target = f.minReceived() + 1;
        let attempts = 0;
        for (;;) {
            const result = f.tryOffer(buffer, size);
            if (result > 0) {
                break;
            }
            if (Publication.NOT_CONNECTED === result || ++attempts > 1_000_000) {
                throw new Error('the offer answered ' + result);
            }
            await turn();
            f.poll(64);
        }
        const cap = new TurnCap(f.scenario.name, () => 'received ' + f.minReceived() + '/' + target, maxTurns);
        while (f.minReceived() < target) {
            cap.tick();
            await turn();
            f.poll(1);
        }
        out[i] = (performance.now() - t0) * 1e6;
    }
}

/** A one-way stream as `oneWay` of e2e.ts: `out[k]` is the ns per message of window k, at the slowest subscriber. */
export async function fanoutStream(
    f: Fanout,
    size: number,
    window: number,
    out: Float64Array,
    maxTurns = MAX_TURNS,
): Promise<{ messages: number; bytes: number }> {
    const buffer = message(size);
    const start = f.minReceived();
    const total = window * out.length;
    let sent = 0;
    let mark = 0;
    let t0 = performance.now();
    const cap = new TurnCap(
        f.scenario.name + ' stream',
        () => 'received ' + (f.minReceived() - start) + '/' + total + ', sent ' + sent,
        maxTurns,
    );
    while (mark < out.length) {
        cap.tick();
        for (let i = 0; i < 32 && sent < total; i++) {
            const result = f.tryOffer(buffer, size);
            if (result > 0) {
                sent++;
            } else if (Publication.NOT_CONNECTED === result) {
                throw new Error('the stream is not connected');
            } else {
                break;
            }
        }
        if (f.wake) {
            f.a.driver.wake();
        }
        await turn();
        f.poll(64);
        const read = f.minReceived() - start;
        while (mark < out.length && read >= (mark + 1) * window) {
            const t = performance.now();
            out[mark++] = ((t - t0) * 1e6) / window;
            t0 = t;
        }
    }
    const messages = f.minReceived() - start;
    return { messages, bytes: messages * size };
}
