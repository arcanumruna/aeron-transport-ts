// Tests the port adds (issue #26; spec D16, 5.3): the allocation cases of `DriverStatusExtraTest` ("allocation on the
// duty cycle") over a SharedArrayBuffer counters buffer, which is the backing in production (the CnC). Its 64-bit
// atomics are the striped path of D16, which allocates differently from the ArrayBuffer path. V8 inlines at most 920
// bytes into one function and a dispatcher that has run on both backings inlines both bodies, so this file only ever
// runs the shared backing (D16). The bounds are the smallest that pass on the shared backing; a value above 2^31 is a
// double and V8 boxes it in a heap number whenever it crosses a call that is not inlined (issue #19).
// `DutyCycleTracker.measureAndUpdate` keeps its state in fields and touches no buffer, so it has no shared variant.
import { describe, expect, it } from 'vitest';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { StandardCharsets } from '../../../../src/agrona/jdkLang.js';
import { DutyCycleStallTracker } from '../../../../src/driver/status/DutyCycleStallTracker.js';
import { SystemCounterDescriptor } from '../../../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../../../src/driver/status/SystemCounters.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { SHARED_BACKING } from '../../../support/Backing.js';

const { METADATA_LENGTH, COUNTER_LENGTH } = CountersReader;
const CACHE_LINE_LENGTH = 64;
const BIG = 2 ** 40;

/** The heap numbers per iteration that the loops over values above 2^31 may allocate on the shared backing. */
const BOUNDS = { stallTrackerFromBig: 1, setReleaseFromBig: 1 };

function newManager(counters = 64): CountersManager {
    const metadata = new UnsafeBuffer(SHARED_BACKING.arrayBuffer(counters * METADATA_LENGTH));
    const values = new UnsafeBuffer(SHARED_BACKING.aligned(counters * COUNTER_LENGTH, CACHE_LINE_LENGTH));
    return new CountersManager(metadata, values, StandardCharsets.US_ASCII);
}

describe('DriverStatusSharedAllocationTest', () => {
    // Mutation: reportMeasurement allocates (a template string or an array per call).
    it.each([
        ['from 0', 0, 0],
        ['from 2^40', BIG, BOUNDS.stallTrackerFromBig],
    ] as const)(
        'DutyCycleStallTracker.measureAndUpdate %s on a shared counters buffer',
        async (_name, start, bound) => {
            const manager = newManager();
            const tracker = new DutyCycleStallTracker(manager.newCounter('max'), manager.newCounter('exceeded'), 1500);
            await expectNoAllocation(
                (n) => {
                    let now = start;
                    for (let i = 0; i < n; i++) {
                        now += 1000 + (i & 1023);
                        tracker.measureAndUpdate(now);
                    }
                },
                undefined,
                bound,
            );
            expect(tracker.cycleTimeThresholdExceededCount().get()).toBeGreaterThan(0);
        },
    );

    // Mutation: SystemCounters.get allocates, or the striped increment boxes a value.
    it('SystemCounters get + AtomicCounter.increment + incrementRelease on a shared counters buffer', async () => {
        const systemCounters = new SystemCounters(newManager());
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                systemCounters.get(SystemCounterDescriptor.BYTES_SENT).increment();
                systemCounters.get(SystemCounterDescriptor.HEARTBEATS_SENT).incrementRelease();
            }
        });
        expect(systemCounters.get(SystemCounterDescriptor.BYTES_SENT).get()).toBeGreaterThan(0);
    });

    // Mutation: setRelease allocates (a closure or an object per call).
    it('SystemCounters counter setRelease with values below 2^31 on a shared counters buffer', async () => {
        const counter = new SystemCounters(newManager()).get(SystemCounterDescriptor.BYTES_SENT);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                counter.setRelease(i & 0x3fffffff);
            }
        });
        expect(counter.get()).toBeGreaterThan(0);
    });

    // Mutation: setRelease allocates more than the box of the value (a second heap number, a closure or an object).
    it('SystemCounters counter setRelease with values near 2^40 on a shared counters buffer', async () => {
        const counter = new SystemCounters(newManager()).get(SystemCounterDescriptor.BYTES_SENT);
        await expectNoAllocation(
            (n) => {
                let value = BIG;
                for (let i = 0; i < n; i++) {
                    value += 1000;
                    counter.setRelease(value);
                }
            },
            undefined,
            BOUNDS.setReleaseFromBig,
        );
        expect(counter.get()).toBeGreaterThan(BIG);
    });
});
