// Shared by the phase 3 interop tests (T13, spec 8.3, D116): the constants of the rows, the two directions of a stream
// between the TS transport and the Aeron C 1.53.3 media driver, and the checks that what was produced equals what was
// consumed (same messages, in order, no loss, no duplicate).
//
// - `ToReceivers`: a TS publication (multicast, dynamic MDC or manual MDC) and N C subscribers, each in a C driver of
//   its own, so that every one is a receiver with an id of its own.
// - `FromPublisher`: a C publication (multicast, dynamic MDC, manual MDC with one destination, or manual MDC with two
//   destinations) and a TS subscription (a plain one, or a multi-destination subscription), with optional loss: the
//   C driver's interceptor (what the C driver receives) and a `LossyRelay` for each destination (what the TS side
//   receives).
import { expect } from 'vitest';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import type { Image } from '../../src/client/Image.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import type { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { Consumed, Producer, SystemNode, plan, sequences } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';
import { InteropEnv, LossyRelay, driveUntil, multicastChannel } from './InteropRig.js';
import type { ChildHandle, SubscriberSummary } from './InteropRig.js';

export const STREAM_ID = 1001;
export const TERM_LENGTH = 65536;
export const MTU = 1408;
export const HEADER_LENGTH = 32;
export const MAX_MESSAGE = TERM_LENGTH / 8;
export const LONG_CAP_MS = 90_000;
export const QUIET_MS = 300;
export const INT32_MAX = 2147483647;

/** The message sizes of spec 8.3: 1 B, MTU - 32, MTU - 31, 2 x MTU, term length / 8 (the maximum message). */
export const SIZES = [1, MTU - HEADER_LENGTH, MTU - HEADER_LENGTH + 1, 2 * MTU, MAX_MESSAGE];
/** Sizes without the 1 byte message, which holds the low byte of its sequence only. */
export const MIXED = [100, 1400, 3000];

/** `1 << type` of the frames the C driver's loss interceptor drops on receipt: data and setup; status message and NAK. */
export const DATA_AND_SETUP = (1 << 0x01) | (1 << 0x05);
export const SM_AND_NAK = (1 << 0x03) | (1 << 0x02);

export const TERM_PARAMS = 'term-length=' + TERM_LENGTH;

/** A stream whose term id wraps to a negative value: more than eight terms from `INT32_MAX - back`. */
export function wrappingTermParams(back: number): string {
    return `term-length=${TERM_LENGTH}|init-term-id=${INT32_MAX - back}|term-id=${INT32_MAX - back}|term-offset=0`;
}

export function counter(driver: MediaDriver, descriptor: SystemCounterDescriptor): number {
    return (driver.context().systemCounters() as SystemCounters).get(descriptor).get();
}

export function expectNoErrors(...of: SystemNode[]): void {
    for (const node of of) {
        expect(node.errors.map(String)).toEqual([]);
    }
}

/** Offers `count` messages from `first` whose lengths cycle through `sizes`, until all are accepted. */
export async function produce(
    publication: ConcurrentPublication,
    sizes: readonly number[],
    first: number,
    count: number,
): Promise<Producer> {
    const producer = new Producer(
        publication,
        plan(first, count, (sequence) => sizes[sequence % sizes.length] as number),
        Math.max(...sizes),
    );
    await driveUntil(
        () => {
            producer.offerSome();
            return producer.isDone();
        },
        'the offers of ' + count + ' messages from ' + first + ' (sent ' + producer.sent() + ')',
        LONG_CAP_MS,
    );
    return producer;
}

/** The C subscriber read exactly the sequences `first` .. `first + count - 1` of one session, with no error. */
export function expectConsumedByC(summary: SubscriberSummary, sessionId: number, first: number, count: number): void {
    expect(summary.firstError).toBe('');
    expect(summary.errors).toBe(0);
    expect(summary.sessions).toEqual([{ sessionId, first, last: first + count - 1, count }]);
    expect(summary.count).toBe(count);
}

