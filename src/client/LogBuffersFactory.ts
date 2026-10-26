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
// Port of io/aeron/LogBuffersFactory.java @ 1.53.3
import type { LogBuffers } from './LogBuffers.js';

/**
 * Interface for encapsulating the strategy of mapping {@link LogBuffers} at a giving file location. The logs are in
 * memory (spec D4), so a "file location" is the name of a log (spec D91).
 */
export interface LogBuffersFactory {
    /**
     * Find a log in memory and wrap each section with an {@link UnsafeBuffer}.
     *
     * @param logFileName of the log, as the driver sent it.
     * @return a representation of the log buffer.
     */
    map(logFileName: string): LogBuffers;
}
