// Extra tests of T19 (port-only, spec 4.3, D15, D93): the `Aeron` client connected to a `MediaDriver` of the same process
// (INVOKER), end to end on real UDP on the loopback and the default configuration of both: a publication and a
// subscription on a `aeron:udp?endpoint=localhost:<port>` channel, a message offered and polled, and what the client
// does when the publication goes away or the client closes. The duty cycles are driven with a hard cap (`EmbeddedRig`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { RegistrationException } from '../../../src/client/exceptions/RegistrationException.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';
import type { Image } from '../../../src/client/Image.js';
import type { Header } from '../../../src/client/logbuffer/Header.js';
import type { ConcurrentPublication } from '../../../src/client/ConcurrentPublication.js';
import type { Subscription } from '../../../src/client/Subscription.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';
import { freeUdpPort } from '../../support/Udp.js';

const STREAM_ID = 1001;

describe('Aeron embedded', () => {
    const rigs: EmbeddedRig[] = [];

    afterEach(() => {
        for (const rig of rigs.splice(0)) {
            rig.close();
        }
    });

    function newRig(manualClock = false): EmbeddedRig {
        const rig = new EmbeddedRig(manualClock);
        rigs.push(rig);
        return rig;
    }

    function newChannel(): string {
        return 'aeron:udp?endpoint=localhost:' + freeUdpPort();
    }

    /** Offer a message until the log takes it, driving the duty cycles in between (a publication can be back pressured). */
    async function offerMessage(rig: EmbeddedRig, publication: ConcurrentPublication, text: string): Promise<number> {
        const message = new UnsafeBuffer(Buffer.from(text, 'ascii'));
        let position = 0;
        await rig.until(() => {
            position = publication.offer(message, 0, message.capacity());
            return position > 0;
        }, 'accepted offer');
        return position;
    }

    function poll(subscription: Subscription, received: string[]): number {
        return subscription.poll(
            {
                onFragment(buffer: DirectBuffer, offset: number, length: number, _header: Header): void {
                    received.push(buffer.getStringWithoutLengthAscii(offset, length));
                },
            },
            10,
        );
    }

    it('aPublicationAndASubscriptionOnAUdpChannelCarryAMessageFromOfferToPoll', async () => {
        const rig = newRig();
        const channel = newChannel();

        const publication = rig.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
        const subscription = rig.aeron.addSubscription(channel, STREAM_ID);
        expect(publication.channel()).toBe(channel);
        expect(subscription.channel()).toBe(channel);

        await rig.until(() => publication.isConnected() && subscription.imageCount() === 1, 'connected stream');

        const position = await offerMessage(rig, publication, 'hello over udp');

        const received: string[] = [];
        await rig.until(() => {
            poll(subscription, received);
            return received.length > 0;
        }, 'message');

        expect(received).toEqual(['hello over udp']);
        expect(subscription.imageAtIndex(0).position()).toBe(position);
        expect(rig.errors).toEqual([]);
    });

    it('theAsyncVariantsOfAddGiveTheSameStreamAndReportTheirProgress', async () => {
        // a manual clock: the publication lingers for seconds of the clock after it is closed, in some thousand cycles
        const rig = newRig(true);
        const channel = newChannel();
        const available = vi.fn((_image: Image) => {});
        const unavailable = vi.fn((_image: Image) => {});

        const subscriptionId = rig.aeron.asyncAddSubscription(
            channel,
            STREAM_ID,
            { onAvailableImage: available },
            { onUnavailableImage: unavailable },
        );
        const publicationId = rig.aeron.asyncAddPublication(channel, STREAM_ID);
        expect(rig.aeron.isCommandActive(publicationId)).toBe(true);
        expect(rig.aeron.hasActiveCommands()).toBe(true);
        expect(rig.aeron.getPublication(publicationId)).toBeNull();

        await rig.until(
            () =>
                null !== rig.aeron.getPublication(publicationId) && null !== rig.aeron.getSubscription(subscriptionId),
            'both resources',
        );
        expect(rig.aeron.isCommandActive(publicationId)).toBe(false);

        const publication = rig.aeron.getPublication(publicationId) as ConcurrentPublication;
        const subscription = rig.aeron.getSubscription(subscriptionId) as Subscription;
        await rig.until(() => available.mock.calls.length === 1, 'available image');

        await offerMessage(rig, publication, 'async');
        const received: string[] = [];
        await rig.until(() => {
            poll(subscription, received);
            return received.length > 0;
        }, 'message');
        expect(received).toEqual(['async']);

        // closing the publication ends the stream: the image goes away and the handler is told
        publication.close();
        await rig.until(() => unavailable.mock.calls.length === 1, 'unavailable image');
        expect(subscription.hasNoImages()).toBe(true);
    });

    it('anInvalidChannelIsRefusedWithARegistrationExceptionAndTheClientGoesOn', () => {
        const rig = newRig();

        expect(() => rig.aeron.addPublication('aeron:ipc', STREAM_ID)).toThrow(RegistrationException);
        expect(() => rig.aeron.addSubscription('aeron:udp?endpoint=localhost:no-port', STREAM_ID)).toThrow(
            RegistrationException,
        );

        const publication = rig.aeron.addPublication(newChannel(), STREAM_ID);
        expect(publication).not.toBeNull();
    });

    it('closingTheClientClosesItsResourcesAndRefusesFurtherCalls', () => {
        const rig = newRig();
        const channel = newChannel();
        const closed = vi.fn();
        rig.aeron.addCloseHandler(closed);

        const publication = rig.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
        const subscription = rig.aeron.addSubscription(channel, STREAM_ID);

        rig.aeron.close();

        expect(rig.aeron.isClosed()).toBe(true);
        expect(closed).toHaveBeenCalledTimes(1);
        expect(publication.isClosed()).toBe(true);
        expect(subscription.isClosed()).toBe(true);
        expect(() => rig.aeron.addPublication(channel, STREAM_ID)).toThrow(AeronException);
        expect(() => rig.aeron.nextCorrelationId()).toThrow('client is closed');

        // closing again does nothing
        rig.aeron.close();
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('theClientNeedsTheDriverItConnectsTo', () => {
        expect(() => Aeron.connect(new Aeron.Context())).toThrow('needs the CnC of a driver');
    });
});
