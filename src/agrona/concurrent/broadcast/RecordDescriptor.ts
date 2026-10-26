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
// Port of org/agrona/concurrent/broadcast/RecordDescriptor.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { IllegalArgumentException } from '../../jdk.js';

const { SIZE_OF_INT } = BitUtil;

/**
 * Description of the structure for message framing in the broadcast buffer.
 */
export class RecordDescriptor {
    /**
     * Message type is padding to prevent fragmentation in the buffer.
     */
    public static readonly PADDING_MSG_TYPE_ID: number = -1;

    /**
     * Offset within the record at which the record length field begins.
     */
    public static readonly LENGTH_OFFSET: number = 0;

    /**
     * Offset within the record at which the message type field begins.
     */
    public static readonly TYPE_OFFSET: number = RecordDescriptor.LENGTH_OFFSET + SIZE_OF_INT;

    /**
     * Length of the record header in bytes.
     */
    public static readonly HEADER_LENGTH: number = SIZE_OF_INT * 2;

    /**
     * Alignment as a multiple of bytes for each record.
     */
    public static readonly RECORD_ALIGNMENT: number = RecordDescriptor.HEADER_LENGTH;

    private constructor() {}

    /**
     * Calculate the maximum supported message length for a buffer of given capacity.
     *
     * @param capacity of the log buffer.
     * @return the maximum supported size for a message.
     */
    public static calculateMaxMessageLength(capacity: number): number {
        return (capacity / 8) | 0;
    }

    /**
     * The buffer offset at which the message length field begins.
     *
     * @param recordOffset at which the frame begins.
     * @return the offset at which the message length field begins.
     */
    public static lengthOffset(recordOffset: number): number {
        return recordOffset + RecordDescriptor.LENGTH_OFFSET;
    }

    /**
     * The buffer offset at which the message type field begins.
     *
     * @param recordOffset at which the frame begins.
     * @return the offset at which the message type field begins.
     */
    public static typeOffset(recordOffset: number): number {
        return recordOffset + RecordDescriptor.TYPE_OFFSET;
    }

    /**
     * The buffer offset at which the encoded message begins.
     *
     * @param recordOffset at which the frame begins.
     * @return the offset at which the encoded message begins.
     */
    public static msgOffset(recordOffset: number): number {
        return recordOffset + RecordDescriptor.HEADER_LENGTH;
    }

    /**
     * Check that and message id is in the valid range.
     *
     * @param msgTypeId to be checked.
     * @throws IllegalArgumentException if the id is not in the valid range.
     */
    public static checkTypeId(msgTypeId: number): void {
        if (msgTypeId < 1) {
            const msg = 'type id must be greater than zero, msgTypeId=' + msgTypeId;
            throw new IllegalArgumentException(msg);
        }
    }
}
