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
// Port of io/aeron/driver/SenderProxy.java @ 1.53.3
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { ChannelUri } from '../client/ChannelUri.js';
import { CommandProxy } from './CommandProxy.js';
import type { Runnable } from './CommandProxy.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { NetworkPublication } from './NetworkPublication.js';
import type { Sender } from './Sender.js';
import type { SendChannelEndpoint } from './media/SendChannelEndpoint.js';

/**
 * Proxy for offering into the Sender Thread's command queue. A command is a closure (Java: a `Runnable`); the
 * conductor makes one per command, which is the control plane and not a per-message path.
 */
export class SenderProxy extends CommandProxy {
    private _sender: Sender | null = null;

    public constructor(commandQueue: OneToOneConcurrentArrayQueue<Runnable>, failCount: AtomicCounter) {
        super(commandQueue, failCount);
    }

    public sender(sender: Sender): void {
        this._sender = sender;
    }

    public registerSendChannelEndpoint(channelEndpoint: SendChannelEndpoint): void {
        // DriverLog.logSendChannelCreation(...): the logging agents are out of scope (spec section 3)
        this.offer(() => (this._sender as Sender).onRegisterSendChannelEndpoint(channelEndpoint));
    }

    public closeSendChannelEndpoint(channelEndpoint: SendChannelEndpoint): void {
        // DriverLog.logSendChannelClose(...): out of scope
        this.offer(() => (this._sender as Sender).onCloseSendChannelEndpoint(channelEndpoint));
    }

    public removeNetworkPublication(publication: NetworkPublication): void {
        this.offer(() => (this._sender as Sender).onRemoveNetworkPublication(publication));
    }

    public newNetworkPublication(publication: NetworkPublication): void {
        this.offer(() => (this._sender as Sender).onNewNetworkPublication(publication));
    }

    public addDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUri: ChannelUri,
        address: InetSocketAddress,
        registrationId: number,
    ): void {
        this.offer(() =>
            (this._sender as Sender).onAddDestination(channelEndpoint, channelUri, address, registrationId),
        );
    }

    public removeDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUri: ChannelUri,
        address: InetSocketAddress,
    ): void;

    public removeDestination(channelEndpoint: SendChannelEndpoint, destinationRegistrationId: number): void;

    public removeDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUriOrRegistrationId: ChannelUri | number,
        address?: InetSocketAddress,
    ): void {
        if (typeof channelUriOrRegistrationId === 'number') {
            this.offer(() => (this._sender as Sender).onRemoveDestination(channelEndpoint, channelUriOrRegistrationId));
        } else {
            this.offer(() =>
                (this._sender as Sender).onRemoveDestination(
                    channelEndpoint,
                    channelUriOrRegistrationId,
                    address as InetSocketAddress,
                ),
            );
        }
    }

    public onResolutionChange(
        channelEndpoint: SendChannelEndpoint,
        endpoint: string,
        newAddress: InetSocketAddress,
    ): void {
        this.offer(() => (this._sender as Sender).onResolutionChange(channelEndpoint, endpoint, newAddress));
    }
}
