// Extra test of issue #53 (port-only, spec D123): `setMemory(index, length, 0)` copies zero blocks, because `fill` on a
// `SharedArrayBuffer` is 10 to 15 times slower than a copy. Every length and offset must zero exactly the bytes it was asked
// to, on a shared and on a plain buffer, and allocate nothing.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const CAPACITY = 24_000;

function buffers(): [string, UnsafeBuffer][] {
    return [
        ['shared', new UnsafeBuffer(new Uint8Array(new SharedArrayBuffer(CAPACITY)))],
        ['plain', new UnsafeBuffer(new Uint8Array(CAPACITY))],
    ];
}

describe('SetMemoryZeroExtraTest', () => {
    it('zeroes exactly the requested bytes for every length around the block sizes and for odd offsets', () => {
        const lengths = [
            ...Array.from({ length: 70 }, (_, i) => i),
            ...[
                127, 128, 129, 255, 256, 257, 1023, 1024, 1025, 1408, 4095, 4096, 4097, 8191, 8192, 8193, 12_345,
                16_383,
            ],
        ];
        for (const [kind, buffer] of buffers()) {
            for (const offset of [0, 1, 3, 8, 31, 4097]) {
                for (const length of lengths) {
                    buffer.setMemory(0, CAPACITY, 0x5a);
                    buffer.setMemory(offset, length, 0);
                    for (const index of [0, offset - 1, offset, offset + length - 1, offset + length, CAPACITY - 1]) {
                        if (index < 0 || index >= CAPACITY) {
                            continue;
                        }
                        const inside = index >= offset && index < offset + length;
                        expect(
                            buffer.getByte(index),
                            kind + ' offset ' + offset + ' length ' + length + ' at ' + index,
                        ).toBe(inside ? 0 : 0x5a);
                    }
                    // the whole buffer, once for each length: nothing outside the region changed, everything inside is 0
                    let zeros = 0;
                    for (let index = 0; index < CAPACITY; index++) {
                        zeros += 0 === buffer.getByte(index) ? 1 : 0;
                    }
                    expect(zeros, kind + ' offset ' + offset + ' length ' + length).toBe(length);
                }
            }
        }
    });

    it('a value that is not zero is still written by fill', () => {
        for (const [, buffer] of buffers()) {
            buffer.setMemory(0, CAPACITY, 0);
            buffer.setMemory(5, 4100, 0x7f);
            expect(buffer.getByte(4)).toBe(0);
            expect(buffer.getByte(5)).toBe(0x7f);
            expect(buffer.getByte(4104)).toBe(0x7f);
            expect(buffer.getByte(4105)).toBe(0);
        }
    });

    it('still checks the bounds', () => {
        for (const [, buffer] of buffers()) {
            expect(() => buffer.setMemory(CAPACITY - 10, 11, 0)).toThrow();
        }
    });

    it('allocates nothing for the region of an MTU frame or of 32 KiB', async () => {
        const buffer = new UnsafeBuffer(new Uint8Array(new SharedArrayBuffer(1 << 20)));
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                buffer.setMemory((i * 1408) & 0x7ffff, 1408, 0);
                buffer.setMemory(((i * 1408) & 0x7ffff) + 3, 32_765, 0);
            }
        }, 300_000);
    });
});
