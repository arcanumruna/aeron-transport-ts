// Tests the port adds (spec D16, 8.2): UnsafeBuffer over a SharedArrayBuffer, across worker_threads. The Java tests are
// single threaded, so nothing else exercises the Atomics paths concurrently.
import { describe, expect, it, vi } from 'vitest';
import { BufferUtil } from '../../../../src/agrona/BufferUtil.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, Long, LongOverflowError } from '../../../../src/agrona/jdk.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { runWorkers } from '../../../support/Workers.js';
import {
    BARRIER,
    CAPACITY,
    COUNTER,
    DONE,
    indexOf,
    PASS_LENGTH,
    PASSES,
    PROGRESS,
    SHORT_SLOTS,
    VALUE,
    valueAt,
} from './SharedAtomicsLayout.js';

const SCRIPT = new URL('./SharedAtomics.worker.ts', import.meta.url);
const WORKERS = 4;
const ITERATIONS = 100_000;
const TIMEOUT_MS = 25_000;

function newShared(): SharedArrayBuffer {
    return BufferUtil.allocateShared(CAPACITY, 64);
}

function data(kind: string, buffer: SharedArrayBuffer, workers: number, iterations: number): unknown[] {
    return Array.from({ length: workers }, (_, id) => ({ kind, buffer, workers, id, iterations }));
}

