// Not in Agrona: the stack trace text of the jdkThrowable stand-in, the DistinctErrorLog paths DistinctErrorLogTest does
// not reach (the same error thrown at the same place, a cause chain, a full log, a record that a reader on another view
// of the memory sees), and LoggingErrorHandler and CountedErrorHandler, which have no test in Agrona.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CountedErrorHandler } from '../../../src/agrona/concurrent/CountedErrorHandler.js';
import { DistinctErrorLog } from '../../../src/agrona/concurrent/errors/DistinctErrorLog.js';
import { ErrorLogReader } from '../../../src/agrona/concurrent/errors/ErrorLogReader.js';
import { LoggingErrorHandler } from '../../../src/agrona/concurrent/errors/LoggingErrorHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CachedEpochClock } from '../../../src/agrona/concurrent/CachedEpochClock.js';
import { Exception, IllegalStateException, NullPointerException, RuntimeException } from '../../../src/agrona/jdk.js';
import { StandardCharsets } from '../../../src/agrona/jdkLang.js';
import {
    getCause,
    printStackTrace,
    stackTraceFrames,
    stackTraceString,
    throwableToString,
    type PrintStream,
} from '../../../src/agrona/jdkThrowable.js';
import { assertThrows } from '../../support/Assertions.js';

function failAt(message: string): Error {
    return new RuntimeException(message);
}

