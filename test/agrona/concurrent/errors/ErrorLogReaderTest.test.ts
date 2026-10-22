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
// Port of org/agrona/concurrent/errors/ErrorLogReaderTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtomicBuffer } from '../../../../src/agrona/concurrent/AtomicBuffer.js';
import { DistinctErrorLog } from '../../../../src/agrona/concurrent/errors/DistinctErrorLog.js';
import type { ErrorConsumer } from '../../../../src/agrona/concurrent/errors/ErrorConsumer.js';
import { ErrorLogReader } from '../../../../src/agrona/concurrent/errors/ErrorLogReader.js';
import type { EpochClock } from '../../../../src/agrona/concurrent/EpochClock.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalStateException, Integer, RuntimeException } from '../../../../src/agrona/jdk.js';
import { stackTraceString } from '../../../../src/agrona/jdkThrowable.js';
import { expectInOrder } from '../../../support/InOrder.js';

const {
    ENCODED_ERROR_OFFSET,
    FIRST_OBSERVATION_TIMESTAMP_OFFSET,
    LAST_OBSERVATION_TIMESTAMP_OFFSET,
    LENGTH_OFFSET,
    OBSERVATION_COUNT_OFFSET,
} = DistinctErrorLog;

describe('ErrorLogReaderTest', () => {
    let buffer: AtomicBuffer;
    let clock: { time: ReturnType<typeof vi.fn<() => number>> };
    let log: DistinctErrorLog;

    beforeEach(() => {
        buffer = new UnsafeBuffer(new ArrayBuffer(64 * 1024));
        clock = { time: vi.fn<() => number>() };
        log = new DistinctErrorLog(buffer, clock as EpochClock);
    });

    it('shouldReadNoExceptionsFromEmptyLog', () => {
        const consumer = vi.fn<ErrorConsumer>();

        expect(ErrorLogReader.read(buffer, consumer)).toBe(0);

        expect(consumer).not.toHaveBeenCalled();
    });

    it('shouldReadFirstObservation', () => {
        const consumer = vi.fn<ErrorConsumer>();

        const timestamp = 7;
        const error = new RuntimeException('Test Error');

        clock.time.mockReturnValue(timestamp);

        log.record(error);

        expect(ErrorLogReader.read(buffer, consumer)).toBe(1);

        expect(consumer).toHaveBeenCalledTimes(1);
        expect(consumer).toHaveBeenCalledWith(1, timestamp, timestamp, expect.any(String));
    });

    it('shouldReadSummarisedObservation', () => {
        const consumer = vi.fn<ErrorConsumer>();

        const timestampOne = 7;
        const timestampTwo = 10;
        const error = new RuntimeException('Test Error');

        const errorAsString = stackTraceString(error);

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        log.record(error);
        log.record(error);

        expect(ErrorLogReader.read(buffer, consumer)).toBe(1);

        expect(consumer).toHaveBeenCalledTimes(1);
        expect(consumer).toHaveBeenCalledWith(2, timestampOne, timestampTwo, errorAsString);
    });

    it('shouldReadTwoDistinctObservations', () => {
        const consumer = vi.fn<ErrorConsumer>();

        const timestampOne = 7;
        const timestampTwo = 10;
        const errorOne = new RuntimeException('Test Error One');
        const errorTwo = new IllegalStateException('Test Error Two');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        log.record(errorOne);
        log.record(errorTwo);

        expect(ErrorLogReader.read(buffer, consumer)).toBe(2);

        expect(consumer).toHaveBeenCalledTimes(2);
        expect(consumer.mock.calls[0]).toEqual([1, timestampOne, timestampOne, expect.any(String)]);
        expect(consumer.mock.calls[1]).toEqual([1, timestampTwo, timestampTwo, expect.any(String)]);
        expectInOrder([consumer, 0], [consumer, 1]);
    });

    it('shouldReadOneObservationSinceTimestamp', () => {
        const consumer = vi.fn<ErrorConsumer>();

        const timestampOne = 7;
        const timestampTwo = 10;
        const errorOne = new RuntimeException('Test Error One');
        const errorTwo = new IllegalStateException('Test Error Two');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        expect(ErrorLogReader.hasErrors(buffer)).toBe(false);

        log.record(errorOne);
        log.record(errorTwo);

        expect(ErrorLogReader.hasErrors(buffer)).toBe(true);
        expect(ErrorLogReader.read(buffer, consumer, timestampTwo)).toBe(1);

        expect(consumer.mock.calls).toEqual([[1, timestampTwo, timestampTwo, expect.any(String)]]);
    });

    it('readShouldNotReadIfRemainingSpaceIsLessThanOneErrorPrefix', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        const lastTimestamp = 543495734;
        const firstTimestamp = lastTimestamp - 1000;
        const count = 123;
        const totalLength = 45;
        buffer.putInt(LENGTH_OFFSET, totalLength);
        buffer.putLong(LAST_OBSERVATION_TIMESTAMP_OFFSET, lastTimestamp);
        buffer.putLong(FIRST_OBSERVATION_TIMESTAMP_OFFSET, firstTimestamp);
        buffer.putInt(OBSERVATION_COUNT_OFFSET, count);
        buffer.putStringWithoutLengthAscii(ENCODED_ERROR_OFFSET, 'abcdefghijklmnopqrstuvwxyz');
        buffer.putInt(totalLength + LENGTH_OFFSET, 12);
        const errorConsumer = vi.fn<ErrorConsumer>();

        expect(ErrorLogReader.read(buffer, errorConsumer, 0)).toBe(1);

        expect(errorConsumer.mock.calls).toEqual([[count, firstTimestamp, lastTimestamp, 'abcdefghijklmnopqrstu']]);
    });

    it('shouldNotExceedEndOfBufferWhenReadinErrorMessage', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        buffer.setMemory(0, buffer.capacity(), '?'.charCodeAt(0));
        const lastTimestamp = 347923749327;
        const firstTimestamp = -8530458948593;
        const count = 999;
        buffer.putInt(LENGTH_OFFSET, Integer.MAX_VALUE);
        buffer.putLong(LAST_OBSERVATION_TIMESTAMP_OFFSET, lastTimestamp);
        buffer.putLong(FIRST_OBSERVATION_TIMESTAMP_OFFSET, firstTimestamp);
        buffer.putInt(OBSERVATION_COUNT_OFFSET, count);
        buffer.putStringWithoutLengthAscii(ENCODED_ERROR_OFFSET, 'test');
        const expectedErrorString = buffer.getStringWithoutLengthAscii(
            ENCODED_ERROR_OFFSET,
            buffer.capacity() - ENCODED_ERROR_OFFSET,
        );
        const errorConsumer = vi.fn<ErrorConsumer>();

        expect(ErrorLogReader.read(buffer, errorConsumer, 0)).toBe(1);

        expect(errorConsumer.mock.calls).toEqual([[count, firstTimestamp, lastTimestamp, expectedErrorString]]);
    });
});
