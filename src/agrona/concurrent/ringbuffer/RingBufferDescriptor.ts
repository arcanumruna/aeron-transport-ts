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
// Port of org/agrona/concurrent/ringbuffer/RingBufferDescriptor.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { IllegalArgumentException } from '../../jdk.js';

const { CACHE_LINE_LENGTH } = BitUtil;

/**
 * Layout description for the underlying buffer used by a {@link RingBuffer}. The buffer consists
 * of a ring of messages which is a power of 2 in size, followed by a trailer section containing state
 * information for the producers and consumers of the ring.
 */
export class RingBufferDescriptor {
    private constructor() {}

    /**
     * Offset within the trailer for where the tail value is stored.
     */
    public static readonly TAIL_POSITION_OFFSET: number = CACHE_LINE_LENGTH * 2;

    /**
     * Offset within the trailer for where the head cache value is stored.
     */
    public static readonly HEAD_CACHE_POSITION_OFFSET: number = CACHE_LINE_LENGTH * 4;

    /**
     * Offset within the trailer for where the head value is stored.
     */
    public static readonly HEAD_POSITION_OFFSET: number = CACHE_LINE_LENGTH * 6;

    /**
     * Offset within the trailer for where the correlation counter value is stored.
     */
    public static readonly CORRELATION_COUNTER_OFFSET: number = CACHE_LINE_LENGTH * 8;

    /**
     * Offset within the trailer for where the consumer heartbeat time value is stored.
     */
    public static readonly CONSUMER_HEARTBEAT_OFFSET: number = CACHE_LINE_LENGTH * 10;

    /**
     * Total length of the trailer in bytes.
     */
    public static readonly TRAILER_LENGTH: number = CACHE_LINE_LENGTH * 12;

    /**
     * Check the buffer capacity is the correct size (a power of 2 + {@link RingBufferDescriptor.TRAILER_LENGTH})
     * and that it satisfies minimum capacity size.
     *
     * @param capacity    to be checked.
     * @param minCapacity minimum required capacity of the ring buffer.
     * @return the capacity to store the data in the ring buffer, i.e. {@code capacity - TRAILER_LENGTH}.
     * @throws IllegalArgumentException if the buffer capacity is incorrect.
     */
    public static checkCapacity(capacity: number, minCapacity: number): number {
        const dataCapacity = capacity - RingBufferDescriptor.TRAILER_LENGTH;
        if (!BitUtil.isPowerOfTwo(dataCapacity)) {
            throw new IllegalArgumentException(
                'capacity must be a positive power of 2 + TRAILER_LENGTH: capacity=' + capacity,
            );
        }
        if (dataCapacity < minCapacity) {
            throw new IllegalArgumentException(
                'insufficient capacity: minCapacity=' +
                    (minCapacity + RingBufferDescriptor.TRAILER_LENGTH) +
                    ', capacity=' +
                    capacity,
            );
        }
        return dataCapacity;
    }
}
