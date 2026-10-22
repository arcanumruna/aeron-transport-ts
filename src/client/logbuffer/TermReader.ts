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
// Port of io/aeron/logbuffer/TermReader.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { Position } from '../../agrona/concurrent/status/Position.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';
import type { FragmentHandler } from './FragmentHandler.js';
import type { Header } from './Header.js';

const { FRAME_ALIGNMENT, frameLengthVolatile, isPaddingFrame } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;

/** A packed outcome is `fragmentsRead * OFFSET_RANGE + offset / FRAME_ALIGNMENT` (spec D13). */
const OFFSET_RANGE = 2 ** 26;

/**
 * Utility functions for reading a term within a log buffer.
 */
export class TermReader {
    private constructor() {}

    /**
     * Reads the term from the term offset up to the fragments limit, handing each fragment to the handler.
     * <p>
     * With a `currentPosition` and a `subscriberPosition` the position is advanced (released) by the bytes consumed
     * and the result is the number of fragments read. Without them (the six argument form of Java) the result is the
     * packed outcome of {@link #pack}: the new offset and the fragments read, and no position is touched. The two
     * forms are told apart by `undefined !== subscriberPosition`. The six argument form needs a frame-aligned
     * `termOffset` and a valid term, else `pack` throws `RangeError` (spec D13).
     *
     * @param termBuffer         to be read for fragments.
     * @param termOffset         offset within the buffer that the read should begin at.
     * @param handler            the handler for data that has been read.
     * @param fragmentsLimit     limit the number of fragments read.
     * @param header             to be used for mapping over the header for a given fragment.
     * @param errorHandler       to be notified if an error occurs during the callback.
     * @param currentPosition    prior to reading further fragments.
     * @param subscriberPosition to be updated after reading with new position.
     * @return the number of fragments read, or the packed outcome without a position.
     */
    public static read(
        termBuffer: UnsafeBuffer,
        termOffset: number,
        handler: FragmentHandler,
        fragmentsLimit: number,
        header: Header,
        errorHandler: ErrorHandler,
        currentPosition: number,
        subscriberPosition: Position,
    ): number;
    public static read(
        termBuffer: UnsafeBuffer,
        termOffset: number,
        handler: FragmentHandler,
        fragmentsLimit: number,
        header: Header,
        errorHandler: ErrorHandler,
    ): number;
    public static read(
        termBuffer: UnsafeBuffer,
        termOffset: number,
        handler: FragmentHandler,
        fragmentsLimit: number,
        header: Header,
        errorHandler: ErrorHandler,
        currentPosition?: number,
        subscriberPosition?: Position,
    ): number {
        let fragmentsRead = 0;
        let offset = termOffset;
        const capacity = termBuffer.capacity();
        header.buffer(termBuffer);

        try {
            while (fragmentsRead < fragmentsLimit && offset < capacity) {
                const frameLength = frameLengthVolatile(termBuffer, offset);
                if (frameLength <= 0) {
                    break;
                }

                const frameOffset = offset;
                offset += BitUtil.align(frameLength, FRAME_ALIGNMENT);

                if (!isPaddingFrame(termBuffer, frameOffset)) {
                    ++fragmentsRead;
                    header.offset(frameOffset);
                    handler.onFragment(termBuffer, frameOffset + HEADER_LENGTH, frameLength - HEADER_LENGTH, header);
                }
            }
        } catch (ex) {
            errorHandler.onError(ex as Error);
        } finally {
            if (undefined !== subscriberPosition) {
                const newPosition = (currentPosition as number) + (offset - termOffset);
                if (newPosition > (currentPosition as number)) {
                    subscriberPosition.setRelease(newPosition);
                }
            }
        }

        return undefined === subscriberPosition ? TermReader.pack(offset, fragmentsRead) : fragmentsRead;
    }

    /**
     * Pack the values for fragmentsRead and offset into a number so they can be returned on the stack. The layout
     * is `fragmentsRead * 2^26 + offset / FRAME_ALIGNMENT`: the offset is a multiple of FRAME_ALIGNMENT in [0, 2^31)
     * and the fragments read are in [0, 2^26), else `RangeError` (spec D13).
     *
     * @param offset        value to be packed.
     * @param fragmentsRead value to be packed.
     * @return a number with both values packed.
     */
    public static pack(offset: number, fragmentsRead: number): number {
        if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            offset > 0x7fffffff ||
            !FrameDescriptor.isFrameAligned(offset) ||
            !Number.isInteger(fragmentsRead) ||
            fragmentsRead < 0 ||
            fragmentsRead >= OFFSET_RANGE
        ) {
            throw new RangeError(`cannot pack offset=${offset} fragmentsRead=${fragmentsRead}`);
        }

        return fragmentsRead * OFFSET_RANGE + offset / FRAME_ALIGNMENT;
    }

    /**
     * The number of fragments that have been read.
     *
     * @param readOutcome into which the fragments read value has been packed.
     * @return the number of fragments that have been read.
     */
    public static fragmentsRead(readOutcome: number): number {
        return Math.floor(readOutcome / OFFSET_RANGE);
    }

    /**
     * The offset up to which the term has progressed.
     *
     * @param readOutcome into which the offset value has been packed.
     * @return the offset up to which the term has progressed.
     */
    public static offset(readOutcome: number): number {
        return (readOutcome % OFFSET_RANGE) * FRAME_ALIGNMENT;
    }
}
