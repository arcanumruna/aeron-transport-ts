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
// Port of org/agrona/concurrent/status/CountersManager.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import { IntArrayList } from '../../collections/IntArrayList.js';
import type { DirectBuffer } from '../../DirectBuffer.js';
import { IllegalArgumentException, IllegalStateException } from '../../jdk.js';
import { StandardCharsets } from '../../jdkLang.js';
import type { Charset } from '../../jdkLang.js';
import { LangUtil } from '../../LangUtil.js';
import type { MutableDirectBuffer } from '../../MutableDirectBuffer.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { CachedEpochClock } from '../CachedEpochClock.js';
import type { EpochClock } from '../EpochClock.js';
import { UnsafeBuffer } from '../UnsafeBuffer.js';
import { AtomicCounter } from './AtomicCounter.js';
import { CountersReader } from './CountersReader.js';

const { SIZE_OF_INT } = BitUtil;

const {
    DEFAULT_TYPE_ID,
    DEFAULT_REGISTRATION_ID,
    DEFAULT_OWNER_ID,
    DEFAULT_REFERENCE_ID,
    RECORD_ALLOCATED,
    RECORD_RECLAIMED,
    NOT_FREE_TO_REUSE,
    REGISTRATION_ID_OFFSET,
    OWNER_ID_OFFSET,
    REFERENCE_ID_OFFSET,
    TYPE_ID_OFFSET,
    FREE_FOR_REUSE_DEADLINE_OFFSET,
    KEY_OFFSET,
    LABEL_OFFSET,
    MAX_LABEL_LENGTH,
    MAX_KEY_LENGTH,
    METADATA_LENGTH,
    COUNTER_LENGTH,
} = CountersReader;

/**
 * Manages the allocation and freeing of counters that are normally stored in a memory-mapped file.
 * <p>
 * This class in not threadsafe. Counters should be centrally managed.
 * <p>
 * The layout of the values and metadata buffers is described in {@link CountersReader}. Allocation and freeing
 * touch only the buffers, a few fields and the free list, which grows only when more counters are freed than before;
 * the counters themselves ({@link AtomicCounter}) allocate nothing per operation.
 */
export class CountersManager extends CountersReader {
    private readonly freeToReuseTimeoutMs: number = 0;
    private highWaterMarkId = -1;
    private readonly freeList = new IntArrayList();
    private readonly epochClock: EpochClock;

    /**
     * Create a new counter manager over two buffers.
     *
     * @param metaDataBuffer       containing the types, keys, and labels for the counters.
     * @param valuesBuffer         containing the values of the counters themselves.
     * @param labelCharset         for the label encoding; UTF-8 if omitted.
     * @param epochClock           to use for determining time for keep counter from being reused after being freed;
     *                             a {@link CachedEpochClock} if omitted.
     * @param freeToReuseTimeoutMs timeout (in milliseconds) to keep counter from being reused after being freed; 0 if
     *                             omitted.
     */
    public constructor(
        metaDataBuffer: AtomicBuffer,
        valuesBuffer: AtomicBuffer,
        labelCharset: Charset = StandardCharsets.UTF_8,
        epochClock: EpochClock = new CachedEpochClock(),
        freeToReuseTimeoutMs = 0,
    ) {
        super(metaDataBuffer, valuesBuffer, labelCharset);

        valuesBuffer.verifyAlignment();
        this.epochClock = epochClock;
        this.freeToReuseTimeoutMs = freeToReuseTimeoutMs;

        if (metaDataBuffer.capacity() < valuesBuffer.capacity() * (METADATA_LENGTH / COUNTER_LENGTH)) {
            throw new IllegalArgumentException('metadata buffer is too small');
        }
    }

    /**
     * Capacity as a count of counters which can be allocated.
     *
     * @return capacity as a count of counters which can be allocated.
     */
    public capacity(): number {
        return this._maxCounterId + 1;
    }

    /**
     * Number of counters available to be allocated which is a function of {@link CountersManager.capacity} minus the
     * number already allocated.
     *
     * @return the number of counter available to be allocated.
     */
    public available(): number {
        let freeListCount = 0;

        if (!this.freeList.isEmpty()) {
            const nowMs = this.epochClock.time();

            for (let i = 0, size = this.freeList.size(); i < size; i++) {
                const counterId = this.freeList.getInt(i);
                if (
                    nowMs >=
                    this._metaDataBuffer.getLongVolatile(
                        CountersReader.metaDataOffset(counterId) + FREE_FOR_REUSE_DEADLINE_OFFSET,
                    )
                ) {
                    freeListCount++;
                }
            }
        }

        return this.capacity() - this.highWaterMarkId - 1 + freeListCount;
    }

