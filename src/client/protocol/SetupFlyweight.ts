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
// Port of io/aeron/protocol/SetupFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { DataHeaderFlyweight } from './DataHeaderFlyweight.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;

// LogBufferDescriptor.TERM_MAX_LENGTH and TERM_MIN_LENGTH and FrameDescriptor.isFrameAligned: both classes are ported in
// T9, which replaces these with theirs.
const TERM_MAX_LENGTH = 1024 * 1024 * 1024;
const TERM_MIN_LENGTH = 64 * 1024;
const FRAME_ALIGNMENT = 32;

function isFrameAligned(value: number): boolean {
    return 0 === (value & (FRAME_ALIGNMENT - 1));
}

/**
 * HeaderFlyweight for Setup Message Frames.
 * <p>
 * <a target="_blank" href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#stream-setup">
 * Stream Setup</a> wiki page.
 */
export class SetupFlyweight extends HeaderFlyweight {
    /**
     * Length of the Setup Message Frame.
     */
    public static readonly HEADER_LENGTH = 40;

    /**
     * Subscriber should send response channel setup message.
     */
    public static readonly SEND_RESPONSE_SETUP_FLAG = 0x80;

    /**
     * Publication uses group/multicast semantics.
     */
    public static readonly GROUP_FLAG = 0x40;

    /**
     * Offset in the frame at which the term-offset field begins.
     */
    private static readonly TERM_OFFSET_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    private static readonly SESSION_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    private static readonly STREAM_ID_FIELD_OFFSET = 16;

    /**
     * Offset in the frame at which the initial-term-id field begins.
     */
    private static readonly INITIAL_TERM_ID_FIELD_OFFSET = 20;

    /**
     * Offset in the frame at which the active-term-id field begins.
     */
    private static readonly ACTIVE_TERM_ID_FIELD_OFFSET = 24;

    /**
     * Offset in the frame at which the term-length field begins.
     */
    private static readonly TERM_LENGTH_FIELD_OFFSET = 28;

    /**
     * Offset in the frame at which the mtu-length field begins.
     */
    private static readonly MTU_LENGTH_FIELD_OFFSET = 32;

    /**
     * Offset in the frame at which the multicast TTL (Time To Live) field begins.
     */
    private static readonly TTL_FIELD_OFFSET = 36;

    public static readonly MAX_UDP_PAYLOAD_LENGTH = 65504;

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
     * Get term offset field.
     *
     * @return term offset field.
     */
    public termOffset(): number;
    /**
     * Set term offset field.
     *
     * @param termOffset field value.
     * @return this for a fluent API.
     */
    public termOffset(termOffset: number): SetupFlyweight;
    public termOffset(termOffset?: number): number | SetupFlyweight {
        if (undefined === termOffset) {
            return this.getInt(SetupFlyweight.TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.TERM_OFFSET_FIELD_OFFSET, termOffset, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get session id field.
     *
     * @return session id field.
     */
    public sessionId(): number;
    /**
     * Set session id field.
     *
     * @param sessionId field value.
     * @return this for a fluent API.
     */
    public sessionId(sessionId: number): SetupFlyweight;
    public sessionId(sessionId?: number): number | SetupFlyweight {
        if (undefined === sessionId) {
            return this.getInt(SetupFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get stream id field.
     *
     * @return stream id field.
     */
    public streamId(): number;
    /**
     * Set stream id field.
     *
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public streamId(streamId: number): SetupFlyweight;
    public streamId(streamId?: number): number | SetupFlyweight {
        if (undefined === streamId) {
            return this.getInt(SetupFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get initial term id field.
     *
     * @return initial term id field.
     */
    public initialTermId(): number;
    /**
     * Set initial term id field.
     *
     * @param termId field value.
     * @return this for a fluent API.
     */
    public initialTermId(termId: number): SetupFlyweight;
    public initialTermId(termId?: number): number | SetupFlyweight {
        if (undefined === termId) {
            return this.getInt(SetupFlyweight.INITIAL_TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.INITIAL_TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get active term id field.
     *
     * @return term id field.
     */
    public activeTermId(): number;
    /**
     * Set active term id field.
     *
     * @param termId field value.
     * @return this for a fluent API.
     */
    public activeTermId(termId: number): SetupFlyweight;
    public activeTermId(termId?: number): number | SetupFlyweight {
        if (undefined === termId) {
            return this.getInt(SetupFlyweight.ACTIVE_TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.ACTIVE_TERM_ID_FIELD_OFFSET, termId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get term length field.
     *
     * @return term length field value.
     */
    public termLength(): number;
    /**
     * Set term length field.
     *
     * @param termLength field value.
     * @return this for a fluent API.
     */
    public termLength(termLength: number): SetupFlyweight;
    public termLength(termLength?: number): number | SetupFlyweight {
        if (undefined === termLength) {
            return this.getInt(SetupFlyweight.TERM_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.TERM_LENGTH_FIELD_OFFSET, termLength, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get MTU length field.
     *
     * @return MTU length field value.
     */
    public mtuLength(): number;
    /**
     * Set MTU length field.
     *
     * @param mtuLength field value.
     * @return this for a fluent API.
     */
    public mtuLength(mtuLength: number): SetupFlyweight;
    public mtuLength(mtuLength?: number): number | SetupFlyweight {
        if (undefined === mtuLength) {
            return this.getInt(SetupFlyweight.MTU_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.MTU_LENGTH_FIELD_OFFSET, mtuLength, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get the TTL field.
     *
     * @return TTL field value.
     */
    public ttl(): number;
    /**
     * Set the TTL field.
     *
     * @param ttl field value.
     * @return this for a fluent API.
     */
    public ttl(ttl: number): SetupFlyweight;
    public ttl(ttl?: number): number | SetupFlyweight {
        if (undefined === ttl) {
            return this.getInt(SetupFlyweight.TTL_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(SetupFlyweight.TTL_FIELD_OFFSET, ttl, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Check if the setup frame is properly formed.
     *
     * @return `true` if valid.
     */
    public isValid(): boolean {
        const termOffset = this.termOffset();
        const termLength = this.termLength();
        const mtuLength = this.mtuLength();
        return (
            termLength >= TERM_MIN_LENGTH &&
            termLength <= TERM_MAX_LENGTH &&
            BitUtil.isPowerOfTwo(termLength) &&
            termOffset >= 0 &&
            termOffset < termLength &&
            isFrameAligned(termOffset) &&
            mtuLength >= DataHeaderFlyweight.HEADER_LENGTH &&
            mtuLength <= SetupFlyweight.MAX_UDP_PAYLOAD_LENGTH &&
            isFrameAligned(mtuLength)
        );
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'SETUP{' +
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
            ' initial-term-id=' +
            this.initialTermId() +
            ' active-term-id=' +
            this.activeTermId() +
            ' term-length=' +
            this.termLength() +
            ' mtu-length=' +
            this.mtuLength() +
            ' ttl=' +
            this.ttl() +
            '}'
        );
    }
}
