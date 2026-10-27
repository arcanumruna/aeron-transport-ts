// Not in Agrona: the counters and the positions allocate nothing per call with a value of about 2^40 (a position past
// 2 GiB), over an ArrayBuffer and a SharedArrayBuffer counters buffer in the same process (spec 5.3, D16, issue #19). The
// value of such a counter is outside V8's 31-bit small integers, so a call that is not inlined would box it in a heap
// number. `AtomicCounter` (the driver's and the client's counters), `UnsafeBufferPosition` (positions and limits) and
// `ReadableCounter` (the client's view of a counter) wrap `UnsafeBuffer`'s `long` operations in one more call; each case
// is one operation in a loop. Both backings are exercised first, so that the shared dispatch has seen both whichever
// backing a case measures.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersReader } from '../../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { ReadableCounter } from '../../../../../src/client/status/ReadableCounter.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../../../support/Backing.js';
import { expectNoAllocation } from '../../../../support/Allocation.js';

/** A safe integer far outside the 31-bit small integers. */
const LARGE = 2 ** 40;
const COUNTER_ID = 0;
const sum = new Float64Array(1);

interface Rig {
    readonly metadata: UnsafeBuffer;
    readonly values: UnsafeBuffer;
    readonly counter: AtomicCounter;
    readonly position: UnsafeBufferPosition;
    readonly readable: ReadableCounter;
}

function newRig(backing: typeof ARRAY_BACKING): Rig {
    const metadata = new UnsafeBuffer(backing.bytes(CountersReader.METADATA_LENGTH * 2));
    const values = new UnsafeBuffer(backing.bytes(CountersReader.COUNTER_LENGTH * 2));
    metadata.putInt(CountersReader.metaDataOffset(COUNTER_ID) + CountersReader.TYPE_ID_OFFSET, 1);
    metadata.putIntOrdered(CountersReader.metaDataOffset(COUNTER_ID), CountersReader.RECORD_ALLOCATED);
    const reader = new CountersReader(metadata, values);
    return {
        metadata,
        values,
        counter: new AtomicCounter(values, COUNTER_ID),
        position: new UnsafeBufferPosition(values, COUNTER_ID),
        readable: new ReadableCounter(reader, COUNTER_ID),
    };
}

/** Runs every operation over both backings, so that the type feedback has seen both. */
function exerciseBothBackings(): void {
    for (const backing of [ARRAY_BACKING, SHARED_BACKING]) {
        const { counter, position, readable } = newRig(backing);
        for (let i = 0; i < 5_000; i++) {
            counter.set(LARGE + i);
            counter.setOrdered(LARGE + i);
            counter.setRelease(LARGE + i);
            counter.setOpaque(LARGE + i);
            sum[0] = sum[0]! + counter.get() + counter.getAcquire() + counter.getOpaque() + counter.getWeak();
            sum[0] = sum[0]! + counter.increment() + counter.incrementOrdered() + counter.getAndAdd(2);
            sum[0] = sum[0]! + counter.getAndSet(LARGE + i) + (counter.compareAndSet(LARGE + i, LARGE + i + 1) ? 1 : 0);
            counter.proposeMax(LARGE + i + 3);
            counter.proposeMaxOrdered(LARGE + i + 5);
            position.setOrdered(LARGE + i);
            position.setVolatile(LARGE + i);
            position.setRelease(LARGE + i);
            position.set(LARGE + i);
            position.proposeMaxOrdered(LARGE + i + 1);
            sum[0] = sum[0]! + position.getVolatile() + position.get() + position.getAcquire();
            sum[0] = sum[0]! + readable.get() + readable.getWeak();
        }
    }
}

describe.each([ARRAY_BACKING, SHARED_BACKING])('CountersLargePositionAllocation %s', (backing) => {
    const rig = newRig(backing);
    const { counter, position, readable } = rig;

    const cases: [string, (n: number) => void][] = [
        [
            'AtomicCounter set, get',
            (n) => {
                for (let i = 0; i < n; i++) {
                    counter.set(LARGE + i);
                    sum[0] = sum[0]! + counter.get();
                }
            },
        ],
        [
            'AtomicCounter setOrdered, getWeak',
            (n) => {
                for (let i = 0; i < n; i++) {
                    counter.setOrdered(LARGE + i);
                    sum[0] = sum[0]! + counter.getWeak();
                }
            },
        ],
        [
            'AtomicCounter increment',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + counter.increment();
                }
            },
        ],
        [
            'AtomicCounter incrementOrdered',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + counter.incrementOrdered();
                }
            },
        ],
        [
            'AtomicCounter getAndAdd',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + counter.getAndAdd(3);
                }
            },
        ],
        [
            'AtomicCounter getAndSet',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + counter.getAndSet(LARGE + i);
                }
            },
        ],
        [
            'AtomicCounter compareAndSet',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    if (counter.compareAndSet(LARGE + i, LARGE + i + 1)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
        [
            'AtomicCounter proposeMaxOrdered',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    if (counter.proposeMaxOrdered(LARGE + i)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
        [
            'UnsafeBufferPosition setOrdered, getVolatile',
            (n) => {
                for (let i = 0; i < n; i++) {
                    position.setOrdered(LARGE + i);
                    sum[0] = sum[0]! + position.getVolatile();
                }
            },
        ],
        [
            'UnsafeBufferPosition setRelease, getAcquire',
            (n) => {
                for (let i = 0; i < n; i++) {
                    position.setRelease(LARGE + i);
                    sum[0] = sum[0]! + position.getAcquire();
                }
            },
        ],
        [
            'UnsafeBufferPosition set, get',
            (n) => {
                for (let i = 0; i < n; i++) {
                    position.set(LARGE + i);
                    sum[0] = sum[0]! + position.get();
                }
            },
        ],
        [
            'UnsafeBufferPosition proposeMaxOrdered',
            (n) => {
                position.set(LARGE);
                for (let i = 0; i < n; i++) {
                    if (position.proposeMaxOrdered(LARGE + i)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
        [
            'ReadableCounter get',
            (n) => {
                counter.set(LARGE);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + readable.get();
                }
            },
        ],
    ];

    for (const [name, loop] of cases) {
        it(`${name}LargePosition`, async () => {
            exerciseBothBackings();
            await expectNoAllocation(loop);
            expect(sum[0]).not.toBeNaN();
        });
    }
});