    /**
     * Allocate a new counter with a given label with a default type of {@link CountersReader.DEFAULT_TYPE_ID}.
     *
     * @param label to describe the counter.
     * @return the id allocated for the counter.
     */
    public allocate(label: string): number;

    /**
     * Allocate a new counter with a given label and type.
     *
     * @param label  to describe the counter.
     * @param typeId for the type of counter.
     * @return the id allocated for the counter.
     */
    public allocate(label: string, typeId: number): number;

    /**
     * Allocate a new counter with a given label.
     * <p>
     * The key function will be called with a buffer with the exact length of available key space
     * in the record for the user to store what they want for the key. No offset is required.
     *
     * @param label   to describe the counter.
     * @param typeId  for the type of counter.
     * @param keyFunc for setting the key value for the counter.
     * @return the id allocated for the counter.
     */
    public allocate(label: string, typeId: number, keyFunc: (keyBuffer: MutableDirectBuffer) => void): number;

    /**
     * Allocate a counter with the minimum of allocation by allowing the label a key to be provided and copied.
     * <p>
     * If the keyBuffer is null then a copy of the key is not attempted.
     *
     * @param typeId      for the counter.
     * @param keyBuffer   containing the optional key for the counter.
     * @param keyOffset   within the keyBuffer at which the key begins.
     * @param keyLength   of the key in the keyBuffer.
     * @param labelBuffer containing the mandatory label for the counter.
     * @param labelOffset within the labelBuffer at which the label begins.
     * @param labelLength of the label in the labelBuffer.
     * @return the id allocated for the counter.
     */
    public allocate(
        typeId: number,
        keyBuffer: DirectBuffer | null,
        keyOffset: number,
        keyLength: number,
        labelBuffer: DirectBuffer,
        labelOffset: number,
        labelLength: number,
    ): number;

    public allocate(
        arg0: string | number,
        arg1?: number | DirectBuffer | null,
        arg2?: number | ((keyBuffer: MutableDirectBuffer) => void),
        keyLength?: number,
        labelBuffer?: DirectBuffer,
        labelOffset?: number,
        labelLength?: number,
    ): number {
        if ('string' === typeof arg0) {
            const label = arg0;
            const typeId = (arg1 as number | undefined) ?? DEFAULT_TYPE_ID;
            const keyFunc = arg2 as ((keyBuffer: MutableDirectBuffer) => void) | undefined;

            if (undefined === keyFunc) {
                return this.allocateLabel(label, typeId);
            }

            return this.allocateLabelKeyFunc(label, typeId, keyFunc);
        }

        return this.allocateRaw(
            arg0,
            arg1 as DirectBuffer | null,
            arg2 as number,
            keyLength!,
            labelBuffer!,
            labelOffset!,
            labelLength!,
        );
    }

    /**
     * Allocate a counter record and wrap it with a new {@link AtomicCounter} for use with a default type
     * of {@link CountersReader.DEFAULT_TYPE_ID}.
     *
     * @param label to describe the counter.
     * @return a newly allocated {@link AtomicCounter}
     */
    public newCounter(label: string): AtomicCounter;

    /**
     * Allocate a counter record and wrap it with a new {@link AtomicCounter} for use.
     *
     * @param label  to describe the counter.
     * @param typeId for the type of counter.
     * @return a newly allocated {@link AtomicCounter}
     */
    public newCounter(label: string, typeId: number): AtomicCounter;

    /**
     * Allocate a counter record and wrap it with a new {@link AtomicCounter} for use.
     *
     * @param label   to describe the counter.
     * @param typeId  for the type of counter.
     * @param keyFunc for setting the key value for the counter.
     * @return a newly allocated {@link AtomicCounter}
     */
    public newCounter(label: string, typeId: number, keyFunc: (keyBuffer: MutableDirectBuffer) => void): AtomicCounter;

