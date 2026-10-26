/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/DriverProxy.java @ 1.53.3
import type { RingBuffer } from '../agrona/concurrent/ringbuffer/RingBuffer.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { ControlProtocolEvents } from './command/ControlProtocolEvents.js';
import { CorrelatedMessageFlyweight } from './command/CorrelatedMessageFlyweight.js';
import { DestinationByIdMessageFlyweight } from './command/DestinationByIdMessageFlyweight.js';
import { DestinationMessageFlyweight } from './command/DestinationMessageFlyweight.js';
import { PublicationMessageFlyweight } from './command/PublicationMessageFlyweight.js';
import { RejectImageFlyweight } from './command/RejectImageFlyweight.js';
import { RemovePublicationFlyweight } from './command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from './command/RemoveSubscriptionFlyweight.js';
import { SubscriptionMessageFlyweight } from './command/SubscriptionMessageFlyweight.js';
import { TerminateDriverFlyweight } from './command/TerminateDriverFlyweight.js';
import { AeronException } from './exceptions/AeronException.js';
import { NULL_VALUE } from './NullValue.js';

const {
    ADD_PUBLICATION,
    ADD_EXCLUSIVE_PUBLICATION,
    REMOVE_PUBLICATION,
    ADD_SUBSCRIPTION,
    REMOVE_SUBSCRIPTION,
    ADD_DESTINATION,
    REMOVE_DESTINATION,
    REMOVE_DESTINATION_BY_ID,
    ADD_RCV_DESTINATION,
    REMOVE_RCV_DESTINATION,
    CLIENT_CLOSE,
    TERMINATE_DRIVER,
    REJECT_IMAGE,
} = ControlProtocolEvents;

/**
 * Separates the concern of talking the media driver protocol over the to driver ring buffer.
 * <p>
 * The counter commands (`addCounter`, `addStaticCounter`, `removeCounter`) and `nextAvailableSessionId` are not
 * ported (spec D95). Where a command carries a channel, the correlation id is an optional last argument: the client
 * conductor allocates it ahead of the command when it has to wait for the host names of the channel to resolve
 * (spec D92); with none, the proxy allocates the next one, as Java does.
 */
export class DriverProxy {
    private readonly clientId: number;
    private readonly publicationMessageFlyweight = new PublicationMessageFlyweight();
    private readonly subscriptionMessageFlyweight = new SubscriptionMessageFlyweight();
    private readonly removePublicationFlyweight = new RemovePublicationFlyweight();
    private readonly removeSubscriptionFlyweight = new RemoveSubscriptionFlyweight();
    private readonly destinationMessageFlyweight = new DestinationMessageFlyweight();
    private readonly destinationByIdMessageFlyweight = new DestinationByIdMessageFlyweight();
    private readonly rejectImageFlyweight = new RejectImageFlyweight();
    private readonly toDriverCommandBuffer: RingBuffer;

    /**
     * Create a proxy to send commands to the driver.
     *
     * @param toDriverCommandBuffer to write the commands to.
     * @param clientId              of the client.
     */
    public constructor(toDriverCommandBuffer: RingBuffer, clientId: number) {
        this.toDriverCommandBuffer = toDriverCommandBuffer;
        this.clientId = clientId;
    }

    /**
     * Time of the last heartbeat of the driver, which it writes into the to driver ring buffer.
     *
     * @return time of the last heartbeat of the driver, in milliseconds.
     */
    public timeOfLastDriverKeepaliveMs(): number {
        return this.toDriverCommandBuffer.consumerHeartbeatTime();
    }

    public addPublication(channel: string, streamId: number, correlationId?: number): number {
        return this.addPublicationOf(ADD_PUBLICATION, channel, streamId, correlationId, 'add publication');
    }

    public addExclusivePublication(channel: string, streamId: number, correlationId?: number): number {
        return this.addPublicationOf(
            ADD_EXCLUSIVE_PUBLICATION,
            channel,
            streamId,
            correlationId,
            'add exclusive publication',
        );
    }

