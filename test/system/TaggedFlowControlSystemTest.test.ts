// Port of aeron-system-tests/src/test/java/io/aeron/TaggedFlowControlSystemTest.java @ 1.53.3 (phase 3, T8, D115).
// The clock is manual (one turn is 1 ms): the 1000 ms receiver timeout and the 500 ms image liveness are turns.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { FlowControlSupplier } from '../../src/driver/FlowControlSupplier.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SenderLimit } from '../../src/driver/status/SenderLimit.js';
import { TaggedMulticastFlowControlSupplier } from '../../src/driver/TaggedMulticastFlowControlSupplier.js';
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

class State {
    public numMessagesToSend = 0;
    public numMessagesLeftToSend = 0;
    public numFragmentsReadFromA = 0;
    public numFragmentsReadFromB = 0;
    public isBClosed = false;

    public toString(): string {
        return (
            'State{' +
            'numMessagesToSend=' +
            this.numMessagesToSend +
            ', numMessagesLeftToSend=' +
            this.numMessagesLeftToSend +
            ', numFragmentsReadFromA=' +
            this.numFragmentsReadFromA +
            ', numFragmentsReadFromB=' +
            this.numFragmentsReadFromB +
            ', isBClosed=' +
            this.isBClosed +
            '}'
        );
    }
}

