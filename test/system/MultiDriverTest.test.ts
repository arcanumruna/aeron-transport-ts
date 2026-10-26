// Port of aeron-system-tests/src/test/java/io/aeron/MultiDriverTest.java @ 1.53.3 (phase 3, T6, D115).
// The clock is manual (one turn is 1 ms): `Tests.executeUntil(.., 500 ms)` is at most 500 turns.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestNode } from '../support/SystemTests.js';

const MULTICAST_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';

const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const NUM_MESSAGES_PER_TERM = 64;
const MESSAGE_LENGTH = TERM_BUFFER_LENGTH / NUM_MESSAGES_PER_TERM - DataHeaderFlyweight.HEADER_LENGTH;

const MS_500_NS = 500_000_000;

describe('MultiDriverTest', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));

    let fragmentCountA = 0;
    const fragmentHandlerA: FragmentHandler = { onFragment: () => void fragmentCountA++ };
    let fragmentCountB = 0;
    const fragmentHandlerB: FragmentHandler = { onFragment: () => void fragmentCountB++ };

    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;

    function launch(name: string): void {
        tests = systemTests(name, true);
        fragmentCountA = 0;
        fragmentCountB = 0;
        buffer.putInt(0, 1);

        driverA = tests.launch((context) => context.publicationTermBufferLength(TERM_BUFFER_LENGTH));
        driverB = tests.launch((context) => context.publicationTermBufferLength(TERM_BUFFER_LENGTH));
    }

    /** `offer` until it is accepted, as `while (publication.offer(..) < 0L) Tests.yield()`. */
    function offered(publication: Publication): Promise<void> {
        return tests.drainUntil(
            () => publication.offer(buffer, 0, buffer.capacity()) >= 0,
            100_000,
            () => 'a window to offer into',
        );
    }

    /** The `Tests.executeUntil` that polls a subscription until a fragment is read, for at most 500 ms. */
    async function pollOne(subscription: Subscription, handler: FragmentHandler): Promise<void> {
        let fragmentsRead = 0;
        await tests.executeUntil(
            () => fragmentsRead > 0,
            () => {
                fragmentsRead += subscription.poll(handler, 10);
            },
            0x7fffffff,
            MS_500_NS,
        );
    }

    it('shouldSpinUpAndShutdown', async () => {
        launch('shouldSpinUpAndShutdown');

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID);

        await tests.drainUntil(
            () => subscriptionA.isConnected() || subscriptionB.isConnected(),
            10_000,
            () => 'a connected subscription',
        );
        expect(tests.errors()).toEqual([]);
    });

    it('shouldJoinExistingStreamWithLockStepSendingReceiving', async () => {
        const numMessagesToSendPreJoin = NUM_MESSAGES_PER_TERM / 2;
        const numMessagesToSendPostJoin = NUM_MESSAGES_PER_TERM;

        launch('shouldJoinExistingStreamWithLockStepSendingReceiving');

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const publication = driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID)!;

        for (let i = 0; i < numMessagesToSendPreJoin; i++) {
            await offered(publication);
            await pollOne(subscriptionA, fragmentHandlerA);
        }

        let newImage = false;
        const subscriptionB = driverB.aeron.addSubscription(
            MULTICAST_URI,
            STREAM_ID,
            { onAvailableImage: () => void (newImage = true) },
            null,
        );

        await tests.drainUntil(
            () => newImage,
            100_000,
            () => 'a new image of subscription B',
        );

        for (let i = 0; i < numMessagesToSendPostJoin; i++) {
            await offered(publication);
            await pollOne(subscriptionA, fragmentHandlerA);
            await pollOne(subscriptionB, fragmentHandlerB);
        }

        expect(fragmentCountA).toBe(numMessagesToSendPreJoin + numMessagesToSendPostJoin);
        expect(fragmentCountB).toBe(numMessagesToSendPostJoin);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldJoinExistingIdleStreamWithLockStepSendingReceiving', async () => {
        const numMessagesToSendPreJoin = 0;
        const numMessagesToSendPostJoin = NUM_MESSAGES_PER_TERM;

        launch('shouldJoinExistingIdleStreamWithLockStepSendingReceiving');

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const publication = driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID)!;

        await tests.drainUntil(
            () => publication.isConnected() || subscriptionA.isConnected(),
            10_000,
            () => 'a connected publication or subscription',
        );

        let newImage = false;
        const subscriptionB = driverB.aeron.addSubscription(
            MULTICAST_URI,
            STREAM_ID,
            { onAvailableImage: () => void (newImage = true) },
            null,
        );

        await tests.drainUntil(
            () => newImage,
            100_000,
            () => 'a new image of subscription B',
        );

        for (let i = 0; i < numMessagesToSendPostJoin; i++) {
            await offered(publication);
            await pollOne(subscriptionA, fragmentHandlerA);
            await pollOne(subscriptionB, fragmentHandlerB);
        }

        expect(fragmentCountA).toBe(numMessagesToSendPreJoin + numMessagesToSendPostJoin);
        expect(fragmentCountB).toBe(numMessagesToSendPostJoin);
        expect(tests.errors()).toEqual([]);
    });
});
