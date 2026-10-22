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
// Port of org/agrona/concurrent/errors/DistinctErrorLogTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import type { AtomicBuffer } from '../../../../src/agrona/concurrent/AtomicBuffer.js';
import { CachedEpochClock } from '../../../../src/agrona/concurrent/CachedEpochClock.js';
import { DistinctErrorLog } from '../../../../src/agrona/concurrent/errors/DistinctErrorLog.js';
import { ErrorLogReader } from '../../../../src/agrona/concurrent/errors/ErrorLogReader.js';
import type { EpochClock } from '../../../../src/agrona/concurrent/EpochClock.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Exception, IllegalStateException, Integer, RuntimeException } from '../../../../src/agrona/jdk.js';

const {
    ENCODED_ERROR_OFFSET,
    FIRST_OBSERVATION_TIMESTAMP_OFFSET,
    INSUFFICIENT_SPACE,
    LAST_OBSERVATION_TIMESTAMP_OFFSET,
    LENGTH_OFFSET,
    OBSERVATION_COUNT_OFFSET,
    RECORD_ALIGNMENT,
} = DistinctErrorLog;

type Spy = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };

/**
 * Mockito's `InOrder`: each `verify` finds, after the call matched by the previous `verify`, a call of the spy whose
 * arguments satisfy the matcher, and returns its arguments (what an `ArgumentCaptor` captures).
 */
class InOrder {
    private previous = 0;

    public verify(name: string, spy: Spy, matches: (args: unknown[]) => boolean): unknown[] {
        const { calls, invocationCallOrder } = spy.mock;
        for (let i = 0; i < calls.length; i++) {
            if (invocationCallOrder[i]! > this.previous && matches(calls[i]!)) {
                this.previous = invocationCallOrder[i]!;
                return calls[i]!;
            }
        }

        return expect.fail(`no call of ${name} after the previous verified call matches`);
    }
}

/** `eq(x)` on an argument that is a `byte[]`, a `Uint8Array`. */
function sameBytes(actual: unknown, expected: Uint8Array): boolean {
    return (
        actual instanceof Uint8Array && actual.length === expected.length && actual.every((b, i) => b === expected[i])
    );
}

/**
 * `spy(throwable)` for the one thing the tests verify about it: `printStackTrace` is not called, or called once. The
 * stand-in for `printStackTrace` reads `name`, `message`, `stack` and `cause`; the proxy records every property read.
 */
function spyThrowable<T extends Error>(error: T): { error: T; reads: Array<string | symbol> } {
    const reads: Array<string | symbol> = [];
    const proxy = new Proxy(error, {
        get(target, property): unknown {
            reads.push(property);
            return Reflect.get(target, property) as unknown;
        },
    });

    return { error: proxy, reads };
}

/** A fake `AtomicBuffer` (`mock(AtomicBuffer.class)`) with the members the log uses recording their calls. */
function mockBuffer(capacity: number): {
    buffer: AtomicBuffer;
    putBytes: ReturnType<typeof vi.fn>;
    putLong: ReturnType<typeof vi.fn>;
    putIntRelease: ReturnType<typeof vi.fn>;
} {
    const putBytes = vi.fn();
    const putLong = vi.fn();
    const putIntRelease = vi.fn();
    const buffer = {
        capacity: () => capacity,
        verifyAlignment: vi.fn(),
        putBytes,
        putLong,
        putIntRelease,
    } as unknown as AtomicBuffer;

    return { buffer, putBytes, putLong, putIntRelease };
}

class TestEvent extends RuntimeException {
    public constructor(message: string) {
        super(message);
        // fillInStackTrace() returns this, without filling in the stack trace
        this.stack = undefined;
    }
}

