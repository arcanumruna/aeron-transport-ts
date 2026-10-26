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
// Port of io/aeron/driver/buffer/TestLogFactory.java @ 1.53.3 (a test class of aeron-driver). The log buffers are
// plain `ArrayBuffer`s (Java: direct byte buffers), so the term buffers use the plain accesses of spec D16.
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { LogFactory } from '../../src/driver/buffer/LogFactory.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';

const { LOG_META_DATA_LENGTH } = LogBufferDescriptor;

export class TestLogFactory implements LogFactory {
    public close(): void {}

    public newPublication(_correlationId: number, termBufferLength: number, _useSparseFiles: boolean): RawLog {
        return TestLogFactory.newLogBuffers(termBufferLength);
    }

    public newImage(_correlationId: number, termBufferLength: number, _useSparseFiles: boolean): RawLog {
        return TestLogFactory.newLogBuffers(termBufferLength);
    }

    public static newLogBuffers(termLength: number): RawLog {
        const termBuffers: UnsafeBuffer[] = [
            TestLogFactory.newLogBuffer(termLength),
            TestLogFactory.newLogBuffer(termLength),
            TestLogFactory.newLogBuffer(termLength),
        ];
        const logMetaData = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));

        return {
            termLength: () => (termBuffers[0] as UnsafeBuffer).capacity(),
            termBuffers: () => termBuffers,
            metaData: () => logMetaData,
            fileName: () => 'stream.log',
            free: () => true,
            close: () => {},
        };
    }

    private static newLogBuffer(termBufferLength: number): UnsafeBuffer {
        return new UnsafeBuffer(new ArrayBuffer(termBufferLength));
    }
}
