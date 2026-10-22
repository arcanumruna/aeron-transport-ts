// Tests the port adds (spec D16): the 64-bit atomics of UnsafeBuffer on a SharedArrayBuffer, single thread. They keep
// Java's layout (8 little-endian bytes at the index), release the stripe on every exit and allocate nothing.
import { describe, expect, it } from 'vitest';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, LongOverflowError } from '../../../../src/agrona/jdk.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { ARRAY_BACKING, BACKINGS, SHARED_BACKING } from '../../../support/Backing.js';

const INDEX = 64;
const VALUES = [0, 1, -1, -5, 2 ** 31, 2 ** 32 - 1, 2 ** 32, -(2 ** 32), 2 ** 40 + 7, 2 ** 53 - 1, -(2 ** 53 - 1)];

function shared(): { sab: SharedArrayBuffer; buffer: UnsafeBuffer; view: DataView } {
    const sab = new SharedArrayBuffer(256);
    return { sab, buffer: new UnsafeBuffer(sab), view: new DataView(sab) };
}

function stripeSequence(): number {
    return Atomics.load(LongStripes.table()!, LongStripes.stripe(INDEX));
}

describe('SharedLongAtomicsExtraTest', () => {
    it('everyLongAtomicKeepsJavaLayout', () => {
        const { buffer, view } = shared();
        const putLikes: [string, (v: number) => void][] = [
            ['putLongVolatile', (v) => buffer.putLongVolatile(INDEX, v)],
            ['putLongRelease', (v) => buffer.putLongRelease(INDEX, v)],
            ['putLongOrdered', (v) => buffer.putLongOrdered(INDEX, v)],
            ['putLongOpaque', (v) => buffer.putLongOpaque(INDEX, v)],
            [
                'getAndSetLong',
                (v) => {
                    buffer.putLongVolatile(INDEX, 3);
                    expect(buffer.getAndSetLong(INDEX, v)).toBe(3);
                },
            ],
            [
                'compareAndSetLong',
                (v) => {
                    const current = buffer.getLongVolatile(INDEX);
                    expect(buffer.compareAndSetLong(INDEX, current, v)).toBe(true);
                },
            ],
            [
                'compareAndExchangeLong',
                (v) => {
                    const current = buffer.getLongVolatile(INDEX);
                    expect(buffer.compareAndExchangeLong(INDEX, current, v)).toBe(current);
                },
            ],
        ];
        for (const [name, put] of putLikes) {
            for (const v of VALUES) {
                buffer.putLongVolatile(INDEX, 0);
                put(v);
                const label = name + ' ' + v;
                expect(view.getBigInt64(INDEX, true), label).toBe(BigInt(v));
                expect(buffer.getLongVolatile(INDEX), label).toBe(v);
                expect(buffer.getLongAcquire(INDEX), label).toBe(v);
                expect(buffer.getLongOpaque(INDEX), label).toBe(v);
                expect(buffer.getLong(INDEX), label).toBe(v);
                // the neighbours are untouched
                expect(view.getBigInt64(INDEX - 8, true), label).toBe(0n);
                expect(view.getBigInt64(INDEX + 8, true), label).toBe(0n);
            }
        }
        // a value written by DataView is read back by every getter
        for (const v of VALUES) {
            view.setBigInt64(INDEX, BigInt(v), true);
            expect(buffer.getLongVolatile(INDEX)).toBe(v);
        }
    });

    it('getAndAddLongCarriesAcrossTheHalves', () => {
        const { buffer, view } = shared();
        buffer.putLongVolatile(INDEX, 2 ** 32 - 3);
        expect(buffer.getAndAddLong(INDEX, 5)).toBe(2 ** 32 - 3);
        expect(buffer.getLongVolatile(INDEX)).toBe(2 ** 32 + 2);
        expect(view.getBigInt64(INDEX, true)).toBe(BigInt(2 ** 32 + 2));

        buffer.putLongVolatile(INDEX, -1);
        expect(buffer.getAndAddLong(INDEX, 1)).toBe(-1);
        expect(buffer.getLongVolatile(INDEX)).toBe(0);
        expect(buffer.addLongOrdered(INDEX, -(2 ** 32))).toBe(0);
        expect(view.getBigInt64(INDEX, true)).toBe(-(2n ** 32n));
    });

    it('stripeIsReleasedOnEveryExit', () => {
        const { buffer, view } = shared();
        const cases: [string, () => void, number][] = [
            [
                'getAndAddLong overflow',
                () => expect(() => buffer.getAndAddLong(INDEX, 1)).toThrow(RangeError),
                2 ** 53 - 1,
            ],
            ['CAS miss', () => expect(buffer.compareAndSetLong(INDEX, 1, 2)).toBe(false), 5],
            ['CAS hit', () => expect(buffer.compareAndSetLong(INDEX, 5, 6)).toBe(true), 5],
            ['put of 2^53', () => expect(() => buffer.putLongVolatile(INDEX, 2 ** 53)).toThrow(RangeError), 5],
            ['compareAndExchangeLong miss', () => expect(buffer.compareAndExchangeLong(INDEX, 1, 2)).toBe(5), 5],
            [
                'getAndSetLong of an out-of-range word',
                () => expect(() => buffer.getAndSetLong(INDEX, 1)).toThrow(LongOverflowError),
                -1,
            ],
            [
                'getLongVolatile of an out-of-range word',
                () => expect(() => buffer.getLongVolatile(INDEX)).toThrow(LongOverflowError),
                -1,
            ],
            [
                'compareAndExchangeLong witness out of range',
                () => expect(() => buffer.compareAndExchangeLong(INDEX, 1, 2)).toThrow(LongOverflowError),
                -1,
            ],
            [
                'getAndAddLongHalves bad delta',
                () =>
                    expect(() => buffer.getAndAddLongHalves(INDEX, -1, new Int32Array(2))).toThrow(
                        IllegalArgumentException,
                    ),
                5,
            ],
        ];
        for (const [name, run, start] of cases) {
            if (-1 === start) {
                view.setBigInt64(INDEX, 0x7fffffff_ffffffffn, true);
            } else {
                buffer.putLongVolatile(INDEX, start);
            }
            const before = view.getBigInt64(INDEX, true);
            run();
            expect(stripeSequence() % 2, name).toBe(0);
            // the stored value is unchanged, except by the CAS hit
            if ('CAS hit' === name) {
                expect(view.getBigInt64(INDEX, true), name).toBe(6n);
            } else {
                expect(view.getBigInt64(INDEX, true), name).toBe(before);
            }
            // a second operation on the same stripe does not hang
            buffer.putLongVolatile(INDEX, 9);
            expect(buffer.getLongVolatile(INDEX), name).toBe(9);
        }
    });

    function halvesTable(buffer: UnsafeBuffer, name: string): void {
        const out = new Int32Array(2);
        buffer.putLongVolatileHalves(INDEX, 0x80000000 | 0, 0x7fffffff);
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([-2147483648, 0x7fffffff]);

        buffer.putLongVolatileHalves(INDEX, -8, 0x7fffffff);
        buffer.getAndAddLongHalves(INDEX, 32, out);
        expect([out[0], out[1]], name).toEqual([-8, 0x7fffffff]);
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([24, -2147483648]);

        // no carry
        buffer.putLongVolatileHalves(INDEX, 5, 9);
        buffer.getAndAddLongHalves(INDEX, 0x7fffffff, out);
        expect([out[0], out[1]], name).toEqual([5, 9]);
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([(5 + 0x7fffffff) | 0, 9]);
        buffer.getAndAddLongHalves(INDEX, 0, out);
        expect([out[0], out[1]], name).toEqual([(5 + 0x7fffffff) | 0, 9]);

        buffer.putLongVolatileHalves(INDEX, 1, 2);
        expect(buffer.compareAndSetLongHalves(INDEX, 1, 2, 3, 4), name).toBe(true);
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([3, 4]);
        expect(buffer.compareAndSetLongHalves(INDEX, 1, 2, 5, 6), name).toBe(false);
        expect(buffer.compareAndSetLongHalves(INDEX, 3, 5, 5, 6), name).toBe(false);
        expect(buffer.compareAndSetLongHalves(INDEX, 4, 4, 5, 6), name).toBe(false);
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([3, 4]);

        for (const delta of [-1, 2 ** 31, 1.5, Number.NaN]) {
            expect(() => buffer.getAndAddLongHalves(INDEX, delta, out), name + delta).toThrow(IllegalArgumentException);
            expect(() => buffer.getAndAddLongHalves(INDEX, delta, out), name + delta).toThrow(
                'delta must be in [0, 2^31 - 1]: ' + delta,
            );
        }
        buffer.getLongVolatileHalves(INDEX, out);
        expect([out[0], out[1]], name).toEqual([3, 4]);
        expect(() => buffer.getLongVolatileHalves(252, out), name).toThrow(/out of bounds/);
    }

    describe.each(BACKINGS)('over $name', (backing) => {
        it('halvesMethodsCoverTheFull64BitRange', () => {
            const buffer = new UnsafeBuffer(backing.arrayBuffer(256));
            halvesTable(buffer, backing.name);
            if (backing.shared) {
                expect(stripeSequence() % 2).toBe(0);
            }
        });
    });

    it('halvesMethodsGiveTheSameResultOnBothBackings', () => {
        const a = new UnsafeBuffer(ARRAY_BACKING.arrayBuffer(256));
        const b = new UnsafeBuffer(SHARED_BACKING.arrayBuffer(256));
        a.putLongVolatileHalves(INDEX, -8, 0x7fffffff);
        b.putLongVolatileHalves(INDEX, -8, 0x7fffffff);
        const outA = new Int32Array(2);
        const outB = new Int32Array(2);
        a.getAndAddLongHalves(INDEX, 32, outA);
        b.getAndAddLongHalves(INDEX, 32, outB);
        expect(outA).toEqual(outB);
        expect(a.getLongBigInt(INDEX)).toBe(b.getLongBigInt(INDEX));
    });

    it('sharedLongAtomicsAllocateNothing', async () => {
        const { buffer } = shared();
        const out = new Int32Array(2);
        let sink = 0;
        // values stay below 2^31 so that no heap number is boxed across a call (spec 5.3)
        await expectNoAllocation((n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                const v = i & 0x3fffffff;
                buffer.putLongRelease(INDEX, v);
                acc = (acc + buffer.getLongVolatile(INDEX)) | 0;
                acc = (acc + buffer.getAndAddLong(INDEX, 1)) | 0;
                acc = (acc + (buffer.compareAndSetLong(INDEX, v + 1, v + 2) ? 1 : 0)) | 0; // hit
                acc = (acc + (buffer.compareAndSetLong(INDEX, -1, 0) ? 1 : 0)) | 0; // miss
                acc = (acc + buffer.compareAndExchangeLong(INDEX, v + 2, v + 3)) | 0;
                acc = (acc + buffer.getAndSetLong(INDEX, v)) | 0;
                buffer.putLongVolatileHalves(INDEX, v, 0);
                buffer.getLongVolatileHalves(INDEX, out);
                acc = (acc + out[0]!) | 0;
                acc = (acc + (buffer.compareAndSetLongHalves(INDEX, v, 0, v + 1, 0) ? 1 : 0)) | 0;
                buffer.getAndAddLongHalves(INDEX, 32, out);
                acc = (acc + out[0]!) | 0;
            }
            sink = acc;
        });
        expect(Number.isInteger(sink)).toBe(true);
    });
});
