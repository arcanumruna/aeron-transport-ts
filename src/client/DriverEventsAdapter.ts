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
// Port of io/aeron/DriverEventsAdapter.java @ 1.53.3
import type { CopyBroadcastReceiver } from '../agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { MessageHandler } from '../agrona/concurrent/MessageHandler.js';
import type { LongHashSet } from '../agrona/collections/LongHashSet.js';
import { IllegalStateException } from '../agrona/jdk.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import type { ClientConductor } from './ClientConductor.js';
import { ClientTimeoutFlyweight } from './command/ClientTimeoutFlyweight.js';
import { ControlProtocolEvents } from './command/ControlProtocolEvents.js';
import { ErrorResponseFlyweight } from './command/ErrorResponseFlyweight.js';
import { ImageBuffersReadyFlyweight } from './command/ImageBuffersReadyFlyweight.js';
import { ImageMessageFlyweight } from './command/ImageMessageFlyweight.js';
import { OperationSucceededFlyweight } from './command/OperationSucceededFlyweight.js';
import { PublicationBuffersReadyFlyweight } from './command/PublicationBuffersReadyFlyweight.js';
import { PublicationErrorFrameFlyweight } from './command/PublicationErrorFrameFlyweight.js';
import { SubscriptionReadyFlyweight } from './command/SubscriptionReadyFlyweight.js';
import { ErrorCode } from './ErrorCode.js';
import { NULL_VALUE } from './NullValue.js';

const {
    ON_ERROR,
    ON_AVAILABLE_IMAGE,
    ON_PUBLICATION_READY,
    ON_SUBSCRIPTION_READY,
    ON_OPERATION_SUCCESS,
    ON_UNAVAILABLE_IMAGE,
    ON_EXCLUSIVE_PUBLICATION_READY,
    ON_CLIENT_TIMEOUT,
    ON_PUBLICATION_ERROR,
} = ControlProtocolEvents;
const { CHANNEL_ENDPOINT_ERROR } = ErrorCode;

/**
 * Analogue of the {@link DriverProxy} on the client side for dispatching driver events to the {@link ClientConductor}.
 * <p>
 * The responses to the counter commands and to `nextAvailableSessionId` (`ON_COUNTER_READY`, `ON_UNAVAILABLE_COUNTER`,
 * `ON_STATIC_COUNTER`, `ON_NEXT_AVAILABLE_SESSION_ID`) are not ported: the driver never sends them (spec D40, D95), so
 * a message of one of those types is ignored, as Java ignores a type it does not know.
 */
export class DriverEventsAdapter implements MessageHandler {
    private readonly errorResponse = new ErrorResponseFlyweight();
    private readonly publicationErrorFrame = new PublicationErrorFrameFlyweight();
    private readonly publicationReady = new PublicationBuffersReadyFlyweight();
    private readonly subscriptionReady = new SubscriptionReadyFlyweight();
    private readonly imageReady = new ImageBuffersReadyFlyweight();
    private readonly operationSucceeded = new OperationSucceededFlyweight();
    private readonly imageMessage = new ImageMessageFlyweight();
    private readonly clientTimeout = new ClientTimeoutFlyweight();
    private readonly receiver: CopyBroadcastReceiver;
    private readonly conductor: ClientConductor;
    private readonly asyncCommandIdSet: LongHashSet;
    private readonly _clientId: number;
    private activeCorrelationId = 0;
    private _receivedCorrelationId = 0;
    private _isInvalid = false;

    /** @internal package-private in Java */
    public constructor(
        clientId: number,
        receiver: CopyBroadcastReceiver,
        conductor: ClientConductor,
        asyncCommandIdSet: LongHashSet,
    ) {
        this._clientId = clientId;
        this.receiver = receiver;
        this.conductor = conductor;
        this.asyncCommandIdSet = asyncCommandIdSet;
    }

    /** @internal package-private in Java */
    public receive(activeCorrelationId: number): number {
        this.activeCorrelationId = activeCorrelationId;
        this._receivedCorrelationId = NULL_VALUE;

        try {
            return this.receiver.receive(this);
        } catch (ex) {
            if (ex instanceof IllegalStateException) {
                this._isInvalid = true;
            }
            throw ex;
        }
    }

    /** @internal package-private in Java */
    public receivedCorrelationId(): number {
        return this._receivedCorrelationId;
    }

    /** @internal package-private in Java */
    public isInvalid(): boolean {
        return this._isInvalid;
    }

    /** @internal package-private in Java */
    public clientId(): number {
        return this._clientId;
    }

