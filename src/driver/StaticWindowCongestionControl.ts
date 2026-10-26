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
// Port of io/aeron/driver/StaticWindowCongestionControl.java @ 1.53.3
import { type NanoClock } from '../agrona/concurrent/NanoClock.js';
import { type CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { Configuration } from './Configuration.js';
import { CongestionControl } from './CongestionControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { type UdpChannel } from './media/UdpChannel.js';
import { type MediaDriver } from './MediaDriver.js';

/**
 * Congestion control algorithm that uses a static window.
 */
export class StaticWindowCongestionControl implements CongestionControl {
    /**
     * URI param value to identify this {@link CongestionControl} strategy.
     */
    public static readonly CC_PARAM_VALUE: string = 'static';

    private readonly ccOutcome: number;

    /**
     * Construct a new {@link CongestionControl} instance for a received stream image using a static window algorithm.
     *
     * @param registrationId  for the publication image.
     * @param udpChannel      for the publication image.
     * @param streamId        for the publication image.
     * @param sessionId       for the publication image.
     * @param termLength      for the publication image.
     * @param senderMtuLength for the publication image.
     * @param controlAddress  for the publication image.
     * @param sourceAddress   for the publication image.
     * @param nanoClock       for the precise timing.
     * @param context         for configuration options applied in the driver.
     * @param countersManager for the driver.
     */
    public constructor(
        _registrationId: number,
        udpChannel: UdpChannel,
        _streamId: number,
        _sessionId: number,
        termLength: number,
        _senderMtuLength: number,
        _controlAddress: InetSocketAddress | null,
        _sourceAddress: InetSocketAddress | null,
        _nanoClock: NanoClock | null,
        context: MediaDriver.Context,
        _countersManager: CountersManager | null,
    ) {
        const initialWindowLength =
            udpChannel.receiverWindowLength() !== 0 ? udpChannel.receiverWindowLength() : context.initialWindowLength();

        this.ccOutcome = CongestionControl.packOutcome(
            Configuration.receiverWindowLength(termLength, initialWindowLength),
            false,
        );
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {}

    /**
     * {@inheritDoc}
     */
    public shouldMeasureRtt(_nowNs: number): boolean {
        return false;
    }

    /**
     * {@inheritDoc}
     */
    public onRttMeasurementSent(_nowNs: number): void {}

    /**
     * {@inheritDoc}
     */
    public onRttMeasurement(_nowNs: number, _rttNs: number, _srcAddress: InetSocketAddress): void {}

    /**
     * {@inheritDoc}
     */
    public onTrackRebuild(
        _nowNs: number,
        _newConsumptionPosition: number,
        _lastSmPosition: number,
        _hwmPosition: number,
        _startingRebuildPosition: number,
        _endingRebuildPosition: number,
        _lossOccurred: boolean,
    ): number {
        return this.ccOutcome;
    }

    /**
     * {@inheritDoc}
     */
    public initialWindowLength(): number {
        return CongestionControl.receiverWindowLength(this.ccOutcome);
    }

    /**
     * {@inheritDoc}
     */
    public maxWindowLength(): number {
        return CongestionControl.receiverWindowLength(this.ccOutcome);
    }
}
