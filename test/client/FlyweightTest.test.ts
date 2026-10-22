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
// Port of io/aeron/FlyweightTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { PublicationMessageFlyweight } from '../../src/client/command/PublicationMessageFlyweight.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../src/client/protocol/NakFlyweight.js';

describe('Flyweight', () => {
    // JUnit creates a new test instance per test, so the fields are rebuilt before each one.
    // ByteBuffer.allocate(512): the ArrayBuffer, read back as signed bytes like ByteBuffer.get
    let buffer: Int8Array;
    let aBuff: UnsafeBuffer;
    let encodeHeader: HeaderFlyweight;
    let decodeHeader: HeaderFlyweight;
    let encodeDataHeader: DataHeaderFlyweight;
    let decodeDataHeader: DataHeaderFlyweight;
    let encodeNakHeader: NakFlyweight;
    let decodeNakHeader: NakFlyweight;
    let encodePublication: PublicationMessageFlyweight;
    let decodePublication: PublicationMessageFlyweight;

    beforeEach(() => {
        const arrayBuffer = new ArrayBuffer(512);
        buffer = new Int8Array(arrayBuffer);

        aBuff = new UnsafeBuffer(arrayBuffer);
        encodeHeader = new HeaderFlyweight();
        decodeHeader = new HeaderFlyweight();
        encodeDataHeader = new DataHeaderFlyweight();
        decodeDataHeader = new DataHeaderFlyweight();
        encodeNakHeader = new NakFlyweight();
        decodeNakHeader = new NakFlyweight();
        encodePublication = new PublicationMessageFlyweight();
        decodePublication = new PublicationMessageFlyweight();
    });

    it('shouldWriteCorrectValuesForGenericHeaderFields', () => {
        encodeHeader.wrap(aBuff);

        encodeHeader.version(1);
        encodeHeader.flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        encodeHeader.headerType(HeaderFlyweight.HDR_TYPE_DATA);
        encodeHeader.frameLength(8);

        // little endian
        expect(buffer[0]).toBe(0x08);
        expect(buffer[1]).toBe(0x00);
        expect(buffer[2]).toBe(0x00);
        expect(buffer[3]).toBe(0x00);
        expect(buffer[4]).toBe(0x01);
        expect(buffer[5]).toBe((0xc0 << 24) >> 24);
        expect(buffer[6]).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(buffer[7]).toBe(0x00);
    });

    it('shouldReadWhatIsWrittenToGenericHeaderFields', () => {
        encodeHeader.wrap(aBuff);

        encodeHeader.version(1);
        encodeHeader.flags(0);
        encodeHeader.headerType(HeaderFlyweight.HDR_TYPE_DATA);
        encodeHeader.frameLength(8);

        decodeHeader.wrap(aBuff);
        expect(decodeHeader.version()).toBe(1);
        expect(decodeHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(decodeHeader.frameLength()).toBe(8);
    });

    it('shouldWriteAndReadMultipleFramesCorrectly', () => {
        encodeHeader.wrap(aBuff);

        encodeHeader.version(1);
        encodeHeader.flags(0);
        encodeHeader.headerType(HeaderFlyweight.HDR_TYPE_DATA);
        encodeHeader.frameLength(8);

        encodeHeader.wrap(aBuff, 8, aBuff.capacity() - 8);
        encodeHeader.version(2);
        encodeHeader.flags(0x01);
        encodeHeader.headerType(HeaderFlyweight.HDR_TYPE_SM);
        encodeHeader.frameLength(8);

        decodeHeader.wrap(aBuff);
        expect(decodeHeader.version()).toBe(1);
        expect(decodeHeader.flags()).toBe(0);
        expect(decodeHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(decodeHeader.frameLength()).toBe(8);

        decodeHeader.wrap(aBuff, 8, aBuff.capacity() - 8);
        expect(decodeHeader.version()).toBe(2);
        expect(decodeHeader.flags()).toBe(0x01);
        expect(decodeHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SM);
        expect(decodeHeader.frameLength()).toBe(8);
    });

    it('shouldReadAndWriteDataHeaderCorrectly', () => {
        encodeDataHeader.wrap(aBuff);

        encodeDataHeader.version(1);
        encodeDataHeader.flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        encodeDataHeader.headerType(HeaderFlyweight.HDR_TYPE_DATA);
        encodeDataHeader.frameLength(DataHeaderFlyweight.HEADER_LENGTH);
        encodeDataHeader.sessionId(0xdeadbeef | 0);
        encodeDataHeader.streamId(0x44332211);
        encodeDataHeader.termId(0x99887766 | 0);

        decodeDataHeader.wrap(aBuff);
        expect(decodeDataHeader.version()).toBe(1);
        expect(decodeDataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(decodeDataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(decodeDataHeader.frameLength()).toBe(DataHeaderFlyweight.HEADER_LENGTH);
        expect(decodeDataHeader.sessionId()).toBe(0xdeadbeef | 0);
        expect(decodeDataHeader.streamId()).toBe(0x44332211);
        expect(decodeDataHeader.termId()).toBe(0x99887766 | 0);
        expect(decodeDataHeader.dataOffset()).toBe(DataHeaderFlyweight.HEADER_LENGTH);
    });

    it('shouldEncodeAndDecodeNakCorrectly', () => {
        encodeNakHeader.wrap(aBuff);
        encodeNakHeader.version(1);
        encodeNakHeader.flags(0);
        encodeNakHeader.headerType(HeaderFlyweight.HDR_TYPE_NAK);
        encodeNakHeader.frameLength(NakFlyweight.HEADER_LENGTH);
        encodeNakHeader.sessionId(0xdeadbeef | 0);
        encodeNakHeader.streamId(0x44332211);
        encodeNakHeader.termId(0x99887766 | 0);
        encodeNakHeader.termOffset(0x22334);
        encodeNakHeader.length(512);

        decodeNakHeader.wrap(aBuff);
        expect(decodeNakHeader.version()).toBe(1);
        expect(decodeNakHeader.flags()).toBe(0);
        expect(decodeNakHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_NAK);
        expect(decodeNakHeader.frameLength()).toBe(NakFlyweight.HEADER_LENGTH);
        expect(decodeNakHeader.sessionId()).toBe(0xdeadbeef | 0);
        expect(decodeNakHeader.streamId()).toBe(0x44332211);
        expect(decodeNakHeader.termId()).toBe(0x99887766 | 0);
        expect(decodeNakHeader.termOffset()).toBe(0x22334);
        expect(decodeNakHeader.length()).toBe(512);
    });

    it('shouldEncodeAndDecodeChannelsCorrectly', () => {
        encodePublication.wrap(aBuff, 0);

        const channel = 'aeron:udp?endpoint=localhost:4000';
        encodePublication.channel(channel);

        decodePublication.wrap(aBuff, 0);

        expect(decodePublication.channel()).toBe(channel);
    });
});
