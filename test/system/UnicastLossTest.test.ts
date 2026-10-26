// System tests of T22 (port-only, spec 8.3, 8.4, D60 to D63, D100): TS <-> TS on real UDP on the loopback with frames lost by
// the debug channel endpoints of `io.aeron.driver.ext`, with fixed gaps (`FixedLossGenerator`, `MultiGapLossGenerator`)
// and with the seeded `RandomLossGenerator`. A lost frame is asked for again (NAK) and sent again, or the sender's setup,
// heartbeat and status message cycle goes on without it. In every case what was produced equals what was consumed.
import { afterEach, describe, expect, it } from 'vitest';
import { FixedLossGenerator } from '../../src/driver/ext/FixedLossGenerator.js';
import type { LossGenerator } from '../../src/driver/ext/LossGenerator.js';
import { MultiGapLossGenerator } from '../../src/driver/ext/MultiGapLossGenerator.js';
import { RandomLossGenerator } from '../../src/driver/ext/RandomLossGenerator.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { Counting, DropFirstFrames, LossyReceiveSupplier, LossySendSupplier } from '../support/LossSuppliers.js';
import { Consumed, SystemNode, driveUntil, lengths, plan, sequences, transfer } from '../support/SystemRig.js';
import type { Plan } from '../support/SystemRig.js';
import { mulberry32 } from '../support/Random.js';
import { freeUdpPort } from '../support/Udp.js';

const STREAM_ID = 1001;
const TERM_LENGTH = 65536;
const INITIAL_TERM_ID = 4000;
const LONG_CAP_MS = 60_000;

function counter(driver: MediaDriver, descriptor: SystemCounterDescriptor): number {
    return (driver.context().systemCounters() as SystemCounters).get(descriptor).get();
}

