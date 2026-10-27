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
// Port of io/aeron/LogBuffers.java @ 1.53.3
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { INSPECT_CUSTOM } from '../agrona/inspect.js';
import { IllegalStateException, Long } from '../agrona/jdk.js';
import type { AutoCloseable } from '../agrona/jdkLang.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';

const { LOG_META_DATA_LENGTH, PARTITION_COUNT, checkPageSize, checkTermLength } = LogBufferDescriptor;

/**
 * Not in Java (spec D4, D91). A log as the client sees it: the three term buffers and the meta data. The driver's
 * `RawLog` has them, so the client does not import the driver.
 */
export interface InMemoryLog {
    termBuffers(): UnsafeBuffer[];
    metaData(): UnsafeBuffer;
}

/**
 * Not in Java (spec D4, D91). Finds a log by the name that the driver sent in the response to a command: the
 * `lookup` of the driver's `MemoryLogFactory`. It answers null for a name that is unknown or freed.
 */
export interface LogLookup {
    lookup(logName: string): InMemoryLog | null;
}

/**
 * Takes a log file name and maps it into memory. The logs of this port are in memory (spec D4), so there is no file
 * to map: the sections are windows on the memory of the log that the driver made, found by name, and each
 * {@link LogBuffers} holds windows of its own, so that the driver freeing the log (it empties its own windows) does
 * not take the memory from a client that still reads it, as the unlink of a mapped file does not.
 */
export class LogBuffers implements AutoCloseable {
    private _lingerDeadlineNs: number = Long.MAX_VALUE;
    private refCount = 0;
    private readonly _termLength: number = 0;
    private readonly termBuffers: UnsafeBuffer[] = [];
    private readonly logMetaDataBuffer: UnsafeBuffer;

    /**
     * Find a log in memory and take windows on its sections.
     *
     * @param logFileName of the log.
     * @param logs        to find the log in.
     * @throws IllegalStateException if there is no such log, or its meta data is not valid.
     */
    public constructor(logFileName: string, logs: LogLookup) {
        const log = logs.lookup(logFileName);
        if (null === log) {
            throw new IllegalStateException('Log not found: ' + logFileName);
        }

        const metaData = log.metaData();
        const logLength = metaData.capacity();
        if (logLength < LOG_META_DATA_LENGTH) {
            throw new IllegalStateException(
                'Log file length less than min length of ' + LOG_META_DATA_LENGTH + ': length=' + logLength,
            );
        }

        const logMetaDataBuffer = new UnsafeBuffer(metaData, logLength - LOG_META_DATA_LENGTH, LOG_META_DATA_LENGTH);
        const termLength = LogBufferDescriptor.termLength(logMetaDataBuffer);
        const pageSize = LogBufferDescriptor.pageSize(logMetaDataBuffer);

        checkTermLength(termLength);
        checkPageSize(pageSize);

        const sourceBuffers = log.termBuffers();
        for (let i = 0; i < PARTITION_COUNT; i++) {
            this.termBuffers[i] = new UnsafeBuffer(sourceBuffers[i] as UnsafeBuffer, 0, termLength);
        }

        this._termLength = termLength;
        this.logMetaDataBuffer = logMetaDataBuffer;
    }

    /**
     * Duplicate the term buffers so a client can use them: a window on each term, as `ByteBuffer.duplicate()` is.
     *
     * @return a new window on each of the terms.
     */
    public duplicateTermBuffers(): UnsafeBuffer[] {
        const buffers: UnsafeBuffer[] = new Array<UnsafeBuffer>(PARTITION_COUNT);

        for (let i = 0; i < PARTITION_COUNT; i++) {
            buffers[i] = new UnsafeBuffer(this.termBuffers[i] as UnsafeBuffer);
        }

        return buffers;
    }

    /**
     * The meta data buffer.
     *
     * @return the meta data buffer.
     */
    public metaDataBuffer(): UnsafeBuffer {
        return this.logMetaDataBuffer;
    }

    /**
     * The file of the log. The log is in memory (spec D4), so there is none: null.
     *
     * @return null.
     */
    public fileChannel(): null {
        return null;
    }

    /**
     * Pre-touch every page of the log: write the value it holds, to make the memory resident.
     */
    public preTouch(): void {
        const value = 0;
        const pageSize = LogBufferDescriptor.pageSize(this.logMetaDataBuffer);

        for (const buffer of [...this.termBuffers, this.logMetaDataBuffer]) {
            for (let i = 0, length = buffer.capacity(); i < length; i += pageSize) {
                buffer.compareAndSetInt(i, value, value);
            }
        }
    }

    /** A short form for pretty-format and JSON (issue #47): the sizes, never the term buffers. */
    public toJSON(): object {
        return { type: 'LogBuffers', termLength: this._termLength, refCount: this.refCount };
    }

    /** A short form for `util.inspect` (issue #47). */
    public [INSPECT_CUSTOM](): string {
        return 'LogBuffers{termLength=' + this._termLength + ', refCount=' + this.refCount + '}';
    }

    public close(): void {
        // Java: wrap(0, 0) on the meta data buffer and free the mapped buffers
        this.logMetaDataBuffer.wrap(new Uint8Array(0));
        for (const termBuffer of this.termBuffers) {
            termBuffer.wrap(new Uint8Array(0));
        }
    }

    /**
     * The length of a term.
     *
     * @return the length of a term.
     */
    public termLength(): number {
        return this._termLength;
    }

    public incRef(): number {
        return ++this.refCount;
    }

    public decRef(): number {
        return --this.refCount;
    }

    public lingerDeadlineNs(): number;
    public lingerDeadlineNs(timeNs: number): void;
    public lingerDeadlineNs(timeNs?: number): number | void {
        if (undefined === timeNs) {
            return this._lingerDeadlineNs;
        }

        this._lingerDeadlineNs = timeNs;
    }
}
