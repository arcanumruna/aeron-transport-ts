// Tests the port adds (spec D16): 64-bit counter values on a counters buffer, across worker_threads and over both
// backings. A counter value is Java's 8 bytes at +0 of its record. The Java tests are single threaded.
import { describe, expect, it } from 'vitest';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BACKINGS, SHARED_BACKING } from '../../../support/Backing.js';
import { runWorkers } from '../../../support/Workers.js';
import { CAPACITY, COUNTER_ID, DONE, START, WRITES } from './SharedCountersLayout.js';

const SCRIPT = new URL('./SharedCounters.worker.ts', import.meta.url);
const TIMEOUT_MS = 25_000;

interface ReaderResult {
    reads: number;
    bad: number;
    firstBad: string;
    last: number;
}

function newManager(
    backing: (typeof BACKINGS)[number],
    counters = 4,
): { manager: CountersManager; values: UnsafeBuffer; metaData: UnsafeBuffer; sab: ArrayBufferLike } {
    const sab = backing.arrayBuffer(counters * CountersReader.COUNTER_LENGTH);
    const values = new UnsafeBuffer(sab);
    const metaData = new UnsafeBuffer(backing.arrayBuffer(counters * CountersReader.METADATA_LENGTH));
    return { manager: new CountersManager(metaData, values), values, metaData, sab };
}

describe('SharedCountersExtraTest', () => {
    it('counterValueIsAtJavasOffset', () => {
        const { manager, sab } = newManager(SHARED_BACKING);
        const first = manager.allocate('first');
        const id = manager.allocate('second');
        const counter = new AtomicCounter(manager.valuesBuffer(), id);
        counter.set(2 ** 40 + 9);
        const view = new DataView(sab);
        expect(first).toBe(0);
        expect(view.getBigInt64(CountersReader.counterOffset(id), true)).toBe(BigInt(2 ** 40 + 9));
        expect(counter.get()).toBe(2 ** 40 + 9);
        // the record's other words are not the value
        expect(view.getBigInt64(CountersReader.counterOffset(first), true)).toBe(0n);
    });

    it('readersOfAnIncrementingCounterNeverSeeATornOrDecreasingValueAcrossThe2Pow32Boundary', async () => {
        const sab = SHARED_BACKING.arrayBuffer(CAPACITY) as SharedArrayBuffer;
        const buffer = new UnsafeBuffer(sab);
        new AtomicCounter(buffer, COUNTER_ID).set(START);

        const results = (await runWorkers(
            SCRIPT,
            [
                { kind: 'writer', buffer: sab },
                { kind: 'position', buffer: sab },
                { kind: 'reader', buffer: sab },
                { kind: 'counter', buffer: sab },
            ],
            TIMEOUT_MS,
        )) as [number, ReaderResult, ReaderResult, ReaderResult];

        expect(results[0]).toBe(WRITES);
        for (const reader of results.slice(1) as ReaderResult[]) {
            expect(reader.bad, reader.firstBad).toBe(0);
            expect(reader.reads).toBeGreaterThan(0);
            expect(reader.last).toBe(START + WRITES);
        }
        expect(buffer.getIntVolatile(DONE)).toBe(1);
        expect(new UnsafeBufferPosition(buffer, COUNTER_ID).getVolatile()).toBe(START + WRITES);
    }, 30_000);
});

