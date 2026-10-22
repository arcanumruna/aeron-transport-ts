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
// Port of io/aeron/protocol/ResolutionEntryFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { type Appendable, ByteOrder, IllegalArgumentException, IllegalStateException } from '../../agrona/jdk.js';
import { LogUtil } from '../logging/LogUtil.js';
import { HeaderFlyweight } from './HeaderFlyweight.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { SIZE_OF_LONG, SIZE_OF_SHORT, align } = BitUtil;

/**
 * Flyweight for Resolution Entry header.
 * <p>
 * <a target="_blank"
 * href="https://github.com/aeron-io/aeron/wiki/Transport-Protocol-Specification">Protocol Specification</a>
 * wiki page.
 */
export class ResolutionEntryFlyweight extends HeaderFlyweight {
    /**
     * Resolution type field flag for IPv4.
     */
    public static readonly RES_TYPE_NAME_TO_IP4_MD = 0x01;

    /**
     * Resolution type field flag for IPv6.
     */
    public static readonly RES_TYPE_NAME_TO_IP6_MD = 0x02;

    /**
     * Length of an IPv4 address in bytes.
     */
    public static readonly ADDRESS_LENGTH_IP4 = 4;

    /**
     * Length of an IPv6 address in bytes.
     */
    public static readonly ADDRESS_LENGTH_IP6 = 16;

    /**
     * (S) - Self flag.
     */
    public static readonly SELF_FLAG = 0x80;

    /**
     * Offset in the frame at which the res-type (resolution type) field begins.
     */
    public static readonly RES_TYPE_FIELD_OFFSET = 0;

    /**
     * Offset in the frame at which the res-flags field begins.
     */
    public static readonly RES_FLAGS_FIELD_OFFSET = 1;

    /**
     * Offset in the frame at which the UDP port field begins.
     */
    public static readonly UDP_PORT_FIELD_OFFSET = 2;

    /**
     * Offset in the frame at which the age field begins.
     */
    public static readonly AGE_IN_MS_FIELD_OFFSET = 4;

    /**
     * Offset in the frame at which the IP address field begins.
     */
    public static readonly ADDRESS_FIELD_OFFSET = 8;

    /**
     * Offset in the frame at which the name field being for IPv4 frame.
     */
    public static readonly NAME_FIELD_OFFSET_IP4 =
        ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET + ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4;

    /**
     * Offset in the frame at which the name field being for IPv6 frame.
     */
    public static readonly NAME_FIELD_OFFSET_IP6 =
        ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET + ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6;

    /**
     * Maximum length allowed for a name.
     */
    public static readonly MAX_NAME_LENGTH = 512;

    /**
     * Minimum length in bytes for a valid IPv4 resolution entry, i.e. without commot header and with empty name.
     */
    public static readonly MIN_IPV4_FRAME_LENGTH = ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP4 + SIZE_OF_SHORT;

    /**
     * Minimum length in bytes for a valid IPv6 resolution entry, i.e. without commot header and with empty name.
     */
    public static readonly MIN_IPV6_FRAME_LENGTH = ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP6 + SIZE_OF_SHORT;

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
     * Get the protocol type of the resolution entry, a signed `byte`.
     *
     * @return the protocol type of the resolution entry.
     * @see RES_TYPE_NAME_TO_IP4_MD
     * @see RES_TYPE_NAME_TO_IP6_MD
     */
    public resType(): number;
    /**
     * Set the protocol type of the resolution.
     *
     * @param type of the resolution entry protocol.
     * @return this for a fluent API.
     * @see RES_TYPE_NAME_TO_IP4_MD
     * @see RES_TYPE_NAME_TO_IP6_MD
     */
    public resType(type: number): ResolutionEntryFlyweight;
    public resType(type?: number): number | ResolutionEntryFlyweight {
        if (undefined === type) {
            return this.getByte(ResolutionEntryFlyweight.RES_TYPE_FIELD_OFFSET);
        }

        this.putByte(ResolutionEntryFlyweight.RES_TYPE_FIELD_OFFSET, type);
        return this;
    }

    /**
     * Get the flags for the resolution entry.
     *
     * @return the flags for the resolution entry.
     */
    public override flags(): number;
    /**
     * Set the flags for the resolution entry.
     *
     * @param flags field value.
     * @return this for a fluent API.
     * @see SELF_FLAG
     */
    public override flags(flags: number): ResolutionEntryFlyweight;
    public override flags(flags?: number): number | ResolutionEntryFlyweight {
        if (undefined === flags) {
            return this.getByte(ResolutionEntryFlyweight.RES_FLAGS_FIELD_OFFSET) & 0xff;
        }

        this.putByte(ResolutionEntryFlyweight.RES_FLAGS_FIELD_OFFSET, flags);
        return this;
    }

