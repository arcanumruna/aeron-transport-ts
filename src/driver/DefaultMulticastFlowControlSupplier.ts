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
// Port of io/aeron/driver/DefaultMulticastFlowControlSupplier.java @ 1.53.3
import { ClassNotFoundException, IllegalArgumentException } from '../agrona/jdk.js';
import { LangUtil } from '../agrona/LangUtil.js';
import { CommonContext } from '../client/CommonContext.js';
import { Configuration } from './Configuration.js';
import type { FlowControl } from './FlowControl.js';
import type { FlowControlSupplier } from './FlowControlSupplier.js';
import { MaxMulticastFlowControl } from './MaxMulticastFlowControl.js';
import type { UdpChannel } from './media/UdpChannel.js';

/**
 * Default supplier of {@link FlowControl} strategies for multicast streams which supports defining the strategy in
 * the channel URI as a priority over {@link Configuration#MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME}.
 * <p>
 * Only the `max` strategy is ported (phase 3 adds `min` and `tagged`): another URI value is an
 * `IllegalArgumentException`, another property value a `ClassNotFoundException` (spec D25).
 */
export class DefaultMulticastFlowControlSupplier implements FlowControlSupplier {
    public newInstance(udpChannel: UdpChannel, _streamId: number, _registrationId: number): FlowControl {
        const fcStr = udpChannel.channelUri().get(CommonContext.FLOW_CONTROL_PARAM_NAME);
        if (null !== fcStr) {
            const delimiter = fcStr.indexOf(',');
            const strategyStr = -1 === delimiter ? fcStr : fcStr.substring(0, delimiter);

            if (MaxMulticastFlowControl.FC_PARAM_VALUE === strategyStr) {
                return new MaxMulticastFlowControl();
            }

            throw new IllegalArgumentException('unsupported multicast flow control strategy: fc=' + fcStr);
        }

        if ('io.aeron.driver.MaxMulticastFlowControl' === Configuration.MULTICAST_FLOW_CONTROL_STRATEGY) {
            return new MaxMulticastFlowControl();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY));
    }

    public toString(): string {
        return (
            'DefaultMulticastFlowControlSupplier{flowControlClass=' +
            Configuration.MULTICAST_FLOW_CONTROL_STRATEGY +
            '}'
        );
    }
}