describe('SharedAtomicsExtraTest', () => {
    it('allocateSharedReturnsASharedArrayBufferAndChecksTheAlignment', () => {
        const buffer = BufferUtil.allocateShared(64, 8);
        expect(buffer).toBeInstanceOf(SharedArrayBuffer);
        expect(buffer.byteLength).toBe(64);
        expect(() => BufferUtil.allocateShared(64, 3)).toThrow(IllegalArgumentException);
    });

    it('compareAndSetIntIncrementsFromFourWorkersEndExact', async () => {
        const sab = newShared();
        const results = await runWorkers(SCRIPT, data('cas-int', sab, WORKERS, ITERATIONS), TIMEOUT_MS);

        expect(new UnsafeBuffer(sab).getIntVolatile(COUNTER)).toBe(WORKERS * ITERATIONS);
        // the retry loop was exercised: the workers did contend
        expect((results as number[]).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }, 30_000);

    it('getAndAddIntFromFourWorkersEndsExact', async () => {
        const sab = newShared();
        await runWorkers(SCRIPT, data('add-int', sab, WORKERS, ITERATIONS), TIMEOUT_MS);

        expect(new UnsafeBuffer(sab).getIntVolatile(COUNTER)).toBe(WORKERS * ITERATIONS);
    }, 30_000);

    // adapted: Agrona has no compareAndSetShort and no getAndAddShort; the atomic short is put/getShortVolatile, so
    // four workers each own one short of the same 8 bytes and none may disturb its neighbours
    it('shortVolatileOfFourWorkersSharingAWordDoNotDisturbEachOther', async () => {
        const sab = newShared();
        const results = await runWorkers(SCRIPT, data('short', sab, WORKERS, ITERATIONS), TIMEOUT_MS);

        const buffer = new UnsafeBuffer(sab);
        for (let id = 0; id < WORKERS; id++) {
            expect(buffer.getShortVolatile(SHORT_SLOTS + 2 * id)).toBe(results[id]);
        }
    }, 30_000);

    it('longReadersNeverSeeATornValueAcrossEvery2Pow32BoundaryBelow2Pow40', async () => {
        const sab = newShared();
        const results = (await runWorkers(
            SCRIPT,
            [
                { kind: 'long-writer', buffer: sab, workers: 4, id: 0, iterations: 0 },
                ...[1, 2, 3].map((id) => ({ kind: 'long-reader', buffer: sab, workers: 4, id, iterations: 0 })),
            ],
            TIMEOUT_MS,
        )) as [number, ...{ reads: number; torn: number; firstTorn: string }[]];

        expect(results[0]).toBe(PASSES * PASS_LENGTH);
        for (const reader of results.slice(1) as { reads: number; torn: number; firstTorn: string }[]) {
            expect(reader.torn, reader.firstTorn).toBe(0);
            expect(reader.reads).toBeGreaterThan(0);
        }
        const buffer = new UnsafeBuffer(sab);
        expect(buffer.getIntVolatile(DONE)).toBe(1);
        expect(buffer.getIntVolatile(PROGRESS)).toBe(PASSES * PASS_LENGTH);
        expect(buffer.getLongVolatile(VALUE)).toBe(valueAt(PASS_LENGTH - 1));
    }, 30_000);

    it('theWritersSequenceCoversEvery2Pow32BoundaryBelow2Pow40AndTheMembershipPredicateIsExact', () => {
        const seen = new Set<number>();
        for (let i = 0; i < PASS_LENGTH; i++) {
            const value = valueAt(i);
            expect(Number.isSafeInteger(value)).toBe(true);
            expect(value).toBeLessThan(2 ** 40);
            expect(indexOf(value)).toBe(i);
            seen.add(value);
        }
        expect(seen.size).toBe(PASS_LENGTH);
        for (let m = 0; m < 256; m++) {
            for (let d = m === 0 ? 0 : -3; d <= 3; d++) {
                expect(seen.has(m * 2 ** 32 + d)).toBe(true);
            }
        }
        for (const bad of [
            -1,
            4,
            2 ** 32 - 4,
            2 ** 32 + 4,
            2 ** 33 + 4,
            255 * 2 ** 32 + 4,
            256 * 2 ** 32 - 3,
            2 ** 40,
        ]) {
            expect(indexOf(bad), String(bad)).toBe(-1);
        }
    });

    it('longAtomicsRoundTripEveryValueOfTheSequenceAndTheExtremesOnASharedBuffer', () => {
        const buffer = new UnsafeBuffer(newShared());
        const values = [
            ...Array.from({ length: PASS_LENGTH }, (_, i) => valueAt(i)),
            -1,
            -(2 ** 32),
            -(2 ** 32) - 1,
            Long.MAX_VALUE,
            -Long.MAX_VALUE,
        ];
        for (const value of values) {
            buffer.putLongRelease(VALUE, value);
            expect(buffer.getLongVolatile(VALUE)).toBe(value);
            expect(buffer.getLong(VALUE)).toBe(value);
        }
    });

    it('anAtomicAccessAtAnAddressThatIsNotAMultipleOfItsSizeThrowsOnASharedBuffer', () => {
        const buffer = new UnsafeBuffer(newShared());
        const window = new UnsafeBuffer(newShared(), 2, 32);

        expect(() => buffer.getIntVolatile(2)).toThrow(IllegalArgumentException);
        expect(() => buffer.getIntVolatile(2)).toThrow('Unaligned atomic access: index=2 size=4');
        expect(() => buffer.putIntOrdered(1, 1)).toThrow(IllegalArgumentException);
        expect(() => buffer.compareAndSetInt(6, 0, 1)).toThrow(IllegalArgumentException);
        expect(() => buffer.getAndAddInt(3, 1)).toThrow(IllegalArgumentException);
        expect(() => buffer.getAndSetInt(5, 1)).toThrow(IllegalArgumentException);
        expect(() => buffer.getShortVolatile(1)).toThrow('Unaligned atomic access: index=1 size=2');
        expect(() => buffer.putShortVolatile(3, 1)).toThrow(IllegalArgumentException);
        expect(() => buffer.getLongVolatile(4)).toThrow('Unaligned atomic access: index=4 size=8');
        expect(() => buffer.getAndAddLong(12, 1)).toThrow(IllegalArgumentException);

        // the address is the offset of the window plus the index
        expect(() => window.getIntVolatile(0)).toThrow(IllegalArgumentException);
        expect(window.getIntVolatile(2)).toBe(0);
        expect(window.getShortVolatile(0)).toBe(0);
        expect(() => window.getLongVolatile(6)).not.toThrow();
        expect(() => window.getLongVolatile(0)).toThrow(IllegalArgumentException);

        // a misaligned plain access is fine, and so is any access to a buffer that is not shared
        expect(buffer.getInt(2)).toBe(0);
        const plain = new UnsafeBuffer(new ArrayBuffer(32));
        plain.putIntVolatile(2, 5);
        expect(plain.getIntVolatile(2)).toBe(5);
    });

    it('theBoundsCheckComesBeforeTheAlignmentCheck', () => {
        const buffer = new UnsafeBuffer(newShared());
        expect(() => buffer.getIntVolatile(CAPACITY - 1)).toThrow(/out of bounds/);
        expect(() => buffer.getIntVolatile(-1)).toThrow(/out of bounds/);
    });

    it('theIntAtomicsMatchThePlainSemanticsOnASharedBuffer', () => {
        const buffer = new UnsafeBuffer(newShared(), 8, 64);
        buffer.putIntVolatile(0, -5);
        expect(buffer.getIntAcquire(0)).toBe(-5);
        expect(buffer.getAndAddInt(0, 0x7fffffff)).toBe(-5);
        expect(buffer.getInt(0)).toBe(0x7ffffffa);
        expect(buffer.getAndAddInt(0, 10)).toBe(0x7ffffffa);
        expect(buffer.getInt(0)).toBe(-0x7ffffffc); // wraps like Java
        expect(buffer.getAndSetInt(0, 3)).toBe(-0x7ffffffc);
        expect(buffer.compareAndSetInt(0, 3, 4)).toBe(true);
        expect(buffer.compareAndSetInt(0, 3, 5)).toBe(false);
        expect(buffer.compareAndExchangeInt(0, 4, 6)).toBe(4);
        expect(buffer.compareAndExchangeInt(0, 4, 7)).toBe(6);
        // an expected value outside int is its (int) cast, as in Java
        buffer.putIntOrdered(4, -1);
        expect(buffer.compareAndSetInt(4, 0xffffffff, 9)).toBe(true);
        expect(buffer.addIntOrdered(4, 1)).toBe(9);
        expect(buffer.addIntRelease(4, 1)).toBe(10);
        expect(buffer.addIntOpaque(4, 1)).toBe(11);
        buffer.putIntOpaque(4, 40);
        expect(buffer.getIntOpaque(4)).toBe(40);
        buffer.putShortVolatile(12, 0x12345);
        expect(buffer.getShortVolatile(12)).toBe(0x2345);
        buffer.putShortVolatile(12, -2);
        expect(buffer.getShortVolatile(12)).toBe(-2);
        expect(buffer.getCharVolatile(12)).toBe(0xfffe);
        buffer.putCharVolatile(14, 0xfffe);
        expect(buffer.getCharVolatile(14)).toBe(0xfffe);
        expect(buffer.getShort(14)).toBe(-2);
    });

    it('theLongAtomicsAreExactAndRangeCheckedOnASharedBuffer', () => {
        const buffer = new UnsafeBuffer(newShared());
        const max = Long.MAX_VALUE;
        buffer.putLongVolatile(8, -max);
        expect(buffer.getLongAcquire(8)).toBe(-max);
        buffer.putLongOrdered(8, 2 ** 40 + 1);
        expect(buffer.getLongOpaque(8)).toBe(2 ** 40 + 1);
        expect(buffer.getAndAddLong(8, 5)).toBe(2 ** 40 + 1);
        expect(buffer.addLongRelease(8, 5)).toBe(2 ** 40 + 6);
        expect(buffer.addLongOrdered(8, -1)).toBe(2 ** 40 + 11);
        expect(buffer.addLongOpaque(8, 1)).toBe(2 ** 40 + 10);
        expect(buffer.getAndSetLong(8, 3)).toBe(2 ** 40 + 11);
        expect(buffer.compareAndSetLong(8, 3, 2 ** 45)).toBe(true);
        expect(buffer.compareAndSetLong(8, 3, 1)).toBe(false);
        expect(buffer.compareAndExchangeLong(8, 2 ** 45, 8)).toBe(2 ** 45);
        expect(buffer.compareAndExchangeLong(8, 2 ** 45, 9)).toBe(8);
        // the plain long is the same bytes
        expect(buffer.getLong(8)).toBe(8);

        // D5: outside +/-(2^53 - 1) throws RangeError and writes nothing
        buffer.putLongVolatile(8, max);
        expect(() => buffer.putLongVolatile(8, 2 ** 53)).toThrow(RangeError);
        expect(() => buffer.getAndAddLong(8, 1)).toThrow(LongOverflowError);
        expect(() => buffer.addLongRelease(8, 1)).toThrow(RangeError);
        expect(() => buffer.getAndSetLong(8, Number.NaN)).toThrow(RangeError);
        expect(() => buffer.compareAndSetLong(8, 1, 2 ** 53)).toThrow(RangeError);
        expect(buffer.getLongVolatile(8)).toBe(max);

        // an unsafe value in memory is a LongOverflowError carrying the exact value
        buffer.putLongBigInt(16, 2n ** 62n);
        try {
            buffer.getLongVolatile(16);
            expect.unreachable();
        } catch (e) {
            expect((e as LongOverflowError).value).toBe(2n ** 62n);
        }
        // Java wraps in the 64-bit domain: Long.MAX_VALUE + 1 is Long.MIN_VALUE, which is then range checked
        buffer.putLongBigInt(24, 2n ** 63n - 1n);
        expect(() => buffer.getAndAddLong(24, 1)).toThrow(RangeError);
        expect(buffer.getLongBigInt(24)).toBe(2n ** 63n - 1n);
    });

    it('wrappingTheSameSharedArrayBufferAgainAllocatesNothing', async () => {
        const sab = newShared();
        const buffer = new UnsafeBuffer(sab);
        const other = new UnsafeBuffer(newShared());
        let sink = 0;
        await expectNoAllocation((n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                buffer.wrap(sab);
                buffer.putIntOrdered(8, i);
                acc = (acc + buffer.getIntVolatile(8)) | 0;
            }
            sink = acc;
        });
        expect(Number.isInteger(sink)).toBe(true);
        // a second buffer over the same SharedArrayBuffer takes the cached views
        other.wrap(sab);
        other.putIntOrdered(8, 99);
        expect(buffer.getIntVolatile(8)).toBe(99);
    });

    it('wrapRecomputesTheAtomicAddressWhenTheWindowOrTheBackingChanges', () => {
        const sab = newShared();
        const buffer = new UnsafeBuffer(sab, 4, 32);
        buffer.putIntVolatile(0, 7);
        expect(new UnsafeBuffer(sab).getIntVolatile(4)).toBe(7);

        buffer.wrap(sab, 8, 32);
        expect(buffer.getIntVolatile(0)).toBe(0);
        buffer.putIntVolatile(0, 8);
        expect(new UnsafeBuffer(sab).getIntVolatile(8)).toBe(8);

        // from a shared buffer to one that is not, and back
        buffer.wrap(new Uint8Array(32));
        buffer.putIntVolatile(2, 1); // unaligned is fine when not shared
        buffer.wrap(new UnsafeBuffer(sab), 12, 8);
        buffer.putIntVolatile(0, 12);
        expect(new UnsafeBuffer(sab).getIntVolatile(12)).toBe(12);
        expect(() => buffer.getIntVolatile(2)).toThrow(IllegalArgumentException);

        // a Uint8Array window of a SharedArrayBuffer
        const view = new Uint8Array(sab, 16, 16);
        buffer.wrap(view);
        buffer.putIntVolatile(0, 16);
        expect(new UnsafeBuffer(sab).getIntVolatile(16)).toBe(16);
        const odd = new Uint8Array(sab, 17, 15);
        buffer.wrap(odd);
        expect(() => buffer.getIntVolatile(0)).toThrow(IllegalArgumentException);
        expect(buffer.getIntVolatile(3)).toBe(0);
    });

    it('anOddSizedSharedArrayBufferCanBeWrappedAndAccessed', () => {
        const buffer = new UnsafeBuffer(new SharedArrayBuffer(13));
        buffer.putIntVolatile(8, 5);
        buffer.putShortVolatile(12 - 2, 1);
        expect(buffer.getInt(8)).toBe(0x10005);
        expect(() => buffer.getIntVolatile(12)).toThrow(/out of bounds/);
    });

    it('theIntAtomicsAllocateNothingOnASharedBuffer', async () => {
        const buffer = new UnsafeBuffer(newShared());
        let sink = 0;
        await expectNoAllocation((n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                buffer.putIntOrdered(BARRIER, i);
                acc = (acc + buffer.getIntVolatile(BARRIER)) | 0;
                acc = (acc + buffer.getAndAddInt(COUNTER, 1)) | 0;
                acc = (acc + buffer.getAndSetInt(COUNTER, i)) | 0;
                buffer.compareAndSetInt(COUNTER, i, i + 1);
                acc = (acc + buffer.addIntOrdered(COUNTER, 1)) | 0;
                buffer.putShortVolatile(SHORT_SLOTS, i & 0x7fff);
                acc = (acc + buffer.getShortVolatile(SHORT_SLOTS)) | 0;
            }
            sink = acc;
        });
        expect(Number.isInteger(sink)).toBe(true);
    });

    it('aZeroedBufferReadsZero', () => {
        expect(new UnsafeBuffer(newShared()).getLongVolatile(VALUE)).toBe(0);
        expect(new UnsafeBuffer(new ArrayBuffer(CAPACITY)).getLongVolatile(VALUE)).toBe(0);
    });

    it('byteVolatileUsesAtomicsOnASharedBufferAndNotOtherwise', () => {
        const buffer = new UnsafeBuffer(newShared());
        buffer.putByteVolatile(20, -3);
        expect(buffer.getByteVolatile(20)).toBe(-3);
        expect(buffer.getByte(20)).toBe(-3);
        buffer.putByteVolatile(21, 0x1ff);
        expect(buffer.getByteVolatile(21)).toBe(-1);

        const store = vi.spyOn(Atomics, 'store');
        const load = vi.spyOn(Atomics, 'load');
        try {
            buffer.putByteVolatile(22, 1);
            expect(store).toHaveBeenCalledTimes(1);
            buffer.getByteVolatile(22);
            expect(load).toHaveBeenCalledTimes(1);

            store.mockClear();
            load.mockClear();
            const plain = new UnsafeBuffer(new ArrayBuffer(32));
            plain.putByteVolatile(22, 1);
            expect(plain.getByteVolatile(22)).toBe(1);
            expect(store).not.toHaveBeenCalled();
            expect(load).not.toHaveBeenCalled();
        } finally {
            store.mockRestore();
            load.mockRestore();
        }
    });

    it('alternatingBetweenTwoBuffersOverOneSharedArrayBufferAllocatesNothing', async () => {
        const sab = new SharedArrayBuffer(128);
        const a = new UnsafeBuffer(sab);
        const b = new UnsafeBuffer(new Uint8Array(sab, 0, 64));
        const f = new UnsafeBuffer();
        let sink = 0;
        await expectNoAllocation((n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                f.wrap(i & 1 ? b : a, 8, 16);
                acc = (acc + f.getIntVolatile(0)) | 0;
            }
            sink = acc;
        });
        expect(Number.isInteger(sink)).toBe(true);
    });

    it('aGrowableSharedArrayBufferIsRejected', () => {
        const growable = new (
            SharedArrayBuffer as unknown as new (
                length: number,
                options: { maxByteLength: number },
            ) => SharedArrayBuffer
        )(16, { maxByteLength: 64 });
        expect(() => new UnsafeBuffer(growable)).toThrow(IllegalArgumentException);
        expect(() => new UnsafeBuffer(growable)).toThrow('growable SharedArrayBuffer is not supported');
    });
});
