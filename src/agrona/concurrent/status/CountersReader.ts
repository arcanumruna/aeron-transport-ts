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
// Port of org/agrona/concurrent/status/CountersReader.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { DirectBuffer } from '../../DirectBuffer.js';
import { IllegalArgumentException, Long } from '../../jdk.js';
import { StandardCharsets } from '../../jdkLang.js';
import type { Charset } from '../../jdkLang.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { UnsafeBuffer } from '../UnsafeBuffer.js';
import type { IntObjConsumer } from '../../collections/IntObjConsumer.js';

const { SIZE_OF_INT, SIZE_OF_LONG, CACHE_LINE_LENGTH } = BitUtil;

/**
 * Callback function for consuming metadata records of counters. The Java functional interface is a function type.
 *
 * @param counterId of the counter.
 * @param typeId    of the counter.
 * @param keyBuffer for the counter.
 * @param label     for the counter.
 */
export type MetaData = (counterId: number, typeId: number, keyBuffer: DirectBuffer, label: string) => void;

/**
 * Callback function for consuming basic counter details and value. The Java functional interface is a function type.
 *
 * @param value     of the counter.
 * @param counterId of the counter
 * @param label     for the counter.
 */
export type CounterConsumer = (value: number, counterId: number, label: string) => void;

/**
 * Reads the counters metadata and values buffers.
 * <p>
 * This class is threadsafe and can be used across threads.
 * <p>
 * <b>Values Buffer</b>
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                        Counter Value                          |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                       Registration Id                         |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                          Owner Id                             |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                        Reference Id                           |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                      96 bytes of padding                     ...
 * ...                                                              |
 *  +---------------------------------------------------------------+
 *  |                   Repeats to end of buffer                   ...
 *  |                                                               |
 * ...                                                              |
 *  +---------------------------------------------------------------+
 * </pre>
 * <p>
 * <b>Meta Data Buffer</b>
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                        Record State                           |
 *  +---------------------------------------------------------------+
 *  |                          Type Id                              |
 *  +---------------------------------------------------------------+
 *  |                  Free-for-reuse Deadline (ms)                 |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                      112 bytes for key                       ...
 * ...                                                              |
 *  +-+-------------------------------------------------------------+
 *  |R|                      Label Length                           |
 *  +-+-------------------------------------------------------------+
 *  |                     380 bytes of Label                       ...
 * ...                                                              |
 *  +---------------------------------------------------------------+
 *  |                   Repeats to end of buffer                   ...
 *  |                                                               |
 * ...                                                              |
 *  +---------------------------------------------------------------+
 * </pre>
 * <p>
 * The values are Java {@code long}s held in {@code number}s (spec D5), so {@link CountersReader.NOT_FREE_TO_REUSE}
 * is 2^53 - 1, not 2^63 - 1. Java's three {@code forEach} overloads, which differ only in the type of the functional
 * interface, are {@link CountersReader.forEach} (label), {@link CountersReader.forEachCounterConsumer} and
 * {@link CountersReader.forEachMetaData}.
 */
export class CountersReader {
    /**
     * Default type id of a counter when none is supplied.
     */
    public static readonly DEFAULT_TYPE_ID = 0;

    /**
     * Default registration id of a counter when none is set.
     */
    public static readonly DEFAULT_REGISTRATION_ID = 0;

    /**
     * Default owner id of a counter when none is set.
     */
    public static readonly DEFAULT_OWNER_ID = 0;

    /**
     * Default reference id of a counter when none is set.
     */
    public static readonly DEFAULT_REFERENCE_ID = 0;

    /**
     * Can be used to representing a null counter id when passed as an argument.
     */
    public static readonly NULL_COUNTER_ID = -1;

    /**
     * Record has not been used.
     */
    public static readonly RECORD_UNUSED = 0;

    /**
     * Record currently allocated for use.
     */
    public static readonly RECORD_ALLOCATED = 1;

