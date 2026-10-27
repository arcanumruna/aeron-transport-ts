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
// Port of org/agrona/concurrent/AbstractConcurrentArrayQueue.java @ Agrona 2.6.1
import { BitUtil } from '../BitUtil.js';
import { IllegalStateException, UnsupportedOperationException } from '../jdk.js';
import { NoSuchElementException } from '../jdkUtil.js';
import type { Collection } from './Pipe.js';
import type { QueuedPipe } from './QueuedPipe.js';

/**
 * Pad out a cacheline to the left of a tail to prevent false sharing, in Java. A JS object has no layout to control
 * and there is one thread (spec D3), so the padding, the {@code volatile} fields and the {@code Unsafe} offsets are
 * not ported: {@code head}, {@code tail} and {@code headCache} are plain fields. {@code sharedHeadCache} is used only
 * by the many-producer queues, which are not ported.
 * <p>
 * Abstract base of the bounded array queues of Agrona: a power-of-two ring of elements with a {@code head} and a
 * {@code tail} sequence that only grow. An empty slot is {@code null}.
 *
 * @param <E> type of the elements in the queue.
 */
export abstract class AbstractConcurrentArrayQueue<E> implements QueuedPipe<E> {
    protected tail = 0;
    protected headCache = 0;
    protected head = 0;

    protected readonly _capacity: number = 0;
    protected readonly buffer: (E | null)[];

    /**
     * Create a queue with a requested capacity, which is rounded up to the next power of two.
     *
     * @param requestedCapacity of the queue.
     */
    public constructor(requestedCapacity: number) {
        this._capacity = BitUtil.findNextPositivePowerOfTwo(requestedCapacity);
        this.buffer = new Array<E | null>(this._capacity).fill(null);
    }

    public addedCount(): number {
        return this.tail;
    }

    public removedCount(): number {
        return this.head;
    }

    public capacity(): number {
        return this._capacity;
    }

    public remainingCapacity(): number {
        return this._capacity - this.size();
    }

    public abstract offer(e: E): boolean;

    public abstract poll(): E | null;

    public abstract drain(elementConsumer: (element: E) => void, limit?: number): number;

    public abstract drainTo(target: Collection<E>, limit: number): number;

    public peek(): E | null {
        return this.buffer[AbstractConcurrentArrayQueue.sequenceToBufferOffset(this.head, this._capacity - 1)]!;
    }

    public add(e: E): boolean {
        if (this.offer(e)) {
            return true;
        }

        throw new IllegalStateException('Queue is full');
    }

    public remove(): E {
        const e = this.poll();
        if (null === e) {
            throw new NoSuchElementException('Queue is empty');
        }

        return e;
    }

    public element(): E {
        const e = this.peek();
        if (null === e) {
            throw new NoSuchElementException('Queue is empty');
        }

        return e;
    }

    /**
     * {@inheritDoc}. Compares with {@code Object.equals} when the element has an {@code equals} method, otherwise by
     * {@code ===}.
     */
    public contains(o: E | null): boolean {
        if (null === o || undefined === o) {
            return false;
        }

        const buffer = this.buffer;
        const mask = this._capacity - 1;

        for (let i = this.head, limit = this.tail; i < limit; i++) {
            const e = buffer[AbstractConcurrentArrayQueue.sequenceToBufferOffset(i, mask)]!;
            if (AbstractConcurrentArrayQueue.equals(o, e)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Not supported.
     */
    public iterator(): never {
        throw new UnsupportedOperationException();
    }

    /**
     * Not supported.
     */
    public toArray(): never {
        throw new UnsupportedOperationException();
    }

    public containsAll(c: Iterable<E>): boolean {
        for (const o of c) {
            if (!this.contains(o)) {
                return false;
            }
        }

        return true;
    }

    public addAll(c: Iterable<E>): boolean {
        for (const e of c) {
            this.add(e);
        }

        return true;
    }

    public clear(): void {
        let value: E | null;
        do {
            value = this.poll();
        } while (null !== value);
    }

    public isEmpty(): boolean {
        return this.head >= this.tail;
    }

    public size(): number {
        // The head and tail are read until the head is stable, as concurrent threads may move them (Java). On one
        // thread the first pass is the only one.
        let currentHeadBefore: number;
        let currentTail: number;
        let currentHeadAfter = this.head;

        do {
            currentHeadBefore = currentHeadAfter;
            currentTail = this.tail;
            currentHeadAfter = this.head;
        } while (currentHeadAfter !== currentHeadBefore);

        const size = currentTail - currentHeadAfter;
        if (size < 0) {
            return 0;
        } else if (size > this._capacity) {
            return this._capacity;
        }

        return size;
    }

    /**
     * The index in the buffer of a sequence. Java computes the byte offset of the element in the {@code Object[]}
     * for {@code Unsafe}; here it is the array index.
     *
     * @param sequence of the element.
     * @param mask     of the capacity.
     * @return the index in the buffer.
     */
    public static sequenceToBufferOffset(sequence: number, mask: number): number {
        return sequence & mask;
    }

    private static equals(o: unknown, e: unknown): boolean {
        const equalsFunction = (o as { equals?: (other: unknown) => boolean }).equals;
        return 'function' === typeof equalsFunction ? equalsFunction.call(o, e) : o === e;
    }
}
