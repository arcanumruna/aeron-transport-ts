// Port of aeron-system-tests/src/test/java/io/aeron/MinFlowControlSystemTest.java @ 1.53.3 (phase 3, T8, D115).
// The clock is manual (one turn is 1 ms): the 1000 ms receiver timeout and the 500 ms image liveness are turns.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { AeronCounters } from '../../src/client/AeronCounters.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { Publication } from '../../src/client/Publication.js';
import type { FlowControlSupplier } from '../../src/driver/FlowControlSupplier.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { MinMulticastFlowControlSupplier } from '../../src/driver/MinMulticastFlowControlSupplier.js';
import { SenderLimit } from '../../src/driver/status/SenderLimit.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { FlowControlTests } from '../support/FlowControlTests.js';
import { FragmentRecorder } from '../support/FragmentRecorder.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestNode } from '../support/SystemTests.js';

const MULTICAST_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';
const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const NUM_MESSAGES_PER_TERM = 64;
const MESSAGE_LENGTH = TERM_BUFFER_LENGTH / NUM_MESSAGES_PER_TERM - DataHeaderFlyweight.HEADER_LENGTH;

const MS = 1_000_000;
/** The cap, in turns, of the loops that Java leaves to `@InterruptAfter`. */
const CAP = 200_000;

