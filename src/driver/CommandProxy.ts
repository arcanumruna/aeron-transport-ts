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
// Port of io/aeron/driver/CommandProxy.java @ 1.53.3
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException } from '../agrona/jdk.js';

/**
 * A command for an agent: Java's `Runnable`.
 */
export type Runnable = () => void;

/**
 * Base of the proxies that offer commands to an agent through a one-to-one queue.
 * <p>
 * Java spins on a full queue (counting each failed attempt and yielding) until the consumer makes room. Here the
 * producer and the consumer run on the one event loop thread (spec D3, D11), so the consumer cannot run while the
 * producer spins: a full queue is counted once and is an error (spec D42).
 */
export abstract class CommandProxy {
    protected readonly commandQueue: OneToOneConcurrentArrayQueue<Runnable>;
    private readonly failCount: AtomicCounter;

    protected constructor(commandQueue: OneToOneConcurrentArrayQueue<Runnable>, failCount: AtomicCounter) {
        this.commandQueue = commandQueue;
        this.failCount = failCount;
    }

    protected offer(cmd: Runnable): void {
        if (!this.commandQueue.offer(cmd)) {
            if (!this.failCount.isClosed()) {
                this.failCount.increment();
            }

            throw new IllegalStateException('offer failed: the command queue is full');
        }
    }

    public isApplyingBackpressure(): boolean {
        return this.commandQueue.remainingCapacity() < 1;
    }
}
