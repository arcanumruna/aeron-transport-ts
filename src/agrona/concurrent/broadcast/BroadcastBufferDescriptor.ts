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
// Port of org/agrona/concurrent/broadcast/BroadcastBufferDescriptor.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { IllegalStateException } from '../../jdk.js';

const { SIZE_OF_LONG, CACHE_LINE_LENGTH } = BitUtil;

/**
 * Layout of the broadcast buffer. The buffer consists of a ring of messages that is a power of 2 in size.
 * This is followed by a trailer section containing state information about the ring.
 */
export class BroadcastBufferDescriptor {
    /**
     * Offset within the trailer for where the tail intended value is stored.
     */
    public static readonly TAIL_INTENT_COUNTER_OFFSET: number = 0;

    /**
     * Offset within the trailer for where the tail value is stored.
     */
    public static readonly TAIL_COUNTER_OFFSET: number =
        BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET + SIZE_OF_LONG;

    /**
     * Offset within the trailer for where the latest sequence value is stored.
     */
    public static readonly LATEST_COUNTER_OFFSET: number = BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET + SIZE_OF_LONG;

    /**
     * Total size of the trailer.
     */
    public static readonly TRAILER_LENGTH: number = CACHE_LINE_LENGTH * 2;

    private constructor() {}

    /**
     * Check the buffer capacity is the correct size.
     *
     * @param capacity to be checked.
     * @throws IllegalStateException if the buffer capacity is not a power of 2.
     */
    public static checkCapacity(capacity: number): void {
        if (!BitUtil.isPowerOfTwo(capacity)) {
            const msg = 'capacity must be a positive power of 2 + TRAILER_LENGTH: capacity=' + capacity;
            throw new IllegalStateException(msg);
        }
    }
}
