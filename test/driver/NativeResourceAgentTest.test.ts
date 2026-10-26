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
// Port of io/aeron/driver/NativeResourceAgentTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CountedErrorHandler } from '../../src/agrona/concurrent/CountedErrorHandler.js';
import { OneToOneConcurrentArrayQueue } from '../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { SystemNanoClock } from '../../src/agrona/concurrent/SystemNanoClock.js';
import { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { DutyCycleTracker } from '../../src/driver/DutyCycleTracker.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import type { NameResolverAgent } from '../../src/driver/NameResolverAgent.js';
import { NativeResourceAgent } from '../../src/driver/NativeResourceAgent.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { InOrder } from '../support/InOrder.js';
import { mock } from '../support/Mockito.js';

/** `mock(NameResolverAgent.class)`: an interface, so a hand fake. */
function mockNameResolver() {
    return {
        resolve: vi.fn(),
        lookup: vi.fn(),
        name: vi.fn(),
        init: vi.fn(),
        onStart: vi.fn(),
        doWork: vi.fn<() => number>(() => 0),
        onClose: vi.fn(),
        roleName: vi.fn(),
    };
}

/** `mock(RawLog.class)`: `free` answers false, as a Mockito mock does for a `boolean`. */
function mockRawLog() {
    return {
        termLength: vi.fn(),
        termBuffers: vi.fn(),
        metaData: vi.fn(),
        fileName: vi.fn(),
        free: vi.fn<() => boolean>(() => false),
        close: vi.fn(),
    };
}

function asRawLog(rawLog: ReturnType<typeof mockRawLog>): RawLog {
    return rawLog as unknown as RawLog;
}

describe('NativeResourceAgentTest', () => {
    let nameResolver: ReturnType<typeof mockNameResolver>;
    let queue: OneToOneConcurrentArrayQueue<() => void>;
    let freeFailsCounter: AtomicCounter;
    let executor: NativeResourceAgent;

    beforeEach(() => {
        nameResolver = mockNameResolver();
        queue = new OneToOneConcurrentArrayQueue<() => void>(5);
        freeFailsCounter = mock(AtomicCounter).mock;
        const systemCounters = mock(SystemCounters).mock;
        vi.mocked(systemCounters.get).mockImplementation((descriptor) =>
            SystemCounterDescriptor.FREE_FAILS === descriptor ? freeFailsCounter : (undefined as never),
        );
        const ctx = new MediaDriver.Context()
            .nativeResourceAgentCommandQueue(queue)
            .resourceFreeLimit(3)
            .systemCounters(systemCounters)
            .nameResolver(nameResolver as unknown as NameResolverAgent)
            .countedErrorHandler(mock(CountedErrorHandler).mock)
            .nanoClock(SystemNanoClock.INSTANCE)
            .nameResolverTimeTracker(mock(DutyCycleTracker).mock);
        executor = new NativeResourceAgent(ctx);
    });

    it('shouldCallDoWorkOnNameResolver', () => {
        nameResolver.doWork
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(3)
            .mockReturnValueOnce(0)
            .mockReturnValue(0);

        expect(executor.doWork()).toBe(0);
        expect(executor.doWork()).toBe(1);
        expect(executor.doWork()).toBe(3);
        expect(executor.doWork()).toBe(0);
        expect(executor.doWork()).toBe(0);

        expect(nameResolver.doWork).toHaveBeenCalledTimes(5);
    });

    it('shouldCallDoWorkOnNameResolverProcessQueuedCommandsAndFreeResources', () => {
        nameResolver.doWork
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(7)
            .mockReturnValueOnce(2)
            .mockReturnValueOnce(5)
            .mockReturnValue(0);

        const task1 = vi.fn();
        const task2 = vi.fn();
        const task3 = vi.fn();
        queue.add(task1);
        queue.add(task2);
        queue.add(task3);

        const resource1 = mockRawLog();
        resource1.free.mockReturnValue(true);
        const resource2 = mockRawLog();
        resource2.free.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
        const resource3 = mockRawLog();
        resource3.free.mockReturnValueOnce(false).mockReturnValue(true);
        const resource4 = mockRawLog();
        resource4.free.mockReturnValueOnce(false).mockReturnValue(true);
        executor.onFreeLogBuffer(asRawLog(resource1));
        executor.onFreeLogBuffer(asRawLog(resource2));
        executor.onFreeLogBuffer(asRawLog(resource3));
        executor.onFreeLogBuffer(asRawLog(resource4));

        expect(executor.doWork()).toBe(4);
        expect(executor.doWork()).toBe(9);
        expect(executor.doWork()).toBe(3);
        expect(executor.doWork()).toBe(5);

        // The direct removals (onFreeLogBuffer above) come before the first doWork: Java's InOrder starts after them
        // because the first verification is nameResolver.doWork().
        const inOrder = new InOrder(
            nameResolver,
            { task1, task2, task3 },
            { free1: resource1.free, free2: resource2.free, free3: resource3.free, free4: resource4.free },
            freeFailsCounter,
        );
        inOrder.verify(nameResolver.doWork, 1);
        inOrder.verify(task1, 1);
        inOrder.verify(resource2.free, 1);
        inOrder.verify(vi.mocked(freeFailsCounter.incrementRelease), 1);
        inOrder.verify(resource3.free, 1);
        inOrder.verify(resource4.free, 1);

        inOrder.verify(nameResolver.doWork, 1);
        inOrder.verify(task2, 1);
        inOrder.verify(resource2.free, 1);

        inOrder.verify(nameResolver.doWork, 1);
        inOrder.verify(task3, 1);

        inOrder.verify(nameResolver.doWork, 1);

        inOrder.verifyNoMoreInteractions();
    });

    it('shouldCallOnStartOnNameResolver', () => {
        executor.onStart();

        expect(nameResolver.onStart).toHaveBeenCalledTimes(1);
        // verifyNoMoreInteractions(nameResolver)
        for (const [name, spy] of Object.entries(nameResolver)) {
            expect(spy.mock.calls.length, name).toBe('onStart' === name ? 1 : 0);
        }
    });

    it('shouldCloseNameResolver', () => {
        const resource1 = mockRawLog();
        const resource2 = mockRawLog();
        const resource3 = mockRawLog();
        executor.onFreeLogBuffer(asRawLog(resource1));
        executor.onFreeLogBuffer(asRawLog(resource2));
        executor.onFreeLogBuffer(asRawLog(resource3));

        // Java verifies only the interactions after those of the direct removals: each free() was called once by then
        const inOrder = new InOrder(
            { free1: resource1.free, free2: resource2.free, free3: resource3.free },
            nameResolver,
        );
        inOrder.verify(resource1.free, 1);
        inOrder.verify(resource2.free, 1);
        inOrder.verify(resource3.free, 1);

        executor.onClose();

        inOrder.verify(nameResolver.onClose, 1);
        inOrder.verify(resource1.free, 1);
        inOrder.verify(resource2.free, 1);
        inOrder.verify(resource3.free, 1);
        inOrder.verifyNoMoreInteractions();
    });

    it('shouldIncrementFreeFailsCounterIfDirectRemovalFails', () => {
        const rawLog = mockRawLog();
        executor.onFreeLogBuffer(asRawLog(rawLog));

        const inOrder = new InOrder({ free: rawLog.free }, freeFailsCounter, nameResolver);
        inOrder.verify(rawLog.free, 1);
        inOrder.verify(vi.mocked(freeFailsCounter.isClosed), 1);
        inOrder.verify(vi.mocked(freeFailsCounter.incrementRelease), 1);
        inOrder.verifyNoMoreInteractions();
    });

    it('shouldSkipIncrementFreeFailsCounterIfClosedDirectRemoval', () => {
        vi.mocked(freeFailsCounter.isClosed).mockReturnValue(true);

        const rawLog = mockRawLog();
        executor.onFreeLogBuffer(asRawLog(rawLog));

        const inOrder = new InOrder({ free: rawLog.free }, freeFailsCounter, nameResolver);
        inOrder.verify(rawLog.free, 1);
        inOrder.verify(vi.mocked(freeFailsCounter.isClosed), 1);
        inOrder.verifyNoMoreInteractions();
    });

    it('shouldRetryDeleteInDoWork', () => {
        const rawLog = mockRawLog();
        rawLog.free.mockReturnValueOnce(false).mockReturnValue(true);
        executor.onFreeLogBuffer(asRawLog(rawLog));

        executor.doWork();

        const inOrder = new InOrder({ free: rawLog.free }, freeFailsCounter, nameResolver);
        inOrder.verify(rawLog.free, 1);
        inOrder.verify(vi.mocked(freeFailsCounter.isClosed), 1);
        inOrder.verify(vi.mocked(freeFailsCounter.incrementRelease), 1);
        inOrder.verify(rawLog.free, 1);
        inOrder.verifyNoMoreInteractions();
    });

    it('roleName', () => {
        expect(executor.roleName()).toBe('aeron-md-nra');
    });
});
