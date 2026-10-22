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
// Port of org/agrona/concurrent/ringbuffer/OneToOneRingBuffer.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { DirectBuffer } from '../../DirectBuffer.js';
import { IllegalArgumentException, IllegalStateException } from '../../jdk.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { Action } from '../ControlledMessageHandler.js';
import type { ControlledMessageHandler } from '../ControlledMessageHandler.js';
import type { MessageHandler } from '../MessageHandler.js';
import { RecordDescriptor } from './RecordDescriptor.js';
import { RingBuffer } from './RingBuffer.js';
import { RingBufferDescriptor } from './RingBufferDescriptor.js';

const { align } = BitUtil;
const { ALIGNMENT, HEADER_LENGTH, checkTypeId, encodedMsgOffset, lengthOffset, typeOffset } = RecordDescriptor;
const {
    CONSUMER_HEARTBEAT_OFFSET,
    CORRELATION_COUNTER_OFFSET,
    HEAD_CACHE_POSITION_OFFSET,
    HEAD_POSITION_OFFSET,
    TAIL_POSITION_OFFSET,
    checkCapacity,
} = RingBufferDescriptor;
const { INSUFFICIENT_CAPACITY, PADDING_MSG_TYPE_ID } = RingBuffer;
const { ABORT, BREAK, COMMIT } = Action;

/** Java's `Integer.MAX_VALUE`, the default message count limit of a read. */
const MAX_INT = 0x7fffffff;

/**
 * A ring-buffer that supports the exchange of messages from a single producer to a single consumer.
 */
export class OneToOneRingBuffer implements RingBuffer {
    /**
     * Minimum capacity for the buffer.
     */
    public static readonly MIN_CAPACITY: number = HEADER_LENGTH * 2;

    /**
     * Record type is padding to prevent fragmentation in the buffer (inherited from the interface in Java).
     */
    public static readonly PADDING_MSG_TYPE_ID: number = PADDING_MSG_TYPE_ID;

    /**
     * Buffer has insufficient capacity to record a message (inherited from the interface in Java).
     */
    public static readonly INSUFFICIENT_CAPACITY: number = INSUFFICIENT_CAPACITY;

    private readonly _capacity: number;
    private readonly _maxMsgLength: number;
    private readonly tailPositionIndex: number;
    private readonly headCachePositionIndex: number;
    private readonly headPositionIndex: number;
    private readonly correlationIdCounterIndex: number;
    private readonly consumerHeartbeatIndex: number;
    private readonly _buffer: AtomicBuffer;

    /**
     * Construct a new {@link RingBuffer} based on an underlying {@link AtomicBuffer}.
     * The underlying buffer must a power of 2 in size plus sufficient space for the {@link RingBufferDescriptor}
     * trailer.
     *
     * @param buffer via which the events will be exchanged.
     * @throws IllegalStateException if the buffer capacity is not a power of 2 plus
     *                               {@link RingBufferDescriptor.TRAILER_LENGTH} in capacity.
     */
    public constructor(buffer: AtomicBuffer) {
        this._capacity = checkCapacity(buffer.capacity(), OneToOneRingBuffer.MIN_CAPACITY);

        buffer.verifyAlignment();

        this._buffer = buffer;
        this._maxMsgLength =
            OneToOneRingBuffer.MIN_CAPACITY === this._capacity ? 0 : Math.max(HEADER_LENGTH, this._capacity >> 3);
        this.tailPositionIndex = this._capacity + TAIL_POSITION_OFFSET;
        this.headCachePositionIndex = this._capacity + HEAD_CACHE_POSITION_OFFSET;
        this.headPositionIndex = this._capacity + HEAD_POSITION_OFFSET;
        this.correlationIdCounterIndex = this._capacity + CORRELATION_COUNTER_OFFSET;
        this.consumerHeartbeatIndex = this._capacity + CONSUMER_HEARTBEAT_OFFSET;
    }

    public capacity(): number {
        return this._capacity;
    }

    public write(msgTypeId: number, srcBuffer: DirectBuffer, offset: number, length: number): boolean {
        checkTypeId(msgTypeId);
        this.checkMsgLength(length);

        const buffer = this._buffer;
        const recordLength = length + HEADER_LENGTH;
        const recordIndex = this.claimCapacity(buffer, recordLength);

        if (INSUFFICIENT_CAPACITY === recordIndex) {
            return false;
        }

        // The length is a seq-cst store (Atomics) on a shared buffer, which is the release fence of Java's
        // `VarHandle.releaseFence()` that follows it: the payload stores cannot move before it.
        buffer.putIntRelease(lengthOffset(recordIndex), -recordLength);

        buffer.putBytes(encodedMsgOffset(recordIndex), srcBuffer, offset, length);
        buffer.putInt(typeOffset(recordIndex), msgTypeId);
        buffer.putIntRelease(lengthOffset(recordIndex), recordLength);

        return true;
    }