describe('Unicast loss', () => {
    const nodes: SystemNode[] = [];

    afterEach(() => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
    });

    interface Lossy {
        /** the generator for the data and setup frames that the subscriber's driver receives */
        receiveData?: LossGenerator;
        /** the generator for the status messages and NAKs that the subscriber's driver sends */
        receiveControl?: LossGenerator;
        /** the generator for the frames that the publisher's driver sends */
        sendData?: LossGenerator;
        /** the generator for the status messages and NAKs that the publisher's driver receives */
        sendControl?: LossGenerator;
        window?: string;
        extra?: string;
    }

    /**
     * A publisher and a subscriber whose drivers lose frames as given. The publication has an initial term id, a term id and
     * a term offset of its own, so that a test can name where in the stream the loss is.
     */
    async function lossyStream(lossy: Lossy) {
        const publisher = new SystemNode((ctx) => {
            if (undefined !== lossy.sendData || undefined !== lossy.sendControl) {
                ctx.sendChannelEndpointSupplier(new LossySendSupplier(lossy.sendData!, lossy.sendControl));
            }
        });
        const subscriber = new SystemNode((ctx) => {
            if (undefined !== lossy.receiveData || undefined !== lossy.receiveControl) {
                ctx.receiveChannelEndpointSupplier(new LossyReceiveSupplier(lossy.receiveData!, lossy.receiveControl));
            }
        });
        nodes.push(publisher, subscriber);

        const port = freeUdpPort();
        const subscription = subscriber.aeron.addSubscription(
            'aeron:udp?endpoint=127.0.0.1:' + port + (lossy.window ?? ''),
            STREAM_ID,
        );
        const publication = publisher.aeron.addPublication(
            'aeron:udp?endpoint=127.0.0.1:' +
                port +
                '|term-length=' +
                TERM_LENGTH +
                '|init-term-id=' +
                INITIAL_TERM_ID +
                '|term-id=' +
                INITIAL_TERM_ID +
                '|term-offset=0' +
                (lossy.extra ?? ''),
            STREAM_ID,
        ) as ConcurrentPublication;
        await driveUntil(
            () => publication.isConnected() && subscription.imageCount() === 1,
            'connected stream',
            LONG_CAP_MS,
        );

        return { publisher, subscriber, publication, subscription };
    }

    async function carry(lossy: Lossy, work: Plan, maxLength: number) {
        const stream = await lossyStream(lossy);
        const consumed = new Consumed();
        await transfer(stream.publication, stream.subscription, work, consumed, maxLength, 'all messages', LONG_CAP_MS);

        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(work.first, work.count));
        expect(consumed.lengths).toEqual(lengths(work));
        expect(stream.subscription.imageAtIndex(0).position()).toBe(stream.publication.position());
        expect(counter(stream.subscriber.driver, SystemCounterDescriptor.RECEIVE_RING_DROPS)).toBe(0);
        return { ...stream, consumed };
    }

    function expectNoErrors(...of: SystemNode[]): void {
        for (const node of of) {
            expect(node.errors.map(String)).toEqual([]);
        }
    }

    const steady = plan(0, 600, () => 200);

    describe('fixed gaps', () => {
        it.each([
            ['in the middle of a term', INITIAL_TERM_ID, 8192, 4096],
            ['of a single frame', INITIAL_TERM_ID, 16384, 32],
            ['at the end of a term', INITIAL_TERM_ID, TERM_LENGTH - 2048, 2048],
            ['at the start of the next term', INITIAL_TERM_ID + 1, 0, 1024],
            ['across the end of a term and the start of the next', INITIAL_TERM_ID, TERM_LENGTH - 512, 512],
        ])('aGap %s is asked for and sent again', async (_name, termId, termOffset, length) => {
            const generator = new Counting(new FixedLossGenerator(termId, termOffset, length));
            const { publisher, subscriber, publication } = await carry(
                { receiveData: generator },
                plan(0, 1200, () => 200),
                200,
            );

            expect(generator.dropped).toBeGreaterThan(0);
            expect(counter(subscriber.driver, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(0);
            expect(counter(publisher.driver, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBeGreaterThan(0);
            expect(counter(publisher.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
            expect(publication.position()).toBeGreaterThan(TERM_LENGTH);
            expectNoErrors(publisher, subscriber);
        });

        it('manyGapsInOneTermAreAskedForAndSentAgain', async () => {
            const generator = new Counting(new MultiGapLossGenerator(INITIAL_TERM_ID, 4096, 512, 12));
            const { publisher, subscriber } = await carry(
                { receiveData: generator },
                plan(0, 1200, () => 200),
                200,
            );

            expect(generator.dropped).toBeGreaterThan(0);
            expect(counter(publisher.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
            expectNoErrors(publisher, subscriber);
        });

        it('aGapInAFragmentedMessageIsRepairedBeforeTheMessageIsDelivered', async () => {
            const generator = new Counting(new FixedLossGenerator(INITIAL_TERM_ID, 6144, 2048));
            const work = plan(0, 40, () => 6000);
            const { publisher, subscriber } = await carry({ receiveData: generator }, work, 6000);

            expect(generator.dropped).toBeGreaterThan(0);
            expect(counter(publisher.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
            expectNoErrors(publisher, subscriber);
        });

        it('aLostSetupIsSentAgain', async () => {
            const generator = new DropFirstFrames(3);
            const { publisher, subscriber } = await carry({ receiveData: generator }, steady, 200);

            expect(generator.dropped).toBe(3);
            expectNoErrors(publisher, subscriber);
        });

        it('lostStatusMessagesWhileTheWindowIsFullAreMadeUpByTheNextOnes', async () => {
            // a window of 8 KiB is full after 32 messages; half of the status messages that would open it are lost
            const control = new Counting(new RandomLossGenerator(0.5, 99));
            const { publisher, subscriber } = await carry(
                { sendControl: control, window: '|rcv-wnd=8192' },
                plan(0, 400, () => 200),
                200,
            );

            expect(control.dropped).toBeGreaterThan(0);
            expectNoErrors(publisher, subscriber);
        });
    });

    describe('seeded random loss', () => {
        function mixedPlan(seed: number): Plan {
            const random = mulberry32(seed);
            const sizes = Array.from({ length: 1500 }, () => 4 + Math.floor(random() * random() * 3000));
            return plan(0, sizes.length, (sequence) => sizes[sequence] as number);
        }

        it.each([[11], [22], [33]])('tenPercentOfEveryKindOfFrameIsLostWithSeed %s', async (seed) => {
            const sendData = new Counting(new RandomLossGenerator(0.1, seed));
            const receiveData = new Counting(new RandomLossGenerator(0.1, seed + 1000));
            const sendControl = new Counting(new RandomLossGenerator(0.1, seed + 2000));
            const receiveControl = new Counting(new RandomLossGenerator(0.1, seed + 3000));

            const { publisher, subscriber } = await carry(
                { sendData, receiveData, sendControl, receiveControl },
                mixedPlan(seed),
                3000,
            );

            for (const generator of [sendData, receiveData, sendControl, receiveControl]) {
                expect(generator.dropped).toBeGreaterThan(0);
            }
            expect(counter(publisher.driver, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
            expectNoErrors(publisher, subscriber);
        });

        it('aQuarterOfTheDataIsLostAndTheStreamStillCrossesTerms', async () => {
            const receiveData = new Counting(new RandomLossGenerator(0.25, 5));
            const { publisher, subscriber, publication } = await carry(
                { receiveData },
                plan(0, 1500, () => 400),
                400,
            );

            expect(receiveData.dropped).toBeGreaterThan(0);
            expect(publication.position()).toBeGreaterThan(3 * TERM_LENGTH);
            expectNoErrors(publisher, subscriber);
        });
    });
});
