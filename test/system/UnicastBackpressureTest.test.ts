// Extra system tests (not a Java port): BACKPRESSURE end to end, TS <-> TS on real UDP on the loopback, default
// configuration except for a small term length so that the windows are small. A subscriber that does not poll stops the
// window of the receiver from moving: the sender stops at the flow control limit, the publisher reaches its limit and
// `offer` and `tryClaim` answer BACK_PRESSURED. When the polling goes on, everything is delivered, in order, with no
// duplicate, and the offers go through again. Shared and exclusive publications, a subscriber that is slow (one fragment
// on every other turn), and a stall whose limit falls at the end of a term.
import { afterEach, describe, expect, it } from 'vitest';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { Configuration } from '../../src/driver/Configuration.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { mulberry32 } from '../support/Random.js';
import { Consumed, Producer, SystemNode, driveUntil, lengths, plan, sequences } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';

const STREAM_ID = 1001;
const TERM_LENGTH = 65536;
const FRAME_ALIGNMENT = 32;
const HEADER_LENGTH = 32;
const QUIET_TURNS = 3000;

/** The length of the frame that a message of `length` bytes takes in the log, as the publication aligns it. */
function frameLength(length: number): number {
    return Math.ceil((length + HEADER_LENGTH) / FRAME_ALIGNMENT) * FRAME_ALIGNMENT;
}

const turn = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

