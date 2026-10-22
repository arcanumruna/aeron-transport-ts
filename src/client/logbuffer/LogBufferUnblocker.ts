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
// Port of io/aeron/logbuffer/LogBufferUnblocker.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from './LogBufferDescriptor.js';
import { Status, TermUnblocker } from './TermUnblocker.js';

const { activeTermCount, indexByTermCount, rawTailVolatile, rotateLog, termId, termOffset } = LogBufferDescriptor;

/**
 * Takes a log buffer and checks whether the position at the head of the log is blocked by a message that was never
 * completed, and if so patches it with a padding frame, rotating the log when the term end is reached.
 */
export class LogBufferUnblocker {
    private constructor() {}

    /**
     * Attempt to unblock a log buffer at the given position.
     *
     * @param termBuffers       for the log
     * @param logMetaDataBuffer for the log
     * @param blockedPosition   to be unblocked
     * @param termLength        of each term
     * @return whether unblocking was done
     */
    public static unblock(
        termBuffers: UnsafeBuffer[],
        logMetaDataBuffer: UnsafeBuffer,
        blockedPosition: number,
        termLength: number,
    ): boolean {
        const positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        // Java's `(int)(long >> n)` and `(int)long`: the position is a `number` (spec D5), so it is divided, not shifted
        const blockedTermCount = Math.floor(blockedPosition / 2 ** positionBitsToShift) | 0;
        const blockedOffset = (blockedPosition | 0) & (termLength - 1);
        const currentTermCount = activeTermCount(logMetaDataBuffer);

        if (currentTermCount === ((blockedTermCount - 1) | 0) && blockedOffset === 0) {
            const currentTermId = termId(rawTailVolatile(logMetaDataBuffer, indexByTermCount(currentTermCount)));
            rotateLog(logMetaDataBuffer, currentTermCount, currentTermId);
            return true;
        }

        const blockedIndex = indexByTermCount(blockedTermCount);
        const rawTail = rawTailVolatile(logMetaDataBuffer, blockedIndex);
        const blockedTermId = termId(rawTail);
        const tailOffset = termOffset(rawTail, termLength);
        const termBuffer = termBuffers[blockedIndex] as UnsafeBuffer;

        const status = TermUnblocker.unblock(logMetaDataBuffer, termBuffer, blockedOffset, tailOffset, blockedTermId);
        if (Status.UNBLOCKED_TO_END === status) {
            rotateLog(logMetaDataBuffer, blockedTermCount, blockedTermId);
            return true;
        }

        return Status.UNBLOCKED === status;
    }
}
