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
// Port of io/aeron/logbuffer/LogBufferDescriptor.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import { ArithmeticException, IllegalArgumentException, IllegalStateException, Long } from '../../agrona/jdk.js';
import { DataHeaderFlyweight } from '../protocol/DataHeaderFlyweight.js';
import { FrameDescriptor } from './FrameDescriptor.js';

const { SIZE_OF_BYTE, SIZE_OF_INT, SIZE_OF_LONG, align, alignLong } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT } = FrameDescriptor;

const PADDING_SIZE = 64;

/** 2^0 .. 2^63 as doubles: `long << n` of an `int` term count, exact for any int32 times a power of two. */
const POW2 = new Float64Array(64).map((_, i) => 2 ** i);

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const TWO_POW_31 = 2147483648;
const TWO_POW_53 = 9007199254740992;

const PARTITION_COUNT = 3;

/** Scratch for the halves of a raw tail (spec D12, D16): the owner of a thread uses the module on that thread only. */
const RAW_TAIL_HALVES = new Int32Array(2);
const PAGE_MIN_SIZE = 4 * 1024;

// The offsets are what the static initialiser of Java computes. A `static readonly` of a TypeScript class cannot be
// assigned in a static block, so they are module constants, in the same order, that the class fields take.
const LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH = PADDING_SIZE * 2;

const TERM_TAIL_COUNTERS_OFFSET = 0;
const LOG_ACTIVE_TERM_COUNT_OFFSET = TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * PARTITION_COUNT;

const LOG_END_OF_STREAM_POSITION_OFFSET = PADDING_SIZE * 2;
const LOG_IS_CONNECTED_OFFSET = LOG_END_OF_STREAM_POSITION_OFFSET + SIZE_OF_LONG;
const LOG_ACTIVE_TRANSPORT_COUNT = LOG_IS_CONNECTED_OFFSET + SIZE_OF_INT;

const LOG_CORRELATION_ID_OFFSET = PADDING_SIZE * 4;
const LOG_INITIAL_TERM_ID_OFFSET = LOG_CORRELATION_ID_OFFSET + SIZE_OF_LONG;
const LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET = LOG_INITIAL_TERM_ID_OFFSET + SIZE_OF_INT;
const LOG_MTU_LENGTH_OFFSET = LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_TERM_LENGTH_OFFSET = LOG_MTU_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_PAGE_SIZE_OFFSET = LOG_TERM_LENGTH_OFFSET + SIZE_OF_INT;

const LOG_PUBLICATION_WINDOW_LENGTH_OFFSET = LOG_PAGE_SIZE_OFFSET + SIZE_OF_INT;
const LOG_RECEIVER_WINDOW_LENGTH_OFFSET = LOG_PUBLICATION_WINDOW_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_RECEIVER_WINDOW_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_SOCKET_SNDBUF_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_SOCKET_RCVBUF_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET + SIZE_OF_INT;
const LOG_MAX_RESEND_OFFSET = LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET + SIZE_OF_INT;

const LOG_DEFAULT_FRAME_HEADER_OFFSET = PADDING_SIZE * 5;
const LOG_ENTITY_TAG_OFFSET = LOG_DEFAULT_FRAME_HEADER_OFFSET + LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH;
const LOG_RESPONSE_CORRELATION_ID_OFFSET = LOG_ENTITY_TAG_OFFSET + SIZE_OF_LONG;
const LOG_LINGER_TIMEOUT_NS_OFFSET = LOG_RESPONSE_CORRELATION_ID_OFFSET + SIZE_OF_LONG;
const LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET = LOG_LINGER_TIMEOUT_NS_OFFSET + SIZE_OF_LONG;
const LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET = LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET + SIZE_OF_LONG;
const LOG_GROUP_OFFSET = LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET + SIZE_OF_LONG;
const LOG_IS_RESPONSE_OFFSET = LOG_GROUP_OFFSET + SIZE_OF_BYTE;
const LOG_REJOIN_OFFSET = LOG_IS_RESPONSE_OFFSET + SIZE_OF_BYTE;
const LOG_RELIABLE_OFFSET = LOG_REJOIN_OFFSET + SIZE_OF_BYTE;
const LOG_SPARSE_OFFSET = LOG_RELIABLE_OFFSET + SIZE_OF_BYTE;
const LOG_SIGNAL_EOS_OFFSET = LOG_SPARSE_OFFSET + SIZE_OF_BYTE;
const LOG_SPIES_SIMULATE_CONNECTION_OFFSET = LOG_SIGNAL_EOS_OFFSET + SIZE_OF_BYTE;
const LOG_TETHER_OFFSET = LOG_SPIES_SIMULATE_CONNECTION_OFFSET + SIZE_OF_BYTE;
const LOG_IS_PUBLICATION_REVOKED_OFFSET = LOG_TETHER_OFFSET + SIZE_OF_BYTE;
const LOG_TYPE_OFFSET = LOG_IS_PUBLICATION_REVOKED_OFFSET + SIZE_OF_BYTE;
const LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET = LOG_TYPE_OFFSET + SIZE_OF_BYTE + 2; // 2-bytes of space available

const LOG_META_DATA_LENGTH = PAGE_MIN_SIZE;

/**
 * Layout description for log buffers which contains partitions of terms with associated term metadata,
 * plus ending with overall log metadata.
 * <pre>
 *  +----------------------------+
 *  |           Term 0           |
 *  +----------------------------+
 *  |           Term 1           |
 *  +----------------------------+
 *  |           Term 2           |
 *  +----------------------------+
 *  |        Log Meta Data       |
 *  +----------------------------+
 * </pre>
 * <p>
 * A raw tail (the tail counter of a partition, and the result of an append) packs the term id in the high 32 bits
 * and the term offset in the low 32 bits of a 64-bit value. It is a `bigint` here (spec D12), because a term id is
 * any `int`; {@link rawTailTermId} and {@link rawTailTermOffset} read the two halves of a slot without one.
 */
export class LogBufferDescriptor {
    /**
     * The number of partitions the log is divided into.
     */
    public static readonly PARTITION_COUNT = PARTITION_COUNT;

    /**
     * Section index for which buffer contains the log metadata.
     */
    public static readonly LOG_META_DATA_SECTION_INDEX = PARTITION_COUNT;

    /**
     * The largest position: `Long.MAX_VALUE`, 2^53 - 1 (spec D5). A position never reaches it, because
     * {@link maxPossiblePosition} caps positions below it, so a comparison with it as a sentinel is unchanged.
     * <p>
     * Not in Java (spec D13, phase 2 decision 5).
     */
    public static readonly MAX_POSITION = Long.MAX_VALUE;

