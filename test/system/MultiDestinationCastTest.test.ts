// Port of aeron-system-tests/src/test/java/io/aeron/MultiDestinationCastTest.java @ 1.53.3 (phase 3, T9, D115).
// The clock is manual (one turn is 1 ms): the image liveness timeouts and the 500 ms to 2 s observation windows of Java are
// turns. The tests whose third subscription is an `aeron-spy` subscription are skipped (spy subscriptions are not ported,
// spec section 3); `MultiDestinationCastWithoutSpyExtraTest` runs them without that subscription.
import { describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { CountingFragmentHandler } from '../support/CountingFragmentHandler.js';
import { FragmentRecorder } from '../support/FragmentRecorder.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestClient, TestNode } from '../support/SystemTests.js';

const PUB_MDC_DYNAMIC_URI = 'aeron:udp?control=localhost:24325|control-mode=dynamic|fc=min';
const SUB1_MDC_DYNAMIC_URI = 'aeron:udp?control=localhost:24325|group=true';
const SUB2_MDC_DYNAMIC_URI = 'aeron:udp?control=localhost:24325|group=true';

const PUB_MDC_MANUAL_URI = 'aeron:udp?control-mode=manual';
const SUB1_MDC_MANUAL_URI = 'aeron:udp?endpoint=localhost:24326|group=true';
const SUB2_MDC_MANUAL_URI = 'aeron:udp?endpoint=localhost:24327|group=true';

const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const MESSAGES_PER_TERM = 64;
const MESSAGE_LENGTH = TERM_BUFFER_LENGTH / MESSAGES_PER_TERM - DataHeaderFlyweight.HEADER_LENGTH;
const FRAGMENT_LIMIT = 10;

const MS = 1_000_000;
/** The cap, in turns, of the loops that Java leaves to `@InterruptAfter`. */
const CAP = 200_000;

describe('MultiDestinationCastTest', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));

    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;
    let clientA: TestClient;
    let clientB: TestClient;
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

    function launch(errorHandler: ErrorHandler | null = null): void {
        buffer.putInt(0, 1);

        driverA = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH);
            if (null !== errorHandler) {
                context.errorHandler(errorHandler);
            }
            for (const set of driverAConfig) {
                set(context);
            }
        });
        driverB = tests.launch((context) => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH);
            if (null !== errorHandler) {
                context.errorHandler(errorHandler);
            }
            for (const set of driverBConfig) {
                set(context);
            }
        });
        clientA = driverA.clients[0] as TestClient;
        clientB = driverB.clients[0] as TestClient;
    }

    /** `Tests.yield()` */
    async function yieldTurn(): Promise<void> {
        tests.cycle();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    /** `while (pub.offer(buffer, 0, length) < 0L) Tests.yield();` */
    function offerMessage(pub: Publication, length: number): Promise<void> {
        return tests.drainUntil(
            () => pub.offer(buffer, 0, length) >= 0,
            CAP,
            () => 'a window for ' + length + ' bytes in ' + pub,
        );
    }

    /** `pollForFragment(subscription, handler)`: polls until a fragment is read, for at most 10 s, and does not fail. */
    async function pollForFragment(subscription: Subscription, handler: FragmentHandler): Promise<void> {
        let totalFragments = 0;
        await tests.executeUntil(
            () => totalFragments >= 1,
            () => {
                totalFragments += subscription.poll(handler, FRAGMENT_LIMIT);
            },
            0x7fffffff,
            10_000 * MS,
        );
    }

    /** `assertNoFragmentsReceived(subscription, noMessageTimeout)` */
    async function assertNoFragmentsReceived(subscription: Subscription, noMessageTimeoutMs: number): Promise<void> {
        for (let t = 0; t < noMessageTimeoutMs; t++) {
            expect(subscription.poll({ onFragment: () => {} }, 10)).toBe(0);
            await yieldTurn();
        }
    }

    function verifyFragments(fragmentHandler: FragmentRecorder, numMessagesToSend: number): void {
        expect(fragmentHandler.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
    }

    // The third subscription of the next four tests is `aeron-spy:` + the publication's channel: spy subscriptions are not
    // ported (spec section 3).
    it.skip('shouldSpinUpAndShutdownWithDynamic', () => {});

    it.skip('shouldSpinUpAndShutdownWithManual', () => {});

    it.skip('shouldSendToTwoPortsWithDynamic', () => {});

    it('shouldSubscribeWithSessionId', async () => {
        begin('shouldSubscribeWithSessionId');
        const numMessagesToSend = MESSAGES_PER_TERM * 3;

        launch();

        const sessionId = '|session-id=' + BitUtil.generateRandomisedId();
        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_DYNAMIC_URI + sessionId, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(SUB2_MDC_DYNAMIC_URI + sessionId, STREAM_ID);
        const publication = clientA.aeron.addPublication(PUB_MDC_DYNAMIC_URI + sessionId, STREAM_ID) as Publication;

        await tests.drainUntil(
            () => !(subscriptionA.hasNoImages() || subscriptionB.hasNoImages()),
            CAP,
            () => 'images of both subscriptions',
        );

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publication, buffer.capacity());

            await pollForFragment(subscriptionA, fragmentHandlerA);
            await pollForFragment(subscriptionB, fragmentHandlerB);
        }

        verifyFragments(fragmentHandlerA, numMessagesToSend);
        verifyFragments(fragmentHandlerB, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it.skip('shouldSendToTwoPortsWithDynamicSingleDriver', () => {});

    it('shouldSendToTwoPortsWithManualSingleDriver', async () => {
        begin('shouldSendToTwoPortsWithManualSingleDriver');
        const numMessagesToSend = MESSAGES_PER_TERM * 3;

        launch();

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const subscriptionB = clientA.aeron.addSubscription(SUB2_MDC_MANUAL_URI, STREAM_ID);

        const publication = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        publication.addDestination(SUB1_MDC_MANUAL_URI);
        publication.addDestination(SUB2_MDC_MANUAL_URI);

        await tests.drainUntil(
            () => subscriptionA.isConnected() && subscriptionB.isConnected(),
            CAP,
            () => 'connected subscriptions',
        );

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publication, MESSAGE_LENGTH);

            await pollForFragment(subscriptionA, fragmentHandlerA);
            await pollForFragment(subscriptionB, fragmentHandlerB);
        }

        verifyFragments(fragmentHandlerA, numMessagesToSend);
        verifyFragments(fragmentHandlerB, numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('addDestinationWithSpySubscriptionsShouldFailWithRegistrationException', () => {
        begin('addDestinationWithSpySubscriptionsShouldFailWithRegistrationException');
        const mockErrorHandler: ErrorHandler = { onError: vi.fn() };
        launch(mockErrorHandler);

        const publication = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        let registrationException: unknown = null;
        try {
            publication.addDestination('aeron-spy:' + PUB_MDC_DYNAMIC_URI);
        } catch (ex) {
            registrationException = ex;
        }

        expect(registrationException).toBeInstanceOf(RegistrationException);
        expect((registrationException as RegistrationException).message).toContain('spies are invalid');
        // `testWatcher.ignoreErrorsMatching(s -> s.contains("spies are invalid"))`
    });

    it('shouldManuallyRemovePortDuringActiveStream', async () => {
        begin('shouldManuallyRemovePortDuringActiveStream');
        const numMessagesToSend = MESSAGES_PER_TERM * 3;
        const numMessageForSub2 = 10;
        let unavailableImage = false;

        driverBConfig.push((context) => context.imageLivenessTimeoutNs(500 * MS));

        launch();

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(SUB2_MDC_MANUAL_URI, STREAM_ID, null, {
            onUnavailableImage: () => void (unavailableImage = true),
        });

        const publication = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        publication.addDestination(SUB1_MDC_MANUAL_URI);
        publication.addDestination(SUB2_MDC_MANUAL_URI);

        await tests.drainUntil(
            () => subscriptionA.isConnected() && subscriptionB.isConnected(),
            CAP,
            () => 'connected subscriptions',
        );

        for (let i = 0; i < numMessagesToSend; i++) {
            await offerMessage(publication, MESSAGE_LENGTH);

            await pollForFragment(subscriptionA, fragmentHandlerA);

            if (i < numMessageForSub2) {
                await pollForFragment(subscriptionB, fragmentHandlerB);
            } else if (0 === subscriptionB.poll(fragmentHandlerB, FRAGMENT_LIMIT)) {
                await yieldTurn();
            }

            if (i === numMessageForSub2 - 1) {
                publication.removeDestination(SUB2_MDC_MANUAL_URI);
            }
        }

        await tests.drainUntil(
            () => unavailableImage,
            CAP,
            () => 'an unavailable image of subscription B',
        );

        verifyFragments(fragmentHandlerA, numMessagesToSend);
        verifyFragments(fragmentHandlerB, numMessageForSub2);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldManuallyAddPortDuringActiveStream', async () => {
        begin('shouldManuallyAddPortDuringActiveStream');
        const numMessagesToSend = MESSAGES_PER_TERM * 3;
        const numMessageForSub2 = 10;
        const countingA = new CountingFragmentHandler('fragmentHandlerA');
        const countingB = new CountingFragmentHandler('fragmentHandlerB');
        let availableImage = false;
        let position = 0;
        let messagesSent = 0;
        const positionSupplier = (): string => 'Failed to publish, position: ' + position + ', sent: ' + messagesSent;

        launch();

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(
            SUB2_MDC_MANUAL_URI,
            STREAM_ID,
            { onAvailableImage: () => void (availableImage = true) },
            null,
        );

        const publication = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        publication.addDestination(SUB1_MDC_MANUAL_URI);

        await tests.awaitConnected(subscriptionA);

        for (let iteration = 0; messagesSent < numMessagesToSend; iteration++) {
            if (iteration > CAP) {
                throw new Error('no progress: ' + positionSupplier());
            }

            position = publication.offer(buffer, 0, MESSAGE_LENGTH);

            if (0 <= position) {
                messagesSent++;
            } else {
                await yieldTurn();
            }

            subscriptionA.poll(countingA, FRAGMENT_LIMIT);

            if (messagesSent > numMessagesToSend - numMessageForSub2) {
                subscriptionB.poll(countingB, FRAGMENT_LIMIT);
            }

            if (messagesSent === numMessagesToSend - numMessageForSub2) {
                const published = messagesSent;
                // If we add B before A has reached `published` number of messages
                // then B will receive more than the expected `numMessageForSub2`.
                for (let wait = 0; countingA.notDone(published); wait++) {
                    if (wait > CAP) {
                        throw new Error('A did not read ' + published + ': ' + countingA);
                    }
                    if (subscriptionA.poll(countingA, FRAGMENT_LIMIT) <= 0) {
                        await yieldTurn();
                    }
                }

                publication.addDestination(SUB2_MDC_MANUAL_URI);
                await tests.drainUntil(
                    () => availableImage,
                    CAP,
                    () => 'an available image of subscription B',
                );
            }
        }

        for (let wait = 0; countingA.notDone(numMessagesToSend) || countingB.notDone(numMessageForSub2); wait++) {
            if (wait > CAP) {
                throw new Error('not done: ' + countingA + ' ' + countingB);
            }

            if (countingA.notDone(numMessagesToSend) && subscriptionA.poll(countingA, FRAGMENT_LIMIT) <= 0) {
                await yieldTurn();
            }

            if (countingB.notDone(numMessageForSub2) && subscriptionB.poll(countingB, FRAGMENT_LIMIT) <= 0) {
                await yieldTurn();
            }
        }
        expect(tests.errors()).toEqual([]);
    });

    // The subscription is an `aeron-spy` subscription of the publication's tag: spy subscriptions are not ported.
    it.skip('shouldSpyOnDynamicMdcConnectionWithWildcardPortUsingTags', () => {});

    it('shouldHandleSubscriptionsIfUsingTagsAndEndpointsMatchButSessionIdInUse', async () => {
        begin('shouldHandleSubscriptionsIfUsingTagsAndEndpointsMatchButSessionIdInUse');
        launch();

        const pub1 = clientA.aeron.addExclusivePublication(PUB_MDC_DYNAMIC_URI, STREAM_ID) as Publication;
        const pub2 = clientA.aeron.addExclusivePublication(PUB_MDC_DYNAMIC_URI, STREAM_ID) as Publication;

        const sub1Uri = new ChannelUriStringBuilder(SUB1_MDC_DYNAMIC_URI)
            .endpoint('127.0.0.1:0')
            .tags('1001')
            .sessionId(pub1.sessionId())
            .build();

        const sub2Uri = new ChannelUriStringBuilder(SUB1_MDC_DYNAMIC_URI)
            .endpoint('127.0.0.1:0')
            .tags('1001')
            .sessionId(pub2.sessionId())
            .build();

        const sub1 = clientB.aeron.addSubscription(sub1Uri, STREAM_ID);
        const sub2 = clientB.aeron.addSubscription(sub2Uri, STREAM_ID);
        await tests.awaitConnected(sub1);
        await tests.awaitConnected(sub2);
        await tests.awaitConnected(pub1);
        await tests.awaitConnected(pub2);

        await offerMessage(pub1, buffer.capacity());

        await offerMessage(pub2, buffer.capacity());

        let sub1Count = 0;
        let sub2Count = 0;
        // `while (System.currentTimeMillis() - nowMs < 500L)`
        for (let t = 0; t < 500; t++) {
            sub1Count += sub1.poll({ onFragment: () => {} }, 10);
            sub2Count += sub2.poll({ onFragment: () => {} }, 10);

            expect(sub1Count).toBeLessThan(2);
            expect(sub2Count).toBeLessThan(2);
            await yieldTurn();
        }
        expect(tests.errors()).toEqual([]);
    });

    it('shouldNotAllowMdcSubscriptionsWhenChannelHasControlButNotSpecifiedAsMdc', async () => {
        begin('shouldNotAllowMdcSubscriptionsWhenChannelHasControlButNotSpecifiedAsMdc');
        launch();

        const pub = clientA.aeron.addPublication(
            'aeron:udp?control=localhost:24325|endpoint=localhost:10000',
            STREAM_ID,
        ) as Publication;
        const subOk = clientA.aeron.addSubscription(
            'aeron:udp?control=localhost:24325|endpoint=localhost:10000',
            STREAM_ID,
        );
        const subWrong = clientA.aeron.addSubscription(
            'aeron:udp?control=localhost:24325|endpoint=localhost:10001',
            STREAM_ID,
        );

        await tests.awaitConnected(pub);
        await tests.awaitConnected(subOk);

        // `deadlineMs = now + 2_000`
        for (let t = 0; t < 2000; t++) {
            expect(subWrong.isConnected()).toBe(false);
            await yieldTurn();
        }
        expect(tests.errors()).toEqual([]);
    });

    it('shouldAllowMdcDestinationEndpointsToBeShared', async () => {
        begin('shouldAllowMdcDestinationEndpointsToBeShared');
        launch();

        const mdcA = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        const mdcB = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID + 1) as Publication;
        const subA = clientB.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const subB = clientB.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID + 1);

        mdcA.addDestination(SUB1_MDC_MANUAL_URI);
        mdcB.addDestination(SUB1_MDC_MANUAL_URI);
        await tests.awaitConnected(mdcA);
        await tests.awaitConnected(mdcB);
        await tests.awaitConnected(subA);
        await tests.awaitConnected(subB);

        await offerMessage(mdcA, buffer.capacity());

        await pollForFragment(subA, fragmentHandlerA);
        await assertNoFragmentsReceived(subB, 1_000);

        await offerMessage(mdcB, buffer.capacity());

        await pollForFragment(subB, fragmentHandlerA);
        await assertNoFragmentsReceived(subA, 1_000);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldRemoveDestinationUsingRegistrationId', async () => {
        begin('shouldRemoveDestinationUsingRegistrationId');
        driverAConfig.push((context) => context.imageLivenessTimeoutNs(1000 * MS));
        driverBConfig.push((context) => context.imageLivenessTimeoutNs(1000 * MS));

        launch();

        const mdc = clientA.aeron.addPublication(PUB_MDC_MANUAL_URI, STREAM_ID) as Publication;
        const sub1 = clientB.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const sub2 = clientB.aeron.addSubscription(SUB2_MDC_MANUAL_URI, STREAM_ID);

        const registrationId1 = mdc.asyncAddDestination(SUB1_MDC_MANUAL_URI);
        const registrationId2 = mdc.asyncAddDestination(SUB2_MDC_MANUAL_URI);
        await tests.drainUntil(
            () => !clientA.aeron.isCommandActive(registrationId2),
            CAP,
            () => 'the add of the second destination done',
        );

        await tests.drainUntil(
            () => mdc.isConnected() && sub1.isConnected() && sub2.isConnected(),
            CAP,
            () => 'Connections',
        );

        await offerMessage(mdc, buffer.capacity());

        await pollForFragment(sub1, fragmentHandlerA);
        await pollForFragment(sub2, fragmentHandlerB);

        mdc.removeDestination(registrationId2);

        await tests.drainUntil(
            () => !sub2.isConnected(),
            CAP,
            () => 'Disconnected',
        );

        await offerMessage(mdc, buffer.capacity());

        await pollForFragment(sub1, fragmentHandlerA);
        await assertNoFragmentsReceived(sub2, 1_000);

        const correlationId = mdc.asyncRemoveDestination(registrationId1);
        await tests.drainUntil(
            () => !clientA.aeron.isCommandActive(correlationId),
            CAP,
            () => 'Command Active',
        );
        await tests.drainUntil(
            () => !sub1.isConnected() && !mdc.isConnected(),
            CAP,
            () => 'Disconnected',
        );
        expect(tests.errors()).toEqual([]);
    });
});
