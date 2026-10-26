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
// Port of io/aeron/driver/ext/FixedLossGenerator.java @ 1.53.3
import { LongHalves2ObjectHashMap } from '../../agrona/collections/LongHalves2ObjectHashMap.js';
import { MutableInteger } from '../../agrona/collections/MutableInteger.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { LossGenerator } from './LossGenerator.js';

/**
 * Fixed loss generator: it drops the frames that overlap one range of one term, once for each stream and session, so
 * that a retransmission of the range gets through.
 */
export class FixedLossGenerator implements LossGenerator {
    private readonly termId: number;
    private readonly termOffset: number;
    private readonly length: number;
    // Java's BiInt2ObjectMap<MutableInteger>, keyed by (streamId, sessionId) (spec D60)
    private readonly streamAndSessionIdToOffsetMap = new LongHalves2ObjectHashMap<MutableInteger>();

    /**
     * Set the range of messages to be dropped.
     *
     * @param termId     to be dropped
     * @param termOffset to be dropped
     * @param length     to be dropped
     */
    public constructor(termId: number, termOffset: number, length: number) {
        this.termId = termId;
        this.termOffset = termOffset;
        this.length = length;
    }

    /**
     * {@inheritDoc}
     */
    public shouldDropFrame(address: InetSocketAddress | null, buffer: UnsafeBuffer | null, length: number): boolean;
    public shouldDropFrame(
        address: InetSocketAddress | null,
        buffer: UnsafeBuffer | null,
        streamId: number,
        sessionId: number,
        termId: number,
        termOffset: number,
        length: number,
    ): boolean;
    public shouldDropFrame(
        _address: InetSocketAddress | null,
        _buffer: UnsafeBuffer | null,
        streamId: number,
        sessionId?: number,
        termId?: number,
        termOffset?: number,
        length?: number,
    ): boolean {
        if (undefined === sessionId) {
            return false; // the short form (spec D62)
        }

        if (this.termId === termId) {
            let maximumDroppedOffset = this.streamAndSessionIdToOffsetMap.get(streamId, sessionId);
            if (null === maximumDroppedOffset) {
                maximumDroppedOffset = new MutableInteger(termOffset!);
                this.streamAndSessionIdToOffsetMap.put(streamId, sessionId, maximumDroppedOffset);
            }

            const isRetransmission = maximumDroppedOffset.get() > termOffset!;

            if (!isRetransmission) {
                const dropRegionOffset = this.termOffset;
                const dropRegionLimit = this.termOffset + this.length;
                const frameLimit = termOffset! + length!;

                const shouldDrop = frameLimit > dropRegionOffset && termOffset! < dropRegionLimit;

                if (shouldDrop) {
                    maximumDroppedOffset.set(termOffset! + length!);
                    return true;
                }
            }
        }

        return false;
    }
}
