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
// Port of io/aeron/DirectBufferVector.java @ 1.53.3
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { IllegalArgumentException, IllegalStateException } from '../agrona/jdk.js';

/**
 * Vector into a {@link DirectBuffer} to be used for gathering IO as an alternative to {@link DirectBuffer}
 * allocation, for use with {@link Publication.offerVectored}.
 */
export class DirectBufferVector {
    private _buffer: DirectBuffer | null;
    private _offset: number = 0;
    private _length: number = 0;

    /**
     * Construct a new vector as a placeholder for later reset, or over a region of a buffer. The two constructors of
     * Java are one.
     *
     * @param buffer to be included in the vector, none by default.
     * @param offset in the buffer at which the vector begins, 0 by default.
     * @param length of the vector in the buffer, 0 by default.
     */
    public constructor(buffer: DirectBuffer | null = null, offset: number = 0, length: number = 0) {
        this._buffer = buffer;
        this._offset = offset;
        this._length = length;
    }

    /**
     * Reset the values.
     *
     * @param buffer to be included in the vector.
     * @param offset in the buffer at which the vector begins.
     * @param length of the vector in the buffer.
     * @return this for a fluent API.
     */
    public reset(buffer: DirectBuffer, offset: number, length: number): DirectBufferVector {
        this._buffer = buffer;
        this._offset = offset;
        this._length = length;

        return this;
    }

    /**
     * The buffer which includes the vector.
     *
     * @return the buffer which includes the vector.
     */
    public buffer(): DirectBuffer;
    /**
     * The buffer which includes the vector.
     *
     * @param buffer which includes the vector.
     * @return this for a fluent API.
     */
    public buffer(buffer: DirectBuffer): DirectBufferVector;
    public buffer(buffer?: DirectBuffer): DirectBuffer | DirectBufferVector {
        if (undefined === buffer) {
            return this._buffer as DirectBuffer;
        }

        this._buffer = buffer;
        return this;
    }

    /**
     * The offset at which the vector begins in the buffer.
     *
     * @return offset at which the vector begins in the buffer.
     */
    public offset(): number;
    /**
     * The offset at which the vector begins in the buffer.
     *
     * @param offset at which the vector begins in the buffer.
     * @return this for a fluent API.
     */
    public offset(offset: number): DirectBufferVector;
    public offset(offset?: number): number | DirectBufferVector {
        if (undefined === offset) {
            return this._offset;
        }

        this._offset = offset;
        return this;
    }

    /**
     * The length of the vector in the buffer.
     *
     * @return length of the vector in the buffer.
     */
    public length(): number;
    /**
     * The length of the vector in the buffer.
     *
     * @param length of the vector in the buffer.
     * @return this for a fluent API.
     */
    public length(length: number): DirectBufferVector;
    public length(length?: number): number | DirectBufferVector {
        if (undefined === length) {
            return this._length;
        }

        this._length = length;
        return this;
    }

    /**
     * Ensure that a buffer is large enough to contain the vector.
     *
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the vector exceeds the buffer capacity.
     */
    public validate(): DirectBufferVector {
        const capacity = (this._buffer as DirectBuffer).capacity();
        if (this._offset < 0 || this._offset >= capacity) {
            throw new IllegalArgumentException('offset=' + this._offset + ' capacity=' + capacity);
        }

        if (this._length < 0 || this._length > capacity - this._offset) {
            throw new IllegalArgumentException(
                'offset=' + this._offset + ' capacity=' + capacity + ' length=' + this._length,
            );
        }

        return this;
    }

    public toString(): string {
        return (
            'DirectBufferVector{' +
            'buffer=' +
            String(this._buffer) +
            ', offset=' +
            this._offset +
            ', length=' +
            this._length +
            '}'
        );
    }

    /**
     * Validate an array of vectors to make up a message and compute the total length.
     *
     * @param vectors to be validated summed.
     * @return the total length of all the vectors.
     * @throws IllegalArgumentException if any vector is invalid.
     * @throws IllegalStateException    if the total length overflows an `int`.
     */
    public static validateAndComputeLength(vectors: readonly DirectBufferVector[]): number {
        let messageLength = 0;
        for (let i = 0, length = vectors.length; i < length; i++) {
            const vector = vectors[i] as DirectBufferVector;
            vector.validate();
            messageLength = (messageLength + vector._length) | 0;

            if (messageLength < 0) {
                throw new IllegalStateException('length overflow: [' + vectors.join(', ') + ']');
            }
        }

        return messageLength;
    }
}
