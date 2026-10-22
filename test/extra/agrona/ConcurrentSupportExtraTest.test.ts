// Not in Agrona: the idle strategies that return the wait instead of blocking (spec D11), the epoch nano clock, NoOpLock,
// ConcurrentCountersManager (CountersManager under a lock), ManyToOneConcurrentLinkedQueue's contract beyond its test,
// MutableInteger's int arithmetic and SemanticVersion's limits.
import { describe, expect, it, vi } from 'vitest';
import { MutableInteger } from '../../../src/agrona/collections/MutableInteger.js';
import { BusySpinIdleStrategy } from '../../../src/agrona/concurrent/BusySpinIdleStrategy.js';
import { ControllableIdleStrategy } from '../../../src/agrona/concurrent/ControllableIdleStrategy.js';
import { ManyToOneConcurrentLinkedQueue } from '../../../src/agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { NoOpLock } from '../../../src/agrona/concurrent/NoOpLock.js';
import { SleepingMillisIdleStrategy } from '../../../src/agrona/concurrent/SleepingMillisIdleStrategy.js';
import { ConcurrentCountersManager } from '../../../src/agrona/concurrent/status/ConcurrentCountersManager.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferStatusIndicator } from '../../../src/agrona/concurrent/status/UnsafeBufferStatusIndicator.js';
import { SystemEpochNanoClock } from '../../../src/agrona/concurrent/SystemEpochNanoClock.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { SemanticVersion } from '../../../src/agrona/SemanticVersion.js';
import {
    IllegalArgumentException,
    IllegalStateException,
    Integer,
    NullPointerException,
    UnsupportedOperationException,
} from '../../../src/agrona/jdk.js';
import { NoSuchElementException } from '../../../src/agrona/jdkUtil.js';
import { assertThrows } from '../../support/Assertions.js';
import { mulberry32 } from '../../support/Random.js';

const { COUNTER_LENGTH, METADATA_LENGTH } = CountersReader;

