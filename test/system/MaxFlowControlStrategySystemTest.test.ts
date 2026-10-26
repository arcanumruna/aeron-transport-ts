// Port of aeron-system-tests/src/test/java/io/aeron/MaxFlowControlStrategySystemTest.java @ 1.53.3 (phase 3, T6, D115).
// The clock is manual (one turn is 1 ms), so the image liveness timeout of 500 ms and the 500 ms limits of
// `Tests.executeUntil` take 500 turns and no wall time.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { MaxMulticastFlowControlSupplier } from '../../src/driver/MaxMulticastFlowControlSupplier.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestNode } from '../support/SystemTests.js';

const MULTICAST_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';
const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const NUM_MESSAGES_PER_TERM = 64;
const MESSAGE_LENGTH = TERM_BUFFER_LENGTH / NUM_MESSAGES_PER_TERM - DataHeaderFlyweight.HEADER_LENGTH;

const MS_500_NS = 500_000_000;

describe('MaxFlowControlStrategySystemTest', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));

    /** `mock(FragmentHandler.class)`: it counts the calls of `onFragment` and the lengths they got. */
    function mockFragmentHandler(): FragmentHandler & { lengths: number[] } {
        const lengths: number[] = [];
        return { lengths, onFragment: (_buffer, _offset, length) => void lengths.push(length) };
    }

    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;

    function launch(
        configureA: (context: MediaDriver.Context) => void = () => {},
        configureB: (context: MediaDriver.Context) => void = () => {},
    ): void {
        buffer.putInt(0, 1);

        driverA = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).timerIntervalNs(100_000_000);
            configureA(context);
        });
        driverB = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).timerIntervalNs(100_000_000);
            configureB(context);
        });
    }

    it('shouldSpinUpAndShutdown', async () => {
        tests = systemTests('shouldSpinUpAndShutdown', true);
        launch();

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const publication = driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID)!;

        await tests.drainUntil(
            () => subscriptionA.isConnected() && subscriptionB.isConnected() && publication.isConnected(),
            10_000,
            () => 'connected subscriptions and publication',
        );
        expect(tests.errors()).toEqual([]);
    });

    it('shouldTimeoutImageWhenBehindForTooLongWithMaxMulticastFlowControlStrategy', async () => {
        tests = systemTests('shouldTimeoutImageWhenBehindForTooLongWithMaxMulticastFlowControlStrategy', true);
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;

        launch(
            (context) => context.multicastFlowControlSupplier(new MaxMulticastFlowControlSupplier()),
            (context) => context.imageLivenessTimeoutNs(MS_500_NS),
        );

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        const publication: Publication = driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID)!;

        await tests.drainUntil(
            () => subscriptionA.isConnected() && subscriptionB.isConnected() && publication.isConnected(),
            10_000,
            () => 'connected subscriptions and publication',
        );

        const fragmentHandlerA = mockFragmentHandler();
        const fragmentHandlerB = mockFragmentHandler();
        let fragmentsRead = 0;

        for (let i = 0; i < numMessagesToSend; i++) {
            await tests.drainUntil(
                () => publication.offer(buffer, 0, buffer.capacity()) >= 0,
                10_000,
                () => 'a window to offer into',
            );

            fragmentsRead = 0;

            // A keeps up
            await tests.executeUntil(
                () => fragmentsRead > 0,
                () => {
                    fragmentsRead += (subscriptionA as Subscription).poll(fragmentHandlerA, 10);
                },
                0x7fffffff,
                MS_500_NS,
            );

            fragmentsRead = 0;

            // B receives slowly and eventually can't keep up
            if (i % 10 === 0) {
                await tests.executeUntil(
                    () => fragmentsRead > 0,
                    () => {
                        fragmentsRead += (subscriptionB as Subscription).poll(fragmentHandlerB, 1);
                    },
                    0x7fffffff,
                    MS_500_NS,
                );
            }
        }

        expect(fragmentHandlerA.lengths.filter((length) => length === MESSAGE_LENGTH)).toHaveLength(numMessagesToSend);
        expect(fragmentHandlerB.lengths.filter((length) => length === MESSAGE_LENGTH).length).toBeLessThanOrEqual(
            numMessagesToSend - 1,
        );
        expect(tests.errors()).toEqual([]);
    });
});
