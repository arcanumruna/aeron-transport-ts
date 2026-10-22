// Not in Aeron: LogBufferDescriptor.getAndAddRawTailOffset (spec D12, phase 2 decision 5) against a bigint model of
// Java's `getAndAddLong(tailCounterOffset, delta)` on the raw tail, and LogBufferDescriptor.maxPossiblePosition
// (spec D13), the position cap that Java computes inline in Publication.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { ITERATIONS, expectNoAllocation } from '../../../support/Allocation.js';
import { mulberry32 } from '../../../support/Random.js';

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const TERM_LENGTH = 64 * 1024;
const PARTITION = 1;
const OFFSET = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + 8 * PARTITION;

/** The 64-bit raw tail with `termId` in the high half and the unsigned `low` in the low half. */
function raw(termId: number, low: number): bigint {
    return BigInt.asIntN(64, (BigInt(termId) << 32n) | BigInt(low));
}

function check(buffer: UnsafeBuffer, holder: Int32Array, termId: number, low: number, delta: number): void {
    const before = raw(termId, low);
    LogBufferDescriptor.rawTail(buffer, PARTITION, before);
    holder[0] = 12345;

    const offset = LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, delta, holder);

    const label = `termId=${termId} low=${low} delta=${delta}`;
    // the model: the 64-bit getAndAdd, then termId / termOffset of the old value and the new raw tail
    expect(offset, label).toBe(Number(BigInt.asUintN(32, before)));
    expect(offset, label).toBe(low);
    expect(holder[0], label).toBe(LogBufferDescriptor.termId(before));
    expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION), label).toBe(
        BigInt.asIntN(64, before + BigInt(delta)),
    );
}

describe('getAndAddRawTailOffset', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(LogBufferDescriptor.LOG_META_DATA_LENGTH));
    const holder = new Int32Array(1);
    const termIds = [INT32_MIN, -1, 0, INT32_MAX];
    const deltas = [0, 32, 4096];

    const noCarryOffsets = [0, TERM_LENGTH - 32, TERM_LENGTH, INT32_MAX - 31];
    for (const termId of termIds) {
        for (const low of noCarryOffsets) {
            for (const delta of deltas) {
                it(`no carry: termId=${termId} offset=${low} delta=${delta}`, () => {
                    check(buffer, holder, termId, low, delta);
                });
            }
        }
    }

    const carryLows = [0xffffffe0, 0xffffffff - 31, 0xffffffff, 0xfffff000, 0xffffff00];
    for (const termId of termIds) {
        for (const low of carryLows) {
            for (const delta of deltas) {
                it(`low half 0x${low.toString(16)}: termId=${termId} delta=${delta}`, () => {
                    check(buffer, holder, termId, low, delta);
                });
            }
        }
    }

    it('the carry from the low half moves the term id on, and INT32_MAX wraps to INT32_MIN as the 64-bit add does', () => {
        LogBufferDescriptor.rawTail(buffer, PARTITION, raw(INT32_MAX, 0xffffffe0));
        expect(LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, 32, holder)).toBe(0xffffffe0);
        expect(holder[0]).toBe(INT32_MAX);
        expect(LogBufferDescriptor.rawTailTermId(buffer, PARTITION)).toBe(INT32_MIN);
        expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(raw(INT32_MIN, 0));

        LogBufferDescriptor.rawTail(buffer, PARTITION, raw(-1, 0xffffffff));
        expect(LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, 4096, holder)).toBe(0xffffffff);
        expect(holder[0]).toBe(-1);
        expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(raw(0, 4095));
    });

    it('does not touch the other partitions', () => {
        LogBufferDescriptor.rawTail(buffer, 0, raw(5, 100));
        LogBufferDescriptor.rawTail(buffer, 2, raw(7, 200));
        check(buffer, holder, 6, 300, 64);
        expect(LogBufferDescriptor.rawTailVolatile(buffer, 0)).toBe(raw(5, 100));
        expect(LogBufferDescriptor.rawTailVolatile(buffer, 2)).toBe(raw(7, 200));
    });

    it('matches the model over 10k seeded random tails and deltas, and repeated adds', () => {
        const random = mulberry32(11);
        for (let i = 0; i < 10_000; i++) {
            const termId = (random() * 4294967296) | 0;
            // a quarter of the lows are within a frame of the carry
            const low = random() < 0.25 ? 0xffffffff - Math.floor(random() * 8192) : Math.floor(random() * 4294967296);
            check(buffer, holder, termId, low, Math.floor(random() * 4) * 32 * Math.floor(random() * 40));
        }

        let model = raw(3, 0xfffffe00);
        LogBufferDescriptor.rawTail(buffer, PARTITION, model);
        for (let i = 0; i < 100; i++) {
            const delta = 32 * (1 + (i % 7));
            const expectedOffset = Number(BigInt.asUintN(32, model));
            const expectedTermId = LogBufferDescriptor.termId(model);
            expect(LogBufferDescriptor.getAndAddRawTailOffset(buffer, OFFSET, delta, holder)).toBe(expectedOffset);
            expect(holder[0]).toBe(expectedTermId);
            model = BigInt.asIntN(64, model + BigInt(delta));
            expect(LogBufferDescriptor.rawTailVolatile(buffer, PARTITION)).toBe(model);
        }
    });

    it('allocates nothing', async () => {
        const rawBuffer = new UnsafeBuffer(new Uint8Array(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        const termIdHolder = new Int32Array(1);
        LogBufferDescriptor.rawTail(rawBuffer, 0, raw(9, 0));
        const lowOffset = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET;
        const nearCarry = 0xffffff00 | 0;
        let sink = 0;

        await expectNoAllocation((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                // 32 bytes at a time: the low half would run on past the carry, so reset it now and then
                if ((i & 0xffff) === 0) {
                    rawBuffer.putInt(lowOffset, nearCarry);
                }
                sum += LogBufferDescriptor.getAndAddRawTailOffset(rawBuffer, lowOffset, 32, termIdHolder) & 0xff;
                sum += termIdHolder[0]! & 1;
            }
            sink = sum;
        }, ITERATIONS);
        expect(sink).toBeGreaterThan(0);
    });
});