    /**
     * The position cap of a term length: Java's `termBufferLength * (1L << 31)` (computed inline in `Publication`, the
     * limit above which `indexByTermCount` goes negative) for terms of 2 MiB or less. From 4 MiB up it is
     * `2^53 - termLength`, the last term boundary that leaves a whole term below 2^53, so every position, including
     * the cap plus a maximum message plus a header, stays below {@link MAX_POSITION}.
     * <p>
     * Not in Java (spec D13, phase 2 decision 5).
     *
     * @param termLength of the log buffer.
     * @return the largest position a publication or image of the term length can have.
     */
    public static maxPossiblePosition(termLength: number): number {
        return Math.min(termLength * TWO_POW_31, TWO_POW_53 - termLength);
    }

    /**
     * Minimum buffer length for a log term.
     */
    public static readonly TERM_MIN_LENGTH = 64 * 1024;

    /**
     * Maximum buffer length for a log term.
     */
    public static readonly TERM_MAX_LENGTH = 1024 * 1024 * 1024;

    /**
     * Minimum page size.
     */
    public static readonly PAGE_MIN_SIZE = PAGE_MIN_SIZE;

    /**
     * Maximum page size.
     */
    public static readonly PAGE_MAX_SIZE = 1024 * 1024 * 1024;

    /**
     * Value for the `type` field to indicate a concurrent publication.
     */
    public static readonly LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION = 0;

    /**
     * Value for the `type` field to indicate an exclusive publication.
     */
    public static readonly LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION = 1;

    /**
     * Value for the `type` field to indicate a publication image.
     */
    public static readonly LOG_BUFFER_TYPE_PUBLICATION_IMAGE = 2;

    // *******************************
    // *** Log Meta Data Constants ***
    // *******************************

    /**
     * Offset within the metadata where the tail values are stored.
     */
    public static readonly TERM_TAIL_COUNTERS_OFFSET = TERM_TAIL_COUNTERS_OFFSET;

    /**
     * Offset within the log metadata where the active partition index is stored.
     */
    public static readonly LOG_ACTIVE_TERM_COUNT_OFFSET = LOG_ACTIVE_TERM_COUNT_OFFSET;

    /**
     * Offset within the log metadata where the position of the End of Stream is stored.
     */
    public static readonly LOG_END_OF_STREAM_POSITION_OFFSET = LOG_END_OF_STREAM_POSITION_OFFSET;

    /**
     * Offset within the log metadata where whether the log is connected or not is stored.
     */
    public static readonly LOG_IS_CONNECTED_OFFSET = LOG_IS_CONNECTED_OFFSET;

    /**
     * Offset within the log metadata where the count of active transports is stored.
     */
    public static readonly LOG_ACTIVE_TRANSPORT_COUNT = LOG_ACTIVE_TRANSPORT_COUNT;

    /**
     * Offset within the log metadata where the active term id is stored.
     */
    public static readonly LOG_INITIAL_TERM_ID_OFFSET = LOG_INITIAL_TERM_ID_OFFSET;

    /**
     * Offset within the log metadata which the length field for the frame header is stored.
     */
    public static readonly LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET = LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET;

    /**
     * Offset within the log metadata which the MTU length is stored.
     */
    public static readonly LOG_MTU_LENGTH_OFFSET = LOG_MTU_LENGTH_OFFSET;

    /**
     * Offset within the log metadata which the correlation id is stored.
     */
    public static readonly LOG_CORRELATION_ID_OFFSET = LOG_CORRELATION_ID_OFFSET;

    /**
     * Offset within the log metadata which the term length is stored.
     */
    public static readonly LOG_TERM_LENGTH_OFFSET = LOG_TERM_LENGTH_OFFSET;

    /**
     * Offset within the log metadata which the page size is stored.
     */
    public static readonly LOG_PAGE_SIZE_OFFSET = LOG_PAGE_SIZE_OFFSET;

    /**
     * Offset at which the default frame headers begin.
     */
    public static readonly LOG_DEFAULT_FRAME_HEADER_OFFSET = LOG_DEFAULT_FRAME_HEADER_OFFSET;

    /**
     * Maximum length of a frame header.
     */
    public static readonly LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH = LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH;

    /**
     * Offset within the log metadata where the sparse property is stored.
     */
    public static readonly LOG_SPARSE_OFFSET = LOG_SPARSE_OFFSET;

    /**
     * Offset within the log metadata where the tether property is stored.
     */
    public static readonly LOG_TETHER_OFFSET = LOG_TETHER_OFFSET;

    /**
     * Offset within the log metadata where the 'publication revoked' status is indicated.
     */
    public static readonly LOG_IS_PUBLICATION_REVOKED_OFFSET = LOG_IS_PUBLICATION_REVOKED_OFFSET;

    /**
     * Offset within the log metadata where the type of the log buffer is stored.
     *
     * @see LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION
     * @see LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION
     * @see LOG_BUFFER_TYPE_PUBLICATION_IMAGE
     */
    public static readonly LOG_TYPE_OFFSET = LOG_TYPE_OFFSET;

    /**
     * Offset within the log metadata where the rejoin property is stored.
     */
    public static readonly LOG_REJOIN_OFFSET = LOG_REJOIN_OFFSET;

    /**
     * Offset within the log metadata where the reliable property is stored.
     */
    public static readonly LOG_RELIABLE_OFFSET = LOG_RELIABLE_OFFSET;

    /**
     * Offset within the log metadata where the socket receive buffer length is stored.
     */
    public static readonly LOG_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_SOCKET_RCVBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the OS default length for the socket receive buffer is stored.
     */
    public static readonly LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the OS maximum length for the socket receive buffer is stored.
     */
    public static readonly LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET = LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the socket send buffer length is stored.
     */
    public static readonly LOG_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_SOCKET_SNDBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the OS default length for the socket send buffer is stored.
     */
    public static readonly LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the OS maximum length for the socket send buffer is stored.
     */
    public static readonly LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET = LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the receiver window length is stored.
     */
    public static readonly LOG_RECEIVER_WINDOW_LENGTH_OFFSET = LOG_RECEIVER_WINDOW_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the publication window length is stored.
     */
    public static readonly LOG_PUBLICATION_WINDOW_LENGTH_OFFSET = LOG_PUBLICATION_WINDOW_LENGTH_OFFSET;

    /**
     * Offset within the log metadata where the untethered window limit timeout ns is stored.
     */
    public static readonly LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET =
        LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET;

    /**
     * Offset within the log metadata where the untethered linger timeout ns is stored.
     */
    public static readonly LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET = LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET;

    /**
     * Offset within the log metadata where the untethered resting timeout ns is stored.
     */
    public static readonly LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET = LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET;

    /**
     * Offset within the log metadata where the max resend is stored.
     */
    public static readonly LOG_MAX_RESEND_OFFSET = LOG_MAX_RESEND_OFFSET;

    /**
     * Offset within the log metadata where the linger timeout ns is stored.
     */
    public static readonly LOG_LINGER_TIMEOUT_NS_OFFSET = LOG_LINGER_TIMEOUT_NS_OFFSET;

