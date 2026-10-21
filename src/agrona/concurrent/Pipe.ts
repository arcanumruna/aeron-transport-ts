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
// Port of org/agrona/concurrent/Pipe.java @ Agrona 2.6.1
/**
 * Stand-in for the part of {@code java.util.Collection} that {@link Pipe.drainTo} uses.
 */
export interface Collection<E> {
    add(element: E): boolean;
}

/**
 * Pipe interface for a pipe that has a capacity and can be drained.
 *
 * @param <E> type of the elements in the pipe.
 */
export interface Pipe<E> {
    /**
     * The number of items added to this pipe since creation.
     *
     * @return the number of items added.
     */
    addedCount(): number;

    /**
     * The number of items removed from this pipe since creation.
     *
     * @return the number of items removed.
     */
    removedCount(): number;

    /**
     * The maximum capacity of the collection.
     *
     * @return the maximum capacity of the collection.
     */
    capacity(): number;

    /**
     * Get the remaining capacity for elements in the pipe.
     * <p>
     * This is a best effort snapshot, in a concurrent environment, but is exact when quiescent.
     *
     * @return remaining capacity of the pipe.
     */
    remainingCapacity(): number;

    /**
     * Invoke a {@link Consumer} callback on each element to drain the collection of elements until it is empty.
     * <p>
     * If possible, implementations should use smart batching to best handle burst traffic.
     *
     * @param elementConsumer to which elements are passed.
     * @return the number of elements drained.
     */
    drain(elementConsumer: (element: E) => void): number;

    /**
     * Invoke a {@link Consumer} callback on at most the {@code limit} number of elements.
     * <p>
     * If possible, implementations should use smart batching to best handle burst traffic.
     *
     * @param elementConsumer to which elements are passed.
     * @param limit           the limit for the number of elements which will be consumed.
     * @return the number of elements drained.
     */
    drain(elementConsumer: (element: E) => void, limit: number): number;

    /**
     * Drain the pipe to a target {@link Collection} up to a maximum number of elements.
     *
     * @param target to drain the pipe into.
     * @param limit  the maximum number of elements to drain.
     * @return the number of elements actually drained.
     */
    drainTo(target: Collection<E>, limit: number): number;
}