describe.each([['shared'], ['exclusive']] as const)('Unicast backpressure with a %s publication', (kind) => {
    const nodes: SystemNode[] = [];

    afterEach(() => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
    });

    interface Stream {
        readonly publisher: SystemNode;
        readonly subscriber: SystemNode;
        readonly publication: Publication;
        readonly subscription: Subscription;
        /** how far the publisher can be ahead of the subscriber: its window plus the window of the receiver */
        readonly maxAhead: number;
    }

    async function open(): Promise<Stream> {
        const publisher = new SystemNode();
        const subscriber = new SystemNode();
        nodes.push(publisher, subscriber);
        const port = freeUdpPort();
        const subscription = subscriber.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
        const channel = 'aeron:udp?endpoint=127.0.0.1:' + port + '|term-length=' + TERM_LENGTH;
        const publication: Publication =
            'shared' === kind
                ? (publisher.aeron.addPublication(channel, STREAM_ID) as Publication)
                : (publisher.aeron.addExclusivePublication(channel, STREAM_ID) as Publication);
        await driveUntil(() => publication.isConnected() && subscription.imageCount() >= 1, 'connected stream');

        const publicationWindow = Configuration.producerWindowLength(
            publication.termBufferLength(),
            (publisher.driver.context() as MediaDriver.Context).publicationTermWindowLength(),
        );
        const receiverWindow = Configuration.receiverWindowLength(
            publication.termBufferLength(),
            (subscriber.driver.context() as MediaDriver.Context).initialWindowLength(),
        );
        return { publisher, subscriber, publication, subscription, maxAhead: publicationWindow + receiverWindow };
    }

    /** Offers (the subscriber does not poll) until the position of the publication has not moved for a quiet time. */
    async function stall(stream: Stream, producer: Producer): Promise<number> {
        let last = -1;
        let still = 0;
        await driveUntil(() => {
            producer.offerSome();
            const position = stream.publication.position();
            still = position === last ? still + 1 : 0;
            last = position;
            return producer.backPressured > 0 && still >= QUIET_TURNS;
        }, 'a stalled publication');
        return last;
    }

    function expectNoErrors(...of: SystemNode[]): void {
        for (const node of of) {
            expect(node.errors.map(String)).toEqual([]);
        }
    }

    it('stalledSubscriberBackPressuresThePublisherAndResumes', async () => {
        const stream = await open();
        const { publication, subscription } = stream;
        const size = 100;
        const work = plan(0, 3000, () => size);
        const producer = new Producer(publication, work, size);

        const stalledAt = await stall(stream, producer);

        // the publisher is at most its window plus the window of the receiver ahead of the subscriber, and it never
        // passed its limit by more than the frame of the message that was accepted at it
        const subscriberPosition = subscription.imageAtIndex(0).position();
        expect(subscriberPosition).toBe(0);
        expect(stalledAt - subscriberPosition).toBeLessThanOrEqual(stream.maxAhead + frameLength(size));
        expect(stalledAt).toBeLessThanOrEqual(publication.positionLimit() + frameLength(size));
        expect(stalledAt).toBeGreaterThan(0);
        expect(producer.sent()).toBeGreaterThan(0);
        expect(producer.sent()).toBeLessThan(work.count);

        // many further turns with offers: the position does not move, and tryClaim is back pressured too
        const claim = new BufferClaim();
        const before = producer.backPressured;
        for (let i = 0; i < 1000; i++) {
            producer.offerSome();
            expect(publication.tryClaim(size, claim)).toBe(Publication.BACK_PRESSURED);
            await turn();
        }
        expect(publication.position()).toBe(stalledAt);
        expect(producer.backPressured).toBeGreaterThan(before);
        expect(subscription.imageAtIndex(0).position()).toBe(0);

        // the polling goes on: every message arrives, the same bytes, in order, no duplicate
        const consumed = new Consumed();
        await driveUntil(
            () => {
                producer.offerSome();
                consumed.poll(subscription);
                return consumed.sequences.length >= work.count;
            },
            'all messages (sent ' + producer.sent() + ' of ' + work.count + ')',
        );
        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(0, work.count));
        expect(consumed.lengths).toEqual(lengths(work));
        expect(producer.backPressured).toBeGreaterThan(0);
        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        expectNoErrors(stream.publisher, stream.subscriber);
    });

    it('slowSubscriberWithFragmentLimitOneReceivesEverything', async () => {
        const stream = await open();
        const { publication, subscription } = stream;
        // 1 byte to well over the MTU (1408): the long messages fragment
        const sizes = [1, 100, 1376, 1377, 2816, 5000];
        const random = mulberry32(7);
        const picked: number[] = [];
        let total = 0;
        while (total < 4 * TERM_LENGTH) {
            const size = sizes[Math.floor(random() * sizes.length)] as number;
            picked.push(size);
            total += frameLength(size);
        }
        const work = plan(0, picked.length, (sequence) => picked[sequence] as number);
        const producer = new Producer(publication, work, Math.max(...sizes));
        const consumed = new Consumed();

        let turns = 0;
        await driveUntil(
            () => {
                producer.offerSome();
                if (turns++ % 2 === 0) {
                    consumed.poll(subscription, 1);
                }
                return consumed.sequences.length >= work.count;
            },
            'all messages (sent ' + producer.sent() + ' of ' + work.count + ')',
        );

        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(0, work.count));
        expect(consumed.lengths).toEqual(lengths(work));
        expect(producer.backPressured).toBeGreaterThan(0);
        expect(publication.position()).toBeGreaterThanOrEqual(4 * TERM_LENGTH);
        expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
        expectNoErrors(stream.publisher, stream.subscriber);
    });

    // 992 bytes: 64 frames of 1024 fill a term exactly; 1000 bytes: 62 frames of 1056, then 64 bytes are left, which
    // are padding; 1030 bytes: frames of 1088, 60 of them, then 256 bytes are left
    it.each([[992], [1000], [1030]])(
        'backPressureAcrossTermRotationLosesNothing with messages of %i bytes',
        async (size) => {
            const stream = await open();
            const { publication, subscription } = stream;
            const work = plan(0, 400, () => size);
            const producer = new Producer(publication, work, size);

            const stalledAt = await stall(stream, producer);

            // the limit falls near the end of the first term (the window of the publisher and the window of the receiver
            // are half a term each); the message that does not fit is not accepted, the one at the limit may be
            expect(stream.maxAhead).toBe(TERM_LENGTH);
            expect(Math.abs(publication.positionLimit() - TERM_LENGTH)).toBeLessThanOrEqual(frameLength(size));
            expect(Math.abs(stalledAt - TERM_LENGTH)).toBeLessThanOrEqual(frameLength(size));
            expect(stalledAt).toBeLessThanOrEqual(publication.positionLimit() + frameLength(size));

            const consumed = new Consumed();
            await driveUntil(
                () => {
                    producer.offerSome();
                    consumed.poll(subscription);
                    return consumed.sequences.length >= work.count;
                },
                'all messages (sent ' + producer.sent() + ' of ' + work.count + ')',
            );
            expect(consumed.problems).toEqual([]);
            expect(consumed.sequences).toEqual(sequences(0, work.count));
            expect(consumed.lengths).toEqual(lengths(work));
            expect(producer.backPressured).toBeGreaterThan(0);
            expect(publication.position()).toBeGreaterThan(3 * TERM_LENGTH);
            expectNoErrors(stream.publisher, stream.subscriber);
        },
    );
});
