// Tests the port adds (spec D16): the 64-bit atomics of UnsafeBuffer on a SharedArrayBuffer across worker_threads. The
// striped lock makes a long exact for any number of writers and readers; the Java tests are single threaded.
import { describe, expect, it } from 'vitest';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { runWorkers } from '../../../support/Workers.js';

const SCRIPT = new URL('./SharedLongAtomics.worker.ts', import.meta.url);
const TIMEOUT_MS = 25_000;
const INDEX = 64;
const TWO_POW_32 = 4294967296;
const FRAME_PASSES = 400;

interface Reader {
    reads: number;
    violations: number;
    first: string;
    sawFinal: boolean;
}

function worker(kind: string, buffer: SharedArrayBuffer, workers: number, extra: Record<string, number>): unknown {
    return {
        kind,
        buffer,
        workers,
        barrier: 0,
        index: INDEX,
        index2: 0,
        count: 0,
        multiplier: 0,
        multiplier2: 0,
        start: 0,
        ...extra,
    };
}

describe('SharedLongAtomicsWorkersExtraTest', () => {
    // k * (2^32 + 1) for k up to count: both halves change on every write. With many readers and writes, a reader that
    // loads the stripe before a whole write and again after it is common, so a stripe that comes back to the value it had
    // (an unlock that adds nothing) is caught every time: only the sequence number in the stripe tells it.
    it('readersNeverSeeATornLong', async () => {
        const sab = new SharedArrayBuffer(4096);
        const multiplier = TWO_POW_32 + 1;
        const count = 2_000_000;
        const rounds = 5;
        const readers = 5;
        const results = (await runWorkers(
            SCRIPT,
            [
                worker('pattern-writer', sab, 1 + readers, { count, multiplier, rounds }),
                ...Array.from({ length: readers }, () =>
                    worker('pattern-reader', sab, 1 + readers, { count, multiplier, rounds }),
                ),
            ],
            TIMEOUT_MS,
        )) as [number, ...Reader[]];

        expect(results[0]).toBe(count * rounds);
        const violations = (results.slice(1) as Reader[]).reduce((sum, reader) => sum + reader.violations, 0);
        expect(violations, (results.slice(1) as Reader[]).find((reader) => reader.violations > 0)?.first).toBe(0);
        for (const reader of results.slice(1) as Reader[]) {
            expect(reader.sawFinal).toBe(true);
            expect(reader.reads).toBeGreaterThan(0);
        }
        expect(new UnsafeBuffer(sab).getLongVolatile(INDEX)).toBe(count * multiplier);
    }, 30_000);

    it('concurrentGetAndAddLongIsExact', async () => {
        const sab = new SharedArrayBuffer(4096);
        const buffer = new UnsafeBuffer(sab);
        const workers = 4;
        const count = 200_000;
        const start = TWO_POW_32 - 400_000;
        buffer.putLongVolatile(INDEX, start);

        const sums = (await runWorkers(
            SCRIPT,
            Array.from({ length: workers }, () => worker('add', sab, workers, { count })),
            TIMEOUT_MS,
        )) as number[];

        const total = workers * count;
        expect(buffer.getLongVolatile(INDEX)).toBe(start + total);
        // every value start .. start + total - 1 was returned exactly once
        expect(sums.reduce((a, b) => a + b, 0)).toBe(total * start + (total * (total - 1)) / 2);
    }, 30_000);

    it('concurrentCompareAndSetLongIncrementIsExact', async () => {
        const sab = new SharedArrayBuffer(4096);
        const buffer = new UnsafeBuffer(sab);
        const workers = 4;
        const count = 100_000;
        const start = TWO_POW_32 - 200_000;
        buffer.putLongVolatile(INDEX, start);

        const failures = (await runWorkers(
            SCRIPT,
            Array.from({ length: workers }, () => worker('cas', sab, workers, { count })),
            TIMEOUT_MS,
        )) as number[];

        expect(buffer.getLongVolatile(INDEX)).toBe(start + workers * count);
        // the retry loop was exercised: the workers did contend
        expect(failures.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }, 30_000);

    it('sameStripeDifferentWordsDoNotInterfere', async () => {
        const sab = new SharedArrayBuffer(1 << 20);
        const a = INDEX;
        let b = a + 8;
        while (LongStripes.stripe(b) !== LongStripes.stripe(a)) {
            b += 8;
            if (b + 8 > sab.byteLength) {
                throw new Error('no address on the stripe of ' + a);
            }
        }
        const count = 500_000;
        const multiplierA = TWO_POW_32 + 1;
        const multiplierB = TWO_POW_32 + 3;
        const results = (await runWorkers(
            SCRIPT,
            [
                worker('pattern-writer', sab, 4, { index: a, count, multiplier: multiplierA }),
                worker('pattern-writer', sab, 4, { index: b, count, multiplier: multiplierB }),
                worker('pattern-reader', sab, 4, {
                    index: a,
                    index2: b,
                    count,
                    multiplier: multiplierA,
                    multiplier2: multiplierB,
                }),
                worker('pattern-reader', sab, 4, {
                    index: a,
                    index2: b,
                    count,
                    multiplier: multiplierA,
                    multiplier2: multiplierB,
                }),
            ],
            TIMEOUT_MS,
        )) as [number, number, Reader, Reader];

        for (const reader of results.slice(2) as Reader[]) {
            expect(reader.violations, reader.first).toBe(0);
            expect(reader.sawFinal).toBe(true);
        }
        const buffer = new UnsafeBuffer(sab);
        expect(buffer.getLongVolatile(a)).toBe(count * multiplierA);
        expect(buffer.getLongVolatile(b)).toBe(count * multiplierB);
    }, 30_000);

    // Aeron readers read only the low int of a 64-bit word, without the stripe (frameLengthVolatile after the release
    // store of the first header word); the high half, which holds version, flags and type, must be visible by then.
    it('lowHalfIsWrittenLastSoAnIntReaderSeesTheHighHalfRegression', async () => {
        const sab = new SharedArrayBuffer(4096);
        const count = 1_000_000;
        const results = (await runWorkers(
            SCRIPT,
            [
                worker('low-writer', sab, 3, { count }),
                worker('low-reader', sab, 3, { count }),
                worker('low-reader', sab, 3, { count }),
            ],
            TIMEOUT_MS,
        )) as [number, ...{ reads: number; nonZero: number; violations: number; first: string; sawFinal: boolean }[]];

        for (const reader of results.slice(1) as {
            nonZero: number;
            violations: number;
            first: string;
            sawFinal: boolean;
        }[]) {
            expect(reader.violations, reader.first).toBe(0);
            expect(reader.sawFinal).toBe(true);
            expect(reader.nonZero).toBeGreaterThan(0);
        }
    }, 30_000);

    // This guards the int order of TermRebuilder.insert itself, not the striped writes: the type, flags and the rest of
    // the header (plain ints) are written BEFORE the length (putIntRelease), so a reader that sees a positive length
    // (frameLengthVolatile) sees the type too. Written the other way round, a frame reads as type 0, padding, which is
    // silent loss. The passes (re-inserting 4096 frames each) are enough for the swapped order to be caught every time.
    it('termRebuilderFrameNeverReadsAsPaddingAcrossThreadsRegression', async () => {
        const frames = 4096 * 64;
        const sab = new SharedArrayBuffer(frames + 64);
        const barrier = frames + 4;
        const passes = FRAME_PASSES;
        const results = (await runWorkers(
            SCRIPT,
            [
                worker('frame-writer', sab, 2, { barrier, count: passes }),
                worker('frame-reader', sab, 2, { barrier, count: passes }),
            ],
            TIMEOUT_MS,
        )) as [number, { scans: number; frames: number; violations: number; first: string }];

        expect(results[0]).toBe(passes * 4096);
        expect(results[1].violations, results[1].first).toBe(0);
        expect(results[1].frames).toBeGreaterThan(0);
    }, 30_000);
});
