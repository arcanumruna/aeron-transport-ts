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
// Port of io/aeron/driver/media/MultiRcvDestination.java @ 1.53.3
import { CloseHelper } from '../../agrona/CloseHelper.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import { ArrayUtil } from '../../agrona/collections/ArrayUtil.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { CommonContext } from '../../client/CommonContext.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { DriverConductorProxy } from '../DriverConductorProxy.js';
import type { DataTransportPoller } from './DataTransportPoller.js';
import type { ImageConnection } from './ImageConnection.js';
import { ReceiveChannelEndpoint } from './ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from './ReceiveDestinationTransport.js';
import type { UdpChannel } from './UdpChannel.js';
import type { UdpChannelTransport } from './UdpChannelTransport.js';

const EMPTY_TRANSPORTS: (ReceiveDestinationTransport | null)[] = [];

/**
 * The destinations of a manual-control (MDS) receive channel, by transport index.
 *
 * @internal package-private in Java
 */
export class MultiRcvDestination {
    private transports: (ReceiveDestinationTransport | null)[] = EMPTY_TRANSPORTS;

    public close(errorHandler: ErrorHandler | null): void {
        CloseHelper.closeAll(errorHandler, this.transports);
    }

    public cancelRead(endpoint: ReceiveChannelEndpoint, poller: DataTransportPoller): void {
        for (const transport of this.transports) {
            if (null !== transport) {
                poller.cancelRead(endpoint, transport);
            }
        }
    }

    public addDestination(transport: ReceiveDestinationTransport): number {
        let index = this.transports.length;

        for (let i = 0, length = this.transports.length; i < length; i++) {
            if (null === this.transports[i]) {
                index = i;
                break;
            }
        }

        this.transports = ArrayUtil.ensureCapacity(this.transports, index + 1);
        this.transports[index] = transport;

        return index;
    }

    public removeDestination(transportIndex: number): void {
        this.transports[transportIndex] = null;
    }

    public hasDestination(transportIndex: number): boolean {
        return this.transports.length > transportIndex && null !== this.transports[transportIndex];
    }

    /**
     * Java's `transport(int)` and `transport(UdpChannel)`: the transport at an index, or the index of the transport of a
     * channel (`ArrayUtil.UNKNOWN_INDEX` when there is none).
     */
    public transport(transportIndex: number): ReceiveDestinationTransport;
    public transport(udpChannel: UdpChannel): number;
    public transport(indexOrChannel: number | UdpChannel): ReceiveDestinationTransport | number {
        if (typeof indexOrChannel === 'number') {
            return this.transports[indexOrChannel] as ReceiveDestinationTransport;
        }

        const transports = this.transports;
        let index = ArrayUtil.UNKNOWN_INDEX;

        for (let i = 0, length = transports.length; i < length; i++) {
            const transport = transports[i];

            if (null !== transport && undefined !== transport && transport.udpChannel().equals(indexOrChannel)) {
                index = i;
                break;
            }
        }

        return index;
    }

    public checkForReResolution(
        channelEndpoint: ReceiveChannelEndpoint,
        nowNs: number,
        conductorProxy: DriverConductorProxy,
    ): void {
        for (const transport of this.transports) {
            if (null !== transport && undefined !== transport) {
                const udpChannel = transport.udpChannel();

                if (
                    udpChannel.hasExplicitControl() &&
                    transport.timeOfLastActivityNs() + ReceiveChannelEndpoint.DESTINATION_ADDRESS_TIMEOUT < nowNs
                ) {
                    transport.timeOfLastActivityNs(nowNs);
                    conductorProxy.reResolveControl(
                        udpChannel.channelUri().get(CommonContext.MDC_CONTROL_PARAM_NAME) as string,
                        udpChannel,
                        channelEndpoint,
                        transport.currentControlAddress(),
                    );
                }
            }
        }
    }

    public updateControlAddress(transportIndex: number, newAddress: InetSocketAddress): void {
        if (ArrayUtil.UNKNOWN_INDEX !== transportIndex) {
            const transport = this.transports[transportIndex];

            if (null !== transport && undefined !== transport) {
                transport.currentControlAddress(newAddress);
            }
        }
    }

    public sendToAll(
        imageConnections: (ImageConnection | null)[],
        buffer: UnsafeBuffer,
        bytesToSend: number,
        nowNs: number,
    ): number {
        const transports = this.transports;
        let minBytesSent = bytesToSend;

        for (let lastIndex = imageConnections.length - 1, i = lastIndex; i >= 0; i--) {
            const connection = imageConnections[i];

            if (null !== connection && undefined !== connection) {
                const transport = transports[i];
                if (
                    null !== transport &&
                    undefined !== transport &&
                    connection.timeOfLastActivityNs + ReceiveChannelEndpoint.DESTINATION_ADDRESS_TIMEOUT - nowNs > 0
                ) {
                    minBytesSent = Math.min(
                        minBytesSent,
                        MultiRcvDestination.sendTo(transport, buffer, 0, bytesToSend, connection.controlAddress),
                    );
                }
            }
        }

        return minBytesSent;
    }

    /**
     * Send `length` bytes of `buffer` from `offset` to `remoteAddress` on the socket of `transport`. The errors that
     * the send raises are reported by the transport (D28).
     */
    public static sendTo(
        transport: UdpChannelTransport | null,
        buffer: UnsafeBuffer,
        offset: number,
        length: number,
        remoteAddress: InetSocketAddress,
    ): number {
        let bytesSent = 0;
        if (null !== transport && null !== transport.sendDatagramChannel) {
            transport.sendHook(buffer, remoteAddress);
            bytesSent = transport.sendTo(buffer, offset, length, remoteAddress);
        }

        return bytesSent;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return 'MultiRcvDestination{' + 'transports=[' + this.transports.map((t) => String(t)).join(', ') + ']}';
    }
}
