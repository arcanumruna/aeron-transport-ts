// Stand-in for io/aeron/DriverProxy.java @ 1.53.3 (client side, ported by T19 as `src/client/DriverProxy.ts`): the
// publication, subscription and destination commands that `DriverConductorTest` writes to the driver's command ring.
// The counter commands are not ported (plan decision 8). T19 replaces this file with the real class.
import type { RingBuffer } from '../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { Aeron } from '../../src/client/Aeron.js';
import { ControlProtocolEvents } from '../../src/client/command/ControlProtocolEvents.js';
import { DestinationMessageFlyweight } from '../../src/client/command/DestinationMessageFlyweight.js';
import { PublicationMessageFlyweight } from '../../src/client/command/PublicationMessageFlyweight.js';
import { RemovePublicationFlyweight } from '../../src/client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../../src/client/command/RemoveSubscriptionFlyweight.js';
import { SubscriptionMessageFlyweight } from '../../src/client/command/SubscriptionMessageFlyweight.js';
import { AeronException } from '../../src/client/exceptions/AeronException.js';

const {
    ADD_PUBLICATION,
    ADD_EXCLUSIVE_PUBLICATION,
    REMOVE_PUBLICATION,
    ADD_SUBSCRIPTION,
    REMOVE_SUBSCRIPTION,
    ADD_DESTINATION,
    REMOVE_DESTINATION,
    ADD_RCV_DESTINATION,
    REMOVE_RCV_DESTINATION,
} = ControlProtocolEvents;

export class DriverProxy {
    private readonly clientId: number;
    private readonly publicationMessageFlyweight = new PublicationMessageFlyweight();
    private readonly subscriptionMessageFlyweight = new SubscriptionMessageFlyweight();
    private readonly removePublicationFlyweight = new RemovePublicationFlyweight();
    private readonly removeSubscriptionFlyweight = new RemoveSubscriptionFlyweight();
    private readonly destinationMessageFlyweight = new DestinationMessageFlyweight();
    private readonly toDriverCommandBuffer: RingBuffer;

    public constructor(toDriverCommandBuffer: RingBuffer, clientId: number) {
        this.toDriverCommandBuffer = toDriverCommandBuffer;
        this.clientId = clientId;
    }

    public addPublication(channel: string, streamId: number): number {
        return this.addPublicationOf(ADD_PUBLICATION, channel, streamId, 'add publication');
    }

    public addExclusivePublication(channel: string, streamId: number): number {
        return this.addPublicationOf(ADD_EXCLUSIVE_PUBLICATION, channel, streamId, 'add exclusive publication');
    }

    private addPublicationOf(msgTypeId: number, channel: string, streamId: number, what: string): number {
        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        const length = PublicationMessageFlyweight.computeLength(channel.length);
        const index = this.toDriverCommandBuffer.tryClaim(msgTypeId, length);
        if (index < 0) {
            throw new AeronException('failed to write ' + what + ' command');
        }

        this.publicationMessageFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .streamId(streamId)
            .channel(channel)
            .clientId(this.clientId)
            .correlationId(correlationId);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }

    public removePublication(registrationId: number, revoke: boolean): number {
        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        const index = this.toDriverCommandBuffer.tryClaim(REMOVE_PUBLICATION, RemovePublicationFlyweight.length());
        if (index < 0) {
            throw new AeronException('failed to write remove publication command');
        }

        this.removePublicationFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .revoke(revoke)
            .registrationId(registrationId)
            .clientId(this.clientId)
            .correlationId(correlationId);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }

    public addSubscription(channel: string, streamId: number): number {
        const registrationId = Aeron.NULL_VALUE;
        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        const length = SubscriptionMessageFlyweight.computeLength(channel.length);
        const index = this.toDriverCommandBuffer.tryClaim(ADD_SUBSCRIPTION, length);
        if (index < 0) {
            throw new AeronException('failed to write add subscription command');
        }

        this.subscriptionMessageFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .registrationCorrelationId(registrationId)
            .streamId(streamId)
            .channel(channel)
            .clientId(this.clientId)
            .correlationId(correlationId);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }

    public removeSubscription(registrationId: number): number {
        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        const index = this.toDriverCommandBuffer.tryClaim(REMOVE_SUBSCRIPTION, RemoveSubscriptionFlyweight.length());
        if (index < 0) {
            throw new AeronException('failed to write remove subscription command');
        }

        this.removeSubscriptionFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .registrationId(registrationId)
            .clientId(this.clientId)
            .correlationId(correlationId);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }

    public addDestination(registrationId: number, endpointChannel: string): number {
        return this.destinationCommand(ADD_DESTINATION, registrationId, endpointChannel, 'add destination');
    }

    public removeDestination(registrationId: number, endpointChannel: string): number {
        return this.destinationCommand(REMOVE_DESTINATION, registrationId, endpointChannel, 'remove destination');
    }

    public addRcvDestination(registrationId: number, endpointChannel: string): number {
        return this.destinationCommand(ADD_RCV_DESTINATION, registrationId, endpointChannel, 'add rcv destination');
    }

    public removeRcvDestination(registrationId: number, endpointChannel: string): number {
        return this.destinationCommand(
            REMOVE_RCV_DESTINATION,
            registrationId,
            endpointChannel,
            'remove rcv destination',
        );
    }

    private destinationCommand(
        msgTypeId: number,
        registrationId: number,
        endpointChannel: string,
        what: string,
    ): number {
        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        const length = DestinationMessageFlyweight.computeLength(endpointChannel.length);
        const index = this.toDriverCommandBuffer.tryClaim(msgTypeId, length);
        if (index < 0) {
            throw new AeronException('failed to write ' + what + ' command');
        }

        this.destinationMessageFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .registrationCorrelationId(registrationId)
            .channel(endpointChannel)
            .clientId(this.clientId)
            .correlationId(correlationId);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }
}