    public tryClaim(msgTypeId: number, length: number): number {
        checkTypeId(msgTypeId);
        this.checkMsgLength(length);

        const buffer = this._buffer;
        const recordLength = length + HEADER_LENGTH;
        const recordIndex = this.claimCapacity(buffer, recordLength);

        if (INSUFFICIENT_CAPACITY === recordIndex) {
            return recordIndex;
        }

        buffer.putIntRelease(lengthOffset(recordIndex), -recordLength);
        buffer.putInt(typeOffset(recordIndex), msgTypeId);

        return encodedMsgOffset(recordIndex);
    }

    public commit(index: number): void {
        const recordIndex = this.computeRecordIndex(index);
        const buffer = this._buffer;
        const recordLength = this.verifyClaimedSpaceNotReleased(buffer, recordIndex);

        buffer.putIntRelease(lengthOffset(recordIndex), -recordLength);
    }

    public abort(index: number): void {
        const recordIndex = this.computeRecordIndex(index);
        const buffer = this._buffer;
        const recordLength = this.verifyClaimedSpaceNotReleased(buffer, recordIndex);

        buffer.putInt(typeOffset(recordIndex), PADDING_MSG_TYPE_ID);
        buffer.putIntRelease(lengthOffset(recordIndex), -recordLength);
    }

    public read(handler: MessageHandler, messageCountLimit: number = MAX_INT): number {
        let messagesRead = 0;

        const buffer = this._buffer;
        const headPositionIndex = this.headPositionIndex;
        const head = buffer.getLong(headPositionIndex);

        let bytesRead = 0;

        const capacity = this._capacity;
        const headIndex = head & (capacity - 1);
        const contiguousBlockLength = capacity - headIndex;

        try {
            while (bytesRead < contiguousBlockLength && messagesRead < messageCountLimit) {
                const recordIndex = headIndex + bytesRead;
                const recordLength = buffer.getIntVolatile(lengthOffset(recordIndex));
                if (recordLength <= 0) {
                    break;
                }

                bytesRead += align(recordLength, ALIGNMENT);

                const messageTypeId = buffer.getInt(typeOffset(recordIndex));
                if (PADDING_MSG_TYPE_ID === messageTypeId) {
                    continue;
                }

                handler.onMessage(messageTypeId, buffer, recordIndex + HEADER_LENGTH, recordLength - HEADER_LENGTH);
                ++messagesRead;
            }
        } finally {
            if (bytesRead > 0) {
                buffer.putLongRelease(headPositionIndex, head + bytesRead);
            }
        }

        return messagesRead;
    }

    public controlledRead(handler: ControlledMessageHandler, messageCountLimit: number = MAX_INT): number {
        let messagesRead = 0;

        const buffer = this._buffer;
        const headPositionIndex = this.headPositionIndex;
        let head = buffer.getLong(headPositionIndex);

        let bytesRead = 0;

        const capacity = this._capacity;
        let headIndex = head & (capacity - 1);
        const contiguousBlockLength = capacity - headIndex;

        try {
            while (bytesRead < contiguousBlockLength && messagesRead < messageCountLimit) {
                const recordIndex = headIndex + bytesRead;
                const recordLength = buffer.getIntVolatile(lengthOffset(recordIndex));
                if (recordLength <= 0) {
                    break;
                }

                const alignedLength = align(recordLength, ALIGNMENT);
                bytesRead += alignedLength;

                const messageTypeId = buffer.getInt(typeOffset(recordIndex));
                if (PADDING_MSG_TYPE_ID === messageTypeId) {
                    continue;
                }

                const action = handler.onMessage(
                    messageTypeId,
                    buffer,
                    recordIndex + HEADER_LENGTH,
                    recordLength - HEADER_LENGTH,
                );

                if (ABORT === action) {
                    bytesRead -= alignedLength;
                    break;
                }

                ++messagesRead;

                if (BREAK === action) {
                    break;
                }
                if (COMMIT === action) {
                    buffer.putLongRelease(headPositionIndex, head + bytesRead);
                    headIndex += bytesRead;
                    head += bytesRead;
                    bytesRead = 0;
                }
            }
        } finally {
            if (bytesRead > 0) {
                buffer.putLongRelease(headPositionIndex, head + bytesRead);
            }
        }

        return messagesRead;
    }

    public maxMsgLength(): number {
        return this._maxMsgLength;
    }

    public nextCorrelationId(): number {
        return this._buffer.getAndAddLong(this.correlationIdCounterIndex, 1);
    }

    public buffer(): AtomicBuffer {
        return this._buffer;
    }

