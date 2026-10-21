// Not in Agrona's mapped tests (QueuedPipeTest, ArrayQueuePeekTest and ArrayQueueSizeTest also cover the many-producer
// queues, which are not ported): the bounded FIFO that stands in for the CommandProxy queues, on one thread.
import { describe, expect, it } from 'vitest';
import { AbstractConcurrentArrayQueue } from '../../../src/agrona/concurrent/AbstractConcurrentArrayQueue.js';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { IllegalStateException, NullPointerException, UnsupportedOperationException } from '../../../src/agrona/jdk.js';
import { NoSuchElementException } from '../../../src/agrona/jdkLang.js';
import { assertThrows } from '../../support/Assertions.js';

describe('OneToOneConcurrentArrayQueueExtra', () => {
    it('capacityIsRoundedUpToAPowerOfTwo', () => {
        expect(new OneToOneConcurrentArrayQueue<number>(1).capacity()).toBe(1);
        expect(new OneToOneConcurrentArrayQueue<number>(2).capacity()).toBe(2);
        expect(new OneToOneConcurrentArrayQueue<number>(3).capacity()).toBe(4);
        expect(new OneToOneConcurrentArrayQueue<number>(8).capacity()).toBe(8);
        expect(new OneToOneConcurrentArrayQueue<number>(9).capacity()).toBe(16);
    });

    it('emptyQueue', () => {
        const queue = new OneToOneConcurrentArrayQueue<string>(4);

        expect(queue.size()).toBe(0);
        expect(queue.isEmpty()).toBe(true);
        expect(queue.poll()).toBeNull();
        expect(queue.peek()).toBeNull();
        expect(queue.remainingCapacity()).toBe(4);
        expect(queue.addedCount()).toBe(0);
        expect(queue.removedCount()).toBe(0);
        assertThrows(NoSuchElementException, () => queue.remove());
        assertThrows(NoSuchElementException, () => queue.element());
        expect(queue.drain(() => expect.unreachable())).toBe(0);
        expect(queue.drainTo({ add: () => expect.unreachable() as never }, 10)).toBe(0);
    });

    it('nullIsNotAValidElement', () => {
        const queue = new OneToOneConcurrentArrayQueue<string | null>(4);

        assertThrows(NullPointerException, () => queue.offer(null));
        assertThrows(NullPointerException, () => queue.add(null));
        assertThrows(NullPointerException, () => queue.offer(undefined as unknown as string));
        expect(queue.size()).toBe(0);
    });

    it('offerFailsWhenFullAndAddThrows', () => {
        const queue = new OneToOneConcurrentArrayQueue<number>(4);
        for (let i = 0; i < 4; i++) {
            expect(queue.offer(i)).toBe(true);
        }

        expect(queue.offer(4)).toBe(false);
        assertThrows(IllegalStateException, () => queue.add(4));
        expect(queue.size()).toBe(4);
        expect(queue.remainingCapacity()).toBe(0);

        expect(queue.poll()).toBe(0);
        expect(queue.offer(4)).toBe(true);
        expect(queue.offer(5)).toBe(false);
    });

    it('peekElementAndRemoveLookAtTheHead', () => {
        const queue = new OneToOneConcurrentArrayQueue<string>(4);
        queue.offer('a');
        queue.offer('b');

        expect(queue.peek()).toBe('a');
        expect(queue.element()).toBe('a');
        expect(queue.size()).toBe(2);
        expect(queue.remove()).toBe('a');
        expect(queue.peek()).toBe('b');
        expect(queue.remove()).toBe('b');
        expect(queue.peek()).toBeNull();
    });

    it('containsUsesEqualsWhenTheElementHasOne', () => {
        const queue = new OneToOneConcurrentArrayQueue<{ equals(o: unknown): boolean } | string>(4);
        const key = { equals: (o: unknown) => o === key || (o as { id?: number }).id === 7 };
        queue.offer('x');
        queue.offer({ id: 7 } as never);

        expect(queue.contains('x')).toBe(true);
        expect(queue.contains('y')).toBe(false);
        expect(queue.contains(key)).toBe(true);
        expect(queue.contains(null)).toBe(false);
        expect(queue.containsAll(['x'])).toBe(true);
        expect(queue.containsAll(['x', 'y'])).toBe(false);
    });

    it('addAllClearAndTheUnsupportedMethods', () => {
        const queue = new OneToOneConcurrentArrayQueue<number>(8);

        expect(queue.addAll([1, 2, 3])).toBe(true);
        expect(queue.size()).toBe(3);
        queue.clear();
        expect(queue.isEmpty()).toBe(true);
        expect(queue.removedCount()).toBe(3);
        assertThrows(IllegalStateException, () => queue.addAll([1, 2, 3, 4, 5, 6, 7, 8, 9]));
        assertThrows(UnsupportedOperationException, () => queue.iterator());
        assertThrows(UnsupportedOperationException, () => queue.toArray());
    });

    it('drainTakesAtMostTheLimitAndAllByDefault', () => {
        const queue = new OneToOneConcurrentArrayQueue<number>(8);
        for (let i = 0; i < 6; i++) {
            queue.offer(i);
        }

        const seen: number[] = [];
        expect(queue.drain((e) => seen.push(e), 2)).toBe(2);
        expect(seen).toEqual([0, 1]);
        expect(queue.size()).toBe(4);
        expect(queue.drain((e) => seen.push(e), 0)).toBe(0);
        expect(queue.drain((e) => seen.push(e), 100)).toBe(4);
        expect(seen).toEqual([0, 1, 2, 3, 4, 5]);

        queue.offer(6);
        queue.offer(7);
        expect(queue.drain((e) => seen.push(e))).toBe(2);
        expect(seen.slice(6)).toEqual([6, 7]);
    });

    it('drainFixesTheLimitAtTheStartSoElementsOfferedByTheConsumerWaitForTheNextDrain', () => {
        const queue = new OneToOneConcurrentArrayQueue<number>(8);
        queue.offer(1);
        queue.offer(2);

        const seen: number[] = [];
        const drained = queue.drain((e) => {
            seen.push(e);
            if (e < 3) {
                queue.offer(e + 10);
            }
        });

        expect(drained).toBe(2);
        expect(seen).toEqual([1, 2]);
        expect(queue.size()).toBe(2);
    });

    it('drainToACollection', () => {
        const queue = new OneToOneConcurrentArrayQueue<number>(8);
        for (let i = 0; i < 5; i++) {
            queue.offer(i);
        }

        const target: number[] = [];
        const collection = { add: (e: number) => target.push(e) > 0 };
        expect(queue.drainTo(collection, 3)).toBe(3);
        expect(queue.drainTo(collection, 10)).toBe(2);
        expect(target).toEqual([0, 1, 2, 3, 4]);
        expect(queue.removedCount()).toBe(5);
    });

    it('sequenceToBufferOffsetMasksTheSequenceBeyondTwoToThe32', () => {
        expect(AbstractConcurrentArrayQueue.sequenceToBufferOffset(5, 3)).toBe(1);
        expect(AbstractConcurrentArrayQueue.sequenceToBufferOffset(2 ** 32 + 5, 7)).toBe(5);
        expect(AbstractConcurrentArrayQueue.sequenceToBufferOffset(2 ** 40 + 3, 7)).toBe(3);
        expect(AbstractConcurrentArrayQueue.sequenceToBufferOffset(2 ** 52 + 6, 7)).toBe(6);
    });

    it('theRingWrapsManyTimesAndMatchesAModelOverSeededRandomOperations', () => {
        // a seeded xorshift32, so the run is the same every time
        let seed = 0x2545f491;
        const next = (bound: number): number => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) % bound;
        };

        const queue = new OneToOneConcurrentArrayQueue<number>(8);
        const model: number[] = [];
        let counter = 0;
        let added = 0;
        let removed = 0;

        for (let i = 0; i < 20_000; i++) {
            switch (next(4)) {
                case 0:
                case 1: {
                    const accepted = queue.offer(counter);
                    expect(accepted).toBe(model.length < 8);
                    if (accepted) {
                        model.push(counter++);
                        added++;
                    }
                    break;
                }
                case 2: {
                    const polled = queue.poll();
                    expect(polled).toBe(model.length > 0 ? model.shift() : null);
                    if (null !== polled) {
                        removed++;
                    }
                    break;
                }
                default: {
                    const limit = next(10);
                    const seen: number[] = [];
                    const drained = queue.drain((e) => seen.push(e), limit);
                    expect(seen).toEqual(model.splice(0, Math.min(limit, model.length)));
                    expect(drained).toBe(seen.length);
                    removed += drained;
                }
            }

            expect(queue.size()).toBe(model.length);
            expect(queue.peek()).toBe(model.length > 0 ? model[0] : null);
            expect(queue.addedCount()).toBe(added);
            expect(queue.removedCount()).toBe(removed);
            expect(queue.remainingCapacity()).toBe(8 - model.length);
        }

        expect(added).toBeGreaterThan(1000);
    });
});
