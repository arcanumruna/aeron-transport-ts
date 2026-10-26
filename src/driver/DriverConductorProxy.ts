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
// Port of io/aeron/driver/DriverConductorProxy.java @ 1.53.3
import type { ManyToOneConcurrentLinkedQueue } from '../agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { IllegalStateException } from '../agrona/jdk.js';
import type { Runnable } from './CommandProxy.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from './media/ReceiveDestinationTransport.js';
import type { SendChannelEndpoint } from './media/SendChannelEndpoint.js';
import type { UdpChannel } from './media/UdpChannel.js';

/**
 * The members of the `DriverConductor` (task T18) that the {@link DriverConductorProxy} calls: the narrowest type the
 * proxy needs, a forward reference in the manner of spec D24 (`docs/mapping.md`, "Sources"). T18 makes the conductor
 * satisfy it. `long` ids are `number`s (spec D5); the receiver id and the group tag of an error frame are the 64-bit
 * wire values as `bigint`s (spec D33).
 */
export interface DriverConductorProxyTarget {
    onReResolveEndpoint(
        endpoint: string,
        channelEndpoint: SendChannelEndpoint,
        address: InetSocketAddress | null,
    ): void;
    onReResolveControl(
        endpoint: string,
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
        address: InetSocketAddress | null,
    ): void;
    closeReceiveDestination(destinationTransport: ReceiveDestinationTransport): void;
    responseSetup(responseCorrelationId: number, responseSessionId: number): void;
    responseConnected(responseCorrelationId: number): void;
    receiveChannelEndpointClosed(channelEndpoint: ReceiveChannelEndpoint): void;
    sendChannelEndpointClosed(channelEndpoint: SendChannelEndpoint): void;
    onCreatePublicationImage(
        sessionId: number,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        termLength: number,
        mtuLength: number,
        transportIndex: number,
        flags: number,
        controlAddress: InetSocketAddress,
        srcAddress: InetSocketAddress,
        channelEndpoint: ReceiveChannelEndpoint,
    ): void;
    onPublicationError(
        registrationId: number,
        destinationRegistrationId: number,
        sessionId: number,
        streamId: number,
        receiverId: bigint,
        groupId: bigint | null,
        srcAddress: InetSocketAddress,
        errorCode: number,
        errorMessage: string,
    ): void;
}

/**
 * Proxy for sending commands to the {@link DriverConductor}.
 *
 * @internal `@InternalApi` in Java
 */
export class DriverConductorProxy {
    private _driverConductor: DriverConductorProxyTarget | null = null;
    private readonly commandQueue: ManyToOneConcurrentLinkedQueue<Runnable>;

    public constructor(commandQueue: ManyToOneConcurrentLinkedQueue<Runnable>) {
        this.commandQueue = commandQueue;
    }

    /**
     * Request the conductor re-resolve an endpoint address.
     *
     * @param endpoint        in string format.
     * @param channelEndpoint that the endpoint belongs to.
     * @param address         of previous resolution.
     */
    public reResolveEndpoint(
        endpoint: string,
        channelEndpoint: SendChannelEndpoint,
        address: InetSocketAddress | null,
    ): void {
        this.offer(() => this.conductor().onReResolveEndpoint(endpoint, channelEndpoint, address));
    }

    /**
     * Re-resolve a control endpoint for a channel.
     *
     * @param endpoint        to be re-resolved.
     * @param udpChannel      which contained the endpoint.
     * @param channelEndpoint to which the endpoint belongs.
     * @param address         of previous resolution.
     */
    public reResolveControl(
        endpoint: string,
        udpChannel: UdpChannel,
        channelEndpoint: ReceiveChannelEndpoint,
        address: InetSocketAddress | null,
    ): void {
        this.offer(() => this.conductor().onReResolveControl(endpoint, udpChannel, channelEndpoint, address));
    }

    /**
     * Close a receive destination.
     *
     * @param destinationTransport to have its indicators closed.
     */
    public closeReceiveDestination(destinationTransport: ReceiveDestinationTransport): void {
        this.offer(() => this.conductor().closeReceiveDestination(destinationTransport));
    }

    /**
     * Handle a response setup message from the remote "server".
     *
     * @param responseCorrelationId correlationId of the subscription that will handle responses.
     * @param responseSessionId     sessionId that will be associated with the incoming messages.
     */
    public responseSetup(responseCorrelationId: number, responseSessionId: number): void {
        this.offer(() => this.conductor().responseSetup(responseCorrelationId, responseSessionId));
    }

    /**
     * Handle notify that a response channel has connected.
     *
     * @param responseCorrelationId correlationId of the subscription that will handle responses.
     */
    public responseConnected(responseCorrelationId: number): void {
        this.offer(() => this.conductor().responseConnected(responseCorrelationId));
    }

    public receiveChannelEndpointClosed(channelEndpoint: ReceiveChannelEndpoint): void {
        this.offer(() => this.conductor().receiveChannelEndpointClosed(channelEndpoint));
    }

    public sendChannelEndpointClosed(channelEndpoint: SendChannelEndpoint): void {
        this.offer(() => this.conductor().sendChannelEndpointClosed(channelEndpoint));
    }

    public driverConductor(driverConductor: DriverConductorProxyTarget): void {
        this._driverConductor = driverConductor;
    }

    public createPublicationImage(
        sessionId: number,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        termLength: number,
        mtuLength: number,
        transportIndex: number,
        flags: number,
        controlAddress: InetSocketAddress,
        srcAddress: InetSocketAddress,
        channelEndpoint: ReceiveChannelEndpoint,
    ): void {
        this.offer(() =>
            this.conductor().onCreatePublicationImage(
                sessionId,
                streamId,
                initialTermId,
                activeTermId,
                termOffset,
                termLength,
                mtuLength,
                transportIndex,
                flags,
                controlAddress,
                srcAddress,
                channelEndpoint,
            ),
        );
    }

    public onPublicationError(
        registrationId: number,
        destinationRegistrationId: number,
        sessionId: number,
        streamId: number,
        receiverId: bigint,
        groupId: bigint | null,
        srcAddress: InetSocketAddress,
        errorCode: number,
        errorMessage: string,
    ): void {
        this.offer(() =>
            this.conductor().onPublicationError(
                registrationId,
                destinationRegistrationId,
                sessionId,
                streamId,
                receiverId,
                groupId,
                srcAddress,
                errorCode,
                errorMessage,
            ),
        );
    }

    /**
     * Java's lambdas read the `driverConductor` field when they run: a command that runs before
     * {@link DriverConductorProxy.driverConductor} was called is a `NullPointerException` there and an
     * `IllegalStateException` here.
     */
    private conductor(): DriverConductorProxyTarget {
        if (null === this._driverConductor) {
            throw new IllegalStateException('driverConductor has not been set');
        }

        return this._driverConductor;
    }

    private offer(cmd: Runnable): void {
        if (!this.commandQueue.offer(cmd)) {
            throw new IllegalStateException('offer failed');
        }
    }
}
