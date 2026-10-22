// Not in Agrona: IntHashSet add, contains and remove over the existing capacity, and its iteration with
// shouldAvoidAllocation, allocate nothing per call (the dispatcher uses the set per packet). The method is
// test/support/Allocation.ts: the minor collections over a long loop are counted.
import { describe, it } from 'vitest';
import { IntHashSet } from '../../../src/agrona/collections/IntHashSet.js';
import { expectNoAllocation } from '../../support/Allocation.js';

describe('HashSetsHotPathAllocationTest', () => {
    const sum = new Float64Array(1);

    it('intHashSetAddContainsRemoveOverExistingCapacityAllocateNothing', async () => {
        const set = new IntHashSet(2048);
        // fill past the point of any resize, so the loop below stays within the capacity
        for (let i = 1; i <= 1024; i++) {
            set.add(i);
        }

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const value = (i & 1023) + 1;
                set.remove(value);
                set.add(value);
                if (set.contains(value)) {
                    sum[0] = sum[0]! + 1;
                }
                if (set.contains(value + 1024)) {
                    sum[0] = sum[0]! - 1;
                }
            }
        });
    });

    it('intHashSetMissingValueAddContainsRemoveAllocateNothing', async () => {
        const set = new IntHashSet();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                set.add(IntHashSet.MISSING_VALUE);
                if (set.contains(IntHashSet.MISSING_VALUE)) {
                    sum[0] = sum[0]! + 1;
                }
                set.remove(IntHashSet.MISSING_VALUE);
            }
        });
    });

    it('intHashSetIterationWithShouldAvoidAllocationAllocatesNothing', async () => {
        // a small set, so that an iterator per pass (without caching) would be many objects
        const set = new IntHashSet(64, 0.5, true);
        for (let i = 0; i < 4; i++) {
            set.add(i);
        }

        // The consumer is created once, as a hot path holds its callbacks: a closure created per pass allocates
        // unless V8 happens to inline forEachInt, which made this test flaky on a loaded host.
        const consumer = (v: number): void => {
            sum[0] = sum[0]! + v;
        };
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i += 4) {
                for (const it = set.iterator(); it.hasNext();) {
                    sum[0] = sum[0]! + it.nextValue();
                }
                set.forEachInt(consumer);
            }
        });
    });

    it('intHashSetIteratorRemoveAndReAddAllocateNothing', async () => {
        const set = new IntHashSet(64, 0.5, true);
        for (let i = 1; i <= 8; i++) {
            set.add(i);
        }

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i += 8) {
                for (const it = set.iterator(); it.hasNext();) {
                    if (it.nextValue() === 8) {
                        it.remove();
                    }
                }
                set.add(8);
            }
        });
    });
});
