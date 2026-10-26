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
// Port of org/agrona/concurrent/broadcast/BroadcastTransmitter.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { DirectBuffer } from '../../DirectBuffer.js';
import { IllegalArgumentException, VarHandle } from '../../jdk.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { BroadcastBufferDescriptor } from './BroadcastBufferDescriptor.js';
import { RecordDescriptor } from './RecordDescriptor.js';

const { LATEST_COUNTER_OFFSET, TAIL_COUNTER_OFFSET, TAIL_INTENT_COUNTER_OFFSET, TRAILER_LENGTH, checkCapacity } =
    BroadcastBufferDescriptor;
const {
    HEADER_LENGTH,
    PADDING_MSG_TYPE_ID,
    RECORD_ALIGNMENT,
    calculateMaxMessageLength,
    checkTypeId,
    lengthOffset,
    msgOffset,
    typeOffset,
} = RecordDescriptor;

/**
 * Transmit messages to an underlying broadcast buffer for receipt by {@link BroadcastReceiver}s.
 * <p>
 * The tail intent, tail and latest counters are straight Java 64-bit positions (a JS `number`, D5), stored in the
 * trailer by the `long` accessors Java calls.
 */
export class BroadcastTransmitter {
    private readonly buffer: AtomicBuffer;
    private readonly _capacity: number;
    private readonly _maxMsgLength: number;
    private readonly tailIntentCountIndex: number;
    private readonly tailCounterIndex: number;
    private readonly latestCounterIndex: number;

    /**
     * Construct a new broadcast transmitter based on an underlying {@link AtomicBuffer}.
     * The underlying buffer must a power of 2 in size plus sufficient space
     * for the {@link BroadcastBufferDescriptor.TRAILER_LENGTH}.
     *
     * @param buffer via which messages will be exchanged.
     * @throws IllegalStateException if the buffer capacity is not a power of 2
     * plus {@link BroadcastBufferDescriptor.TRAILER_LENGTH} in capacity.
     */
    public constructor(buffer: AtomicBuffer) {
        this.buffer = buffer;
        this._capacity = buffer.capacity() - TRAILER_LENGTH;

        checkCapacity(this._capacity);
        buffer.verifyAlignment();

        this._maxMsgLength = calculateMaxMessageLength(this._capacity);
        this.tailIntentCountIndex = this._capacity + TAIL_INTENT_COUNTER_OFFSET;
        this.tailCounterIndex = this._capacity + TAIL_COUNTER_OFFSET;
        this.latestCounterIndex = this._capacity + LATEST_COUNTER_OFFSET;
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
     * Get the maximum message length that can be transmitted for a buffer.
     *
     * @return the maximum message length that can be transmitted for a buffer.
     */
    public maxMsgLength(): number {
        return this._maxMsgLength;
    }

    /**
     * Transmit a message to {@link BroadcastReceiver}s via the broadcast buffer.
     *
     * @param msgTypeId type of the message to be transmitted.
     * @param srcBuffer containing the encoded message to be transmitted.
     * @param srcIndex  srcIndex in the source buffer at which the encoded message begins.
     * @param length    in bytes of the encoded message.
     * @throws IllegalArgumentException of the msgTypeId is not valid,
     * or if the message length is greater than {@link maxMsgLength}.
     */
    public transmit(msgTypeId: number, srcBuffer: DirectBuffer, srcIndex: number, length: number): void {
        checkTypeId(msgTypeId);
        this.checkMessageLength(length);

        const buffer = this.buffer;
        const capacity = this._capacity;
        let currentTail = buffer.getLong(this.tailCounterIndex);
        // (int)currentTail & (capacity - 1): ToInt32 of the position is its low 32 bits, as the Java cast
        let recordOffset = currentTail & (capacity - 1);
        const recordLength = HEADER_LENGTH + length;
        const recordLengthAligned = BitUtil.align(recordLength, RECORD_ALIGNMENT);
        const newTail = currentTail + recordLengthAligned;

        const toEndOfBuffer = capacity - recordOffset;
        if (toEndOfBuffer < recordLengthAligned) {
            this.signalTailIntent(buffer, newTail + toEndOfBuffer);
            BroadcastTransmitter.insertPaddingRecord(buffer, recordOffset, toEndOfBuffer);

            currentTail += toEndOfBuffer;
            recordOffset = 0;
        } else {
            this.signalTailIntent(buffer, newTail);
        }

        buffer.putInt(lengthOffset(recordOffset), recordLength);
        buffer.putInt(typeOffset(recordOffset), msgTypeId);

        buffer.putBytes(msgOffset(recordOffset), srcBuffer, srcIndex, length);

        buffer.putLongRelease(this.latestCounterIndex, currentTail);
        buffer.putLongRelease(this.tailCounterIndex, currentTail + recordLengthAligned);
    }

    private signalTailIntent(buffer: AtomicBuffer, newTail: number): void {
        buffer.putLongRelease(this.tailIntentCountIndex, newTail);
        VarHandle.releaseFence();
    }

    private static insertPaddingRecord(buffer: AtomicBuffer, recordOffset: number, length: number): void {
        buffer.putInt(lengthOffset(recordOffset), length);
        buffer.putInt(typeOffset(recordOffset), PADDING_MSG_TYPE_ID);
    }

    private checkMessageLength(length: number): void {
        if (length > this._maxMsgLength) {
            throw new IllegalArgumentException(
                'encoded message exceeds maxMsgLength of ' + this._maxMsgLength + ', length=' + length,
            );
        }
    }
}
