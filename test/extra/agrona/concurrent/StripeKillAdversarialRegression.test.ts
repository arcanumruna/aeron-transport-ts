// Kill tests of the T2b review (spec D16): a worker terminated while it holds a stripe leaves it odd for ever. That is
// outside the contract (a thread that uses shared buffers is never `terminate()`d while it can be inside a buffer
// operation), so what is tested is that the survivors FAIL LOUDLY (the dead-holder rule, 2^28 spins, here lowered)
// and do not hang. And every striped write, the halves methods included, stores the low half last.
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { mulberry32 } from '../../../support/Random.js';
import { runWorkers } from '../../../support/Workers.js';

const SCRIPT = new URL('./StripeKillAdversarial.worker.ts', import.meta.url);
const REGISTER_URL = new URL('../../../support/workerRegister.mjs', import.meta.url).href;
const DEAD_HOLDER_MESSAGE_TAIL =
    /LongStripes stripe \d+ held for 2\^28 spins: a writer died holding it \(worker terminated mid-write\?\)$/;
const TEST_SPIN_CAP = 1 << 20;
const INDEX = 64;

function parity(index: number): number {
    return Atomics.load(LongStripes.table()!, LongStripes.stripe(index)) & 1;
}

/** Makes a stripe even again, so that nothing after a test can hang on it. */
function repair(index: number): void {
    if (0 !== parity(index)) {
        Atomics.add(LongStripes.table()!, LongStripes.stripe(index), 1);
    }
}

describe('StripeKillAdversarialRegression', () => {
    it('aStripeLeftOddByATerminatedWriterFailsLoudlyInsteadOfHangingAdversarialRegression', async () => {
        const random = mulberry32(7);
        const words = [INDEX, INDEX + 8, INDEX + 16];
        let stuck = -1;
        let attempts = 0;
        // a writer is killed at a random instant; most kills land between operations, so hunt for one that lands inside
        // a write (hard cap on the attempts)
        for (; attempts < 150 && stuck < 0; attempts++) {
            const sab = new SharedArrayBuffer(4096);
            const worker = new Worker(SCRIPT, {
                workerData: {
                    kind: 'spin-writer',
                    buffer: sab,
                    index: INDEX,
                    count: 2_000_000_000,
                    barrier: 0,
                    workers: 1,
                },
                execArgv: ['--import', REGISTER_URL, '--no-warnings'],
            });
            await new Promise<void>((resolve, reject) => {
                worker.once('message', () => resolve());
                worker.once('error', reject);
            });
            await new Promise((resolve) => setTimeout(resolve, Math.floor(random() * 20)));
            await worker.terminate();
            stuck = words.find((w) => 0 !== parity(w)) ?? -1;
        }

        expect(stuck, 'no stripe was left odd by ' + attempts + ' terminated writers').toBeGreaterThanOrEqual(0);
        // a reader, a writer and a read-modify-write each fail loudly on the dead holder's stripe. They run in a worker
        // with the spin cap lowered (its own module instance), so that a missing dead-holder rule times the test out
        // and terminates the spinning worker, instead of hanging this thread
        try {
            const probe = (await runWorkers(
                SCRIPT,
                [{ kind: 'probe', buffer: new SharedArrayBuffer(4096), index: stuck, spinCap: TEST_SPIN_CAP }],
                15_000,
            )) as [{ name: string; error: string }[]];
            expect(probe[0].length).toBe(6);
            for (const { name, error } of probe[0]) {
                expect(error, name).toMatch(/^IllegalStateException: /);
                expect(error, name).toMatch(DEAD_HOLDER_MESSAGE_TAIL);
            }
        } finally {
            words.forEach(repair);
        }
    }, 25_000);

    it('halvesWritesStoreTheLowHalfLastAdversarialRegression', async () => {
        const sab = new SharedArrayBuffer(4096);
        const data = { buffer: sab, index: 64, count: 600_000, barrier: 1024, workers: 3 };
        const results = (await runWorkers(
            SCRIPT,
            [
                { kind: 'halves-writer', ...data },
                { kind: 'low-reader', ...data },
                { kind: 'low-reader', ...data },
            ],
            25_000,
        )) as [number, ...{ nonZero: number; violations: number; first: string }[]];
        for (const r of results.slice(1) as { nonZero: number; violations: number; first: string }[]) {
            expect(r.violations, r.first).toBe(0);
            expect(r.nonZero).toBeGreaterThan(0);
        }
    }, 30_000);
});
