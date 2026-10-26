// Extra tests of phase 3, T9 (port-only, D115): the tests of `MultiDestinationCastTest` whose third subscription is an
// `aeron-spy` subscription (not ported, spec section 3) without that subscription, so that the dynamic and manual MDC cases
// they cover (a dynamic MDC publication with two group subscriptions on two drivers and on one, a manual MDC publication
// whose destination is removed by registration id) are still run end to end. The values are those of Java's tests.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { FragmentRecorder } from '../support/FragmentRecorder.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestClient } from '../support/SystemTests.js';

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
const MS = 1_000_000;
const CAP = 200_000;

describe('MultiDestinationCastWithoutSpy', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(MESSAGE_LENGTH));
    let tests: SystemTests;
    let clientA: TestClient;
    let clientB: TestClient;

    function launch(name: string, imageLivenessTimeoutNs?: number): void {
        tests = systemTests(name, true);
        buffer.putInt(0, 1);
        const configure = (context: MediaDriver.Context): void => {
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH);
            if (undefined !== imageLivenessTimeoutNs) {
                context.imageLivenessTimeoutNs(imageLivenessTimeoutNs);
            }
        };
        clientA = tests.launch(configure).clients[0] as TestClient;
        clientB = tests.launch(configure).clients[0] as TestClient;
    }

    async function pollForFragment(subscription: Subscription, recorder: FragmentRecorder): Promise<void> {
        let total = 0;
        await tests.executeUntil(
            () => total >= 1,
            () => {
                total += subscription.poll(recorder, 10);
            },
            0x7fffffff,
            10_000 * MS,
        );
    }

    function offer(publication: Publication): Promise<void> {
        return tests.drainUntil(
            () => publication.offer(buffer, 0, buffer.capacity()) >= 0,
            CAP,
            () => 'a window to offer into',
        );
    }

    it('shouldSpinUpAndShutdownWithDynamic', async () => {
        launch('shouldSpinUpAndShutdownWithDynamic');

        clientA.aeron.addPublication(PUB_MDC_DYNAMIC_URI, STREAM_ID);
        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_DYNAMIC_URI, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(SUB2_MDC_DYNAMIC_URI, STREAM_ID);

        await tests.drainUntil(
            () => !(subscriptionA.hasNoImages() || subscriptionB.hasNoImages()),
            CAP,
            () => 'images of both subscriptions',
        );
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSpinUpAndShutdownWithManual', async () => {
        launch('shouldSpinUpAndShutdownWithManual', 1000 * MS);

        const taggedMdcUri = new ChannelUriStringBuilder(PUB_MDC_MANUAL_URI)
            .tags(clientA.aeron.nextCorrelationId(), clientA.aeron.nextCorrelationId())
            .build();

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_MANUAL_URI, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(SUB2_MDC_MANUAL_URI, STREAM_ID);

        const publication = clientA.aeron.addPublication(taggedMdcUri, STREAM_ID) as Publication;
        publication.addDestination(SUB1_MDC_MANUAL_URI);
        const correlationId = publication.asyncAddDestination(SUB2_MDC_MANUAL_URI);

        await tests.drainUntil(
            () => !(subscriptionA.hasNoImages() || subscriptionB.hasNoImages()),
            CAP,
            () => 'images of both subscriptions',
        );

        expect(clientA.aeron.isCommandActive(correlationId)).toBe(false);

        const removeCorrelationId = publication.asyncRemoveDestination(SUB2_MDC_MANUAL_URI);
        await tests.drainUntil(
            () => !clientA.aeron.isCommandActive(removeCorrelationId),
            CAP,
            () => 'Remove Active',
        );
        await tests.drainUntil(
            () => subscriptionB.hasNoImages(),
            CAP,
            () => 'Subscription disconnect',
        );
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToTwoPortsWithDynamic', async () => {
        const numMessagesToSend = MESSAGES_PER_TERM * 3;
        launch('shouldSendToTwoPortsWithDynamic');

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_DYNAMIC_URI, STREAM_ID);
        const subscriptionB = clientB.aeron.addSubscription(SUB2_MDC_DYNAMIC_URI, STREAM_ID);
        const publication = clientA.aeron.addPublication(PUB_MDC_DYNAMIC_URI, STREAM_ID) as Publication;

        await tests.drainUntil(
            () => !(subscriptionA.hasNoImages() || subscriptionB.hasNoImages()),
            CAP,
            () => 'images of both subscriptions',
        );

        const handlerA = new FragmentRecorder();
        const handlerB = new FragmentRecorder();
        for (let i = 0; i < numMessagesToSend; i++) {
            await offer(publication);

            await pollForFragment(subscriptionA, handlerA);
            await pollForFragment(subscriptionB, handlerB);
        }

        expect(handlerA.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
        expect(handlerB.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldSendToTwoPortsWithDynamicSingleDriver', async () => {
        const numMessagesToSend = MESSAGES_PER_TERM * 3;
        launch('shouldSendToTwoPortsWithDynamicSingleDriver');

        const subscriptionA = clientA.aeron.addSubscription(SUB1_MDC_DYNAMIC_URI, STREAM_ID);
        const subscriptionB = clientA.aeron.addSubscription(SUB2_MDC_DYNAMIC_URI, STREAM_ID);
        const publication = clientA.aeron.addPublication(PUB_MDC_DYNAMIC_URI, STREAM_ID) as Publication;

        await tests.drainUntil(
            () => subscriptionA.isConnected() && subscriptionB.isConnected(),
            CAP,
            () => 'connected subscriptions',
        );

        const handlerA = new FragmentRecorder();
        const handlerB = new FragmentRecorder();
        for (let i = 0; i < numMessagesToSend; i++) {
            await offer(publication);

            await pollForFragment(subscriptionA, handlerA);
            await pollForFragment(subscriptionB, handlerB);
        }

        expect(handlerA.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
        expect(handlerB.count(MESSAGE_LENGTH)).toBe(numMessagesToSend);
        expect(tests.errors()).toEqual([]);
    });
});
