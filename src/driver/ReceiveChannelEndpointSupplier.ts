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
// Port of io/aeron/driver/ReceiveChannelEndpointSupplier.java @ 1.53.3
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { MediaDriverContext } from './MediaDriver.js';
import type { DataPacketDispatcher } from './DataPacketDispatcher.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { UdpChannel } from './media/UdpChannel.js';

/**
 * Supplier of channel endpoints which extend {@link ReceiveChannelEndpoint} to add specialised behaviour for the
 * receiver.
 */
export interface ReceiveChannelEndpointSupplier {
    /**
     * A new instance of a specialised {@link ReceiveChannelEndpoint}.
     *
     * @param udpChannel      on which the receiver is listening.
     * @param dispatcher      for dispatching packets to publication images.
     * @param statusIndicator for the channel.
     * @param context         for the configuration of the driver.
     * @return new instance of a specialised {@link ReceiveChannelEndpoint}.
     */
    newInstance(
        udpChannel: UdpChannel,
        dispatcher: DataPacketDispatcher,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
    ): ReceiveChannelEndpoint;
}
