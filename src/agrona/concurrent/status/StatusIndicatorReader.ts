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
// Port of org/agrona/concurrent/status/StatusIndicatorReader.java @ Agrona 2.6.1
/**
 * Reads the value of a counter to indicate current status and what abstraction should be taken.
 * <p>
 * Values are {@code number}s holding a Java {@code long} (spec D5).
 *
 * @see CountersReader
 */
export abstract class StatusIndicatorReader {
    /**
     * Identifier for this status indicator.
     *
     * @return the identifier for this status indicator.
     */
    public abstract id(): number;

    /**
     * Get the current status indication of a component with volatile semantics.
     *
     * @return the current status indication of a component.
     */
    public abstract getVolatile(): number;

    /**
     * Get the current status indication of a component with acquire semantics.
     *
     * @return the current status indication of a component.
     */
    public abstract getAcquire(): number;

    /**
     * Get the current status indication of a component with opaque semantics.
     *
     * @return the current status indication of a component.
     */
    public abstract getOpaque(): number;
}
