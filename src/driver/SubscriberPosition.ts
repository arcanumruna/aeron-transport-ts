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
// Port of io/aeron/driver/SubscriberPosition.java @ 1.53.3
import type { Position } from '../agrona/concurrent/status/Position.js';
import type { PublicationImage } from './PublicationImage.js';
import type { Subscribable } from './Subscribable.js';
import type { SubscriptionLink } from './SubscriptionLink.js';

/**
 * A subscription's position on a {@link Subscribable}: the link of the subscription, what it subscribes to and the
 * counter that holds how far it has consumed.
 *
 * @internal package-private in Java
 */
export class SubscriberPosition {
    private readonly subscriptionLink: SubscriptionLink;
    private readonly subscribable: Subscribable | null;
    private readonly _position: Position;

    public constructor(subscriptionLink: SubscriptionLink, subscribable: Subscribable | null, position: Position) {
        this.subscriptionLink = subscriptionLink;
        this.subscribable = subscribable;
        this._position = position;
    }

    public position(): Position {
        return this._position;
    }

    public positionCounterId(): number {
        return this.position().id();
    }

    public subscription(): SubscriptionLink {
        return this.subscriptionLink;
    }

    public addLink(image: PublicationImage): void {
        this.subscriptionLink.link(image, this._position);
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return (
            'SubscriberPosition{subscriptionLink=' +
            this.subscriptionLink +
            ', subscribable=' +
            this.subscribable +
            ', position=' +
            this._position +
            '}'
        );
    }
}
