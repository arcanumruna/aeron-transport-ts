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
// Port of io/aeron/driver/ReceiverProxy.java @ 1.53.3
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { CommandProxy } from './CommandProxy.js';
import type { Runnable } from './CommandProxy.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { PublicationImage } from './PublicationImage.js';
import type { Receiver } from './Receiver.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from './media/ReceiveDestinationTransport.js';
import type { UdpChannel } from './media/UdpChannel.js';

/**
 * Proxy for offering into the Receiver Thread's command queue. A command is a closure (Java: a `Runnable`); the
 * conductor makes one per command, which is the control plane and not a per-message path.
 * <p>
 * The overloads of Java that differ by the session id (`addSubscription` and `removeSubscription`) are one method with
 * an optional `sessionId`.
 *
 * @internal package-private in Java
 */
export class ReceiverProxy extends CommandProxy {
    private _receiver: Receiver | null = null;

    public constructor(commandQueue: OneToOneConcurrentArrayQueue<Runnable>, failCount: AtomicCounter) {
        super(commandQueue, failCount);
    }

    public receiver(): Receiver | null;
    public receiver(receiver: Receiver): void;
    public receiver(receiver?: Receiver): Receiver | null | void {
        if (undefined === receiver) {
            return this._receiver;
        }

        this._receiver = receiver;
    }

    public addSubscription(mediaEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId?: number): void {
        if (undefined === sessionId) {
            this.offer(() => (this._receiver as Receiver).onAddSubscription(mediaEndpoint, streamId));
        } else {
            this.offer(() => (this._receiver as Receiver).onAddSubscription(mediaEndpoint, streamId, sessionId));
        }
    }

    public removeSubscription(mediaEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId?: number): void {
        if (undefined === sessionId) {
            this.offer(() => (this._receiver as Receiver).onRemoveSubscription(mediaEndpoint, streamId));
        } else {
            this.offer(() => (this._receiver as Receiver).onRemoveSubscription(mediaEndpoint, streamId, sessionId));
        }
    }

    public newPublicationImage(channelEndpoint: ReceiveChannelEndpoint, image: PublicationImage): void {
        this.offer(() => (this._receiver as Receiver).onNewPublicationImage(channelEndpoint, image));
    }

    public registerReceiveChannelEndpoint(channelEndpoint: ReceiveChannelEndpoint): void {
        // DriverLog.logReceiveChannelCreation(...): the logging agents are out of scope (spec section 3)
        this.offer(() => (this._receiver as Receiver).onRegisterReceiveChannelEndpoint(channelEndpoint));
    }

    public closeReceiveChannelEndpoint(channelEndpoint: ReceiveChannelEndpoint): void {
        // DriverLog.logReceiveChannelClose(...): out of scope
        this.offer(() => (this._receiver as Receiver).onCloseReceiveChannelEndpoint(channelEndpoint));
    }

    public removeCoolDown(channelEndpoint: ReceiveChannelEndpoint, sessionId: number, streamId: number): void {
        this.offer(() => (this._receiver as Receiver).onRemoveCoolDown(channelEndpoint, sessionId, streamId));
    }

    public removeInitInProgress(channelEndpoint: ReceiveChannelEndpoint, sessionId: number, streamId: number): void {
        this.offer(() => (this._receiver as Receiver).onRemoveInitInProgress(channelEndpoint, sessionId, streamId));
    }

    public addDestination(channelEndpoint: ReceiveChannelEndpoint, transport: ReceiveDestinationTransport): void {
        this.offer(() => (this._receiver as Receiver).onAddDestination(channelEndpoint, transport));
    }

    public removeDestination(channelEndpoint: ReceiveChannelEndpoint, udpChannel: UdpChannel): void {
        this.offer(() => (this._receiver as Receiver).onRemoveDestination(channelEndpoint, udpChannel));
    }

    public onResolutionChange(
        channelEndpoint: ReceiveChannelEndpoint,
        udpChannel: UdpChannel,
        newAddress: InetSocketAddress,
    ): void {
        this.offer(() => (this._receiver as Receiver).onResolutionChange(channelEndpoint, udpChannel, newAddress));
    }

    public requestSetup(channelEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId: number): void {
        this.offer(() => (this._receiver as Receiver).onRequestSetup(channelEndpoint, streamId, sessionId));
    }

    /**
     * Reject an image. The correlation id and the position are `number`s (spec D5, 5.2).
     */
    public rejectImage(imageCorrelationId: number, position: number, reason: string): void {
        this.offer(() => (this._receiver as Receiver).onRejectImage(imageCorrelationId, position, reason));
    }
}
