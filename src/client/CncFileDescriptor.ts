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
// Port of io/aeron/CncFileDescriptor.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { type DirectBuffer } from '../agrona/DirectBuffer.js';
import { SemanticVersion } from '../agrona/SemanticVersion.js';
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { AeronException } from './exceptions/AeronException.js';

const { CACHE_LINE_LENGTH, SIZE_OF_INT, SIZE_OF_LONG, align } = BitUtil;

/**
 * Description of the command and control (CnC) region used between driver and clients.
 * <p>
 * The CnC is one `SharedArrayBuffer` held in memory, not a file (spec D4, D15): every operation that Java does on a
 * `MappedByteBuffer` is done here on an `UnsafeBuffer` over the shared buffer, with the same layout and offsets.
 * The 64-bit values (`clientLivenessTimeoutNs`, `startTimestampMs`, `pid`) are `number`s in +/-(2^53 - 1) (spec D5).
 * <p>
 * Layout
 * <pre>
 *  +-----------------------------+
 *  |          Meta Data          |
 *  +-----------------------------+
 *  |      to-driver Buffer       |
 *  +-----------------------------+
 *  |      to-clients Buffer      |
 *  +-----------------------------+
 *  |   Counters Metadata Buffer  |
 *  +-----------------------------+
 *  |    Counters Values Buffer   |
 *  +-----------------------------+
 *  |          Error Log          |
 *  +-----------------------------+
 * </pre>
 * <p>
 * Metadata Layout {@link CNC_VERSION}
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                      Aeron CnC Version                        |
 *  +---------------------------------------------------------------+
 *  |                   to-driver buffer length                     |
 *  +---------------------------------------------------------------+
 *  |                  to-clients buffer length                     |
 *  +---------------------------------------------------------------+
 *  |               Counters Metadata buffer length                 |
 *  +---------------------------------------------------------------+
 *  |                Counters Values buffer length                  |
 *  +---------------------------------------------------------------+
 *  |                   Error Log buffer length                     |
 *  +---------------------------------------------------------------+
 *  |                   Client Liveness Timeout                     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                    Driver Start Timestamp                     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                         Driver PID                            |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                        File page size                         |
 *  +---------------------------------------------------------------+
 * </pre>
 */
export class CncFileDescriptor {
    /**
     * Name used for CnC file in the Aeron directory. There is no CnC file here (spec D4); the constant is kept for
     * the code that names the region.
     */
    public static readonly CNC_FILE = 'cnc.dat';

    /**
     * Version of the CnC using semantic versioning ({@link SemanticVersion}) stored as an 32-bit integer.
     */
    public static readonly CNC_VERSION = SemanticVersion.compose(0, 2, 0);

    /**
     * Offset at which the version field can be found.
     */
    public static readonly CNC_VERSION_FIELD_OFFSET = 0;

    /**
     * Offset at which the length field can be found for the command ring buffer to the driver.
     */
    public static readonly TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET =
        CncFileDescriptor.CNC_VERSION_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset at which the length field can be found for the broadcast buffer to the clients can be found.
     */
    public static readonly TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET =
        CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset at which the length field can be found for counter metadata, e.g. labels, can be found.
     */
    public static readonly COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET =
        CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset at which the length field can be found for the counters values can be found.
     */
    public static readonly COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET =
        CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET + SIZE_OF_INT;

    // Java assigns the offsets in a static block, in layout order; the error log length is declared first here only so
    // that a static initializer can read the one before it.
    /**
     * Offset at which the length field can be found for buffer containing the error log can be found.
     */
    public static readonly ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET =
        CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset at which the client liveness timeout value can be found.
     */
    public static readonly CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET =
        CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET + SIZE_OF_INT;

    /**
     * Offset at which the start timestamp value for the driver can be found.
     */
    public static readonly START_TIMESTAMP_FIELD_OFFSET =
        CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Offset at which the PID value for the driver can be found.
     */
    public static readonly PID_FIELD_OFFSET = CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET + SIZE_OF_LONG;

    /**
     * Offset at which the file page size value for the driver can be found.
     */
    public static readonly FILE_PAGE_SIZE_FIELD_OFFSET = CncFileDescriptor.PID_FIELD_OFFSET + SIZE_OF_LONG;

    private constructor() {}

    /**
     * Length of the metadata header for the CnC.
     */
    public static readonly META_DATA_LENGTH = CACHE_LINE_LENGTH * 2;

    /**
     * The offset of the first byte past the metadata header which is aligned on a cache-line boundary.
     */
    public static readonly END_OF_METADATA_OFFSET = CncFileDescriptor.META_DATA_LENGTH;

    /**
     * Compute the length of the CnC (the size of the `SharedArrayBuffer` to allocate) and return it.
     *
     * @param totalLengthOfBuffers in bytes.
     * @param alignment            for the length to adhere to.
     * @return CnC length in bytes.
     */
    public static computeCncFileLength(totalLengthOfBuffers: number, alignment: number): number {
        return align(CncFileDescriptor.META_DATA_LENGTH + totalLengthOfBuffers, alignment);
    }