describe('ErrorLogAndHandlersExtra', () => {
    describe('jdkThrowable', () => {
        it('toStringIsTheClassNameAndTheMessage', () => {
            expect(throwableToString(new IllegalStateException('bad'))).toBe('IllegalStateException: bad');
            expect(throwableToString(new IllegalStateException())).toBe('IllegalStateException');
            expect(throwableToString(new TypeError('t'))).toBe('TypeError: t');
        });

        it('theTraceIsTheHeaderThenOneTabAtLinePerFrame', () => {
            const error = failAt('boom');
            const lines = stackTraceString(error).split('\n');

            expect(lines[0]).toBe('RuntimeException: boom');
            expect(lines.length).toBeGreaterThan(2);
            expect(lines[1]).toMatch(/^\tat .*failAt/);
            expect(lines.at(-1)).toBe('');
            for (const line of lines.slice(1, -1)) {
                expect(line.startsWith('\tat ')).toBe(true);
            }
        });

        it('aCauseIsPrintedAfterCausedBy', () => {
            const error = new RuntimeException('outer', { cause: new Exception('inner') });
            const lines = stackTraceString(error).split('\n');

            expect(getCause(error)).toBeInstanceOf(Exception);
            expect(lines.filter((l) => l.startsWith('Caused by: Exception: inner'))).toHaveLength(1);
            expect(lines.indexOf('RuntimeException: outer')).toBe(0);
        });

        it('aCauseCycleTerminates', () => {
            const a = new RuntimeException('a');
            const b = new RuntimeException('b', { cause: a });
            (a as { cause?: unknown }).cause = b;

            expect(
                stackTraceString(a)
                    .split('\n')
                    .filter((l) => l.startsWith('Caused by: ')).length,
            ).toBe(1);
        });

        it('anErrorWithoutAStackHasNoFrames', () => {
            const error = new RuntimeException('no stack');
            error.stack = undefined;

            expect(stackTraceFrames(error)).toBe('');
            expect(stackTraceString(error)).toBe('RuntimeException: no stack\n');
        });

        it('printStackTracePrintsTheLinesOfTheTraceThroughPrintln', () => {
            const error = failAt('lines');
            const out: PrintStream = { println: vi.fn() };

            printStackTrace(error, out);

            const printed = (out.println as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
            expect(printed.join('\n') + '\n').toBe(stackTraceString(error));
        });
    });

    describe('DistinctErrorLog', () => {
        let buffer: UnsafeBuffer;
        let clock: CachedEpochClock;
        let log: DistinctErrorLog;

        beforeEach(() => {
            buffer = new UnsafeBuffer(new ArrayBuffer(8 * 1024));
            clock = new CachedEpochClock();
            log = new DistinctErrorLog(buffer, clock);
        });

        function readAll(): Array<[number, number, number, string]> {
            const out: Array<[number, number, number, string]> = [];
            ErrorLogReader.read(buffer, (count, first, last, text) => out.push([count, first, last, text]));
            return out;
        }

        it('theSameErrorThrownAtTheSamePlaceIsOneObservationEvenAsADifferentObject', () => {
            for (let i = 0; i < 5; i++) {
                clock.update(100 + i);
                expect(log.record(failAt('same'))).toBe(true);
            }

            const records = readAll();
            expect(records).toHaveLength(1);
            expect(records[0]![0]).toBe(5);
            expect(records[0]![1]).toBe(100);
            expect(records[0]![2]).toBe(104);
            expect(records[0]![3].startsWith('RuntimeException: same\n\tat ')).toBe(true);
        });

        it('theSameMessageAtADifferentPlaceIsADifferentObservation', () => {
            expect(log.record(failAt('same'))).toBe(true);
            expect(log.record(new RuntimeException('same'))).toBe(true);

            expect(readAll().map((r) => r[0])).toEqual([1, 1]);
        });

        it('theSameErrorWithADifferentCauseOrCallSiteIsADifferentObservation', () => {
            const make = (cause: string): Error => new RuntimeException('m', { cause: new Exception(cause) });
            expect(log.record(make('c1'))).toBe(true);
            expect(log.record(make('c2'))).toBe(true);
            expect(log.record(make('c1'))).toBe(true);

            // the third differs from the first only by where it was made (its call of make is on another line)
            expect(readAll().length).toBe(3);
        });

        it('recordsAreEightByteAlignedAndReadBackInOrder', () => {
            const errors = ['one', 'two', 'three'].map((m) => new IllegalStateException(m));
            for (const [i, e] of errors.entries()) {
                clock.update(10 * (i + 1));
                log.record(e);
            }

            const records = readAll();
            expect(records.map((r) => r[1])).toEqual([10, 20, 30]);
            expect(records.map((r) => r[3].split('\n')[0])).toEqual([
                'IllegalStateException: one',
                'IllegalStateException: two',
                'IllegalStateException: three',
            ]);
            expect(log.nextOffset % DistinctErrorLog.RECORD_ALIGNMENT).toBe(0);
        });

        it('aFullLogReturnsFalseAndKeepsWhatItHas', () => {
            const small = new UnsafeBuffer(new ArrayBuffer(4096));
            const full = new DistinctErrorLog(small, clock);
            let recorded = 0;
            let rejected = 0;
            for (let i = 0; i < 50; i++) {
                if (full.record(new RuntimeException('error number ' + i))) {
                    recorded++;
                } else {
                    rejected++;
                }
            }

            expect(recorded).toBeGreaterThan(0);
            expect(rejected).toBeGreaterThan(0);
            let read = 0;
            ErrorLogReader.read(small, () => read++);
            expect(read).toBe(recorded);
        });

        it('aReaderOnAnotherViewOfTheBufferSeesTheRecords', () => {
            const shared = new ArrayBuffer(4096);
            const writer = new DistinctErrorLog(new UnsafeBuffer(shared), clock);
            const reader = new UnsafeBuffer(shared);

            expect(ErrorLogReader.hasErrors(reader)).toBe(false);
            clock.update(42);
            writer.record(new RuntimeException('shared'));
            writer.record(new RuntimeException('shared again'));

            const seen: number[] = [];
            expect(ErrorLogReader.hasErrors(reader)).toBe(true);
            expect(ErrorLogReader.read(reader, (count, first) => seen.push(count, first))).toBe(2);
            expect(seen).toEqual([1, 42, 1, 42]);
        });

        it('aBufferTooSmallForAnyRecordHasNoErrors', () => {
            expect(ErrorLogReader.hasErrors(new UnsafeBuffer(new ArrayBuffer(0)))).toBe(false);
            expect(ErrorLogReader.read(new UnsafeBuffer(new ArrayBuffer(8)), () => expect.fail('no record'))).toBe(0);
        });

        it('theCharsetEncodesTheErrors', () => {
            const ascii = new DistinctErrorLog(buffer, clock, StandardCharsets.US_ASCII);
            expect(ascii.charset()).toBe(StandardCharsets.US_ASCII);
            expect(ascii.buffer()).toBe(buffer);
            expect(Array.from(ascii.encodedError(new RuntimeException('é'))).slice(0, 20)).toContain(0x3f);
        });
    });

    describe('LoggingErrorHandler', () => {
        let buffer: UnsafeBuffer;
        let log: DistinctErrorLog;
        let overflow: { println: ReturnType<typeof vi.fn<(line: string) => void>> };

        beforeEach(() => {
            buffer = new UnsafeBuffer(new ArrayBuffer(4096));
            log = new DistinctErrorLog(buffer, new CachedEpochClock());
            overflow = { println: vi.fn<(line: string) => void>() };
        });

        it('recordsToTheLogAndNothingOverflows', () => {
            const handler = new LoggingErrorHandler(log, overflow);

            handler.onError(new RuntimeException('logged'));

            expect(ErrorLogReader.read(buffer, () => {})).toBe(1);
            expect(overflow.println).not.toHaveBeenCalled();
            expect(handler.distinctErrorLog()).toBe(log);
            expect(handler.errorOverflow()).toBe(overflow);
        });

        it('aFullLogOverflowsWithTheMessageAndTheTrace', () => {
            const full = new DistinctErrorLog(new UnsafeBuffer(new ArrayBuffer(16)), new CachedEpochClock());
            const handler = new LoggingErrorHandler(full, overflow);
            const error = new RuntimeException('overflowing');

            handler.onError(error);

            const lines = overflow.println.mock.calls.map((c) => c[0]);
            expect(lines[0]).toBe('error log is full, consider increasing length of error buffer');
            expect(lines.slice(1).join('\n') + '\n').toBe(stackTraceString(error));
        });

        it('aClosedHandlerOverflowsWithoutWritingToTheLog', () => {
            const handler = new LoggingErrorHandler(log, overflow);
            expect(handler.isClosed()).toBe(false);

            handler.close();
            handler.onError(new RuntimeException('after close'));

            expect(handler.isClosed()).toBe(true);
            expect(overflow.println.mock.calls[0]![0]).toBe('error log is closed');
            expect(ErrorLogReader.hasErrors(buffer)).toBe(false);
        });

        it('aNullLogIsRejected', () => {
            assertThrows(NullPointerException, () => new LoggingErrorHandler(null as unknown as DistinctErrorLog));
        });
    });

    describe('CountedErrorHandler', () => {
        const COUNTER_ID = 1;
        let counter: AtomicCounter;

        beforeEach(() => {
            counter = new AtomicCounter(new UnsafeBuffer(new ArrayBuffer(2 * 128)), COUNTER_ID);
        });

        it('incrementsTheCounterThenDelegates', () => {
            const delegate = { onError: vi.fn<(e: Error) => void>() };
            const handler = new CountedErrorHandler(delegate, counter);
            const error = new RuntimeException('counted');

            let calls = 0;
            delegate.onError.mockImplementation(() => expect(counter.get()).toBe(++calls));
            handler.onError(error);
            handler.onError(error);

            expect(counter.get()).toBe(2);
            expect(delegate.onError).toHaveBeenCalledTimes(2);
            expect(delegate.onError).toHaveBeenCalledWith(error);
        });

        it('aClosedCounterIsNotIncrementedButTheErrorIsStillDelegated', () => {
            const delegate = { onError: vi.fn<(e: Error) => void>() };
            const handler = new CountedErrorHandler(delegate, counter);

            counter.close();
            handler.onError(new RuntimeException('x'));

            expect(delegate.onError).toHaveBeenCalledTimes(1);
        });

        it('aClosedHandlerPrintsToSystemErrAndDoesNotDelegateOrCount', () => {
            const delegate = { onError: vi.fn<(e: Error) => void>() };
            const handler = new CountedErrorHandler(delegate, counter);
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            try {
                expect(handler.isClosed()).toBe(false);
                handler.close();
                handler.onError(new RuntimeException('closed'));

                expect(handler.isClosed()).toBe(true);
                expect(delegate.onError).not.toHaveBeenCalled();
                expect(counter.get()).toBe(0);
                expect(consoleError.mock.calls[0]![0]).toBe('RuntimeException: closed');
            } finally {
                consoleError.mockRestore();
            }
        });

        it('nullArgumentsAreRejected', () => {
            const delegate = { onError: vi.fn<(e: Error) => void>() };
            assertThrows(NullPointerException, () => new CountedErrorHandler(null as never, counter));
            assertThrows(NullPointerException, () => new CountedErrorHandler(delegate, null as never));
        });
    });
});
