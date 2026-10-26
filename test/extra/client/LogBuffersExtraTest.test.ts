// Extra tests of T19 (port-only, spec D4, D91): `LogBuffers` over the logs of the driver, which are in memory and found by
// name: a client that holds a log keeps reading it after the driver has freed it (the driver empties its own windows),
// the reference count and the linger deadline are plain fields, and a name that is not a log is an error.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalStateException, Long } from '../../../src/agrona/jdk.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { LogBuffers } from '../../../src/client/LogBuffers.js';
import { MemoryLogBuffersFactory } from '../../../src/client/MemoryLogBuffersFactory.js';
import { MemoryLogFactory } from '../../../src/driver/buffer/MemoryLogFactory.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { assertThrowsExactly } from '../../support/Assertions.js';

const { LOG_META_DATA_LENGTH, PAGE_MIN_SIZE, PARTITION_COUNT, TERM_MIN_LENGTH } = LogBufferDescriptor;

function newFactory(): MemoryLogFactory {
    const counters = new UnsafeBuffer(new SharedArrayBuffer(1024));
    return new MemoryLogFactory(4096, null, new AtomicCounter(counters, 0));
}

function newLog(factory: MemoryLogFactory) {
    const rawLog = factory.newPublication(42, TERM_MIN_LENGTH, false);
    LogBufferDescriptor.termLength(rawLog.metaData(), TERM_MIN_LENGTH);
    LogBufferDescriptor.pageSize(rawLog.metaData(), PAGE_MIN_SIZE);
    return rawLog;
}

describe('LogBuffers extra', () => {
    it('windowsOnTheTermsAndTheMetaDataOfTheLogOfTheDriver', () => {
        const factory = newFactory();
        const rawLog = newLog(factory);

        const logBuffers = new LogBuffers(rawLog.fileName(), factory);

        expect(logBuffers.termLength()).toBe(TERM_MIN_LENGTH);
        expect(logBuffers.metaDataBuffer().capacity()).toBe(LOG_META_DATA_LENGTH);
        const terms = logBuffers.duplicateTermBuffers();
        expect(terms).toHaveLength(PARTITION_COUNT);
        for (const term of terms) {
            expect(term.capacity()).toBe(TERM_MIN_LENGTH);
        }
        expect(logBuffers.fileChannel()).toBeNull();

        // the same memory as the driver's: a write by the driver is read by the client
        (rawLog.termBuffers()[1] as UnsafeBuffer).putInt(128, 0x1234567);
        expect(terms[1]?.getInt(128)).toBe(0x1234567);
        expect(logBuffers.duplicateTermBuffers()[1]?.getInt(128)).toBe(0x1234567);
        // every call makes new windows
        expect(logBuffers.duplicateTermBuffers()[0]).not.toBe(terms[0]);
    });

    it('theClientKeepsReadingALogThatTheDriverHasFreed', () => {
        const factory = newFactory();
        const rawLog = newLog(factory);
        const logBuffers = new LogBuffers(rawLog.fileName(), factory);
        const term = logBuffers.duplicateTermBuffers()[0] as UnsafeBuffer;
        (rawLog.termBuffers()[0] as UnsafeBuffer).putInt(64, 77);

        rawLog.free();

        expect(factory.lookup(rawLog.fileName())).toBeNull();
        expect(term.getInt(64)).toBe(77);
        expect(logBuffers.duplicateTermBuffers()[0]?.getInt(64)).toBe(77);
        expect(LogBufferDescriptor.termLength(logBuffers.metaDataBuffer())).toBe(TERM_MIN_LENGTH);
    });

    it('closeEmptiesTheWindowsOfTheClientAndLeavesTheLogOfTheDriver', () => {
        const factory = newFactory();
        const rawLog = newLog(factory);
        const logBuffers = new LogBuffers(rawLog.fileName(), factory);
        (rawLog.termBuffers()[0] as UnsafeBuffer).putInt(0, 5);

        logBuffers.close();

        expect(logBuffers.metaDataBuffer().capacity()).toBe(0);
        expect(logBuffers.duplicateTermBuffers()[0]?.capacity()).toBe(0);
        expect((rawLog.termBuffers()[0] as UnsafeBuffer).getInt(0)).toBe(5);
        expect(factory.lookup(rawLog.fileName())).toBe(rawLog);
    });

    it('aNameThatIsNotALogIsAnError', () => {
        const factory = newFactory();

        const exception = assertThrowsExactly(
            IllegalStateException,
            () => new LogBuffers('no/such.logbuffer', factory),
        );
        expect(exception.message).toBe('Log not found: no/such.logbuffer');
        assertThrowsExactly(IllegalStateException, () => new MemoryLogBuffersFactory(factory).map('no/such.logbuffer'));
    });

    it('theFactoryMapsTheLogByItsName', () => {
        const factory = newFactory();
        const rawLog = newLog(factory);

        const logBuffers = new MemoryLogBuffersFactory(factory).map(rawLog.fileName());

        expect(logBuffers.termLength()).toBe(TERM_MIN_LENGTH);
    });

    it('referenceCountAndLingerDeadline', () => {
        const factory = newFactory();
        const logBuffers = new LogBuffers(newLog(factory).fileName(), factory);

        expect(logBuffers.lingerDeadlineNs()).toBe(Long.MAX_VALUE);
        expect(logBuffers.incRef()).toBe(1);
        expect(logBuffers.incRef()).toBe(2);
        expect(logBuffers.decRef()).toBe(1);
        expect(logBuffers.decRef()).toBe(0);
        logBuffers.lingerDeadlineNs(123);
        expect(logBuffers.lingerDeadlineNs()).toBe(123);
    });

    it('preTouchTouchesEveryPageWithoutChangingTheLog', () => {
        const factory = newFactory();
        const rawLog = newLog(factory);
        const logBuffers = new LogBuffers(rawLog.fileName(), factory);
        (rawLog.termBuffers()[2] as UnsafeBuffer).putInt(PAGE_MIN_SIZE, 9);

        logBuffers.preTouch();

        expect((rawLog.termBuffers()[2] as UnsafeBuffer).getInt(PAGE_MIN_SIZE)).toBe(9);
        expect(LogBufferDescriptor.pageSize(logBuffers.metaDataBuffer())).toBe(PAGE_MIN_SIZE);
    });
});
