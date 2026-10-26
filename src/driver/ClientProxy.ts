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
// Port of io/aeron/driver/ClientProxy.java @ 1.53.3
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { ExpandableArrayBuffer } from '../agrona/ExpandableArrayBuffer.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import type { BroadcastTransmitter } from '../agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { Aeron } from '../client/Aeron.js';
import { ClientTimeoutFlyweight } from '../client/command/ClientTimeoutFlyweight.js';
import { ControlProtocolEvents } from '../client/command/ControlProtocolEvents.js';
import { ErrorResponseFlyweight } from '../client/command/ErrorResponseFlyweight.js';
import { ImageBuffersReadyFlyweight } from '../client/command/ImageBuffersReadyFlyweight.js';
import { ImageMessageFlyweight } from '../client/command/ImageMessageFlyweight.js';
import { OperationSucceededFlyweight } from '../client/command/OperationSucceededFlyweight.js';
import { PublicationBuffersReadyFlyweight } from '../client/command/PublicationBuffersReadyFlyweight.js';
import { PublicationErrorFrameFlyweight } from '../client/command/PublicationErrorFrameFlyweight.js';
import { SubscriptionReadyFlyweight } from '../client/command/SubscriptionReadyFlyweight.js';
import { ErrorCode } from '../client/ErrorCode.js';
import type { InetSocketAddress } from './jdkNet.js';

const {
    ON_AVAILABLE_IMAGE,
    ON_CLIENT_TIMEOUT,
    ON_ERROR,
    ON_EXCLUSIVE_PUBLICATION_READY,
    ON_OPERATION_SUCCESS,
    ON_PUBLICATION_ERROR,
    ON_PUBLICATION_READY,
    ON_SUBSCRIPTION_READY,
    ON_UNAVAILABLE_IMAGE,
} = ControlProtocolEvents;

/**
 * Proxy for communicating from the driver to the client conductor.
 * <p>
 * The counter responses (`onCounterReady`, `onStaticCounter`, `onUnavailableCounter`) and
 * `onNextAvailableSessionId` are not ported (plan decision 8, spec section 3; `docs/mapping.md`, "Not ported").
 */
export class ClientProxy {
    private readonly buffer: MutableDirectBuffer = new ExpandableArrayBuffer(1024);
    private readonly transmitter: BroadcastTransmitter;

    private readonly errorResponse = new ErrorResponseFlyweight();
    private readonly publicationErrorFrame = new PublicationErrorFrameFlyweight();
    private readonly publicationReady = new PublicationBuffersReadyFlyweight();
    private readonly subscriptionReady = new SubscriptionReadyFlyweight();
    private readonly imageReady = new ImageBuffersReadyFlyweight();
    private readonly operationSucceededFlyweight = new OperationSucceededFlyweight();
    private readonly imageMessage = new ImageMessageFlyweight();
    private readonly clientTimeout = new ClientTimeoutFlyweight();

    public constructor(transmitter: BroadcastTransmitter) {
        this.transmitter = transmitter;

        this.errorResponse.wrap(this.buffer, 0);
        this.publicationErrorFrame.wrap(this.buffer, 0);
        this.imageReady.wrap(this.buffer, 0);
        this.publicationReady.wrap(this.buffer, 0);
        this.subscriptionReady.wrap(this.buffer, 0);
        this.operationSucceededFlyweight.wrap(this.buffer, 0);
        this.imageMessage.wrap(this.buffer, 0);
        this.clientTimeout.wrap(this.buffer, 0);
    }

    public onError(correlationId: number, errorCode: ErrorCode, errorMessage: string): void {
        this.errorResponse.offendingCommandCorrelationId(correlationId).errorCode(errorCode).errorMessage(errorMessage);

        this.transmit(ON_ERROR, this.buffer, 0, this.errorResponse.length());
    }

