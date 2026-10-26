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
// Port of io/aeron/driver/DefaultReceiveChannelEndpointSupplier.java @ 1.53.3
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { MediaDriverContext } from './MediaDriver.js';
import { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { DataPacketDispatcher } from './media/ReceiveChannelEndpoint.js';
import type { UdpChannel } from './media/UdpChannel.js';
import type { ReceiveChannelEndpointSupplier } from './ReceiveChannelEndpointSupplier.js';

/**
 * Supply the default implementation of the {@link ReceiveChannelEndpoint}.
 */
export class DefaultReceiveChannelEndpointSupplier implements ReceiveChannelEndpointSupplier {
    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * {@inheritDoc}
     */
    public newInstance(
        udpChannel: UdpChannel,
        dispatcher: DataPacketDispatcher,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
    ): ReceiveChannelEndpoint {
        return new ReceiveChannelEndpoint(udpChannel, dispatcher, statusIndicator, context);
    }
}
