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
// Port of io/aeron/driver/media/ControlTransportPoller.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { BufferUtil } from '../../agrona/BufferUtil.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import { ArrayListUtil } from '../../agrona/collections/ArrayListUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../client/logbuffer/FrameDescriptor.js';
import { ErrorFlyweight } from '../../client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import { ResponseSetupFlyweight } from '../../client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../Configuration.js';
import { ClosedChannelException } from '../jdkNet.js';
import type { DriverConductorProxy } from '../DriverConductorProxy.js';
import type { SendChannelEndpoint } from './SendChannelEndpoint.js';
import { UdpTransportPoller } from './UdpTransportPoller.js';

const { HDR_TYPE_ERR, HDR_TYPE_NAK, HDR_TYPE_RSP_SETUP, HDR_TYPE_RTTM, HDR_TYPE_SM } = HeaderFlyweight;
const { CACHE_LINE_LENGTH } = BitUtil;

/**
 * Encapsulates the polling of control {@link UdpChannelTransport}s using whatever means provides the lowest latency.
 * <p>
 * A poller visits every registered endpoint in turn and takes one datagram from the ring of each (spec D1, D30): the
 * list of Java's `transports` (a record of the endpoint and its selection key) is the list `transports` of the
 * {@link TransportPoller}, of the endpoints.
 */
export class ControlTransportPoller extends UdpTransportPoller<SendChannelEndpoint> {
    private readonly unsafeBuffer = new UnsafeBuffer(
        BufferUtil.allocateDirectAligned(Configuration.MAX_UDP_PAYLOAD_LENGTH, CACHE_LINE_LENGTH),
    );
    private readonly nakMessage = new NakFlyweight(this.unsafeBuffer);
    private readonly statusMessage = new StatusMessageFlyweight(this.unsafeBuffer);
    private readonly rttMeasurement = new RttMeasurementFlyweight(this.unsafeBuffer);
    private readonly responseSetup = new ResponseSetupFlyweight(this.unsafeBuffer);
    private readonly error = new ErrorFlyweight(this.unsafeBuffer);
    private readonly conductorProxy: DriverConductorProxy;
    private totalBytesReceived = 0;

    /**
     * Construct a new {@link TransportPoller} with an {@link ErrorHandler} for logging.
     *
     * @param errorHandler   which can be used to log errors and continue.
     * @param conductorProxy to send message back to the conductor.
     */
    public constructor(errorHandler: ErrorHandler, conductorProxy: DriverConductorProxy) {
        super(errorHandler);
        this.conductorProxy = conductorProxy;
    }

    /**
     * {@inheritDoc}
     */
    public override close(): void {
        for (const sendChannelEndpoint of this.transports) {
            try {
                sendChannelEndpoint.close();
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
            this.poll(transports[i] as SendChannelEndpoint);
        }

        return this.totalBytesReceived;
    }

    /**
     * Register channel for read.
     *
     * @param sendChannelEndpoint to associate with read.
     */
    public registerForRead(sendChannelEndpoint: SendChannelEndpoint): void {
        if (null === sendChannelEndpoint.receiveDatagramChannel()) {
            throw new ClosedChannelException();
        }

        this.transports.push(sendChannelEndpoint);
    }

    /**
     * Cancel a previous read registration.
     *
     * @param sendChannelEndpoint to be canceled and removed.
     */
    public cancelRead(sendChannelEndpoint: SendChannelEndpoint): void {
        const transports = this.transports;
        for (let i = transports.length - 1; i >= 0; i--) {
            if (sendChannelEndpoint === transports[i]) {
                ArrayListUtil.fastUnorderedRemove(transports, i);
                break;
            }
        }
    }

    /**
     * Check if any of the registered channels require re-resolution.
     *
     * @param nowNs          as the current time.
     * @param conductorProxy for sending re-resolution requests.
     */
    public checkForReResolutions(nowNs: number, conductorProxy: DriverConductorProxy): void {
        const transports = this.transports;
        for (let i = 0; i < transports.length; i++) {
            (transports[i] as SendChannelEndpoint).checkForReResolution(nowNs, conductorProxy);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return 'ControlTransportPoller{}';
    }

    private poll(channelEndpoint: SendChannelEndpoint): void {
        try {
            this.receive(channelEndpoint);
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        }
    }

    private receive(channelEndpoint: SendChannelEndpoint): void {
        const unsafeBuffer = this.unsafeBuffer;
        const srcAddress = channelEndpoint.receive(unsafeBuffer);

        if (null !== srcAddress) {
            const length = channelEndpoint.receivedLength();
            this.totalBytesReceived += length;
            if (channelEndpoint.isValidFrame(unsafeBuffer, length)) {
                channelEndpoint.receiveHook(unsafeBuffer, length, srcAddress);

                const frameType = FrameDescriptor.frameType(unsafeBuffer, 0);
                if (HDR_TYPE_NAK === frameType) {
                    channelEndpoint.onNakMessage(this.nakMessage, unsafeBuffer, length, srcAddress);
                } else if (HDR_TYPE_SM === frameType) {
                    channelEndpoint.onStatusMessage(
                        this.statusMessage,
                        unsafeBuffer,
                        length,
                        srcAddress,
                        this.conductorProxy,
                    );
                } else if (HDR_TYPE_ERR === frameType) {
                    channelEndpoint.onError(this.error, unsafeBuffer, length, srcAddress, this.conductorProxy);
                } else if (HDR_TYPE_RTTM === frameType) {
                    channelEndpoint.onRttMeasurement(this.rttMeasurement, unsafeBuffer, length, srcAddress);
                } else if (HDR_TYPE_RSP_SETUP === frameType) {
                    channelEndpoint.onResponseSetup(
                        this.responseSetup,
                        unsafeBuffer,
                        length,
                        srcAddress,
                        this.conductorProxy,
                    );
                }
            }
        }
    }
}
