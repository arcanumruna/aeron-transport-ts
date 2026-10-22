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
// Port of io/aeron/logbuffer/TermScanner.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';

const { FRAME_ALIGNMENT, frameLengthVolatile, isPaddingFrame } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { align } = BitUtil;

/** A packed outcome is `padding * AVAILABLE_RANGE + available + AVAILABLE_BIAS` (spec D13). */
const AVAILABLE_RANGE = 2 ** 22;
const AVAILABLE_BIAS = 2 ** 21;
const MAX_PADDING = 2 ** 30;

/**
 * Scan a term buffer for availability of new messages.
 */
export class TermScanner {
    private constructor() {}

    /**
     * Scan the term buffer for availability of new messages from a given offset up to a maxLength of bytes.
     * <p>
     * The result is a packed outcome: use {@link #available} and {@link #padding} to read it.
     *
     * @param termBuffer to be scanned for messages.
     * @param offset     in the buffer at which the scan should begin.
     * @param maxLength  in bytes of how much should be scanned.
     * @return resulting status of the scan which packs the available bytes and padding into a number.
     */
    public static scanForAvailability(termBuffer: UnsafeBuffer, offset: number, maxLength: number): number {
        const limit = Math.min(maxLength, termBuffer.capacity() - offset);
        let available = 0;
        let padding = 0;

        do {
            const termOffset = offset + available;
            const frameLength = frameLengthVolatile(termBuffer, termOffset);
            if (frameLength <= 0) {
                break;
            }

            let alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);
            if (isPaddingFrame(termBuffer, termOffset)) {
                padding = alignedFrameLength - HEADER_LENGTH;
                alignedFrameLength = HEADER_LENGTH;
            }

            available += alignedFrameLength;

            if (available > limit) {
                available = alignedFrameLength === available ? -available : available - alignedFrameLength;
                padding = 0;
                break;
            }
        } while (0 === padding && available < limit);

        return TermScanner.pack(padding, available);
    }

    /**
     * Pack the values for padding and available into a number so they can be returned on the stack. As in Java, a
     * negative `available` sign extends over the padding half, so `padding` then reads as -1. `available` must be in
     * [-2^21, 2^21) and `padding` in [-2^30, 2^30], else `RangeError` (spec D13).
     *
     * @param padding   value to be packed.
     * @param available value to be packed.
     * @return a number with both values packed.
     */
    public static pack(padding: number, available: number): number {
        if (
            !Number.isInteger(padding) ||
            padding < -MAX_PADDING ||
            padding > MAX_PADDING ||
            !Number.isInteger(available) ||
            available < -AVAILABLE_BIAS ||
            available >= AVAILABLE_BIAS
        ) {
            throw new RangeError(`cannot pack padding=${padding} available=${available}`);
        }

        return (available < 0 ? -1 : padding) * AVAILABLE_RANGE + available + AVAILABLE_BIAS;
    }

    /**
     * The number of bytes available from the packed outcome.
     *
     * @param result into which the available value has been packed.
     * @return the count of bytes that are available to be read.
     */
    public static available(result: number): number {
        return result - Math.floor(result / AVAILABLE_RANGE) * AVAILABLE_RANGE - AVAILABLE_BIAS;
    }

    /**
     * The count of bytes that should be added to the length to account for padding frames from the packed outcome.
     *
     * @param result into which the padding value has been packed.
     * @return the count of bytes that should be added to the length to account for padding frames.
     */
    public static padding(result: number): number {
        return Math.floor(result / AVAILABLE_RANGE);
    }
}