describe.each(BACKINGS)('SharedCountersExtraTest over $name', (backing) => {
    // Port-only (spec D16): Java writes 0 at +0 with putLongRelease when a counter is allocated, which must be a striped
    // write on a shared buffer, or the reader would see the value of the counter that was freed.
    it('reusedCounterIdReadsZeroAfterFreeAndAllocateRegression', () => {
        const { manager, values } = newManager(backing);
        const reader: CountersReader = manager;
        const id = manager.allocate('abc');
        const counter = new AtomicCounter(values, id);
        counter.set(0x1_0000_0001);
        counter.increment();
        expect(reader.getCounterValue(id)).toBe(0x1_0000_0002);
        expect(manager.getCounterValue(id)).toBe(0x1_0000_0002);

        manager.free(id);
        expect(manager.allocate('def')).toBe(id);

        expect(reader.getCounterValue(id)).toBe(0);
        expect(new AtomicCounter(values, id).get()).toBe(0);
        expect(new UnsafeBufferPosition(values, id).getVolatile()).toBe(0);

        // and the reused counter counts from 0
        expect(new AtomicCounter(values, id).increment()).toBe(0);
        expect(reader.getCounterValue(id)).toBe(1);
    });

    it('atomicCounterCompareAndSetGetAndSetAndProposeMax', () => {
        const { manager, values } = newManager(backing);
        const counter = new AtomicCounter(values, manager.allocate('c'));
        counter.set(5);
        expect(counter.compareAndSet(4, 9)).toBe(false);
        expect(counter.get()).toBe(5);
        expect(counter.compareAndSet(5, 9)).toBe(true);
        expect(counter.get()).toBe(9);
        expect(counter.getAndSet(11)).toBe(9);
        expect(counter.get()).toBe(11);
        expect(counter.proposeMax(11)).toBe(false);
        expect(counter.proposeMaxRelease(11)).toBe(false);
        expect(counter.proposeMaxOpaque(11)).toBe(false);
        expect(counter.proposeMax(12)).toBe(true);
        expect(counter.get()).toBe(12);
        expect(counter.proposeMaxRelease(13)).toBe(true);
        expect(counter.proposeMaxOpaque(14)).toBe(true);
        expect(counter.get()).toBe(14);
    });

    it('unsafeBufferPositionProposeMaxOfTheCurrentValueIsFalse', () => {
        const { manager, values } = newManager(backing);
        const position = new UnsafeBufferPosition(values, manager.allocate('p'));
        position.set(5);
        expect(position.proposeMax(5)).toBe(false);
        expect(position.proposeMax(6)).toBe(true);
        expect(position.get()).toBe(6);
    });

    it('countersReaderForEachOfTheValueConsumerCollectsValueIdAndLabel', () => {
        const { manager, values } = newManager(backing);
        const id0 = manager.allocate('label0');
        const id1 = manager.allocate('label1');
        new AtomicCounter(values, id0).set(7);
        new AtomicCounter(values, id1).set(0x1_0000_0002);

        const seen: [number, number, string][] = [];
        manager.forEachCounterConsumer((value, id, label) => {
            seen.push([value, id, label]);
        });

        expect(seen).toEqual([
            [7, id0, 'label0'],
            [0x1_0000_0002, id1, 'label1'],
        ]);
    });

    it('allAccessorsAgreeAfterUnsafeBufferPositionSetRelease', () => {
        const { manager, values, sab } = newManager(backing);
        const id = manager.allocate('agree');
        const position = new UnsafeBufferPosition(values, id);
        for (const v of [0, 1, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 3, 2 ** 53 - 1]) {
            position.setRelease(v);
            expect(manager.getCounterValue(id)).toBe(v);
            expect(new AtomicCounter(values, id).get()).toBe(v);
            expect(values.getLongVolatile(CountersReader.counterOffset(id))).toBe(v);
            expect(new DataView(sab).getBigInt64(CountersReader.counterOffset(id), true)).toBe(BigInt(v));
        }
    });

    it('theThreeIdsOfARecordAreUntouchedByAtomicCounterSet', () => {
        const { manager, values } = newManager(backing);
        const id = manager.allocate('ids');
        manager.setCounterRegistrationId(id, 0x1_0000_0011);
        manager.setCounterOwnerId(id, 0x2_0000_0022);
        manager.setCounterReferenceId(id, 0x3_0000_0033);
        const counter = new AtomicCounter(values, id);
        counter.set(2 ** 40 + 1);
        counter.set(3);

        expect(manager.getCounterRegistrationId(id)).toBe(0x1_0000_0011);
        expect(manager.getCounterOwnerId(id)).toBe(0x2_0000_0022);
        expect(manager.getCounterReferenceId(id)).toBe(0x3_0000_0033);
        expect(counter.get()).toBe(3);
    });
});
