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
// Port of io/aeron/driver/status/PublisherLimit.java @ 1.53.3
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { UnsafeBufferPosition } from '../../agrona/concurrent/status/UnsafeBufferPosition.js';
import { Aeron } from '../../client/Aeron.js';
import { AeronCounters } from '../../client/AeronCounters.js';
import { StreamCounter } from './StreamCounter.js';

/**
 * The limit as a position in bytes applied to publishers on a session-channel-stream tuple. Publishers will experience
 * back pressure when this position is passed as a means of flow control.
 */
export class PublisherLimit {
    /**
     * Type id of a publisher limit counter.
     */
    public static readonly PUBLISHER_LIMIT_TYPE_ID = AeronCounters.DRIVER_PUBLISHER_LIMIT_TYPE_ID;

    /**
     * Human-readable name for the counter.
     */
    public static readonly NAME = 'pub-lmt';

    private constructor() {}

    /**
     * Allocate a new publisher limit counter for a stream.
     *
     * @param tempBuffer      to build the label.
     * @param countersManager to allocate the counter from.
     * @param clientId        to set as counter owner.
     * @param registrationId  associated with the counter.
     * @param sessionId       associated with the counter.
     * @param streamId        associated with the counter.
     * @param channel         associated with the counter.
     * @return the allocated counter.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        countersManager: CountersManager,
        clientId: number,
        registrationId: number,
        sessionId: number,
        streamId: number,
        channel: string,
    ): UnsafeBufferPosition {
        const counterId = StreamCounter.allocateCounterId(
            tempBuffer,
            PublisherLimit.NAME,
            PublisherLimit.PUBLISHER_LIMIT_TYPE_ID,
            countersManager,
            clientId,
            registrationId,
            sessionId,
            streamId,
            channel,
            Aeron.NULL_VALUE,
        );

        return new UnsafeBufferPosition(countersManager.valuesBuffer() as UnsafeBuffer, counterId, countersManager);
    }
}
