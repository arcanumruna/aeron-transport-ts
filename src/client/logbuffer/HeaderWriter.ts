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
// Port of io/aeron/logbuffer/HeaderWriter.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../protocol/HeaderFlyweight.js';

const { SESSION_ID_FIELD_OFFSET, STREAM_ID_FIELD_OFFSET, TERM_ID_FIELD_OFFSET, TERM_OFFSET_FIELD_OFFSET } =
    DataHeaderFlyweight;
const { FRAME_LENGTH_FIELD_OFFSET, VERSION_FIELD_OFFSET } = HeaderFlyweight;

/**
 * Utility for applying a header to a message in a term buffer.
 * <p>
 * Java's version is thread safe, to be used across multiple producers. It stores word 0 (the frame length in the
 * lower half and version, flags and type in the upper half) with `putLongRelease`, then `storeStoreFence`, then the
 * other two 8-byte words with plain stores. Here there is one thread: the frame length, the field a consumer reads
 * first, is stored last of the two halves of word 0 with a release store, and it completes word 0 before the other
 * fields are written.
 * <p>
 * Java holds three `long` values, each an `int` of the default header shifted into the upper half of a `long` (or
 * the stream id in the lower half) for the three 8-byte stores of its `write`. A `long` that large cannot be a
 * `number` (spec D5), so each field is the `int` itself and `write` stores the two halves of every 8-byte word, the
 * upper half first. A word that does not fit in the buffer then fails on its first store and writes nothing, as
 * Java's single bounds-checked `long` store does: the bytes written before the exception are those of the words
 * before the failing one.
 */
export class HeaderWriter {
    /** The `int` of the default header at the version offset: version, flags and type. */
    public readonly versionFlagsType: number;
    /** The session id of the default header. */
    public readonly sessionId: number;
    /** The stream id of the default header. */
    public readonly streamId: number;

    /**
     * Construct from the default header of a stream. (The constructor of Java that takes the three `long` values is
     * only used by its big-endian subclass, which is not ported.)
     *
     * @param defaultHeader for the stream.
     */
    public constructor(defaultHeader: UnsafeBuffer) {
        this.versionFlagsType = defaultHeader.getInt(VERSION_FIELD_OFFSET);
        this.sessionId = defaultHeader.getInt(SESSION_ID_FIELD_OFFSET);
        this.streamId = defaultHeader.getInt(STREAM_ID_FIELD_OFFSET);
    }

    /**
     * Create a new {@link HeaderWriter} that is byte order specific to the platform. The platform is little-endian,
     * so this is always a {@link HeaderWriter}; Java's `NativeBigEndianHeaderWriter` is not ported.
     *
     * @param defaultHeader for the stream.
     * @return a new {@link HeaderWriter} that is byte order specific to the platform.
     */
    public static newInstance(defaultHeader: UnsafeBuffer): HeaderWriter {
        return new HeaderWriter(defaultHeader);
    }

    /**
     * Write a header to the term buffer in little-endian format using the minimum instructions.
     *
     * @param termBuffer to be written to.
     * @param offset     at which the header should be written.
     * @param length     of the fragment including the header.
     * @param termId     of the current term buffer.
     */
    public write(termBuffer: UnsafeBuffer, offset: number, length: number, termId: number): void {
        // word 0: version, flags and type (upper half), then the frame length (lower half) as the release store
        termBuffer.putInt(offset + VERSION_FIELD_OFFSET, this.versionFlagsType);
        termBuffer.putIntRelease(offset + FRAME_LENGTH_FIELD_OFFSET, -length);

        // word 1: session id (upper half), then term offset (lower half)
        termBuffer.putInt(offset + SESSION_ID_FIELD_OFFSET, this.sessionId);
        termBuffer.putInt(offset + TERM_OFFSET_FIELD_OFFSET, offset);

        // word 2: term id (upper half), then stream id (lower half)
        termBuffer.putInt(offset + TERM_ID_FIELD_OFFSET, termId);
        termBuffer.putInt(offset + STREAM_ID_FIELD_OFFSET, this.streamId);
    }
}
