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
// Port of io/aeron/driver/NetworkSubscriptionLink.java @ 1.53.3
import type { AeronClient } from './AeronClient.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import { SubscriptionLink, type SubscriptionLinkImage } from './SubscriptionLink.js';
import type { SubscriptionParams } from './SubscriptionParams.js';

/**
 * The state of the setup of a response channel: the nested Java enum `NetworkSubscriptionLink.ResponseSetupState`, a
 * class with one `static readonly` instance per constant, also reachable as
 * `NetworkSubscriptionLink.ResponseSetupState`.
 */
export class ResponseSetupState {
    private static nextOrdinal = 0;

    public static readonly PENDING: ResponseSetupState = new ResponseSetupState('PENDING');
    public static readonly COMPLETE: ResponseSetupState = new ResponseSetupState('COMPLETE');
    public static readonly ERROR: ResponseSetupState = new ResponseSetupState('ERROR');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = ResponseSetupState.nextOrdinal++;
    }

    public static values(): ResponseSetupState[] {
        return [ResponseSetupState.PENDING, ResponseSetupState.COMPLETE, ResponseSetupState.ERROR];
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }
}

export class NetworkSubscriptionLink extends SubscriptionLink {
    /** The nested enum `NetworkSubscriptionLink.ResponseSetupState`. */
    public static readonly ResponseSetupState = ResponseSetupState;

    private readonly _isReliable: boolean;
    private readonly _channelEndpoint: ReceiveChannelEndpoint;
    private _responseSetupState: ResponseSetupState = ResponseSetupState.PENDING;

    public constructor(
        registrationId: number,
        channelEndpoint: ReceiveChannelEndpoint,
        streamId: number,
        channelUri: string,
        aeronClient: AeronClient,
        params: SubscriptionParams,
    ) {
        super(registrationId, streamId, channelUri, aeronClient, params);

        this._isReliable = params.isReliable;
        this._channelEndpoint = channelEndpoint;
    }

    public responseSetupState(): ResponseSetupState;
    public responseSetupState(state: ResponseSetupState): void;
    public responseSetupState(state?: ResponseSetupState): ResponseSetupState | void {
        if (undefined === state) {
            return this._responseSetupState;
        }

        this._responseSetupState = state;
    }

    public override isReliable(): boolean {
        return this._isReliable;
    }

    public override channelEndpoint(): ReceiveChannelEndpoint {
        return this._channelEndpoint;
    }

    public override matchesImage(image: SubscriptionLinkImage): boolean {
        return (
            image.channelEndpoint() === this._channelEndpoint &&
            image.streamId() === this._streamId &&
            this.isWildcardOrSessionIdMatch(image.sessionId())
        );
    }

    public override matchesParams(
        channelEndpoint: ReceiveChannelEndpoint,
        streamId: number,
        params: SubscriptionParams,
    ): boolean {
        return (
            channelEndpoint === this._channelEndpoint &&
            streamId === this._streamId &&
            this._hasSessionId === params.hasSessionId &&
            this.isWildcardOrSessionIdMatch(params.sessionId)
        );
    }

    public override matchesSession(
        channelEndpoint: ReceiveChannelEndpoint,
        streamId: number,
        sessionId: number,
    ): boolean {
        return (
            channelEndpoint === this._channelEndpoint &&
            streamId === this._streamId &&
            this.isWildcardOrSessionIdMatch(sessionId)
        );
    }

    public override supportsMds(): boolean {
        return this._channelEndpoint.hasDestinationControl();
    }
}
