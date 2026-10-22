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
// Port of org/agrona/concurrent/ManyToOneConcurrentLinkedQueue.java @ Agrona 2.6.1
import { NullPointerException, UnsupportedOperationException } from '../jdk.js';
import { NoSuchElementException } from '../jdkUtil.js';

/**
 * A node of the linked list. Java's {@code volatile Node<E> next} and its {@code putReferenceRelease} are a plain
 * field here: the queue is used from one thread.
 */
class Node<E> {
    public value: E | null;
    public next: Node<E> | null = null;

    public constructor(value: E | null) {
        this.value = value;
    }

    public nextOrdered(next: Node<E> | null): void {
        this.next = next;
    }
}

/**
 * Concurrent linked {@code Queue} that can be used from many producers and a single consumer.
 * <p>
 * This is a Java port of Dmitry Vyukov's
 * <a href="http://www.1024cores.net/home/lock-free-algorithms/queues/non-intrusive-mpsc-node-based-queue">
 * MPSC linked queue</a>.
 * <p>
 * <b>Note regarding threads:</b> this port holds JS objects and is for one thread (the conductor's own commands,
 * spec D3): the algorithm, the order of its steps and the API are Java's, but {@code head}, {@code tail} and
 * {@code next} are plain fields, and the cache line padding classes and the {@code Unsafe} offsets are not ported.
 * Offers from other worker threads are not possible: a JS object cannot be shared.
 * <p>
 * <b>Note:</b> This queue breaks the contract for peek and poll in that it can return null when the queue has no item
 * available but size could be greater than zero if an offer is in progress. This is due to the offer being a multiple
 * step process which can start and be interrupted before completion, the thread will later be resumed and the offer
 * process completes. Other methods, such as peek and poll, could spin internally waiting on the offer to complete to
 * provide sequentially consistency across methods but this can have a detrimental effect in a resource starved system.
 * This internal spinning eats up a CPU core and prevents other threads making progress resulting in latency spikes. To
 * avoid this a more relaxed approach is taken in that an in-progress offer is not waited on to complete.
 * <p>
 * If you wish to check for empty then call {@link ManyToOneConcurrentLinkedQueue.isEmpty} rather than
 * {@link ManyToOneConcurrentLinkedQueue.size} checking for zero.
 *
 * @param <E> element type in the queue.
 */
export class ManyToOneConcurrentLinkedQueue<E> {
    private readonly empty: Node<E> = new Node<E>(null);

    private tail: Node<E>;
    private head: Node<E>;

    /**
     * Constructs an empty queue.
     */
    public constructor() {
        this.head = this.empty;
        this.tail = this.empty;
    }

    public add(e: E): boolean {
        return this.offer(e);
    }

    public offer(e: E): boolean {
        if (null === e || undefined === e) {
            throw new NullPointerException('element cannot be null');
        }

        const tail = new Node<E>(e);
        const previousTail = this.swapTail(tail);
        previousTail.nextOrdered(tail);

        return true;
    }

    /**
     * {@code remove()}: retrieve and remove the head. The Java overload {@code remove(Object)} is this method called
     * with an argument, and throws {@code UnsupportedOperationException}.
     *
     * @param o must be omitted.
     * @return the head.
     * @throws NoSuchElementException if the queue is empty.
     */
    public remove(o?: unknown): E {
        if (undefined !== o) {
            throw new UnsupportedOperationException();
        }

        const e = this.poll();
        if (null === e) {
            throw new NoSuchElementException('Queue is empty');
        }

        return e;
    }

    public poll(): E | null {
        let value: E | null = null;
        const head = this.head;
        let next = head.next;

        if (null !== next) {
            value = next.value;
            next.value = null;
            head.nextOrdered(null);

            if (null === next.next) {
                const tail = this.tail;
                if (tail === next && this.casTail(tail, this.empty)) {
                    next = this.empty;
                }
            }

            this.head = next;
        }

        return value;
    }

    public element(): E {
        const e = this.peek();
        if (null === e) {
            throw new NoSuchElementException('Queue is empty');
        }

        return e;
    }

    public peek(): E | null {
        const next = this.head.next;
        return null !== next ? next.value : null;
    }

    /**
     * Size can be considered an approximation on a moving list.
     * It is only really stable when the consumer is inactive.
     * If you want to check for {@code queue.size() == 0} then {@link ManyToOneConcurrentLinkedQueue.isEmpty} is a
     * better alternative.
     * <p>
     * This operation is O(n) on the length of the linked chain.
     *
     * @return an approximation for the size of the list.
     */
    public size(): number {
        let head = this.head;
        const tail = this.tail;
        let size = 0;

        while (tail !== head && size < 2147483647) {
            const next = head.next;
            if (null === next) {
                break;
            }

            head = next;
            ++size;
        }

        return size;
    }

    public isEmpty(): boolean {
        return this.head === this.tail;
    }

    public contains(_o: unknown): boolean {
        throw new UnsupportedOperationException();
    }

    public iterator(): never {
        throw new UnsupportedOperationException();
    }

    public toArray(_a?: unknown[]): never {
        throw new UnsupportedOperationException();
    }

    public containsAll(_c: Iterable<unknown>): boolean {
        throw new UnsupportedOperationException();
    }

    public addAll(_c: Iterable<E>): boolean {
        throw new UnsupportedOperationException();
    }

    public removeAll(_c: Iterable<unknown>): boolean {
        throw new UnsupportedOperationException();
    }

    public retainAll(_c: Iterable<unknown>): boolean {
        throw new UnsupportedOperationException();
    }

    public clear(): void {
        throw new UnsupportedOperationException();
    }

    public toString(): string {
        let sb = '{';

        let head = this.head;
        const tail = this.tail;

        while (head !== tail) {
            const next = head.next;
            if (null === next) {
                break;
            }

            head = next;

            sb += String(head.value);
            sb += ', ';
        }

        if (sb.length > 1) {
            sb = sb.substring(0, sb.length - 2);
        }

        return sb + '}';
    }

    private swapTail(newTail: Node<E>): Node<E> {
        const previous = this.tail;
        this.tail = newTail;
        return previous;
    }

    private casTail(expectedNode: Node<E>, updateNode: Node<E>): boolean {
        if (this.tail === expectedNode) {
            this.tail = updateNode;
            return true;
        }

        return false;
    }
}
