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
// Port of org/agrona/concurrent/NoOpLock.java @ Agrona 2.6.1
import { UnsupportedOperationException, type TimeUnit } from '../jdk.js';

/**
 * The part of {@code java.util.concurrent.locks.Lock} that {@link NoOpLock} implements. {@code newCondition} is not
 * in it: there is no {@code Condition} to return.
 */
export interface Lock {
    lock(): void;
    lockInterruptibly(): void;
    tryLock(time?: number, unit?: TimeUnit): boolean;
    unlock(): void;
    newCondition(): never;
}

/**
 * A {@link Lock} implementation that is a no operation, i.e. it effectively does nothing.
 * <p>
 * Useful for effectively eliding a lock in a single threaded environment.
 */
export class NoOpLock implements Lock {
    /**
     * As there is no instance state then this object can be used to save on allocation.
     */
    public static readonly INSTANCE: NoOpLock = new NoOpLock();

    /**
     * Proceeds as if the lock has been acquired.
     */
    public lock(): void {}

    /**
     * Proceeds as if the lock has been acquired.
     */
    public lockInterruptibly(): void {}

    /**
     * Always succeeds. The Java overloads {@code tryLock()} and {@code tryLock(long, TimeUnit)} are this one method;
     * the time and the unit are ignored.
     *
     * @param time which is ignored.
     * @param unit which is ignored.
     * @return always true.
     */
    public tryLock(_time?: number, _unit?: TimeUnit): boolean {
        return true;
    }

    /**
     * The lock has never been taken so no effect.
     */
    public unlock(): void {}

    /**
     * Not supported.
     *
     * @return never returns.
     * @throws UnsupportedOperationException if used.
     */
    public newCondition(): never {
        throw new UnsupportedOperationException();
    }
}