    /**
     * Allocate a counter record and wrap it with a new {@link AtomicCounter} for use.
     * <p>
     * If the keyBuffer is null then a copy of the key is not attempted.
     *
     * @param typeId      for the counter.
     * @param keyBuffer   containing the optional key for the counter.
     * @param keyOffset   within the keyBuffer at which the key begins.
     * @param keyLength   of the key in the keyBuffer.
     * @param labelBuffer containing the mandatory label for the counter.
     * @param labelOffset within the labelBuffer at which the label begins.
     * @param labelLength of the label in the labelBuffer.
     * @return the id allocated for the counter.
     */
    public newCounter(
        typeId: number,
        keyBuffer: DirectBuffer | null,
        keyOffset: number,
        keyLength: number,
        labelBuffer: DirectBuffer,
        labelOffset: number,
        labelLength: number,
    ): AtomicCounter;

    public newCounter(
        arg0: string | number,
        arg1?: number | DirectBuffer | null,
        arg2?: number | ((keyBuffer: MutableDirectBuffer) => void),
        keyLength?: number,
        labelBuffer?: DirectBuffer,
        labelOffset?: number,
        labelLength?: number,
    ): AtomicCounter {
        const counterId =
            'string' === typeof arg0
                ? this.allocate(arg0, (arg1 as number | undefined) ?? DEFAULT_TYPE_ID, arg2 as never)
                : this.allocate(
                      arg0,
                      arg1 as DirectBuffer | null,
                      arg2 as number,
                      keyLength!,
                      labelBuffer!,
                      labelOffset!,
                      labelLength!,
                  );

        return new AtomicCounter(this._valuesBuffer, counterId, this);
    }

    /**
     * Free the counter identified by counterId.
     *
     * @param counterId the counter to freed
     */
    public free(counterId: number): void {
        this.validateCounterId(counterId);
        const offset = CountersReader.metaDataOffset(counterId);

        if (RECORD_ALLOCATED !== this._metaDataBuffer.getIntVolatile(offset)) {
            throw new IllegalStateException('counter not allocated: id=' + counterId);
        }

        this._metaDataBuffer.putIntRelease(offset, RECORD_RECLAIMED);
        this._metaDataBuffer.setMemory(offset + KEY_OFFSET, MAX_KEY_LENGTH, 0);
        this._metaDataBuffer.putLongRelease(
            offset + FREE_FOR_REUSE_DEADLINE_OFFSET,
            this.epochClock.time() + this.freeToReuseTimeoutMs,
        );
        this.freeList.addInt(counterId);
    }

    /**
     * Set an {@link AtomicCounter} value based for a counter id with ordered memory ordering.
     *
     * @param counterId to be set.
     * @param value     to set for the counter.
     */
    public setCounterValue(counterId: number, value: number): void {
        this.validateCounterId(counterId);
        this._valuesBuffer.putLongRelease(CountersReader.counterOffset(counterId), value);
    }

    /**
     * Set an {@link AtomicCounter} registration id for a counter id with ordered memory ordering.
     *
     * @param counterId      to be set.
     * @param registrationId to set for the counter.
     */
    public setCounterRegistrationId(counterId: number, registrationId: number): void {
        this.validateCounterId(counterId);
        this._valuesBuffer.putLongRelease(
            CountersReader.counterOffset(counterId) + REGISTRATION_ID_OFFSET,
            registrationId,
        );
    }

    /**
     * Set an {@link AtomicCounter} owner id for a counter id.
     *
     * @param counterId to be set.
     * @param ownerId   to set for the counter.
     */
    public setCounterOwnerId(counterId: number, ownerId: number): void {
        this.validateCounterId(counterId);
        this._valuesBuffer.putLongRelease(CountersReader.counterOffset(counterId) + OWNER_ID_OFFSET, ownerId);
    }

    /**
     * Set an {@link AtomicCounter} reference id for a counter id.
     *
     * @param counterId   to be set.
     * @param referenceId to set for the counter.
     */
    public setCounterReferenceId(counterId: number, referenceId: number): void {
        this.validateCounterId(counterId);
        this._valuesBuffer.putLongRelease(CountersReader.counterOffset(counterId) + REFERENCE_ID_OFFSET, referenceId);
    }

    /**
     * Set an {@link AtomicCounter} label by counter id.
     *
     * @param counterId to be set.
     * @param label     to set for the counter.
     */
    public setCounterLabel(counterId: number, label: string): void {
        this.validateCounterId(counterId);
        this.putLabel(CountersReader.metaDataOffset(counterId), label);
    }

