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
// Not in Java (spec D4, D35): the log factory of this port. It takes the place of `FileStoreLogFactory` and
// `MappedRawLog` (log buffers in memory, no files), on the model of `TestLogFactory` of the Aeron tests.
import { BitUtil } from '../../agrona/BitUtil.js';
import { BufferUtil } from '../../agrona/BufferUtil.js';
import type { ErrorHandler } from '../../agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException, Integer } from '../../agrona/jdk.js';
import { LogBufferDescriptor } from '../../client/logbuffer/LogBufferDescriptor.js';
import type { LogFactory } from './LogFactory.js';
import type { RawLog } from './RawLog.js';

const { PARTITION_COUNT, LOG_META_DATA_LENGTH, computeLogLength } = LogBufferDescriptor;
const { CACHE_LINE_LENGTH, align } = BitUtil;

const PUBLICATIONS = 'publications';
const IMAGES = 'images';

/** The meta data and the terms of the log are windows on `SharedArrayBuffer`s (spec D16), so that a worker can map them. */
class MemoryRawLog implements RawLog {
    private readonly _termLength: number;
    private readonly logName: string;
    private readonly logLength: number;
    private readonly termBufferWindows: UnsafeBuffer[] = [];
    private readonly logMetaDataBuffer: UnsafeBuffer;
    private readonly factory: MemoryLogFactory;
    private readonly mappedBytesCounter: AtomicCounter;
    private isFreed = false;

    /**
     * The layout of Java's `MappedRawLog`: when the log is at most `singleBufferLimit` bytes (Java: `Integer.MAX_VALUE`)
     * it is one buffer with the three terms one after the other and the meta data in the last
     * `LOG_META_DATA_LENGTH` bytes; otherwise each term is a buffer of its own and the meta data is the last
     * `LOG_META_DATA_LENGTH` bytes of a buffer of `align(LOG_META_DATA_LENGTH, filePageSize)` bytes.
     */
    public constructor(
        factory: MemoryLogFactory,
        logName: string,
        logLength: number,
        termLength: number,
        filePageSize: number,
        singleBufferLimit: number,
        mappedBytesCounter: AtomicCounter,
    ) {
        this.factory = factory;
        this.logName = logName;
        this.logLength = logLength;
        this._termLength = termLength;
        this.mappedBytesCounter = mappedBytesCounter;

        if (logLength <= singleBufferLimit) {
            const buffer = BufferUtil.allocateShared(logLength, CACHE_LINE_LENGTH);
            for (let i = 0; i < PARTITION_COUNT; i++) {
                this.termBufferWindows[i] = new UnsafeBuffer(buffer, i * termLength, termLength);
            }
            this.logMetaDataBuffer = new UnsafeBuffer(buffer, logLength - LOG_META_DATA_LENGTH, LOG_META_DATA_LENGTH);
        } else {
            for (let i = 0; i < PARTITION_COUNT; i++) {
                const buffer = BufferUtil.allocateShared(termLength, CACHE_LINE_LENGTH);
                this.termBufferWindows[i] = new UnsafeBuffer(buffer, 0, termLength);
            }
            const metaDataMappingLength = align(LOG_META_DATA_LENGTH, filePageSize);
            const metaDataMappedBuffer = BufferUtil.allocateShared(metaDataMappingLength, CACHE_LINE_LENGTH);
            this.logMetaDataBuffer = new UnsafeBuffer(
                metaDataMappedBuffer,
                metaDataMappingLength - LOG_META_DATA_LENGTH,
                LOG_META_DATA_LENGTH,
            );
        }

        mappedBytesCounter.getAndAddRelease(logLength);
    }

    public termLength(): number {
        return this._termLength;
    }

    public termBuffers(): UnsafeBuffer[] {
        return this.termBufferWindows;
    }

    public metaData(): UnsafeBuffer {
        return this.logMetaDataBuffer;
    }

    public fileName(): string {
        return this.logName;
    }

