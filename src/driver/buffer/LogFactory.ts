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
// Port of io/aeron/driver/buffer/LogFactory.java @ 1.53.3
import type { AutoCloseable } from '../../agrona/jdkLang.js';
import type { RawLog } from './RawLog.js';

/**
 * Factory for creating the log buffers of publications and images. The correlation id is a `number` (a registration
 * id, spec 5.2).
 */
export interface LogFactory extends AutoCloseable {
    /**
     * {@inheritDoc}
     */
    close(): void;

    /**
     * Create a new {@link RawLog} for a publication.
     *
     * @param correlationId    which is the original registration id for a publication.
     * @param termBufferLength length of the buffer for each term.
     * @param useSparseFiles   should the file be sparse so the pages are only allocated as required.
     * @return the newly created {@link RawLog}
     */
    newPublication(correlationId: number, termBufferLength: number, useSparseFiles: boolean): RawLog;

    /**
     * Create a new {@link RawLog} for an image of a publication.
     *
     * @param correlationId    assigned to uniquely identify an image on a driver.
     * @param termBufferLength length of the buffer for each term.
     * @param useSparseFiles   should the file be sparse so the pages are only allocated as required.
     * @return the newly created {@link RawLog}
     */
    newImage(correlationId: number, termBufferLength: number, useSparseFiles: boolean): RawLog;
}
