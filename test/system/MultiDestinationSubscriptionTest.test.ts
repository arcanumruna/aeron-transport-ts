// Port of aeron-system-tests/src/test/java/io/aeron/MultiDestinationSubscriptionTest.java @ 1.53.3 (phase 3, T10, D115).
// The clock is manual (one turn is 1 ms): `Tests.sleep(1000)` is 1000 turns. The rows that need IPC or spy subscriptions are
// skipped (not ported, spec section 3).
import { describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { AeronCounters } from '../../src/client/AeronCounters.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { CommonContext } from '../../src/client/CommonContext.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { ExclusivePublication } from '../../src/client/ExclusivePublication.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { mulberry32 } from '../support/Random.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ReceiveLocalSocketAddress } from '../../src/driver/status/ReceiveLocalSocketAddress.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { FragmentRecorder } from '../support/FragmentRecorder.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestClient, TestNode } from '../support/SystemTests.js';

const UNICAST_ENDPOINT_A = 'localhost:24325';
const UNICAST_ENDPOINT_B = 'localhost:24326';

const PUB_UNICAST_URI = 'aeron:udp?endpoint=localhost:24325';
const PUB_MULTICAST_URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost';
const PUB_MDC_URI = 'aeron:udp?control=localhost:24325|control-mode=dynamic';

const SUB_URI = 'aeron:udp?control-mode=manual';
const SUB_MDC_DESTINATION_URI = 'aeron:udp?endpoint=localhost:24326|control=localhost:24325';

const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const NUM_MESSAGES_PER_TERM = 64;
const MESSAGE_LENGTH = TERM_BUFFER_LENGTH / NUM_MESSAGES_PER_TERM - DataHeaderFlyweight.HEADER_LENGTH;

/** The cap, in turns, of the loops that Java leaves to `@InterruptAfter`. */
const CAP = 200_000;