describe('DistinctErrorLogTest', () => {
    const DIRECT = new ArrayBuffer(32 * 1024);
    const DIRECT_BUFFER = new UnsafeBuffer(DIRECT);

    let buffer: UnsafeBuffer;
    let putBytes: ReturnType<typeof vi.spyOn>;
    let putLong: ReturnType<typeof vi.spyOn>;
    let putIntRelease: ReturnType<typeof vi.spyOn>;
    let getAndAddInt: ReturnType<typeof vi.spyOn>;
    let putLongRelease: ReturnType<typeof vi.spyOn>;
    let clock: { time: ReturnType<typeof vi.fn<() => number>> };
    let log: DistinctErrorLog;

    beforeEach(() => {
        // spy(DIRECT_BUFFER): a second view of the same memory whose calls are recorded and go through
        buffer = new UnsafeBuffer(DIRECT);
        putBytes = vi.spyOn(buffer, 'putBytes');
        putLong = vi.spyOn(buffer, 'putLong');
        putIntRelease = vi.spyOn(buffer, 'putIntRelease');
        getAndAddInt = vi.spyOn(buffer, 'getAndAddInt');
        putLongRelease = vi.spyOn(buffer, 'putLongRelease');
        clock = { time: vi.fn<() => number>() };
        log = new DistinctErrorLog(buffer, clock as EpochClock);

        DIRECT_BUFFER.setMemory(0, DIRECT_BUFFER.capacity(), 0);
    });

    /** The five calls of recording a new observation at `offset`, then the two of observing it again. */
    function verifyNewObservation(inOrder: InOrder, offset: number, timestamp: number): number {
        inOrder.verify(
            'putBytes',
            putBytes,
            (a) => a[0] === offset + ENCODED_ERROR_OFFSET && a[1] instanceof Uint8Array,
        );
        inOrder.verify(
            'putLong',
            putLong,
            (a) => a[0] === offset + FIRST_OBSERVATION_TIMESTAMP_OFFSET && a[1] === timestamp,
        );
        const lengthArgs = inOrder.verify('putIntRelease', putIntRelease, (a) => a[0] === offset + LENGTH_OFFSET);
        verifyObservation(inOrder, offset, timestamp);

        return lengthArgs[1] as number;
    }

    function verifyObservation(inOrder: InOrder, offset: number, timestamp: number): void {
        inOrder.verify('getAndAddInt', getAndAddInt, (a) => a[0] === offset + OBSERVATION_COUNT_OFFSET && a[1] === 1);
        inOrder.verify(
            'putLongRelease',
            putLongRelease,
            (a) => a[0] === offset + LAST_OBSERVATION_TIMESTAMP_OFFSET && a[1] === timestamp,
        );
    }

    it('shouldRecordFirstObservation', () => {
        const timestamp = 7;
        const offset = 0;
        const error = new RuntimeException('Test Error');

        clock.time.mockReturnValue(timestamp);

        expect(log.record(error)).toBe(true);

        const inOrder = new InOrder();
        verifyNewObservation(inOrder, offset, timestamp);
    });

    it('shouldRecordFirstObservationOnly', () => {
        const timestampOne = 7;
        const timestampTwo = 8;
        const offset = 0;
        const error = new RuntimeException('Test Error');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        expect(log.record(error)).toBe(true);
        expect(log.record(error)).toBe(true);

        const inOrder = new InOrder();
        verifyNewObservation(inOrder, offset, timestampOne);
        verifyObservation(inOrder, offset, timestampTwo);
    });

    it('shouldRecordDifferentMessage', () => {
        const timestampOne = 7;
        const timestampTwo = 8;
        const offset = 0;
        const errorOne = new Exception('Error 1');
        const errorTwo = new Exception('Error 2');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        expect(log.record(errorOne)).toBe(true);
        expect(log.record(errorTwo)).toBe(true);

        const inOrder = new InOrder();
        const length = verifyNewObservation(inOrder, offset, timestampOne);

        const recordTwoOffset = BitUtil.align(length, RECORD_ALIGNMENT);

        verifyNewObservation(inOrder, recordTwoOffset, timestampTwo);
    });

    it('shouldSummariseObservations', () => {
        const timestampOne = 7;
        const timestampTwo = 10;
        const offset = 0;
        const error = new RuntimeException('Test Error');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        expect(log.record(error)).toBe(true);
        expect(log.record(error)).toBe(true);

        const inOrder = new InOrder();
        verifyNewObservation(inOrder, offset, timestampOne);
        verifyObservation(inOrder, offset, timestampTwo);
    });

    it('shouldRecordTwoDistinctObservations', () => {
        const timestampOne = 7;
        const timestampTwo = 10;
        const offset = 0;
        const errorOne = new RuntimeException('Test Error One');
        const errorTwo = new IllegalStateException('Test Error Two');

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        expect(log.record(errorOne)).toBe(true);
        expect(log.record(errorTwo)).toBe(true);

        const inOrder = new InOrder();
        const length = verifyNewObservation(inOrder, offset, timestampOne);

        const recordTwoOffset = BitUtil.align(length, RECORD_ALIGNMENT);

        verifyNewObservation(inOrder, recordTwoOffset, timestampTwo);
    });

    it('shouldRecordTwoDistinctObservationsOnCause', () => {
        const timestampOne = 7;
        const timestampTwo = 10;
        const offset = 0;

        clock.time.mockReturnValueOnce(timestampOne).mockReturnValue(timestampTwo);

        for (let i = 0; i < 2; i++) {
            expect(
                log.record(
                    i === 1
                        ? new RuntimeException('One')
                        : new RuntimeException('One', { cause: new Exception('Cause') }),
                ),
            ).toBe(true);
        }

        const inOrder = new InOrder();
        const length = verifyNewObservation(inOrder, offset, timestampOne);

        const recordTwoOffset = BitUtil.align(length, RECORD_ALIGNMENT);

        verifyNewObservation(inOrder, recordTwoOffset, timestampTwo);
    });

    it.each([0, 24])('shouldExitEarlyWhenInsufficientSpaceToRecordAnyInformation %i', (capacity) => {
        const timestamp = 7;
        const { error, reads } = spyThrowable(new RuntimeException('Test Error'));

        clock.time.mockReturnValue(timestamp);
        vi.spyOn(buffer, 'capacity').mockReturnValue(capacity);

        expect(log.record(error)).toBe(false);

        // verifyNoMoreInteractions(error)
        expect(reads).toEqual([]);
    });

    it('shouldFailToRecordWhenInsufficientSpace', () => {
        const timestamp = 7;
        const { error, reads } = spyThrowable(new RuntimeException('Test Error'));

        clock.time.mockReturnValue(timestamp);
        vi.spyOn(buffer, 'capacity').mockReturnValue(42);

        expect(log.record(error)).toBe(false);

        // verify(error).printStackTrace(any(PrintWriter.class)): the stack trace is read once
        expect(reads.filter((p) => p === 'stack')).toHaveLength(1);
    });

    it('shouldTestRecordingWithoutStackTrace', () => {
        const clock = new CachedEpochClock();
        const log = new DistinctErrorLog(DIRECT_BUFFER, clock);

        clock.advance(10);
        log.record(new TestEvent('event one'));

        clock.advance(10);
        log.record(new TestEvent('event one'));

        clock.advance(10);
        log.record(new TestEvent('event two'));

        expect(ErrorLogReader.hasErrors(DIRECT_BUFFER)).toBe(true);

        let sb = '';
        const errorCount = ErrorLogReader.read(
            DIRECT_BUFFER,
            (observationCount, firstObservationTimestamp, lastObservationTimestamp, encodedException) => {
                sb +=
                    String(observationCount) +
                    ',' +
                    String(firstObservationTimestamp) +
                    ',' +
                    String(lastObservationTimestamp) +
                    ',' +
                    encodedException;
            },
        );

        expect(errorCount).toBe(2);

        const expectedOutput = '2,10,20,TestEvent: event one' + '\n' + '1,30,30,TestEvent: event two' + '\n';
        expect(sb).toBe(expectedOutput);
    });

    it.each([
        [-1, 1000000],
        [1024, 1024],
        [1000, 1024],
        [32, 48],
        [2147483647, 2147483647],
        [2147483623, 2147483647],
    ])('shouldReportInsufficientSpaceIfNextOffsetPointsBeyondTheBufferEnd %i %i', (nextOffset, capacity) => {
        const { buffer } = mockBuffer(capacity);
        const distinctErrorLog = new DistinctErrorLog(buffer, clock as EpochClock);
        distinctErrorLog.nextOffset = nextOffset;

        expect(distinctErrorLog.newObservation(100, new Exception('test'))).toBe(INSUFFICIENT_SPACE);
    });

    // The stack trace of the Exception is several KB under JUnit and at most 10 frames in V8, so the message is
    // padded to make the encoded error longer than the space left, as the Java stack trace is.
    it.each([
        [0, 1024],
        [2147480000, 2147483647],
    ])('shouldReportInsufficientSpaceIfExceptionDoesNotFitIntoTheEndOfTheBuffer %i %i', (nextOffset, capacity) => {
        const { buffer } = mockBuffer(capacity);
        const distinctErrorLog = new DistinctErrorLog(buffer, clock as EpochClock);
        distinctErrorLog.nextOffset = nextOffset;

        expect(distinctErrorLog.newObservation(100, new Exception('test' + '!'.repeat(4096)))).toBe(INSUFFICIENT_SPACE);
    });

    it('shouldWriteErrorAtEndOfTheBuffer', () => {
        const exception = new IllegalStateException('my exception');
        const encodedError = log.encodedError(exception);
        const length = encodedError.length + ENCODED_ERROR_OFFSET;
        const offset = 1024;
        const timestamp = 742394728347923;

        const { buffer, putBytes, putLong, putIntRelease } = mockBuffer(offset + length);
        const distinctErrorLog = new DistinctErrorLog(buffer, clock as EpochClock);
        distinctErrorLog.nextOffset = offset;

        const observation = distinctErrorLog.newObservation(timestamp, exception);
        expect(observation).not.toBe(INSUFFICIENT_SPACE);
        expect(observation).not.toBeNull();
        expect(observation.offset()).toBe(offset);
        expect(observation.throwable()).toBe(exception);

        expect(distinctErrorLog.nextOffset).toBe(BitUtil.align(offset + length, RECORD_ALIGNMENT));
        expect(distinctErrorLog.nextOffset).toBeGreaterThanOrEqual(buffer.capacity());

        const inOrder = new InOrder();
        inOrder.verify(
            'putBytes',
            putBytes,
            (a) => a[0] === offset + ENCODED_ERROR_OFFSET && sameBytes(a[1], encodedError),
        );
        inOrder.verify(
            'putLong',
            putLong,
            (a) => a[0] === offset + FIRST_OBSERVATION_TIMESTAMP_OFFSET && a[1] === timestamp,
        );
        inOrder.verify('putIntRelease', putIntRelease, (a) => a[0] === offset + LENGTH_OFFSET && a[1] === length);
    });

    it.each([0, 1, 2, 3, 4, 5, 6, 7, RECORD_ALIGNMENT])(
        'shouldWriteErrorAtEndOfTheBufferWithNextOffsetOverflow %i',
        (suffixLength) => {
            const exception = new IllegalStateException('my exception' + '!'.repeat(suffixLength));
            const encodedError = log.encodedError(exception);
            const length = encodedError.length + ENCODED_ERROR_OFFSET;
            const offset = Integer.MAX_VALUE - length;
            expect(offset + length).toBeGreaterThan(0);
            expect(BitUtil.align(offset + length, RECORD_ALIGNMENT)).toBeLessThan(0);
            const timestamp = 742394728347923;

            const { buffer, putBytes, putLong, putIntRelease } = mockBuffer(Integer.MAX_VALUE);
            const distinctErrorLog = new DistinctErrorLog(buffer, clock as EpochClock);
            distinctErrorLog.nextOffset = offset;

            const observation = distinctErrorLog.newObservation(timestamp, exception);
            expect(observation).not.toBe(INSUFFICIENT_SPACE);
            expect(observation).not.toBeNull();
            expect(observation.offset()).toBe(offset);
            expect(observation.throwable()).toBe(exception);

            expect(distinctErrorLog.nextOffset).toBe(BitUtil.align(offset + length, RECORD_ALIGNMENT));
            expect(distinctErrorLog.nextOffset).toBeLessThan(0);

            const inOrder = new InOrder();
            inOrder.verify(
                'putBytes',
                putBytes,
                (a) => a[0] === offset + ENCODED_ERROR_OFFSET && sameBytes(a[1], encodedError),
            );
            inOrder.verify(
                'putLong',
                putLong,
                (a) => a[0] === offset + FIRST_OBSERVATION_TIMESTAMP_OFFSET && a[1] === timestamp,
            );
            inOrder.verify('putIntRelease', putIntRelease, (a) => a[0] === offset + LENGTH_OFFSET && a[1] === length);
        },
    );
});
