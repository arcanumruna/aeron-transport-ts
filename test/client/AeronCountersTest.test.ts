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
// Port of io/aeron/AeronCountersTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import type { AtomicBuffer } from '../../src/agrona/concurrent/AtomicBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, Long, NullPointerException } from '../../src/agrona/jdk.js';
import { StandardCharsets } from '../../src/agrona/jdkLang.js';
import { AeronCounters } from '../../src/client/AeronCounters.js';
import { assertThrowsExactly } from '../support/Assertions.js';

const { COUNTER_LENGTH, MAX_LABEL_LENGTH, METADATA_LENGTH, RECORD_RECLAIMED, RECORD_UNUSED, REFERENCE_ID_OFFSET } =
    CountersReader;
const { counterOffset, metaDataOffset } = CountersReader;

/** `Tests.generateStringWithSuffix` of aeron-test-support. */
function generateStringWithSuffix(prefix: string, suffix: string, suffixRepeatCount: number): string {
    return prefix + suffix.repeat(suffixRepeatCount);
}

/** `new CountersManager(new UnsafeBuffer(new byte[METADATA_LENGTH]), new UnsafeBuffer(allocateDirect(COUNTER_LENGTH)), US_ASCII)`. */
function newCountersManager(): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(METADATA_LENGTH)),
        new UnsafeBuffer(new ArrayBuffer(COUNTER_LENGTH)),
        StandardCharsets.US_ASCII,
    );
}

