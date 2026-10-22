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
// Port of io/aeron/logbuffer/HeaderWriterTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { HeaderWriter } from '../../../src/client/logbuffer/HeaderWriter.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';

const { SESSION_ID_FIELD_OFFSET, STREAM_ID_FIELD_OFFSET, TERM_ID_FIELD_OFFSET, TERM_OFFSET_FIELD_OFFSET } =
    DataHeaderFlyweight;
const { FLAGS_FIELD_OFFSET, FRAME_LENGTH_FIELD_OFFSET, TYPE_FIELD_OFFSET, VERSION_FIELD_OFFSET } = HeaderFlyweight;
const { BIG_ENDIAN, LITTLE_ENDIAN } = ByteOrder;

describe('HeaderWriter', () => {
    // JUnit creates a new test instance per test, so the buffers are rebuilt before each one
    let defaultHeaderBuffer: UnsafeBuffer;
    let termBuffer: UnsafeBuffer;

    beforeEach(() => {
        defaultHeaderBuffer = new UnsafeBuffer(new Uint8Array(32));
        termBuffer = new UnsafeBuffer(new Uint8Array(1024));
        defaultHeaderBuffer.byteArray().fill(0xff); // Arrays.fill(byteArray(), (byte)-1)
        termBuffer.byteArray().fill(0xff);
    });

    // @EnabledIf("littleEndian"): the port is little-endian only (see "Not ported" in docs/mapping.md)
    it.each([
        [100, 8, 5, 9, 352, -777, -1000, -33],
        [-99, -2, 7, 1, 8, 42, 3, 89],
        [123, 0, 0, 0, 0, 0, 0, 0],
        [32, 1, -128, 4, 96, 2147483647, -2147483648, -2147483648],
    ])(
        'shouldEncodeHeaderUsingLittleEndianByteOrder %d %d %d %d %d %d %d %d',
        (frameLength, version, flags, headerType, termOffset, sessionId, streamId, termId) => {
            defaultHeaderBuffer.putByte(VERSION_FIELD_OFFSET, version);
            defaultHeaderBuffer.putByte(FLAGS_FIELD_OFFSET, flags);
            defaultHeaderBuffer.putShort(TYPE_FIELD_OFFSET, headerType, LITTLE_ENDIAN);
            defaultHeaderBuffer.putInt(SESSION_ID_FIELD_OFFSET, sessionId, LITTLE_ENDIAN);
            defaultHeaderBuffer.putInt(STREAM_ID_FIELD_OFFSET, streamId, LITTLE_ENDIAN);

            const headerWriter = HeaderWriter.newInstance(defaultHeaderBuffer);
            expect(headerWriter.constructor).toBe(HeaderWriter);
            headerWriter.write(termBuffer, termOffset, frameLength, termId);

            expect(termBuffer.getInt(termOffset + FRAME_LENGTH_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(-frameLength);
            expect(termBuffer.getByte(termOffset + VERSION_FIELD_OFFSET)).toBe(version);
            expect(termBuffer.getByte(termOffset + FLAGS_FIELD_OFFSET)).toBe(flags);
            expect(termBuffer.getShort(termOffset + TYPE_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(headerType);
            expect(termBuffer.getInt(termOffset + TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(termOffset);
            expect(termBuffer.getInt(termOffset + SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(sessionId);
            expect(termBuffer.getInt(termOffset + STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(streamId);
            expect(termBuffer.getInt(termOffset + TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(termId);
        },
    );

    // @EnabledIf("bigEndian"): never enabled on a little-endian platform, which every JS engine here is
    it.skip.each([
        [100, 8, 5, 9, 352, -777, -1000, -33],
        [-99, -2, 7, 1, 8, 42, 3, 89],
        [123, 0, 0, 0, 0, 0, 0, 0],
        [32, 1, -128, 4, 96, 2147483647, -2147483648, -2147483648],
    ])(
        'shouldEncodeHeaderUsingBigEndianByteOrder %d %d %d %d %d %d %d %d',
        (frameLength, version, flags, headerType, termOffset, sessionId, streamId, termId) => {
            defaultHeaderBuffer.putByte(VERSION_FIELD_OFFSET, version);
            defaultHeaderBuffer.putByte(FLAGS_FIELD_OFFSET, flags);
            defaultHeaderBuffer.putShort(TYPE_FIELD_OFFSET, headerType, BIG_ENDIAN);
            defaultHeaderBuffer.putInt(SESSION_ID_FIELD_OFFSET, sessionId, BIG_ENDIAN);
            defaultHeaderBuffer.putInt(STREAM_ID_FIELD_OFFSET, streamId, BIG_ENDIAN);

            const headerWriter = HeaderWriter.newInstance(defaultHeaderBuffer);
            expect(headerWriter.constructor).not.toBe(HeaderWriter);
            headerWriter.write(termBuffer, termOffset, frameLength, termId);

            expect(termBuffer.getInt(termOffset + FRAME_LENGTH_FIELD_OFFSET, BIG_ENDIAN)).toBe(-frameLength);
            expect(termBuffer.getByte(termOffset + VERSION_FIELD_OFFSET)).toBe(version);
            expect(termBuffer.getByte(termOffset + FLAGS_FIELD_OFFSET)).toBe(flags);
            expect(termBuffer.getShort(termOffset + TYPE_FIELD_OFFSET, BIG_ENDIAN)).toBe(headerType);
            expect(termBuffer.getInt(termOffset + TERM_OFFSET_FIELD_OFFSET, BIG_ENDIAN)).toBe(termOffset);
            expect(termBuffer.getInt(termOffset + SESSION_ID_FIELD_OFFSET, BIG_ENDIAN)).toBe(sessionId);
            expect(termBuffer.getInt(termOffset + STREAM_ID_FIELD_OFFSET, BIG_ENDIAN)).toBe(streamId);
            expect(termBuffer.getInt(termOffset + TERM_ID_FIELD_OFFSET, BIG_ENDIAN)).toBe(termId);
        },
    );
});
