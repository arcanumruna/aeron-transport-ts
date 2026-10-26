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
// Port of io/aeron/driver/status/StatusUtil.java @ 1.53.3
import { MutableInteger } from '../../agrona/collections/MutableInteger.js';
import { type CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { type StatusIndicator } from '../../agrona/concurrent/status/StatusIndicator.js';
import { type StatusIndicatorReader } from '../../agrona/concurrent/status/StatusIndicatorReader.js';
import { UnsafeBufferStatusIndicator } from '../../agrona/concurrent/status/UnsafeBufferStatusIndicator.js';
import { Aeron } from '../../client/Aeron.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';
import { ReceiveChannelStatus } from './ReceiveChannelStatus.js';
import { SendChannelStatus } from './SendChannelStatus.js';
import { SystemCounterDescriptor } from './SystemCounterDescriptor.js';

/**
 * Functions for working with status counters.
 */
export class StatusUtil {
    private constructor() {}

    /**
     * Return the controllable idle strategy {@link StatusIndicator}.
     *
     * @param countersReader that holds the status indicator.
     * @return status indicator to use or null if not found.
     */
    public static controllableIdleStrategy(countersReader: CountersReader): StatusIndicator | null {
        let statusIndicator: StatusIndicator | null = null;
        const id = new MutableInteger(-1);

        countersReader.forEach((counterId, label) => {
            if (
                counterId === SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY.id() &&
                label === SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY.label()
            ) {
                id.value = counterId;
            }
        });

        if (Aeron.NULL_VALUE !== id.value) {
            statusIndicator = new UnsafeBufferStatusIndicator(countersReader.valuesBuffer(), id.value);
        }

        return statusIndicator;
    }

    /**
     * Return the read-only status indicator for the given send channel URI.
     *
     * @param countersReader that holds the status indicator.
     * @param channel        for the send channel.
     * @return read-only status indicator that can be used to query the status of the send channel or null.
     * @see ChannelEndpointStatus for status values and indications.
     */
    public static sendChannelStatus(countersReader: CountersReader, channel: string): StatusIndicatorReader | null {
        let statusReader: StatusIndicatorReader | null = null;
        const id = new MutableInteger(-1);

        countersReader.forEachMetaData((counterId, typeId, keyBuffer) => {
            if (typeId === SendChannelStatus.SEND_CHANNEL_STATUS_TYPE_ID) {
                if (channel.startsWith(keyBuffer.getStringAscii(ChannelEndpointStatus.CHANNEL_OFFSET))) {
                    id.value = counterId;
                }
            }
        });

        if (Aeron.NULL_VALUE !== id.value) {
            statusReader = new UnsafeBufferStatusIndicator(countersReader.valuesBuffer(), id.value);
        }

        return statusReader;
    }

    /**
     * Return the read-only status indicator for the given receive channel URI.
     *
     * @param countersReader that holds the status indicator.
     * @param channel        for the receive channel.
     * @return read-only status indicator that can be used to query the status of the receive channel or null.
     * @see ChannelEndpointStatus for status values and indications.
     */
    public static receiveChannelStatus(countersReader: CountersReader, channel: string): StatusIndicatorReader | null {
        let statusReader: StatusIndicatorReader | null = null;
        const id = new MutableInteger(-1);

        countersReader.forEachMetaData((counterId, typeId, keyBuffer) => {
            if (typeId === ReceiveChannelStatus.RECEIVE_CHANNEL_STATUS_TYPE_ID) {
                if (channel.startsWith(keyBuffer.getStringAscii(ChannelEndpointStatus.CHANNEL_OFFSET))) {
                    id.value = counterId;
                }
            }
        });

        if (Aeron.NULL_VALUE !== id.value) {
            statusReader = new UnsafeBufferStatusIndicator(countersReader.valuesBuffer(), id.value);
        }

        return statusReader;
    }
}