    /**
     * Record was active and now has been reclaimed.
     */
    public static readonly RECORD_RECLAIMED = -1;

    /**
     * Deadline to indicate counter is not free to be reused.
     */
    public static readonly NOT_FREE_TO_REUSE = Long.MAX_VALUE;

    /**
     * Offset in the record at which the registration id field is stored. When a counter is allocated the action
     * can be given a registration id to indicate a specific term of use. This can be useful to differentiate the
     * reuse of a counter id for another purpose even with the same type id.
     */
    public static readonly REGISTRATION_ID_OFFSET = SIZE_OF_LONG;

    /**
     * Offset in the record at which the owner id field is stored. The owner is an abstract concept which can be
     * used to associate counters to an owner for lifecycle management.
     */
    public static readonly OWNER_ID_OFFSET = CountersReader.REGISTRATION_ID_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the record at which the reference id field is stored. This id can be used to associate this
     * counter with a registration id for something else, such as an Image, Subscription, Publication, etc.
     */
    public static readonly REFERENCE_ID_OFFSET = CountersReader.OWNER_ID_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the record at which the type id field is stored.
     */
    public static readonly TYPE_ID_OFFSET = SIZE_OF_INT;

    /**
     * Offset in the record at which the deadline (in milliseconds) for when counter may be reused.
     */
    public static readonly FREE_FOR_REUSE_DEADLINE_OFFSET = CountersReader.TYPE_ID_OFFSET + SIZE_OF_INT;

    /**
     * Offset in the record at which the key is stored.
     */
    public static readonly KEY_OFFSET = CountersReader.FREE_FOR_REUSE_DEADLINE_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the record at which the label is stored.
     */
    public static readonly LABEL_OFFSET = CACHE_LINE_LENGTH * 2;

    /**
     * Length of a counter label length including length prefix.
     */
    public static readonly FULL_LABEL_LENGTH = CACHE_LINE_LENGTH * 6;

    /**
     * Maximum length of a label not including its length prefix.
     */
    public static readonly MAX_LABEL_LENGTH = CountersReader.FULL_LABEL_LENGTH - SIZE_OF_INT;

    /**
     * Maximum length a key can be.
     */
    public static readonly MAX_KEY_LENGTH = CACHE_LINE_LENGTH * 2 - SIZE_OF_INT * 2 - SIZE_OF_LONG;

    /**
     * Length of a metadata record in bytes.
     */
    public static readonly METADATA_LENGTH = CountersReader.LABEL_OFFSET + CountersReader.FULL_LABEL_LENGTH;

    /**
     * Length of the space allocated to a counter that includes padding to avoid false sharing.
     */
    public static readonly COUNTER_LENGTH = CACHE_LINE_LENGTH * 2;

    /**
     * Max counter ID.
     */
    protected readonly _maxCounterId: number = 0;

    /**
     * Meta-data buffer.
     */
    protected readonly _metaDataBuffer: AtomicBuffer;

    /**
     * Values buffer.
     */
    protected readonly _valuesBuffer: AtomicBuffer;

    /**
     * Charset for the label.
     */
    protected readonly _labelCharset: Charset;

    /**
     * Construct a reader over buffers containing the values and associated metadata.
     * <p>
     * Counter labels default to {@link StandardCharsets.UTF_8}.
     *
     * @param metaDataBuffer containing the counter metadata.
     * @param valuesBuffer   containing the counter values.
     * @param labelCharset   for the label encoding.
     */
    public constructor(
        metaDataBuffer: AtomicBuffer,
        valuesBuffer: AtomicBuffer,
        labelCharset: Charset = StandardCharsets.UTF_8,
    ) {
        this._maxCounterId = Math.trunc(valuesBuffer.capacity() / CountersReader.COUNTER_LENGTH) - 1;
        this._valuesBuffer = valuesBuffer;
        this._metaDataBuffer = metaDataBuffer;
        this._labelCharset = labelCharset;
    }

