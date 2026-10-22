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
// Port of io/aeron/logbuffer/TermGapFiller.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { HeaderFlyweight } from '../protocol/HeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';
import { LogBufferDescriptor } from './LogBufferDescriptor.js';

const { FRAME_ALIGNMENT, frameType, frameTermOffset, frameTermId, frameLengthOrdered } = FrameDescriptor;
const { applyDefaultHeader } = LogBufferDescriptor;
const { HDR_TYPE_PAD } = HeaderFlyweight;

/**
 * Fills a gap in a term with a padding record.
 */
export class TermGapFiller {
    private constructor() {}

    /**
     * Try to gap fill the current term at a given offset if the gap contains no data.
     * <p>
     * Note: the gap offset plus gap length must end on a {@link FrameDescriptor#FRAME_ALIGNMENT} boundary.
     *
     * @param logMetaDataBuffer containing the default headers
     * @param termBuffer        to gap fill
     * @param termId            for the current term.
     * @param gapOffset         to fill from
     * @param gapLength         to length of the gap.
     * @return true if the gap has been filled with a padding record or false if data found.
     */
    public static tryFillGap(
        logMetaDataBuffer: UnsafeBuffer,
        termBuffer: UnsafeBuffer,
        termId: number,
        gapOffset: number,
        gapLength: number,
    ): boolean {
        let offset = gapOffset + gapLength - FRAME_ALIGNMENT;

        while (offset >= gapOffset) {
            if (0 !== termBuffer.getInt(offset)) {
                return false;
            }

            offset -= FRAME_ALIGNMENT;
        }

        applyDefaultHeader(logMetaDataBuffer, termBuffer, gapOffset);
        frameType(termBuffer, gapOffset, HDR_TYPE_PAD);
        frameTermOffset(termBuffer, gapOffset);
        frameTermId(termBuffer, gapOffset, termId);
        frameLengthOrdered(termBuffer, gapOffset, gapLength);

        return true;
    }
}
