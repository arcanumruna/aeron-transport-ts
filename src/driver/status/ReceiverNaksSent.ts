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
// Port of io/aeron/driver/status/ReceiverNaksSent.java @ 1.53.3
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { Aeron } from '../../client/Aeron.js';
import { AeronCounters } from '../../client/AeronCounters.js';
import { StreamCounter } from './StreamCounter.js';

/**
 * Count the number of NAK messages sent by the Receiver. This is a per-stream event count for
 * that which is aggregated in {@link SystemCounterDescriptor#NAK_MESSAGES_SENT}.
 */
export class ReceiverNaksSent {
    /**
     * Type id of a counter.
     */
    public static readonly TYPE_ID = AeronCounters.DRIVER_RECEIVER_NAKS_SENT_TYPE_ID;

    /**
     * Human-readable name for the counter.
     */
    public static readonly NAME = 'rcv-naks-sent';

    private constructor() {}

    /**
     * Allocate a new sender back-pressure counter for a stream.
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
    ): AtomicCounter {
        const counterId = StreamCounter.allocateCounterId(
            tempBuffer,
            ReceiverNaksSent.NAME,
            ReceiverNaksSent.TYPE_ID,
            countersManager,
            clientId,
            registrationId,
            sessionId,
            streamId,
            channel,
            Aeron.NULL_VALUE,
        );

        return new AtomicCounter(countersManager.valuesBuffer(), counterId, countersManager);
    }
}
