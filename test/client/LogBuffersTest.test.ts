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
// Port of io/aeron/LogBuffersTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalStateException } from '../../src/agrona/jdk.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { LogBuffers } from '../../src/client/LogBuffers.js';
import type { LogLookup } from '../../src/client/LogBuffers.js';
import { assertThrowsExactly } from '../support/Assertions.js';

const {
    LOG_META_DATA_LENGTH,
    PAGE_MAX_SIZE,
    PAGE_MIN_SIZE,
    TERM_MAX_LENGTH,
    TERM_MIN_LENGTH,
    pageSize: pageSizeOf,
    termLength: termLengthOf,
} = LogBufferDescriptor;

/**
 * Java writes `contents` to a file in a temporary directory and opens it; the logs are in memory (spec D4), so the log
 * is a fake that the lookup finds by its name, whose meta data are `contents`.
 */
function logOf(contents: UnsafeBuffer): LogLookup {
    return {
        lookup: (logName: string) =>
            'test.log' === logName ? { metaData: () => contents, termBuffers: () => [] } : null,
    };
}

describe('LogBuffersTest', () => {
    it.each([-100, 0, TERM_MIN_LENGTH >> 1, TERM_MAX_LENGTH + 1, TERM_MAX_LENGTH - 1])(
        'throwsIllegalStateExceptionIfTermLengthIsInvalid %d',
        (termLength) => {
            const buffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
            termLengthOf(buffer, termLength);

            const exception = assertThrowsExactly(
                IllegalStateException,
                () => new LogBuffers('test.log', logOf(buffer)),
            );
            expect(exception.message.startsWith('Term length')).toBe(true);
            expect(exception.message.endsWith('length=' + termLength)).toBe(true);
        },
    );

    it.each([-100, 0, PAGE_MIN_SIZE >> 1, PAGE_MAX_SIZE + 1, PAGE_MAX_SIZE - 1])(
        'throwsIllegalStateExceptionIfPageSizeIsInvalid %d',
        (pageSize) => {
            const buffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
            termLengthOf(buffer, TERM_MIN_LENGTH);
            pageSizeOf(buffer, pageSize);

            const exception = assertThrowsExactly(
                IllegalStateException,
                () => new LogBuffers('test.log', logOf(buffer)),
            );
            expect(exception.message.startsWith('Page size')).toBe(true);
            expect(exception.message.endsWith('page size=' + pageSize)).toBe(true);
        },
    );

    it('throwsIllegalStateExceptionIfLogFileSizeIsLessThanLogMetaDataLength', () => {
        const fileLength = LOG_META_DATA_LENGTH - 5;
        const buffer = new UnsafeBuffer(new ArrayBuffer(fileLength));
        termLengthOf(buffer, TERM_MIN_LENGTH);
        pageSizeOf(buffer, PAGE_MIN_SIZE);

        const exception = assertThrowsExactly(IllegalStateException, () => new LogBuffers('test.log', logOf(buffer)));
        expect(exception.message).toBe(
            'Log file length less than min length of ' + LOG_META_DATA_LENGTH + ': length=' + fileLength,
        );
    });
});
