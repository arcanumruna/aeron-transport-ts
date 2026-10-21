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
// Port of org/agrona/concurrent/QueuedPipe.java @ Agrona 2.6.1
import type { Pipe } from './Pipe.js';

/**
 * A {@link Pipe} that is also a {@code java.util.Queue}. The members of {@code Queue} and {@code Collection} that
 * the queues implement are listed here; the ones that throw {@code UnsupportedOperationException} in Agrona
 * ({@code iterator}, {@code toArray}, {@code remove(Object)}, {@code removeAll}, {@code retainAll}) are not part of
 * the interface.
 *
 * @param <E> type of the elements in the queue.
 */
export interface QueuedPipe<E> extends Pipe<E> {
    /**
     * Insert the element if the queue has room.
     *
     * @return true if inserted, false if the queue is full.
     * @throws NullPointerException if the element is null.
     */
    offer(e: E): boolean;

    /**
     * Retrieve and remove the head, or null if the queue is empty.
     */
    poll(): E | null;

    /**
     * Retrieve the head without removing it, or null if the queue is empty.
     */
    peek(): E | null;

    /**
     * Insert the element.
     *
     * @throws IllegalStateException if the queue is full.
     */
    add(e: E): boolean;

    /**
     * Retrieve and remove the head.
     *
     * @throws NoSuchElementException if the queue is empty.
     */
    remove(): E;

    /**
     * Retrieve the head without removing it.
     *
     * @throws NoSuchElementException if the queue is empty.
     */
    element(): E;

    contains(o: E | null): boolean;

    containsAll(c: Iterable<E>): boolean;

    addAll(c: Iterable<E>): boolean;

    clear(): void;

    isEmpty(): boolean;

    /**
     * The number of elements in the queue.
     */
    size(): number;
}
