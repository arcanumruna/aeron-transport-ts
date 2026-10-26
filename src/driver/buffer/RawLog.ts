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
// Port of io/aeron/driver/buffer/RawLog.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AutoCloseable } from '../../agrona/jdkLang.js';

/**
 * Raw log buffers: the three term buffers and the meta data of one stream. Java's `sliceTerms()` returns
 * `ByteBuffer`s, which the port does not have (spec D9); the sender sends from the term buffers themselves.
 */
export interface RawLog extends AutoCloseable {
    /**
     * The length of each term in bytes.
     *
     * @return the length of each term in bytes.
     */
    termLength(): number;

    /**
     * An array of term buffer partitions.
     *
     * @return an array of the term buffer partitions.
     */
    termBuffers(): UnsafeBuffer[];

    /**
     * The meta data storage for the overall log.
     *
     * @return the meta data storage for the overall log.
     */
    metaData(): UnsafeBuffer;

    /**
     * Get the name of the log: the name under which the client finds it (spec D4), where Java has the fully qualified
     * file name of the log file.
     *
     * @return the name of the log.
     */
    fileName(): string;

    /**
     * Free the buffers and unregister the log.
     *
     * @return true if successful or false if it should be reattempted.
     */
    free(): boolean;

    /**
     * Close the resource regardless of if {@link free} has succeeded or not.
     */
    close(): void;
}
