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
// Port of org/agrona/concurrent/errors/ErrorLogReader.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { DistinctErrorLog } from './DistinctErrorLog.js';
import type { ErrorConsumer } from './ErrorConsumer.js';

const { SIZE_OF_INT, align } = BitUtil;
const {
    ENCODED_ERROR_OFFSET,
    FIRST_OBSERVATION_TIMESTAMP_OFFSET,
    LAST_OBSERVATION_TIMESTAMP_OFFSET,
    LENGTH_OFFSET,
    OBSERVATION_COUNT_OFFSET,
    RECORD_ALIGNMENT,
} = DistinctErrorLog;

/**
 * Reader for the log created by a {@link DistinctErrorLog} encoded as UTF-8 errors.
 * <p>
 * The read methods are thread safe.
 */
export class ErrorLogReader {
    private constructor() {}

    /**
     * Has the error buffer any recorded errors?
     *
     * @param buffer containing the {@link DistinctErrorLog}.
     * @return true if there is at least one error.
     */
    public static hasErrors(buffer: AtomicBuffer): boolean {
        return buffer.capacity() >= SIZE_OF_INT && buffer.getIntVolatile(LENGTH_OFFSET) > 0;
    }

    /**
     * Read all the errors in a log since a given timestamp, or since the creation of the log if the timestamp is
     * omitted. The two Java overloads {@code read(buffer, consumer)} and {@code read(buffer, consumer, sinceTimestamp)}
     * are this one method.
     *
     * @param buffer         containing the {@link DistinctErrorLog}.
     * @param consumer       to be called for each exception encountered.
     * @param sinceTimestamp for filtering errors that have been recorded since this time.
     * @return the number of entries that has been read.
     */
    public static read(buffer: AtomicBuffer, consumer: ErrorConsumer, sinceTimestamp = 0): number {
        let entries = 0;
        let offset = 0;
        const capacity = buffer.capacity();

        while (offset <= capacity - ENCODED_ERROR_OFFSET) {
            const length = Math.min(buffer.getIntVolatile(offset + LENGTH_OFFSET), capacity - offset);
            if (length <= 0) {
                break;
            }

            const lastObservationTimestamp = buffer.getLongVolatile(offset + LAST_OBSERVATION_TIMESTAMP_OFFSET);
            if (lastObservationTimestamp >= sinceTimestamp) {
                ++entries;

                consumer(
                    buffer.getInt(offset + OBSERVATION_COUNT_OFFSET),
                    buffer.getLong(offset + FIRST_OBSERVATION_TIMESTAMP_OFFSET),
                    lastObservationTimestamp,
                    buffer.getStringWithoutLengthUtf8(offset + ENCODED_ERROR_OFFSET, length - ENCODED_ERROR_OFFSET),
                );
            }

            offset += align(length, RECORD_ALIGNMENT);
        }

        return entries;
    }
}
