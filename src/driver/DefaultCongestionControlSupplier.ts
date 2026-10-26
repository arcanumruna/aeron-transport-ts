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
// Port of io/aeron/driver/DefaultCongestionControlSupplier.java @ 1.53.3
import { type NanoClock } from '../agrona/concurrent/NanoClock.js';
import { type CountersManager } from '../agrona/concurrent/status/CountersManager.js';
import { IllegalArgumentException } from '../agrona/jdk.js';
import { CommonContext } from '../client/CommonContext.js';
import { type CongestionControl } from './CongestionControl.js';
import { type CongestionControlSupplier } from './CongestionControlSupplier.js';
import { CubicCongestionControl } from './ext/CubicCongestionControl.js';
import { type InetSocketAddress } from './jdkNet.js';
import { type UdpChannel } from './media/UdpChannel.js';
import { type MediaDriver } from './MediaDriver.js';
import { StaticWindowCongestionControl } from './StaticWindowCongestionControl.js';

/**
 * Default supplier of {@link CongestionControl} implementations: static window, or Cubic with `cc=cubic`.
 */
export class DefaultCongestionControlSupplier implements CongestionControlSupplier {
    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * {@inheritDoc}
     */
    public newInstance(
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
    ): CongestionControl {
        const ccStr = udpChannel.channelUri().get(CommonContext.CONGESTION_CONTROL_PARAM_NAME);

        if (null === ccStr || StaticWindowCongestionControl.CC_PARAM_VALUE === ccStr) {
            return new StaticWindowCongestionControl(
                registrationId,
                udpChannel,
                streamId,
                sessionId,
                termLength,
                senderMtuLength,
                controlAddress,
                sourceAddress,
                nanoClock,
                context,
                countersManager,
            );
        } else if (CubicCongestionControl.CC_PARAM_VALUE === ccStr) {
            return new CubicCongestionControl(
                registrationId,
                udpChannel,
                streamId,
                sessionId,
                termLength,
                senderMtuLength,
                controlAddress,
                sourceAddress,
                nanoClock,
                context,
                countersManager,
            );
        }

        throw new IllegalArgumentException('unsupported congestion control : cc=' + ccStr);
    }
}
