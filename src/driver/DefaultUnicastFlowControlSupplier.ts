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
// Port of io/aeron/driver/DefaultUnicastFlowControlSupplier.java @ 1.53.3
import { ClassNotFoundException, IllegalArgumentException } from '../agrona/jdk.js';
import { LangUtil } from '../agrona/LangUtil.js';
import { CommonContext } from '../client/CommonContext.js';
import { Configuration } from './Configuration.js';
import { type FlowControl } from './FlowControl.js';
import { type FlowControlSupplier } from './FlowControlSupplier.js';
import { type UdpChannel } from './media/UdpChannel.js';
import { UnicastFlowControl } from './UnicastFlowControl.js';

/**
 * Default supplier of {@link FlowControl} strategies for unicast channels.
 */
export class DefaultUnicastFlowControlSupplier implements FlowControlSupplier {
    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * {@inheritDoc}
     */
    public newInstance(udpChannel: UdpChannel, _streamId: number, _registrationId: number): FlowControl {
        const fcStr = udpChannel.channelUri().get(CommonContext.FLOW_CONTROL_PARAM_NAME);

        if (null !== fcStr) {
            throw new IllegalArgumentException('unsupported unicast flow control strategy: fc=' + fcStr);
        }

        // Spec D25: no class loading. A strategy class name other than UnicastFlowControl is a ClassNotFoundException.
        if (Configuration.UNICAST_FLOW_CONTROL_STRATEGY === 'io.aeron.driver.UnicastFlowControl') {
            return new UnicastFlowControl();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(Configuration.UNICAST_FLOW_CONTROL_STRATEGY));
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return (
            'DefaultUnicastFlowControlSupplier{flowControlClass=' + Configuration.UNICAST_FLOW_CONTROL_STRATEGY + '}'
        );
    }
}
