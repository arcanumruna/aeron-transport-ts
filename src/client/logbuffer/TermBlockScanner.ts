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
// Port of io/aeron/logbuffer/TermBlockScanner.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from './FrameDescriptor.js';

const { FRAME_ALIGNMENT, frameLengthVolatile, isPaddingFrame } = FrameDescriptor;
const { align } = BitUtil;

/**
 * Scan a term buffer for a block of messages including padding. The block must include complete messages.
 */
export class TermBlockScanner {
    private constructor() {}

    /**
     * Scan a term buffer for a block of message fragments including padding. The block must include complete
     * messages. A padding frame is returned as a block of its own, or ends a block that precedes it.
     *
     * @param termBuffer  to scan for message fragments.
     * @param termOffset  at which the scan should begin.
     * @param limitOffset at which the scan should stop.
     * @return the offset at which the scan terminated.
     */
    public static scan(termBuffer: UnsafeBuffer, termOffset: number, limitOffset: number): number {
        let offset = termOffset;

        while (offset < limitOffset) {
            const frameLength = frameLengthVolatile(termBuffer, offset);
            if (frameLength <= 0) {
                break;
            }

            const alignedFrameLength = align(frameLength, FRAME_ALIGNMENT);

            if (isPaddingFrame(termBuffer, offset)) {
                if (termOffset === offset) {
                    offset += alignedFrameLength;
                }

                break;
            }

            if (offset + alignedFrameLength > limitOffset) {
                break;
            }

            offset += alignedFrameLength;
        }

        return offset;
    }
}
