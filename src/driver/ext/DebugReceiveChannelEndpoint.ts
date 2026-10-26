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
// Port of io/aeron/driver/ext/DebugReceiveChannelEndpoint.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import type { DataHeaderFlyweight } from '../../client/protocol/DataHeaderFlyweight.js';
import type { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import type { SetupFlyweight } from '../../client/protocol/SetupFlyweight.js';
import type { DataPacketDispatcher } from '../DataPacketDispatcher.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import { ReceiveChannelEndpoint } from '../media/ReceiveChannelEndpoint.js';
import type { UdpChannel } from '../media/UdpChannel.js';
import { DebugChannelEndpointConfiguration } from './DebugChannelEndpointConfiguration.js';
import type { LossGenerator } from './LossGenerator.js';

/**
 * A {@link ReceiveChannelEndpoint} that drops the data frames it receives and the control frames it sends, as its
 * {@link LossGenerator}s say, to test the reliability of a stream.
 */
export class DebugReceiveChannelEndpoint extends ReceiveChannelEndpoint {
    private readonly dataLossGenerator: LossGenerator;
    private readonly controlLossGenerator: LossGenerator;
    private readonly controlBuffer = new UnsafeBuffer();

    /**
     * Construct a {@link ReceiveChannelEndpoint} with configuration for loss rate and seed. The two Java constructors
     * are one: the loss generators default to those of {@link DebugChannelEndpointConfiguration}.
     *
     * @param udpChannel           for the media.
     * @param dispatcher           for forwarding packets.
     * @param statusIndicator      for the endpoint for the channel.
     * @param context              for configuration.
     * @param dataLossGenerator    for the random loss on the data stream.
     * @param controlLossGenerator for the random loss on the control stream.
     */
    public constructor(
        udpChannel: UdpChannel,
        dispatcher: DataPacketDispatcher,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
        dataLossGenerator: LossGenerator = DebugChannelEndpointConfiguration.receiveDataLossGeneratorSupplier(),
        controlLossGenerator: LossGenerator = DebugChannelEndpointConfiguration.receiveControlLossGeneratorSupplier(),
    ) {
        super(udpChannel, dispatcher, statusIndicator, context);

        this.dataLossGenerator = dataLossGenerator;
        this.controlLossGenerator = controlLossGenerator;
    }

    /**
     * {@inheritDoc}
     */
    public override sendTo(
        buffer: UnsafeBuffer,
        offset: number,
        length: number,
        remoteAddress: InetSocketAddress,
    ): number {
        let count = length;

        this.controlBuffer.wrap(buffer, offset, count);
        if (!this.controlLossGenerator.shouldDropFrame(remoteAddress, this.controlBuffer, count)) {
            count = super.sendTo(buffer, offset, length, remoteAddress);
        }

        return count;
    }

    /**
     * {@inheritDoc}
     */
    public override onDataPacket(
        header: DataHeaderFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): number {
        let result = 0;

        if (
            !this.dataLossGenerator.shouldDropFrame(
                srcAddress,
                buffer,
                header.streamId(),
                header.sessionId(),
                header.termId(),
                header.termOffset(),
                length,
            )
        ) {
            result = super.onDataPacket(header, buffer, length, srcAddress, transportIndex);
        }

        return result;
    }

    /**
     * {@inheritDoc}
     */
    public override onSetupMessage(
        header: SetupFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        if (!this.dataLossGenerator.shouldDropFrame(srcAddress, buffer, length)) {
            super.onSetupMessage(header, buffer, length, srcAddress, transportIndex);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override onRttMeasurement(
        header: RttMeasurementFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        if (!this.dataLossGenerator.shouldDropFrame(srcAddress, buffer, length)) {
            super.onRttMeasurement(header, buffer, length, srcAddress, transportIndex);
        }
    }
}
