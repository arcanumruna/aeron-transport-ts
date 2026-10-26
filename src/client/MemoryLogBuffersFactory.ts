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
// Port of io/aeron/MappedLogBuffersFactory.java @ 1.53.3 (spec D91: the logs are in memory)
import { LogBuffers, type LogLookup } from './LogBuffers.js';
import type { LogBuffersFactory } from './LogBuffersFactory.js';

/**
 * The {@link LogBuffersFactory} over the logs of an in-memory driver: the {@link LogBuffers} of a name that the
 * driver sent (spec D4, D91). Replaces `MappedLogBuffersFactory`, which maps the file of the log.
 */
export class MemoryLogBuffersFactory implements LogBuffersFactory {
    private readonly logs: LogLookup;

    /**
     * @param logs to find the logs in: the `logFactory()` of the driver's context.
     */
    public constructor(logs: LogLookup) {
        this.logs = logs;
    }

    public map(logFileName: string): LogBuffers {
        return new LogBuffers(logFileName, this.logs);
    }
}
