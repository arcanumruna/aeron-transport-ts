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
// Port of io/aeron/protocol/NakFlyweight.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { FrameDescriptor } from '../logbuffer/FrameDescriptor.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Flyweight for a NAK Message Frame.
 * <p>
 * <a target="_blank"
 * href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#data-recovery-via-retransmit-request">
 * Data Loss Recovery</a> wiki page.
 */
export class NakFlyweight extends HeaderFlyweight {
    /**
     * Length of the frame in bytes.
     */
    public static readonly HEADER_LENGTH = 28;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    private static readonly SESSION_ID_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    private static readonly STREAM_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the term-id field begins.
     */
    private static readonly TERM_ID_FIELD_OFFSET = 16;

    /**
     * Offset in the frame at which the term-offset field begins.
     */
    private static readonly TERM_OFFSET_FIELD_OFFSET = 20;

    /**
     * Offset in the frame at which the length of the NAK range field begins.
     */
    private static readonly LENGTH_FIELD_OFFSET = 24;

    /**
     * Default constructor which can later be used to wrap a frame, or construct the flyweight over a frame. The
     * `ByteBuffer` overload of Java is an `ArrayBuffer` or a `Uint8Array` here (spec D9).
     *
     * @param buffer containing the frame.
     */
    public constructor(buffer?: UnsafeBuffer | Uint8Array | ArrayBuffer) {
        super(buffer);
    }

    /**
     * The session-id for the stream.
     *
     * @return session-id for the stream.
     */
    public sessionId(): number;
    /**
     * Set session-id for the stream.
     *
     * @param sessionId session-id for the stream.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): NakFlyweight;
    public sessionId(sessionId?: number): number | NakFlyweight {
        if (undefined === sessionId) {
            return this.getInt(NakFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(NakFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The stream-id for the stream.
     *
     * @return stream-id for the stream.
     */
    public streamId(): number;
    /**
     * Set stream-id for the stream.
     *
     * @param streamId stream-id for the stream.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): NakFlyweight;
    public streamId(streamId?: number): number | NakFlyweight {
        if (undefined === streamId) {
            return this.getInt(NakFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(NakFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The term-id for the stream.
     *
     * @return term-id for the stream.
     */
    public termId(): number;
    /**
     * Set term-id for the stream.
     *
     * @param termId term-id for the stream.
     * @return this for a fluent API.
     */
    public termId(termId: number): NakFlyweight;
    public termId(termId?: number): number | NakFlyweight {
        if (undefined === termId) {
            return this.getInt(NakFlyweight.TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(NakFlyweight.TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The term-offset for the stream.
     *
     * @return term-offset for the stream.
     */
    public termOffset(): number;
    /**
     * Set term-offset for the stream.
     *
     * @param termOffset term-offset for the stream.
     * @return for a fluent API.
     */
    public termOffset(termOffset: number): NakFlyweight;
    public termOffset(termOffset?: number): number | NakFlyweight {
        if (undefined === termOffset) {
            return this.getInt(NakFlyweight.TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(NakFlyweight.TERM_OFFSET_FIELD_OFFSET, termOffset, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The length of the encoded frame.
     *
     * @return length of the encoded frame.
     */
    public length(): number;
    /**
     * Set length of the encoded frame.
     *
     * @param length of the encoded frame.
     * @return this for a fluent API.
     */
    public length(length: number): NakFlyweight;
    public length(length?: number): number | NakFlyweight {
        if (undefined === length) {
            return this.getInt(NakFlyweight.LENGTH_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(NakFlyweight.LENGTH_FIELD_OFFSET, length, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Check if the NAK frame is valid given the `termLength`.
     *
     * @param termLength to check against.
     * @return `true` if valid.
     */
    public isValid(termLength: number): boolean {
        const termOffset = this.termOffset();
        const length = this.length();
        return (
            termOffset >= 0 &&
            termOffset < termLength &&
            FrameDescriptor.isFrameAligned(termOffset) &&
            length >= 0 &&
            termOffset + length <= termLength
        );
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'NAK{' +
            'frame-length=' +
            this.frameLength() +
            ' version=' +
            this.version() +
            ' flags=' +
            HeaderFlyweight.flagsToChars(this.flags()).join('') +
            ' type=' +
            this.headerType() +
            ' term-offset=' +
            this.termOffset() +
            ' session-id=' +
            this.sessionId() +
            ' stream-id=' +
            this.streamId() +
            ' term-id=' +
            this.termId() +
            ' length=' +
            this.length() +
            '}'
        );
    }
}