    /**
     * Get the maximum counter id which can be supported given the length of the values buffer.
     *
     * @return the maximum counter id which can be supported given the length of the values buffer.
     */
    public maxCounterId(): number {
        return this._maxCounterId;
    }

    /**
     * Get the buffer containing the metadata for the counters.
     *
     * @return the buffer containing the metadata for the counters.
     */
    public metaDataBuffer(): AtomicBuffer {
        return this._metaDataBuffer;
    }

    /**
     * Get the buffer containing the values for the counters.
     *
     * @return the buffer containing the values for the counters.
     */
    public valuesBuffer(): AtomicBuffer {
        return this._valuesBuffer;
    }

    /**
     * The {@link Charset} used for the encoded label.
     *
     * @return the {@link Charset} used for the encoded label.
     */
    public labelCharset(): Charset {
        return this._labelCharset;
    }

    /**
     * The offset in the counter buffer for a given counterId.
     *
     * @param counterId for which the offset should be provided.
     * @return the offset in the counter buffer.
     */
    public static counterOffset(counterId: number): number {
        return counterId * CountersReader.COUNTER_LENGTH;
    }

    /**
     * The offset in the metadata buffer for a given id.
     *
     * @param counterId for the record.
     * @return the offset at which the metadata record begins.
     */
    public static metaDataOffset(counterId: number): number {
        return counterId * CountersReader.METADATA_LENGTH;
    }

    /**
     * Iterate over all labels in the label buffer.
     *
     * @param consumer function to be called for each label, with the counter id and the label.
     */
    public forEach(consumer: IntObjConsumer<string>): void {
        let counterId = 0;
        const metaDataBuffer = this._metaDataBuffer;

        for (let i = 0, capacity = metaDataBuffer.capacity(); i < capacity; i += CountersReader.METADATA_LENGTH) {
            const recordStatus = metaDataBuffer.getIntVolatile(i);

            if (CountersReader.RECORD_ALLOCATED === recordStatus) {
                consumer(counterId, this.labelValue(metaDataBuffer, i));
            } else if (CountersReader.RECORD_UNUSED === recordStatus) {
                break;
            }

            counterId++;
        }
    }

    /**
     * Iterate over the counters and provide the value and basic metadata. It is the Java {@code forEach} that takes a
     * {@code CounterConsumer}.
     *
     * @param consumer for each allocated counter.
     */
    public forEachCounterConsumer(consumer: CounterConsumer): void {
        let counterId = 0;
        const metaDataBuffer = this._metaDataBuffer;
        const valuesBuffer = this._valuesBuffer;

        for (
            let offset = 0, capacity = metaDataBuffer.capacity();
            offset < capacity;
            offset += CountersReader.METADATA_LENGTH
        ) {
            const recordStatus = metaDataBuffer.getIntVolatile(offset);
            if (CountersReader.RECORD_ALLOCATED === recordStatus) {
                const label = this.labelValue(metaDataBuffer, offset);
                const value = valuesBuffer.getLongVolatile(CountersReader.counterOffset(counterId));

                consumer(value, counterId, label);
            } else if (CountersReader.RECORD_UNUSED === recordStatus) {
                break;
            }

            counterId++;
        }
    }

