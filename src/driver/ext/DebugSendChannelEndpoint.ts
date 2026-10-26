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
// Port of io/aeron/driver/ext/DebugSendChannelEndpoint.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import type { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import type { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import type { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';
import type { DriverConductorProxy } from '../DriverConductorProxy.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import { SendChannelEndpoint } from '../media/SendChannelEndpoint.js';
import type { UdpChannel } from '../media/UdpChannel.js';
import { DebugChannelEndpointConfiguration } from './DebugChannelEndpointConfiguration.js';
import type { LossGenerator } from './LossGenerator.js';

/**
 * A {@link SendChannelEndpoint} that drops the data frames it sends and the control frames it receives, as its
 * {@link LossGenerator}s say, to test the reliability of a stream.
 */
export class DebugSendChannelEndpoint extends SendChannelEndpoint {
    private readonly dataLossGenerator: LossGenerator;
    private readonly controlLossGenerator: LossGenerator;
    private readonly dataBuffer = new UnsafeBuffer();

    /**
     * Construct a {@link SendChannelEndpoint} with configuration for loss rate and seed. The two Java constructors are
     * one: the loss generators default to those of {@link DebugChannelEndpointConfiguration}.
     *
     * @param udpChannel           for the media.
     * @param statusIndicator      for the endpoint for the channel.
     * @param context              for configuration.
     * @param dataLossGenerator    for the random loss on the data stream.
     * @param controlLossGenerator for the random loss on the control stream.
     */
    public constructor(
        udpChannel: UdpChannel,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
        dataLossGenerator: LossGenerator = DebugChannelEndpointConfiguration.sendDataLossGeneratorSupplier(),
        controlLossGenerator: LossGenerator = DebugChannelEndpointConfiguration.sendControlLossGeneratorSupplier(),
    ) {
        super(udpChannel, statusIndicator, context);

        this.dataLossGenerator = dataLossGenerator;
        this.controlLossGenerator = controlLossGenerator;
    }

    /**
     * {@inheritDoc}
     */
    public override send(buffer: UnsafeBuffer, offset: number, length: number): number {
        let count = length;

        this.dataBuffer.wrap(buffer, offset, count);
        if (!this.dataLossGenerator.shouldDropFrame(this.connectAddress, this.dataBuffer, count)) {
            count = super.send(buffer, offset, length);
        }

        return count;
    }

    /**
     * {@inheritDoc}
     */
    public override onStatusMessage(
        msg: StatusMessageFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        conductorProxy: DriverConductorProxy,
    ): void {
        if (!this.controlLossGenerator.shouldDropFrame(srcAddress, msg, length)) {
            super.onStatusMessage(msg, buffer, length, srcAddress, conductorProxy);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override onNakMessage(
        msg: NakFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
    ): void {
        if (!this.controlLossGenerator.shouldDropFrame(srcAddress, msg, length)) {
            super.onNakMessage(msg, buffer, length, srcAddress);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override onRttMeasurement(
        msg: RttMeasurementFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
    ): void {
        if (!this.controlLossGenerator.shouldDropFrame(srcAddress, msg, length)) {
            super.onRttMeasurement(msg, buffer, length, srcAddress);
        }
    }
}
