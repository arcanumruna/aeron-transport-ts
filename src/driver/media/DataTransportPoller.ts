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
// Port of io/aeron/driver/media/DataTransportPoller.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { BufferUtil } from '../../agrona/BufferUtil.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import { ArrayListUtil } from '../../agrona/collections/ArrayListUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../client/logbuffer/FrameDescriptor.js';
import { DataHeaderFlyweight } from '../../client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../client/protocol/HeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../client/protocol/SetupFlyweight.js';
import { Configuration } from '../Configuration.js';
import { ClosedChannelException } from '../jdkNet.js';
import type { DriverConductorProxy } from './SendChannelEndpoint.js';
import type { ReceiveChannelEndpoint } from './ReceiveChannelEndpoint.js';
import type { UdpChannelTransport } from './UdpChannelTransport.js';
import { UdpTransportPoller } from './UdpTransportPoller.js';

const { HDR_TYPE_DATA, HDR_TYPE_PAD, HDR_TYPE_RTTM, HDR_TYPE_SETUP } = HeaderFlyweight;
const { CACHE_LINE_LENGTH } = BitUtil;

/**
 * A receive channel endpoint, one of its transports and the index of the transport in the channel: what the poller
 * registers (Java: the attachment of the selection key).
 *
 * @internal package-private in Java
 */
export class ChannelAndTransport {
    public readonly channelEndpoint: ReceiveChannelEndpoint;
    public readonly transport: UdpChannelTransport;
    public readonly transportIndex: number;

    public constructor(
        channelEndpoint: ReceiveChannelEndpoint,
        transport: UdpChannelTransport,
        transportIndex: number,
    ) {
        this.channelEndpoint = channelEndpoint;
        this.transport = transport;
        this.transportIndex = transportIndex;
    }
}

/**
 * Encapsulates the polling of data {@link UdpChannelTransport}s using whatever means provides the lowest latency.
 * <p>
 * A poller visits every registered transport in turn and takes one datagram from the ring of each (spec D1, D30): the
 * list of Java's `channelAndTransports` is the list `transports` of the {@link TransportPoller}.
 */
export class DataTransportPoller extends UdpTransportPoller<ChannelAndTransport> {
    private readonly unsafeBuffer = new UnsafeBuffer(
        BufferUtil.allocateDirectAligned(Configuration.MAX_UDP_PAYLOAD_LENGTH, CACHE_LINE_LENGTH),
    );
    private readonly dataMessage = new DataHeaderFlyweight(this.unsafeBuffer);
    private readonly setupMessage = new SetupFlyweight(this.unsafeBuffer);
    private readonly rttMeasurement = new RttMeasurementFlyweight(this.unsafeBuffer);
    private totalBytesReceived = 0;

    /**
     * Construct a new {@link TransportPoller} with an {@link ErrorHandler} for logging.
     *
     * @param errorHandler which can be used to log errors and continue.
     */
    public constructor(errorHandler: ErrorHandler) {
        super(errorHandler);
    }

    /**
     * {@inheritDoc}
     */
    public override close(): void {
        for (const transport of this.transports) {
            try {
                const receiveChannelEndpoint = transport.channelEndpoint;
                receiveChannelEndpoint.close();
            } catch (ex) {
                this.errorHandler.onError(ex as Error);
            }
        }
        super.close();
    }

    /**
     * {@inheritDoc}
     */
    public pollTransports(): number {
        this.totalBytesReceived = 0;

        // Java polls the transports one by one up to ITERATION_THRESHOLD and then selects; there is no selector (D30)
        const transports = this.transports;
        for (let i = 0; i < transports.length; i++) {
            this.poll(transports[i] as ChannelAndTransport);
        }

        return this.totalBytesReceived;
    }

    /**
     * Register transport for reading with the poller.
     *
     * @param channelEndpoint to which the transport belongs.
     * @param transport       new transport to be registered.
     * @param transportIndex  for the transport in the channel.
     */
    public registerForRead(
        channelEndpoint: ReceiveChannelEndpoint,
        transport: UdpChannelTransport,
        transportIndex: number,
    ): void {
        if (null === transport.receiveDatagramChannel()) {
            throw new ClosedChannelException();
        }

        this.transports.push(new ChannelAndTransport(channelEndpoint, transport, transportIndex));
    }

    /**
     * Cancel the reading of a given transport.
     *
     * @param channelEndpoint to which the transport belongs.
     * @param transport       transport which was previously registered.
     */
    public cancelRead(channelEndpoint: ReceiveChannelEndpoint, transport: UdpChannelTransport): void {
        const transports = this.transports;
        for (let i = transports.length - 1; i >= 0; i--) {
            const channelAndTransport = transports[i] as ChannelAndTransport;
            if (
                channelEndpoint === channelAndTransport.channelEndpoint &&
                transport === channelAndTransport.transport
            ) {
                ArrayListUtil.fastUnorderedRemove(transports, i);
                break;
            }
        }
    }

    /**
     * Cancel all reads of a given channel.
     *
     * @param channelEndpoint to which the transport belongs.
     */
    public cancelReadForAllTransports(channelEndpoint: ReceiveChannelEndpoint): void {
        const transports = this.transports;
        for (let i = transports.length - 1; i >= 0; i--) {
            const transport = transports[i] as ChannelAndTransport;
            if (channelEndpoint === transport.channelEndpoint) {
                ArrayListUtil.fastUnorderedRemove(transports, i);
            }
        }

        this.selectNowWithoutProcessing();
    }

    /**
     * Check if any of the registered channels or transports require re-resolution.
     *
     * @param nowNs          as the current time.
     * @param conductorProxy for sending re-resolution requests.
     */
    public checkForReResolutions(nowNs: number, conductorProxy: DriverConductorProxy): void {
        const transports = this.transports;
        for (let i = 0; i < transports.length; i++) {
            (transports[i] as ChannelAndTransport).channelEndpoint.checkForReResolution(nowNs, conductorProxy);
        }
    }

    private poll(channelAndTransport: ChannelAndTransport): void {
        try {
            this.receive(channelAndTransport);
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        }
    }

    private receive(channelAndTransport: ChannelAndTransport): void {
        const unsafeBuffer = this.unsafeBuffer;
        const srcAddress = channelAndTransport.transport.receive(unsafeBuffer);

        if (null !== srcAddress) {
            const length = channelAndTransport.transport.receivedLength();
            this.totalBytesReceived += length;
            const channelEndpoint = channelAndTransport.channelEndpoint;

            if (channelEndpoint.isValidFrame(unsafeBuffer, length)) {
                channelEndpoint.receiveHook(unsafeBuffer, length, srcAddress);

                const frameType = FrameDescriptor.frameType(unsafeBuffer, 0);
                if (HDR_TYPE_DATA === frameType || HDR_TYPE_PAD === frameType) {
                    channelEndpoint.onDataPacket(
                        this.dataMessage,
                        unsafeBuffer,
                        length,
                        srcAddress,
                        channelAndTransport.transportIndex,
                    );
                } else if (HDR_TYPE_SETUP === frameType) {
                    channelEndpoint.onSetupMessage(
                        this.setupMessage,
                        unsafeBuffer,
                        length,
                        srcAddress,
                        channelAndTransport.transportIndex,
                    );
                } else if (HDR_TYPE_RTTM === frameType) {
                    channelEndpoint.onRttMeasurement(
                        this.rttMeasurement,
                        unsafeBuffer,
                        length,
                        srcAddress,
                        channelAndTransport.transportIndex,
                    );
                }
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return 'DataTransportPoller{}';
    }
}