    /**
     * Get the UDP port of the resolver with a given name.
     *
     * @return the UDP port of the resolver with a given name.
     */
    public udpPort(): number;
    /**
     * Set the UDP port of the resolver with a given name.
     *
     * @param udpPort of the resolver with a given name.
     * @return this for a fluent API.
     */
    public udpPort(udpPort: number): ResolutionEntryFlyweight;
    public udpPort(udpPort?: number): number | ResolutionEntryFlyweight {
        if (undefined === udpPort) {
            return this.getShort(ResolutionEntryFlyweight.UDP_PORT_FIELD_OFFSET, LITTLE_ENDIAN) & 0xffff;
        }

        this.putShort(ResolutionEntryFlyweight.UDP_PORT_FIELD_OFFSET, udpPort, LITTLE_ENDIAN);
        return this;
    }

    /**
     * Get the age of the entry based on last observed activity.
     *
     * @return the age of the entry based on last observed activity.
     */
    public ageInMs(): number;
    /**
     * Set the age of the entry based on last observed activity.
     *
     * @param ageInMs of the entry based on last observed activity.
     * @return this for a fluent API.
     */
    public ageInMs(ageInMs: number): ResolutionEntryFlyweight;
    public ageInMs(ageInMs?: number): number | ResolutionEntryFlyweight {
        if (undefined === ageInMs) {
            return this.getInt(ResolutionEntryFlyweight.AGE_IN_MS_FIELD_OFFSET, LITTLE_ENDIAN);
        }

        this.putInt(ResolutionEntryFlyweight.AGE_IN_MS_FIELD_OFFSET, ageInMs, LITTLE_ENDIAN);
        return this;
    }

    /**
     * Put the address into the resolution entry. It must come after calling {@link resType}.
     *
     * @param address to be written for the resolution entry.
     * @return this for a fluent API.
     */
    public putAddress(address: Uint8Array): ResolutionEntryFlyweight {
        switch (this.resType()) {
            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD:
                if (ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4 !== address.length) {
                    throw new IllegalArgumentException('Invalid address length: ' + address.length);
                }
                this.putBytes(
                    ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET,
                    address,
                    0,
                    ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4,
                );
                break;

            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD:
                if (ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6 !== address.length) {
                    throw new IllegalArgumentException('Invalid address length: ' + address.length);
                }
                this.putBytes(
                    ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET,
                    address,
                    0,
                    ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6,
                );
                break;

            default:
                throw new IllegalStateException('unknown RES_TYPE=' + this.resType());
        }

        return this;
    }

    /**
     * Get the address for the entry by copying it into the destination buffer.
     *
     * @param dstBuffer into which the address will be copied.
     * @return length of the address copied.
     */
    public getAddress(dstBuffer: Uint8Array): number {
        switch (this.resType()) {
            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD:
                if (ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4 > dstBuffer.length) {
                    throw new IllegalArgumentException('Insufficient length: ' + dstBuffer.length);
                }
                this.getBytes(
                    ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET,
                    dstBuffer,
                    0,
                    ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4,
                );
                return ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4;

            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD:
                if (ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6 > dstBuffer.length) {
                    throw new IllegalArgumentException('Insufficient length: ' + dstBuffer.length);
                }
                this.getBytes(
                    ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET,
                    dstBuffer,
                    0,
                    ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6,
                );
                return ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6;
        }

        throw new IllegalStateException('unknown RES_TYPE=' + this.resType());
    }

    /**
     * Append the address to the provided {@link Appendable} in ASCII format.
     * <p>
     * Java wraps the body in a try / catch that rethrows the checked `IOException` of `Appendable`; `Appendable.append`
     * throws no checked exception here, so there is no wrapper.
     *
     * @param appendable to which the address will be appended.
     */
    public appendAddress(appendable: Appendable): void {
        switch (this.resType()) {
            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD: {
                const i = ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET;
                appendable
                    .append(String(this.getByte(i) & 0xff))
                    .append('.')
                    .append(String(this.getByte(i + 1) & 0xff))
                    .append('.')
                    .append(String(this.getByte(i + 2) & 0xff))
                    .append('.')
                    .append(String(this.getByte(i + 3) & 0xff));
                break;
            }

            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD: {
                LogUtil.appendIpV6Address(appendable, this, ResolutionEntryFlyweight.ADDRESS_FIELD_OFFSET);
                break;
            }

            default:
                appendable.append('unknown RES_TYPE=').append(String(this.resType()));
        }
    }

    /**
     * Put the name for the resolution entry into the frame.
     *
     * @param name for the resolution entry.
     * @return this for a fluent API.
     */
    public putName(name: Uint8Array): ResolutionEntryFlyweight {
        const nameOffset = ResolutionEntryFlyweight.nameOffset(this.resType());

        this.putShort(nameOffset, name.length, LITTLE_ENDIAN);
        this.putBytes(nameOffset + SIZE_OF_SHORT, name);
        return this;
    }

