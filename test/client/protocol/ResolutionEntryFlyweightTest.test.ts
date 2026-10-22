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
// Port of io/aeron/protocol/ResolutionEntryFlyweightTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { type Appendable, ByteOrder } from '../../../src/agrona/jdk.js';
import { ResolutionEntryFlyweight } from '../../../src/client/protocol/ResolutionEntryFlyweight.js';

const {
    MAX_NAME_LENGTH,
    MIN_IPV4_FRAME_LENGTH,
    MIN_IPV6_FRAME_LENGTH,
    NAME_FIELD_OFFSET_IP4,
    NAME_FIELD_OFFSET_IP6,
    RES_TYPE_NAME_TO_IP4_MD,
    RES_TYPE_NAME_TO_IP6_MD,
} = ResolutionEntryFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;

/** `name.getBytes(US_ASCII)` */
function usAscii(name: string): Uint8Array {
    return Uint8Array.from(name, (c) => c.charCodeAt(0));
}

/** Stand-in for `java.lang.StringBuilder`, the only `Appendable` the test uses. */
class StringBuilder implements Appendable {
    private text = '';

    public append(c: string): StringBuilder {
        this.text += c;
        return this;
    }

    public toString(): string {
        return this.text;
    }
}

describe('ResolutionEntryFlyweight', () => {
    it.each([0, 1, MIN_IPV4_FRAME_LENGTH - 1])('shouldMarkAsInvalidIfInsufficientCapacity %d', (capacity) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(capacity)));
        expect(entry.isValid()).toBe(false);
    });

    it.each([-1, 5, 127, -128])('shouldMarkAsInvalidIfResTypeIsInvalid %d', (resType) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV4_FRAME_LENGTH)));
        entry.resType(resType);
        expect(entry.isValid()).toBe(false);
    });

    it('shouldMarkAsInvalidIfCapacityIsTooSmallIPv6', () => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH - 1)));
        entry.resType(RES_TYPE_NAME_TO_IP6_MD);
        expect(entry.isValid()).toBe(false);
    });

    it.each([-32768, -3, 0])('shouldMarkAsInvalidIfNameLengthIsInvalidIPv4 %d', (nameLength) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV4_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP4, nameLength, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it.each([32767, MAX_NAME_LENGTH + 1])('shouldMarkAsInvalidIfNameLengthIsTooLongIPv4 %d', (nameLength) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV4_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP4, nameLength, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it('shouldMarkAsInvalidIfNameLengthIsBeyondBufferCapacityIPv4', () => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV4_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP4, 5, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it.each([-32768, -3, 0])('shouldMarkAsInvalidIfNameLengthIsInvalidIPv6 %d', (nameLength) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP6, nameLength, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it.each([32767, MAX_NAME_LENGTH + 1])('shouldMarkAsInvalidIfNameLengthIsTooLongIPv6 %d', (nameLength) => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP6, nameLength, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it('shouldMarkAsInvalidIfNameLengthIsBeyondBufferCapacityIPv6', () => {
        const entry = new ResolutionEntryFlyweight(new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH)));
        entry.putShort(NAME_FIELD_OFFSET_IP6, 5, LITTLE_ENDIAN);
        expect(entry.isValid()).toBe(false);
    });

    it.each([RES_TYPE_NAME_TO_IP4_MD, RES_TYPE_NAME_TO_IP6_MD])('shouldRecognizeValidEntry %d', (resType) => {
        const name = 'test name';
        const entry = new ResolutionEntryFlyweight(
            new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH + name.length)),
        );
        const nameBytes = usAscii(name);
        entry.resType(resType).putName(nameBytes);

        expect(entry.isValid()).toBe(true);
        const actualBytes = new Uint8Array(nameBytes.length);
        entry.getName(actualBytes);
        expect(actualBytes).toEqual(nameBytes);
    });

    it('shouldFormatEntry', () => {
        const name = 'test name';
        const entry = new ResolutionEntryFlyweight(
            new UnsafeBuffer(new Uint8Array(MIN_IPV6_FRAME_LENGTH + name.length)),
        );
        entry.resType(RES_TYPE_NAME_TO_IP6_MD).putName(usAscii(name));
        const address = Uint8Array.of(
            0xfe,
            0x80,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x54,
            0xd3,
            0x41,
            0x22,
            0xe7,
            0x38,
            0xa8,
            0x62,
        );
        entry.putAddress(address);

        const sb = new StringBuilder();
        entry.appendAddress(sb);
        expect(sb.toString()).toBe('[fe80::54d3:4122:e738:a862]');
    });
});