/** Polls until the consumer has read `count` messages, then for a quiet time more (to find extra messages). */
export async function consume(subscription: Subscription, consumed: Consumed, count: number): Promise<void> {
    await driveUntil(
        () => {
            consumed.poll(subscription);
            expect(consumed.problems).toEqual([]);
            return consumed.sequences.length >= count;
        },
        'all ' + count + ' messages (read ' + consumed.sequences.length + ')',
        LONG_CAP_MS,
    );
    const until = performance.now() + QUIET_MS;
    await driveUntil(() => {
        consumed.poll(subscription);
        return performance.now() >= until;
    }, 'the quiet time');
}

/** What was produced equals what was consumed: the same messages, same lengths, in order, no duplicate. */
export function expectConsumed(
    consumed: Consumed,
    sizes: readonly number[],
    first: number,
    count: number,
    sessionId: number,
): void {
    // a message of 1 byte holds the low byte of its sequence only
    const modulo = sizes.includes(1) ? 256 : 0;
    expect(consumed.problems).toEqual([]);
    const wanted = sequences(first, count);
    expect(consumed.sequences).toEqual(modulo > 0 ? wanted.map((s) => s % modulo) : wanted);
    expect(consumed.lengths).toEqual(wanted.map((s) => sizes[s % sizes.length] as number));
    expect(new Set(consumed.sessionIds)).toEqual(new Set([sessionId]));
}

/** A consumer for messages of these sizes. */
export function consumerFor(sizes: readonly number[]): Consumed {
    return new Consumed(sizes.includes(1) ? 256 : 0);
}

/** Turns of the event loop until the driver has answered the asynchronous command `correlationId` of the node. */
export async function awaitCommand(node: SystemNode, correlationId: number, what: string): Promise<void> {
    await driveUntil(() => !node.aeron.isCommandActive(correlationId), what, 20_000);
}

// ---------------------------------------------------------------------------------------------------------------------
// TS publication to C subscribers
// ---------------------------------------------------------------------------------------------------------------------

export type PublicationKind = 'mdcDynamic' | 'mdcManual' | 'multicast';

export interface Receiver {
    readonly dir: string;
    readonly channel: string;
    readonly sub: ChildHandle;
}

export interface ToReceiversStream {
    readonly node: SystemNode;
    readonly publication: ConcurrentPublication;
    readonly channel: string;
    readonly receivers: Receiver[];
    readonly destinations: string[];
}

export interface ToReceiversOptions {
    readonly sizes: readonly number[];
    readonly count: number;
    /** the last sequence a receiver waits for (default: `count - 1`) */
    readonly last?: number;
    /** term parameters of the publication channel */
    readonly params?: string;
    readonly receivers?: number;
    /** the C loss interceptor of each receiver's driver */
    readonly loss?: ReadonlyArray<{ rate: number; seed: number; mask: number } | undefined>;
    /** extra arguments for every C subscriber */
    readonly receiverArgs?: readonly string[];
    readonly configure?: (context: MediaDriver.Context) => void;
}

/** What the TS publication and the C subscriber channels are, for a kind of channel and N receivers. */
function publicationChannels(
    kind: PublicationKind,
    receivers: number,
): { publication: string; destinations: string[]; receiver: (i: number) => string } {
    const fc = 'fc=min,g:/' + receivers;
    switch (kind) {
        case 'mdcDynamic': {
            const control = 'control=127.0.0.1:' + freeUdpPort();
            return {
                publication: 'aeron:udp?' + control + '|control-mode=dynamic|' + fc,
                destinations: [],
                receiver: () => 'aeron:udp?' + control + '|group=true',
            };
        }
        case 'mdcManual': {
            const endpoints = Array.from({ length: receivers }, () => 'aeron:udp?endpoint=127.0.0.1:' + freeUdpPort());
            return {
                publication: 'aeron:udp?control-mode=manual|' + fc,
                destinations: endpoints,
                receiver: (i) => (endpoints[i] as string) + '|group=true',
            };
        }
        case 'multicast': {
            const port = freeUdpPort();
            return {
                publication: multicastChannel(port, fc),
                destinations: [],
                receiver: () => multicastChannel(port),
            };
        }
    }
}