    /**
     * Offset within the log metadata where the signal-eos is stored.
     */
    public static readonly LOG_SIGNAL_EOS_OFFSET = LOG_SIGNAL_EOS_OFFSET;

    /**
     * Offset within the log metadata where the spies-simulate-connection is stored.
     */
    public static readonly LOG_SPIES_SIMULATE_CONNECTION_OFFSET = LOG_SPIES_SIMULATE_CONNECTION_OFFSET;

    /**
     * Offset within the log metadata where the group is stored.
     */
    public static readonly LOG_GROUP_OFFSET = LOG_GROUP_OFFSET;

    /**
     * Offset within the log metadata where the entity tag is stored.
     */
    public static readonly LOG_ENTITY_TAG_OFFSET = LOG_ENTITY_TAG_OFFSET;

    /**
     * Offset within the log metadata where the response correlation id is stored.
     */
    public static readonly LOG_RESPONSE_CORRELATION_ID_OFFSET = LOG_RESPONSE_CORRELATION_ID_OFFSET;

    /**
     * Offset within the log metadata where is-response is stored.
     */
    public static readonly LOG_IS_RESPONSE_OFFSET = LOG_IS_RESPONSE_OFFSET;

    /**
     * Total length of the log metadata buffer in bytes.
     * <pre>
     *   0                   1                   2                   3
     *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
     *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
     *  |                       Tail Counter 0                          |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                       Tail Counter 1                          |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                       Tail Counter 2                          |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                      Active Term Count                        |
     *  +---------------------------------------------------------------+
     *  |                     Cache Line Padding                       ...
     * ...                                                              |
     *  +---------------------------------------------------------------+
     *  |                    End of Stream Position                     |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                        Is Connected                           |
     *  +---------------------------------------------------------------+
     *  |                    Active Transport Count                     |
     *  +---------------------------------------------------------------+
     *  |                      Cache Line Padding                      ...
     * ...                                                              |
     *  +---------------------------------------------------------------+
     *  |                 Registration / Correlation ID                 |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                        Initial Term Id                        |
     *  +---------------------------------------------------------------+
     *  |                  Default Frame Header Length                  |
     *  +---------------------------------------------------------------+
     *  |                          MTU Length                           |
     *  +---------------------------------------------------------------+
     *  |                         Term Length                           |
     *  +---------------------------------------------------------------+
     *  |                          Page Size                            |
     *  +---------------------------------------------------------------+
     *  |                    Publication Window Length                  |
     *  +---------------------------------------------------------------+
     *  |                      Receiver Window Length                   |
     *  +---------------------------------------------------------------+
     *  |                    Socket Send Buffer Length                  |
     *  +---------------------------------------------------------------+
     *  |               OS Default Socket Send Buffer Length            |
     *  +---------------------------------------------------------------+
     *  |                OS Max Socket Send Buffer Length               |
     *  +---------------------------------------------------------------+
     *  |                  Socket Receive Buffer Length                 |
     *  +---------------------------------------------------------------+
     *  |              OS Default Socket Receive Buffer Length          |
     *  +---------------------------------------------------------------+
     *  |               OS Max Socket Receive Buffer Length             |
     *  +---------------------------------------------------------------+
     *  |                        Maximum Resend                         |
     *  +---------------------------------------------------------------+
     *  |                           Entity tag                          |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                    Response correlation id                    |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                     Default Frame Header                     ...
     * ...                                                              |
     *  +---------------------------------------------------------------+
     *  |                        Linger Timeout (ns)                    |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |               Untethered Window Limit Timeout (ns)            |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                 Untethered Resting Timeout (ns)               |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     *  |                            Group                              |
     *  +---------------------------------------------------------------+
     *  |                          Is response                          |
     *  +---------------------------------------------------------------+
     *  |                            Rejoin                             |
     *  +---------------------------------------------------------------+
     *  |                           Reliable                            |
     *  +---------------------------------------------------------------+
     *  |                            Sparse                             |
     *  +---------------------------------------------------------------+
     *  |                         Signal EOS                            |
     *  +---------------------------------------------------------------+
     *  |                 Spies Simulate Connection                     |
     *  +---------------------------------------------------------------+
     *  |                          Tether                               |
     *  +---------------------------------------------------------------+
     *  |                     Is publication revoked                    |
     *  +---------------------------------------------------------------+
     *  |                         Alignment gap                         |
     *  +---------------------------------------------------------------+
     *  |                  Untethered Linger Timeout (ns)               |
     *  |                                                               |
     *  +---------------------------------------------------------------+
     * </pre>
     */
    public static readonly LOG_META_DATA_LENGTH = LOG_META_DATA_LENGTH;

    private constructor() {}

    /**
     * Check that term buffer length is valid and alignment is valid.
     *
     * @param termLength to be checked.
     * @throws IllegalStateException if the length is not as expected.
     */
    public static checkTermLength(termLength: number): void {
        if (termLength < LogBufferDescriptor.TERM_MIN_LENGTH) {
            throw new IllegalStateException(
                'Term length less than min length of ' + LogBufferDescriptor.TERM_MIN_LENGTH + ': length=' + termLength,
            );
        }

        if (termLength > LogBufferDescriptor.TERM_MAX_LENGTH) {
            throw new IllegalStateException(
                'Term length more than max length of ' + LogBufferDescriptor.TERM_MAX_LENGTH + ': length=' + termLength,
            );
        }

        if (!BitUtil.isPowerOfTwo(termLength)) {
            throw new IllegalStateException('Term length not a power of 2: length=' + termLength);
        }
    }

    /**
     * Check that page size is valid and alignment is valid.
     *
     * @param pageSize to be checked.
     * @throws IllegalStateException if the size is not as expected.
     */
    public static checkPageSize(pageSize: number): void {
        if (pageSize < LogBufferDescriptor.PAGE_MIN_SIZE) {
            throw new IllegalStateException(
                'Page size less than min size of ' + LogBufferDescriptor.PAGE_MIN_SIZE + ': page size=' + pageSize,
            );
        }

        if (pageSize > LogBufferDescriptor.PAGE_MAX_SIZE) {
            throw new IllegalStateException(
                'Page size more than max size of ' + LogBufferDescriptor.PAGE_MAX_SIZE + ': page size=' + pageSize,
            );
        }

        if (!BitUtil.isPowerOfTwo(pageSize)) {
            throw new IllegalStateException('Page size not a power of 2: page size=' + pageSize);
        }
    }

    /**
     * Get the initial term id.
     *
     * @param metadataBuffer containing the metadata.
     * @return the initial term id.
     */
    public static initialTermId(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the initial term id.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static initialTermId(metadataBuffer: UnsafeBuffer, value: number): void;
    public static initialTermId(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_INITIAL_TERM_ID_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_INITIAL_TERM_ID_OFFSET, value);
    }

