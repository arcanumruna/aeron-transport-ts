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
import { BitUtil } from '../../agrona/BitUtil.js';
import { LogBufferDescriptor } from './LogBufferDescriptor.js';
import { Status, TermUnblocker } from './TermUnblocker.js';

const { indexByTermCount, rotateLog } = LogBufferDescriptor;
const { SIZE_OF_LONG } = BitUtil;

/** Scratch for the halves of a raw tail (spec D12, D16): the module is used on one thread at a time. */
const RAW_TAIL_HALVES = new Int32Array(2);

/**
 * Provides the functionality to unblock a log at a given position.
 */
export class LogBufferUnblocker {
    private constructor() {}

    /**
     * Attempt to unblock a log buffer at given position.
     *
     * @param termBuffers       for current blockedOffset.
     * @param logMetaDataBuffer for log buffer.
     * @param blockedPosition   to attempt to unblock.
     * @param termLength        of the buffer for each term in the log.
     * @return whether attempt was made to unblock.
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
        const activeTermCount = LogBufferDescriptor.activeTermCount(logMetaDataBuffer);

        if (activeTermCount === ((blockedTermCount - 1) | 0) && blockedOffset === 0) {
            const currentTermId = LogBufferDescriptor.rawTailTermId(
                logMetaDataBuffer,
                indexByTermCount(activeTermCount),
            );
            rotateLog(logMetaDataBuffer, activeTermCount, currentTermId);
            return true;
        }

        const blockedIndex = indexByTermCount(blockedTermCount);
        // Java's one `rawTailVolatile` read, as halves (spec D12): no `bigint` is allocated
        logMetaDataBuffer.getLongVolatileHalves(
            LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * blockedIndex,
            RAW_TAIL_HALVES,
        );
        const termId = RAW_TAIL_HALVES[1]!;
        const tailOffset = Math.min(RAW_TAIL_HALVES[0]! >>> 0, termLength) | 0;
        const termBuffer = termBuffers[blockedIndex] as UnsafeBuffer;

        switch (TermUnblocker.unblock(logMetaDataBuffer, termBuffer, blockedOffset, tailOffset, termId)) {
            case Status.NO_ACTION:
                break;

            case Status.UNBLOCKED_TO_END:
                rotateLog(logMetaDataBuffer, blockedTermCount, termId);
                return true;

            case Status.UNBLOCKED:
                return true;
        }

        return false;
    }
}
