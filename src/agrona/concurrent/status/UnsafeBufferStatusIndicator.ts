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
// Port of org/agrona/concurrent/status/UnsafeBufferStatusIndicator.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { AtomicBuffer } from '../AtomicBuffer.js';
import { CountersReader } from './CountersReader.js';
import { StatusIndicator } from './StatusIndicator.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * {@link StatusIndicator} which wraps an {@link AtomicBuffer} with a given counter id. Java caches the byte array and
 * the address offset of the counter for {@code Unsafe}; here the buffer and the offset of the counter in it are kept,
 * as {@link UnsafeBufferPosition} does, and every operation is a bounds-checked buffer access.
 *
 * @see CountersManager
 */
export class UnsafeBufferStatusIndicator extends StatusIndicator {
    private readonly counterId: number;
    private readonly buffer: AtomicBuffer;
    private readonly counterOffset: number;

    /**
     * Map a status indicator over a buffer.
     *
     * @param buffer    containing the indicator.
     * @param counterId identifier of the indicator.
     */
    public constructor(buffer: AtomicBuffer, counterId: number) {
        super();

        this.counterId = counterId;
        this.buffer = buffer;

        const counterOffset = CountersReader.counterOffset(counterId);
        buffer.boundsCheck(counterOffset, SIZE_OF_LONG);
        this.counterOffset = counterOffset;
    }

    public id(): number {
        return this.counterId;
    }

    public setVolatile(value: number): void {
        this.buffer.putLongVolatile(this.counterOffset, value);
    }

    public setOrdered(value: number): void {
        this.setRelease(value);
    }

    public setRelease(value: number): void {
        this.buffer.putLongRelease(this.counterOffset, value);
    }

    public setOpaque(value: number): void {
        this.buffer.putLongOpaque(this.counterOffset, value);
    }

    public getVolatile(): number {
        return this.buffer.getLongVolatile(this.counterOffset);
    }

    public getAcquire(): number {
        return this.buffer.getLongAcquire(this.counterOffset);
    }

    public getOpaque(): number {
        return this.buffer.getLongOpaque(this.counterOffset);
    }

    public override toString(): string {
        return 'UnsafeBufferStatusIndicator{' + 'counterId=' + this.counterId + 'value=' + this.getVolatile() + '}';
    }
}