    /**
     * Iterate over all the metadata in the buffer. It is the Java {@code forEach} that takes a {@code MetaData}.
     *
     * @param metaData function to be called for each metadata record.
     */
    public forEachMetaData(metaData: MetaData): void {
        let counterId = 0;
        const metaDataBuffer = this._metaDataBuffer;

        for (
            let offset = 0, capacity = metaDataBuffer.capacity();
            offset < capacity;
            offset += CountersReader.METADATA_LENGTH
        ) {
            const recordStatus = metaDataBuffer.getIntVolatile(offset);
            if (CountersReader.RECORD_ALLOCATED === recordStatus) {
                const typeId = metaDataBuffer.getInt(offset + CountersReader.TYPE_ID_OFFSET);
                const label = this.labelValue(metaDataBuffer, offset);
                const keyBuffer: DirectBuffer = new UnsafeBuffer(
                    metaDataBuffer,
                    offset + CountersReader.KEY_OFFSET,
                    CountersReader.MAX_KEY_LENGTH,
                );

                metaData(counterId, typeId, keyBuffer, label);
            } else if (CountersReader.RECORD_UNUSED === recordStatus) {
                break;
            }

            counterId++;
        }
    }

    /**
     * Iterate over allocated counters and find the first matching a given registration id.
     *
     * @param registrationId to find.
     * @return the counter if found otherwise {@link CountersReader.NULL_COUNTER_ID}.
     */
    public findByRegistrationId(registrationId: number): number {
        let counterId = -1;
        const metaDataBuffer = this._metaDataBuffer;
        const capacity = metaDataBuffer.capacity();

        for (let offset = 0, i = 0; offset < capacity; offset += CountersReader.METADATA_LENGTH, i++) {
            const recordStatus = metaDataBuffer.getIntVolatile(offset);
            if (CountersReader.RECORD_ALLOCATED === recordStatus) {
                if (
                    registrationId ===
                    this._valuesBuffer.getLongVolatile(
                        CountersReader.counterOffset(i) + CountersReader.REGISTRATION_ID_OFFSET,
                    )
                ) {
                    counterId = i;
                    break;
                }
            } else if (CountersReader.RECORD_UNUSED === recordStatus) {
                break;
            }
        }

        return counterId;
    }

    /**
     * Iterate over allocated counters and find the first matching a given type id and registration id.
     *
     * @param typeId         to find.
     * @param registrationId to find.
     * @return the counter if found otherwise {@link CountersReader.NULL_COUNTER_ID}.
     */
    public findByTypeIdAndRegistrationId(typeId: number, registrationId: number): number {
        let counterId = -1;
        const metaDataBuffer = this._metaDataBuffer;
        const capacity = metaDataBuffer.capacity();

        for (let offset = 0, i = 0; offset < capacity; offset += CountersReader.METADATA_LENGTH, i++) {
            const recordStatus = metaDataBuffer.getIntVolatile(offset);
            if (CountersReader.RECORD_ALLOCATED === recordStatus) {
                if (
                    typeId === metaDataBuffer.getInt(offset + CountersReader.TYPE_ID_OFFSET) &&
                    registrationId ===
                        this._valuesBuffer.getLongVolatile(
                            CountersReader.counterOffset(i) + CountersReader.REGISTRATION_ID_OFFSET,
                        )
                ) {
                    counterId = i;
                    break;
                }
            } else if (CountersReader.RECORD_UNUSED === recordStatus) {
                break;
            }
        }

        return counterId;
    }

    /**
     * Get the value for a given counter id as a volatile read.
     *
     * @param counterId to be read.
     * @return the current value of the counter.
     */
    public getCounterValue(counterId: number): number {
        this.validateCounterId(counterId);
        return this._valuesBuffer.getLongVolatile(CountersReader.counterOffset(counterId));
    }

    /**
     * Get the registration id for a given counter id as a volatile read. The registration identity may be assigned
     * when the counter is allocated to help avoid ABA issues if the counter id is reused.
     *
     * @param counterId to be read.
     * @return the current registration id of the counter.
     * @see CountersReader.DEFAULT_REGISTRATION_ID
     */
    public getCounterRegistrationId(counterId: number): number {
        this.validateCounterId(counterId);
        return this._valuesBuffer.getLongVolatile(
            CountersReader.counterOffset(counterId) + CountersReader.REGISTRATION_ID_OFFSET,
        );
    }

