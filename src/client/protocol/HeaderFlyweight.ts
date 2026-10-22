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
// Port of io/aeron/protocol/HeaderFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { type Appendable, ByteOrder } from '../../agrona/jdk.js';

const { SIZE_OF_SHORT } = BitUtil;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Flyweight for general Aeron network protocol header of a message frame.
 * <pre>
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |R|                       Frame Length                          |
 * +---------------+---------------+-------------------------------+
 * |    Version    |     Flags     |             Type              |
 * +---------------+---------------+-------------------------------+
 * |                       Depends on Type                        ...
 * </pre>
 */
export class HeaderFlyweight extends UnsafeBuffer {
    /**
     * Header type PAD.
     */
    public static readonly HDR_TYPE_PAD = 0x00;

    /**
     * Header type DATA.
     */
    public static readonly HDR_TYPE_DATA = 0x01;

    /**
     * Header type NAK.
     */
    public static readonly HDR_TYPE_NAK = 0x02;

    /**
     * Header type SM.
     */
    public static readonly HDR_TYPE_SM = 0x03;

    /**
     * Header type ERR.
     */
    public static readonly HDR_TYPE_ERR = 0x04;

    /**
     * Header type SETUP.
     */
    public static readonly HDR_TYPE_SETUP = 0x05;

    /**
     * Header type RTT Measurement.
     */
    public static readonly HDR_TYPE_RTTM = 0x06;

    /**
     * Header type RESOLUTION.
     */
    public static readonly HDR_TYPE_RES = 0x07;

    /**
     * Header type ATS Data.
     */
    public static readonly HDR_TYPE_ATS_DATA = 0x08;

    /**
     * Header type ATS Status Message.
     */
    public static readonly HDR_TYPE_ATS_SM = 0x09;

    /**
     * Header type ATS Setup.
     */
    public static readonly HDR_TYPE_ATS_SETUP = 0x0a;

    /**
     * Header type Response Setup.
     */
    public static readonly HDR_TYPE_RSP_SETUP = 0x0b;

    /**
     * Header type EXT.
     */
    public static readonly HDR_TYPE_EXT = 0xffff;

    /**
     * Default version.
     */
    public static readonly CURRENT_VERSION = 0x0;

    /**
     * Offset in the frame at which the frame length field begins.
     */
    public static readonly FRAME_LENGTH_FIELD_OFFSET = 0;

    /**
     * Offset in the frame at which the version field begins.
     */
    public static readonly VERSION_FIELD_OFFSET = 4;

    /**
     * Offset in the frame at which the flags field begins.
     */
    public static readonly FLAGS_FIELD_OFFSET = 5;

    /**
     * Offset in the frame at which the frame type field begins.
     */
    public static readonly TYPE_FIELD_OFFSET = 6;

    /**
     * Minimum length of any Aeron frame.
     */
    public static readonly MIN_HEADER_LENGTH = HeaderFlyweight.TYPE_FIELD_OFFSET + SIZE_OF_SHORT;

    /**
     * Default constructor which can later be used to wrap a frame, or construct a flyweight which wraps a buffer over
     * the frame. The `ByteBuffer` overload of Java is an `ArrayBuffer` or a `Uint8Array` here (spec D9).
     *
     * @param buffer to wrap for the flyweight.
     */
    public constructor(buffer?: UnsafeBuffer | Uint8Array | ArrayBuffer) {
        super(buffer);
    }

    /**
     * The version field value.
     *
     * @return version field value.
     */
    public version(): number;
    /**
     * Set the version field value.
     *
     * @param version field value to be set.
     * @return this for a fluent API.
     */
    public version(version: number): HeaderFlyweight;
    public version(version?: number): number | HeaderFlyweight {
        if (undefined === version) {
            return this.getByte(HeaderFlyweight.VERSION_FIELD_OFFSET) & 0xff;
        }

        this.putByte(HeaderFlyweight.VERSION_FIELD_OFFSET, version);

        return this;
    }

    /**
     * The flags field value.
     *
     * @return the flags field value.
     */
    public flags(): number;
    /**
     * Set the flags field value.
     *
     * @param flags field value.
     * @return this for a fluent API.
     */
    public flags(flags: number): HeaderFlyweight;
    public flags(flags?: number): number | HeaderFlyweight {
        if (undefined === flags) {
            return this.getByte(HeaderFlyweight.FLAGS_FIELD_OFFSET) & 0xff;
        }

        this.putByte(HeaderFlyweight.FLAGS_FIELD_OFFSET, flags);

        return this;
    }

    /**
     * The type field value.
     *
     * @return the type field value.
     */
    public headerType(): number;
    /**
     * Set the type field value.
     *
     * @param type field value.
     * @return this for a fluent API.
     */
    public headerType(type: number): HeaderFlyweight;
    public headerType(type?: number): number | HeaderFlyweight {
        if (undefined === type) {
            return this.getShort(HeaderFlyweight.TYPE_FIELD_OFFSET, LITTLE_ENDIAN) & 0xffff;
        }

        this.putShort(HeaderFlyweight.TYPE_FIELD_OFFSET, type, LITTLE_ENDIAN);

        return this;
    }

    /**
     * The length of the frame field value.
     *
     * @return length of the frame field value.
     */
    public frameLength(): number;
    /**
     * Set the length of the frame field value.
     *
     * @param length field value.
     * @return this for a fluent API.
     */
    public frameLength(length: number): HeaderFlyweight;
    public frameLength(length?: number): number | HeaderFlyweight {
        if (undefined === length) {
            return this.getInt(HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET, length, LITTLE_ENDIAN);

        return this;
    }

    /**
     * Convert header flags to an array of chars to be human-readable. A `char[]` is an array of one-character
     * strings.
     *
     * @param flags to be converted.
     * @return header flags converted to an array of chars to be human-readable.
     */
    public static flagsToChars(flags: number): string[] {
        const chars = ['0', '0', '0', '0', '0', '0', '0', '0'];
        const length = chars.length;
        let mask = 1 << (length - 1);

        for (let i = 0; i < length; i++) {
            if ((flags & mask) === mask) {
                chars[i] = '1';
            }

            mask >>= 1;
        }

        return chars;
    }

    /**
     * Append header flags to an {@link Appendable} to be human-readable.
     *
     * @param flags      to be converted.
     * @param appendable to append flags to.
     */
    public static appendFlagsAsChars(flags: number, appendable: Appendable): void {
        const length = 8;
        let mask = 1 << (length - 1);

        for (let i = 0; i < length; i++) {
            appendable.append((flags & mask) === mask ? '1' : '0');
            mask >>= 1;
        }
    }
}
