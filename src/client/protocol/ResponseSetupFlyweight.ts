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
// Port of io/aeron/protocol/ResponseSetupFlyweight.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;

/**
 * HeaderFlyweight for Response Setup Message Frames.
 * <p>
 * <a target="_blank" href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#stream-setup">
 *     Stream Response Setup</a> wiki page.
 */
export class ResponseSetupFlyweight extends HeaderFlyweight {
    /**
     * Header length in bytes.
     */
    public static readonly HEADER_LENGTH = 20;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    private static readonly SESSION_ID_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    private static readonly STREAM_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the response session-id field begins.
     */
    private static readonly RESPONSE_SESSION_ID_FIELD_OFFSET = 16;

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
    public sessionId(sessionId: number): ResponseSetupFlyweight;
    public sessionId(sessionId?: number): number | ResponseSetupFlyweight {
        if (undefined === sessionId) {
            return this.getInt(ResponseSetupFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ResponseSetupFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

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
    public streamId(streamId: number): ResponseSetupFlyweight;
    public streamId(streamId?: number): number | ResponseSetupFlyweight {
        if (undefined === streamId) {
            return this.getInt(ResponseSetupFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ResponseSetupFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Get response session id field.
     *
     * @return response session id field.
     */
    public responseSessionId(): number;
    /**
     * Set response session id field. (The Java parameter is named `streamId`.)
     *
     * @param streamId field value.
     * @return this for a fluent API.
     */
    public responseSessionId(streamId: number): ResponseSetupFlyweight;
    public responseSessionId(streamId?: number): number | ResponseSetupFlyweight {
        if (undefined === streamId) {
            return this.getInt(ResponseSetupFlyweight.RESPONSE_SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ResponseSetupFlyweight.RESPONSE_SESSION_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }
}
