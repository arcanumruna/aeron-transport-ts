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
// Port of org/agrona/concurrent/broadcast/BroadcastReceiver.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { VarHandle } from '../../jdk.js';
import type { MutableDirectBuffer } from '../../MutableDirectBuffer.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { BroadcastBufferDescriptor } from './BroadcastBufferDescriptor.js';
import { RecordDescriptor } from './RecordDescriptor.js';

const { align } = BitUtil;
const { LATEST_COUNTER_OFFSET, TAIL_COUNTER_OFFSET, TAIL_INTENT_COUNTER_OFFSET, TRAILER_LENGTH, checkCapacity } =
    BroadcastBufferDescriptor;
const { HEADER_LENGTH, PADDING_MSG_TYPE_ID, RECORD_ALIGNMENT, lengthOffset, msgOffset, typeOffset } = RecordDescriptor;

/**
 * Receive messages from a transmission stream of a broadcast buffer. The positions are straight Java 64-bit values (a
 * JS `number`, D5), read with the `long` accessors Java calls.
 * <p>
 * If the receiver is not consuming messages fast enough to keep up with the transmitter then loss can be
 * experienced; see {@link validate}.
 */
export class BroadcastReceiver {
    private cursor: number = 0;
    private nextRecord: number = 0;
    private recordOffset: number = 0;

    private readonly _capacity: number = 0;
    private readonly tailIntentCounterIndex: number = 0;
    private readonly tailCounterIndex: number = 0;

    private readonly latestCounterIndex: number = 0;
    private readonly _buffer: AtomicBuffer;

    // Java's AtomicLong, written with setOpaque and read with getOpaque so that another thread can monitor it. A JS
    // object is private to its thread, so there is no other thread: a plain field (see docs/mapping.md).
    private _lappedCount = 0;

    /**
     * Construct a new broadcast receiver based on an underlying {@link AtomicBuffer}.
     * The underlying buffer must a power of 2 in size plus sufficient space
     * for the {@link BroadcastBufferDescriptor.TRAILER_LENGTH}.
     *
     * @param buffer via which messages will be exchanged.
     * @throws IllegalStateException if the buffer capacity is not a power of 2
     * plus {@link BroadcastBufferDescriptor.TRAILER_LENGTH} in capacity.
     */
    public constructor(buffer: AtomicBuffer) {
        this._buffer = buffer;
        this._capacity = buffer.capacity() - TRAILER_LENGTH;

        checkCapacity(this._capacity);
        buffer.verifyAlignment();

        this.tailIntentCounterIndex = this._capacity + TAIL_INTENT_COUNTER_OFFSET;
        this.tailCounterIndex = this._capacity + TAIL_COUNTER_OFFSET;
        this.latestCounterIndex = this._capacity + LATEST_COUNTER_OFFSET;

        this.cursor = this.nextRecord = buffer.getLongVolatile(this.latestCounterIndex);
        this.recordOffset = this.cursor & (this._capacity - 1);
    }

    /**
     * Get the capacity of the underlying broadcast buffer.
     *
     * @return the capacity of the underlying broadcast buffer.
     */
    public capacity(): number {
        return this._capacity;
    }

    /**
     * Get the number of times the transmitter has lapped this receiver around the buffer. On each lap
     * as least a buffer's worth of loss will be experienced.
     *
     * @return the number of times the transmitter has lapped this receiver around the buffer.
     */
    public lappedCount(): number {
        return this._lappedCount;
    }

    /**
     * Type of the message received.
     *
     * @return typeId of the message received.
     */
    public typeId(): number {
        return this._buffer.getInt(typeOffset(this.recordOffset));
    }

    /**
     * The offset for the beginning of the next message in the transmission stream.
     *
     * @return offset for the beginning of the next message in the transmission stream.
     */
    public offset(): number {
        return msgOffset(this.recordOffset);
    }

    /**
     * The length of the next message in the transmission stream.
     *
     * @return length of the next message in the transmission stream.
     */
    public length(): number {
        return this._buffer.getInt(lengthOffset(this.recordOffset)) - HEADER_LENGTH;
    }

    /**
     * The underlying buffer containing the broadcast message stream.
     *
     * @return the underlying buffer containing the broadcast message stream.
     */
    public buffer(): MutableDirectBuffer {
        return this._buffer;
    }

    /**
     * Non-blocking receive of next message from the transmission stream.
     * <p>
     * If loss has occurred then {@link lappedCount} will be incremented.
     *
     * @return true if transmission is available with {@link offset}, {@link length} and {@link typeId}
     * set for the next message to be consumed. If no transmission is available then false.
     */
    public receiveNext(): boolean {
        let isAvailable = false;
        const buffer = this._buffer;
        const tail = buffer.getLongVolatile(this.tailCounterIndex);
        let cursor = this.nextRecord;

        if (tail > cursor) {
            const capacity = this._capacity;
            // (int)cursor & (capacity - 1): ToInt32 of the position is its low 32 bits, as the Java cast
            let recordOffset = cursor & (capacity - 1);

            if (!this.validate0(cursor, buffer, capacity)) {
                this._lappedCount = this._lappedCount + 1;

                cursor = buffer.getLongVolatile(this.latestCounterIndex);
                recordOffset = cursor & (capacity - 1);
            }

            this.cursor = cursor;
            this.nextRecord = cursor + align(buffer.getInt(lengthOffset(recordOffset)), RECORD_ALIGNMENT);

            if (PADDING_MSG_TYPE_ID === buffer.getInt(typeOffset(recordOffset))) {
                recordOffset = 0;
                this.cursor = this.nextRecord;
                this.nextRecord += align(buffer.getInt(lengthOffset(recordOffset)), RECORD_ALIGNMENT);
            }

            this.recordOffset = recordOffset;
            isAvailable = true;
        }

        return isAvailable;
    }

    /**
     * Validate that the current received record is still valid and has not been overwritten.
     * <p>
     * If the receiver is not consuming messages fast enough to keep up with the transmitter then loss
     * can be experienced resulting in messages being overwritten thus making them no longer valid.
     *
     * @return true if still valid otherwise false.
     */
    public validate(): boolean {
        VarHandle.acquireFence();

        return this.validate0(this.cursor, this._buffer, this._capacity);
    }

    // Java's private validate(long, AtomicBuffer, int) overload
    private validate0(cursor: number, buffer: AtomicBuffer, capacity: number): boolean {
        return cursor + capacity > buffer.getLongVolatile(this.tailIntentCounterIndex);
    }
}