    private addPublicationOf(
        msgTypeId: number,
        channel: string,
        streamId: number,
        correlationIdOrUndefined: number | undefined,
        what: string,
    ): number {
        const correlationId = correlationIdOrUndefined ?? this.toDriverCommandBuffer.nextCorrelationId();
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

    public addSubscription(channel: string, streamId: number, correlationId?: number): number {
        const registrationId = NULL_VALUE;
        const id = correlationId ?? this.toDriverCommandBuffer.nextCorrelationId();
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
            .correlationId(id);

        this.toDriverCommandBuffer.commit(index);

        return id;
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

    public addDestination(registrationId: number, endpointChannel: string, correlationId?: number): number {
        return this.destinationCommand(
            ADD_DESTINATION,
            registrationId,
            endpointChannel,
            correlationId,
            'add destination',
        );
    }

    /**
     * Remove a destination of a publication by the channel of its endpoint, or (Java's second overload) by the
     * registration id that adding it returned.
     *
     * @param registrationId  of the publication.
     * @param destination     the channel of the endpoint, or the registration id of the destination.
     * @param correlationId   to give the command, when the channel has been resolved ahead (a channel only).
     * @return the correlation id of the command.
     */
    public removeDestination(registrationId: number, destination: string | number, correlationId?: number): number {
        if ('string' === typeof destination) {
            return this.destinationCommand(
                REMOVE_DESTINATION,
                registrationId,
                destination,
                correlationId,
                'remove destination',
            );
        }

        const id = this.toDriverCommandBuffer.nextCorrelationId();
        const index = this.toDriverCommandBuffer.tryClaim(
            REMOVE_DESTINATION_BY_ID,
            DestinationByIdMessageFlyweight.MESSAGE_LENGTH,
        );
        if (index < 0) {
            throw new AeronException('failed to write remove destination command');
        }

        this.destinationByIdMessageFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .resourceRegistrationId(registrationId)
            .destinationRegistrationId(destination)
            .clientId(this.clientId)
            .correlationId(id);

        this.toDriverCommandBuffer.commit(index);

        return id;
    }

    public addRcvDestination(registrationId: number, endpointChannel: string, correlationId?: number): number {
        return this.destinationCommand(
            ADD_RCV_DESTINATION,
            registrationId,
            endpointChannel,
            correlationId,
            'add rcv destination',
        );
    }

    public removeRcvDestination(registrationId: number, endpointChannel: string, correlationId?: number): number {
        return this.destinationCommand(
            REMOVE_RCV_DESTINATION,
            registrationId,
            endpointChannel,
            correlationId,
            'remove rcv destination',
        );
    }

    private destinationCommand(
        msgTypeId: number,
        registrationId: number,
        endpointChannel: string,
        correlationIdOrUndefined: number | undefined,
        what: string,
    ): number {
        const correlationId = correlationIdOrUndefined ?? this.toDriverCommandBuffer.nextCorrelationId();
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

    /**
     * Tell the driver that the client is closing, so that it can release its resources at once.
     */
    public clientClose(): void {
        const index = this.toDriverCommandBuffer.tryClaim(CLIENT_CLOSE, CorrelatedMessageFlyweight.LENGTH);
        if (index > 0) {
            new CorrelatedMessageFlyweight()
                .wrap(this.toDriverCommandBuffer.buffer(), index)
                .clientId(this.clientId)
                .correlationId(NULL_VALUE);

            this.toDriverCommandBuffer.commit(index);
        }
    }

    /**
     * Ask the driver to terminate.
     *
     * @param tokenBuffer containing the token that authorises the request.
     * @param tokenOffset within the buffer at which the token begins.
     * @param tokenLength of the token in bytes.
     * @return true if the command was written to the ring buffer.
     */
    public terminateDriver(tokenBuffer: DirectBuffer | null, tokenOffset: number, tokenLength: number): boolean {
        const length = TerminateDriverFlyweight.computeLength(tokenLength);
        const index = this.toDriverCommandBuffer.tryClaim(TERMINATE_DRIVER, length);
        if (index > 0) {
            new TerminateDriverFlyweight()
                .wrap(this.toDriverCommandBuffer.buffer(), index)
                .tokenBuffer(tokenBuffer, tokenOffset, tokenLength)
                .clientId(this.clientId)
                .correlationId(NULL_VALUE);

            this.toDriverCommandBuffer.commit(index);

            return true;
        }

        return false;
    }

    /**
     * Reject an image: ask the driver to stop it and tell the source why.
     *
     * @param imageCorrelationId of the image.
     * @param position           of the subscriber in the image at which the reason applies.
     * @param reason             for the rejection.
     * @return the correlation id of the command.
     */
    public rejectImage(imageCorrelationId: number, position: number, reason: string): number {
        const length = RejectImageFlyweight.computeLength(reason);
        const index = this.toDriverCommandBuffer.tryClaim(REJECT_IMAGE, length);
        if (index < 0) {
            throw new AeronException('failed to write reject image command');
        }

        const correlationId = this.toDriverCommandBuffer.nextCorrelationId();
        this.rejectImageFlyweight
            .wrap(this.toDriverCommandBuffer.buffer(), index)
            .clientId(this.clientId)
            .correlationId(correlationId)
            .imageCorrelationId(imageCorrelationId)
            .position(position)
            .reason(reason);

        this.toDriverCommandBuffer.commit(index);

        return correlationId;
    }

    public toString(): string {
        return 'DriverProxy{clientId=' + this.clientId + '}';
    }
}
