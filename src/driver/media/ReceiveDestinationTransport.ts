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
// Port of io/aeron/driver/media/ReceiveDestinationTransport.java @ 1.53.3
import { CloseHelper } from '../../agrona/CloseHelper.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException } from '../../agrona/jdk.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../client/status/LocalSocketAddressStatus.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import type { CachedNanoClock } from '../../agrona/concurrent/CachedNanoClock.js';
import type { ReceiveChannelEndpoint } from './ReceiveChannelEndpoint.js';
import type { UdpChannel } from './UdpChannel.js';
import { UdpChannelTransport } from './UdpChannelTransport.js';

/**
 * Destination endpoint representation for reception into an image from a UDP transport.
 * <p>
 * Java pads the hot field against false sharing; a JS object has no field layout to control (spec D11, D19), so the
 * padding classes are not ported.
 */
export class ReceiveDestinationTransport extends UdpChannelTransport {
    private _timeOfLastActivityNs: number = 0;
    private _currentControlAddress: InetSocketAddress | null;
    private readonly localSocketAddressIndicator: AtomicCounter;
    private readonly receiveChannelEndpoint: ReceiveChannelEndpoint;

    /**
     * Construct transport for a receiving destination.
     *
     * @param udpChannel                  for the destination.
     * @param context                     for configuration.
     * @param localSocketAddressIndicator to indicate status of the transport.
     * @param receiveChannelEndpoint      to which this destination belongs.
     */
    public constructor(
        udpChannel: UdpChannel,
        context: MediaDriverContext,
        localSocketAddressIndicator: AtomicCounter,
        receiveChannelEndpoint: ReceiveChannelEndpoint,
    ) {
        super(
            udpChannel,
            udpChannel.remoteData(),
            udpChannel.remoteData(),
            null,
            context.receiverPortManager(),
            context,
            receiveChannelEndpoint.socketRcvbufLength(),
            receiveChannelEndpoint.socketSndbufLength(),
        );

        this._timeOfLastActivityNs = (context.receiverCachedNanoClock() as CachedNanoClock).nanoTime();
        this._currentControlAddress = udpChannel.hasExplicitControl() ? udpChannel.localControl() : null;
        this.localSocketAddressIndicator = localSocketAddressIndicator;
        this.receiveChannelEndpoint = receiveChannelEndpoint;
    }

    /**
     * Open the channel by the receiver.
     *
     * @param statusIndicator for the channel.
     */
    public openChannel(statusIndicator: AtomicCounter): void {
        this.openDatagramChannel(statusIndicator);
    }

    /**
     * Indicate that the transport is active after successfully opening it.
     */
    public indicateActive(): void {
        const currentStatus = this.localSocketAddressIndicator.getPlain();
        if (currentStatus !== ChannelEndpointStatus.INITIALIZING) {
            throw new IllegalStateException(
                'channel cannot be registered unless INITIALIZING: status=' +
                    ChannelEndpointStatus.status(currentStatus),
            );
        }

        LocalSocketAddressStatus.updateBindAddress(
            this.localSocketAddressIndicator,
            this.bindAddressAndPort(),
            this.context.countersMetaDataBuffer() as UnsafeBuffer,
        );
        this.localSocketAddressIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
    }

    /**
     * {@inheritDoc}
     */
    public override close(): void {
        super.close();
        CloseHelper.close(this.errorHandler, this.localSocketAddressIndicator);
    }

    /**
     * Has the channel explicit control address.
     *
     * @return true if the channel has explicit control address.
     */
    public hasExplicitControl(): boolean {
        return this._udpChannel.hasExplicitControl();
    }

    /**
     * Get the explicit control address for the channel.
     *
     * @return the explicit control address for the channel if set, otherwise null.
     */
    public explicitControlAddress(): InetSocketAddress | null {
        return this._udpChannel.hasExplicitControl() ? this._currentControlAddress : null;
    }

    /**
     * Store the time of last activity for the destination, or get it.
     *
     * @param nowNs the time of last activity for the destination.
     */
    public timeOfLastActivityNs(): number;
    public timeOfLastActivityNs(nowNs: number): void;
    public timeOfLastActivityNs(nowNs?: number): number | void {
        if (undefined === nowNs) {
            return this._timeOfLastActivityNs;
        }

        this._timeOfLastActivityNs = nowNs;
    }

    /**
     * Store the current control address for the destination, or get it.
     *
     * @param newAddress control address for the destination.
     */
    public currentControlAddress(): InetSocketAddress | null;
    public currentControlAddress(newAddress: InetSocketAddress | null): void;
    public currentControlAddress(newAddress?: InetSocketAddress | null): InetSocketAddress | null | void {
        if (undefined === newAddress) {
            return this._currentControlAddress;
        }

        this._currentControlAddress = newAddress;
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'ReceiveDestinationTransport{' +
            'currentControlAddress=' +
            this._currentControlAddress +
            ', localSocketAddress=' +
            this.localSocketAddressIndicator.label() +
            ', statusIndicator=' +
            this.localSocketAddressIndicator.getPlain() +
            '}'
        );
    }
}
