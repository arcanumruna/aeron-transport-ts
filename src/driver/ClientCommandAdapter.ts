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
// Port of io/aeron/driver/ClientCommandAdapter.java @ 1.53.3
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { Action, type ControlledMessageHandler } from '../agrona/concurrent/ControlledMessageHandler.js';
import type { RingBuffer } from '../agrona/concurrent/ringbuffer/RingBuffer.js';
import { ChannelUri } from '../client/ChannelUri.js';
import { ControlProtocolEvents } from '../client/command/ControlProtocolEvents.js';
import { CorrelatedMessageFlyweight } from '../client/command/CorrelatedMessageFlyweight.js';
import { DestinationByIdMessageFlyweight } from '../client/command/DestinationByIdMessageFlyweight.js';
import { DestinationMessageFlyweight } from '../client/command/DestinationMessageFlyweight.js';
import { PublicationMessageFlyweight } from '../client/command/PublicationMessageFlyweight.js';
import { RejectImageFlyweight } from '../client/command/RejectImageFlyweight.js';
import { RemovePublicationFlyweight } from '../client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../client/command/RemoveSubscriptionFlyweight.js';
import { SubscriptionMessageFlyweight } from '../client/command/SubscriptionMessageFlyweight.js';
import { TerminateDriverFlyweight } from '../client/command/TerminateDriverFlyweight.js';
import { CommonContext } from '../client/CommonContext.js';
import { ErrorCode } from '../client/ErrorCode.js';
import { ControlProtocolException } from '../client/exceptions/ControlProtocolException.js';
import { StorageSpaceException } from '../client/exceptions/StorageSpaceException.js';
import type { ClientProxy } from './ClientProxy.js';
import type { DriverConductor } from './DriverConductor.js';
import { Configuration } from './Configuration.js';

const {
    ADD_DESTINATION,
    ADD_EXCLUSIVE_PUBLICATION,
    ADD_PUBLICATION,
    ADD_RCV_DESTINATION,
    ADD_SUBSCRIPTION,
    CLIENT_CLOSE,
    CLIENT_KEEPALIVE,
    REJECT_IMAGE,
    REMOVE_DESTINATION,
    REMOVE_DESTINATION_BY_ID,
    REMOVE_PUBLICATION,
    REMOVE_RCV_DESTINATION,
    REMOVE_SUBSCRIPTION,
    TERMINATE_DRIVER,
} = ControlProtocolEvents;
const { IPC_CHANNEL } = CommonContext;
const { SPY_QUALIFIER } = ChannelUri;
const { GENERIC_ERROR, STORAGE_SPACE } = ErrorCode;

/**
 * Receives commands from Aeron clients and dispatches them to the {@link DriverConductor} for processing.
 * <p>
 * Not ported: the `ADD_COUNTER`, `REMOVE_COUNTER`, `ADD_STATIC_COUNTER` and `GET_NEXT_AVAILABLE_SESSION_ID` commands
 * (plan decision 8, spec section 3): they take the default branch and get an `UNKNOWN_COMMAND_TYPE_ID` error response.
 */
export class ClientCommandAdapter implements ControlledMessageHandler {
    private readonly publicationMsgFlyweight = new PublicationMessageFlyweight();
    private readonly subscriptionMsgFlyweight = new SubscriptionMessageFlyweight();
    private readonly correlatedMsgFlyweight = new CorrelatedMessageFlyweight();
    private readonly removePublicationFlyweight = new RemovePublicationFlyweight();
    private readonly removeSubscriptionFlyweight = new RemoveSubscriptionFlyweight();
    private readonly destinationMsgFlyweight = new DestinationMessageFlyweight();
    private readonly terminateDriverFlyweight = new TerminateDriverFlyweight();
    private readonly rejectImageFlyweight = new RejectImageFlyweight();
    private readonly destinationByIdMessageFlyweight = new DestinationByIdMessageFlyweight();
    private readonly conductor: DriverConductor;
    private readonly toDriverCommands: RingBuffer;
    private readonly clientProxy: ClientProxy;
    private readonly errorHandler: ErrorHandler;

