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
// Port of io/aeron/status/ReadableCounter.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { IllegalStateException } from '../../agrona/jdk.js';
import { type AutoCloseable } from '../../agrona/jdkLang.js';
import { NULL_VALUE } from '../NullValue.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * Readonly view of an associated {@link Counter}.
 * <p>
 * <b>Note:</b>The user should call {@link isClosed} and ensure the result is false to avoid a race on reading a
 * closed {@link Counter}.
 */
export class ReadableCounter implements AutoCloseable {
    private readonly countersReader: CountersReader;
    private readonly valueBuffer: UnsafeBuffer;
    private readonly _registrationId: number = 0;
    private readonly _counterId: number = 0;
    private _isClosed = false;

    /**
     * Construct a view of an existing counter.
     *
     * @param countersReader for getting access to the buffers.
     * @param registrationId assigned by the driver for the counter or {@link NULL_VALUE} if not known.
     * @param counterId      for the counter to be viewed.
     * @throws IllegalStateException if the id has for the counter has not been allocated.
     */
    public constructor(countersReader: CountersReader, registrationId: number, counterId: number);
    /**
     * Construct a view of an existing counter.
     *
     * @param countersReader for getting access to the buffers.
     * @param counterId      for the counter to be viewed.
     * @throws IllegalStateException if the id has for the counter has not been allocated.
     */
    public constructor(countersReader: CountersReader, counterId: number);
    public constructor(countersReader: CountersReader, registrationIdOrCounterId: number, counterIdArg?: number) {
        const registrationId = undefined === counterIdArg ? NULL_VALUE : registrationIdOrCounterId;
        const counterId = undefined === counterIdArg ? registrationIdOrCounterId : counterIdArg;

        const counterState = countersReader.getCounterState(counterId);
        if (counterState !== CountersReader.RECORD_ALLOCATED) {
            throw new IllegalStateException('Counter not allocated: id=' + counterId + ' state=' + counterState);
        }

        this.countersReader = countersReader;
        this._counterId = counterId;
        this._registrationId = registrationId;

        const valuesBuffer = countersReader.valuesBuffer();
        const counterOffset = CountersReader.counterOffset(counterId);
        valuesBuffer.boundsCheck(counterOffset, SIZE_OF_LONG);

        this.valueBuffer = new UnsafeBuffer(valuesBuffer, counterOffset, SIZE_OF_LONG);
    }

    /**
     * Return the registration id for the counter.
     *
     * @return registration id.
     */
    public registrationId(): number {
        return this._registrationId;
    }

    /**
     * Return the counter id.
     *
     * @return counter id.
     */
    public counterId(): number {
        return this._counterId;
    }

    /**
     * Return the state of the counter.
     *
     * @return state for the counter.
     * @see CountersReader.RECORD_ALLOCATED
     * @see CountersReader.RECORD_RECLAIMED
     * @see CountersReader.RECORD_UNUSED
     */
    public state(): number {
        return this.countersReader.getCounterState(this._counterId);
    }

    /**
     * Return the counter label.
     *
     * @return the counter label.
     */
    public label(): string {
        return this.countersReader.getCounterLabel(this._counterId);
    }

    /**
     * Get the latest value for the counter with volatile semantics.
     * <p>
     * <b>Note:</b>The user should call {@link isClosed} and ensure the result is false to avoid a race on reading
     * a closed counter.
     *
     * @return the latest value for the counter.
     */
    public get(): number {
        return this.valueBuffer.getLongVolatile(0);
    }

    /**
     * Get the value of the counter using weak ordering semantics. This is the same a standard read of a field.
     * <p>
     * This call is identical to {@link getPlain} and that method is preferred.
     *
     * @return the  value for the counter.
     */
    public getWeak(): number {
        return this.getPlain();
    }

    /**
     * Get the value of the counter using plain memory semantics. This is the same a standard read of a field.
     *
     * @return the value for the counter.
     */
    public getPlain(): number {
        return this.valueBuffer.getLong(0);
    }

    /**
     * Close this counter. This has no impact on the {@link Counter} it is viewing.
     */
    public close(): void {
        this._isClosed = true;
    }

    /**
     * Has this counter been closed and should it no longer be used?
     *
     * @return true if it has been closed otherwise false.
     */
    public isClosed(): boolean {
        return this._isClosed;
    }
}