describe('ConcurrentSupportExtra', () => {
    describe('idle strategies', () => {
        it('busySpinNeverWaitsAndNamesItself', () => {
            const strategy = new BusySpinIdleStrategy();

            expect([strategy.idle(), strategy.idle(0), strategy.idle(5), BusySpinIdleStrategy.INSTANCE.idle()]).toEqual(
                [0, 0, 0, 0],
            );
            strategy.reset();
            expect(strategy.alias()).toBe('spin');
            expect(strategy.toString()).toBe('BusySpinIdleStrategy{alias=spin}');
        });

        it('sleepingMillisReturnsThePeriodInNanosecondsWhenThereIsNoWork', () => {
            const strategy = new SleepingMillisIdleStrategy(7);

            expect(strategy.idle()).toBe(7_000_000);
            expect(strategy.idle(0)).toBe(7_000_000);
            expect(strategy.idle(1)).toBe(0);
            expect(new SleepingMillisIdleStrategy().idle()).toBe(1_000_000);
            expect(new SleepingMillisIdleStrategy(0).idle()).toBe(0);
            expect(strategy.alias()).toBe('sleep-ms');
            expect(strategy.toString()).toBe('SleepingMillisIdleStrategy{alias=sleep-ms, sleepPeriodMs=7}');
        });

        it('controllableFollowsTheStatusIndicator', () => {
            const buffer = new UnsafeBuffer(new ArrayBuffer(4 * COUNTER_LENGTH));
            const indicator = new UnsafeBufferStatusIndicator(buffer, 1);
            const strategy = new ControllableIdleStrategy(indicator);

            const waits = new Map<number, number>();
            for (const status of [
                ControllableIdleStrategy.NOT_CONTROLLED,
                ControllableIdleStrategy.NOOP,
                ControllableIdleStrategy.BUSY_SPIN,
                ControllableIdleStrategy.YIELD,
                ControllableIdleStrategy.PARK,
                99,
                -1,
            ]) {
                indicator.setVolatile(status);
                waits.set(status, strategy.idle());
            }

            expect([...waits]).toEqual([
                [0, 1000],
                [1, 0],
                [2, 0],
                [3, 0],
                [4, 1000],
                [99, 1000],
                [-1, 1000],
            ]);
            indicator.setVolatile(ControllableIdleStrategy.PARK);
            expect(strategy.idle(3)).toBe(0);
            expect(strategy.idle(0)).toBe(1000);
            strategy.reset();
            expect(strategy.alias()).toBe('controllable');
            expect(strategy.toString()).toContain('ControllableIdleStrategy{alias=controllable, statusIndicator=');
        });
    });

    describe('SystemEpochNanoClock', () => {
        it('isCloseToTheWallClockAndNeverGoesBack', () => {
            const clock = SystemEpochNanoClock.INSTANCE;
            const before = Date.now() * 1e6;
            let previous = clock.nanoTime();
            for (let i = 0; i < 100_000; i++) {
                const now = clock.nanoTime();
                expect(now).toBeGreaterThanOrEqual(previous);
                previous = now;
            }
            const after = Date.now() * 1e6;

            expect(typeof previous).toBe('number');
            // within a second of the wall clock, to the resolution of a double at 1.8e18 (256 ns)
            expect(previous).toBeGreaterThan(before - 1e9);
            expect(previous).toBeLessThan(after + 1e9);
            expect(Number.isSafeInteger(previous)).toBe(false);
            expect(new SystemEpochNanoClock().nanoTime()).toBeGreaterThanOrEqual(previous);
        });
    });

    describe('NoOpLock', () => {
        it('doesNothingAndAlwaysSucceeds', () => {
            const lock = NoOpLock.INSTANCE;

            lock.lock();
            lock.lockInterruptibly();
            expect(lock.tryLock()).toBe(true);
            expect(lock.tryLock(10)).toBe(true);
            lock.unlock();
            lock.unlock();
            assertThrows(UnsupportedOperationException, () => lock.newCondition());
        });
    });

    describe('ConcurrentCountersManager', () => {
        function newManager(): { manager: ConcurrentCountersManager; metadata: UnsafeBuffer; values: UnsafeBuffer } {
            const metadata = new UnsafeBuffer(new ArrayBuffer(8 * METADATA_LENGTH));
            const values = new UnsafeBuffer(new ArrayBuffer(8 * COUNTER_LENGTH));
            return { manager: new ConcurrentCountersManager(metadata, values), metadata, values };
        }

        it('isACountersManagerWithJavasApi', () => {
            const { manager, metadata, values } = newManager();
            const plain = new CountersManager(metadata, values);

            expect(manager).toBeInstanceOf(CountersManager);
            expect(manager.capacity()).toBe(8);
            expect(manager.available()).toBe(8);

            const a = manager.allocate('a');
            const b = manager.allocate('b', 77);
            const c = manager.allocate('c', 78, (key) => key.putInt(0, 42));
            const d = manager.allocate(
                79,
                new UnsafeBuffer(new Uint8Array([1, 2, 3, 4])),
                1,
                2,
                new UnsafeBuffer(new TextEncoder().encode('label d')),
                0,
                7,
            );

            expect([a, b, c, d]).toEqual([0, 1, 2, 3]);
            expect(manager.available()).toBe(4);
            expect(plain.getCounterLabel(d)).toBe('label d');
            expect(plain.getCounterTypeId(c)).toBe(78);
            expect(metadata.getInt(CountersReader.metaDataOffset(c) + CountersReader.KEY_OFFSET)).toBe(42);
        });

        it('everySetterAndFreeWorkThroughTheLock', () => {
            const { manager, values, metadata } = newManager();
            const id = manager.allocate('base');

            manager.setCounterValue(id, 99);
            manager.setCounterRegistrationId(id, 5);
            manager.setCounterOwnerId(id, 6);
            manager.setCounterReferenceId(id, 7);
            manager.setCounterLabel(id, 'renamed');
            manager.appendToLabel(id, '+more');
            manager.setCounterKey(id, (key) => key.putInt(0, 11));

            expect(values.getLongVolatile(CountersReader.counterOffset(id))).toBe(99);
            expect(manager.getCounterRegistrationId(id)).toBe(5);
            expect(manager.getCounterOwnerId(id)).toBe(6);
            expect(manager.getCounterReferenceId(id)).toBe(7);
            expect(manager.getCounterLabel(id)).toBe('renamed+more');
            expect(metadata.getInt(CountersReader.metaDataOffset(id) + CountersReader.KEY_OFFSET)).toBe(11);

            const key = new UnsafeBuffer(new Uint8Array([9, 0, 0, 0]));
            manager.setCounterKey(id, key, 0, 4);
            expect(metadata.getInt(CountersReader.metaDataOffset(id) + CountersReader.KEY_OFFSET)).toBe(9);

            manager.free(id);
            assertThrows(IllegalStateException, () => manager.free(id));
            expect(manager.toString()).toContain('ConcurrentCountersManager{');
        });

        it('takesAndReleasesTheLockAroundEveryOperation', () => {
            const { manager } = newManager();
            const lock = NoOpLock.INSTANCE;
            const lockSpy = vi.spyOn(lock, 'lock');
            const unlockSpy = vi.spyOn(lock, 'unlock');
            try {
                manager.available();
                const id = manager.allocate('x');
                manager.setCounterValue(id, 1);
                manager.setCounterLabel(id, 'y');
                manager.free(id);
                assertThrows(IllegalStateException, () => manager.free(id)); // the lock is released on a throw

                expect(lockSpy).toHaveBeenCalledTimes(6);
                expect(unlockSpy).toHaveBeenCalledTimes(6);
            } finally {
                lockSpy.mockRestore();
                unlockSpy.mockRestore();
            }
        });

        it('newCounterAllocatesThroughTheLockedAllocate', () => {
            const { manager } = newManager();
            const counter = manager.newCounter('counted', 5);

            counter.increment();
            expect(counter.get()).toBe(1);
            expect(manager.getCounterLabel(counter.id())).toBe('counted');
        });
    });

    describe('ManyToOneConcurrentLinkedQueue', () => {
        it('rejectsNullAndTheUnsupportedMembersThrow', () => {
            const queue = new ManyToOneConcurrentLinkedQueue<number>();

            assertThrows(NullPointerException, () => queue.offer(null as never));
            assertThrows(NullPointerException, () => queue.add(undefined as never));
            expect(queue.isEmpty()).toBe(true);
            for (const unsupported of [
                () => queue.contains(1),
                () => queue.iterator(),
                () => queue.toArray(),
                () => queue.containsAll([1]),
                () => queue.addAll([1]),
                () => queue.removeAll([1]),
                () => queue.retainAll([1]),
                () => queue.clear(),
                () => queue.remove(1),
            ]) {
                assertThrows(UnsupportedOperationException, unsupported);
            }
        });

        it('removeAndElementThrowWhenEmptyAndPeekDoesNotRemove', () => {
            const queue = new ManyToOneConcurrentLinkedQueue<string>();

            assertThrows(NoSuchElementException, () => queue.remove());
            assertThrows(NoSuchElementException, () => queue.element());
            expect(queue.peek()).toBeNull();

            expect(queue.add('a')).toBe(true);
            expect(queue.add('b')).toBe(true);
            expect(queue.peek()).toBe('a');
            expect(queue.element()).toBe('a');
            expect(queue.size()).toBe(2);
            expect(queue.remove()).toBe('a');
            expect(queue.poll()).toBe('b');
            expect(queue.poll()).toBeNull();
            expect(queue.isEmpty()).toBe(true);
        });

        it('agreesWithAnArrayModelForSeededRandomOffersAndPolls', () => {
            const random = mulberry32(0xc0de);
            const queue = new ManyToOneConcurrentLinkedQueue<{ id: number }>();
            const model: Array<{ id: number }> = [];

            for (let i = 0; i < 50_000; i++) {
                if (random() < 0.5) {
                    const item = { id: i };
                    expect(queue.offer(item)).toBe(true);
                    model.push(item);
                } else {
                    expect(queue.poll()).toBe(model.shift() ?? null);
                }

                expect(queue.size()).toBe(model.length);
                expect(queue.isEmpty()).toBe(0 === model.length);
            }

            expect(queue.toString()).toBe('{' + model.map((o) => String(o)).join(', ') + '}');
        });

        it('aPolledNodeDoesNotRetainItsValue', () => {
            const queue = new ManyToOneConcurrentLinkedQueue<object>();
            const item = {};
            queue.offer(item);

            expect(queue.poll()).toBe(item);
            expect(queue.peek()).toBeNull();
            expect(queue.poll()).toBeNull();
        });
    });

    describe('MutableInteger', () => {
        it('arithmeticWrapsLikeAnInt', () => {
            const v = new MutableInteger(Integer.MAX_VALUE);

            expect(v.incrementAndGet()).toBe(Integer.MIN_VALUE);
            expect(v.decrementAndGet()).toBe(Integer.MAX_VALUE);
            expect(v.getAndIncrement()).toBe(Integer.MAX_VALUE);
            expect(v.get()).toBe(Integer.MIN_VALUE);
            expect(v.getAndDecrement()).toBe(Integer.MIN_VALUE);
            expect(v.get()).toBe(Integer.MAX_VALUE);
            expect(v.addAndGet(2)).toBe(Integer.MIN_VALUE + 1);
            expect(v.getAndAdd(-2)).toBe(Integer.MIN_VALUE + 1);
            expect(v.get()).toBe(Integer.MAX_VALUE);
            v.increment();
            expect(v.get()).toBe(Integer.MIN_VALUE);
            v.decrement();
            expect(v.get()).toBe(Integer.MAX_VALUE);
            v.set(2 ** 32 + 5);
            expect(v.get()).toBe(5);
        });

        it('narrowingAndWideningConversionsAreJavas', () => {
            const v = new MutableInteger(0x12345 + 0x80);

            expect(v.byteValue()).toBe(-59 + 0); // (byte)0x123C5 = 0xC5
            expect(v.shortValue()).toBe(0x23c5);
            expect(v.intValue()).toBe(0x123c5);
            expect(v.longValue()).toBe(0x123c5);
            expect(v.doubleValue()).toBe(0x123c5);
            expect(new MutableInteger(16777217).floatValue()).toBe(16777216);
            expect(new MutableInteger(0xffff).shortValue()).toBe(-1);
        });

        it('equalsHashCodeCompareAndToStringFollowTheValue', () => {
            const a = new MutableInteger(3);
            const b = new MutableInteger(3);
            const c = new MutableInteger(-9);

            expect(a.equals(b)).toBe(true);
            expect(a.equals(c)).toBe(false);
            expect(a.equals(3)).toBe(false);
            expect(a.equals(null)).toBe(false);
            expect(a.hashCode()).toBe(3);
            expect(a.compareTo(c)).toBe(1);
            expect(c.compareTo(a)).toBe(-1);
            expect(a.compareTo(b)).toBe(0);
            expect(MutableInteger.compare(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(-1);
            expect(c.toString()).toBe('-9');
            expect(new MutableInteger().value).toBe(0);
        });
    });

    describe('SemanticVersion', () => {
        it('composesTheExtremesAndRendersThem', () => {
            expect(SemanticVersion.toString(SemanticVersion.compose(255, 255, 255))).toBe('255.255.255');
            expect(SemanticVersion.toString(SemanticVersion.compose(0, 0, 1))).toBe('0.0.1');
            expect(SemanticVersion.compose(255, 255, 255)).toBe(0xffffff);
            expect(SemanticVersion.compose(1, 53, 3)).toBe(0x013503);
            assertThrows(IllegalArgumentException, () => SemanticVersion.compose(0, 256, 0));
            assertThrows(IllegalArgumentException, () => SemanticVersion.compose(0, 0, 0));
        });
    });
});
