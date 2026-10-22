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
// Port of org/agrona/concurrent/ManyToOneConcurrentLinkedQueueTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import { ManyToOneConcurrentLinkedQueue } from '../../../src/agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';

describe('ManyToOneConcurrentLinkedQueueTest', () => {
    let queue: ManyToOneConcurrentLinkedQueue<number>;

    beforeEach(() => {
        queue = new ManyToOneConcurrentLinkedQueue<number>();
    });

    it('shouldBeEmpty', () => {
        expect(queue.size()).toBe(0);
        expect(queue.isEmpty()).toBe(true);
    });

    it('shouldNotBeEmpty', () => {
        expect(queue.offer(1)).toBe(true);
        expect(queue.isEmpty()).toBe(false);
        expect(queue.size()).toBe(1);
    });

    it('shouldFailToPoll', () => {
        expect(queue.poll()).toBeNull();
    });

    it('shouldOfferItem', () => {
        expect(queue.offer(7)).toBe(true);
        expect(queue.size()).toBe(1);
    });

    it('shouldExchangeItem', () => {
        const testItem = 1;

        expect(queue.offer(testItem)).toBe(true);
        expect(queue.poll()).toBe(testItem);
    });

    it('shouldExchangeInFifoOrder', () => {
        const numItems = 7;

        for (let i = 0; i < numItems; i++) {
            expect(queue.offer(i)).toBe(true);
        }

        expect(queue.size()).toBe(numItems);

        for (let i = 0; i < numItems; i++) {
            expect(queue.poll()).toBe(i);
        }

        expect(queue.size()).toBe(0);
        expect(queue.isEmpty()).toBe(true);
    });

    it('shouldExchangeInFifoOrderInterleaved', () => {
        const numItems = 7;

        for (let i = 0; i < numItems; i++) {
            expect(queue.offer(i)).toBe(true);
            expect(queue.poll()).toBe(i);
        }

        expect(queue.size()).toBe(0);
        expect(queue.isEmpty()).toBe(true);
    });

    it('shouldToString', () => {
        expect(queue.toString()).toBe('{}');

        for (let i = 0; i < 5; i++) {
            expect(queue.offer(i)).toBe(true);
        }

        expect(queue.toString()).toBe('{0, 1, 2, 3, 4}');
    });

    // Java runs 2 producer threads against the consumer for 1,000,000 items. The queue holds JS objects and is for
    // one thread (spec D3): the offers of the two producers are interleaved with the consumer's polls on this thread,
    // for the same 1,000,000 offers and polls, with a hard cap on the iterations.
    it('shouldTransferConcurrently', () => {
        const count = 1_000_000;
        const numThreads = 2;
        const items = count / numThreads;
        const produced = [0, 0];
        let polled = 0;
        const limit = 10 * count;

        for (let iterations = 0; polled < count; iterations++) {
            if (iterations >= limit) {
                expect.fail('iteration cap reached');
            }
            for (let t = 0; t < numThreads; t++) {
                if (produced[t]! < items) {
                    if (!queue.offer(produced[t]!++)) {
                        expect.fail('offer failed');
                    }
                }
            }

            while (null !== queue.poll()) {
                polled++;
            }
        }

        expect(polled).toBe(count);
        expect(queue.isEmpty()).toBe(true);
    });
});
