// Tests the port adds (spec D16): the 64-bit operations of UnsafeBuffer over a SharedArrayBuffer allocate nothing, with values
// around 2^40 (heap numbers if a call is not inlined). One backing per file: see LongAllocationCases.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { SHARED_BACKING } from '../../../support/Backing.js';
import { LONG_ALLOCATION_CASES } from './LongAllocationCases.js';

describe('SharedLongAtomicsAllocationExtraTest', () => {
    it.each(LONG_ALLOCATION_CASES)(
        '$name allocates nothing around 2^40 over a SharedArrayBuffer',
        async ({ prime, body }) => {
            const buffer = new UnsafeBuffer(SHARED_BACKING.arrayBuffer(256));
            const out = new Int32Array(2);
            prime(buffer);
            let sink = 0;
            await expectNoAllocation((n) => {
                sink = body(buffer, out, n);
            });
            expect(Number.isInteger(sink)).toBe(true);
        },
    );
});