describe('MinFlowControlSystemTest', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));

    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;
    let driverAConfig: Array<(context: MediaDriver.Context) => void>;
    let driverBConfig: Array<(context: MediaDriver.Context) => void>;
    let fragmentHandlerA: FragmentRecorder;
    let fragmentHandlerB: FragmentRecorder;

    function begin(name: string): void {
        tests = systemTests(name, true);
        driverAConfig = [];
        driverBConfig = [];
        fragmentHandlerA = new FragmentRecorder();
        fragmentHandlerB = new FragmentRecorder();
    }

    function launch(): void {
        buffer.putInt(0, 1);

        const common = (context: MediaDriver.Context): MediaDriver.Context =>
            context
                .publicationTermBufferLength(TERM_BUFFER_LENGTH)
                .timerIntervalNs(100 * MS)
                .flowControlReceiverTimeoutNs(1000 * MS);

        driverA = tests.launch((context) => {
            common(context);
            for (const set of driverAConfig) {
                set(context);
            }
        });
        driverB = tests.launch((context) => {
            common(context);
            for (const set of driverBConfig) {
                set(context);
            }
        });
    }

    /** `Tests.yield()` */
    async function yieldTurn(): Promise<void> {
        tests.cycle();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    function newDriverCContext(context: MediaDriver.Context): void {
        context.publicationTermBufferLength(TERM_BUFFER_LENGTH).timerIntervalNs(100 * MS);
    }

    const strategyConfigurations: Array<[FlowControlSupplier | null, string]> = [
        [new MinMulticastFlowControlSupplier(), ''],
        [null, '|fc=min'],
        [null, '|fc=min,g:/1'],
    ];

    it.for(strategyConfigurations)(
        'shouldSlowToMinMulticastFlowControlStrategy %s',
        async ([flowControlSupplier, publisherUriParams]) => {
            begin('shouldSlowToMinMulticastFlowControlStrategy');
            const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;
            let numMessagesLeftToSend = numMessagesToSend;
            let numFragmentsFromB = 0;

            driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));
            if (null !== flowControlSupplier) {
                driverAConfig.push((context) => context.multicastFlowControlSupplier(flowControlSupplier));
            }
            driverAConfig.push((context) => context.flowControlGroupMinSize(1));

            launch();

            const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
            const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
            const publication = driverA.aeron.addPublication(
                MULTICAST_URI + publisherUriParams,
                STREAM_ID,
            ) as Publication;

            const flowControlCounterId = driverA.aeron
                .countersReader()
                .findByTypeIdAndRegistrationId(
                    AeronCounters.FLOW_CONTROL_RECEIVERS_COUNTER_TYPE_ID,
                    publication.registrationId(),
                );
            expect(flowControlCounterId).not.toBe(CountersReader.NULL_COUNTER_ID);

            await tests.drainUntil(
                () =>
                    subscriptionA.isConnected() &&
                    subscriptionB.isConnected() &&
                    publication.isConnected() &&
                    driverA.aeron.countersReader().getCounterValue(flowControlCounterId) >= 2,
                CAP,
                () => 'connected subscriptions and publication and two receivers',
            );

            for (let i = 0; numFragmentsFromB < numMessagesToSend; i++) {
                if (i > CAP) {
                    throw new Error(
                        'B read ' + numFragmentsFromB + ' of ' + numMessagesToSend + ' after ' + CAP + ' turns',
                    );
                }

                if (numMessagesLeftToSend > 0) {
                    const result = publication.offer(buffer, 0, buffer.capacity());
                    if (result >= 0) {
                        numMessagesLeftToSend--;
                    } else if (Publication.NOT_CONNECTED === result) {
                        throw new Error('Publication not connected, numMessagesLeftToSend=' + numMessagesLeftToSend);
                    }
                }

                await yieldTurn();

                // A keeps up
                subscriptionA.poll(fragmentHandlerA, 10);

                // B receives slowly
                if (i % 2 === 0) {
                    const bFragments = subscriptionB.poll(fragmentHandlerB, 1);
                    if (0 === bFragments && !subscriptionB.isConnected()) {
                        if (subscriptionB.isClosed()) {
                            throw new Error('Subscription B is closed, numFragmentsFromB=' + numFragmentsFromB);
                        }

                        throw new Error('Subscription B not connected, numFragmentsFromB=' + numFragmentsFromB);
                    }

                    numFragmentsFromB += bFragments;
                }
            }

            expect(fragmentHandlerB.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
            expect(tests.errors()).toEqual([]);
        },
    );

    it('shouldRemoveDeadReceiverWithMinMulticastFlowControlStrategy', async () => {
        begin('shouldRemoveDeadReceiverWithMinMulticastFlowControlStrategy');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;
        let numMessagesLeftToSend = numMessagesToSend;
        let numFragmentsReadFromA = 0;
        let numFragmentsReadFromB = 0;

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));
        driverAConfig.push((context) => context.multicastFlowControlSupplier(new MinMulticastFlowControlSupplier()));

        launch();

        const publication = driverA.aeron.addPublication(MULTICAST_URI, STREAM_ID) as Publication;

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        await tests.awaitConnected(subscriptionA);

        const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
        await tests.awaitConnected(subscriptionB);

        await tests.awaitConnected(publication);

        let isBClosed = false;
        for (let iteration = 0; numFragmentsReadFromA < numMessagesToSend; iteration++) {
            if (iteration > CAP) {
                throw new Error(
                    'numMessagesToSend=' +
                        numMessagesToSend +
                        ' numMessagesLeftToSend=' +
                        numMessagesLeftToSend +
                        ' numFragmentsReadFromA=' +
                        numFragmentsReadFromA +
                        ' numFragmentsReadFromB=' +
                        numFragmentsReadFromB,
                );
            }

            let workDone = 0;
            if (numMessagesLeftToSend > 0) {
                const position = publication.offer(buffer, 0, buffer.capacity());
                if (position >= 0) {
                    numMessagesLeftToSend--;
                    workDone++;
                }
            }

            // A keeps up
            const readA = subscriptionA.poll(fragmentHandlerA, 10);
            numFragmentsReadFromA += readA;
            workDone += readA;

            // B receives up to 1/8 of the messages, then stops
            if (numFragmentsReadFromB < numMessagesToSend / 8) {
                const readB = subscriptionB.poll(fragmentHandlerB, 10);
                numFragmentsReadFromB += readB;
                workDone += readB;
            } else if (!isBClosed) {
                subscriptionB.close();
                isBClosed = true;
            }

            if (0 === workDone) {
                await yieldTurn();
            }
        }

        expect(fragmentHandlerA.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldPreventConnectionUntilGroupMinSizeIsMet', async () => {
        begin('shouldPreventConnectionUntilGroupMinSizeIsMet');
        const groupSize = 3;

        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('224.20.30.39:24326')
            .networkInterface('localhost');

        const uriPlain = builder.flowControl(null).build();

        const uriWithMinFlowControl = builder.groupTag(null).minFlowControl(groupSize, null).build();

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const countersReader = driverA.aeron.countersReader();
        const driverC = tests.launch(newDriverCContext);

        const subscription0 = driverA.aeron.addSubscription(uriPlain, STREAM_ID);
        const subscription1 = driverB.aeron.addSubscription(uriPlain, STREAM_ID);
        const publication = driverA.aeron.addPublication(uriWithMinFlowControl, STREAM_ID) as Publication;

        await FlowControlTests.awaitConnectionAndStatusMessages(tests, countersReader, subscription0, subscription1);

        expect(publication.isConnected()).toBe(false);

        const subscription2 = driverC.aeron.addSubscription(uriPlain, STREAM_ID);

        // Should now have 3 receivers and publication should eventually be connected.
        await tests.drainUntil(
            () => publication.isConnected(),
            CAP,
            () => 'a connected publication',
        );

        subscription2.close();

        // Lost a receiver and publication should eventually be disconnected.
        await tests.drainUntil(
            () => !publication.isConnected(),
            CAP,
            () => 'a publication that is not connected',
        );

        const subscription2Again = driverC.aeron.addSubscription(uriPlain, STREAM_ID);

        await tests.drainUntil(
            () => publication.isConnected(),
            CAP,
            () => 'a connected publication',
        );
        expect(subscription2Again).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });

    it('shouldPreventConnectionUntilAtLeastOneSubscriberConnectedWithRequiredGroupSizeZero', async () => {
        begin('shouldPreventConnectionUntilAtLeastOneSubscriberConnectedWithRequiredGroupSizeZero');
        const groupSize = 0;

        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('224.20.30.41:24326')
            .networkInterface('localhost');

        const plainUri = builder.flowControl(null).build();

        const uriWithMinFlowControl = builder.groupTag(null).minFlowControl(groupSize, null).build();

        launch();

        driverA.aeron.addSubscription(plainUri, STREAM_ID + 1);
        const publication = driverA.aeron.addPublication(uriWithMinFlowControl, STREAM_ID) as Publication;
        const otherPublication = driverA.aeron.addPublication(plainUri, STREAM_ID + 1) as Publication;

        await tests.awaitConnected(otherPublication);

        // We know another publication on the same channel is connected

        const subscriptionA = driverA.aeron.addSubscription(plainUri, STREAM_ID);

        await tests.drainUntil(
            () => publication.isConnected(),
            CAP,
            () => 'a connected publication',
        );
        expect(subscriptionA).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });

    it('shouldHandleSenderLimitCorrectlyWithMinGroupSize', async () => {
        begin('shouldHandleSenderLimitCorrectlyWithMinGroupSize');
        const publisherUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123/1';
        const groupSubscriberUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|gtag=123';
        const subscriberUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const subscriptionA = driverA.aeron.addSubscription(subscriberUri, STREAM_ID);
        const publication = driverA.aeron.addPublication(publisherUri, STREAM_ID) as Publication;

        const countersReader = driverA.aeron.countersReader();

        const senderLimitCounterId = FlowControlTests.findCounterIdByRegistrationId(
            countersReader,
            SenderLimit.SENDER_LIMIT_TYPE_ID,
            publication.registrationId(),
        );
        const currentSenderLimit = countersReader.getCounterValue(senderLimitCounterId);

        await FlowControlTests.awaitConnectionAndStatusMessages(tests, countersReader, subscriptionA);
        expect(countersReader.getCounterValue(senderLimitCounterId)).toBe(currentSenderLimit);

        const subscriptionB = driverB.aeron.addSubscription(groupSubscriberUri, STREAM_ID);

        await tests.drainUntil(
            () => currentSenderLimit !== countersReader.getCounterValue(senderLimitCounterId),
            CAP,
            () =>
                'currentSenderLimit(' +
                currentSenderLimit +
                ') == countersReader.getCounterValue(senderLimitCounterId)(' +
                countersReader.getCounterValue(senderLimitCounterId) +
                ')',
        );
        expect(subscriptionB).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });
});
