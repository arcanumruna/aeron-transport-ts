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
// Port of io/aeron/protocol/RttMeasurementFlyweight.java @ 1.53.3
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Long } from '../../agrona/jdk.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Flyweight for an RTT Measurement Frame Header.
 * <p>
 * <a target="_blank"
 *    href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification#rtt-measurement-header">
 * RTT Measurement Frame Header</a> wiki page.
 */
export class RttMeasurementFlyweight extends HeaderFlyweight {
    /**
     * Flag set to indicate this is a reply message.
     */
    public static readonly REPLY_FLAG = 0x80;

    /**
     * Length of the header of the frame.
     */
    public static readonly HEADER_LENGTH = 40;

    /**
     * Offset in the frame at which the session-id field begins.
     */
    private static readonly SESSION_ID_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the stream-id field begins.
     */
    private static readonly STREAM_ID_FIELD_OFFSET = 12;

    /**
     * Offset in the frame at which the echo timestamp field begins.
     */
    private static readonly ECHO_TIMESTAMP_FIELD_OFFSET = 16;

    /**
     * Offset in the frame at which the reception delta field begins.
     */
    private static readonly RECEPTION_DELTA_FIELD_OFFSET = 24;

    /**
     * Offset in the frame at which the receiver-id field begins.
     */
    private static readonly RECEIVER_ID_FIELD_OFFSET = 32;

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
     * return session-id field.
     *
     * @return session-id field.
     */
    public sessionId(): number;
    /**
     * set session-id field.
     *
     * @param sessionId field value.
     * @return flyweight.
     */
    public sessionId(sessionId: number): RttMeasurementFlyweight;
    public sessionId(sessionId?: number): number | RttMeasurementFlyweight {
        if (undefined === sessionId) {
            return this.getInt(RttMeasurementFlyweight.SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(RttMeasurementFlyweight.SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * return stream-id field.
     *
     * @return stream-id field.
     */
    public streamId(): number;
    /**
     * set stream-id field.
     *
     * @param streamId field value.
     * @return flyweight.
     */
    public streamId(streamId: number): RttMeasurementFlyweight;
    public streamId(streamId?: number): number | RttMeasurementFlyweight {
        if (undefined === streamId) {
            return this.getInt(RttMeasurementFlyweight.STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(RttMeasurementFlyweight.STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

        return this;
    }

    /**
     * return echo timestamp field in nanoseconds. An opaque 64-bit wire value, a `bigint` (spec 5.2).
     *
     * @return echo timestamp field.
     */
    public echoTimestampNs(): bigint;
    /**
     * set echo timestamp field in nanoseconds.
     *
     * @param timestampNs field value.
     * @return flyweight.
     */
    public echoTimestampNs(timestampNs: bigint): RttMeasurementFlyweight;
    public echoTimestampNs(timestampNs?: bigint): bigint | RttMeasurementFlyweight {
        if (undefined === timestampNs) {
            return this.getLongBigInt(RttMeasurementFlyweight.ECHO_TIMESTAMP_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putLongBigInt(
            RttMeasurementFlyweight.ECHO_TIMESTAMP_FIELD_OFFSET,
            Long.checkInt64(timestampNs),
            LITTLE_ENDIAN,
        );

        return this;
    }

    /**
     * return reception delta field in nanoseconds. An opaque 64-bit wire value, a `bigint` (spec 5.2).
     *
     * @return reception delta field.
     */
    public receptionDelta(): bigint;
    /**
     * set reception delta field in nanoseconds.
     *
     * @param deltaNs field value.
     * @return flyweight.
     */
    public receptionDelta(deltaNs: bigint): RttMeasurementFlyweight;
    public receptionDelta(deltaNs?: bigint): bigint | RttMeasurementFlyweight {
        if (undefined === deltaNs) {
            return this.getLongBigInt(RttMeasurementFlyweight.RECEPTION_DELTA_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putLongBigInt(
            RttMeasurementFlyweight.RECEPTION_DELTA_FIELD_OFFSET,
            Long.checkInt64(deltaNs),
            LITTLE_ENDIAN,
        );

        return this;
    }

    /**
     * return receiver-id field. An opaque 64-bit wire value, a `bigint` (spec 5.2).
     *
     * @return receiver-id field.
     */
    public receiverId(): bigint;
    /**
     * set receiver-id field.
     *
     * @param id field value.
     * @return flyweight.
     */
    public receiverId(id: bigint): RttMeasurementFlyweight;
    public receiverId(id?: bigint): bigint | RttMeasurementFlyweight {
        if (undefined === id) {
            return this.getLongBigInt(RttMeasurementFlyweight.RECEIVER_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putLongBigInt(RttMeasurementFlyweight.RECEIVER_ID_FIELD_OFFSET, Long.checkInt64(id), LITTLE_ENDIAN);

        return this;
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'RTTM{' +
            'frame-length=' +
            this.frameLength() +
            ' version=' +
            this.version() +
            ' flags=' +
            HeaderFlyweight.flagsToChars(this.flags()).join('') +
            ' type=' +
            this.headerType() +
            ' session-id=' +
            this.sessionId() +
            ' stream-id=' +
            this.streamId() +
            ' echo-timestamp=' +
            this.echoTimestampNs() +
            ' reception-delta=' +
            this.receptionDelta() +
            ' receiver-id=' +
            this.receiverId() +
            '}'
        );
    }
}