    /**
     * Get the MTU length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the MTU length.
     */
    public static mtuLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the MTU length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static mtuLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static mtuLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_MTU_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_MTU_LENGTH_OFFSET, value);
    }

    /**
     * Get the term length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the term length.
     */
    public static termLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the term length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static termLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static termLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_TERM_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_TERM_LENGTH_OFFSET, value);
    }

    /**
     * Get the page size.
     *
     * @param metadataBuffer containing the metadata.
     * @return the page size.
     */
    public static pageSize(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the page size.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static pageSize(metadataBuffer: UnsafeBuffer, value: number): void;
    public static pageSize(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_PAGE_SIZE_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_PAGE_SIZE_OFFSET, value);
    }

    /**
     * Get the registration / correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @return the registration / correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     */
    public static correlationId(metadataBuffer: UnsafeBuffer): bigint;
    /**
     * Set the registration / correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static correlationId(metadataBuffer: UnsafeBuffer, value: bigint): void;
    public static correlationId(metadataBuffer: UnsafeBuffer, value?: bigint): bigint | void {
        if (undefined === value) {
            return metadataBuffer.getLongBigInt(LogBufferDescriptor.LOG_CORRELATION_ID_OFFSET);
        }

        metadataBuffer.putLongBigInt(LogBufferDescriptor.LOG_CORRELATION_ID_OFFSET, Long.checkInt64(value));
    }

    /**
     * Get the connected status of the log (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @return the connected status of the log (a volatile read, a release write).
     */
    public static isConnected(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the connected status of the log (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static isConnected(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static isConnected(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getIntVolatile(LogBufferDescriptor.LOG_IS_CONNECTED_OFFSET) === 1;
        }

        metadataBuffer.putIntRelease(LogBufferDescriptor.LOG_IS_CONNECTED_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the count of active transports (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @return the count of active transports (a volatile read, a release write).
     */
    public static activeTransportCount(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the count of active transports (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static activeTransportCount(metadataBuffer: UnsafeBuffer, value: number): void;
    public static activeTransportCount(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getIntVolatile(LogBufferDescriptor.LOG_ACTIVE_TRANSPORT_COUNT);
        }

        metadataBuffer.putIntRelease(LogBufferDescriptor.LOG_ACTIVE_TRANSPORT_COUNT, value);
    }

    /**
     * Get the end of stream position (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @return the end of stream position (a volatile read, a release write).
     */
    public static endOfStreamPosition(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the end of stream position (a volatile read, a release write).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static endOfStreamPosition(metadataBuffer: UnsafeBuffer, value: number): void;
    public static endOfStreamPosition(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getLongVolatile(LogBufferDescriptor.LOG_END_OF_STREAM_POSITION_OFFSET);
        }

        metadataBuffer.putLongRelease(LogBufferDescriptor.LOG_END_OF_STREAM_POSITION_OFFSET, value);
    }

    /**
     * Get the value of the active term count used by the producer of the log. Note this value can be greater than
     * the term count for the term the log is on, as the count is a rotation over the three partitions.
     *
     * @param metadataBuffer containing the metadata.
     * @return the value of the active term count used by the producer of the log.
     */
    public static activeTermCount(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the value of the current active term count for the producer using memory ordered semantics.
     *
     * @param metadataBuffer containing the metadata.
     * @param termCount       value of the active term count used by the producer of the log.
     */
    public static activeTermCount(metadataBuffer: UnsafeBuffer, termCount: number): void;
    public static activeTermCount(metadataBuffer: UnsafeBuffer, termCount?: number): number | void {
        if (undefined === termCount) {
            return metadataBuffer.getIntVolatile(LogBufferDescriptor.LOG_ACTIVE_TERM_COUNT_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_ACTIVE_TERM_COUNT_OFFSET, termCount);
    }

    /**
     * Set the value of the current active term count for the producer using memory ordered semantics.
     *
     * @param metadataBuffer containing the metadata.
     * @param termCount      value of the active term count for the producer of the log.
     */
    public static activeTermCountOrdered(metadataBuffer: UnsafeBuffer, termCount: number): void {
        metadataBuffer.putIntRelease(LogBufferDescriptor.LOG_ACTIVE_TERM_COUNT_OFFSET, termCount);
    }

    /**
     * Compare and set the value of the current active term count.
     *
     * @param metadataBuffer  containing the metadata.
     * @param expectedTermCount value of the active term count expected in the log
     * @param updateTermCount   value of the active term count to be updated in the log
     * @return true if successful otherwise false.
     */
    public static casActiveTermCount(
        metadataBuffer: UnsafeBuffer,
        expectedTermCount: number,
        updateTermCount: number,
    ): boolean {
        return metadataBuffer.compareAndSetInt(
            LogBufferDescriptor.LOG_ACTIVE_TERM_COUNT_OFFSET,
            expectedTermCount,
            updateTermCount,
        );
    }

    /**
     * Determine the partition index to be used given the initial term and active term ids.
     *
     * @param currentIndex partition index
     * @return the next partition index
     */
    public static nextPartitionIndex(currentIndex: number): number {
        return (currentIndex + 1) % LogBufferDescriptor.PARTITION_COUNT;
    }

    /**
     * Determine the partition index to be used given the initial term and active term ids.
     *
     * @param initialTermId at which the log buffer usage began
     * @param activeTermId  that is in current usage
     * @return the index of which buffer should be used
     */
    public static indexByTerm(initialTermId: number, activeTermId: number): number {
        return (((activeTermId - initialTermId) | 0) % LogBufferDescriptor.PARTITION_COUNT) | 0; // `| 0`: no -0
    }

    /**
     * Determine the partition index based on number of terms that have passed.
     *
     * @param termCount for the number of terms that have passed.
     * @return the partition index for the term count.
     */
    public static indexByTermCount(termCount: number): number {
        return (termCount % LogBufferDescriptor.PARTITION_COUNT) | 0; // `| 0`: no -0
    }

    /**
     * Determine the partition index given a stream position.
     * <p>
     * A negative position is read as the unsigned 64-bit value Java's `>>>` makes of it, which is the cold branch.
     *
     * @param position in log.
     * @param positionBitsToShift number of times to right shift the position for term count
     * @return the partition index for the position
     */
    public static indexByPosition(position: number, positionBitsToShift: number): number {
        if (position >= 0) {
            return Math.floor(position / POW2[positionBitsToShift & 63]!) % LogBufferDescriptor.PARTITION_COUNT;
        }

        return Number(
            (BigInt.asUintN(64, BigInt(position)) >> BigInt(positionBitsToShift & 63)) %
                BigInt(LogBufferDescriptor.PARTITION_COUNT),
        );
    }

    /**
     * The term count of a position: Java's `(int)(position >> positionBitsToShift)`. The one helper for it (spec 5.5):
     * a position is a `number` (D5), so it is divided, not shifted. Exact for a position in [0, 2^53 - 1]; the
     * allocation-free hot path form of the division of {@link indexByPosition}.
     *
     * @param position            in the stream, not negative.
     * @param positionBitsToShift number of times to right shift the position for term count
     * @return the term count, wrapped to an `int` as Java's cast does
     */
    public static termCountByPosition(position: number, positionBitsToShift: number): number {
        return Math.floor(position / POW2[positionBitsToShift & 63]!) | 0;
    }

    /**
     * The offset in its term of a position: Java's `(int)position & (termLength - 1)`. The pair of
     * {@link termCountByPosition} (spec 5.5). `position | 0` keeps the low 32 bits of a `number` that is an exact
     * integer, so it is exact for any position in +/-(2^53 - 1).
     *
     * @param position   in the stream.
     * @param termLength of each term, a power of two not above 2^30.
     * @return the offset in the term
     */
    public static termOffsetByPosition(position: number, termLength: number): number {
        return (position | 0) & (termLength - 1);
    }

    /**
     * Compute the current position in absolute number of bytes.
     * <p>
     * Throws `RangeError`, as every `long` that leaves +/-(2^53 - 1) does (spec D5), for a position that a `number`
     * cannot hold.
     *
     * @param activeTermId        active term id.
     * @param termOffset          in the term.
     * @param positionBitsToShift number of times to left shift the term count
     * @param initialTermId       the initial term id that this stream started on
     * @return the absolute position in bytes
     */
    public static computePosition(
        activeTermId: number,
        termOffset: number,
        positionBitsToShift: number,
        initialTermId: number,
    ): number {
        const termCount = (activeTermId - initialTermId) | 0; // copes with negative activeTermId on rollover
        const position = termCount * POW2[positionBitsToShift & 63]! + termOffset;
        if (position > MAX_SAFE || position < -MAX_SAFE) {
            throw new RangeError('position outside +/-(2^53 - 1): ' + position);
        }

        return position;
    }

    /**
     * Compute the current position in absolute number of bytes for the beginning of a term.
     * <p>
     * Throws `RangeError` as {@link computePosition} does.
     *
     * @param activeTermId        active term id.
     * @param positionBitsToShift number of times to left shift the term count
     * @param initialTermId       the initial term id that this stream started on
     * @return the absolute position in bytes
     */
    public static computeTermBeginPosition(
        activeTermId: number,
        positionBitsToShift: number,
        initialTermId: number,
    ): number {
        const termCount = (activeTermId - initialTermId) | 0; // copes with negative activeTermId on rollover
        const position = termCount * POW2[positionBitsToShift & 63]!;
        if (position > MAX_SAFE || position < -MAX_SAFE) {
            throw new RangeError('position outside +/-(2^53 - 1): ' + position);
        }

        return position;
    }

    /**
     * Compute the term id from a position.
     * <p>
     * A negative position is read as the unsigned 64-bit value Java's `>>>` makes of it, which is the cold branch.
     *
     * @param position            to calculate from
     * @param positionBitsToShift number of times to right shift the position
     * @param initialTermId       the initial term id that this stream started on
     * @return the term id according to the position
     */
    public static computeTermIdFromPosition(
        position: number,
        positionBitsToShift: number,
        initialTermId: number,
    ): number {
        if (position >= 0) {
            return ((Math.floor(position / POW2[positionBitsToShift & 63]!) | 0) + initialTermId) | 0;
        }

        return (
            (Number(BigInt.asIntN(32, BigInt.asUintN(64, BigInt(position)) >> BigInt(positionBitsToShift & 63))) +
                initialTermId) |
            0
        );
    }

    /**
     * Compute the total length of a log file given the term length.
     *
     * Assumes {@link TERM_MAX_LENGTH} is 1GB and that filePageSize is 1GB or less and a power of 2.
     *
     * @param termLength   on which to base the calculation.
     * @param filePageSize to use for sizing the log buffer.
     * @return the total length of the log file.
     */
    public static computeLogLength(termLength: number, filePageSize: number): number {
        return alignLong(
            LogBufferDescriptor.PARTITION_COUNT * termLength + LogBufferDescriptor.LOG_META_DATA_LENGTH,
            filePageSize,
        );
    }

    /**
     * Store the default frame header to the log metadata buffer.
     *
     * @param metadataBuffer into which the default headers should be stored.
     * @param defaultHeader  to be stored.
     * @throws IllegalArgumentException if the defaultHeader larger than {@link LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH}
     */
    public static storeDefaultFrameHeader(metadataBuffer: UnsafeBuffer, defaultHeader: DirectBuffer): void {
        if (defaultHeader.capacity() !== HEADER_LENGTH) {
            throw new IllegalArgumentException(
                'Default header length not equal to HEADER_LENGTH: length=' + defaultHeader.capacity(),
            );
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET, HEADER_LENGTH);
        metadataBuffer.putBytes(LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_OFFSET, defaultHeader, 0, HEADER_LENGTH);
    }

    /**
     * Get a wrapper around the default frame header from the log metadata.
     *
     * @param metadataBuffer containing the default headers.
     * @return a buffer wrapping the default frame header stored in the log metadata.
     */
    public static defaultFrameHeader(metadataBuffer: UnsafeBuffer): UnsafeBuffer {
        return new UnsafeBuffer(metadataBuffer, LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_OFFSET, HEADER_LENGTH);
    }

    /**
     * Apply the default header for a message in a term.
     *
     * @param metadataBuffer containing the default headers.
     * @param termBuffer     to which the default header should be applied.
     * @param termOffset     at which the default should be applied.
     */
    public static applyDefaultHeader(metadataBuffer: UnsafeBuffer, termBuffer: UnsafeBuffer, termOffset: number): void {
        termBuffer.putBytes(
            termOffset,
            metadataBuffer,
            LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_OFFSET,
            HEADER_LENGTH,
        );
    }

    /**
     * Rotate the log and update the tail counter for the new term. This method is safe for concurrent use.
     *
     * @param metadataBuffer for the log.
     * @param termCount      from which to rotate.
     * @param termId         to be used in the default headers.
     * @return true if log was rotated.
     */
    public static rotateLog(metadataBuffer: UnsafeBuffer, termCount: number, termId: number): boolean {
        const nextTermId = (termId + 1) | 0;
        const nextTermCount = (termCount + 1) | 0;
        const nextIndex = LogBufferDescriptor.indexByTermCount(nextTermCount);
        const expectedTermId = (nextTermId - LogBufferDescriptor.PARTITION_COUNT) | 0;

        let rawTail: bigint;
        do {
            rawTail = LogBufferDescriptor.rawTailVolatile(metadataBuffer, nextIndex);
            if (expectedTermId !== LogBufferDescriptor.termId(rawTail)) {
                break;
            }
        } while (
            !LogBufferDescriptor.casRawTail(
                metadataBuffer,
                nextIndex,
                rawTail,
                LogBufferDescriptor.packTail(nextTermId, 0),
            )
        );

        return LogBufferDescriptor.casActiveTermCount(metadataBuffer, termCount, nextTermCount);
    }

    /**
     * Set the initial value for the termId in the upper bits of the tail counter.
     * <p>
     * The two halves of the slot are written directly: no `bigint` is made.
     *
     * @param metadataBuffer contain the tail counters.
     * @param partitionIndex to be initialised.
     * @param termId         to be set.
     */
    public static initialiseTailWithTermId(metadataBuffer: UnsafeBuffer, partitionIndex: number, termId: number): void {
        const index = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + partitionIndex * SIZE_OF_LONG;
        metadataBuffer.putInt(index, 0);
        metadataBuffer.putInt(index + SIZE_OF_INT, termId);
    }

    /**
     * Get the termId from a packed raw tail value.
     *
     * @param rawTail containing the termId.
     * @return the termId from a packed raw tail value.
     */
    public static termId(rawTail: bigint): number {
        return Number(BigInt.asIntN(32, rawTail >> 32n));
    }

    /**
     * Read the termOffset from a packed raw tail value, limited to the length of the term.
     *
     * @param rawTail    containing the termOffset.
     * @param termLength that the offset cannot exceed.
     * @return the termOffset value.
     */
    public static termOffset(rawTail: bigint, termLength: number): number;
    /**
     * Read the termOffset from a packed raw tail value or the result of an append: the low 32 bits as an `int`.
     *
     * @param result containing the termOffset.
     * @return the termOffset value.
     */
    public static termOffset(result: bigint): number;
    public static termOffset(rawTail: bigint, termLength?: number): number {
        if (undefined === termLength) {
            return Number(BigInt.asIntN(32, rawTail));
        }

        const tail = Number(BigInt.asUintN(32, rawTail));

        return Math.min(tail, termLength) | 0;
    }

    /**
     * The termOffset as a result of the append, or the term id half of a slot's raw tail, is read here without
     * a `bigint`. This one is the term id: the high half of the tail counter of a partition.
     * <p>
     * Not in Java (spec D12): `termId(rawTailVolatile(metadataBuffer, partitionIndex))` without a `bigint`.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex of the tail counter.
     * @return the term id in the upper bits of the tail counter.
     */
    public static rawTailTermId(metadataBuffer: UnsafeBuffer, partitionIndex: number): number {
        return metadataBuffer.getIntVolatile(
            LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex + SIZE_OF_INT,
        );
    }

    /**
     * The term offset in the lower bits of the tail counter, limited to the length of the term.
     * <p>
     * Not in Java (spec D12): `termOffset(rawTailVolatile(metadataBuffer, partitionIndex), termLength)` without a
     * `bigint`.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex of the tail counter.
     * @param termLength     that the offset cannot exceed.
     * @return the term offset.
     */
    public static rawTailTermOffset(metadataBuffer: UnsafeBuffer, partitionIndex: number, termLength: number): number {
        const tail =
            metadataBuffer.getIntVolatile(
                LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex,
            ) >>> 0;

        return Math.min(tail, termLength) | 0;
    }

    /**
     * Add to the term offset of the raw tail of a slot, carrying into the term id as the 64-bit add does, and return the
     * old term offset: Java's `logMetaDataBuffer.getAndAddLong(tailCounterOffset, alignedLength)` followed by
     * `termOffset(rawTail)` and `termId(rawTail)`, without a `bigint`.
     * <p>
     * Not in Java (spec D12, phase 2 decision 5, made atomic by T2b). It is one atomic 64-bit add on the slot
     * ({@link UnsafeBuffer.getAndAddLongHalves}, spec D16), exact across threads, whatever else writes the slot
     * (`rotateLog`'s `casRawTail`, `initialiseTailWithTermId`).
     * <p>
     * The returned low half is unsigned and can exceed 2^31; callers apply `Math.min(oldLow, termLength)` before any
     * `| 0`.
     *
     * @param metaDataBuffer    containing the tail counters.
     * @param tailCounterOffset of the tail counter in the buffer.
     * @param delta             a non-negative `int`, the aligned length of the frame.
     * @param termIdHolder      receives the old term id at index 0.
     * @return the old term offset, as `rawTail & 0xFFFF_FFFFL` is (an unsigned 32 bit value).
     */
    public static getAndAddRawTailOffset(
        metaDataBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        delta: number,
        termIdHolder: Int32Array,
    ): number {
        metaDataBuffer.getAndAddLongHalves(tailCounterOffset, delta, RAW_TAIL_HALVES);
        termIdHolder[0] = RAW_TAIL_HALVES[1]!;

        return RAW_TAIL_HALVES[0]! >>> 0;
    }

    /**
     * Pack a termId and termOffset into a raw tail value.
     *
     * @param termId     to be packed.
     * @param termOffset to be packed.
     * @return the packed value.
     */
    public static packTail(termId: number, termOffset: number): bigint {
        return BigInt.asIntN(64, (BigInt(termId | 0) << 32n) | BigInt(termOffset | 0));
    }

    /**
     * Set the raw value of the tail for the given partition.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex for the tail counter.
     * @param rawTail        to be stored
     */
    public static rawTail(metadataBuffer: UnsafeBuffer, partitionIndex: number, rawTail: bigint): void;
    /**
     * Get the raw value of the tail for the given partition.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex for the tail counter.
     * @return the raw value of the tail for the current active partition.
     */
    public static rawTail(metadataBuffer: UnsafeBuffer, partitionIndex: number): bigint;
    public static rawTail(metadataBuffer: UnsafeBuffer, partitionIndex: number, rawTail?: bigint): bigint | void {
        if (undefined === rawTail) {
            return metadataBuffer.getLongBigInt(
                LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex,
            );
        }

        metadataBuffer.putLongBigInt(
            LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex,
            Long.checkInt64(rawTail),
        );
    }

    /**
     * Set the raw value of the tail for the given partition.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex for the tail counter.
     * @param rawTail        to be stored
     */
    public static rawTailVolatile(metadataBuffer: UnsafeBuffer, partitionIndex: number, rawTail: bigint): void;
    /**
     * Get the raw value of the tail for the given partition.
     *
     * @param metadataBuffer containing the tail counters.
     * @param partitionIndex for the tail counter.
     * @return the raw value of the tail for the current active partition.
     */
    public static rawTailVolatile(metadataBuffer: UnsafeBuffer, partitionIndex: number): bigint;
    /**
     * Get the raw value of the tail for the current active partition.
     *
     * @param metadataBuffer containing the tail counters.
     * @return the raw value of the tail for the current active partition.
     */
    public static rawTailVolatile(metadataBuffer: UnsafeBuffer): bigint;
    public static rawTailVolatile(
        metadataBuffer: UnsafeBuffer,
        partitionIndex?: number,
        rawTail?: bigint,
    ): bigint | void {
        if (undefined === partitionIndex) {
            const index = LogBufferDescriptor.indexByTermCount(LogBufferDescriptor.activeTermCount(metadataBuffer));
            return LogBufferDescriptor.getRawTailHalves(
                metadataBuffer,
                LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * index,
            );
        }

        if (undefined === rawTail) {
            return LogBufferDescriptor.getRawTailHalves(
                metadataBuffer,
                LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex,
            );
        }

        Long.checkInt64(rawTail);
        metadataBuffer.putLongVolatileHalves(
            LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex,
            Number(BigInt.asIntN(32, rawTail)),
            Number(BigInt.asIntN(32, rawTail >> 32n)),
        );
    }

    /**
     * Compare and set the raw value of the tail for the given partition.
     * <p>
     * One atomic 64-bit compare-and-set on the slot ({@link UnsafeBuffer.compareAndSetLongHalves}, spec D16).
     *
     * @param metadataBuffer  containing the tail counters.
     * @param partitionIndex  for the tail counter.
     * @param expectedRawTail expected current value.
     * @param updateRawTail   to be applied.
     * @return true if the update was applied.
     */
    public static casRawTail(
        metadataBuffer: UnsafeBuffer,
        partitionIndex: number,
        expectedRawTail: bigint,
        updateRawTail: bigint,
    ): boolean {
        // checked before the compare, so a bad value writes nothing (spec D5)
        Long.checkInt64(updateRawTail);
        const index = LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * partitionIndex;
        Long.checkInt64(expectedRawTail);
        return metadataBuffer.compareAndSetLongHalves(
            index,
            Number(BigInt.asIntN(32, expectedRawTail)),
            Number(BigInt.asIntN(32, expectedRawTail >> 32n)),
            Number(BigInt.asIntN(32, updateRawTail)),
            Number(BigInt.asIntN(32, updateRawTail >> 32n)),
        );
    }

    private static getRawTailHalves(metadataBuffer: UnsafeBuffer, index: number): bigint {
        metadataBuffer.getLongVolatileHalves(index, RAW_TAIL_HALVES);
        return BigInt.asIntN(64, (BigInt(RAW_TAIL_HALVES[1]!) << 32n) | BigInt(RAW_TAIL_HALVES[0]! >>> 0));
    }

    /**
     * Get the number of bits to shift when dividing or multiplying by the term buffer length.
     *
     * @param termBufferLength to compute the number of bits to shift for.
     * @return the number of bits to shift to divide or multiply by the term buffer length.
     */
    public static positionBitsToShift(termBufferLength: number): number {
        switch (termBufferLength) {
            case 64 * 1024:
                return 16;
            case 128 * 1024:
                return 17;
            case 256 * 1024:
                return 18;
            case 512 * 1024:
                return 19;
            case 1024 * 1024:
                return 20;
            case 2 * 1024 * 1024:
                return 21;
            case 4 * 1024 * 1024:
                return 22;
            case 8 * 1024 * 1024:
                return 23;
            case 16 * 1024 * 1024:
                return 24;
            case 32 * 1024 * 1024:
                return 25;
            case 64 * 1024 * 1024:
                return 26;
            case 128 * 1024 * 1024:
                return 27;
            case 256 * 1024 * 1024:
                return 28;
            case 512 * 1024 * 1024:
                return 29;
            case 1024 * 1024 * 1024:
                return 30;
            default:
                throw new IllegalArgumentException('invalid term buffer length: ' + termBufferLength);
        }
    }

    /**
     * Calculate the total length of a message that has been fragmented, including headers.
     *
     * @param length         of the message to be fragmented.
     * @param maxPayloadSize of each fragment.
     * @return the total length of the fragmented message.
     */
    public static computeFragmentedFrameLength(length: number, maxPayloadSize: number): number {
        if (0 === maxPayloadSize) {
            throw new ArithmeticException('/ by zero');
        }

        const numMaxPayloads = (length / maxPayloadSize) | 0;
        const remainingPayload = length % maxPayloadSize;
        const lastFrameLength = remainingPayload > 0 ? align(remainingPayload + HEADER_LENGTH, FRAME_ALIGNMENT) : 0;

        return (Math.imul(numMaxPayloads, maxPayloadSize + HEADER_LENGTH) + lastFrameLength) | 0;
    }

    /**
     * Calculate the total length of a message that has been assembled from fragments, including a header.
     *
     * @param length         of the message.
     * @param maxPayloadSize of each fragment.
     * @return the total length of the assembled message.
     */
    public static computeAssembledFrameLength(length: number, maxPayloadSize: number): number {
        if (0 === maxPayloadSize) {
            throw new ArithmeticException('/ by zero');
        }

        const numMaxPayloads = (length / maxPayloadSize) | 0;
        const remainingPayload = length % maxPayloadSize;

        return (HEADER_LENGTH + Math.imul(numMaxPayloads, maxPayloadSize) + remainingPayload) | 0;
    }

    /**
     * Get the sparse property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the sparse property.
     */
    public static sparse(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the sparse property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static sparse(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static sparse(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_SPARSE_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_SPARSE_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the tether property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the tether property.
     */
    public static tether(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the tether property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static tether(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static tether(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_TETHER_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_TETHER_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the 'publication revoked' status.
     *
     * @param metadataBuffer containing the metadata.
     * @return the 'publication revoked' status.
     */
    public static isPublicationRevoked(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the 'publication revoked' status.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static isPublicationRevoked(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static isPublicationRevoked(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_IS_PUBLICATION_REVOKED_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_IS_PUBLICATION_REVOKED_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the type of the log buffer, a signed `byte`.
     *
     * @param metadataBuffer containing the metadata.
     * @return the type of the log buffer, a signed `byte`.
     */
    public static type(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the type of the log buffer, a signed `byte`.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static type(metadataBuffer: UnsafeBuffer, value: number): void;
    public static type(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_TYPE_OFFSET);
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_TYPE_OFFSET, value);
    }

    /**
     * Get the group property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the group property.
     */
    public static group(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the group property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static group(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static group(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_GROUP_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_GROUP_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the is-response property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the is-response property.
     */
    public static isResponse(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the is-response property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static isResponse(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static isResponse(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_IS_RESPONSE_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_IS_RESPONSE_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the rejoin property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the rejoin property.
     */
    public static rejoin(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the rejoin property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static rejoin(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static rejoin(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_REJOIN_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_REJOIN_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the reliable property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the reliable property.
     */
    public static reliable(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the reliable property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static reliable(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static reliable(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_RELIABLE_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_RELIABLE_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the socket receive buffer length.
     */
    public static socketRcvbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static socketRcvbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static socketRcvbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_SOCKET_RCVBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_SOCKET_RCVBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the OS default socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the OS default socket receive buffer length.
     */
    public static osDefaultSocketRcvbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the OS default socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static osDefaultSocketRcvbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static osDefaultSocketRcvbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the OS maximum socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the OS maximum socket receive buffer length.
     */
    public static osMaxSocketRcvbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the OS maximum socket receive buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static osMaxSocketRcvbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static osMaxSocketRcvbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the socket send buffer length.
     */
    public static socketSndbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static socketSndbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static socketSndbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_SOCKET_SNDBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_SOCKET_SNDBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the OS default socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the OS default socket send buffer length.
     */
    public static osDefaultSocketSndbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the OS default socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static osDefaultSocketSndbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static osDefaultSocketSndbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the OS maximum socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the OS maximum socket send buffer length.
     */
    public static osMaxSocketSndbufLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the OS maximum socket send buffer length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static osMaxSocketSndbufLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static osMaxSocketSndbufLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET, value);
    }

    /**
     * Get the receiver window length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the receiver window length.
     */
    public static receiverWindowLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the receiver window length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static receiverWindowLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static receiverWindowLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_RECEIVER_WINDOW_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_RECEIVER_WINDOW_LENGTH_OFFSET, value);
    }

    /**
     * Get the publication window length.
     *
     * @param metadataBuffer containing the metadata.
     * @return the publication window length.
     */
    public static publicationWindowLength(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the publication window length.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static publicationWindowLength(metadataBuffer: UnsafeBuffer, value: number): void;
    public static publicationWindowLength(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_PUBLICATION_WINDOW_LENGTH_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_PUBLICATION_WINDOW_LENGTH_OFFSET, value);
    }

    /**
     * Get the untethered window limit timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @return the untethered window limit timeout in nanoseconds.
     */
    public static untetheredWindowLimitTimeoutNs(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the untethered window limit timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static untetheredWindowLimitTimeoutNs(metadataBuffer: UnsafeBuffer, value: number): void;
    public static untetheredWindowLimitTimeoutNs(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getLong(LogBufferDescriptor.LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET);
        }

        metadataBuffer.putLong(LogBufferDescriptor.LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET, value);
    }

    /**
     * Get the untethered linger timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @return the untethered linger timeout in nanoseconds.
     */
    public static untetheredLingerTimeoutNs(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the untethered linger timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static untetheredLingerTimeoutNs(metadataBuffer: UnsafeBuffer, value: number): void;
    public static untetheredLingerTimeoutNs(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getLong(LogBufferDescriptor.LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET);
        }

        metadataBuffer.putLong(LogBufferDescriptor.LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET, value);
    }

    /**
     * Get the untethered resting timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @return the untethered resting timeout in nanoseconds.
     */
    public static untetheredRestingTimeoutNs(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the untethered resting timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static untetheredRestingTimeoutNs(metadataBuffer: UnsafeBuffer, value: number): void;
    public static untetheredRestingTimeoutNs(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getLong(LogBufferDescriptor.LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET);
        }

        metadataBuffer.putLong(LogBufferDescriptor.LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET, value);
    }

    /**
     * Get the max resend.
     *
     * @param metadataBuffer containing the metadata.
     * @return the max resend.
     */
    public static maxResend(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the max resend.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static maxResend(metadataBuffer: UnsafeBuffer, value: number): void;
    public static maxResend(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getInt(LogBufferDescriptor.LOG_MAX_RESEND_OFFSET);
        }

        metadataBuffer.putInt(LogBufferDescriptor.LOG_MAX_RESEND_OFFSET, value);
    }

    /**
     * Get the linger timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @return the linger timeout in nanoseconds.
     */
    public static lingerTimeoutNs(metadataBuffer: UnsafeBuffer): number;
    /**
     * Set the linger timeout in nanoseconds.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static lingerTimeoutNs(metadataBuffer: UnsafeBuffer, value: number): void;
    public static lingerTimeoutNs(metadataBuffer: UnsafeBuffer, value?: number): number | void {
        if (undefined === value) {
            return metadataBuffer.getLong(LogBufferDescriptor.LOG_LINGER_TIMEOUT_NS_OFFSET);
        }

        metadataBuffer.putLong(LogBufferDescriptor.LOG_LINGER_TIMEOUT_NS_OFFSET, value);
    }

    /**
     * Get the entity tag, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @return the entity tag, an opaque 64-bit value, a `bigint` (spec 5.2).
     */
    public static entityTag(metadataBuffer: UnsafeBuffer): bigint;
    /**
     * Set the entity tag, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static entityTag(metadataBuffer: UnsafeBuffer, value: bigint): void;
    public static entityTag(metadataBuffer: UnsafeBuffer, value?: bigint): bigint | void {
        if (undefined === value) {
            return metadataBuffer.getLongBigInt(LogBufferDescriptor.LOG_ENTITY_TAG_OFFSET);
        }

        metadataBuffer.putLongBigInt(LogBufferDescriptor.LOG_ENTITY_TAG_OFFSET, Long.checkInt64(value));
    }

    /**
     * Get the response correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @return the response correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     */
    public static responseCorrelationId(metadataBuffer: UnsafeBuffer): bigint;
    /**
     * Set the response correlation id, an opaque 64-bit value, a `bigint` (spec 5.2).
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static responseCorrelationId(metadataBuffer: UnsafeBuffer, value: bigint): void;
    public static responseCorrelationId(metadataBuffer: UnsafeBuffer, value?: bigint): bigint | void {
        if (undefined === value) {
            return metadataBuffer.getLongBigInt(LogBufferDescriptor.LOG_RESPONSE_CORRELATION_ID_OFFSET);
        }

        metadataBuffer.putLongBigInt(LogBufferDescriptor.LOG_RESPONSE_CORRELATION_ID_OFFSET, Long.checkInt64(value));
    }

    /**
     * Get the signal-eos property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the signal-eos property.
     */
    public static signalEos(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the signal-eos property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static signalEos(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static signalEos(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_SIGNAL_EOS_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_SIGNAL_EOS_OFFSET, value ? 1 : 0);
    }

    /**
     * Get the spies-simulate-connection property.
     *
     * @param metadataBuffer containing the metadata.
     * @return the spies-simulate-connection property.
     */
    public static spiesSimulateConnection(metadataBuffer: UnsafeBuffer): boolean;
    /**
     * Set the spies-simulate-connection property.
     *
     * @param metadataBuffer containing the metadata.
     * @param value to be set.
     */
    public static spiesSimulateConnection(metadataBuffer: UnsafeBuffer, value: boolean): void;
    public static spiesSimulateConnection(metadataBuffer: UnsafeBuffer, value?: boolean): boolean | void {
        if (undefined === value) {
            return metadataBuffer.getByte(LogBufferDescriptor.LOG_SPIES_SIMULATE_CONNECTION_OFFSET) === 1;
        }

        metadataBuffer.putByte(LogBufferDescriptor.LOG_SPIES_SIMULATE_CONNECTION_OFFSET, value ? 1 : 0);
    }
}
