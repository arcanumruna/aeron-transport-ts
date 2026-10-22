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
// Port of org/agrona/concurrent/status/UnsafeBufferPosition.java @ Agrona 2.6.1
import { BitUtil } from '../../BitUtil.js';
import type { UnsafeBuffer } from '../UnsafeBuffer.js';
import { CountersReader } from './CountersReader.js';
import type { CountersManager } from './CountersManager.js';
import { Position } from './Position.js';

const { SIZE_OF_LONG } = BitUtil;

/**
 * Reports a position by recording it in an {@link UnsafeBuffer}. Java caches the byte array and the address offset of
 * the counter for {@code Unsafe}; here the buffer and the offset of the counter in it are kept, and every operation is
 * a bounds-checked access with no allocation.
 */
export class UnsafeBufferPosition extends Position {
    private _isClosed = false;
    private readonly counterId: number;
    private readonly buffer: UnsafeBuffer;
    private readonly counterOffset: number;
    private readonly countersManager: CountersManager | null;

    /**
     * Map a position over a buffer.
     *
     * @param buffer          containing the counter.
     * @param counterId       identifying the counter.
     * @param countersManager to be called to free the counter on close, or null for none.
     */
    public constructor(buffer: UnsafeBuffer, counterId: number, countersManager: CountersManager | null = null) {
        super();

        this.counterId = counterId;
        this.countersManager = countersManager;
        this.buffer = buffer;

        const counterOffset = CountersReader.counterOffset(counterId);
        buffer.boundsCheck(counterOffset, SIZE_OF_LONG);
        this.counterOffset = counterOffset;
    }

    public isClosed(): boolean {
        return this._isClosed;
    }

    public id(): number {
        return this.counterId;
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

    public get(): number {
        return this.buffer.getLong(this.counterOffset);
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

    public set(value: number): void {
        this.buffer.putLong(this.counterOffset, value);
    }

    public proposeMax(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLong(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    public proposeMaxOrdered(proposedValue: number): boolean {
        return this.proposeMaxRelease(proposedValue);
    }

    public proposeMaxRelease(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLongRelease(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    public proposeMaxOpaque(proposedValue: number): boolean {
        let updated = false;

        const buffer = this.buffer;
        const offset = this.counterOffset;
        if (buffer.getLong(offset) < proposedValue) {
            buffer.putLongOpaque(offset, proposedValue);
            updated = true;
        }

        return updated;
    }

    public close(): void {
        if (!this._isClosed) {
            this._isClosed = true;
            if (null !== this.countersManager) {
                this.countersManager.free(this.counterId);
            }
        }
    }

    public override toString(): string {
        return (
            'UnsafeBufferPosition{' +
            'isClosed=' +
            this.isClosed() +
            ', counterId=' +
            this.counterId +
            ', value=' +
            (this.isClosed() ? -1 : this.getVolatile()) +
            '}'
        );
    }
}