describe('TaggedFlowControlSystemTest', () => {
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

        driverA = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).flowControlReceiverTimeoutNs(1000 * MS);
            for (const set of driverAConfig) {
                set(context);
            }
        });
        driverB = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).flowControlReceiverTimeoutNs(1000 * MS);
            for (const set of driverBConfig) {
                set(context);
            }
        });
    }

    /** `Tests.yieldingIdle(..)` */
    async function yieldTurn(): Promise<void> {
        tests.cycle();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    function newDriverContext(context: MediaDriver.Context): void {
        context.publicationTermBufferLength(TERM_BUFFER_LENGTH).timerIntervalNs(100 * MS);
    }

    /** `pollWithTimeout(..)`: a poll that reads nothing idles for a turn. */
    async function pollWithTimeout(
        subscription: Subscription,
        fragmentHandler: FragmentHandler,
        fragmentLimit: number,
    ): Promise<number> {
        const numFragments = subscription.poll(fragmentHandler, fragmentLimit);
        if (0 === numFragments) {
            await yieldTurn();
        }

        return numFragments;
    }

    /** The cap of a loop: fails with the state, where Java's `yieldingIdle` fails when the test is interrupted. */
    function checkCap(iteration: number, state: State): void {
        if (iteration > CAP) {
            throw new Error('no progress after ' + CAP + ' iterations: ' + state);
        }
    }

    const strategyConfigurations: Array<[FlowControlSupplier | null, number | null, number | null, string, string]> = [
        [new TaggedMulticastFlowControlSupplier(), null, null, '', '|gtag=-1'],
        [new TaggedMulticastFlowControlSupplier(), null, 2004, '', '|gtag=2004'],
        [null, 2020, 2020, '|fc=tagged', ''],
        [null, null, null, '|fc=tagged,g:123', '|gtag=123'],
    ];

    it.for(strategyConfigurations)(
        'shouldSlowToTaggedWithMulticastFlowControlStrategy %s',
        async ([flowControlSupplier, groupTag, flowControlGroupTag, publisherUriParams, subscriptionBUriParams]) => {
            begin('shouldSlowToTaggedWithMulticastFlowControlStrategy');
            const state = new State();
            state.numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;
            state.numMessagesLeftToSend = state.numMessagesToSend;
            state.numFragmentsReadFromB = 0;

            driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));
            if (null !== flowControlSupplier) {
                driverAConfig.push((context) => context.multicastFlowControlSupplier(flowControlSupplier));
            }
            if (null !== flowControlGroupTag) {
                driverAConfig.push((context) => context.flowControlGroupTag(flowControlGroupTag));
            }
            if (null !== groupTag) {
                driverBConfig.push((context) => context.receiverGroupTag(groupTag));
            }
            driverAConfig.push((context) => context.flowControlGroupMinSize(1));

            launch();

            const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI, STREAM_ID);
            const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI + subscriptionBUriParams, STREAM_ID);
            const publication = driverA.aeron.addPublication(
                MULTICAST_URI + publisherUriParams,
                STREAM_ID,
            ) as Publication;

            await tests.awaitConnected(subscriptionA);
            await tests.awaitConnected(subscriptionB);
            await tests.awaitConnected(publication);

            for (let i = 0; state.numFragmentsReadFromB < state.numMessagesToSend; i++) {
                checkCap(i, state);

                if (state.numMessagesLeftToSend > 0) {
                    const result = publication.offer(buffer, 0, buffer.capacity());
                    if (result >= 0) {
                        state.numMessagesLeftToSend--;
                    } else if (Publication.NOT_CONNECTED === result) {
                        throw new Error(
                            'Publication not connected, numMessagesLeftToSend=' + state.numMessagesLeftToSend,
                        );
                    } else {
                        await yieldTurn();
                    }
                }

                await yieldTurn();

                // A keeps up
                await pollWithTimeout(subscriptionA, fragmentHandlerA, 10);

                // B receives slowly
                if (i % 2 === 0) {
                    const bFragments = await pollWithTimeout(subscriptionB, fragmentHandlerB, 1);
                    if (0 === bFragments && !subscriptionB.isConnected()) {
                        if (subscriptionB.isClosed()) {
                            throw new Error(
                                'Subscription B is closed, numFragmentsFromB=' + state.numFragmentsReadFromB,
                            );
                        }

                        throw new Error(
                            'Subscription B not connected, numFragmentsFromB=' + state.numFragmentsReadFromB,
                        );
                    }

                    state.numFragmentsReadFromB += bFragments;
                }
            }

            expect(fragmentHandlerB.count(MESSAGE_LENGTH)).toBe(state.numMessagesToSend);
            expect(tests.errors()).toEqual([]);
        },
    );

    it('shouldRemoveDeadReceiver', async () => {
        begin('shouldRemoveDeadReceiver');
        const state = new State();
        state.numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;
        state.numMessagesLeftToSend = state.numMessagesToSend;
        state.numFragmentsReadFromA = 0;
        state.numFragmentsReadFromB = 0;
        state.isBClosed = false;

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const publication = driverA.aeron.addPublication(
            MULTICAST_URI + '|fc=tagged,g:123,t:1s',
            STREAM_ID,
        ) as Publication;

        const subscriptionA = driverA.aeron.addSubscription(MULTICAST_URI + '|gtag=123', STREAM_ID);
        await tests.awaitConnected(subscriptionA);
        const subscriptionB = driverB.aeron.addSubscription(MULTICAST_URI + '|gtag=123', STREAM_ID);
        await tests.awaitConnected(subscriptionB);

        await tests.awaitConnected(publication);

        for (let i = 0; state.numFragmentsReadFromA < state.numMessagesToSend; i++) {
            checkCap(i, state);

            if (state.numMessagesLeftToSend > 0) {
                const position = publication.offer(buffer, 0, buffer.capacity());
                if (position >= 0) {
                    state.numMessagesLeftToSend--;
                } else {
                    await yieldTurn();
                }
            }

            // A keeps up
            state.numFragmentsReadFromA += await pollWithTimeout(subscriptionA, fragmentHandlerA, 10);

            // B receives up to 1/8 of the messages, then stops
            if (state.numFragmentsReadFromB < state.numMessagesToSend / 8) {
                state.numFragmentsReadFromB += await pollWithTimeout(subscriptionB, fragmentHandlerB, 10);
            } else if (!state.isBClosed) {
                subscriptionB.close();
                state.isBClosed = true;
            }
        }

        expect(fragmentHandlerA.count(MESSAGE_LENGTH)).toBe(state.numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldPreventConnectionUntilRequiredGroupSizeMatchTagIsMet', async () => {
        begin('shouldPreventConnectionUntilRequiredGroupSizeMatchTagIsMet');
        const groupTag = 2701n;
        const groupSize = 3;

        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('224.20.30.39:24326')
            .networkInterface('localhost');

        const uriWithGroupTag = builder.groupTag(groupTag).flowControl(null).build();

        const uriPlain = builder.groupTag(null).flowControl(null).build();

        const uriWithTaggedFlowControl = builder.groupTag(null).taggedFlowControl(groupTag, groupSize, null).build();

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const driverC = tests.launch(newDriverContext);
        const driverD = tests.launch(newDriverContext);

        const publication = driverA.aeron.addPublication(uriWithTaggedFlowControl, STREAM_ID) as Publication;

        const subscription0 = driverA.aeron.addSubscription(uriPlain, STREAM_ID);
        const subscription1 = driverA.aeron.addSubscription(uriPlain, STREAM_ID);
        const subscription2 = driverA.aeron.addSubscription(uriPlain, STREAM_ID);
        const subscription3 = driverB.aeron.addSubscription(uriWithGroupTag, STREAM_ID);
        const subscription4 = driverC.aeron.addSubscription(uriWithGroupTag, STREAM_ID);

        await FlowControlTests.awaitConnectionAndStatusMessages(
            tests,
            driverA.aeron.countersReader(),
            subscription0,
            subscription1,
            subscription2,
            subscription3,
            subscription4,
        );

        expect(publication.isConnected()).toBe(false);

        const subscription5 = driverD.aeron.addSubscription(uriWithGroupTag, STREAM_ID);

        // Should now have 3 receivers and publication should eventually be connected.
        await tests.drainUntil(
            () => publication.isConnected(),
            CAP,
            () => 'a connected publication',
        );

        subscription5.close();

        // Lost a receiver and publication should eventually be disconnected.
        await tests.drainUntil(
            () => !publication.isConnected(),
            CAP,
            () => 'a publication that is not connected',
        );

        const subscription5Again = driverD.aeron.addSubscription(uriWithGroupTag, STREAM_ID);

        // Aaaaaand reconnect.
        await tests.drainUntil(
            () => publication.isConnected(),
            CAP,
            () => 'a connected publication',
        );
        expect(subscription5Again).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });

    it('shouldPreventConnectionUntilAtLeastOneSubscriberConnectedWithRequiredGroupSizeZero', async () => {
        begin('shouldPreventConnectionUntilAtLeastOneSubscriberConnectedWithRequiredGroupSizeZero');
        const groupTag = 2701n;
        const groupSize = 0;

        const builder = new ChannelUriStringBuilder()
            .media('udp')
            .endpoint('224.20.30.41:24326')
            .networkInterface('localhost');

        const plainUri = builder.build();

        const uriWithGroupTag = builder.groupTag(groupTag).flowControl(null).build();

        const uriWithTaggedFlowControl = builder.groupTag(null).taggedFlowControl(groupTag, groupSize, null).build();

        launch();

        const publication = driverA.aeron.addPublication(uriWithTaggedFlowControl, STREAM_ID) as Publication;
        const otherPublication = driverA.aeron.addPublication(plainUri, STREAM_ID + 1) as Publication;

        driverA.aeron.addSubscription(plainUri, STREAM_ID + 1);

        await tests.drainUntil(
            () => otherPublication.isConnected(),
            CAP,
            () => 'a connected other publication',
        );
        // We know another publication on the same channel is connected

        expect(publication.isConnected()).toBe(false);

        const subscriptionA = driverA.aeron.addSubscription(uriWithGroupTag, STREAM_ID);

        await tests.awaitConnected(publication);
        await tests.awaitConnected(subscriptionA);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldHandleSenderLimitCorrectlyWithMinGroupSize', async () => {
        begin('shouldHandleSenderLimitCorrectlyWithMinGroupSize');
        const publisherUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123/1';
        const groupSubscriberUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|gtag=123';
        const subscriberUri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const publication = driverA.aeron.addPublication(publisherUri, STREAM_ID) as Publication;

        const countersReader = driverA.aeron.countersReader();

        const senderLimitCounterId = FlowControlTests.findCounterIdByRegistrationId(
            countersReader,
            SenderLimit.SENDER_LIMIT_TYPE_ID,
            publication.registrationId(),
        );
        const currentSenderLimit = countersReader.getCounterValue(senderLimitCounterId);

        const subscriptionA = driverA.aeron.addSubscription(subscriberUri, STREAM_ID);

        await FlowControlTests.awaitConnectionAndStatusMessages(tests, countersReader, subscriptionA);
        expect(countersReader.getCounterValue(senderLimitCounterId)).toBe(currentSenderLimit);

        const subscriptionB = driverB.aeron.addSubscription(groupSubscriberUri, STREAM_ID);

        await tests.drainUntil(
            () => currentSenderLimit !== countersReader.getCounterValue(senderLimitCounterId),
            CAP,
            () => 'a sender limit that moved from ' + currentSenderLimit,
        );
        expect(subscriptionB).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });
});
