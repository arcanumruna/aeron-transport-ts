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
// Port of io/aeron/driver/reports/LossReport.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';

const { CACHE_LINE_LENGTH, SIZE_OF_INT, SIZE_OF_LONG, align } = BitUtil;

/**
 * A report of the loss observed on a channel, written to a buffer in the layout that `LossReportReader` reads: one
 * record for each stream and session with loss, which the driver updates as it observes more of it.
 * <p>
 * Java maps the buffer from the file `loss-report.dat` of the Aeron directory; the port has no files (spec D4), so the
 * buffer is any {@link UnsafeBuffer} that the application gives the context (`MediaDriver.Context.lossReport`, spec
 * D50). The byte counts and times are `number`s (spec D5).
 * <p>
 * Layout of a record, with the offsets in the constants: the observation count (long) at 0, the total bytes lost
 * (long) at 8, the first observation in ms (long) at 16, the last observation in ms (long) at 24, the session id (int)
 * at 32, the stream id (int) at 36, then at 40 the channel (a length-prefixed ASCII string, padded to an int) and the
 * source (a length-prefixed ASCII string).
 */
export class LossReport {
    /**
     * Alignment at which each entry begins.
     */
    public static readonly ENTRY_ALIGNMENT: number = CACHE_LINE_LENGTH;

    /**
     * Offset of the observation count: the field the reader waits on, so it is written last with a release store.
     */
    public static readonly OBSERVATION_COUNT_OFFSET: number = 0;

    /**
     * Offset of the total number of bytes lost.
     */
    public static readonly TOTAL_BYTES_LOST_OFFSET: number = LossReport.OBSERVATION_COUNT_OFFSET + SIZE_OF_LONG;

    /**
     * Offset of the time of the first observation, in milliseconds since the epoch.
     */
    public static readonly FIRST_OBSERVATION_OFFSET: number = LossReport.TOTAL_BYTES_LOST_OFFSET + SIZE_OF_LONG;

    /**
     * Offset of the time of the last observation, in milliseconds since the epoch.
     */
    public static readonly LAST_OBSERVATION_OFFSET: number = LossReport.FIRST_OBSERVATION_OFFSET + SIZE_OF_LONG;

    /**
     * Offset of the session id.
     */
    public static readonly SESSION_ID_OFFSET: number = LossReport.LAST_OBSERVATION_OFFSET + SIZE_OF_LONG;

    /**
     * Offset of the stream id.
     */
    public static readonly STREAM_ID_OFFSET: number = LossReport.SESSION_ID_OFFSET + SIZE_OF_INT;

    /**
     * Offset of the channel string, followed by the source string.
     */
    public static readonly CHANNEL_OFFSET: number = LossReport.STREAM_ID_OFFSET + SIZE_OF_INT;

    /**
     * The nested class {@link ReportEntry}, as `LossReport.ReportEntry`.
     */
    public static ReportEntry: typeof ReportEntry;

    private nextRecordOffset = 0;
    private readonly buffer: UnsafeBuffer;

    /**
     * Create a loss report over a buffer.
     *
     * @param buffer into which the entries are written, aligned to a cache line.
     */
    public constructor(buffer: UnsafeBuffer) {
        buffer.verifyAlignment();
        this.buffer = buffer;
    }

    /**
     * Create a new entry for recording loss on a stream.
     *
     * @param initialBytesLost on the stream.
     * @param timestampMs      of the first observation, in milliseconds since the epoch.
     * @param sessionId        of the stream.
     * @param streamId         of the stream.
     * @param channel          of the stream.
     * @param source           of the stream.
     * @return a new entry, or {@code null} if there is no room for it in the buffer.
     */
    public createEntry(
        initialBytesLost: number,
        timestampMs: number,
        sessionId: number,
        streamId: number,
        channel: string,
        source: string,
    ): ReportEntry | null {
        let reportEntry: ReportEntry | null = null;

        const requiredCapacity =
            LossReport.CHANNEL_OFFSET + align(SIZE_OF_INT + channel.length, SIZE_OF_INT) + SIZE_OF_INT + source.length;

        if (requiredCapacity <= this.buffer.capacity() - this.nextRecordOffset) {
            const offset = this.nextRecordOffset;

            this.buffer.putLong(offset + LossReport.TOTAL_BYTES_LOST_OFFSET, initialBytesLost);
            this.buffer.putLong(offset + LossReport.FIRST_OBSERVATION_OFFSET, timestampMs);
            this.buffer.putLong(offset + LossReport.LAST_OBSERVATION_OFFSET, timestampMs);
            this.buffer.putInt(offset + LossReport.SESSION_ID_OFFSET, sessionId);
            this.buffer.putInt(offset + LossReport.STREAM_ID_OFFSET, streamId);

            const encodedChannelLength = this.buffer.putStringAscii(offset + LossReport.CHANNEL_OFFSET, channel);

            this.buffer.putStringAscii(
                offset + LossReport.CHANNEL_OFFSET + align(encodedChannelLength, SIZE_OF_INT),
                source,
            );

            this.buffer.putLongRelease(offset + LossReport.OBSERVATION_COUNT_OFFSET, 1);

            reportEntry = new ReportEntry(this.buffer, offset);
            this.nextRecordOffset += align(requiredCapacity, LossReport.ENTRY_ALIGNMENT);
        }

        return reportEntry;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return 'LossReport{nextRecordOffset=' + this.nextRecordOffset + ', buffer=' + this.buffer + '}';
    }
}

/**
 * Handle for recording further observations of loss in an entry created by {@link LossReport.createEntry}. Java's
 * `LossReport.ReportEntry`.
 */
export class ReportEntry {
    private readonly buffer: UnsafeBuffer;
    private readonly offset: number = 0;

    /**
     * @internal package-private in Java
     */
    public constructor(buffer: UnsafeBuffer, offset: number) {
        this.buffer = buffer;
        this.offset = offset;
    }

    /**
     * Record a further observation of loss.
     *
     * @param bytesLost   in this observation.
     * @param timestampMs of the observation, in milliseconds since the epoch.
     */
    public recordObservation(bytesLost: number, timestampMs: number): void {
        this.buffer.putLongRelease(this.offset + LossReport.LAST_OBSERVATION_OFFSET, timestampMs);
        this.buffer.getAndAddLong(this.offset + LossReport.TOTAL_BYTES_LOST_OFFSET, bytesLost);
        this.buffer.getAndAddLong(this.offset + LossReport.OBSERVATION_COUNT_OFFSET, 1);
    }
}

LossReport.ReportEntry = ReportEntry;