    /**
     * Offset in the buffer at which the version field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the version field exists.
     */
    public static cncVersionOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.CNC_VERSION_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the to driver buffer length field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the to driver buffer length field exists.
     */
    public static toDriverBufferLengthOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the to clients buffer length field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the to clients buffer length field exists.
     */
    public static toClientsBufferLengthOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the counter metadata buffer length field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the counter metadata buffer length field exists.
     */
    public static countersMetaDataBufferLengthOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the counter value buffer length field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the counter value buffer length field exists.
     */
    public static countersValuesBufferLengthOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the client liveness timeout field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the client liveness timeout field exists.
     */
    public static clientLivenessTimeoutOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the error buffer length field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the error buffer length field exists.
     */
    public static errorLogBufferLengthOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the driver start time timestamp field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the driver start time timestamp field exists.
     */
    public static startTimestampOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET;
    }

    /**
     * Offset in the buffer at which the driver process PID field exists.
     *
     * @param baseOffset for the start of the metadata.
     * @return offset in the buffer at which the driver process PID field exists.
     */
    public static pidOffset(baseOffset: number): number {
        return baseOffset + CncFileDescriptor.PID_FIELD_OFFSET;
    }

    /**
     * Fill the CnC with metadata to define its sections.
     *
     * @param cncMetaDataBuffer           that wraps the metadata section of the CnC.
     * @param toDriverBufferLength        for sending commands to the driver.
     * @param toClientsBufferLength       for broadcasting events to the clients.
     * @param counterMetaDataBufferLength buffer length for counters metadata.
     * @param counterValuesBufferLength   buffer length for counter values.
     * @param clientLivenessTimeoutNs     timeout value in nanoseconds for client liveness and inter-service interval.
     * @param errorLogBufferLength        for recording the distinct error log.
     * @param startTimestampMs            epoch at which the driver started.
     * @param pid                         for the process hosting the driver.
     * @param filePageSize                for alignment of all files.
     */
    public static fillMetaData(
        cncMetaDataBuffer: UnsafeBuffer,
        toDriverBufferLength: number,
        toClientsBufferLength: number,
        counterMetaDataBufferLength: number,
        counterValuesBufferLength: number,
        clientLivenessTimeoutNs: number,
        errorLogBufferLength: number,
        startTimestampMs: number,
        pid: number,
        filePageSize: number,
    ): void {
        cncMetaDataBuffer.putInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET, toDriverBufferLength);
        cncMetaDataBuffer.putInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET, toClientsBufferLength);
        cncMetaDataBuffer.putInt(
            CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET,
            counterMetaDataBufferLength,
        );
        cncMetaDataBuffer.putInt(
            CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET,
            counterValuesBufferLength,
        );
        cncMetaDataBuffer.putInt(CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET, errorLogBufferLength);
        cncMetaDataBuffer.putLong(CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET, clientLivenessTimeoutNs);
        cncMetaDataBuffer.putLong(CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET, startTimestampMs);
        cncMetaDataBuffer.putLong(CncFileDescriptor.PID_FIELD_OFFSET, pid);
        cncMetaDataBuffer.putInt(CncFileDescriptor.FILE_PAGE_SIZE_FIELD_OFFSET, filePageSize);
    }

    /**
     * Signal that the CnC is ready for use by client by writing the version into the CnC.
     *
     * @param cncMetaDataBuffer for the CnC.
     */
    public static signalCncReady(cncMetaDataBuffer: UnsafeBuffer): void {
        cncMetaDataBuffer.putIntVolatile(CncFileDescriptor.CNC_VERSION_FIELD_OFFSET, CncFileDescriptor.CNC_VERSION);
    }

    /**
     * Create the buffer which wraps the area in the CnC for the metadata about the CnC itself.
     *
     * @param buffer for the CnC, a `SharedArrayBuffer` (Java: the `ByteBuffer` of the mapped file).
     * @return the buffer which wraps the area in the CnC for the metadata about the CnC itself.
     */
    public static createMetaDataBuffer(buffer: Uint8Array | ArrayBufferLike): UnsafeBuffer {
        return new UnsafeBuffer(buffer, 0, CncFileDescriptor.META_DATA_LENGTH);
    }

    /**
     * Create the buffer which wraps the area in the CnC for the command buffer from clients to the driver.
     *
     * @param buffer         for the CnC.
     * @param metaDataBuffer within the CnC.
     * @return a buffer which wraps the section in the CnC for the command buffer from clients to the driver.
     */
    public static createToDriverBuffer(
        buffer: Uint8Array | ArrayBufferLike,
        metaDataBuffer: DirectBuffer,
    ): UnsafeBuffer {
        return new UnsafeBuffer(
            buffer,
            CncFileDescriptor.META_DATA_LENGTH,
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET),
        );
    }

    /**
     * Create the buffer which wraps the section in the CnC for the broadcast buffer from the driver to clients.
     *
     * @param buffer         for the CnC.
     * @param metaDataBuffer within the CnC.
     * @return a buffer which wraps the section in the CnC for the broadcast buffer from the driver to clients.
     */
    public static createToClientsBuffer(
        buffer: Uint8Array | ArrayBufferLike,
        metaDataBuffer: DirectBuffer,
    ): UnsafeBuffer {
        const offset =
            CncFileDescriptor.META_DATA_LENGTH +
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET);

        return new UnsafeBuffer(
            buffer,
            offset,
            metaDataBuffer.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET),
        );
    }

    /**
     * Create the buffer which wraps the section in the CnC for the counter's metadata.
     *
     * @param buffer         for the CnC.
     * @param metaDataBuffer within the CnC.
     * @return a buffer which wraps the section in the CnC for the counter's metadata.
     */
    public static createCountersMetaDataBuffer(
        buffer: Uint8Array | ArrayBufferLike,
        metaDataBuffer: DirectBuffer,
    ): UnsafeBuffer {
        const offset =
            CncFileDescriptor.META_DATA_LENGTH +
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET);

        return new UnsafeBuffer(
            buffer,
            offset,
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET),
        );
    }

    /**
     * Create the buffer which wraps the section in the CnC for the counter values.
     *
     * @param buffer         for the CnC.
     * @param metaDataBuffer within the CnC.
     * @return a buffer which wraps the section in the CnC for the counter values.
     */
    public static createCountersValuesBuffer(
        buffer: Uint8Array | ArrayBufferLike,
        metaDataBuffer: DirectBuffer,
    ): UnsafeBuffer {
        const offset =
            CncFileDescriptor.META_DATA_LENGTH +
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET);

        return new UnsafeBuffer(
            buffer,
            offset,
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET),
        );
    }

    /**
     * Create the buffer which wraps the section in the CnC for the error log.
     *
     * @param buffer         for the CnC.
     * @param metaDataBuffer within the CnC.
     * @return a buffer which wraps the section in the CnC for the error log.
     */
    public static createErrorLogBuffer(
        buffer: Uint8Array | ArrayBufferLike,
        metaDataBuffer: DirectBuffer,
    ): UnsafeBuffer {
        const offset =
            CncFileDescriptor.META_DATA_LENGTH +
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET);

        return new UnsafeBuffer(
            buffer,
            offset,
            metaDataBuffer.getInt(CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET),
        );
    }

    /**
     * Get the timeout in nanoseconds for tracking client liveness and inter-service timeout.
     *
     * @param metaDataBuffer for the CnC.
     * @return the timeout in milliseconds for tracking client liveness.
     */
    public static clientLivenessTimeoutNs(metaDataBuffer: DirectBuffer): number {
        return metaDataBuffer.getLong(CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET);
    }

    /**
     * Get the start timestamp in milliseconds for the media driver.
     *
     * @param metaDataBuffer for the CnC.
     * @return the start timestamp in milliseconds for the media driver.
     */
    public static startTimestampMs(metaDataBuffer: DirectBuffer): number {
        return metaDataBuffer.getLong(CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET);
    }

    /**
     * Get the process PID hosting the driver.
     *
     * @param metaDataBuffer for the CnC.
     * @return the process PID hosting the driver.
     */
    public static pid(metaDataBuffer: DirectBuffer): number {
        return metaDataBuffer.getLong(CncFileDescriptor.PID_FIELD_OFFSET);
    }

    /**
     * Get the file page size.
     *
     * @param metaDataBuffer for the CnC.
     * @return the file page size.
     */
    public static filePageSize(metaDataBuffer: DirectBuffer): number {
        return metaDataBuffer.getInt(CncFileDescriptor.FILE_PAGE_SIZE_FIELD_OFFSET);
    }

    /**
     * Check the version of the CnC is compatible with application.
     *
     * @param cncVersion of the CnC.
     * @throws AeronException if the major versions are not compatible.
     */
    public static checkVersion(cncVersion: number): void {
        if (SemanticVersion.major(CncFileDescriptor.CNC_VERSION) !== SemanticVersion.major(cncVersion)) {
            throw new AeronException(
                'CnC version not compatible:' +
                    ' app=' +
                    SemanticVersion.toString(CncFileDescriptor.CNC_VERSION) +
                    ' file=' +
                    SemanticVersion.toString(cncVersion),
            );
        }
    }

    /**
     * Is the provided length for the CnC sufficient given what is stored in the metadata.
     *
     * @param metaDataBuffer for the CnC.
     * @param cncFileLength  to check if it is sufficient based on what is stored in the metadata.
     * @return true is the length is correct otherwise false.
     */
    public static isCncFileLengthSufficient(metaDataBuffer: DirectBuffer, cncFileLength: number): boolean {
        const metadataRequiredLength =
            CncFileDescriptor.META_DATA_LENGTH +
            metaDataBuffer.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET) +
            metaDataBuffer.getInt(CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET);

        return cncFileLength >= metadataRequiredLength;
    }
}