export class ToReceivers {
    private readonly env: InteropEnv;
    private readonly nodes: SystemNode[];
    public constructor(env: InteropEnv, nodes: SystemNode[]) {
        this.env = env;
        this.nodes = nodes;
    }

    /** The C subscribers first (each in a C driver of its own), then the TS publication, then its destinations. */
    public async open(kind: PublicationKind, options: ToReceiversOptions): Promise<ToReceiversStream> {
        const count = options.receivers ?? 2;
        const channels = publicationChannels(kind, count);
        const last = options.last ?? options.count - 1;
        const receivers: Receiver[] = [];
        for (let i = 0; i < count; i++) {
            const dir = await this.env.startDriver({ loss: options.loss?.[i] });
            const channel = channels.receiver(i);
            const sub = await this.env.startSubscriber(dir, channel, [
                '-s',
                String(STREAM_ID),
                '-l',
                String(last),
                '-S',
                options.sizes.join(','),
                '-t',
                String(LONG_CAP_MS),
                ...(options.receiverArgs ?? []),
            ]);
            receivers.push({ dir, channel, sub });
        }

        const node = new SystemNode(options.configure);
        this.nodes.push(node);
        const channel = channels.publication + '|' + (options.params ?? TERM_PARAMS);
        const publication = node.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
        for (const destination of channels.destinations) {
            await awaitCommand(node, publication.asyncAddDestination(destination), 'the destination ' + destination);
        }

        return { node, publication, channel, receivers, destinations: channels.destinations };
    }