    public constructor(
        errorHandler: ErrorHandler,
        toDriverCommands: RingBuffer,
        clientProxy: ClientProxy,
        driverConductor: DriverConductor,
    ) {
        this.errorHandler = errorHandler;
        this.toDriverCommands = toDriverCommands;
        this.clientProxy = clientProxy;
        this.conductor = driverConductor;
    }

    public receive(): number {
        return this.toDriverCommands.controlledRead(this, Configuration.COMMAND_DRAIN_LIMIT);
    }

    public onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number, length: number): Action {
        // DriverLog.logCmd: the logging agents are out of scope (spec section 3)

        let correlationId = 0;

        if (this.conductor.notAcceptingClientCommands()) {
            return Action.ABORT;
        }

        try {
            switch (msgTypeId) {
                case ADD_PUBLICATION: {
                    this.publicationMsgFlyweight.wrap(buffer, index);
                    this.publicationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.publicationMsgFlyweight.correlationId();
                    this.addPublication(correlationId, false);
                    break;
                }

                case REMOVE_PUBLICATION: {
                    this.removePublicationFlyweight.wrap(buffer, index);
                    // Not in Java (spec D41): a message shorter than the registration id would be read past its end
                    this.removePublicationFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.removePublicationFlyweight.correlationId();
                    this.conductor.onRemovePublication(
                        this.removePublicationFlyweight.registrationId(),
                        correlationId,
                        this.removePublicationFlyweight.revoke(length),
                    );
                    break;
                }

                case ADD_EXCLUSIVE_PUBLICATION: {
                    this.publicationMsgFlyweight.wrap(buffer, index);
                    this.publicationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.publicationMsgFlyweight.correlationId();
                    this.addPublication(correlationId, true);
                    break;
                }

                case ADD_SUBSCRIPTION: {
                    this.subscriptionMsgFlyweight.wrap(buffer, index);
                    this.subscriptionMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.subscriptionMsgFlyweight.correlationId();
                    const clientId = this.subscriptionMsgFlyweight.clientId();
                    const streamId = this.subscriptionMsgFlyweight.streamId();
                    const channel = this.subscriptionMsgFlyweight.channel();

                    if (channel.startsWith(IPC_CHANNEL)) {
                        this.conductor.onAddIpcSubscription(channel, streamId, correlationId, clientId);
                    } else if (channel.startsWith(SPY_QUALIFIER)) {
                        this.conductor.onAddSpySubscription(channel, streamId, correlationId, clientId);
                    } else {
                        this.conductor.onAddNetworkSubscription(channel, streamId, correlationId, clientId);
                    }
                    break;
                }

                case REMOVE_SUBSCRIPTION: {
                    this.removeSubscriptionFlyweight.wrap(buffer, index);
                    this.removeSubscriptionFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.removeSubscriptionFlyweight.correlationId();
                    this.conductor.onRemoveSubscription(
                        this.removeSubscriptionFlyweight.registrationId(),
                        correlationId,
                    );
                    break;
                }

                case ADD_DESTINATION: {
                    this.destinationMsgFlyweight.wrap(buffer, index);
                    this.destinationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.destinationMsgFlyweight.correlationId();
                    const channelRegistrationId = this.destinationMsgFlyweight.registrationCorrelationId();
                    const channel = this.destinationMsgFlyweight.channel();

                    this.conductor.onAddSendDestination(channelRegistrationId, channel, correlationId);
                    break;
                }

                case REMOVE_DESTINATION: {
                    this.destinationMsgFlyweight.wrap(buffer, index);
                    this.destinationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.destinationMsgFlyweight.correlationId();
                    const channelRegistrationId = this.destinationMsgFlyweight.registrationCorrelationId();
                    const channel = this.destinationMsgFlyweight.channel();

                    this.conductor.onRemoveSendDestination(channelRegistrationId, channel, correlationId);
                    break;
                }

                case CLIENT_KEEPALIVE: {
                    this.correlatedMsgFlyweight.wrap(buffer, index);
                    this.correlatedMsgFlyweight.validateLength(msgTypeId, length);

                    this.conductor.onClientKeepalive(this.correlatedMsgFlyweight.clientId());
                    break;
                }

                case CLIENT_CLOSE: {
                    this.correlatedMsgFlyweight.wrap(buffer, index);
                    this.correlatedMsgFlyweight.validateLength(msgTypeId, length);

                    this.conductor.onClientClose(this.correlatedMsgFlyweight.clientId());
                    break;
                }

                case ADD_RCV_DESTINATION: {
                    this.destinationMsgFlyweight.wrap(buffer, index);
                    this.destinationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.destinationMsgFlyweight.correlationId();
                    const channelRegistrationId = this.destinationMsgFlyweight.registrationCorrelationId();
                    const channel = this.destinationMsgFlyweight.channel();

                    this.conductor.onAddRcvDestination(channelRegistrationId, channel, correlationId);
                    break;
                }

                case REMOVE_RCV_DESTINATION: {
                    this.destinationMsgFlyweight.wrap(buffer, index);
                    this.destinationMsgFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.destinationMsgFlyweight.correlationId();
                    const channelRegistrationId = this.destinationMsgFlyweight.registrationCorrelationId();
                    const channel = this.destinationMsgFlyweight.channel();

                    this.conductor.onRemoveRcvDestination(channelRegistrationId, channel, correlationId);
                    break;
                }

                case TERMINATE_DRIVER: {
                    this.terminateDriverFlyweight.wrap(buffer, index);
                    this.terminateDriverFlyweight.validateLength(msgTypeId, length);

                    // Java passes the offset relative to the message, without `index`, so the token is read from the
                    // wrong place for a message that does not start at 0 (spec D44)
                    this.conductor.onTerminateDriver(
                        buffer,
                        index + this.terminateDriverFlyweight.tokenBufferOffset(),
                        this.terminateDriverFlyweight.tokenBufferLength(),
                    );
                    break;
                }

                case REJECT_IMAGE: {
                    this.rejectImageFlyweight.wrap(buffer, index);
                    this.rejectImageFlyweight.validateLength(msgTypeId, length);
                    correlationId = this.rejectImageFlyweight.correlationId();

                    this.conductor.onRejectImage(
                        correlationId,
                        this.rejectImageFlyweight.imageCorrelationId(),
                        this.rejectImageFlyweight.position(),
                        this.rejectImageFlyweight.reason(),
                    );
                    break;
                }

                case REMOVE_DESTINATION_BY_ID: {
                    this.destinationByIdMessageFlyweight.wrap(buffer, index);
                    this.destinationByIdMessageFlyweight.validateLength(msgTypeId, length);

                    correlationId = this.destinationByIdMessageFlyweight.correlationId();
                    this.conductor.onRemoveSendDestination(
                        this.destinationByIdMessageFlyweight.resourceRegistrationId(),
                        this.destinationByIdMessageFlyweight.destinationRegistrationId(),
                        correlationId,
                    );

                    break;
                }

                default: {
                    const ex = new ControlProtocolException(
                        ErrorCode.UNKNOWN_COMMAND_TYPE_ID,
                        'command typeId=' + msgTypeId,
                    );

                    this.onError(correlationId, ex);
                }
            }
        } catch (ex) {
            this.onError(correlationId, ex instanceof Error ? ex : new Error(String(ex)));
        }

        return Action.CONTINUE;
    }

    private addPublication(correlationId: number, isExclusive: boolean): void {
        const clientId = this.publicationMsgFlyweight.clientId();
        const streamId = this.publicationMsgFlyweight.streamId();
        const channel = this.publicationMsgFlyweight.channel();

        if (channel.startsWith(IPC_CHANNEL)) {
            this.conductor.onAddIpcPublication(channel, streamId, correlationId, clientId, isExclusive);
        } else {
            this.conductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, isExclusive);
        }
    }

    public onError(correlationId: number, error: Error): void {
        if (error instanceof ControlProtocolException) {
            if (ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE !== error.errorCode()) {
                this.errorHandler.onError(error);
            }
            this.clientProxy.onError(correlationId, error.errorCode(), error.message);
        } else {
            this.errorHandler.onError(error);
            if (StorageSpaceException.isStorageSpaceError(error)) {
                this.clientProxy.onError(correlationId, STORAGE_SPACE, error.message);
            } else {
                // error.getClass().getName(): the simple class name (spec D10)
                const errorMessage = error.name + ' : ' + error.message;
                this.clientProxy.onError(correlationId, GENERIC_ERROR, errorMessage);
            }
        }
    }
}
