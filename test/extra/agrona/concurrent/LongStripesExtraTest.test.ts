// Tests the port adds (spec D16): the striped lock table behind the 64-bit atomics of UnsafeBuffer.
import { setEnvironmentData } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { IllegalStateException } from '../../../../src/agrona/jdk.js';
import { mulberry32 } from '../../../support/Random.js';
import { runWorkers } from '../../../support/Workers.js';

const SCRIPT = new URL('./LongStripes.worker.ts', import.meta.url);

describe('LongStripesExtraTest', () => {
    it('stripeIsAMultipleOfTheStrideInsideTheTable', () => {
        const random = mulberry32(42);
        for (let i = 0; i < 10_000; i++) {
            const address = Math.floor(random() * 536_870_912) * 8; // 0 .. 2^32 - 8
            const stripe = LongStripes.stripe(address);
            expect(stripe % LongStripes.STRIPE_STRIDE, String(address)).toBe(0);
            expect(stripe, String(address)).toBeGreaterThanOrEqual(0);
            expect(stripe, String(address)).toBeLessThan(LongStripes.TABLE_LENGTH / 4);
        }
        expect(LongStripes.stripe(2 ** 32 - 8) % LongStripes.STRIPE_STRIDE).toBe(0);

        // the 1024 counter value addresses of consecutive counters (a record is 128 bytes) spread over the table
        const distinct = new Set<number>();
        for (let k = 0; k < 1024; k++) {
            distinct.add(LongStripes.stripe(k * 128));
        }
        expect(distinct.size).toBeGreaterThanOrEqual(512);
    });

    it('workerSeesTheSameTable', async () => {
        const table = LongStripes.table()!;
        expect(table).not.toBeNull();
        expect(table.buffer).toBeInstanceOf(SharedArrayBuffer);
        expect(table.byteLength).toBe(LongStripes.TABLE_LENGTH);
        try {
            const results = await runWorkers(SCRIPT, [{ kind: 'add' }], 20_000);
            expect(results[0]).toBe(0);
            expect(Atomics.load(table, 0)).toBe(7);
        } finally {
            Atomics.store(table, 0, 0);
        }
    }, 30_000);

    it('wrapOfSharedArrayBufferInWorkerWithoutTableThrows', async () => {
        const table = LongStripes.table()!;
        setEnvironmentData(LongStripes.ENVIRONMENT_KEY, undefined);
        let results: unknown[];
        try {
            results = await runWorkers(SCRIPT, [{ kind: 'wrap' }], 20_000);
        } finally {
            setEnvironmentData(LongStripes.ENVIRONMENT_KEY, table.buffer);
        }
        expect(results[0]).toEqual({
            name: IllegalStateException.name,
            message:
                'No LongStripes table in this worker: start workers after LongStripes is loaded on the main thread',
        });
    }, 30_000);
});