    /**
     * `receiverId` and `groupTag` are the 64-bit wire values as `bigint`s, as the `ErrorFlyweight` returns them
     * (spec D33); a `null` group tag is sent as `Aeron.NULL_VALUE`.
     */
    public onPublicationErrorFrame(
        registrationId: number,
        destinationRegistrationId: number,
        sessionId: number,
        streamId: number,
        receiverId: bigint,
        groupTag: bigint | null,
        srcAddress: InetSocketAddress,
        errorCode: number,
        errorMessage: string,
    ): void {
        this.publicationErrorFrame
            .registrationId(registrationId)
            .destinationRegistrationId(destinationRegistrationId)
            .sessionId(sessionId)
            .streamId(streamId)
            .receiverId(receiverId)
            .groupTag(null === groupTag ? BigInt(Aeron.NULL_VALUE) : groupTag)
            .sourceAddress(srcAddress)
            .errorCode(ErrorCode.get(errorCode))
            .errorMessage(errorMessage);

        this.transmit(ON_PUBLICATION_ERROR, this.buffer, 0, this.publicationErrorFrame.length());
    }

    public onAvailableImage(
        correlationId: number,
        streamId: number,
        sessionId: number,
        subscriptionRegistrationId: number,
        positionCounterId: number,
        logFileName: string,
        sourceIdentity: string,
    ): void {
        this.imageReady
            .correlationId(correlationId)
            .sessionId(sessionId)
            .streamId(streamId)
            .subscriptionRegistrationId(subscriptionRegistrationId)
            .subscriberPositionId(positionCounterId)
            .logFileName(logFileName)
            .sourceIdentity(sourceIdentity);

        this.transmit(ON_AVAILABLE_IMAGE, this.buffer, 0, this.imageReady.length());
    }

    public onPublicationReady(
        correlationId: number,
        registrationId: number,
        streamId: number,
        sessionId: number,
        logFileName: string,
        positionCounterId: number,
        channelStatusCounterId: number,
        isExclusive: boolean,
    ): void {
        this.publicationReady
            .correlationId(correlationId)
            .registrationId(registrationId)
            .sessionId(sessionId)
            .streamId(streamId)
            .publicationLimitCounterId(positionCounterId)
            .channelStatusCounterId(channelStatusCounterId)
            .logFileName(logFileName);

        const msgTypeId = isExclusive ? ON_EXCLUSIVE_PUBLICATION_READY : ON_PUBLICATION_READY;
        this.transmit(msgTypeId, this.buffer, 0, this.publicationReady.length());
    }

    public onSubscriptionReady(correlationId: number, channelStatusCounterId: number): void {
        this.subscriptionReady.correlationId(correlationId).channelStatusCounterId(channelStatusCounterId);

        this.transmit(ON_SUBSCRIPTION_READY, this.buffer, 0, SubscriptionReadyFlyweight.LENGTH);
    }

    public operationSucceeded(correlationId: number): void {
        this.operationSucceededFlyweight.correlationId(correlationId);

        this.transmit(ON_OPERATION_SUCCESS, this.buffer, 0, OperationSucceededFlyweight.LENGTH);
    }

    public onUnavailableImage(
        correlationId: number,
        subscriptionRegistrationId: number,
        streamId: number,
        channel: string,
    ): void {
        this.imageMessage
            .correlationId(correlationId)
            .subscriptionRegistrationId(subscriptionRegistrationId)
            .streamId(streamId)
            .channel(channel);

        this.transmit(ON_UNAVAILABLE_IMAGE, this.buffer, 0, this.imageMessage.length());
    }

    public onClientTimeout(clientId: number): void {
        this.clientTimeout.clientId(clientId);

        this.transmit(ON_CLIENT_TIMEOUT, this.buffer, 0, ClientTimeoutFlyweight.LENGTH);
    }

    private transmit(msgTypeId: number, buffer: DirectBuffer, index: number, length: number): void {
        // DriverLog.logCmd: the logging agents are out of scope (spec section 3)
        this.transmitter.transmit(msgTypeId, buffer, index, length);
    }

    public toString(): string {
        return 'ClientProxy{}';
    }
}
