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
// Port of org/agrona/concurrent/errors/DistinctErrorLog.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { getCause, stackTraceFrames, stackTraceString } from '../../jdkThrowable.js';
import { StandardCharsets, type Charset } from '../../jdkLang.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import type { EpochClock } from '../EpochClock.js';

const { SIZE_OF_INT, SIZE_OF_LONG, align } = BitUtil;

/**
 * The {@code record DistinctObservation(Throwable throwable, int offset)}: an error and the offset of its record.
 * The throwable of the insufficient space marker is null.
 */
export class DistinctObservation {
    private readonly _throwable: Error | null;
    private readonly _offset: number = 0;

    public constructor(throwable: Error | null, offset: number) {
        this._throwable = throwable;
        this._offset = offset;
    }

    public throwable(): Error | null {
        return this._throwable;
    }

    public offset(): number {
        return this._offset;
    }
}

/**
 * Distinct record of error observations. Rather than grow a record indefinitely when many errors of the same type
 * are logged, this log takes the approach of only recording distinct errors of the same type and stack trace
 * and keeping a count and time of observation so that the record only grows with new distinct observations.
 * <p>
 * The provided {@link AtomicBuffer} can wrap a {@code SharedArrayBuffer} so the log can be read from another thread
 * (the CnC error log, spec D4 and D16).
 * <p>
 * <b>Note regarding threads:</b> Java's class is threadsafe to be used from multiple logging threads, with a
 * {@code synchronized} block around the search and the append. Here there is one logging thread per log (spec D3):
 * the block is not ported, and two threads must not share a {@code DistinctErrorLog} (each has its own
 * {@code nextOffset}). A reader on another thread uses the {@link ErrorLogReader}.
 * <p>
 * <b>Note regarding stack traces:</b> the encoded error is {@code Throwable.printStackTrace} text as the
 * {@code jdkThrowable} stand-in prints it from {@code error.stack} (spec D18); two errors are the same observation if
 * their classes, messages, causes and stack frames are equal.
 * <p>
 * The error records are recorded to the memory mapped buffer in the following format.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |R|                         Length                              |
 *  +-+-------------------------------------------------------------+
 *  |R|                    Observation Count                        |
 *  +-+-------------------------------------------------------------+
 *  |R|                Last Observation Timestamp                   |
 *  |                                                               |
 *  +-+-------------------------------------------------------------+
 *  |R|               First Observation Timestamp                   |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                        Encoded Error                         ...
 * ...                                                              |
 *  +---------------------------------------------------------------+
 * </pre>
 * The timestamps are {@code number}s holding a Java {@code long} (spec D5).
 */
export class DistinctErrorLog {
    /**
     * Offset within a record at which the length field begins.
     */
    public static readonly LENGTH_OFFSET = 0;

    /**
     * Offset within a record at which the observation count field begins.
     */
    public static readonly OBSERVATION_COUNT_OFFSET = SIZE_OF_INT;

    /**
     * Offset within a record at which the last observation timestamp field begins.
     */
    public static readonly LAST_OBSERVATION_TIMESTAMP_OFFSET = DistinctErrorLog.OBSERVATION_COUNT_OFFSET + SIZE_OF_INT;

    /**
     * Offset within a record at which the first observation timestamp field begins.
     */
    public static readonly FIRST_OBSERVATION_TIMESTAMP_OFFSET =
        DistinctErrorLog.LAST_OBSERVATION_TIMESTAMP_OFFSET + SIZE_OF_LONG;

    /**
     * Offset within a record at which the encoded exception field begins.
     */
    public static readonly ENCODED_ERROR_OFFSET = DistinctErrorLog.FIRST_OBSERVATION_TIMESTAMP_OFFSET + SIZE_OF_LONG;

    /**
     * Alignment to be applied for record beginning.
     */
    public static readonly RECORD_ALIGNMENT = SIZE_OF_LONG;

    /** @internal */
    public static readonly INSUFFICIENT_SPACE: DistinctObservation = new DistinctObservation(null, 0);

    private readonly clock: EpochClock;
    private readonly _buffer: AtomicBuffer;
    private readonly _charset: Charset;
    private distinctObservations: DistinctObservation[] = [];
    /** @internal */
    public nextOffset = 0;

    /**
     * Create a new error log that will be written to a provided {@link AtomicBuffer}.
     * <p>
     * The {@link Charset} defaults to UTF-8 for encoding the exceptions.
     *
     * @param buffer  into which the observation records are recorded.
     * @param clock   to be used for time stamping records.
     * @param charset for encoding the errors.
     */
    public constructor(buffer: AtomicBuffer, clock: EpochClock, charset: Charset = StandardCharsets.UTF_8) {
        buffer.verifyAlignment();
        this.clock = clock;
        this._buffer = buffer;
        this._charset = charset;
    }