    public consumerHeartbeatTime(time: number): void;
    public consumerHeartbeatTime(): number;
    public consumerHeartbeatTime(time?: number): number | void {
        if (undefined === time) {
            return this._buffer.getLongVolatile(this.consumerHeartbeatIndex);
        }

        this._buffer.putLongRelease(this.consumerHeartbeatIndex, time);
    }

    public producerPosition(): number {
        return this._buffer.getLongVolatile(this.tailPositionIndex);
    }

    public consumerPosition(): number {
        return this._buffer.getLongVolatile(this.headPositionIndex);
    }

    public size(): number {
        const buffer = this._buffer;
        const headPositionIndex = this.headPositionIndex;
        const tailPositionIndex = this.tailPositionIndex;
        let headBefore: number;
        let tail: number;
        let headAfter = buffer.getLongVolatile(headPositionIndex);

        do {
            headBefore = headAfter;
            tail = buffer.getLongVolatile(tailPositionIndex);
            headAfter = buffer.getLongVolatile(headPositionIndex);
        } while (headAfter !== headBefore);

        const size = tail - headAfter;
        if (size < 0) {
            return 0;
        } else if (size > this._capacity) {
            return this._capacity;
        }

        return size;
    }

    public unblock(): boolean {
        return false;
    }

    private checkMsgLength(length: number): void {
        if (length < 0) {
            throw new IllegalArgumentException('invalid message length=' + length);
        } else if (length > this._maxMsgLength) {
            throw new IllegalArgumentException(
                'encoded message exceeds maxMsgLength=' + this._maxMsgLength + ', length=' + length,
            );
        }
    }

    private claimCapacity(buffer: AtomicBuffer, recordLength: number): number {
        const alignedRecordLength = align(recordLength, ALIGNMENT);
        const requiredCapacity = alignedRecordLength + HEADER_LENGTH;
        const capacity = this._capacity;
        const tailPositionIndex = this.tailPositionIndex;
        const headCachePositionIndex = this.headCachePositionIndex;
        const mask = capacity - 1;

        let head = buffer.getLong(headCachePositionIndex);
        const tail = buffer.getLong(tailPositionIndex);
        const availableCapacity = capacity - (tail - head);

        if (requiredCapacity > availableCapacity) {
            head = buffer.getLongVolatile(this.headPositionIndex);

            if (requiredCapacity > capacity - (tail - head)) {
                return INSUFFICIENT_CAPACITY;
            }

            buffer.putLong(headCachePositionIndex, head);
        }

        let padding = 0;
        const recordIndex = tail & mask;
        const toBufferEndLength = capacity - recordIndex;
        let writeIndex = recordIndex;
        let nextTail = tail + alignedRecordLength;

        if (alignedRecordLength === toBufferEndLength) {
            // message fits within the end of the buffer
            buffer.putLongRelease(tailPositionIndex, nextTail);
            buffer.putLong(0, 0); // pre-zero next message header
            return recordIndex;
        } else if (requiredCapacity > toBufferEndLength) {
            writeIndex = 0;
            let headIndex = head & mask;

            if (requiredCapacity > headIndex) {
                head = buffer.getLongVolatile(this.headPositionIndex);
                headIndex = head & mask;
                if (requiredCapacity > headIndex) {
                    writeIndex = INSUFFICIENT_CAPACITY;
                    nextTail = tail;
                }

                buffer.putLong(headCachePositionIndex, head);
            }

            padding = toBufferEndLength;
            nextTail = nextTail + padding;
        }

        buffer.putLongRelease(tailPositionIndex, nextTail);

        if (0 !== padding) {
            buffer.putLong(0, 0);
            buffer.putIntRelease(lengthOffset(recordIndex), -padding);

            buffer.putInt(typeOffset(recordIndex), PADDING_MSG_TYPE_ID);
            buffer.putIntRelease(lengthOffset(recordIndex), padding);
        }

        if (INSUFFICIENT_CAPACITY !== writeIndex) {
            buffer.putLong(writeIndex + alignedRecordLength, 0); // pre-zero next message header
        }

        return writeIndex;
    }

    private computeRecordIndex(index: number): number {
        const recordIndex = index - HEADER_LENGTH;
        if (recordIndex < 0 || recordIndex > this._capacity - HEADER_LENGTH) {
            throw new IllegalArgumentException('invalid message index ' + index);
        }

        return recordIndex;
    }

    private verifyClaimedSpaceNotReleased(buffer: AtomicBuffer, recordIndex: number): number {
        const recordLength = buffer.getInt(lengthOffset(recordIndex));
        if (recordLength < 0) {
            return recordLength;
        }

        throw new IllegalStateException(
            'claimed space previously ' +
                (PADDING_MSG_TYPE_ID === buffer.getInt(typeOffset(recordIndex)) ? 'aborted' : 'committed'),
        );
    }
}