describe('maxPossiblePosition', () => {
    it('is MAX_POSITION, Long.MAX_VALUE', () => {
        expect(LogBufferDescriptor.MAX_POSITION).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('is termLength * 2^31 below the cap', () => {
        expect(LogBufferDescriptor.maxPossiblePosition(64 * 1024)).toBe(2 ** 16 * 2 ** 31);
        expect(LogBufferDescriptor.maxPossiblePosition(LogBufferDescriptor.TERM_MIN_LENGTH)).toBe(2 ** 47);
        expect(LogBufferDescriptor.maxPossiblePosition(2 ** 21)).toBe(2 ** 52);
    });

    it('is 2^53 - termLength from the term length where termLength * 2^31 passes 2^53', () => {
        expect(LogBufferDescriptor.maxPossiblePosition(2 ** 22)).toBe(2 ** 53 - 2 ** 22);
        expect(LogBufferDescriptor.maxPossiblePosition(2 ** 21 + 65536)).toBe(2 ** 52 + 65536 * 2 ** 31);
        expect(LogBufferDescriptor.maxPossiblePosition(2 ** 22 - 65536)).toBe(2 ** 53 - 65536 * 2 ** 31);
        expect(LogBufferDescriptor.maxPossiblePosition(1024 * 1024 * 1024)).toBe(2 ** 53 - 2 ** 30);
        expect(LogBufferDescriptor.maxPossiblePosition(LogBufferDescriptor.TERM_MAX_LENGTH)).toBe(
            2 ** 53 - LogBufferDescriptor.TERM_MAX_LENGTH,
        );
    });

    it('equals min(termLength * 2^31, 2^53 - termLength) for every valid term length', () => {
        for (
            let termLength = LogBufferDescriptor.TERM_MIN_LENGTH;
            termLength <= LogBufferDescriptor.TERM_MAX_LENGTH;
            termLength *= 2
        ) {
            const expected = BigInt(termLength) << 31n;
            const cap = (1n << 53n) - BigInt(termLength);
            expect(BigInt(LogBufferDescriptor.maxPossiblePosition(termLength)), `${termLength}`).toBe(
                expected < cap ? expected : cap,
            );
        }
    });

    it('maxPossiblePositionIsATermBoundaryAndLastTermStaysBelowMaxPosition', () => {
        for (
            let termLength = LogBufferDescriptor.TERM_MIN_LENGTH;
            termLength <= LogBufferDescriptor.TERM_MAX_LENGTH;
            termLength *= 2
        ) {
            const cap = LogBufferDescriptor.maxPossiblePosition(termLength);
            expect(cap % termLength, `${termLength}`).toBe(0);
            const termCount = cap / termLength - 1;
            const bits = LogBufferDescriptor.positionBitsToShift(termLength);
            let position = -1;
            expect(() => {
                position = LogBufferDescriptor.computePosition(termCount, termLength + termLength / 8 + 32, bits, 0);
            }, `${termLength}`).not.toThrow();
            expect(position, `${termLength}`).toBeLessThan(LogBufferDescriptor.MAX_POSITION);
        }
    });
});