    public free(): boolean {
        if (!this.isFreed) {
            this.isFreed = true;
            this.factory.unregister(this.logName, this);
            this.mappedBytesCounter.getAndAddRelease(-this.logLength);
            // Java: wrap(0, 0) on each buffer, which makes a late access fail its bounds check
            this.logMetaDataBuffer.wrap(new Uint8Array(0));
            for (const termBuffer of this.termBufferWindows) {
                termBuffer.wrap(new Uint8Array(0));
            }
        }

        return true;
    }

    public close(): void {
        this.free();
    }
}

/**
 * Creates log buffers in memory and registers them by name, so that the client finds the log of a publication or an
 * image by the name that the driver sends it (spec D4, D15). The log is the buffer layout of the log file of Java's
 * `MappedRawLog`; the name is `publications/<correlationId>.logbuffer` or `images/<correlationId>.logbuffer`, the
 * relative path of the file of `FileStoreLogFactory`.
 */
export class MemoryLogFactory implements LogFactory {
    private readonly filePageSize: number;
    private readonly errorHandler: ErrorHandler | null;
    private readonly mappedBytesCounter: AtomicCounter;
    private readonly singleBufferLimit: number;
    private readonly logs = new Map<string, MemoryRawLog>();

    /**
     * @param filePageSize       to align the log length to, as the page size of the log file.
     * @param errorHandler       for the logs (kept for the signature of `FileStoreLogFactory`).
     * @param mappedBytesCounter to count the bytes of the live logs in.
     * @param singleBufferLimit  the largest log that is one buffer (Java: `Integer.MAX_VALUE`, the limit of one mapping).
     */
    public constructor(
        filePageSize: number,
        errorHandler: ErrorHandler | null,
        mappedBytesCounter: AtomicCounter,
        singleBufferLimit: number = Integer.MAX_VALUE,
    ) {
        this.filePageSize = filePageSize;
        this.errorHandler = errorHandler;
        this.mappedBytesCounter = mappedBytesCounter;
        this.singleBufferLimit = singleBufferLimit;
    }

    /**
     * Free every log that is still registered.
     */
    public close(): void {
        for (const log of [...this.logs.values()]) {
            try {
                log.close();
            } catch (ex) {
                this.errorHandler?.onError(ex as Error);
            }
        }
    }

    public newPublication(correlationId: number, termBufferLength: number, _useSparseFiles: boolean): RawLog {
        return this.newInstance(PUBLICATIONS, correlationId, termBufferLength);
    }

    public newImage(correlationId: number, termBufferLength: number, _useSparseFiles: boolean): RawLog {
        return this.newInstance(IMAGES, correlationId, termBufferLength);
    }

    /**
     * Find the log with a name, as the client's `LogBuffers` does.
     *
     * @param logName the {@link RawLog.fileName} of a log that was created by this factory and is not freed.
     * @return the log, or null if there is none with that name.
     */
    public lookup(logName: string): RawLog | null {
        return this.logs.get(logName) ?? null;
    }

    /**
     * The number of logs that are created and not freed.
     *
     * @return the number of logs.
     */
    public logCount(): number {
        return this.logs.size;
    }

    /**
     * Forget a log that was freed.
     *
     * @internal called by the log.
     */
    public unregister(logName: string, log: RawLog): void {
        if (this.logs.get(logName) === log) {
            this.logs.delete(logName);
        }
    }

    private newInstance(directory: string, correlationId: number, termLength: number): RawLog {
        const logLength = computeLogLength(termLength, this.filePageSize);
        const logName = directory + '/' + correlationId + '.logbuffer';
        if (this.logs.has(logName)) {
            // Java: StandardOpenOption.CREATE_NEW fails when the file exists
            throw new IllegalStateException('log already exists: ' + logName);
        }

        const log = new MemoryRawLog(
            this,
            logName,
            logLength,
            termLength,
            this.filePageSize,
            this.singleBufferLimit,
            this.mappedBytesCounter,
        );
        this.logs.set(logName, log);

        return log;
    }
}