    /**
     * Set an {@link AtomicCounter} key by on counter id, using a consumer callback to update the key metadata buffer.
     *
     * @param counterId to be set.
     * @param keyFunc   callback used to set the key.
     */
    public setCounterKey(counterId: number, keyFunc: (keyBuffer: MutableDirectBuffer) => void): void;

    /**
     * Set an {@link AtomicCounter} key by on counter id, copying the key metadata from the supplied buffer.
     *
     * @param counterId to be set.
     * @param keyBuffer containing the updated key.
     * @param offset    offset into buffer.
     * @param length    length of data to copy.
     */
    public setCounterKey(counterId: number, keyBuffer: DirectBuffer, offset: number, length: number): void;

    public setCounterKey(
        counterId: number,
        arg1: ((keyBuffer: MutableDirectBuffer) => void) | DirectBuffer,
        offset?: number,
        length?: number,
    ): void {
        this.validateCounterId(counterId);

        if ('function' === typeof arg1) {
            arg1(
                new UnsafeBuffer(
                    this._metaDataBuffer,
                    CountersReader.metaDataOffset(counterId) + KEY_OFFSET,
                    MAX_KEY_LENGTH,
                ),
            );
        } else {
            if (length! > MAX_KEY_LENGTH) {
                throw new IllegalArgumentException('key is too long: ' + length + ', max: ' + MAX_KEY_LENGTH);
            }

            this._metaDataBuffer.putBytes(
                CountersReader.metaDataOffset(counterId) + KEY_OFFSET,
                arg1,
                offset!,
                length!,
            );
        }
    }

    /**
     * Set an {@link AtomicCounter} label based on counter id.
     *
     * @param counterId to be set.
     * @param label     to set for the counter.
     */
    public appendToLabel(counterId: number, label: string): void {
        this.appendLabel(CountersReader.metaDataOffset(counterId), label);
    }

    public override toString(): string {
        return (
            this.constructor.name +
            '{' +
            'freeToReuseTimeoutMs=' +
            this.freeToReuseTimeoutMs +
            ', highWaterMarkId=' +
            this.highWaterMarkId +
            ', freeList=' +
            this.freeList +
            ', epochClock=' +
            this.epochClock +
            '}'
        );
    }

    private allocateLabel(label: string, typeId: number): number {
        const counterId = this.nextCounterId();
        const recordOffset = CountersReader.metaDataOffset(counterId);

        try {
            this._metaDataBuffer.putInt(recordOffset + TYPE_ID_OFFSET, typeId);
            this._metaDataBuffer.putLongRelease(recordOffset + FREE_FOR_REUSE_DEADLINE_OFFSET, NOT_FREE_TO_REUSE);
            this.putLabel(recordOffset, label);

            this._metaDataBuffer.putIntRelease(recordOffset, RECORD_ALLOCATED);
        } catch (ex) {
            this.freeList.pushInt(counterId);
            LangUtil.rethrowUnchecked(ex as Error);
        }

        return counterId;
    }

    private allocateLabelKeyFunc(
        label: string,
        typeId: number,
        keyFunc: (keyBuffer: MutableDirectBuffer) => void,
    ): number {
        const counterId = this.nextCounterId();

        try {
            const recordOffset = CountersReader.metaDataOffset(counterId);

            this._metaDataBuffer.putInt(recordOffset + TYPE_ID_OFFSET, typeId);
            keyFunc(new UnsafeBuffer(this._metaDataBuffer, recordOffset + KEY_OFFSET, MAX_KEY_LENGTH));
            this._metaDataBuffer.putLongRelease(recordOffset + FREE_FOR_REUSE_DEADLINE_OFFSET, NOT_FREE_TO_REUSE);
            this.putLabel(recordOffset, label);

            this._metaDataBuffer.putIntRelease(recordOffset, RECORD_ALLOCATED);
        } catch (ex) {
            this.freeList.pushInt(counterId);
            LangUtil.rethrowUnchecked(ex as Error);
        }

        return counterId;
    }

