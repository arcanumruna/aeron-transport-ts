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
// Port of org/agrona/concurrent/ringbuffer/RingBuffer.java @ Agrona 2.6.1
import type { DirectBuffer } from '../../DirectBuffer.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import type { ControlledMessageHandler } from '../ControlledMessageHandler.js';
import type { MessageHandler } from '../MessageHandler.js';

/**
 * Ring-buffer for the concurrent exchanging of binary encoded messages from producer(s) to consumer(s)
 * in a FIFO manner.
 * <p>
 * Provides two non-blocking write methods: {@link RingBuffer.write} for copying a message
 * to the ring-buffer, and {@link RingBuffer.tryClaim} for zero-copy writes where the caller writes directly
 * to the ring-buffer memory. Messages are read by consumers using one of the {@code read} or
 * {@code controlledRead} methods.
 * <p>
 * Over a `SharedArrayBuffer` the ring buffers work across `worker_threads`.
 */
export interface RingBuffer {
    /**
     * Get the capacity of the ring-buffer in bytes for exchange.
     *
     * @return the capacity of the ring-buffer in bytes for exchange.
     */
    capacity(): number;

    /**
     * Non-blocking write of a message to an underlying ring-buffer.
     *
     * @param msgTypeId type of the message encoding.
     * @param srcBuffer containing the encoded binary message.
     * @param offset    at which the encoded message begins.
     * @param length    of the encoded message in bytes.
     * @return true if written to the ring-buffer, or false if insufficient space exists.
     * @throws IllegalArgumentException if the {@code length} is negative or is greater than {@link maxMsgLength}.
     */
    write(msgTypeId: number, srcBuffer: DirectBuffer, offset: number, length: number): boolean;

    /**
     * Try to claim a space in the underlying ring-buffer into which a message can be written with zero copy semantics.
     * Once the message has been written then {@link RingBuffer.commit} should be called thus making it available to be
     * consumed. Alternatively a claim can be aborted using {@link RingBuffer.abort} method.
     * <p>
     * Claiming a space in the ring-buffer means that the consumer will not be able to consume past the claim until
     * the claimed space is either committed or aborted. Producers will be able to write message even when outstanding
     * claims exist.
     *
     * @param msgTypeId type of the message encoding. Will be written into the header upon successful claim.
     * @param length    of the claim in bytes. A claim length cannot be greater than {@link maxMsgLength}.
     * @return a non-zero index into the underlying ring-buffer at which encoded message begins, otherwise returns
     * {@link RingBuffer.INSUFFICIENT_CAPACITY} indicating that there is not enough free space in the buffer.
     * @throws IllegalArgumentException if the {@code msgTypeId} is less than {@code 1}.
     * @throws IllegalArgumentException if the {@code length} is negative or is greater than {@link maxMsgLength}.
     */
    tryClaim(msgTypeId: number, length: number): number;

    /**
     * Commit message that was written in the previously claimed space thus making it available to the consumer.
     *
     * @param index at which the encoded message begins, i.e. value returned from the {@link tryClaim} call.
     * @throws IllegalArgumentException if the {@code index} is out of bounds.
     * @throws IllegalStateException    if this method is called after {@link abort} or was already invoked for
     *                                  the given {@code index}.
     */
    commit(index: number): void;

    /**
     * Abort claim and allow consumer to proceed after the claimed length. Aborting turns unused space into padding,
     * i.e. changes type of the message to {@link RingBuffer.PADDING_MSG_TYPE_ID}.
     *
     * @param index at which the encoded message begins, i.e. value returned from the {@link tryClaim} call.
     * @throws IllegalArgumentException if the {@code index} is out of bounds.
     * @throws IllegalStateException    if this method is called after {@link commit} or was already invoked for
     *                                  the given {@code index}.
     */
    abort(index: number): void;