    /**
     * Buffer the error log is written to.
     *
     * @return buffer the error log is written to.
     */
    public buffer(): AtomicBuffer {
        return this._buffer;
    }

    /**
     * {@link Charset} used to encode errors.
     *
     * @return the {@link Charset} used to encode errors.
     */
    public charset(): Charset {
        return this._charset;
    }

    /**
     * Record an observation of an error. If it is the first observation of this error type for a stack trace
     * then a new entry will be created. For subsequent observations of the same error type and stack trace a
     * counter and time of last observation will be updated.
     *
     * @param exception to be logged as an error observation.
     * @return true if successfully logged otherwise false if insufficient space remaining in the log.
     */
    public record(exception: Error): boolean {
        const timestampMs = this.clock.time();
        let distinctObservation = DistinctErrorLog.find(this.distinctObservations, exception);

        if (null === distinctObservation) {
            distinctObservation = this.newObservation(timestampMs, exception);
            if (DistinctErrorLog.INSUFFICIENT_SPACE === distinctObservation) {
                return false;
            }
        }

        const offset = distinctObservation.offset();
        this._buffer.getAndAddInt(offset + DistinctErrorLog.OBSERVATION_COUNT_OFFSET, 1);
        this._buffer.putLongRelease(offset + DistinctErrorLog.LAST_OBSERVATION_TIMESTAMP_OFFSET, timestampMs);

        return true;
    }

    private static find(
        existingObservations: readonly DistinctObservation[],
        exception: Error,
    ): DistinctObservation | null {
        for (const o of existingObservations) {
            if (DistinctErrorLog.equals(o.throwable()!, exception)) {
                return o;
            }
        }

        return null;
    }

    private static equals(lhs: Error | null, rhs: Error | null): boolean {
        for (;;) {
            if (lhs === rhs) {
                return true;
            }

            if (
                null !== lhs &&
                null !== rhs &&
                lhs.constructor === rhs.constructor &&
                lhs.message === rhs.message &&
                stackTraceFrames(lhs) === stackTraceFrames(rhs)
            ) {
                lhs = getCause(lhs);
                rhs = getCause(rhs);

                if (null === lhs && null === rhs) {
                    return true;
                } else if (null !== lhs && null !== rhs) {
                    continue;
                }
            }

            return false;
        }
    }

    /** @internal */
    public newObservation(timestampMs: number, exception: Error): DistinctObservation {
        const offset = this.nextOffset;
        if (offset < 0) {
            // handle overflow case
            return DistinctErrorLog.INSUFFICIENT_SPACE;
        }

        const remainingCapacity = (this._buffer.capacity() - DistinctErrorLog.ENCODED_ERROR_OFFSET - offset) | 0;
        if (remainingCapacity <= 0) {
            return DistinctErrorLog.INSUFFICIENT_SPACE;
        }

        const encodedError = this.encodedError(exception);
        if (((remainingCapacity - encodedError.length) | 0) < 0) {
            return DistinctErrorLog.INSUFFICIENT_SPACE;
        }

        const length = DistinctErrorLog.ENCODED_ERROR_OFFSET + encodedError.length;
        this._buffer.putBytes(offset + DistinctErrorLog.ENCODED_ERROR_OFFSET, encodedError);
        this._buffer.putLong(offset + DistinctErrorLog.FIRST_OBSERVATION_TIMESTAMP_OFFSET, timestampMs);
        this.nextOffset = align(offset + length, DistinctErrorLog.RECORD_ALIGNMENT);

        const distinctObservation = new DistinctObservation(exception, offset);
        this.distinctObservations = DistinctErrorLog.prepend(this.distinctObservations, distinctObservation);
        this._buffer.putIntRelease(offset + DistinctErrorLog.LENGTH_OFFSET, length);

        return distinctObservation;
    }

    /** @internal */
    public encodedError(observation: Error): Uint8Array {
        return this._charset.encode(stackTraceString(observation));
    }

    private static prepend(
        observations: readonly DistinctObservation[],
        observation: DistinctObservation,
    ): DistinctObservation[] {
        const length = observations.length;
        const newObservations = new Array<DistinctObservation>(length + 1);

        newObservations[0] = observation;
        for (let i = 0; i < length; i++) {
            newObservations[i + 1] = observations[i]!;
        }

        return newObservations;
    }
}