describe('AeronCountersTest', () => {
    it('shouldNotHaveOverlappingCounterTypeIds', () => {
        // Reflection over the public static int fields named *_TYPE_ID: the own static properties of the class.
        const fieldByTypeId = new Map<number, string>();
        const duplicates = new Map<number, string[]>();

        for (const name of Object.getOwnPropertyNames(AeronCounters)) {
            const typeId = (AeronCounters as unknown as Record<string, unknown>)[name];
            if (!name.endsWith('_TYPE_ID') || typeof typeId !== 'number') {
                continue;
            }

            const field = fieldByTypeId.get(typeId);
            if (undefined === field) {
                fieldByTypeId.set(typeId, name);
            } else {
                const duplicatesForKey = duplicates.get(typeId) ?? [];
                duplicates.set(typeId, duplicatesForKey);
                if (!duplicatesForKey.includes(name)) {
                    duplicatesForKey.push(name);
                }
                duplicatesForKey.push(field);
            }
        }

        // 190 Java fields end in _TYPE_ID; TRANSITION_MODULE_CONTROL_TOGGLE_TYPE_ID is commented out in the source
        expect(fieldByTypeId.size + duplicates.size, 'the fields were found').toBe(189);
        expect(duplicates.size, 'Duplicate typeIds: ' + JSON.stringify([...duplicates])).toBe(0);
    });

    // @Disabled in Java: it only prints the largest type id.
    it.skip('printLargestCounterId', () => {});

    it.each([
        [
            '1.42.1',
            '8165495befc07e997a7f2f7743beab9d3846b0a5',
            'version=1.42.1 commit=8165495befc07e997a7f2f7743beab9d3846b0a5',
        ],
        ['1.43.0-SNAPSHOT', 'abc', 'version=1.43.0-SNAPSHOT commit=abc'],
        ['NIL', '12345678', 'version=NIL commit=12345678'],
    ])('shouldFormatVersionInfo %s', (fullVersion, commitHash, expected) => {
        expect(AeronCounters.formatVersionInfo(fullVersion, commitHash)).toBe(expected);
    });

    it.each([
        ['xyz', '1234567890', 'version=xyz commit=1234567890'],
        ['1.43.0-SNAPSHOT', 'abc', 'version=1.43.0-SNAPSHOT commit=abc'],
    ])('shouldAppendVersionInfo %s', (fullVersion, commitHash, formatted) => {
        const expected = ' ' + formatted;
        // ExpandableArrayBuffer(32) grows on the write; it is ported by a later task, so the buffer is big enough here
        const buffer = new UnsafeBuffer(new ArrayBuffer(64));
        const offset = 5;
        buffer.setMemory(0, buffer.capacity(), 0xff);

        const length = AeronCounters.appendVersionInfo(buffer, offset, fullVersion, commitHash);

        expect(length).toBe(expected.length);
        expect(buffer.getStringWithoutLengthAscii(offset, length)).toBe(expected);
    });

    it.each([-2147483648, -1])('appendToLabelThrowsIllegalArgumentExceptionIfCounterIsNegative %d', (counterId) => {
        const exception = assertThrowsExactly(IllegalArgumentException, () =>
            AeronCounters.appendToLabel(new UnsafeBuffer(), counterId, 'test'),
        );
        expect(exception.message).toBe('counter id ' + counterId + ' is negative');
    });

    it('appendToLabelThrowsNullPointerExceptionIfBufferIsNull', () => {
        assertThrowsExactly(NullPointerException, () =>
            AeronCounters.appendToLabel(null as unknown as AtomicBuffer, 5, 'test'),
        );
    });

    it.each([1_000_000, 2147483647])(
        'appendToLabelThrowsIllegalArgumentExceptionIfCounterIsOutOfRange %d',
        (counterId) => {
            const metaDataBuffer = new UnsafeBuffer(new ArrayBuffer(METADATA_LENGTH * 3));

            const exception = assertThrowsExactly(IllegalArgumentException, () =>
                AeronCounters.appendToLabel(metaDataBuffer, counterId, 'test'),
            );
            expect(exception.message).toBe('counter id ' + counterId + ' out of range: 0 - maxCounterId=2');
        },
    );

    it.each([RECORD_UNUSED, RECORD_RECLAIMED])(
        'appendToLabelThrowsIllegalArgumentExceptionIfCounterIsInWrongState %d',
        (state) => {
            const metaDataBuffer = new UnsafeBuffer(new ArrayBuffer(METADATA_LENGTH * 2));
            const counterId = 1;
            const metaDataOffsetOfCounter = metaDataOffset(counterId);
            metaDataBuffer.putInt(metaDataOffsetOfCounter, state);

            const exception = assertThrowsExactly(IllegalArgumentException, () =>
                AeronCounters.appendToLabel(metaDataBuffer, counterId, 'test'),
            );
            expect(exception.message).toBe('counter id 1 is not allocated, state: ' + state);
        },
    );

    it('appendToLabelShouldAddSuffix', () => {
        const countersManager = newCountersManager();
        const counterId = countersManager.allocate('initial value: ');

        const length = AeronCounters.appendToLabel(countersManager.metaDataBuffer(), counterId, 'test');

        expect(length).toBe(4);
        expect(countersManager.getCounterLabel(counterId)).toBe('initial value: test');
    });

    it('appendToLabelShouldAddAPortionOfSuffixUpToTheMaxLength', () => {
        const countersManager = newCountersManager();
        const initialLabel = 'this is a test counter';
        const counterId = countersManager.allocate(initialLabel);
        const hugeSuffix = generateStringWithSuffix(' - 42', 'x', MAX_LABEL_LENGTH);

        const length = AeronCounters.appendToLabel(countersManager.metaDataBuffer(), counterId, hugeSuffix);

        expect(length).not.toBe(hugeSuffix.length);
        expect(length).toBe(MAX_LABEL_LENGTH - initialLabel.length);
        expect(countersManager.getCounterLabel(counterId)).toBe(initialLabel + hugeSuffix.substring(0, length));
    });

    it('appendToLabelIsANoOpIfThereIsNoSpaceInTheLabel', () => {
        const countersManager = newCountersManager();
        const label = generateStringWithSuffix('', 'a', MAX_LABEL_LENGTH);
        const counterId = countersManager.allocate(label);

        const length = AeronCounters.appendToLabel(countersManager.metaDataBuffer(), counterId, 'test');

        expect(length).toBe(0);
        expect(countersManager.getCounterLabel(counterId)).toBe(label);
    });

    it('setReferenceIdShouldThrowNullPointerExceptionIfMetadataBufferIsNull', () => {
        assertThrowsExactly(NullPointerException, () =>
            AeronCounters.setReferenceId(null as unknown as AtomicBuffer, new UnsafeBuffer(), 1, 123),
        );
    });

    it('setReferenceIdShouldThrowNullPointerExceptionIfValuesBufferIsNull', () => {
        assertThrowsExactly(NullPointerException, () =>
            AeronCounters.setReferenceId(new UnsafeBuffer(), null as unknown as AtomicBuffer, 1, 123),
        );
    });

    it('setReferenceIdShouldRejectNegativeCounterId', () => {
        const exception = assertThrowsExactly(IllegalArgumentException, () =>
            AeronCounters.setReferenceId(new UnsafeBuffer(), new UnsafeBuffer(), -4, 123),
        );
        expect(exception.message).toBe('counter id -4 is negative');
    });

    it('setReferenceIdShouldRejectNegativeCounterIdWhichIsOutOfRange', () => {
        const exception = assertThrowsExactly(IllegalArgumentException, () =>
            AeronCounters.setReferenceId(
                new UnsafeBuffer(new ArrayBuffer(2 * METADATA_LENGTH)),
                new UnsafeBuffer(),
                42,
                777,
            ),
        );
        expect(exception.message).toBe('counter id 42 out of range: 0 - maxCounterId=1');
    });

    it.each([Long.MIN_VALUE, 0, 54375943437284, Long.MAX_VALUE])(
        'setReferenceIdShouldSetSpecifiedValue %d',
        (referenceId) => {
            const counterId = 7;

            const metadataBuffer = new UnsafeBuffer(new ArrayBuffer((counterId + 1) * METADATA_LENGTH));
            const valuesBuffer = new UnsafeBuffer(new ArrayBuffer((counterId + 1) * COUNTER_LENGTH));

            AeronCounters.setReferenceId(metadataBuffer, valuesBuffer, counterId, referenceId);

            expect(valuesBuffer.getLong(counterOffset(counterId) + REFERENCE_ID_OFFSET)).toBe(referenceId);
        },
    );
});
