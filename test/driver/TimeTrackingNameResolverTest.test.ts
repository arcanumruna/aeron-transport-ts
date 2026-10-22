/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/TimeTrackingNameResolverTest.java @ 1.53.3
import { describe, expect, it, vi } from 'vitest';
import type { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import type { NanoClock } from '../../src/agrona/concurrent/NanoClock.js';
import { IllegalStateException, NullPointerException } from '../../src/agrona/jdk.js';
import type { CounterProvider } from '../../src/client/CounterProvider.js';
import type { DutyCycleTrackerLike } from '../../src/driver/TimeTrackingNameResolver.js';
import { TimeTrackingNameResolver } from '../../src/driver/TimeTrackingNameResolver.js';
import type { NameResolverAgent } from '../../src/driver/NameResolverAgent.js';
import { InetAddress } from '../../src/driver/jdkNet.js';
import { assertEqualsObject, assertThrowsExactly } from '../support/Assertions.js';
import { expectInOrder } from '../support/InOrder.js';

/** `mock(NameResolverAgent.class)`: every method records its calls and returns null / 0. */
function mockNameResolverAgent() {
    return {
        resolve: vi.fn(),
        lookup: vi.fn(),
        name: vi.fn(),
        init: vi.fn(),
        onStart: vi.fn(),
        doWork: vi.fn(),
        onClose: vi.fn(),
        roleName: vi.fn(),
    };
}

/** `mock(NanoClock.class)`. */
function mockNanoClock() {
    return { nanoTime: vi.fn() };
}

/** `mock(DutyCycleTracker.class)`. */
function mockDutyCycleTracker() {
    return { update: vi.fn(), measureAndUpdate: vi.fn() };
}

function verifyNoInteractions(...mocks: Record<string, ReturnType<typeof vi.fn>>[]): void {
    for (const m of mocks) {
        for (const [name, spy] of Object.entries(m)) {
            expect(spy, name).not.toHaveBeenCalled();
        }
    }
}

/** `verifyNoMoreInteractions` after the verified calls: the only calls are the listed ones, once each. */
function verifyOnlyCalled(m: Record<string, ReturnType<typeof vi.fn>>, ...called: string[]): void {
    for (const [name, spy] of Object.entries(m)) {
        expect(spy, name).toHaveBeenCalledTimes(called.includes(name) ? 1 : 0);
    }
}

describe('TimeTrackingNameResolverTest', () => {
    it('throwsNullPointerExceptionIfDelegateResolverIsNull', () => {
        assertThrowsExactly(
            NullPointerException,
            () =>
                new TimeTrackingNameResolver(
                    null as unknown as NameResolverAgent,
                    mockNanoClock() as NanoClock,
                    mockDutyCycleTracker() as DutyCycleTrackerLike,
                ),
        );
    });

    it('throwsNullPointerExceptionIfNanoClockIsNull', () => {
        assertThrowsExactly(
            NullPointerException,
            () =>
                new TimeTrackingNameResolver(
                    mockNameResolverAgent() as unknown as NameResolverAgent,
                    null as unknown as NanoClock,
                    mockDutyCycleTracker() as DutyCycleTrackerLike,
                ),
        );
    });

    it('throwsNullPointerExceptionIfDutyCycleTrackerIsNull', () => {
        assertThrowsExactly(
            NullPointerException,
            () =>
                new TimeTrackingNameResolver(
                    mockNameResolverAgent() as unknown as NameResolverAgent,
                    mockNanoClock() as NanoClock,
                    null as unknown as DutyCycleTrackerLike,
                ),
        );
    });

    it('closeIsANoOpIfDelegateResolverIsNotCloseable', () => {
        const delegateResolver = mockNameResolverAgent();
        const clock = mockNanoClock();
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        resolver.onClose();

        expect(delegateResolver.onClose).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'onClose');
        verifyOnlyCalled(clock);
        verifyOnlyCalled(maxTime);
    });

    it('closeIShouldCloseDelegateResolver', () => {
        const delegateResolver = mockNameResolverAgent();
        const clock = mockNanoClock();
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        resolver.onClose();

        expect(delegateResolver.onClose).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'onClose');
        verifyNoInteractions(clock, maxTime);
    });

    it('doWorkShouldCallActualMethod', () => {
        const delegateResolver = mockNameResolverAgent();
        const clock = mockNanoClock();
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        resolver.doWork();

        expect(delegateResolver.doWork).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'doWork');
        verifyNoInteractions(clock, maxTime);
    });

    it('initShouldCallActualMethod', () => {
        const delegateResolver = mockNameResolverAgent();
        const clock = mockNanoClock();
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        const countersReader = {} as CountersReader;
        const factory: CounterProvider = { newCounter: vi.fn() };
        resolver.init(countersReader, factory);

        expect(delegateResolver.init).toHaveBeenCalledTimes(1);
        expect(delegateResolver.init).toHaveBeenCalledWith(countersReader, factory);
        verifyOnlyCalled(delegateResolver, 'init');
        verifyNoInteractions(clock, maxTime);
        expect(factory.newCounter).not.toHaveBeenCalled();
    });

    it('lookupShouldMeasureExecutionTime', () => {
        const delegateResolver = mockNameResolverAgent();
        delegateResolver.lookup.mockImplementation((name: string) => name.substring(0, name.indexOf(':')));
        const clock = mockNanoClock();
        const beginNs = 0;
        const endNs = 123456789;
        clock.nanoTime.mockReturnValueOnce(beginNs).mockReturnValueOnce(endNs);
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        const name = 'my-host:8080';
        const endpoint = 'endpoint';
        const isReLookup = false;
        expect(resolver.lookup(name, endpoint, isReLookup)).toBe('my-host');

        expectInOrder(
            [clock.nanoTime, 0],
            [maxTime.update, 0],
            [delegateResolver.lookup, 0],
            [clock.nanoTime, 1],
            [maxTime.measureAndUpdate, 0],
        );
        expect(maxTime.update).toHaveBeenCalledWith(beginNs);
        expect(delegateResolver.lookup).toHaveBeenCalledWith(name, endpoint, isReLookup);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledWith(endNs);
        // inOrder.verifyNoMoreInteractions()
        expect(clock.nanoTime).toHaveBeenCalledTimes(2);
        expect(maxTime.update).toHaveBeenCalledTimes(1);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'lookup');
    });

    it('lookupShouldMeasureExecutionTimeEvenIfExceptionIsThrown', () => {
        const delegateResolver = mockNameResolverAgent();
        const error = new Error('broken');
        delegateResolver.lookup.mockImplementation(() => {
            throw error;
        });
        const clock = mockNanoClock();
        // Java: 7534957349857893459L, above 2^53 - 1 (spec D5); the value is only passed through to the tracker.
        const beginNs = 236745823658245;
        const endNs = 7534957349857893;
        clock.nanoTime.mockReturnValueOnce(beginNs).mockReturnValueOnce(endNs);
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        const name = 'test:555';
        const endpoint = 'control';
        const isReLookup = true;
        const exception = assertThrowsExactly(Error, () => resolver.lookup(name, endpoint, isReLookup));
        expect(exception).toBe(error);

        expectInOrder(
            [clock.nanoTime, 0],
            [maxTime.update, 0],
            [delegateResolver.lookup, 0],
            [clock.nanoTime, 1],
            [maxTime.measureAndUpdate, 0],
        );
        expect(maxTime.update).toHaveBeenCalledWith(beginNs);
        expect(delegateResolver.lookup).toHaveBeenCalledWith(name, endpoint, isReLookup);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledWith(endNs);
        expect(clock.nanoTime).toHaveBeenCalledTimes(2);
        expect(maxTime.update).toHaveBeenCalledTimes(1);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'lookup');
    });

    it('resolveShouldMeasureExecutionTime', () => {
        const delegateResolver = mockNameResolverAgent();
        delegateResolver.resolve.mockImplementation((name: string) => InetAddress.getByName(name));
        const clock = mockNanoClock();
        const beginNs = 1_000_000_000;
        const endNs = 9_000_000_000;
        clock.nanoTime.mockReturnValueOnce(beginNs).mockReturnValueOnce(endNs);
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        const name = 'localhost';
        const endpoint = 'endpoint';
        const isReLookup = true;
        assertEqualsObject(InetAddress.getLoopbackAddress(), resolver.resolve(name, endpoint, isReLookup));

        expectInOrder(
            [clock.nanoTime, 0],
            [maxTime.update, 0],
            [delegateResolver.resolve, 0],
            [clock.nanoTime, 1],
            [maxTime.measureAndUpdate, 0],
        );
        expect(maxTime.update).toHaveBeenCalledWith(beginNs);
        expect(delegateResolver.resolve).toHaveBeenCalledWith(name, endpoint, isReLookup);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledWith(endNs);
        expect(clock.nanoTime).toHaveBeenCalledTimes(2);
        expect(maxTime.update).toHaveBeenCalledTimes(1);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'resolve');
    });

    it('resolveShouldMeasureExecutionTimeEvenWhenExceptionIsThrown', () => {
        const delegateResolver = mockNameResolverAgent();
        const exception = new IllegalStateException('error');
        delegateResolver.resolve.mockImplementation(() => {
            throw exception;
        });
        const clock = mockNanoClock();
        const beginNs = 0;
        const endNs = 3_000_000_000;
        clock.nanoTime.mockReturnValueOnce(beginNs).mockReturnValueOnce(endNs);
        const maxTime = mockDutyCycleTracker();
        const resolver = new TimeTrackingNameResolver(
            delegateResolver as unknown as NameResolverAgent,
            clock as NanoClock,
            maxTime as DutyCycleTrackerLike,
        );

        const name = 'localhost';
        const endpoint = 'endpoint';
        const isReLookup = true;
        const error = assertThrowsExactly(IllegalStateException, () => resolver.resolve(name, endpoint, isReLookup));
        expect(error).toBe(exception);

        expectInOrder(
            [clock.nanoTime, 0],
            [maxTime.update, 0],
            [delegateResolver.resolve, 0],
            [clock.nanoTime, 1],
            [maxTime.measureAndUpdate, 0],
        );
        expect(maxTime.update).toHaveBeenCalledWith(beginNs);
        expect(delegateResolver.resolve).toHaveBeenCalledWith(name, endpoint, isReLookup);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledWith(endNs);
        expect(clock.nanoTime).toHaveBeenCalledTimes(2);
        expect(maxTime.update).toHaveBeenCalledTimes(1);
        expect(maxTime.measureAndUpdate).toHaveBeenCalledTimes(1);
        verifyOnlyCalled(delegateResolver, 'resolve');
    });
});
