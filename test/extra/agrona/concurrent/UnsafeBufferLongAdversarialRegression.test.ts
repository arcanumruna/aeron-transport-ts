// Regression tests that pin the current behaviour of the 64-bit accessors of UnsafeBuffer (issues #81 and #79).
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException } from '../../../../src/agrona/jdk.js';
import { ARRAY_BACKING, SHARED_BACKING, type Backing } from '../../../support/Backing.js';

interface Outcome {
    readonly threw: string | null;
    readonly result: unknown;
    readonly lo: number;
    readonly hi: number;
    readonly long: string;
}

function seeded(backing: Backing, lo: number, hi: number): UnsafeBuffer {
    const buffer = new UnsafeBuffer(backing.aligned(16, 8));
    buffer.putInt(0, lo);
    buffer.putInt(4, hi);
    return buffer;
}

function readLong(buffer: UnsafeBuffer): string {
    try {
        return String(buffer.getLong(0));
    } catch (e) {
        return 'throws ' + (e as Error).constructor.name;
    }
}

function observe(buffer: UnsafeBuffer, action: (b: UnsafeBuffer) => unknown): Outcome {
    let threw: string | null = null;
    let result: unknown = undefined;
    try {
        result = action(buffer);
    } catch (e) {
        threw = (e as Error).constructor.name;
    }
    return { threw, result, lo: buffer.getInt(0), hi: buffer.getInt(4), long: readLong(buffer) };
}

const WEIRD: readonly [string, number][] = [
    ['NaN', NaN],
    ['0.5', 0.5],
    ['-0', -0],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['-1', -1],
    ['-2^31', -(2 ** 31)],
    ['2^31-1', 2 ** 31 - 1],
    ['2^31', 2 ** 31],
    ['2^32+7', 2 ** 32 + 7],
    ['2^53-1', 2 ** 53 - 1],
    ['-(2^53-1)', -(2 ** 53 - 1)],
    ['2^62', 2 ** 62],
    ['undefined', undefined as unknown as number],
];

const SEEDS: readonly [number, number][] = [
    [10, 0],
    [-1, 0],
    [-1, 0x7fffffff],
    [0, -1],
];

describe('UnsafeBufferLongHalvesBackingParityRegression', () => {
    it('getAndAddLongHalves behaves identically on both backings for every delta', () => {
        for (const [lo, hi] of SEEDS) {
            for (const [name, delta] of WEIRD) {
                const out = new Int32Array(2);
                const out2 = new Int32Array(2);
                const plain = observe(seeded(ARRAY_BACKING, lo, hi), (b) => {
                    b.getAndAddLongHalves(0, delta, out);
                    return [out[0], out[1]];
                });
                const shared = observe(seeded(SHARED_BACKING, lo, hi), (b) => {
                    b.getAndAddLongHalves(0, delta, out2);
                    return [out2[0], out2[1]];
                });
                expect(shared, `delta=${name} seed=${lo},${hi}`).toEqual(plain);
            }
        }
    });

    it('getAndAddLongHalves anchors', () => {
        for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
            const buffer = seeded(backing, 10, 0);
            const out = new Int32Array(2);
            buffer.getAndAddLongHalves(0, 5, out);
            expect([out[0], out[1]]).toEqual([10, 0]);
            expect(buffer.getLong(0)).toBe(15);

            const carry = seeded(backing, -1, 0);
            carry.getAndAddLongHalves(0, 1, out);
            expect([out[0], out[1]]).toEqual([-1, 0]);
            expect(carry.getLong(0)).toBe(2 ** 32);

            const bad = seeded(backing, 10, 0);
            expect(() => bad.getAndAddLongHalves(0, 2 ** 31, out)).toThrow(IllegalArgumentException);
            expect(bad.getLong(0)).toBe(10);
        }
    });

    it('compareAndSetLongHalves behaves identically on both backings for every expected and update', () => {
        for (const [lo, hi] of SEEDS) {
            for (const [name, v] of WEIRD) {
                const cases: [string, number, number, number, number][] = [
                    ['expectedLo', v, hi, 77, 3],
                    ['expectedHi', lo, v, 77, 3],
                    ['updateLo', lo, hi, v, 3],
                    ['updateHi', lo, hi, 77, v],
                    ['mismatch', lo + 1, hi, 77, v],
                ];
                for (const [what, eLo, eHi, uLo, uHi] of cases) {
                    const plain = observe(seeded(ARRAY_BACKING, lo, hi), (b) =>
                        b.compareAndSetLongHalves(0, eLo, eHi, uLo, uHi),
                    );
                    const shared = observe(seeded(SHARED_BACKING, lo, hi), (b) =>
                        b.compareAndSetLongHalves(0, eLo, eHi, uLo, uHi),
                    );
                    expect(shared, `${what}=${name} seed=${lo},${hi}`).toEqual(plain);
                }
            }
        }
    });

    it('compareAndSetLongHalves anchors: match stores, mismatch leaves the word', () => {
        for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
            const buffer = seeded(backing, 10, 0);
            expect(buffer.compareAndSetLongHalves(0, 10, 0, 20, 0)).toBe(true);
            expect(buffer.getLong(0)).toBe(20);
            expect(buffer.compareAndSetLongHalves(0, 10, 0, 30, 0)).toBe(false);
            expect(buffer.getLong(0)).toBe(20);
            expect(buffer.compareAndSetLongHalves(0, 20, 1, 30, 0)).toBe(false);
            expect(buffer.getLong(0)).toBe(20);
        }
    });

    it('an unaligned index succeeds on a plain buffer and throws IllegalArgumentException on a shared one', () => {
        const out = new Int32Array(2);
        for (const op of [
            (b: UnsafeBuffer) => b.getAndAddLongHalves(4, 1, out),
            (b: UnsafeBuffer) => b.compareAndSetLongHalves(4, 0, 0, 1, 0),
        ]) {
            expect(() => op(new UnsafeBuffer(ARRAY_BACKING.aligned(16, 8)))).not.toThrow();
            expect(() => op(new UnsafeBuffer(SHARED_BACKING.aligned(16, 8)))).toThrow(IllegalArgumentException);
        }
    });
});

