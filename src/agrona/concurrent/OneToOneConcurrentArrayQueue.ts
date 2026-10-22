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
// Port of org/agrona/concurrent/OneToOneConcurrentArrayQueue.java @ Agrona 2.6.1
import { NullPointerException } from '../jdk.js';
import { AbstractConcurrentArrayQueue } from './AbstractConcurrentArrayQueue.js';
import type { Collection } from './Pipe.js';

/**
 * Queue for exchanging elements between exactly two threads, one producer and one consumer. In this port there is one
 * thread (spec D3, 4.1), so it is the bounded FIFO that the {@code CommandProxy} queues are: the producer side
 * ({@code offer}) and the consumer side ({@code poll}, {@code drain}) are called from the agents' duty cycles in
 * Aeron's order, and the release stores of Java are plain stores. Nothing is allocated by an {@code offer}, a
 * {@code poll} or a {@code drain}.
 *
 * @param <E> type of the elements stored in the {@link Queue}.
 */
export class OneToOneConcurrentArrayQueue<E> extends AbstractConcurrentArrayQueue<E> {
    /**
     * Create a queue with a requested capacity, which is rounded up to the next power of two.
     *
     * @param requestedCapacity of the queue.
     */
    public constructor(requestedCapacity: number) {
        super(requestedCapacity);
    }

    public offer(e: E): boolean {
        if (null === e || undefined === e) {
            throw new NullPointerException('Null is not a valid element');
        }

        const capacity = this._capacity;
        let currentHead = this.headCache;
        let bufferLimit = currentHead + capacity;
        const currentTail = this.tail;

        if (currentTail >= bufferLimit) {
            currentHead = this.head;
            bufferLimit = currentHead + capacity;

            if (currentTail >= bufferLimit) {
                return false;
            }

            this.headCache = currentHead;
        }

        const elementOffset = AbstractConcurrentArrayQueue.sequenceToBufferOffset(currentTail, capacity - 1);

        this.buffer[elementOffset] = e;
        this.tail = currentTail + 1;

        return true;
    }

    public poll(): E | null {
        const buffer = this.buffer;
        const currentHead = this.head;
        const elementOffset = AbstractConcurrentArrayQueue.sequenceToBufferOffset(currentHead, this._capacity - 1);

        const e = buffer[elementOffset]!;

        if (null !== e) {
            buffer[elementOffset] = null;
            this.head = currentHead + 1;
        }

        return e;
    }

    /**
     * Drain the queue to a consumer, up to {@code limit} elements, or all that are in it if there is no limit.
     */
    public drain(elementConsumer: (element: E) => void, limit: number = this.tail - this.head): number {
        const buffer = this.buffer;
        const mask = this._capacity - 1;
        const currentHead = this.head;

        let nextSequence = currentHead;
        const limitSequence = nextSequence + limit;

        while (nextSequence < limitSequence) {
            const elementOffset = AbstractConcurrentArrayQueue.sequenceToBufferOffset(nextSequence, mask);

            const item = buffer[elementOffset]!;

            if (null === item) {
                break;
            }

            buffer[elementOffset] = null;
            nextSequence++;
            this.head = nextSequence;
            elementConsumer(item);
        }

        return nextSequence - currentHead;
    }

    public drainTo(target: Collection<E>, limit: number): number {
        const buffer = this.buffer;
        const mask = this._capacity - 1;
        let nextSequence = this.head;
        let count = 0;

        while (count < limit) {
            const elementOffset = AbstractConcurrentArrayQueue.sequenceToBufferOffset(nextSequence, mask);

            const item = buffer[elementOffset]!;

            if (null === item) {
                break;
            }

            buffer[elementOffset] = null;
            nextSequence++;
            this.head = nextSequence;
            count++;
            target.add(item);
        }

        return count;
    }
}