    public onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number, _length: number): void {
        switch (msgTypeId) {
            case ON_ERROR: {
                this.errorResponse.wrap(buffer, index);

                const correlationId = this.errorResponse.offendingCommandCorrelationId();
                const errorCodeValue = this.errorResponse.errorCodeValue();
                const errorCode = ErrorCode.get(errorCodeValue);
                let notProcessed = true;

                if (CHANNEL_ENDPOINT_ERROR === errorCode) {
                    // This code is left for backwards compatibility with older media driver versions
                    notProcessed = false;
                    this.conductor.onChannelEndpointError(correlationId, this.errorResponse.errorMessage());
                } else if (correlationId === this.activeCorrelationId) {
                    notProcessed = false;
                    this._receivedCorrelationId = correlationId;
                    this.conductor.onError(correlationId, errorCodeValue, errorCode, this.errorResponse.errorMessage());
                }

                if (this.asyncCommandIdSet.remove(correlationId) && notProcessed) {
                    this.conductor.onAsyncError(
                        correlationId,
                        errorCodeValue,
                        errorCode,
                        this.errorResponse.errorMessage(),
                    );
                }
                break;
            }

            case ON_AVAILABLE_IMAGE: {
                this.imageReady.wrap(buffer, index);

                this.conductor.onAvailableImage(
                    this.imageReady.correlationId(),
                    this.imageReady.sessionId(),
                    this.imageReady.subscriptionRegistrationId(),
                    this.imageReady.subscriberPositionId(),
                    this.imageReady.logFileName(),
                    this.imageReady.sourceIdentity(),
                );
                break;
            }

            case ON_PUBLICATION_READY: {
                this.publicationReady.wrap(buffer, index);

                const correlationId = this.publicationReady.correlationId();
                if (correlationId === this.activeCorrelationId || this.asyncCommandIdSet.remove(correlationId)) {
                    this._receivedCorrelationId = correlationId;
                    this.conductor.onNewPublication(
                        correlationId,
                        this.publicationReady.registrationId(),
                        this.publicationReady.streamId(),
                        this.publicationReady.sessionId(),
                        this.publicationReady.publicationLimitCounterId(),
                        this.publicationReady.channelStatusCounterId(),
                        this.publicationReady.logFileName(),
                    );
                }
                break;
            }

            case ON_SUBSCRIPTION_READY: {
                this.subscriptionReady.wrap(buffer, index);

                const correlationId = this.subscriptionReady.correlationId();
                if (correlationId === this.activeCorrelationId || this.asyncCommandIdSet.remove(correlationId)) {
                    this._receivedCorrelationId = correlationId;
                    this.conductor.onNewSubscription(correlationId, this.subscriptionReady.channelStatusCounterId());
                }
                break;
            }

            case ON_OPERATION_SUCCESS: {
                this.operationSucceeded.wrap(buffer, index);

                const correlationId = this.operationSucceeded.correlationId();
                this.asyncCommandIdSet.remove(correlationId);
                if (correlationId === this.activeCorrelationId) {
                    this._receivedCorrelationId = correlationId;
                }
                break;
            }

            case ON_UNAVAILABLE_IMAGE: {
                this.imageMessage.wrap(buffer, index);

                this.conductor.onUnavailableImage(
                    this.imageMessage.correlationId(),
                    this.imageMessage.subscriptionRegistrationId(),
                );
                break;
            }

            case ON_EXCLUSIVE_PUBLICATION_READY: {
                this.publicationReady.wrap(buffer, index);

                const correlationId = this.publicationReady.correlationId();
                if (correlationId === this.activeCorrelationId || this.asyncCommandIdSet.remove(correlationId)) {
                    this._receivedCorrelationId = correlationId;
                    this.conductor.onNewExclusivePublication(
                        correlationId,
                        this.publicationReady.registrationId(),
                        this.publicationReady.streamId(),
                        this.publicationReady.sessionId(),
                        this.publicationReady.publicationLimitCounterId(),
                        this.publicationReady.channelStatusCounterId(),
                        this.publicationReady.logFileName(),
                    );
                }
                break;
            }

            case ON_CLIENT_TIMEOUT: {
                this.clientTimeout.wrap(buffer, index);

                if (this.clientTimeout.clientId() === this._clientId) {
                    this.conductor.onClientTimeout();
                }
                break;
            }

            case ON_PUBLICATION_ERROR: {
                this.publicationErrorFrame.wrap(buffer, index);

                this.conductor.onPublicationError(this.publicationErrorFrame);
                break;
            }
        }
    }
}
