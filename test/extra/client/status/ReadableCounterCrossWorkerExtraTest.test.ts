// Tests the port adds (issue #24; spec D16): `ReadableCounter.get()` reads `getLongVolatile(0)` of an 8 byte slice of the
// counters values buffer. The stripe of a long on a SharedArrayBuffer is chosen by its absolute address, so a slice and
// the `AtomicCounter` of the writer share the stripe: a read on one thread of `AtomicCounter.set(k * (2^32 + 1))` on
// another is never torn (its high int equals its low int).
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { runWorkers } from '../../../support/Workers.js';

const SCRIPT = new URL('./ReadableCounterCrossWorker.worker.ts', import.meta.url);
const WRITES = 200_000; // k * (2^32 + 1) stays below 2^53
const OVERLAP_READS = 1000;

describe('ReadableCounterCrossWorkerExtraTest', () => {
    it('readableCounterGetIsNeverTornAgainstAnAtomicCounterOnAnotherThreadRegression', async () => {
        const metadataBuffer = new SharedArrayBuffer(16 * CountersReader.METADATA_LENGTH);
        const valuesBuffer = new SharedArrayBuffer(16 * CountersReader.COUNTER_LENGTH);
        const control = new SharedArrayBuffer(64);
        const manager = new CountersManager(new UnsafeBuffer(metadataBuffer), new UnsafeBuffer(valuesBuffer));
        const counterId = manager.allocate('cross worker counter');
        const common = { metadata: metadataBuffer, values: valuesBuffer, control, counterId };

        const results = (await runWorkers(
            SCRIPT,
            [
                { kind: 'write', ...common, writes: WRITES, overlapReads: OVERLAP_READS },
                { kind: 'read', ...common, writes: WRITES, overlapReads: OVERLAP_READS },
            ],
            25_000,
        )) as [number, { reads: number; torn: number; first: string; distinct: number; last: number }];

        const reader = results[1];
        expect(results[0]).toBe(WRITES);
        // the reader read while the writer wrote, and every value it read was a value that was written
        expect(reader.reads).toBeGreaterThanOrEqual(OVERLAP_READS);
        expect(reader.distinct).toBeGreaterThan(1);
        expect(reader.torn, reader.first).toBe(0);
        expect(reader.last).toBe(WRITES * (2 ** 32 + 1));
    }, 30_000);
});
