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
// Port of io/aeron/driver/UntetheredSubscription.java @ 1.53.3
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import type { SubscriptionLink } from './SubscriptionLink.js';

/**
 * The state of an untethered subscription: the nested Java enum `UntetheredSubscription.State`, a class with one
 * `static readonly` instance per constant, also reachable as `UntetheredSubscription.State`.
 */
export class UntetheredSubscriptionState {
    private static nextOrdinal = 0;

    public static readonly ACTIVE: UntetheredSubscriptionState = new UntetheredSubscriptionState('ACTIVE');
    public static readonly LINGER: UntetheredSubscriptionState = new UntetheredSubscriptionState('LINGER');
    public static readonly RESTING: UntetheredSubscriptionState = new UntetheredSubscriptionState('RESTING');

    private readonly _name: string;
    private readonly _ordinal: number;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = UntetheredSubscriptionState.nextOrdinal++;
    }

    public static values(): UntetheredSubscriptionState[] {
        return [
            UntetheredSubscriptionState.ACTIVE,
            UntetheredSubscriptionState.LINGER,
            UntetheredSubscriptionState.RESTING,
        ];
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

const { ACTIVE } = UntetheredSubscriptionState;

/**
 * A tether-less subscription of a stream, which is moved on when it falls behind (task T18 and the publications and
 * images use it). The field `state` of Java is read with `state()`, as the method of the same name changes it.
 */
export class UntetheredSubscription {
    /** The nested enum `UntetheredSubscription.State`. */
    public static readonly State = UntetheredSubscriptionState;

    private _state: UntetheredSubscriptionState = ACTIVE;
    public timeOfLastUpdateNs: number;
    public readonly subscriptionLink: SubscriptionLink;
    public readonly position: ReadablePosition;

    public constructor(subscriptionLink: SubscriptionLink, position: ReadablePosition, timeNs: number) {
        this.subscriptionLink = subscriptionLink;
        this.position = position;
        this.timeOfLastUpdateNs = timeNs;
    }

    /**
     * The state of the subscription.
     *
     * @return the state.
     */
    public state(): UntetheredSubscriptionState;
    /**
     * Change the state of the subscription.
     *
     * @param newState to change to.
     * @param nowNs    time of the change.
     * @param streamId of the subscribed stream, for the log.
     * @param sessionId of the subscribed stream, for the log.
     */
    public state(newState: UntetheredSubscriptionState, nowNs: number, streamId: number, sessionId: number): void;
    public state(
        newState?: UntetheredSubscriptionState,
        nowNs?: number,
        _streamId?: number,
        _sessionId?: number,
    ): UntetheredSubscriptionState | void {
        if (undefined === newState) {
            return this._state;
        }

        // DriverLog.logUntetheredSubscriptionStateChange: the logging agents are out of scope (spec section 3)
        this._state = newState;
        this.timeOfLastUpdateNs = nowNs as number;
    }
}
