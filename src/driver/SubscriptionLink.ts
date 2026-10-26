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
// Port of io/aeron/driver/SubscriptionLink.java @ 1.53.3
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import type { InferableBoolean } from '../client/CommonContext.js';
import type { AeronClient } from './AeronClient.js';
import type { DriverConductor } from './DriverConductor.js';
import type { DriverManagedResource } from './DriverManagedResource.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { Subscribable } from './Subscribable.js';
import type { SubscriptionParams } from './SubscriptionParams.js';

/**
 * The members of a `NetworkPublication` (T15) or an `IpcPublication` (not ported) that
 * {@link SubscriptionLink.matchesNetworkPublication} and {@link SubscriptionLink.matchesIpcPublication} take.
 */
export interface SubscriptionLinkPublication {
    streamId(): number;
    sessionId(): number;
}

/**
 * The members of a `PublicationImage` (task T16) that {@link SubscriptionLink.matchesImage} takes.
 */
export interface SubscriptionLinkImage {
    channelEndpoint(): ReceiveChannelEndpoint;
    streamId(): number;
    sessionId(): number;
}

/**
 * Subscription registration from a client used for liveness tracking.
 * <p>
 * The `matches` overloads of Java, which differ by the type of the first argument, are `matchesNetworkPublication`,
 * `matchesImage`, `matchesIpcPublication`, `matchesParams` and `matchesSession` (spec D43). The fields that share
 * their name with an accessor are protected with a leading underscore (`_registrationId`, ...); use the accessor.
 */
export abstract class SubscriptionLink implements DriverManagedResource {
    protected readonly _registrationId: number = 0;
    protected readonly _streamId: number = 0;
    protected readonly _isSparse: boolean;
    protected readonly _isTether: boolean;
    protected readonly _isResponse: boolean;
    protected readonly _isRejoin: boolean;
    protected readonly _group: InferableBoolean;
    protected readonly _channel: string;
    protected readonly _aeronClient: AeronClient;
    /** Keyed by identity (Java: `IdentityHashMap`): a JS `Map` compares object keys by identity. */
    public readonly positionBySubscribableMap: Map<Subscribable, ReadablePosition>;
    protected _sessionId: number = 0;
    protected _hasSessionId: boolean;
    protected reachedEndOfLife = false;

    protected constructor(
        registrationId: number,
        streamId: number,
        channel: string,
        aeronClient: AeronClient,
        params: SubscriptionParams,
    ) {
        this._registrationId = registrationId;
        this._streamId = streamId;
        this._channel = channel;
        this._aeronClient = aeronClient;
        this._hasSessionId = params.hasSessionId;
        this._sessionId = params.sessionId;
        this._isSparse = params.isSparse;
        this._isTether = params.isTether;
        this._group = params.group;
        this._isResponse = params.isResponse;
        this._isRejoin = params.isRejoin;

        this.positionBySubscribableMap = new Map<Subscribable, ReadablePosition>();
    }

    /**
     * Channel URI the subscription is on.
     *
     * @return channel URI the subscription is on.
     */
    public channel(): string {
        return this._channel;
    }

    /**
     * Stream id the subscription is on.
     *
     * @return stream id the subscription is on.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Registration id of the subscription.
     *
     * @return registration id of the subscription.
     */
    public registrationId(): number {
        return this._registrationId;
    }

    public aeronClient(): AeronClient {
        return this._aeronClient;
    }

    public sessionId(): number;
    public sessionId(sessionId: number, hasSessionId: boolean): void;
    public sessionId(sessionId?: number, hasSessionId?: boolean): number | void {
        if (undefined === sessionId) {
            return this._sessionId;
        }

        this._hasSessionId = hasSessionId as boolean;
        this._sessionId = sessionId;
    }

    public isResponse(): boolean {
        return this._isResponse;
    }

    public channelEndpoint(): ReceiveChannelEndpoint | null {
        return null;
    }

    public isReliable(): boolean {
        return true;
    }

    public isRejoin(): boolean {
        return this._isRejoin;
    }

    public isTether(): boolean {
        return this._isTether;
    }

    public isSparse(): boolean {
        return this._isSparse;
    }

    public group(): InferableBoolean {
        return this._group;
    }

    public hasSessionId(): boolean {
        return this._hasSessionId;
    }

    public matchesNetworkPublication(_publication: SubscriptionLinkPublication): boolean {
        return false;
    }

    public matchesImage(_image: SubscriptionLinkImage): boolean {
        return false;
    }

    public matchesIpcPublication(_publication: SubscriptionLinkPublication): boolean {
        return false;
    }

    public matchesParams(
        _channelEndpoint: ReceiveChannelEndpoint,
        _streamId: number,
        _params: SubscriptionParams,
    ): boolean {
        return false;
    }

    public matchesSession(_channelEndpoint: ReceiveChannelEndpoint, _streamId: number, _sessionId: number): boolean {
        return false;
    }

    public isLinked(subscribable: Subscribable): boolean {
        return this.positionBySubscribableMap.has(subscribable);
    }

    public link(subscribable: Subscribable, position: ReadablePosition): void {
        this.positionBySubscribableMap.set(subscribable, position);
    }

    public unlink(subscribable: Subscribable): void {
        this.positionBySubscribableMap.delete(subscribable);
    }

    public isWildcardOrSessionIdMatch(sessionId: number): boolean {
        return (!this._hasSessionId && !this.isResponse()) || this._sessionId === sessionId;
    }

    public supportsMds(): boolean {
        return false;
    }

    public notifyUnavailableImages(conductor: DriverConductor): void {
        for (const subscribable of this.positionBySubscribableMap.keys()) {
            conductor.notifyUnavailableImageLink(subscribable.subscribableRegistrationId(), this);
        }
    }

    public close(): void {
        // Java removes while iterating the entry set of the map through the subscribable; the entries are copied first
        for (const [subscribable, position] of [...this.positionBySubscribableMap]) {
            subscribable.removeSubscriber(this, position);
        }
    }

    public onTimeEvent(_timeNs: number, _timeMs: number, conductor: DriverConductor): void {
        if (this._aeronClient.hasTimedOut()) {
            this.reachedEndOfLife = true;
            conductor.cleanupSubscriptionLink(this);
        }
    }

    public hasReachedEndOfLife(): boolean {
        return this.reachedEndOfLife;
    }

    public toString(): string {
        return (
            this.constructor.name +
            '{' +
            'registrationId=' +
            this._registrationId +
            ', streamId=' +
            this._streamId +
            ', sessionId=' +
            this._sessionId +
            ', hasSessionId=' +
            this._hasSessionId +
            ', isReliable=' +
            this.isReliable() +
            ', isSparse=' +
            this.isSparse() +
            ', isTether=' +
            this.isTether() +
            ', isRejoin=' +
            this.isRejoin() +
            ', reachedEndOfLife=' +
            this.reachedEndOfLife +
            ', group=' +
            this._group +
            ", channel='" +
            this._channel +
            "'" +
            ', aeronClient=' +
            this._aeronClient +
            ', positionBySubscribableMap=' +
            mapToString(this.positionBySubscribableMap) +
            '}'
        );
    }
}

/** `Map.toString()` of Java: `{k=v, k=v}`. */
function mapToString(map: Map<unknown, unknown>): string {
    const entries: string[] = [];
    for (const [key, value] of map) {
        entries.push(String(key) + '=' + String(value));
    }

    return '{' + entries.join(', ') + '}';
}