    /**
     * Read as many messages as are available to the end of the ring buffer, up to a supplied maximum when
     * {@code messageCountLimit} is given (Java's two overloads).
     * <p>
     * If the ring buffer wraps or encounters a type of record, such a padding record, then an implementation
     * may choose to return and expect the caller to try again. The {@link size} method may be called to
     * determine of a backlog of message bytes remains in the ring buffer.
     *
     * @param handler           to be called for processing each message in turn.
     * @param messageCountLimit the number of messages will be read in a single invocation; defaults to
     *                          {@code Integer.MAX_VALUE}.
     * @return the number of messages that have been processed.
     */
    read(handler: MessageHandler, messageCountLimit?: number): number;

    /**
     * Read as many messages as are available to the end of the ring buffer with the handler able to control progress,
     * up to a limit when {@code messageCountLimit} is given (Java's two overloads).
     * <p>
     * If the ring buffer wraps or encounters a type of record, such a padding record, then an implementation
     * may choose to return and expect the caller to try again. The {@link size} method may be called to
     * determine of a backlog of message bytes remains in the ring buffer.
     *
     * @param handler           to be called for processing each message in turn which will return how to progress.
     * @param messageCountLimit the number of messages will be read in a single invocation; defaults to
     *                          {@code Integer.MAX_VALUE}.
     * @return the number of messages that have been processed.
     */
    controlledRead(handler: ControlledMessageHandler, messageCountLimit?: number): number;

    /**
     * The maximum message length in bytes supported by the underlying ring buffer.
     *
     * @return the maximum message length in bytes supported by the underlying ring buffer.
     */
    maxMsgLength(): number;

    /**
     * Get the next value that can be used for a correlation id on a message when a response needs to be correlated.
     * <p>
     * This method should be thread safe. It is `getAndAddLong` of the buffer, which on a `SharedArrayBuffer`
     * allocates a `bigint`: a control plane call, one per command.
     *
     * @return the next value in the correlation sequence.
     */
    nextCorrelationId(): number;

    /**
     * Get the underlying buffer used by the RingBuffer for storage.
     *
     * @return the underlying buffer used by the RingBuffer for storage.
     */
    buffer(): AtomicBuffer;

    /**
     * Set the time of the last consumer heartbeat.
     * <p>
     * <b>Note:</b> The value for time must be valid across processes which means {@code System.nanoTime()}
     * is not a valid option.
     *
     * @param time of the last consumer heartbeat.
     */
    consumerHeartbeatTime(time: number): void;

    /**
     * The time of the last consumer heartbeat.
     *
     * @return the time of the last consumer heartbeat.
     */
    consumerHeartbeatTime(): number;

    /**
     * The position in bytes from start up of the producers. The figure includes the headers.
     * This is the range they are working with but could still be in the act of working with.
     *
     * @return number of bytes produced by the producers in claimed space.
     */
    producerPosition(): number;

    /**
     * The position in bytes from start up for the consumers. The figure includes the headers.
     *
     * @return the count of bytes consumed by the consumers.
     */
    consumerPosition(): number;

    /**
     * Size of the buffer backlog in bytes between producers and consumers. The value includes the size of headers.
     * <p>
     * This method gives a concurrent snapshot of the buffer whereby a concurrent read or write may be
     * partially complete and thus the value should be taken as an indication.
     *
     * @return size of the backlog of bytes in the buffer between producers and consumers.
     */
    size(): number;

    /**
     * Unblock a multi-producer ring buffer when a producer has died during the act of offering. The operation will
     * scan from the consumer position up to the producer position.
     * <p>
     * If no action is required at the position then none will be taken.
     *
     * @return true of an unblocking action was taken otherwise false.
     */
    unblock(): boolean;
}

export const RingBuffer = {
    /**
     * Record type is padding to prevent fragmentation in the buffer.
     */
    PADDING_MSG_TYPE_ID: -1,

    /**
     * Buffer has insufficient capacity to record a message or satisfy {@link RingBuffer.tryClaim} request.
     */
    INSUFFICIENT_CAPACITY: -2,
} as const;
