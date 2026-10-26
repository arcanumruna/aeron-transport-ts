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
// Port of io/aeron/driver/MaxMulticastFlowControlSupplier.java @ 1.53.3
import { type FlowControl } from './FlowControl.js';
import { type FlowControlSupplier } from './FlowControlSupplier.js';
import { MaxMulticastFlowControl } from './MaxMulticastFlowControl.js';
import { type UdpChannel } from './media/UdpChannel.js';

/**
 * Supplier of {@link MaxMulticastFlowControl} strategies.
 */
export class MaxMulticastFlowControlSupplier implements FlowControlSupplier {
    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * {@inheritDoc}
     */
    public newInstance(_udpChannel: UdpChannel, _streamId: number, _registrationId: number): FlowControl {
        return new MaxMulticastFlowControl();
    }
}
