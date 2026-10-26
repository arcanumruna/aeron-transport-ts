// Extra tests of T15 (port-only, spec D4, D35): the in-memory log factory that stands in for `FileStoreLogFactory`.
import { describe, expect, it } from 'vitest';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { StandardCharsets } from '../../../../src/agrona/jdkLang.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { MemoryLogFactory } from '../../../../src/driver/buffer/MemoryLogFactory.js';
import { assertThrows } from '../../../support/Assertions.js';

const { TERM_MIN_LENGTH, LOG_META_DATA_LENGTH, PARTITION_COUNT } = LogBufferDescriptor;
const PAGE = 4096;

function newFactory(singleBufferLimit?: number): { factory: MemoryLogFactory; mapped: () => number } {
    const manager = new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(4096)),
        new UnsafeBuffer(new ArrayBuffer(1024)),
        StandardCharsets.US_ASCII,
    );
    const counter = manager.newCounter('mapped');
    return { factory: new MemoryLogFactory(PAGE, null, counter, singleBufferLimit), mapped: () => counter.get() };
}

describe('MemoryLogFactoryExtraTest', () => {
    it('a log is three terms and the meta data in the last bytes of one shared buffer, as the log file is', () => {
        const { factory, mapped } = newFactory();
        const log = factory.newPublication(7, TERM_MIN_LENGTH, false);

        const logLength = LogBufferDescriptor.computeLogLength(TERM_MIN_LENGTH, PAGE);
        expect(mapped()).toBe(logLength);
        expect(log.termLength()).toBe(TERM_MIN_LENGTH);
        expect(log.termBuffers().length).toBe(PARTITION_COUNT);
        expect(log.metaData().capacity()).toBe(LOG_META_DATA_LENGTH);
        expect(log.metaData().wrapAdjustment()).toBe(logLength - LOG_META_DATA_LENGTH);
        log.termBuffers().forEach((term, i) => {
            expect(term.capacity()).toBe(TERM_MIN_LENGTH);
            expect(term.wrapAdjustment()).toBe(i * TERM_MIN_LENGTH);
        });
        expect(log.fileName()).toBe('publications/7.logbuffer');
    });

    it('the logs are found by name until they are freed; a name is used once', () => {
        const { factory, mapped } = newFactory();
        const publication = factory.newPublication(1, TERM_MIN_LENGTH, true);
        const image = factory.newImage(1, TERM_MIN_LENGTH, false);

        expect(image.fileName()).toBe('images/1.logbuffer');
        expect(factory.lookup('publications/1.logbuffer')).toBe(publication);
        expect(factory.lookup('images/1.logbuffer')).toBe(image);
        expect(factory.lookup('images/2.logbuffer')).toBeNull();
        assertThrows(Error, () => factory.newPublication(1, TERM_MIN_LENGTH, false));

        expect(publication.free()).toBe(true);
        expect(publication.free()).toBe(true);
        expect(factory.lookup('publications/1.logbuffer')).toBeNull();
        expect(factory.logCount()).toBe(1);
        expect(publication.termBuffers().every((t) => 0 === t.capacity())).toBe(true);
        expect(mapped()).toBe(LogBufferDescriptor.computeLogLength(TERM_MIN_LENGTH, PAGE));
        factory.newPublication(1, TERM_MIN_LENGTH, false); // the name is free again

        factory.close();
        expect(factory.logCount()).toBe(0);
        expect(mapped()).toBe(0);
    });

    it('a log above the limit of one buffer has a buffer for each term and one for the meta data', () => {
        const { factory } = newFactory(TERM_MIN_LENGTH);
        const log = factory.newPublication(3, TERM_MIN_LENGTH, false);

        expect(log.metaData().capacity()).toBe(LOG_META_DATA_LENGTH);
        expect(log.metaData().wrapAdjustment() + LOG_META_DATA_LENGTH).toBe(
            PAGE * Math.ceil(LOG_META_DATA_LENGTH / PAGE),
        );
        log.termBuffers().forEach((t) => expect(t.wrapAdjustment()).toBe(0));
    });

    it('the terms are zero and aligned, so that a NetworkPublication accepts them', () => {
        const { factory } = newFactory();
        const log = factory.newPublication(5, TERM_MIN_LENGTH, false);

        for (const term of log.termBuffers()) {
            term.verifyAlignment();
            expect(term.getLongVolatile(0)).toBe(0);
        }
        log.metaData().verifyAlignment();
    });
});
