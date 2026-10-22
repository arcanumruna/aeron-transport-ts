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
// Port of io/aeron/logbuffer/TermUnblocker.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { HeaderFlyweight } from '../protocol/HeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';
import { LogBufferDescriptor } from './LogBufferDescriptor.js';

const { FRAME_ALIGNMENT, frameType, frameTermOffset, frameTermId, frameLengthOrdered, frameLengthVolatile } =
    FrameDescriptor;
const { applyDefaultHeader } = LogBufferDescriptor;
const { HDR_TYPE_PAD } = HeaderFlyweight;

/**
 * Status of the unblock operation. Java's nested `enum TermUnblocker.Status`, with its ordinals.
 */
export class Status {
    private static nextOrdinal = 0;

    /**
     * Unblock action was not taken
     */
    public static readonly NO_ACTION: Status = new Status('NO_ACTION');

    /**
     * Message was unblocked
     */
    public static readonly UNBLOCKED: Status = new Status('UNBLOCKED');

    /**
     * Message was unblocked to the end of the term
     */
    public static readonly UNBLOCKED_TO_END: Status = new Status('UNBLOCKED_TO_END');

    private readonly _name: string;
    private readonly _ordinal: number;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = Status.nextOrdinal++;
    }

    public static values(): Status[] {
        return [Status.NO_ACTION, Status.UNBLOCKED, Status.UNBLOCKED_TO_END];
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }
}

/**
 * Takes a log buffer and looks for an incomplete message, i.e. a gap of zeros in the term buffer, and patches it
 * with a padding frame.
 */
export class TermUnblocker {
    /** Java's nested `TermUnblocker.Status`. */
    public static readonly Status = Status;

    private constructor() {}

    /**
     * Attempt to unblock the current term at the current offset.
     *
     * @param logMetaDataBuffer contains the default frame header for the padding frame.
     * @param termBuffer        to unblock
     * @param blockedOffset     to attempt to unblock
     * @param tailOffset        to which the scan for a frame can go
     * @param termId            of the current term buffer.
     * @return whether unblocking was done, not done, or applied to end of term
     */
    public static unblock(
        logMetaDataBuffer: UnsafeBuffer,
        termBuffer: UnsafeBuffer,
        blockedOffset: number,
        tailOffset: number,
        termId: number,
    ): Status {
        let status = Status.NO_ACTION;
        let frameLength = frameLengthVolatile(termBuffer, blockedOffset);

        if (frameLength < 0) {
            resetHeader(logMetaDataBuffer, termBuffer, blockedOffset, termId, -frameLength);
            status = Status.UNBLOCKED;
        } else if (0 === frameLength) {
            let currentOffset = blockedOffset + FRAME_ALIGNMENT;

            while (currentOffset < tailOffset) {
                frameLength = frameLengthVolatile(termBuffer, currentOffset);

                if (frameLength !== 0) {
                    if (scanBackToConfirmZeroed(termBuffer, currentOffset, blockedOffset)) {
                        const length = currentOffset - blockedOffset;
                        resetHeader(logMetaDataBuffer, termBuffer, blockedOffset, termId, length);
                        status = Status.UNBLOCKED;
                    }

                    break;
                }

                currentOffset += FRAME_ALIGNMENT;
            }

            if (currentOffset === termBuffer.capacity()) {
                if (0 === frameLengthVolatile(termBuffer, blockedOffset)) {
                    const length = currentOffset - blockedOffset;
                    resetHeader(logMetaDataBuffer, termBuffer, blockedOffset, termId, length);
                    status = Status.UNBLOCKED_TO_END;
                }
            }
        }

        return status;
    }
}

function resetHeader(
    logMetaDataBuffer: UnsafeBuffer,
    termBuffer: UnsafeBuffer,
    termOffset: number,
    termId: number,
    frameLength: number,
): void {
    applyDefaultHeader(logMetaDataBuffer, termBuffer, termOffset);
    frameType(termBuffer, termOffset, HDR_TYPE_PAD);
    frameTermOffset(termBuffer, termOffset);
    frameTermId(termBuffer, termOffset, termId);
    frameLengthOrdered(termBuffer, termOffset, frameLength);
}

function scanBackToConfirmZeroed(buffer: UnsafeBuffer, from: number, limit: number): boolean {
    let i = from - FRAME_ALIGNMENT;
    let allZeros = true;
    while (i >= limit) {
        if (0 !== frameLengthVolatile(buffer, i)) {
            allZeros = false;
            break;
        }

        i -= FRAME_ALIGNMENT;
    }

    return allZeros;
}
