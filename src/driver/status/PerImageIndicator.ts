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
// Port of io/aeron/driver/status/PerImageIndicator.java @ 1.53.3
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { Aeron } from '../../client/Aeron.js';
import { AeronCounters } from '../../client/AeronCounters.js';
import { StreamCounter } from './StreamCounter.js';

/**
 * Allocates {@link AtomicCounter} indicating a per {@link io.aeron.driver.PublicationImage} indication of presence for
 * {@link io.aeron.driver.CongestionControl}.
 */
export class PerImageIndicator {
    /**
     * Type id of a per Image indicator.
     */
    public static readonly PER_IMAGE_TYPE_ID = AeronCounters.DRIVER_PER_IMAGE_TYPE_ID;

    private constructor() {}

    /**
     * Allocate a per {@link io.aeron.driver.PublicationImage} indicator.
     *
     * @param tempBuffer      to be used for labels and key.
     * @param name            of the counter for the label.
     * @param countersManager from which the underlying storage is allocated.
     * @param registrationId  associated with the counter.
     * @param sessionId       for the stream of messages.
     * @param streamId        for the stream of messages.
     * @param channel         for the stream of messages.
     * @return a new {@link AtomicCounter} for tracking the indicator.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        name: string,
        countersManager: CountersManager,
        registrationId: number,
        sessionId: number,
        streamId: number,
        channel: string,
    ): AtomicCounter {
        const counterId = StreamCounter.allocateCounterId(
            tempBuffer,
            name,
            PerImageIndicator.PER_IMAGE_TYPE_ID,
            countersManager,
            Aeron.NULL_VALUE,
            registrationId,
            sessionId,
            streamId,
            channel,
            Aeron.NULL_VALUE,
        );

        return new AtomicCounter(countersManager.valuesBuffer(), counterId, countersManager);
    }
}
