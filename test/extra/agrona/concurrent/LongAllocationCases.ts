// The cases of the 2^40 allocation tests (spec D16), shared by the two files that run them, one per backing.
//
// Values around 2^40 are heap numbers whenever they cross a call that is not inlined (spec 5.3), so these cases test
// that the compact, inlined bodies of D16 really are inlined. V8 inlines at most 920 bytecode bytes into a function.
// The `long` methods of UnsafeBuffer are written to fit with both backings in the process (issue #19): the two files
// here measure each backing in its own module instances, and test/extra/agrona/LongLargePositionAllocationTest measures
// every operation after both backings have run, which is the state of a process that has a counters buffer over a
// SharedArrayBuffer next to plain ones. Each body below does ONE kind of operation, with the buffer primed outside it,
// as the hot callers in the port are.
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';

export const INDEX = 64;
const BASE = 2 ** 40;

export interface LongAllocationCase {
    readonly name: string;
    /** Puts the buffer in the state that the body starts from. */
    readonly prime: (buffer: UnsafeBuffer) => void;
    /** The loop that must allocate nothing; it returns a number that depends on every iteration. */
    readonly body: (buffer: UnsafeBuffer, out: Int32Array, n: number) => number;
}

export const LONG_ALLOCATION_CASES: readonly LongAllocationCase[] = [
    {
        name: 'getLong',
        prime: (b) => b.putLong(INDEX, BASE + 5),
        body: (b, _o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                acc = (acc + (b.getLong(INDEX) & 0xff)) | 0;
            }
            return acc;
        },
    },
    {
        name: 'putLong',
        prime: () => {},
        body: (b, _o, n) => {
            for (let i = 0; i < n; i++) {
                b.putLong(INDEX, BASE + (i & 0xffff));
            }
            return 1;
        },
    },
    {
        name: 'getLongVolatile',
        prime: (b) => b.putLongRelease(INDEX, BASE + 5),
        body: (b, _o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                acc = (acc + (b.getLongVolatile(INDEX) & 0xff)) | 0;
            }
            return acc;
        },
    },
    {
        name: 'putLongRelease',
        prime: () => {},
        body: (b, _o, n) => {
            for (let i = 0; i < n; i++) {
                b.putLongRelease(INDEX, BASE + (i & 0xffff));
            }
            return 1;
        },
    },
    {
        name: 'getAndAddLong',
        prime: (b) => b.putLongRelease(INDEX, BASE),
        body: (b, _o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                acc = (acc + (b.getAndAddLong(INDEX, 1) & 0xff)) | 0;
            }
            return acc;
        },
    },
    {
        // the word alternates between BASE + 1000 and BASE + 1001, so every call is a hit
        name: 'compareAndSetLong',
        prime: (b) => b.putLongRelease(INDEX, BASE + 1000),
        body: (b, _o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                const flip = i & 1;
                if (b.compareAndSetLong(INDEX, BASE + 1000 + flip, BASE + 1001 - flip)) {
                    acc = (acc + 1) | 0;
                }
            }
            return acc;
        },
    },
    {
        name: 'getLongVolatileHalves',
        prime: (b) => b.putLongVolatileHalves(INDEX, 5, 256),
        body: (b, o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                b.getLongVolatileHalves(INDEX, o);
                acc = (acc + o[0]! + o[1]!) | 0;
            }
            return acc;
        },
    },
    {
        name: 'putLongVolatileHalves',
        prime: () => {},
        body: (b, _o, n) => {
            for (let i = 0; i < n; i++) {
                b.putLongVolatileHalves(INDEX, i, 256 + (i & 1));
            }
            return 1;
        },
    },
    {
        name: 'compareAndSetLongHalves',
        prime: (b) => b.putLongVolatileHalves(INDEX, 0, 256),
        body: (b, _o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                const flip = i & 1;
                if (b.compareAndSetLongHalves(INDEX, flip, 256, 1 - flip, 256)) {
                    acc = (acc + 1) | 0;
                }
            }
            return acc;
        },
    },
    {
        name: 'getAndAddLongHalves',
        prime: (b) => b.putLongVolatileHalves(INDEX, 0, 256),
        body: (b, o, n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) {
                b.getAndAddLongHalves(INDEX, 0x7ffffff0, o);
                acc = (acc + o[0]! + o[1]!) | 0;
            }
            return acc;
        },
    },
    {
        name: 'getAndAddRawTailOffset',
        prime: (b) => b.putLongVolatileHalves(INDEX, 0xffffff00 | 0, 256),
        body: (b, _o, n) => {
            const holder = new Int32Array(1);
            let acc = 0;
            for (let i = 0; i < n; i++) {
                acc = (acc + (LogBufferDescriptor.getAndAddRawTailOffset(b, INDEX, 32, holder) & 0xff)) | 0;
                acc = (acc + holder[0]!) | 0;
            }
            return acc;
        },
    },
];
