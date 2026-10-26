// Tests the port adds (issue #47): a matcher that formats a real Publication, Image, Subscription, LogBuffers or
// UnsafeBuffer must not walk the 16 MiB log buffers they hold (vitest ran out of memory in `expect(a).not.toBe(b)`).
// `toJSON` (pretty-format) and `[Symbol.for('nodejs.util.inspect.custom')]` (util.inspect) give a short summary.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { LogBuffers } from '../../../src/client/LogBuffers.js';
import { MemoryLogFactory } from '../../../src/driver/buffer/MemoryLogFactory.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../support/Backing.js';
import { ClientRig } from '../../support/ClientRig.js';

const MAX_LENGTH = 2000;

function expectShort(value: object): void {
    expect(inspect(value, { depth: 10 }).length).toBeLessThan(MAX_LENGTH);
    expect(JSON.stringify(value).length).toBeLessThan(MAX_LENGTH);
}

describe.each([ARRAY_BACKING, SHARED_BACKING])('InspectExtraTest over $name', (backing) => {
    it('realClientObjectsHaveAShortInspectAndJsonFormRegression', () => {
        const rig = new ClientRig({ backing, termLength: 16 * 1024 * 1024 });
        expectShort(rig.publication);
        expectShort(rig.image);
        expectShort(rig.subscription);
        expectShort(rig.logBuffers);
        expectShort(rig.logBuffers.metaDataBuffer());
        expectShort(rig.logBuffers.duplicateTermBuffers()[0]!);
    });

    it('aMatcherOnTwoRealPublicationsDoesNotFormatTheirLogsRegression', () => {
        const a = new ClientRig({ backing, termLength: 16 * 1024 * 1024 });
        const b = new ClientRig({ backing, termLength: 16 * 1024 * 1024 });
        expect(a.publication).not.toBe(b.publication);
        expect(a.image).not.toBe(b.image);
        let message = '';
        try {
            expect(a.publication).toBe(b.publication);
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message.length).toBeGreaterThan(0);
        expect(message.length).toBeLessThan(10 * MAX_LENGTH);
    });
});

describe('InspectExtraTest', () => {
    it('theSummaryNamesTheIdentityNotTheBytesRegression', () => {
        const rig = new ClientRig();
        const publication = JSON.parse(JSON.stringify(rig.publication)) as Record<string, unknown>;
        expect(publication.registrationId).toBe(ClientRig.REGISTRATION_ID);
        expect(publication.streamId).toBe(rig.streamId);
        expect(publication.sessionId).toBe(rig.sessionId);
        const buffer = JSON.parse(JSON.stringify(new UnsafeBuffer(new ArrayBuffer(64)))) as Record<string, unknown>;
        expect(buffer.capacity).toBe(64);
    });

    it('aLogBuffersFromTheDriverHasAShortFormRegression', () => {
        const factory = new MemoryLogFactory(
            4096,
            null,
            new AtomicCounter(new UnsafeBuffer(new SharedArrayBuffer(1024)), 0),
        );
        const rawLog = factory.newPublication(42, LogBufferDescriptor.TERM_MIN_LENGTH, false);
        LogBufferDescriptor.termLength(rawLog.metaData(), LogBufferDescriptor.TERM_MIN_LENGTH);
        LogBufferDescriptor.pageSize(rawLog.metaData(), LogBufferDescriptor.PAGE_MIN_SIZE);
        expectShort(new LogBuffers(rawLog.fileName(), factory));
    });
});
