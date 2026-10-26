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
// Port of io/aeron/driver/ext/MultiGapLossGenerator.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { LongHalves2ObjectHashMap } from '../../agrona/collections/LongHalves2ObjectHashMap.js';
import { MutableInteger } from '../../agrona/collections/MutableInteger.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException } from '../../agrona/jdk.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { LossGenerator } from './LossGenerator.js';

/**
 * Generates multiple gaps of loss in a term, at multiples of a power of two, once for each stream and session.
 */
export class MultiGapLossGenerator implements LossGenerator {
    private readonly termId: number;
    private readonly gapRadixBits: number;
    private readonly gapRadixMask: number;
    private readonly gapLength: number;
    private readonly lastGapLimit: number;
    // Java's BiInt2ObjectMap<MutableInteger>, keyed by (streamId, sessionId) (spec D60)
    private readonly streamAndSessionIdToOffsetMap = new LongHalves2ObjectHashMap<MutableInteger>();

    /**
     * Set the range of messages to be dropped.
     *
     * @param termId    to be dropped
     * @param gapRadix  the initial offset and subsequent interval between gaps - must be a power of 2
     * @param gapLength length of each gap
     * @param totalGaps the total number of gaps
     */
    public constructor(termId: number, gapRadix: number, gapLength: number, totalGaps: number) {
        const actualGapRadix = BitUtil.findNextPositivePowerOfTwo(gapRadix);
        if (gapLength >= actualGapRadix) {
            throw new IllegalArgumentException('gapLength must be smaller than gapRadix');
        }

        this.termId = termId;
        this.gapRadixBits = 31 - Math.clz32(actualGapRadix); // Integer.numberOfTrailingZeros of a power of two
        this.gapRadixMask = -actualGapRadix;
        this.gapLength = gapLength;
        this.lastGapLimit = (totalGaps * actualGapRadix + gapLength) | 0;
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

        const offset = termOffset!;

        if (this.termId !== termId) {
            // wrong term
            return false;
        }

        if (offset > this.lastGapLimit) {
            // this packet is past the last offset we'll drop
            return false;
        }

        let maximumDroppedOffset = this.streamAndSessionIdToOffsetMap.get(streamId, sessionId);
        if (null === maximumDroppedOffset) {
            // first time we've seen this term/stream/session
            maximumDroppedOffset = new MutableInteger(offset);
            this.streamAndSessionIdToOffsetMap.put(streamId, sessionId, maximumDroppedOffset);
        }

        if (maximumDroppedOffset.get() > offset) {
            // this is an rx (offset is lower than max dropped)
            return false;
        }

        const frameLimit = (offset + length!) | 0;

        // Integer.numberOfTrailingZeros(termOffset) >= gapRadixBits, for a non-zero offset: its low bits are all zero
        if (0 !== offset && 0 === (offset & ((1 << this.gapRadixBits) - 1))) {
            maximumDroppedOffset.set(frameLimit);
            return true;
        }

        const previousGapOffset = offset & this.gapRadixMask;
        const previousGapLimit = (previousGapOffset + this.gapLength) | 0;
        if (previousGapOffset > 0 && offset < previousGapLimit) {
            maximumDroppedOffset.set(frameLimit);
            return true;
        }

        const nextGapOffset = ((offset >> this.gapRadixBits) + 1) << this.gapRadixBits;
        const nextGapLimit = (nextGapOffset + this.gapLength) | 0;
        if (frameLimit > nextGapOffset && offset < nextGapLimit) {
            maximumDroppedOffset.set(frameLimit);
            return true;
        }

        return false;
    }
}
