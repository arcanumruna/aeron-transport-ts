// Extra tests of issue #52 (port-only): the int fields of `UnsafeBuffer` (capacity, address offset, wrap adjustment and
// base) are written as 32-bit integers. A log length that went through `alignLong` is a number V8 may hold as a heap
// number; stored unconverted in a field, it made the field of the hidden class a double for every buffer of the
// process, and every load of it in code that is not inlined boxed a new heap number. The log is built first, through
// `MemoryLogFactory`, so that such a value reaches the buffer; then the reads of several buffers must allocate nothing.
import { describe, it } from 'vitest';
import { ExpandableArrayBuffer } from '../../../../src/agrona/ExpandableArrayBuffer.js';
import type { MutableDirectBuffer } from '../../../../src/agrona/MutableDirectBuffer.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { MemoryLogFactory } from '../../../../src/driver/buffer/MemoryLogFactory.js';
import { expectNoAllocation } from '../../../support/Allocation.js';

// Subclasses with maps of their own make the load in `reader` megamorphic, the case in which a double field is boxed.
class B1 extends UnsafeBuffer {}
class B2 extends UnsafeBuffer {}
class B3 extends UnsafeBuffer {}
class B4 extends UnsafeBuffer {}
class B5 extends UnsafeBuffer {}
class B6 extends UnsafeBuffer {}

describe('UnsafeBufferIntFieldsAllocationTest', () => {
    it('Regression: reads of buffers wrapped over a computed log length allocate no heap numbers', async () => {
        const counters = new UnsafeBuffer(new SharedArrayBuffer(1024));
        const factory = new MemoryLogFactory(4096, null, new AtomicCounter(counters, 0));
        const rawLog = factory.newPublication(42, LogBufferDescriptor.TERM_MIN_LENGTH, false);

        const buffers: MutableDirectBuffer[] = [
            rawLog.metaData(),
            rawLog.termBuffers()[0]!,
            rawLog.termBuffers()[1]!,
            new UnsafeBuffer(new Uint8Array(4096), 64, 1024),
            new UnsafeBuffer(rawLog.metaData(), 128, 256),
            new ExpandableArrayBuffer(1024),
            new B1(new Uint8Array(4096), 8, 1024),
            new B2(new Uint8Array(4096), 8, 1024),
            new B3(new Uint8Array(4096), 8, 1024),
            new B4(new Uint8Array(4096), 8, 1024),
            new B5(new Uint8Array(4096), 8, 1024),
            new B6(rawLog.metaData(), 8, 1024),
        ];
        const reader = (buffer: MutableDirectBuffer, index: number): number => buffer.getInt(index);
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sink += reader(buffers[i % buffers.length]!, (i & 15) << 2);
            }
        }, 8_000_000);
        if (sink === 1.5) {
            throw new Error('unreachable');
        }
        factory.close();
    });
});