describe('UnsafeBufferLongAliasOverrideRegression', () => {
    for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
        describe(backing.name, () => {
            const calls: string[] = [];

            // the aliases are property declarations of UnsafeBuffer (the same function objects as their targets), so a
            // subclass overrides one by redefining it on its prototype, as a Java subclass overrides a method
            class OverridesAlias extends UnsafeBuffer {}
            const base = UnsafeBuffer.prototype;
            const override = (name: string, wrapper: (self: UnsafeBuffer, ...args: number[]) => unknown): void => {
                Object.defineProperty(OverridesAlias.prototype, name, {
                    value: function (this: UnsafeBuffer, ...args: number[]) {
                        calls.push(name);
                        return wrapper(this, ...args);
                    },
                    writable: true,
                    configurable: true,
                });
            };
            override('getLongAcquire', (self, i) => base.getLongAcquire.call(self, i!) + 1000);
            override('putLongRelease', (self, i, v) => base.putLongRelease.call(self, i!, v! + 1000));
            override('addLongRelease', (self, i, d) => base.addLongRelease.call(self, i!, d! + 1000));

            class OverridesTarget extends UnsafeBuffer {
                public override getLongVolatile(index: number): number {
                    calls.push('getLongVolatile');
                    return super.getLongVolatile(index) + 1000;
                }

                public override putLongVolatile(index: number, value: number): void {
                    calls.push('putLongVolatile');
                    super.putLongVolatile(index, value + 1000);
                }

                public override getAndAddLong(index: number, delta: number): number {
                    calls.push('getAndAddLong');
                    return super.getAndAddLong(index, delta + 1000);
                }
            }

            it('overriding an alias changes only that alias', () => {
                calls.length = 0;
                const buffer = new OverridesAlias(backing.aligned(16, 8));
                buffer.putLongVolatile(0, 5);

                expect(buffer.getLongAcquire(0)).toBe(1005);
                expect(calls).toEqual(['getLongAcquire']);
                expect(buffer.getLongVolatile(0)).toBe(5);
                expect(buffer.getLongOpaque(0)).toBe(5);
                expect(calls).toEqual(['getLongAcquire']);

                buffer.putLongRelease(0, 1);
                expect(calls).toEqual(['getLongAcquire', 'putLongRelease']);
                expect(buffer.getLongVolatile(0)).toBe(1001);
                buffer.putLongOrdered(0, 2);
                buffer.putLongOpaque(0, 3);
                expect(buffer.getLongVolatile(0)).toBe(3);

                buffer.putLongVolatile(0, 10);
                expect(buffer.addLongRelease(0, 1)).toBe(10);
                expect(buffer.getLongVolatile(0)).toBe(1011);
                expect(buffer.getAndAddLong(0, 1)).toBe(1011);
                buffer.addLongOrdered(0, 1);
                buffer.addLongOpaque(0, 1);
                expect(buffer.getLongVolatile(0)).toBe(1014);
                expect(calls).toEqual(['getLongAcquire', 'putLongRelease', 'addLongRelease']);
            });

            it('overriding the target does not change the aliases', () => {
                calls.length = 0;
                const buffer = new OverridesTarget(backing.aligned(16, 8));
                buffer.putLongOrdered(0, 5);
                expect(buffer.getLongAcquire(0)).toBe(5);
                expect(buffer.getLongOpaque(0)).toBe(5);
                buffer.putLongRelease(0, 6);
                buffer.putLongOpaque(0, 7);
                expect(buffer.getLongAcquire(0)).toBe(7);
                expect(buffer.addLongRelease(0, 1)).toBe(7);
                buffer.addLongOrdered(0, 1);
                buffer.addLongOpaque(0, 1);
                expect(buffer.getLongAcquire(0)).toBe(10);
                expect(calls).toEqual([]);

                expect(buffer.getLongVolatile(0)).toBe(1010);
                buffer.putLongVolatile(0, 1);
                expect(buffer.getAndAddLong(0, 1)).toBe(1001);
                expect(calls).toEqual(['getLongVolatile', 'putLongVolatile', 'getAndAddLong']);
            });
        });
    }
});
