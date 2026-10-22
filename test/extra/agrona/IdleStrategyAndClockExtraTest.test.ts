// Not in Agrona (its idle strategies and clocks have no tests of their own except CachedClockTest, which is not
// mapped): the idle strategies return the wait instead of blocking (spec D11), and the clocks.
import { describe, expect, it } from 'vitest';
import { BackoffIdleStrategy } from '../../../src/agrona/concurrent/BackoffIdleStrategy.js';
import { CachedEpochClock } from '../../../src/agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { SleepingIdleStrategy } from '../../../src/agrona/concurrent/SleepingIdleStrategy.js';
import { SystemEpochClock } from '../../../src/agrona/concurrent/SystemEpochClock.js';
import { SystemNanoClock } from '../../../src/agrona/concurrent/SystemNanoClock.js';
import { YieldingIdleStrategy } from '../../../src/agrona/concurrent/YieldingIdleStrategy.js';
import { TimeUnit } from '../../../src/agrona/jdk.js';

describe('IdleStrategyExtra', () => {
    it('noOpAndYieldingNeverWaitAndNameThemselves', () => {
        for (const strategy of [new NoOpIdleStrategy(), NoOpIdleStrategy.INSTANCE, new YieldingIdleStrategy()]) {
            expect([strategy.idle(), strategy.idle(0), strategy.idle(1), strategy.idle(-1)]).toEqual([0, 0, 0, 0]);
            strategy.reset();
            expect(strategy.idle()).toBe(0);
        }

        expect(new NoOpIdleStrategy().alias()).toBe('noop');
        expect(YieldingIdleStrategy.INSTANCE.alias()).toBe('yield');
        expect(new NoOpIdleStrategy().toString()).toBe('NoOpIdleStrategy{alias=noop}');
        expect(new YieldingIdleStrategy().toString()).toBe('YieldingIdleStrategy{alias=yield}');
    });

    it('sleepingReturnsThePeriodWhenThereIsNoWork', () => {
        const strategy = new SleepingIdleStrategy(1234);

        expect(strategy.idle()).toBe(1234);
        expect(strategy.idle(0)).toBe(1234);
        expect(strategy.idle(-3)).toBe(1234);
        expect(strategy.idle(1)).toBe(0);
        expect(strategy.idle(100)).toBe(0);
        strategy.reset();
        expect(strategy.idle()).toBe(1234);
        expect(strategy.alias()).toBe('sleep-ns');
        expect(strategy.toString()).toBe('SleepingIdleStrategy{alias=sleep-ns, sleepPeriodNs=1234}');
    });

    it('sleepingDefaultsAndTimeUnit', () => {
        expect(new SleepingIdleStrategy().idle()).toBe(SleepingIdleStrategy.DEFAULT_SLEEP_PERIOD_NS);
        expect(new SleepingIdleStrategy(5, TimeUnit.MILLISECONDS).idle()).toBe(5_000_000);
        expect(new SleepingIdleStrategy(2, TimeUnit.MICROSECONDS).idle(0)).toBe(2000);
    });

    it('backoffSpinsThenYieldsThenParksOnADoublingPeriodCappedAtTheMaximum', () => {
        const strategy = new BackoffIdleStrategy(3, 2, 100, 500);

        // 4 calls spin (the first moves to SPINNING; spins 2, 3, 4 > 3 moves to YIELDING), 3 yield (the third moves
        // to PARKING), then the parks
        const waits: number[] = [];
        for (let i = 0; i < 14; i++) {
            waits.push(strategy.idle());
        }

        expect(waits).toEqual([0, 0, 0, 0, 0, 0, 0, 100, 200, 400, 500, 500, 500, 500]);
    });

    it('backoffWorkResetsAndIdleWithoutAWorkCountIgnoresIt', () => {
        const strategy = new BackoffIdleStrategy(0, 0, 100, 400);
        const sequence = (): number[] => [0, 1, 2, 3, 4, 5].map(() => strategy.idle(0));

        const first = sequence();
        expect(first).toEqual([0, 0, 0, 100, 200, 400]);

        expect(strategy.idle(5)).toBe(0); // work: reset
        expect(sequence()).toEqual(first);

        strategy.reset();
        expect(sequence()).toEqual(first);
        expect(strategy.idle(0)).toBe(400);
        expect(strategy.idle(1)).toBe(0);
        expect(strategy.idle()).toBe(0); // reset by the work: spinning again
    });

    it('backoffDefaultsAndNames', () => {
        const strategy = new BackoffIdleStrategy();

        const waits: number[] = [];
        for (let i = 0; i < 20; i++) {
            waits.push(strategy.idle());
        }

        // 11 spins, 6 yields, then parks from 1 us doubling
        expect(waits.slice(0, 17).every((w) => w === 0)).toBe(true);
        expect(waits.slice(17)).toEqual([1000, 2000, 4000]);
        expect(strategy.alias()).toBe('backoff');
        expect(strategy.toString()).toBe(
            'BackoffIdleStrategy{alias=backoff, maxSpins=10, maxYields=5, minParkPeriodNs=1000, maxParkPeriodNs=1000000}',
        );
    });
});

describe('ClockExtra', () => {
    it('cachedNanoClockUpdatesAndAdvances', () => {
        const clock = new CachedNanoClock();
        expect(clock.nanoTime()).toBe(0);

        clock.update(1_000_000_000_000);
        expect(clock.nanoTime()).toBe(1_000_000_000_000);
        clock.advance(5);
        clock.advance(-2);
        expect(clock.nanoTime()).toBe(1_000_000_000_003);
        clock.update(7);
        expect(clock.nanoTime()).toBe(7);
    });

    it('cachedEpochClockUpdatesAndAdvances', () => {
        const clock = new CachedEpochClock();
        expect(clock.time()).toBe(0);

        clock.update(1_700_000_000_000);
        clock.advance(1000);
        expect(clock.time()).toBe(1_700_000_001_000);
    });

    it('systemNanoClockIsMonotonicIntegralAndSinceProcessStart', () => {
        const clock = SystemNanoClock.INSTANCE;
        let previous = clock.nanoTime();
        expect(Number.isInteger(previous)).toBe(true);
        expect(previous).toBeGreaterThan(0);
        expect(previous).toBeLessThan(Number.MAX_SAFE_INTEGER);

        for (let i = 0; i < 1000; i++) {
            const now = new SystemNanoClock().nanoTime();
            expect(Number.isInteger(now)).toBe(true);
            expect(now).toBeGreaterThanOrEqual(previous);
            previous = now;
        }
    });

    it('systemEpochClockIsTheWallClockInMilliseconds', () => {
        const before = Date.now();
        const time = SystemEpochClock.INSTANCE.time();
        const after = Date.now();

        expect(Number.isInteger(time)).toBe(true);
        expect(time).toBeGreaterThanOrEqual(before);
        expect(time).toBeLessThanOrEqual(after);
    });
});
