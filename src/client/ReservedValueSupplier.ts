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
// Port of io/aeron/ReservedValueSupplier.java @ 1.53.3
import type { DirectBuffer } from '../agrona/DirectBuffer.js';

/**
 * Supplies the reserved value field for a data frame header. The returned value will be set in the header as
 * little-endian format.
 * <p>
 * This will be called as the last action of encoding a data frame right before the length is set. All other fields
 * in the header plus the body of the frame will have been written at the point of supply.
 * <p>
 * The reserved value can be used for carrying out of band data with message fragments such a checksums or timestamps.
 * <p>
 * A Java functional interface: an object with the one method `get`. The value is Java's `long`: a `bigint` (an opaque
 * 64-bit wire value, spec 5.2), or a `number` in +/-(2^53 - 1) so that a supplier of a timestamp or a checksum
 * allocates nothing (spec D81).
 */
export interface ReservedValueSupplier {
    /**
     * Callback to provide the reserved value to be encoded with each message fragment as the last action
     * before the length field is set which commits the fragment for sending to the media.
     *
     * @param termBuffer  containing the encoding message fragment.
     * @param termOffset  at which the header of the frame begins.
     * @param frameLength Total length of the frame including header.
     * @return the value to be used for storing in the reserved value field.
     */
    get(termBuffer: DirectBuffer, termOffset: number, frameLength: number): bigint | number;
}
