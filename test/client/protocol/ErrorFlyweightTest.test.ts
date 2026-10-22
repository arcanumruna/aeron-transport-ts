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
// Port of io/aeron/protocol/ErrorFlyweightTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';

const {
    ERROR_STRING_FIELD_OFFSET,
    HAS_GROUP_ID_FLAG,
    HEADER_LENGTH,
    MAX_ERROR_FRAME_LENGTH,
    MAX_ERROR_MESSAGE_LENGTH,
} = ErrorFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;

/** `Tests.generateStringWithSuffix` of aeron-test-support. */
function generateStringWithSuffix(prefix: string, suffix: string, suffixRepeatCount: number): string {
    return prefix + suffix.repeat(suffixRepeatCount);
}

describe('ErrorFlyweight', () => {
    // JUnit creates a new test instance per test, so the field is rebuilt before each one; `allocate` is an ArrayBuffer
    let errorFlyweight: ErrorFlyweight;

    beforeEach(() => {
        errorFlyweight = new ErrorFlyweight(new ArrayBuffer(MAX_ERROR_FRAME_LENGTH));
    });

    it('shouldCorrectlySetFlagsForGroupTag', () => {
        expect(errorFlyweight.flags()).toBe(0);
        errorFlyweight.groupTag(10n);
        expect(errorFlyweight.flags()).toBe(HAS_GROUP_ID_FLAG);

        errorFlyweight.groupTag(null);
        expect(errorFlyweight.flags()).not.toBe(HAS_GROUP_ID_FLAG);
    });

    it('shouldCorrectlyUpdateExistingFlagsForGroupTag', () => {
        const initialFlags = 0x3;

        errorFlyweight.flags(initialFlags);
        expect(errorFlyweight.flags()).toBe(initialFlags);
        errorFlyweight.groupTag(10n);
        expect(HAS_GROUP_ID_FLAG & errorFlyweight.flags()).toBe(HAS_GROUP_ID_FLAG);
        expect(initialFlags & errorFlyweight.flags()).toBe(initialFlags);

        errorFlyweight.groupTag(null);
        expect(HAS_GROUP_ID_FLAG & errorFlyweight.flags()).toBe(0);
        expect(errorFlyweight.flags()).toBe(initialFlags);
    });

    // @NullAndEmptySource
    it.each([null, ''])('shouldStoreEmptyErrorMessageAsZeroLengthBytes %j', (errorMessage) => {
        errorFlyweight.putInt(ERROR_STRING_FIELD_OFFSET, 1024, LITTLE_ENDIAN);

        errorFlyweight.errorMessage(errorMessage);

        expect(errorFlyweight.getInt(ERROR_STRING_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(0);
        expect(errorFlyweight.errorMessage()).toBe('');
        expect(errorFlyweight.frameLength()).toBe(HEADER_LENGTH);
    });

    it.each(['abc', 'xyzDEFEFJLF'])('shouldStoreErrorMessageAsIs %s', (errorMessage) => {
        errorFlyweight.putInt(ERROR_STRING_FIELD_OFFSET, -5, LITTLE_ENDIAN);

        errorFlyweight.errorMessage(errorMessage);

        expect(errorFlyweight.getInt(ERROR_STRING_FIELD_OFFSET, LITTLE_ENDIAN)).toBe(errorMessage.length);
        expect(errorFlyweight.errorMessage()).toBe(errorMessage);
    });

    it('shouldTruncateErrorMessageIfTooLong', () => {
        const errorMessage = generateStringWithSuffix('error-', 'X', 2048);

        errorFlyweight.errorMessage(errorMessage);

        expect(errorFlyweight.errorMessage()).toBe(errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH));
    });

    it.each([-2147483648, -100, 3000, MAX_ERROR_MESSAGE_LENGTH + 1])(
        'shouldRejectFrameIfErrorStringLengthIsInvalid %d',
        (length) => {
            errorFlyweight.putInt(ERROR_STRING_FIELD_OFFSET, length, LITTLE_ENDIAN);

            expect(errorFlyweight.isValid()).toBe(false);
        },
    );

    it.each([1, 100])('shouldRejectFrameIfErrorStringLengthIsOutBounds %d', (length) => {
        const flyweight = new ErrorFlyweight(new UnsafeBuffer(new Uint8Array(HEADER_LENGTH)));
        flyweight.frameLength(HEADER_LENGTH);
        flyweight.putInt(ERROR_STRING_FIELD_OFFSET, length, LITTLE_ENDIAN);

        expect(flyweight.isValid()).toBe(false);
    });

    it.each([0, 1, 5, 99, 100])('shouldRecognizeValidFrame %d', (length) => {
        const flyweight = new ErrorFlyweight(new UnsafeBuffer(new Uint8Array(HEADER_LENGTH + 100)));
        flyweight.frameLength(length + HEADER_LENGTH);
        flyweight.putInt(ERROR_STRING_FIELD_OFFSET, length, LITTLE_ENDIAN);

        expect(flyweight.isValid()).toBe(true);
    });

    it('shouldAllowMaxMessageSize', () => {
        const errorMessage = generateStringWithSuffix('', 'x', MAX_ERROR_MESSAGE_LENGTH);
        expect(errorMessage.length).toBe(MAX_ERROR_MESSAGE_LENGTH);

        errorFlyweight.errorMessage(errorMessage);
        expect(errorFlyweight.errorMessage()).toBe(errorMessage);
        expect(errorFlyweight.frameLength()).toBe(MAX_ERROR_FRAME_LENGTH);

        expect(errorFlyweight.isValid()).toBe(true);
    });
});
