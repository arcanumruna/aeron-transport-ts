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
// Port of the parts of io/aeron/logbuffer/FrameDescriptor.java and io/aeron/logbuffer/LogBufferDescriptor.java
// @ 1.53.3 that ChannelUri and ChannelUriStringBuilder use. Stand-in until T9 ports the two classes; then this file is
// deleted and the two callers import `FrameDescriptor` and `LogBufferDescriptor` (see docs/mapping.md).
import { BitUtil } from '../agrona/BitUtil.js';
import { IllegalArgumentException, IllegalStateException, Long } from '../agrona/jdk.js';

/**
 * Alignment as a multiple of bytes for each frame. The length field will store the unaligned length in bytes.
 */
export const FRAME_ALIGNMENT = 32;

/**
 * Min buffer length for a log term.
 */
export const TERM_MIN_LENGTH = 64 * 1024;

/**
 * Max buffer length for a log term.
 */
export const TERM_MAX_LENGTH = 1024 * 1024 * 1024;

/**
 * Check that term length is valid and alignment is valid.
 *
 * @param termLength to be checked.
 * @throws IllegalStateException if the length is not as expected.
 */
export function checkTermLength(termLength: number): void {
    if (termLength < TERM_MIN_LENGTH) {
        throw new IllegalStateException(
            'Term length less than min length of ' + TERM_MIN_LENGTH + ': length=' + termLength,
        );
    }

    if (termLength > TERM_MAX_LENGTH) {
        throw new IllegalStateException(
            'Term length more than max length of ' + TERM_MAX_LENGTH + ': length=' + termLength,
        );
    }

    if (!BitUtil.isPowerOfTwo(termLength)) {
        throw new IllegalStateException('Term length not a power of 2: length=' + termLength);
    }
}

/**
 * Compute the number of bits to shift to convert a position into a term count.
 *
 * @param termBufferLength to compute the bits to shift for.
 * @return the number of bits to shift to divide by the term buffer length.
 */
export function positionBitsToShift(termBufferLength: number): number {
    switch (termBufferLength) {
        case 64 * 1024:
            return 16;
        case 128 * 1024:
            return 17;
        case 256 * 1024:
            return 18;
        case 512 * 1024:
            return 19;
        case 1024 * 1024:
            return 20;
        case 2 * 1024 * 1024:
            return 21;
        case 4 * 1024 * 1024:
            return 22;
        case 8 * 1024 * 1024:
            return 23;
        case 16 * 1024 * 1024:
            return 24;
        case 32 * 1024 * 1024:
            return 25;
        case 64 * 1024 * 1024:
            return 26;
        case 128 * 1024 * 1024:
            return 27;
        case 256 * 1024 * 1024:
            return 28;
        case 512 * 1024 * 1024:
            return 29;
        case 1024 * 1024 * 1024:
            return 30;
        default:
            throw new IllegalArgumentException('invalid term buffer length: ' + termBufferLength);
    }
}

/**
 * Compute the current term id from a position. A `position` is a `long` held in a `number` (spec D5): an unsafe one
 * throws `RangeError`.
 *
 * @param position             to calculate from.
 * @param positionBitsToShift  number of times to right shift the position.
 * @param initialTermId        the initial term id that this stream started on.
 * @return the term id according to the position.
 */
export function computeTermIdFromPosition(
    position: number,
    positionBitsToShift: number,
    initialTermId: number,
): number {
    Long.checkSafe(position);
    return ((Math.floor(position / 2 ** positionBitsToShift) | 0) + initialTermId) | 0;
}
