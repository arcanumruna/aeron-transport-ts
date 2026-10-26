// Not in Agrona: every `long` operation of UnsafeBuffer allocates nothing per call at a value of about 2^40, which is
// outside V8's 31-bit small integers and would be boxed in a heap number by any call that is not inlined (issue #19).
// Each case is one operation in a loop, over an ArrayBuffer and a SharedArrayBuffer (spec D16), and the value is read
// back and summed into a double, so the result of the operation is used. Allocation is counted by minor collections
// (test/support/Allocation.ts).
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../support/Backing.js';
import { expectNoAllocation } from '../../support/Allocation.js';

/** A safe integer far outside the 31-bit small integers. */
const LARGE = 2 ** 40;
const ITERATIONS = 2_000_000;

/**
 * Runs every operation over the buffers of BOTH backings, so that the type feedback of the shared dispatchers (`_shared ?
 * getLongShared : getLongPlain`) has seen both branches whichever backing a case measures. A process that has both (a
 * client with a counters buffer over a SharedArrayBuffer next to plain ones) runs them that way, and a dispatcher that
 * has seen both inlines both bodies, which is the case that runs out of V8's inlining budget (issue #19).
 */
function exerciseBothBackings(): void {
    for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
        const b = new UnsafeBuffer(backing.bytes(64));
        for (let i = 0; i < 5_000; i++) {
            b.putLong(8, LARGE + i);
            b.putLongVolatile(8, LARGE + i);
            b.putLongOrdered(8, LARGE + i);
            b.putLongRelease(8, LARGE + i);
            b.putLongOpaque(8, LARGE + i);
            sum[0] = sum[0]! + b.getLong(8) + b.getLongVolatile(8) + b.getLongAcquire(8) + b.getLongOpaque(8);
            sum[0] = sum[0]! + b.getAndAddLong(8, 1) + b.addLongOrdered(8, 1) + b.addLongRelease(8, 1);
            sum[0] = sum[0]! + b.addLongOpaque(8, 1) + b.getAndSetLong(8, LARGE + i);
            b.compareAndSetLong(8, LARGE + i, LARGE + i + 1);
            sum[0] = sum[0]! + b.compareAndExchangeLong(8, LARGE + i, LARGE + i + 1);
        }
    }
}

const sum = new Float64Array(1);

describe.each([ARRAY_BACKING, SHARED_BACKING])('LongLargePositionAllocation %s', (backing) => {
    const buffer = new UnsafeBuffer(backing.bytes(256));

    const cases: [string, (n: number) => void][] = [
        [
            'putLong, getLong',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLong(8, LARGE + i);
                    sum[0] = sum[0]! + buffer.getLong(8);
                }
            },
        ],
        [
            'putLong, getLong big endian',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLong(8, LARGE + i, ByteOrder.BIG_ENDIAN);
                    sum[0] = sum[0]! + buffer.getLong(8, ByteOrder.BIG_ENDIAN);
                }
            },
        ],
        [
            'putLongVolatile, getLongVolatile',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLongVolatile(8, LARGE + i);
                    sum[0] = sum[0]! + buffer.getLongVolatile(8);
                }
            },
        ],
        [
            'putLongOrdered, getLongAcquire',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLongOrdered(8, LARGE + i);
                    sum[0] = sum[0]! + buffer.getLongAcquire(8);
                }
            },
        ],
        [
            'putLongRelease, getLongVolatile',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLongRelease(8, LARGE + i);
                    sum[0] = sum[0]! + buffer.getLongVolatile(8);
                }
            },
        ],
        [
            'putLongOpaque, getLongOpaque',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLongOpaque(8, LARGE + i);
                    sum[0] = sum[0]! + buffer.getLongOpaque(8);
                }
            },
        ],
        [
            'getAndAddLong',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.getAndAddLong(8, 1);
                }
            },
        ],
        [
            'addLongOrdered',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.addLongOrdered(8, 1);
                }
            },
        ],
        [
            'addLongRelease',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.addLongRelease(8, 1);
                }
            },
        ],
        [
            'addLongOpaque',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.addLongOpaque(8, 1);
                }
            },
        ],
        [
            'getAndSetLong',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.getAndSetLong(8, LARGE + i);
                }
            },
        ],
        [
            'compareAndSetLong',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    if (buffer.compareAndSetLong(8, LARGE + i, LARGE + i + 1)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
        [
            'compareAndExchangeLong',
            (n) => {
                buffer.putLong(8, LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.compareAndExchangeLong(8, LARGE + i, LARGE + i + 1);
                }
            },
        ],
    ];
    for (const [name, loop] of cases) {
        it(`${name}LargePosition`, async () => {
            exerciseBothBackings();
            buffer.setMemory(0, 64, 0);
            await expectNoAllocation(loop, ITERATIONS);
            expect(sum[0]).not.toBeNaN();
        });
    }
});
