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
// Port of io/aeron/driver/CongestionControlSupplier.java @ 1.53.3
import { type NanoClock } from '../agrona/concurrent/NanoClock.js';
import { type CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { type CongestionControl } from './CongestionControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { type UdpChannel } from './media/UdpChannel.js';
import { type MediaDriver } from './MediaDriver.js';

/**
 * Supplier of {@link CongestionControl} implementations to be used by receivers for images.
 */
export interface CongestionControlSupplier {
    /**
     * Return a new {@link CongestionControl} instance.
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
     * @return congestion control instance ready for immediate usage.
     */
    newInstance(
        registrationId: number,
        udpChannel: UdpChannel,
        streamId: number,
        sessionId: number,
        termLength: number,
        senderMtuLength: number,
        controlAddress: InetSocketAddress,
        sourceAddress: InetSocketAddress,
        nanoClock: NanoClock,
        context: MediaDriver.Context,
        countersManager: CountersManager,
    ): CongestionControl;
}
