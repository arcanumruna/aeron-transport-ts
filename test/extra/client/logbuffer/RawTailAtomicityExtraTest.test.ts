// Tests the port adds (spec D12, D16; issue #10): the raw tail operations of LogBufferDescriptor are one atomic 64-bit
// operation each, across threads.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { ITERATIONS, expectNoAllocation } from '../../../support/Allocation.js';
import { BACKINGS } from '../../../support/Backing.js';
import { runWorkers } from '../../../support/Workers.js';

const SCRIPT = new URL('./RawTailAtomicity.worker.ts', import.meta.url);
const PARTITION = 1;
const OFFSET = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + 8 * PARTITION;
const INT32_MIN = -2147483648;

/** The raw tail with the unsigned 32 bit `low` (packTail sign-extends a negative int offset, as Java does). */
function raw(termId: number, low: number): bigint {
    return BigInt.asIntN(64, (BigInt(termId) << 32n) | BigInt(low >>> 0));
}

describe.each(BACKINGS)('RawTailAtomicityExtraTest over $name', (backing) => {
    it('getAndAddRawTailOffsetCarriesIntoTermId', () => {
        const buffer = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        const holder = new Int32Array(1);

        LogBufferDescriptor.rawTail(buffer, PARTITION, raw(5, 0xfffffff8));
        expect(LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, 32, holder)).toBe(0xfffffff8);
        expect(holder[0]).toBe(5);
        expect(LogBufferDescriptor.rawTailTermId(buffer, PARTITION)).toBe(6);
        expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(raw(6, 24));

        LogBufferDescriptor.rawTail(buffer, PARTITION, raw(0x7fffffff, 0xfffffff8));
        expect(LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, 32, holder)).toBe(0xfffffff8);
        expect(holder[0]).toBe(0x7fffffff);
        expect(LogBufferDescriptor.rawTailTermId(buffer, PARTITION)).toBe(INT32_MIN);
    });

    it('rawTailVolatileAndCasRawTailRoundTripTheFull64BitRange', () => {
        const buffer = new UnsafeBuffer(backing.arrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        for (const [termId, offset] of [
            [0, 0],
            [-1, -1],
            [INT32_MIN, 0x7fffffff],
            [0x7fffffff, INT32_MIN],
            [123, 456],
        ] as const) {
            const tail = raw(termId, offset);
            LogBufferDescriptor.rawTailVolatile(buffer, PARTITION, tail);
            expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(tail);
            expect(LogBufferDescriptor.rawTail(buffer, PARTITION)).toBe(tail);
            const next = raw(termId + 1, 0);
            expect(LogBufferDescriptor.casRawTail(buffer, PARTITION, tail + 1n, next)).toBe(false);
            expect(LogBufferDescriptor.casRawTail(buffer, PARTITION, tail, next)).toBe(true);
            expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(next);
        }
        expect(() => LogBufferDescriptor.casRawTail(buffer, PARTITION, 0n, 2n ** 63n)).toThrow(RangeError);
        expect(() => LogBufferDescriptor.rawTailVolatile(buffer, PARTITION, -(2n ** 63n) - 1n)).toThrow(RangeError);
    });
});

describe('RawTailAtomicityExtraTest', () => {
    // issue #10: a producer's (term id, term offset) pair was read and added as two int operations, so a rotation
    // between them gave a pair that never existed
    it('rawTailPairIsNeverTornAcrossThreadsRegression', async () => {
        const sab = new SharedArrayBuffer(4096);
        const buffer = new UnsafeBuffer(sab);
        LogBufferDescriptor.rawTail(buffer, PARTITION, raw(1, 1 << 20));

        const results = (await runWorkers(
            SCRIPT,
            [
                { kind: 'add', buffer: sab, partition: PARTITION, count: 30_000 },
                { kind: 'rotate', buffer: sab, partition: PARTITION, count: 4000 },
            ],
            25_000,
        )) as [{ termIds: Int32Array; offsets: Float64Array }, number];

        const { termIds, offsets } = results[0];
        expect(termIds.length).toBe(30_000);
        let torn = 0;
        let first = '';
        for (let i = 0; i < termIds.length; i++) {
            if (offsets[i]! >>> 20 !== termIds[i]) {
                if (++torn === 1) {
                    first = 'termId ' + termIds[i] + ' offset ' + offsets[i];
                }
            }
        }
        expect(torn, first).toBe(0);
        expect(LogBufferDescriptor.rawTailTermId(buffer, PARTITION)).toBe(4001);
    }, 30_000);

    it('getAndAddRawTailOffsetAllocatesNothingOnSharedBacking', async () => {
        const buffer = new UnsafeBuffer(new SharedArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        const holder = new Int32Array(1);
        LogBufferDescriptor.rawTail(buffer, 0, raw(9, 0));
        const nearCarry = 0xffffff00 | 0;
        let sink = 0;

        await expectNoAllocation((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                if ((i & 0xffff) === 0) {
                    buffer.putLongVolatileHalves(0, nearCarry, 9);
                }
                sum += LogBufferDescriptor.getAndAddRawTailOffset(buffer, 0, 32, holder) & 0xff;
                sum += holder[0]! & 1;
            }
            sink = sum;
        }, ITERATIONS);
        expect(sink).toBeGreaterThan(0);
    });
});
