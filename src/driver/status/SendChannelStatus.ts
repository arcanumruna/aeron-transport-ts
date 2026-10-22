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
// Port of io/aeron/driver/status/SendChannelStatus.java @ 1.53.3
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { AeronCounters } from '../../client/AeronCounters.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';

/**
 * The status of a sending channel endpoint represented as a counter value.
 */
export class SendChannelStatus {
    /**
     * Type id of a sending channel status indicator.
     */
    public static readonly SEND_CHANNEL_STATUS_TYPE_ID = AeronCounters.DRIVER_SEND_CHANNEL_STATUS_TYPE_ID;

    /**
     * Human-readable name for the counter.
     */
    public static readonly NAME = 'snd-channel';

    private constructor() {}

    /**
     * Allocate a new channel status counter for a stream.
     *
     * @param tempBuffer      to build the label.
     * @param countersManager to allocate the counter from.
     * @param registrationId  associated with the counter.
     * @param channel         associated with the counter.
     * @return the allocated counter.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        countersManager: CountersManager,
        registrationId: number,
        channel: string,
    ): AtomicCounter {
        return ChannelEndpointStatus.allocate(
            tempBuffer,
            SendChannelStatus.NAME,
            SendChannelStatus.SEND_CHANNEL_STATUS_TYPE_ID,
            countersManager,
            registrationId,
            channel,
        );
    }
}