describe('MultiDestinationSubscriptionTest', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));

    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;
    let clientA: TestClient;
    let clientB: TestClient;
    let fragmentHandler: FragmentRecorder;
    let copyFragmentHandler: FragmentRecorder;

    function begin(name: string): void {
        tests = systemTests(name, true);
        fragmentHandler = new FragmentRecorder();
        copyFragmentHandler = new FragmentRecorder();
    }

    function launch(errorHandler: ErrorHandler | null = null): void {
        buffer.putInt(0, 1);

        driverA = tests.launch((context: MediaDriver.Context) => {
            if (null !== errorHandler) {
                context.errorHandler(errorHandler);
            }
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH);
        });
        clientA = driverA.clients[0] as TestClient;
    }

    function launchSecond(): void {
        driverB = tests.launch((context: MediaDriver.Context) =>
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH),
        );
        clientB = driverB.clients[0] as TestClient;
    }

    /** `Tests.yield()` */
    async function yieldTurn(): Promise<void> {
        tests.cycle();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    /** `Tests.sleep(ms)`: the turns are the clock. */
    async function sleep(ms: number): Promise<void> {
        for (let t = 0; t < ms; t++) {
            await yieldTurn();
        }
    }

    /** `while (pub.offer(buffer, 0, buffer.capacity()) < 0L) Tests.yield();` */
    function offerMessage(pub: Publication): Promise<void> {
        return tests.drainUntil(
            () => pub.offer(buffer, 0, buffer.capacity()) >= 0,
            CAP,
            () => 'a window in ' + pub,
        );
    }

    /** `pollForFragment(subscription, handler)` */
    function pollForFragment(subscription: Subscription, handler: FragmentHandler): Promise<void> {
        return tests.drainUntil(
            () => 0 !== subscription.poll(handler, 1),
            CAP,
            () => 'a fragment of ' + subscription.channel(),
        );
    }

    /** `while (subscription.poll(fragmentHandler, 1) <= 0) Tests.yield();` */
    function pollOne(subscription: Subscription, handler: FragmentHandler): Promise<void> {
        return pollForFragment(subscription, handler);
    }

    function verifyFragments(handler: FragmentRecorder, numMessagesToSend: number): void {
        expect(handler.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
    }

    it('subscriptionCloseShouldAlsoCloseMediaDriverPorts', () => {
        begin('subscriptionCloseShouldAlsoCloseMediaDriverPorts');
        launch();

        const publicationChannelA = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .endpoint(UNICAST_ENDPOINT_A)
            .build();

        let subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(publicationChannelA);

        subscription.close();
        clientA.close();

        clientA = tests.connect(driverA);
        subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(publicationChannelA);
        expect(tests.errors()).toEqual([]);
    });

    it('destinationShouldInheritSocketBufferLengthsFromSubscription', (ctx) => {
        if ('linux' !== process.platform) {
            ctx.skip('@EnabledOnOs(OS.LINUX)');
        }
        begin('destinationShouldInheritSocketBufferLengthsFromSubscription');
        launch();

        const publicationChannelA = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .endpoint('127.0.0.1:24325')
            .build();

        const subscription = clientA.aeron.addSubscription(
            SUB_URI + '|so-sndbuf=32768|so-rcvbuf=32768|rcv-wnd=32768',
            STREAM_ID,
        );
        subscription.addDestination(publicationChannelA);
        expect(tests.errors()).toEqual([]);
    });

    it.skip('addDestinationWithSpySubscriptionBeforeAddPublication', () => {});

    it.skip('addDestinationWithSpySubscriptionAfterAddPublication', () => {});

    it.skip('addDestinationWithSpySubscriptionThenDisconnectOnPublicationClose', () => {});

    it.skip('addDestinationWithSpySubscriptionThenRemoveDestination', () => {});

    it('addAndRemoveNetworkDestination', async () => {
        begin('addAndRemoveNetworkDestination');
        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID);

        await tests.awaitConnected(subscription);

        subscription.removeDestination(PUB_UNICAST_URI);
        await tests.awaitConnections(subscription, 0);
        expect(tests.errors()).toEqual([]);
    });

    it.skip('addDestinationWithIpcSubscriptionBeforeAddPublication', () => {});

    it.skip('addDestinationWithIpcSubscriptionAfterAddPublication', () => {});

    it.skip('addDestinationWithIpcSubscriptionThenDisconnectOnPublicationClose', () => {});

    it.skip('addDestinationWithIpcSubscriptionThenRemoveDestination', () => {});

    it('shouldSpinUpAndShutdownWithUnicast', async () => {
        begin('shouldSpinUpAndShutdownWithUnicast');
        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID);

        await tests.awaitConnected(subscription);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSpinUpAndShutdownWithMulticast', async () => {
        begin('shouldSpinUpAndShutdownWithMulticast');
        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        const correlationId = subscription.asyncAddDestination(PUB_MULTICAST_URI);

        clientA.aeron.addPublication(PUB_MULTICAST_URI, STREAM_ID);

        await tests.awaitConnected(subscription);

        expect(clientA.aeron.isCommandActive(correlationId)).toBe(false);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSpinUpAndShutdownWithDynamicMdc', async () => {
        begin('shouldSpinUpAndShutdownWithDynamicMdc');
        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(SUB_MDC_DESTINATION_URI);

        clientA.aeron.addPublication(PUB_MDC_URI, STREAM_ID);

        await tests.awaitConnected(subscription);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToSingleDestinationSubscriptionWithUnicast', async () => {
        begin('shouldSendToSingleDestinationSubscriptionWithUnicast');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;

        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        const publicationA = clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID) as Publication;

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);
        }

        verifyFragments(fragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldAllowMultipleMdsSubscriptions', async () => {
        begin('shouldAllowMultipleMdsSubscriptions');
        const unicastUri2 = 'aeron:udp?endpoint=localhost:24326';

        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        const subscriptionB = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscriptionB.addDestination(unicastUri2);

        const publicationA = clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID) as Publication;
        const publicationB = clientA.aeron.addPublication(unicastUri2, STREAM_ID) as Publication;

        await offerMessage(publicationA);

        await pollOne(subscription, fragmentHandler);

        // Wait a bit to ensure a message doesn't arrive.
        await sleep(1000);
        expect(subscriptionB.poll(fragmentHandler, 1)).toBe(0);

        await offerMessage(publicationB);

        await pollOne(subscriptionB, fragmentHandler);

        // Wait a bit to ensure a message doesn't arrive.
        await sleep(1000);

        expect(subscription.poll(fragmentHandler, 1)).toBe(0);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldFindMdsSubscriptionWithTags', async () => {
        begin('shouldFindMdsSubscriptionWithTags');
        launch();

        const tagA = clientA.aeron.nextCorrelationId();
        const tagIgnored = clientA.aeron.nextCorrelationId();

        const taggedSubUri = new ChannelUriStringBuilder(SUB_URI).tags(tagA, null).build();
        const taggedSubUriIgnored = new ChannelUriStringBuilder(SUB_URI).tags(tagIgnored, null).build();
        const referringSubUri = new ChannelUriStringBuilder().media('udp').tags(tagA, null).build();

        const subscription = clientA.aeron.addSubscription(taggedSubUri, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        clientA.aeron.addSubscription(taggedSubUriIgnored, STREAM_ID);
        const subscriptionA1 = clientA.aeron.addSubscription(referringSubUri, STREAM_ID);
        const publicationA = clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID) as Publication;

        await offerMessage(publicationA);

        await pollOne(subscriptionA1, fragmentHandler);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldAllowMultipleMdsSubscriptionsWithTags', async () => {
        begin('shouldAllowMultipleMdsSubscriptionsWithTags');
        const unicastUri2 = 'aeron:udp?endpoint=localhost:24326';

        launch();

        const tagA = clientA.aeron.nextCorrelationId();
        const tagB = clientA.aeron.nextCorrelationId();

        const uriA = new ChannelUriStringBuilder(SUB_URI).tags(tagA, null).build();
        const referringUriA = new ChannelUriStringBuilder().media('udp').tags(tagA, null).build();
        const uriB = new ChannelUriStringBuilder(SUB_URI).tags(tagB, null).build();
        const referringUriB = new ChannelUriStringBuilder().media('udp').tags(tagB, null).build();

        const subscription = clientA.aeron.addSubscription(uriA, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        const subscriptionB = clientA.aeron.addSubscription(uriB, STREAM_ID);
        const subscriptionA1 = clientA.aeron.addSubscription(referringUriA, STREAM_ID);
        const subscriptionB1 = clientA.aeron.addSubscription(referringUriB, STREAM_ID);
        subscriptionB.addDestination(unicastUri2);

        const publicationA = clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID) as Publication;
        const publicationB = clientA.aeron.addPublication(unicastUri2, STREAM_ID) as Publication;

        await offerMessage(publicationA);

        await pollOne(subscriptionA1, fragmentHandler);

        // Wait a bit to ensure a message doesn't arrive.
        await sleep(1000);

        expect(subscriptionB1.poll(fragmentHandler, 1)).toBe(0);

        await offerMessage(publicationB);

        await pollOne(subscriptionB1, fragmentHandler);

        // Wait a bit to ensure a message doesn't arrive.
        await sleep(1000);

        expect(subscriptionA1.poll(fragmentHandler, 1)).toBe(0);
        expect(subscription).not.toBeNull();
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToSingleDestinationMultipleSubscriptionsWithUnicast', async () => {
        begin('shouldSendToSingleDestinationMultipleSubscriptionsWithUnicast');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;

        launch();

        const channelTag = clientA.aeron.nextCorrelationId();
        const subTag = clientA.aeron.nextCorrelationId();

        const subscriptionChannel = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .tags(channelTag, subTag)
            .controlMode(CommonContext.MDC_CONTROL_MODE_MANUAL)
            .build();

        const copyChannel = new ChannelUriStringBuilder().media('udp').tags(channelTag, subTag).build();

        const subscription = clientA.aeron.addSubscription(subscriptionChannel, STREAM_ID);
        const copySubscription = clientA.aeron.addSubscription(copyChannel, STREAM_ID);
        subscription.addDestination(PUB_UNICAST_URI);

        const publicationA = clientA.aeron.addPublication(PUB_UNICAST_URI, STREAM_ID) as Publication;

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);
            await pollForFragment(copySubscription, copyFragmentHandler);
        }

        verifyFragments(fragmentHandler, numMessagesToSend);
        verifyFragments(copyFragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToSingleDestinationSubscriptionWithMulticast', async () => {
        begin('shouldSendToSingleDestinationSubscriptionWithMulticast');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;

        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(PUB_MULTICAST_URI);

        const publicationA = clientA.aeron.addPublication(PUB_MULTICAST_URI, STREAM_ID) as Publication;

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);
        }

        verifyFragments(fragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToSingleDestinationSubscriptionWithDynamicMdc', async () => {
        begin('shouldSendToSingleDestinationSubscriptionWithDynamicMdc');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;

        launch();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(SUB_MDC_DESTINATION_URI);

        const publicationA = clientA.aeron.addPublication(PUB_MDC_URI, STREAM_ID) as Publication;

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);
        }

        verifyFragments(fragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToMultipleDestinationSubscriptionWithSameStream', async () => {
        begin('shouldSendToMultipleDestinationSubscriptionWithSameStream');
        const numMessagesToSend = NUM_MESSAGES_PER_TERM * 3;
        const numMessagesToSendForA = numMessagesToSend / 2;
        const numMessagesToSendForB = numMessagesToSend / 2;

        launch();

        const channelTag = clientA.aeron.nextCorrelationId();
        const pubTag = clientA.aeron.nextCorrelationId();

        const publicationChannelA = new ChannelUriStringBuilder()
            .tags(channelTag, pubTag)
            .media(CommonContext.UDP_MEDIA)
            .endpoint(UNICAST_ENDPOINT_A)
            .build();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(publicationChannelA);

        const publicationA = clientA.aeron.addPublication(publicationChannelA, STREAM_ID) as Publication;

        await tests.awaitConnected(subscription);

        for (let i = 0; i < numMessagesToSendForA; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);
        }

        const position = publicationA.position();
        const initialTermId = publicationA.initialTermId();
        const positionBitsToShift = LogBufferDescriptor.positionBitsToShift(publicationA.termBufferLength());
        const termId = LogBufferDescriptor.computeTermIdFromPosition(position, positionBitsToShift, initialTermId);
        const termOffset = position % publicationA.termBufferLength();

        const publicationChannelB = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .taggedSessionId(pubTag)
            .initialTermId(initialTermId)
            .termId(termId)
            .termOffset(termOffset)
            .endpoint(UNICAST_ENDPOINT_B)
            .build();

        const publicationB = clientA.aeron.addExclusivePublication(publicationChannelB, STREAM_ID) as Publication;

        const destinationChannel = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .endpoint(UNICAST_ENDPOINT_B)
            .build();

        subscription.addDestination(destinationChannel);

        for (let i = 0; i < numMessagesToSendForB; i++) {
            await offerMessage(publicationB);

            await pollForFragment(subscription, fragmentHandler);
        }

        expect(subscription.imageCount()).toBe(1);
        expect(subscription.imageAtIndex(0).activeTransportCount()).toBe(2);
        verifyFragments(fragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldMergeStreamsFromMultiplePublicationsWithSameParams', async () => {
        begin('shouldMergeStreamsFromMultiplePublicationsWithSameParams');
        const numMessagesToSend = 30;
        const numMessagesToSendForA = numMessagesToSend / 2;
        const numMessagesToSendForB = numMessagesToSend / 2;

        launch();
        launchSecond();

        const publicationChannelA = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .endpoint(UNICAST_ENDPOINT_A)
            .build();

        const destinationB = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .endpoint(UNICAST_ENDPOINT_B)
            .build();

        const subscription = clientA.aeron.addSubscription(SUB_URI, STREAM_ID);
        subscription.addDestination(publicationChannelA);
        subscription.addDestination(destinationB);

        const publicationA = clientA.aeron.addExclusivePublication(
            publicationChannelA,
            STREAM_ID,
        ) as ExclusivePublication;

        const publicationChannelB = new ChannelUriStringBuilder()
            .media(CommonContext.UDP_MEDIA)
            .initialPosition(0, publicationA.initialTermId(), publicationA.termBufferLength())
            .sessionId(publicationA.sessionId())
            .endpoint(UNICAST_ENDPOINT_B)
            .build();

        const publicationB = clientB.aeron.addExclusivePublication(
            publicationChannelB,
            STREAM_ID,
        ) as ExclusivePublication;
        let position = Number.MIN_SAFE_INTEGER;

        for (let i = 0; i < numMessagesToSendForA; i++) {
            await offerMessage(publicationA);

            await pollForFragment(subscription, fragmentHandler);

            await tests.drainUntil(
                () => (position = publicationB.offer(buffer, 0, buffer.capacity())) >= 0,
                CAP,
                () => 'Failed to offer: ' + position,
            );

            expect(subscription.poll(fragmentHandler, 10)).toBe(0);
        }

        for (let i = 0; i < numMessagesToSendForB; i++) {
            await offerMessage(publicationB);

            await pollForFragment(subscription, fragmentHandler);

            await offerMessage(publicationA);

            expect(subscription.poll(fragmentHandler, 10)).toBe(0);
        }

        expect(subscription.imageCount()).toBe(1);
        expect(subscription.imageAtIndex(0).activeTransportCount()).toBe(2);
        verifyFragments(fragmentHandler, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it.for(['aeron:udp?endpoint=localhost:8889'])(
        'shouldNotReuseEndpointAcrossMultipleSubscriptionsIfAtLeastOneIsMds %s',
        async (channel) => {
            begin('shouldNotReuseEndpointAcrossMultipleSubscriptionsIfAtLeastOneIsMds');
            const errorMatches = (err: string): boolean =>
                err.includes('Address already in use') || err.includes('Address in use') || err.includes('EADDRINUSE');
            launch({ onError: vi.fn() });

            const sub1 = clientA.aeron.addSubscription(channel, STREAM_ID);
            const mdsSubscription = clientA.aeron.addSubscription('aeron:udp?control-mode=manual', STREAM_ID);
            let exception: unknown = null;
            try {
                mdsSubscription.addDestination(sub1.channel());
            } catch (ex) {
                exception = ex;
            }
            expect(exception).toBeInstanceOf(RegistrationException);
            expect(errorMatches((exception as RegistrationException).message)).toBe(true);

            const errors = (): number =>
                clientA.aeron.countersReader().getCounterValue(SystemCounterDescriptor.ERRORS.id());
            await tests.drainUntil(
                () => 1 === errors(),
                CAP,
                () => 'one error counted (at ' + errors() + ')',
            );
            mdsSubscription.close();
            sub1.close();

            const mdsSubscription2 = clientA.aeron.addSubscription('aeron:udp?control-mode=manual', STREAM_ID);
            mdsSubscription2.addDestination(channel);

            exception = null;
            try {
                clientA.aeron.addSubscription(channel, STREAM_ID);
            } catch (ex) {
                exception = ex;
            }
            expect(exception).toBeInstanceOf(RegistrationException);
            expect(errorMatches((exception as RegistrationException).message)).toBe(true);

            await tests.drainUntil(
                () => 2 === errors(),
                CAP,
                () => 'two errors counted (at ' + errors() + ')',
            );
            mdsSubscription2.close();

            const mdsSubscription1 = clientA.aeron.addSubscription('aeron:udp?control-mode=manual', STREAM_ID);
            const mdsSubscription3 = clientA.aeron.addSubscription('aeron:udp?control-mode=manual', STREAM_ID);
            mdsSubscription1.addDestination(channel);
            exception = null;
            try {
                mdsSubscription3.addDestination(channel);
            } catch (ex) {
                exception = ex;
            }
            expect(exception).toBeInstanceOf(RegistrationException);
            expect(errorMatches((exception as RegistrationException).message)).toBe(true);

            await tests.drainUntil(
                () => 3 === errors(),
                CAP,
                () => 'three errors counted (at ' + errors() + ')',
            );
        },
    );

    it('shouldCleanupMdcDestinationWhenSubscriptionIsClosed', async () => {
        begin('shouldCleanupMdcDestinationWhenSubscriptionIsClosed');
        launch({ onError: vi.fn() });

        const countersReader = clientA.aeron.countersReader();
        let receiveSocketCount = 0;
        const countReceiveSockets = (): void => {
            receiveSocketCount = 0;
            for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
                if (
                    countersReader.getCounterState(counterId) === CountersReader.RECORD_ALLOCATED &&
                    AeronCounters.DRIVER_LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID ===
                        countersReader.getCounterTypeId(counterId) &&
                    countersReader.getCounterLabel(counterId).startsWith(ReceiveLocalSocketAddress.NAME)
                ) {
                    receiveSocketCount++;
                }
            }
        };

        const pub1 = clientA.aeron.addExclusivePublication(
            'aeron:udp?endpoint=localhost:8889',
            STREAM_ID,
        ) as Publication;
        const pub2 = clientA.aeron.addExclusivePublication(
            'aeron:udp?control=localhost:5555|control-mode=dynamic',
            STREAM_ID,
        ) as Publication;
        const random = mulberry32(8889);

        const mdsSubscription = clientA.aeron.addSubscription('aeron:udp?control-mode=manual', STREAM_ID);
        const registrationId = mdsSubscription.registrationId();
        mdsSubscription.addDestination('aeron:udp?endpoint=localhost:8889');
        mdsSubscription.addDestination('aeron:udp?control=localhost:5555|endpoint=localhost:0');

        await tests.awaitConnected(pub1);
        await tests.awaitConnected(pub2);
        await tests.awaitConnected(mdsSubscription);

        const length = 1 + Math.floor(random() * (buffer.capacity() - 1));
        await tests.drainUntil(
            () => pub1.offer(buffer, 0, length) >= 0,
            CAP,
            () => 'a window in pub1',
        );

        const length2 = 1 + Math.floor(random() * (buffer.capacity() - 1));
        await tests.drainUntil(
            () => pub2.offer(buffer, 0, length2) >= 0,
            CAP,
            () => 'a window in pub2',
        );

        countReceiveSockets();
        expect(receiveSocketCount).toBe(2);
        expect(
            countersReader.findByTypeIdAndRegistrationId(
                AeronCounters.DRIVER_RECEIVE_CHANNEL_STATUS_TYPE_ID,
                registrationId,
            ),
        ).not.toBe(CountersReader.NULL_COUNTER_ID);

        mdsSubscription.close();

        await tests.drainUntil(
            () => {
                countReceiveSockets();
                return 0 === receiveSocketCount;
            },
            CAP,
            () => 'no receive socket counters (' + receiveSocketCount + ')',
        );

        await tests.drainUntil(
            () =>
                CountersReader.NULL_COUNTER_ID ===
                countersReader.findByTypeIdAndRegistrationId(
                    AeronCounters.DRIVER_RECEIVE_CHANNEL_STATUS_TYPE_ID,
                    registrationId,
                ),
            CAP,
            () => 'no receive channel status counter',
        );
    });
});