    /** A new C subscriber on the channel of receiver `i` (a receiver that has left, and comes back). */
    public async rejoin(
        stream: ToReceiversStream,
        i: number,
        options: Pick<ToReceiversOptions, 'sizes' | 'receiverArgs'> & { last: number },
    ): Promise<ChildHandle> {
        const receiver = stream.receivers[i] as Receiver;
        return this.env.startSubscriber(receiver.dir, receiver.channel, [
            '-s',
            String(STREAM_ID),
            '-l',
            String(options.last),
            '-S',
            options.sizes.join(','),
            '-t',
            String(LONG_CAP_MS),
            ...(options.receiverArgs ?? []),
        ]);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// C publication to a TS subscription
// ---------------------------------------------------------------------------------------------------------------------

export type SubscriptionKind = 'mdcDynamic' | 'mdcManual' | 'multicast' | 'mds';

export class TsSubscriber {
    public readonly node: SystemNode;
    public readonly available: number[] = [];
    public readonly ended: Array<{ sessionId: number; endOfStream: boolean }> = [];

    public constructor(node: SystemNode) {
        this.node = node;
    }

    public subscribe(channel: string): Subscription {
        return this.node.aeron.addSubscription(
            channel,
            STREAM_ID,
            { onAvailableImage: (image: Image) => void this.available.push(image.sessionId()) },
            {
                onUnavailableImage: (image: Image) =>
                    void this.ended.push({ sessionId: image.sessionId(), endOfStream: image.isEndOfStream() }),
            },
        );
    }
}

export interface FromPublisherOptions {
    /** the destinations of an `mds` subscription (default 2); `mdcManual` has one */
    readonly destinations?: number;
    /** the C loss interceptor of the C publisher's driver (what it receives: status messages and NAKs) */
    readonly cLoss?: { rate: number; seed: number; mask: number };
    /** a relay that drops data on its way to each TS destination (`dynamic`: one relay), with its rate and seed */
    readonly relays?: ReadonlyArray<{ rate: number; seed: number }>;
    readonly configure?: (context: MediaDriver.Context) => void;
}

export interface FromPublisherStream {
    readonly side: TsSubscriber;
    readonly subscription: Subscription;
    readonly cDir: string;
    readonly publisherChannel: string;
    /** the `-D` arguments of the C publisher */
    readonly publisherDestinations: string[];
    readonly relays: LossyRelay[];
}

export class FromPublisher {
    private readonly env: InteropEnv;
    private readonly nodes: SystemNode[];
    public constructor(env: InteropEnv, nodes: SystemNode[]) {
        this.env = env;
        this.nodes = nodes;
    }

    /** A TS subscription, a C driver, and, when `relays` are given, a lossy relay on each destination. */
    public async open(
        kind: SubscriptionKind,
        params: string,
        options: FromPublisherOptions = {},
    ): Promise<FromPublisherStream> {
        const cDir = await this.env.startDriver({ loss: options.cLoss });
        const node = new SystemNode(options.configure);
        this.nodes.push(node);
        const side = new TsSubscriber(node);
        const relays: LossyRelay[] = [];

        const relayed = async (index: number, targetPort: number, dropOn: 'forward' | 'return'): Promise<number> => {
            const relay = options.relays?.[index];
            if (relay === undefined) {
                return targetPort;
            }
            const front = freeUdpPort();
            const opened = await LossyRelay.open(front, targetPort, relay.rate, relay.seed, dropOn);
            relays.push(opened);
            this.env.onDispose(() => opened.close());
            return front;
        };

        let subscription: Subscription;
        let publisherChannel: string;
        const publisherDestinations: string[] = [];
        switch (kind) {
            case 'mdcDynamic': {
                const control = freeUdpPort();
                // the TS subscription sends its status messages to its `control` address; with a relay that is the relay
                const seen = await relayed(0, control, 'return');
                subscription = side.subscribe('aeron:udp?control=127.0.0.1:' + seen + '|group=true');
                publisherChannel = 'aeron:udp?control=127.0.0.1:' + control + '|control-mode=dynamic|fc=min|' + params;
                break;
            }
            case 'mdcManual': {
                const endpoint = freeUdpPort();
                subscription = side.subscribe('aeron:udp?endpoint=127.0.0.1:' + endpoint);
                publisherChannel = 'aeron:udp?control-mode=manual|fc=min|' + params;
                publisherDestinations.push('aeron:udp?endpoint=127.0.0.1:' + (await relayed(0, endpoint, 'forward')));
                break;
            }
            case 'multicast': {
                const port = freeUdpPort();
                subscription = side.subscribe(multicastChannel(port));
                publisherChannel = multicastChannel(port, params);
                break;
            }
            case 'mds': {
                subscription = side.subscribe('aeron:udp?control-mode=manual');
                publisherChannel = 'aeron:udp?control-mode=manual|fc=min|' + params;
                for (let i = 0; i < (options.destinations ?? 2); i++) {
                    const endpoint = freeUdpPort();
                    await awaitCommand(
                        node,
                        subscription.asyncAddDestination('aeron:udp?endpoint=127.0.0.1:' + endpoint),
                        'the destination ' + endpoint,
                    );
                    publisherDestinations.push(
                        'aeron:udp?endpoint=127.0.0.1:' + (await relayed(i, endpoint, 'forward')),
                    );
                }
                break;
            }
        }

        return { side, subscription, cDir, publisherChannel, publisherDestinations, relays };
    }

    public publish(
        stream: FromPublisherStream,
        sizes: readonly number[],
        count: number,
        first = 0,
        channel = stream.publisherChannel,
    ): ChildHandle {
        return this.env.startPublisher(stream.cDir, channel, [
            '-s',
            String(STREAM_ID),
            '-n',
            String(count),
            '-f',
            String(first),
            '-S',
            sizes.join(','),
            '-t',
            String(LONG_CAP_MS),
            '-w',
            String(LONG_CAP_MS),
            ...stream.publisherDestinations.flatMap((destination) => ['-D', destination]),
        ]);
    }
}