    private allocateRaw(
        typeId: number,
        keyBuffer: DirectBuffer | null,
        keyOffset: number,
        keyLength: number,
        labelBuffer: DirectBuffer,
        labelOffset: number,
        labelLength: number,
    ): number {
        const counterId = this.nextCounterId();

        try {
            const recordOffset = CountersReader.metaDataOffset(counterId);

            this._metaDataBuffer.putInt(recordOffset + TYPE_ID_OFFSET, typeId);
            this._metaDataBuffer.putLongRelease(recordOffset + FREE_FOR_REUSE_DEADLINE_OFFSET, NOT_FREE_TO_REUSE);

            if (null !== keyBuffer) {
                const length = Math.min(keyLength, MAX_KEY_LENGTH);
                this._metaDataBuffer.putBytes(recordOffset + KEY_OFFSET, keyBuffer, keyOffset, length);
            }

            const length = Math.min(labelLength, MAX_LABEL_LENGTH);
            this._metaDataBuffer.putInt(recordOffset + LABEL_OFFSET, length);
            this._metaDataBuffer.putBytes(recordOffset + LABEL_OFFSET + SIZE_OF_INT, labelBuffer, labelOffset, length);

            this._metaDataBuffer.putIntRelease(recordOffset, RECORD_ALLOCATED);
        } catch (ex) {
            this.freeList.pushInt(counterId);
            LangUtil.rethrowUnchecked(ex as Error);
        }

        return counterId;
    }

    private nextCounterId(): number {
        if (!this.freeList.isEmpty()) {
            const nowMs = this.epochClock.time();

            for (let i = 0, size = this.freeList.size(); i < size; i++) {
                const counterId = this.freeList.getInt(i);
                if (
                    nowMs >=
                    this._metaDataBuffer.getLongVolatile(
                        CountersReader.metaDataOffset(counterId) + FREE_FOR_REUSE_DEADLINE_OFFSET,
                    )
                ) {
                    this.freeList.remove(i);

                    const offset = CountersReader.counterOffset(counterId);
                    this._valuesBuffer.putLongRelease(offset + REGISTRATION_ID_OFFSET, DEFAULT_REGISTRATION_ID);
                    this._valuesBuffer.putLongRelease(offset + OWNER_ID_OFFSET, DEFAULT_OWNER_ID);
                    this._valuesBuffer.putLongRelease(offset + REFERENCE_ID_OFFSET, DEFAULT_REFERENCE_ID);
                    this._valuesBuffer.putLongRelease(offset, 0);

                    return counterId;
                }
            }
        }

        this.checkCountersCapacity(this.highWaterMarkId + 1);

        return ++this.highWaterMarkId;
    }

    private putLabel(recordOffset: number, label: string): void {
        if (StandardCharsets.US_ASCII === this._labelCharset) {
            const length = this._metaDataBuffer.putStringWithoutLengthAscii(
                recordOffset + LABEL_OFFSET + SIZE_OF_INT,
                label,
                0,
                MAX_LABEL_LENGTH,
            );
            this._metaDataBuffer.putIntRelease(recordOffset + LABEL_OFFSET, length);
        } else {
            const bytes = this._labelCharset.encode(label);
            const length = Math.min(bytes.length, MAX_LABEL_LENGTH);

            this._metaDataBuffer.putBytes(recordOffset + LABEL_OFFSET + SIZE_OF_INT, bytes, 0, length);
            this._metaDataBuffer.putIntRelease(recordOffset + LABEL_OFFSET, length);
        }
    }

    private appendLabel(recordOffset: number, suffix: string): void {
        const existingLength = this._metaDataBuffer.getIntVolatile(recordOffset + LABEL_OFFSET);
        const maxSuffixLength = MAX_LABEL_LENGTH - existingLength;

        if (StandardCharsets.US_ASCII === this._labelCharset) {
            const suffixLength = this._metaDataBuffer.putStringWithoutLengthAscii(
                recordOffset + LABEL_OFFSET + SIZE_OF_INT + existingLength,
                suffix,
                0,
                maxSuffixLength,
            );

            this._metaDataBuffer.putIntRelease(recordOffset + LABEL_OFFSET, existingLength + suffixLength);
        } else {
            const suffixBytes = this._labelCharset.encode(suffix);
            const suffixLength = Math.min(suffixBytes.length, maxSuffixLength);

            this._metaDataBuffer.putBytes(
                recordOffset + LABEL_OFFSET + SIZE_OF_INT + existingLength,
                suffixBytes,
                0,
                suffixLength,
            );
            this._metaDataBuffer.putIntRelease(recordOffset + LABEL_OFFSET, existingLength + suffixLength);
        }
    }

    private checkCountersCapacity(counterId: number): void {
        if (counterId > this._maxCounterId) {
            throw new IllegalStateException(
                'unable to allocate counter, buffer is full: maxCounterId=' + this._maxCounterId,
            );
        }
    }
}
