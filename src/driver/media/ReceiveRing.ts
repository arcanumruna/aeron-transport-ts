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
// Not in Aeron (spec 4.2, D1): the bounded ring that holds the datagrams Node's `'message'` events have delivered until
// the agent's next poll takes one.
import { BitUtil } from '../../agrona/BitUtil.js';
import type { InetSocketAddress } from '../jdkNet.js';

/**
 * A bounded FIFO of received datagrams: a fixed array of slots, each holding the `Buffer` that Node delivered (a
 * reference, never a copy: the handler owns it, N7), its length and its source address. It is bounded twice, by a slot
 * count and by a byte budget (the channel's `SO_RCVBUF`), so that the kernel buffer plus the ring is at most twice
 * `SO_RCVBUF`, never unbounded. A datagram that does not fit is refused and the caller counts a drop, which is the same
 * event as a kernel drop in Java.
 * <p>
 * One thread owns the ring (the event loop), so there is no atomic: the `'message'` handler offers and the duty cycle
 * polls, never at the same time (D3). Nothing here allocates after construction.
 */
export class ReceiveRing {
    /** The slots hold no datagram smaller than this many bytes, so the slot count follows from the byte budget. */
    public static readonly MIN_DATAGRAM_LENGTH = 64;
    public static readonly MIN_SLOTS = 64;
    public static readonly MAX_SLOTS = 16384;

    private readonly buffers: (Uint8Array | null)[];
    private readonly lengths: Int32Array;
    private readonly addresses: (InetSocketAddress | null)[];
    private readonly mask: number;
    private readonly byteBudget: number;
    private head = 0;
    private tail = 0;
    private bytes = 0;

    /**
     * @param byteBudget the most bytes the ring holds at once, the channel's `SO_RCVBUF`.
     * @param slots      the most datagrams the ring holds at once, rounded up to a power of two; when omitted
     *                   {@link slotsFor} the byte budget.
     */
    public constructor(byteBudget: number, slots: number = ReceiveRing.slotsFor(byteBudget)) {
        const capacity = BitUtil.findNextPositivePowerOfTwo(Math.max(1, slots));
        this.buffers = new Array<Uint8Array | null>(capacity).fill(null);
        this.addresses = new Array<InetSocketAddress | null>(capacity).fill(null);
        this.lengths = new Int32Array(capacity);
        this.mask = capacity - 1;
        this.byteBudget = byteBudget;
    }

    /** The slot count for a byte budget: one slot per 64 bytes, between {@link MIN_SLOTS} and {@link MAX_SLOTS}. */
    public static slotsFor(byteBudget: number): number {
        const wanted = Math.floor(byteBudget / ReceiveRing.MIN_DATAGRAM_LENGTH);
        return Math.min(ReceiveRing.MAX_SLOTS, Math.max(ReceiveRing.MIN_SLOTS, wanted));
    }

    /** The most datagrams the ring holds at once. */
    public capacity(): number {
        return this.mask + 1;
    }

    /** The most bytes the ring holds at once. */
    public byteCapacity(): number {
        return this.byteBudget;
    }

    /** The datagrams in the ring. */
    public size(): number {
        return this.tail - this.head;
    }

    /** The bytes of the datagrams in the ring. */
    public byteSize(): number {
        return this.bytes;
    }

    public isEmpty(): boolean {
        return this.head === this.tail;
    }

    /**
     * Adds a datagram at the tail.
     *
     * @return false, adding nothing, if the ring has no free slot or the datagram does not fit the byte budget.
     */
    public offer(buffer: Uint8Array, length: number, address: InetSocketAddress): boolean {
        if (this.tail - this.head > this.mask || this.bytes + length > this.byteBudget) {
            return false;
        }

        const index = this.tail & this.mask;
        this.buffers[index] = buffer;
        this.lengths[index] = length;
        this.addresses[index] = address;
        this.bytes += length;
        this.tail++;

        return true;
    }

    /** The datagram at the head. Only valid when the ring is not empty. */
    public headBuffer(): Uint8Array {
        return this.buffers[this.head & this.mask] as Uint8Array;
    }

    /** The length of the datagram at the head. Only valid when the ring is not empty. */
    public headLength(): number {
        return this.lengths[this.head & this.mask] as number;
    }

    /** The source address of the datagram at the head. Only valid when the ring is not empty. */
    public headAddress(): InetSocketAddress {
        return this.addresses[this.head & this.mask] as InetSocketAddress;
    }

    /** Removes the datagram at the head, and drops the references the slot held. Only valid when not empty. */
    public advance(): void {
        const index = this.head & this.mask;
        this.bytes -= this.lengths[index] as number;
        this.buffers[index] = null;
        this.addresses[index] = null;
        this.head++;
    }

    /** Removes every datagram. */
    public clear(): void {
        while (this.head !== this.tail) {
            this.advance();
        }
    }
}
