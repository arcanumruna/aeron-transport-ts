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
// Port of io/aeron/driver/FlowControlSupplier.java @ 1.53.3
import { type FlowControl } from './FlowControl.js';
import { type UdpChannel } from './media/UdpChannel.js';

/**
 * Supplier of {@link FlowControl} strategies to be used by a {@link Sender} for each stream.
 */
export interface FlowControlSupplier {
    /**
     * Return a new {@link FlowControl} instance.
     *
     * @param udpChannel     for the publication.
     * @param streamId       for the publication.
     * @param registrationId for the publication.
     * @return flow control instance ready for immediate usage.
     */
    newInstance(udpChannel: UdpChannel, streamId: number, registrationId: number): FlowControl;
}
