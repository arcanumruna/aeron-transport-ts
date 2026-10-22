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
// Port of io/aeron/logbuffer/TermRebuilder.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';

const { HEADER_LENGTH } = DataHeaderFlyweight;

/**
 * Rebuild a term buffer from received frames which can be out-of-order. The resulting data structure will only
 * monotonically increase in state.
 */
export class TermRebuilder {
    private constructor() {}

    /**
     * Insert a packet of frames into the log at the appropriate offset as indicated by the term offset header.
     * <p>
     * The first 8 bytes (the frame length, then the version, flags and type) are written last, with a release store
     * of the frame length, so that a reader sees a complete frame. The 8-byte words of Java are copied as two `int`s
     * each, in the same order (spec D5: a `long` word is not always a safe `number`).
     *
     * @param termBuffer to insert the packet into.
     * @param termOffset offset in the term at which the packet should be inserted.
     * @param packet     containing a sequence of frames.
     * @param length     of the sequence of frames in bytes.
     */
    public static insert(termBuffer: UnsafeBuffer, termOffset: number, packet: UnsafeBuffer, length: number): void {
        if (0 === termBuffer.getInt(termOffset)) {
            termBuffer.putBytes(termOffset + HEADER_LENGTH, packet, HEADER_LENGTH, length - HEADER_LENGTH);

            termBuffer.putInt(termOffset + 28, packet.getInt(28));
            termBuffer.putInt(termOffset + 24, packet.getInt(24));
            termBuffer.putInt(termOffset + 20, packet.getInt(20));
            termBuffer.putInt(termOffset + 16, packet.getInt(16));
            termBuffer.putInt(termOffset + 12, packet.getInt(12));
            termBuffer.putInt(termOffset + 8, packet.getInt(8));

            termBuffer.putInt(termOffset + 4, packet.getInt(4));
            termBuffer.putIntRelease(termOffset, packet.getInt(0));
        }
    }
}
