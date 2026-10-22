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
// Port of io/aeron/logbuffer/TermGapScanner.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';

const { FRAME_ALIGNMENT, frameLengthVolatile } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { align } = BitUtil;

// Java's nested `TermGapScanner.GapHandler`.
/**
 * Handler for notifying of gaps in the log.
 */
export interface GapHandler {
    /**
     * Gap detected in log buffer that is being rebuilt.
     *
     * @param termId active term being scanned.
     * @param offset at which the gap begins.
     * @param length of the gap in bytes.
     */
    onGap(termId: number, offset: number, length: number): void;
}

/**
 * Scans for gaps in the sequence of bytes in a replicated term buffer between the completed rebuild and the
 * high-water-mark. This can be used for detecting loss and generating a NAK message to the source.
 * <p>
 * <b>Note:</b> This class is threadsafe to be used across multiple threads.
 */
export class TermGapScanner {
    private constructor() {}

    /**
     * Scan for gaps from the scanOffset up to a limit offset. Each gap will be reported to the {@link GapHandler}.
     *
     * @param termBuffer  to be scanned for a gap.
     * @param termId      of the current term buffer.
     * @param termOffset  at which to start scanning.
     * @param limitOffset at which to stop scanning.
     * @param handler     to call if a gap is found.
     * @return offset of last contiguous frame
     */
    public static scanForGap(
        termBuffer: UnsafeBuffer,
        termId: number,
        termOffset: number,
        limitOffset: number,
        handler: GapHandler,
    ): number {
        let offset = termOffset;
        do {
            const frameLength = frameLengthVolatile(termBuffer, offset);
            if (frameLength <= 0) {
                break;
            }

            offset += align(frameLength, FRAME_ALIGNMENT);
        } while (offset < limitOffset);

        const gapBeginOffset = offset;
        if (offset < limitOffset) {
            offset += HEADER_LENGTH;
            while (offset < limitOffset) {
                if (0 !== frameLengthVolatile(termBuffer, offset)) {
                    break;
                }
                offset += HEADER_LENGTH;
            }

            const gapLength = offset - gapBeginOffset;
            handler.onGap(termId, gapBeginOffset, gapLength);
        }

        return gapBeginOffset;
    }
}
