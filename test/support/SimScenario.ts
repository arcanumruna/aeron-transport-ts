// Pieces of the scenarios of the deterministic simulation (T22, spec 8.2): the fault model of a seed, the channels, and the
// stream between a publisher node and a subscriber node, driven by `SimWorld.run`. Every number a scenario uses comes from
// its seed through `mulberry32`, so a failing seed is a repro.
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { Plan } from './SystemRig.js';
import { Consumed, Producer } from './SystemRig.js';
import { mulberry32 } from './Random.js';
import type { FaultModel, NetworkStats } from './SimNetwork.js';
import { MAX_STEPS } from './SimWorld.js';
import type { SimNode, SimWorld } from './SimWorld.js';

export const STREAM_ID = 1001;
export const PORT = 40_000;
export const TERM_LENGTH = 65_536;

/** The seeds of a scenario. */
export const SEEDS = 200;

export function seedsOf(count = SEEDS): number[] {
    return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * The faults of a seed: every seed has some of each, from none to a bad network, so that the 200 seeds of a scenario cover a
 * clean network, a lossy one, a reordering one, one that duplicates and one that does all of it.
 */
export function faultModelOf(seed: number, severity = 1): FaultModel {
    const random = mulberry32(seed * 7919 + 13);
    const pick = (max: number): number => (random() < 0.25 ? 0 : random() * max * severity);
    return {
        lossRate: pick(0.15),
        burstRate: random() < 0.3 ? 0.4 : 0,
        burstLength: 1 + Math.floor(random() * 4),
        duplicateRate: pick(0.1),
        reorderRate: pick(0.3),
        reorderDelayNs: Math.floor(random() * 8_000_000),
        delayNs: Math.floor(random() * 3_000_000),
        jitterNs: Math.floor(random() * 2_000_000),
        sendBlockRate: pick(0.05),
        sendBlockNs: Math.floor(random() * 3_000_000),
    };
}

export function subscriptionChannel(port = PORT): string {
    return 'aeron:udp?endpoint=127.0.0.1:' + port;
}

export interface PublicationOptions {
    readonly port?: number;
    readonly termLength?: number;
    readonly sessionId?: number;
    readonly initialTermId?: number;
    readonly termId?: number;
    readonly termOffset?: number;
    readonly extra?: string;
}

export function publicationChannel(options: PublicationOptions = {}): string {
    let channel =
        'aeron:udp?endpoint=127.0.0.1:' +
        (options.port ?? PORT) +
        '|term-length=' +
        (options.termLength ?? TERM_LENGTH);
    if (undefined !== options.sessionId) {
        channel += '|session-id=' + options.sessionId;
    }
    if (undefined !== options.initialTermId) {
        channel +=
            '|init-term-id=' +
            options.initialTermId +
            '|term-id=' +
            (options.termId ?? options.initialTermId) +
            '|term-offset=' +
            (options.termOffset ?? 0);
    }
    return channel + (options.extra ?? '');
}

/** Add a publication and a subscription with the async calls, in the order given, and step until both exist. */
export function addStream(
    world: SimWorld,
    publisher: SimNode,
    subscriber: SimNode,
    publicationFirst: boolean,
    options: PublicationOptions = {},
    subscriptionExtra = '',
): { publication: ConcurrentPublication; subscription: Subscription } {
    const addPublication = (): number => publisher.aeron.asyncAddPublication(publicationChannel(options), STREAM_ID);
    const addSubscription = (): number =>
        subscriber.aeron.asyncAddSubscription(subscriptionChannel(options.port) + subscriptionExtra, STREAM_ID);

    let publicationId: number;
    let subscriptionId: number;
    if (publicationFirst) {
        publicationId = addPublication();
        subscriptionId = addSubscription();
    } else {
        subscriptionId = addSubscription();
        publicationId = addPublication();
    }

    world.run(
        () =>
            null !== publisher.aeron.getPublication(publicationId) &&
            null !== subscriber.aeron.getSubscription(subscriptionId),
        'both resources',
    );

    return {
        publication: publisher.aeron.getPublication(publicationId) as ConcurrentPublication,
        subscription: subscriber.aeron.getSubscription(subscriptionId) as Subscription,
    };
}

/** Step until the publication has a receiver and the subscription an image. */
export function awaitConnected(
    world: SimWorld,
    publication: ConcurrentPublication,
    subscription: Subscription,
    images = 1,
): void {
    world.run(() => publication.isConnected() && subscription.imageCount() >= images, 'connected stream');
}

/** Produce the plan into the publication and consume it from the subscription, stepping, until all of it was read. */
export function carry(
    world: SimWorld,
    publication: ConcurrentPublication,
    subscription: Subscription,
    work: Plan,
    maxLength: number,
    consumed: Consumed = new Consumed(),
    maxSteps = MAX_STEPS,
): { producer: Producer; consumed: Consumed } {
    const producer = new Producer(publication, work, maxLength);
    world.run(
        () => {
            producer.offerSome(16);
            consumed.poll(subscription);
            return consumed.sequences.length >= work.count;
        },
        'all ' + work.count + ' messages (sent ' + producer.sent() + ', read ' + consumed.sequences.length + ')',
        maxSteps,
        () => producer.sent() + consumed.sequences.length,
    );
    return { producer, consumed };
}

/** The lengths of a seed's messages: a mix of one frame, a few and many fragments, with the maximum now and then. */
export function mixedLengths(seed: number, count: number, maxLength: number): number[] {
    const random = mulberry32(seed * 104729 + 7);
    return Array.from({ length: count }, () => {
        const kind = random();
        if (kind < 0.5) {
            return 4 + Math.floor(random() * 200);
        }
        if (kind < 0.85) {
            return 4 + Math.floor(random() * 3000);
        }
        if (kind < 0.97) {
            return 4 + Math.floor(random() * (maxLength - 3));
        }
        return maxLength;
    });
}

/** Adds the stats of one run to the total of a scenario. */
export function addStats(total: NetworkStats, run: NetworkStats): void {
    for (const key of Object.keys(total) as (keyof NetworkStats)[]) {
        if ('maxInFlight' === key) {
            total[key] = Math.max(total[key], run[key]);
        } else {
            total[key] += run[key];
        }
    }
}

export function emptyStats(): NetworkStats {
    return {
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
}
