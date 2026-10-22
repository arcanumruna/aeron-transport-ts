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
// Port of io/aeron/status/HeartbeatTimestamp.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { AeronCounters } from '../AeronCounters.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { KEY_OFFSET, NULL_COUNTER_ID, RECORD_ALLOCATED, RECORD_UNUSED, metaDataOffset } = CountersReader;

/**
 * Allocate a counter for tracking the last heartbeat of an entity with a given registration id.
 */
export class HeartbeatTimestamp {
    private constructor() {}

    /**
     * Type id of a heartbeat counter.
     */
    public static readonly HEARTBEAT_TYPE_ID = AeronCounters.DRIVER_HEARTBEAT_TYPE_ID;

    /**
     * Offset in the key metadata for the registration id of the counter.
     */
    public static readonly REGISTRATION_ID_OFFSET = 0;

    /**
     * Allocate a counter for tracking the last heartbeat of an entity.
     *
     * @param tempBuffer      to be used for labels and key.
     * @param name            of the counter for the label.
     * @param typeId          of the counter for classification.
     * @param countersManager from which the underlying storage is allocated.
     * @param registrationId  to be associated with the counter.
     * @return a new {@link AtomicCounter} for tracking the last heartbeat.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        name: string,
        typeId: number,
        countersManager: CountersManager,
        registrationId: number,
    ): AtomicCounter {
        return new AtomicCounter(
            countersManager.valuesBuffer(),
            HeartbeatTimestamp.allocateCounterId(tempBuffer, name, typeId, countersManager, registrationId),
            countersManager,
        );
    }

    /**
     * Allocate a counter id for tracking the last heartbeat of an entity.
     *
     * @param tempBuffer      to be used for labels and key.
     * @param name            of the counter for the label.
     * @param typeId          of the counter for classification.
     * @param countersManager from which the underlying storage is allocated.
     * @param registrationId  to be associated with the counter.
     * @return the counter id to be used.
     */
    public static allocateCounterId(
        tempBuffer: MutableDirectBuffer,
        name: string,
        typeId: number,
        countersManager: CountersManager,
        registrationId: number,
    ): number {
        tempBuffer.putLong(HeartbeatTimestamp.REGISTRATION_ID_OFFSET, registrationId);
        const keyLength = HeartbeatTimestamp.REGISTRATION_ID_OFFSET + SIZE_OF_LONG;
        const labelOffset = BitUtil.align(keyLength, SIZE_OF_INT);
        let labelLength = 0;
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, name);
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ': id=');
        labelLength += tempBuffer.putLongAscii(labelOffset + labelLength, registrationId);

        return countersManager.allocate(typeId, tempBuffer, 0, keyLength, tempBuffer, labelOffset, labelLength);
    }

    /**
     * Find the active counter id for a heartbeat timestamp.
     *
     * @param countersReader to search within.
     * @param counterTypeId  to match on.
     * @param registrationId for the active client.
     * @return the counter id if found otherwise {@link CountersReader.NULL_COUNTER_ID}.
     */
    public static findCounterIdByRegistrationId(
        countersReader: CountersReader,
        counterTypeId: number,
        registrationId: number,
    ): number {
        const buffer = countersReader.metaDataBuffer();

        for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
            const counterState = countersReader.getCounterState(counterId);

            if (counterState === RECORD_ALLOCATED) {
                if (
                    countersReader.getCounterTypeId(counterId) === counterTypeId &&
                    buffer.getLong(
                        metaDataOffset(counterId) + KEY_OFFSET + HeartbeatTimestamp.REGISTRATION_ID_OFFSET,
                    ) === registrationId
                ) {
                    return counterId;
                }
            } else if (RECORD_UNUSED === counterState) {
                break;
            }
        }

        return NULL_COUNTER_ID;
    }

    /**
     * Is the counter active for usage? Checks to see if reclaimed or reused and matches registration id.
     *
     * @param countersReader to search within.
     * @param counterId      to test.
     * @param counterTypeId  to validate type.
     * @param registrationId for the entity.
     * @return true if still valid otherwise false.
     */
    public static isActive(
        countersReader: CountersReader,
        counterId: number,
        counterTypeId: number,
        registrationId: number,
    ): boolean {
        const buffer = countersReader.metaDataBuffer();
        const recordOffset = CountersReader.metaDataOffset(counterId);

        return (
            countersReader.getCounterTypeId(counterId) === counterTypeId &&
            buffer.getLong(recordOffset + KEY_OFFSET + HeartbeatTimestamp.REGISTRATION_ID_OFFSET) === registrationId &&
            countersReader.getCounterState(counterId) === RECORD_ALLOCATED
        );
    }
}
