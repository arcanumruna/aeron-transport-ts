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
// Port of io/aeron/CounterProvider.java @ 1.53.3
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';

/**
 * Functional interface that abstracts creation of the counters.
 * <p>
 * Java's `@FunctionalInterface` is an interface with the method `newCounter` here, as `FragmentHandler` is one with
 * `onFragment`: a lambda is an object literal `{ newCounter: ... }`.
 */
export interface CounterProvider {
    /**
     * Allocate a counter record and wrap it with a new {@link AtomicCounter} for use.
     * <p>
     * If the keyBuffer is null then a copy of the key is not attempted.
     *
     * @param typeId      for the counter.
     * @param keyBuffer   containing the optional key for the counter.
     * @param keyOffset   within the keyBuffer at which the key begins.
     * @param keyLength   of the key in the keyBuffer.
     * @param labelBuffer containing the mandatory label for the counter.
     * @param labelOffset within the labelBuffer at which the label begins.
     * @param labelLength of the label in the labelBuffer.
     * @return the counter object.
     */
    newCounter(
        typeId: number,
        keyBuffer: DirectBuffer | null,
        keyOffset: number,
        keyLength: number,
        labelBuffer: DirectBuffer,
        labelOffset: number,
        labelLength: number,
    ): AtomicCounter;
}
