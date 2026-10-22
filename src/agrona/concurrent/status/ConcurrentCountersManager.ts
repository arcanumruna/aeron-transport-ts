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
// Port of org/agrona/concurrent/status/ConcurrentCountersManager.java @ Agrona 2.6.1
import type { DirectBuffer } from '../../DirectBuffer.js';
import type { Charset } from '../../jdkLang.js';
import type { MutableDirectBuffer } from '../../MutableDirectBuffer.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import type { EpochClock } from '../EpochClock.js';
import { NoOpLock, type Lock } from '../NoOpLock.js';
import { CountersManager } from './CountersManager.js';

/**
 * An extension of {@link CountersManager} that takes a lock around every operation, as Java's takes a
 * {@code ReentrantLock} to allow intra-process read and write access to the same counters buffer. One thread
 * allocates counters here (spec D3, phase 2 plan task T5), so the lock is the {@link NoOpLock}: the class has Java's
 * API and shape, and the lock calls are where Java's are. Inter-process access is not catered for.
 */
export class ConcurrentCountersManager extends CountersManager {
    private readonly lock: Lock = NoOpLock.INSTANCE;

    /**
     * Construct a counter manager over buffers containing the values and associated metadata.
     * <p>
     * Counter labels default to UTF-8, and a {@link CachedEpochClock} and no reuse timeout apply, if omitted.
     *
     * @param metaDataBuffer       containing the counter metadata.
     * @param valuesBuffer         containing the counter values.
     * @param labelCharset         for the label encoding.
     * @param epochClock           to use for determining time for keep counter from being reused after being freed.
     * @param freeToReuseTimeoutMs timeout (in milliseconds) to keep counter from being reused after being freed.
     */
    public constructor(
        metaDataBuffer: AtomicBuffer,
        valuesBuffer: AtomicBuffer,
        labelCharset?: Charset,
        epochClock?: EpochClock,
        freeToReuseTimeoutMs?: number,
    ) {
        super(metaDataBuffer, valuesBuffer, labelCharset, epochClock, freeToReuseTimeoutMs);
    }

    public override available(): number {
        this.lock.lock();
        try {
            return super.available();
        } finally {
            this.lock.unlock();
        }
    }

    public override allocate(label: string): number;
    public override allocate(label: string, typeId: number): number;
    public override allocate(label: string, typeId: number, keyFunc: (keyBuffer: MutableDirectBuffer) => void): number;
    public override allocate(
        typeId: number,
        keyBuffer: DirectBuffer | null,
        keyOffset: number,
        keyLength: number,
        labelBuffer: DirectBuffer,
        labelOffset: number,
        labelLength: number,
    ): number;
    public override allocate(
        arg0: string | number,
        arg1?: number | DirectBuffer | null,
        arg2?: number | ((keyBuffer: MutableDirectBuffer) => void),
        keyLength?: number,
        labelBuffer?: DirectBuffer,
        labelOffset?: number,
        labelLength?: number,
    ): number {
        this.lock.lock();
        try {
            if ('string' === typeof arg0) {
                if (undefined === arg2) {
                    return undefined === arg1 ? super.allocate(arg0) : super.allocate(arg0, arg1 as number);
                }

                return super.allocate(arg0, arg1 as number, arg2 as (keyBuffer: MutableDirectBuffer) => void);
            }

            return super.allocate(
                arg0,
                arg1 as DirectBuffer | null,
                arg2 as number,
                keyLength!,
                labelBuffer!,
                labelOffset!,
                labelLength!,
            );
        } finally {
            this.lock.unlock();
        }
    }

    public override free(counterId: number): void {
        this.lock.lock();
        try {
            super.free(counterId);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterValue(counterId: number, value: number): void {
        this.lock.lock();
        try {
            super.setCounterValue(counterId, value);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterRegistrationId(counterId: number, registrationId: number): void {
        this.lock.lock();
        try {
            super.setCounterRegistrationId(counterId, registrationId);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterOwnerId(counterId: number, ownerId: number): void {
        this.lock.lock();
        try {
            super.setCounterOwnerId(counterId, ownerId);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterReferenceId(counterId: number, referenceId: number): void {
        this.lock.lock();
        try {
            super.setCounterReferenceId(counterId, referenceId);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterLabel(counterId: number, label: string): void {
        this.lock.lock();
        try {
            super.setCounterLabel(counterId, label);
        } finally {
            this.lock.unlock();
        }
    }

    public override setCounterKey(counterId: number, keyFunc: (keyBuffer: MutableDirectBuffer) => void): void;
    public override setCounterKey(counterId: number, keyBuffer: DirectBuffer, offset: number, length: number): void;
    public override setCounterKey(
        counterId: number,
        arg1: ((keyBuffer: MutableDirectBuffer) => void) | DirectBuffer,
        offset?: number,
        length?: number,
    ): void {
        this.lock.lock();
        try {
            if ('function' === typeof arg1) {
                super.setCounterKey(counterId, arg1);
            } else {
                super.setCounterKey(counterId, arg1, offset!, length!);
            }
        } finally {
            this.lock.unlock();
        }
    }

    public override appendToLabel(counterId: number, label: string): void {
        this.lock.lock();
        try {
            super.appendToLabel(counterId, label);
        } finally {
            this.lock.unlock();
        }
    }

    public override toString(): string {
        this.lock.lock();
        try {
            return super.toString();
        } finally {
            this.lock.unlock();
        }
    }
}
