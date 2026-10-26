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
// Port of io/aeron/driver/media/PortManager.java @ 1.53.3
import type { InetSocketAddress } from '../jdkNet.js';
import type { UdpChannel } from './UdpChannel.js';

/**
 * Interface for managing ports in use by UdpChannelTransports.
 */
export interface PortManager {
    /**
     * Called before an OS bind to adjust the bound address and to notify of the bind for the port manager.
     *
     * @param udpChannel  for the UDP endpoint being bound.
     * @param bindAddress for the bind.
     * @return InetSocketAddress to use for the bind.
     * @throws BindException if the bind should not be performed.
     */
    getManagedPort(udpChannel: UdpChannel, bindAddress: InetSocketAddress): InetSocketAddress;

    /**
     * Called after the bound socket is to be closed.
     *
     * @param bindAddress used for the bind previously.
     */
    freeManagedPort(bindAddress: InetSocketAddress): void;
}