    /**
     * Get the name for the entry by copying it into the destination buffer.
     *
     * @param dstBuffer into which the name will be copied.
     * @return the number of bytes copied.
     */
    public getName(dstBuffer: Uint8Array): number {
        const nameOffset = ResolutionEntryFlyweight.nameOffset(this.resType());
        const nameLength = this.getShort(nameOffset, LITTLE_ENDIAN);
        if (nameLength > dstBuffer.length) {
            throw new IllegalArgumentException('Insufficient length: ' + dstBuffer.length);
        }

        this.getBytes(nameOffset + SIZE_OF_SHORT, dstBuffer, 0, nameLength);

        return nameLength;
    }

    /**
     * Append the name to the provided {@link Appendable} in ASCII format.
     *
     * @param appendable to which the name will be appended (a `StringBuilder` in Java).
     */
    public appendName(appendable: Appendable): void {
        const nameOffset = ResolutionEntryFlyweight.nameOffset(this.resType());
        const nameLength = this.getShort(nameOffset, LITTLE_ENDIAN);

        this.getStringWithoutLengthAscii(nameOffset + SIZE_OF_SHORT, nameLength, appendable);
    }

    /**
     * Total length of the entry in bytes.
     *
     * @return total length of the entry in bytes.
     */
    public entryLength(): number {
        const nameOffset = ResolutionEntryFlyweight.nameOffset(this.resType());

        return align(nameOffset + SIZE_OF_SHORT + this.getShort(nameOffset, LITTLE_ENDIAN), SIZE_OF_LONG);
    }

    /**
     * Check if the resolution frame is valid given the contents of the wrapped buffer.
     *
     * @return `true` if frame is valid.
     */
    public isValid(): boolean {
        const capacity = this.capacity();
        if (capacity >= ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH) {
            const resType = this.resType();
            if (ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD === resType) {
                const nameLength = this.getShort(ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP4, LITTLE_ENDIAN);
                return (
                    nameLength > 0 &&
                    nameLength <= ResolutionEntryFlyweight.MAX_NAME_LENGTH &&
                    capacity - ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH >= nameLength
                );
            } else if (
                ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD === resType &&
                capacity >= ResolutionEntryFlyweight.MIN_IPV6_FRAME_LENGTH
            ) {
                const nameLength = this.getShort(ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP6, LITTLE_ENDIAN);
                return (
                    nameLength > 0 &&
                    nameLength <= ResolutionEntryFlyweight.MAX_NAME_LENGTH &&
                    capacity - ResolutionEntryFlyweight.MIN_IPV6_FRAME_LENGTH >= nameLength
                );
            }
        }
        return false;
    }

    /**
     * Offset in the entry at which the name begins depending on resolution type.
     *
     * @param resType for the protocol family.
     * @return offset in the entry at which the name field begins.
     */
    public static nameOffset(resType: number): number {
        switch (resType) {
            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD:
                return ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP4;

            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD:
                return ResolutionEntryFlyweight.NAME_FIELD_OFFSET_IP6;
        }

        throw new IllegalStateException('unknown RES_TYPE=' + resType);
    }

    /**
     * Calculate the length required for the entry when encoded.
     *
     * @param resType    of the entry.
     * @param nameLength of the name in the entry.
     * @return the required length of the entry in bytes.
     */
    public static entryLengthRequired(resType: number, nameLength: number): number {
        return align(ResolutionEntryFlyweight.nameOffset(resType) + SIZE_OF_SHORT + nameLength, SIZE_OF_LONG);
    }

    /**
     * Get the length of the address given a resolution type.
     *
     * @param resType to lookup address length for.
     * @return the length of the address given a resolution type.
     */
    public static addressLength(resType: number): number {
        switch (resType) {
            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP4_MD:
                return ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4;

            case ResolutionEntryFlyweight.RES_TYPE_NAME_TO_IP6_MD:
                return ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6;
        }

        throw new IllegalStateException('unknown RES_TYPE=' + resType);
    }

    /**
     * Is the local address a match for binding a socket to ANY IP.
     *
     * @param address       to check which can be IPv4 or IPv6.
     * @param addressLength of the address in bytes.
     * @return true if address is an ANY match otherwise false.
     */
    public static isAnyLocalAddress(address: Uint8Array, addressLength: number): boolean {
        if (addressLength === ResolutionEntryFlyweight.ADDRESS_LENGTH_IP4) {
            return 0 === address[0] && 0 === address[1] && 0 === address[2] && 0 === address[3];
        } else if (addressLength === ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6) {
            let val = 0;

            for (let i = 0; i < ResolutionEntryFlyweight.ADDRESS_LENGTH_IP6; i++) {
                val |= address[i]!;
            }

            return 0 === val;
        }

        return false;
    }
}