    /**
     * Get the owner id for a given counter id as a normal read. The owner identity may be assigned when the
     * counter is allocated to help associate it with the abstract concept of an owner for lifecycle management.
     *
     * @param counterId to be read.
     * @return the current owner id of the counter.
     * @see CountersReader.DEFAULT_OWNER_ID
     */
    public getCounterOwnerId(counterId: number): number {
        this.validateCounterId(counterId);
        return this._valuesBuffer.getLongVolatile(
            CountersReader.counterOffset(counterId) + CountersReader.OWNER_ID_OFFSET,
        );
    }

    /**
     * Get the reference id for a given counter id as a normal read. The id may be assigned when the
     * counter is allocated to help associate this counter with a registration id for an Image, Subscription,
     * Publication, etc.
     *
     * @param counterId to be read.
     * @return the current reference id of the counter.
     * @see CountersReader.DEFAULT_REFERENCE_ID
     */
    public getCounterReferenceId(counterId: number): number {
        this.validateCounterId(counterId);
        return this._valuesBuffer.getLongVolatile(
            CountersReader.counterOffset(counterId) + CountersReader.REFERENCE_ID_OFFSET,
        );
    }

    /**
     * Get the state for a given counter id as a volatile read.
     *
     * @param counterId to be read.
     * @return the current state of the counter.
     * @see CountersReader.RECORD_UNUSED
     * @see CountersReader.RECORD_ALLOCATED
     * @see CountersReader.RECORD_RECLAIMED
     */
    public getCounterState(counterId: number): number {
        this.validateCounterId(counterId);
        return this._metaDataBuffer.getIntVolatile(CountersReader.metaDataOffset(counterId));
    }

    /**
     * Get the type id for a given counter id.
     *
     * @param counterId to be read.
     * @return the type id for a given counter id.
     * @see CountersReader.DEFAULT_TYPE_ID
     */
    public getCounterTypeId(counterId: number): number {
        this.validateCounterId(counterId);
        return this._metaDataBuffer.getInt(CountersReader.metaDataOffset(counterId) + CountersReader.TYPE_ID_OFFSET);
    }

    /**
     * Get the deadline (ms) for when a given counter id may be reused.
     *
     * @param counterId to be read.
     * @return deadline (ms) for when a given counter id may be reused or {@link CountersReader.NOT_FREE_TO_REUSE} if
     * currently in use.
     */
    public getFreeForReuseDeadline(counterId: number): number {
        this.validateCounterId(counterId);
        return this._metaDataBuffer.getLongVolatile(
            CountersReader.metaDataOffset(counterId) + CountersReader.FREE_FOR_REUSE_DEADLINE_OFFSET,
        );
    }

    /**
     * Get the label for a given counter id as a volatile read.
     *
     * @param counterId to be read.
     * @return the label for the given counter id.
     */
    public getCounterLabel(counterId: number): string {
        this.validateCounterId(counterId);
        return this.labelValue(this._metaDataBuffer, CountersReader.metaDataOffset(counterId));
    }

    /**
     * Validate if counter Id is valid.
     *
     * @param counterId to validate.
     * @throws IllegalArgumentException if {@code counterId < 0 || counterId > maxCounterId}.
     */
    protected validateCounterId(counterId: number): void {
        if (counterId < 0 || counterId > this._maxCounterId) {
            throw new IllegalArgumentException(
                'counter id ' + counterId + ' out of range: 0 - maxCounterId=' + this._maxCounterId,
            );
        }
    }

    private labelValue(metaDataBuffer: AtomicBuffer, recordOffset: number): string {
        const labelLength = metaDataBuffer.getIntVolatile(recordOffset + CountersReader.LABEL_OFFSET);
        const stringInBytes = new Uint8Array(labelLength);
        metaDataBuffer.getBytes(recordOffset + CountersReader.LABEL_OFFSET + SIZE_OF_INT, stringInBytes);

        return this._labelCharset.decode(stringInBytes);
    }
}
