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
// Port of io/aeron/BufferBuilder.java @ 1.53.3
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { ByteOrder, IllegalArgumentException, IllegalStateException } from '../agrona/jdk.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { Aeron } from './Aeron.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { Header } from './logbuffer/Header.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from './protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from './protocol/HeaderFlyweight.js';

const { NULL_VALUE } = Aeron;
const { FLAGS_OFFSET } = FrameDescriptor;
const { computeFragmentedFrameLength } = LogBufferDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_LENGTH_FIELD_OFFSET } = HeaderFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Reusable Builder for appending a sequence of buffer fragments which grows internal capacity as needed.
 * <p>
 * The underlying buffer is a `Uint8Array`. A direct `ByteBuffer` is an `ArrayBuffer` here (spec D9), so `isDirect`
 * selects only which of the two resize branches of Java runs.
 * <p>
 * Similar in concept to {@link StringBuilder}.
 */
export class BufferBuilder {
    public static readonly MAX_CAPACITY = 2147483647 - 8;
    public static readonly INIT_MIN_CAPACITY = 4096;

    private readonly isDirect: boolean;
    private _limit = 0;
    private _nextTermOffset: number = NULL_VALUE;
    private firstFrameLength = 0;
    private readonly _buffer = new UnsafeBuffer();
    public readonly headerBuffer = new UnsafeBuffer();
    // the package-private field `completeHeader` of Java, which the method of the same name hides here
    public readonly _completeHeader = new Header(0, 0);

    /**
     * Construct a buffer builder with an initial capacity. The three constructors of Java are one.
     *
     * @param initialCapacity at which the capacity will start, zero by default.
     * @param isDirect        is the underlying buffer to be a direct buffer, false by default.
     */
    public constructor(initialCapacity: number = 0, isDirect: boolean = false) {
        if (initialCapacity < 0 || initialCapacity > BufferBuilder.MAX_CAPACITY) {
            throw new IllegalArgumentException(
                'initialCapacity outside range 0 - ' +
                    BufferBuilder.MAX_CAPACITY +
                    ': initialCapacity=' +
                    initialCapacity,
            );
        }

        this.isDirect = isDirect;
        if (isDirect) {
            if (initialCapacity > 0) {
                this._buffer.wrap(BufferBuilder.newDirectBuffer(initialCapacity));
            }
            this.headerBuffer.wrap(BufferBuilder.newDirectBuffer(HEADER_LENGTH));
        } else {
            if (initialCapacity > 0) {
                this._buffer.wrap(new Uint8Array(initialCapacity));
            }
            this.headerBuffer.wrap(new Uint8Array(HEADER_LENGTH));
        }
    }

    /**
     * The current capacity of the buffer.
     *
     * @return the current capacity of the buffer.
     */
    public capacity(): number {
        return this._buffer.capacity();
    }

    /**
     * The current limit of the buffer that has been used by append operations.
     *
     * @return the current limit of the buffer that has been used by append operations.
     */
    public limit(): number;
    /**
     * Set this limit for this buffer as the position at which the next append operation will occur.
     *
     * @param limit to be the new value.
     */
    public limit(limit: number): void;
    public limit(limit?: number): number | void {
        if (undefined === limit) {
            return this._limit;
        }

        if (limit < 0 || limit >= this._buffer.capacity()) {
            throw new IllegalArgumentException(
                'limit outside range: capacity=' + this._buffer.capacity() + ' limit=' + limit,
            );
        }

        this._limit = limit;
    }

    /**
     * Get the value which the next term offset for a fragment to be assembled should begin at.
     *
     * @return the value which the next term offset for a fragment to be assembled should begin at.
     */
    public nextTermOffset(): number;
    /**
     * Set the value which the next term offset for a fragment to be assembled should begin at.
     *
     * @param offset which the next term offset for a fragment to be assembled should begin at.
     */
    public nextTermOffset(offset: number): void;
    public nextTermOffset(offset?: number): number | void {
        if (undefined === offset) {
            return this._nextTermOffset;
        }

        this._nextTermOffset = offset;
    }

    /**
     * The {@link MutableDirectBuffer} that encapsulates the internal buffer.
     *
     * @return the {@link MutableDirectBuffer} that encapsulates the internal buffer.
     */
    public buffer(): MutableDirectBuffer {
        return this._buffer;
    }

    /**
     * Reset the builder to restart append operations. The internal buffer does not shrink.
     *
     * @return the builder for fluent API usage.
     */
    public reset(): BufferBuilder {
        this._limit = 0;
        this._nextTermOffset = NULL_VALUE;
        this._completeHeader.context(null);
        this._completeHeader.fragmentedFrameLength(NULL_VALUE);
        return this;
    }

    /**
     * Compact the buffer to reclaim unused space above the limit.
     *
     * @return the builder for fluent API usage.
     */
    public compact(): BufferBuilder {
        const newCapacity = Math.max(BufferBuilder.INIT_MIN_CAPACITY, this._limit);
        if (newCapacity < this._buffer.capacity()) {
            this.resize(newCapacity);
        }

        return this;
    }

    /**
     * Append a source buffer to the end of the internal buffer, resizing the internal buffer when required.
     *
     * @param srcBuffer from which to copy.
     * @param srcOffset in the source buffer from which to copy.
     * @param length    in bytes to copy from the source buffer.
     * @return the builder for fluent API usage.
     */
    public append(srcBuffer: DirectBuffer, srcOffset: number, length: number): BufferBuilder {
        this.ensureCapacity(length);

        this._buffer.putBytes(this._limit, srcBuffer, srcOffset, length);
        this._limit += length;

        return this;
    }

    /**
     * Capture information available in the header of the very first frame.
     *
     * @param header of the first frame.
     * @return the builder for fluent API usage.
     */
    public captureHeader(header: Header): BufferBuilder {
        this._completeHeader
            .initialTermId(header.initialTermId())
            .positionBitsToShift(header.positionBitsToShift())
            .offset(0)
            .buffer(this.headerBuffer);

        this.firstFrameLength = header.frameLength();

        this.headerBuffer.putBytes(0, header.buffer(), header.offset(), HEADER_LENGTH);
        return this;
    }

    /**
     * Use the information from the header of the last frame to create a header for the assembled message, i.e. fixups
     * the flags and the frame length.
     *
     * @param header of the last frame.
     * @return complete message header.
     */
    public completeHeader(header: Header): Header {
        // compute the `fragmented frame length` of the complete message
        const fragmentedFrameLength = computeFragmentedFrameLength(this._limit, this.firstFrameLength - HEADER_LENGTH);
        this._completeHeader.context(header.context());
        this._completeHeader.fragmentedFrameLength(fragmentedFrameLength);

        this.headerBuffer.putInt(FRAME_LENGTH_FIELD_OFFSET, HEADER_LENGTH + this._limit, LITTLE_ENDIAN);
        // compute complete flags
        this.headerBuffer.putByte(FLAGS_OFFSET, this.headerBuffer.getByte(FLAGS_OFFSET) | header.flags());

        return this._completeHeader;
    }

    private ensureCapacity(additionalLength: number): void {
        const requiredCapacity = this._limit + additionalLength;
        const capacity = this._buffer.capacity();

        if (requiredCapacity > capacity) {
            if (requiredCapacity > BufferBuilder.MAX_CAPACITY) {
                throw new IllegalStateException(
                    'insufficient capacity: maxCapacity=' +
                        BufferBuilder.MAX_CAPACITY +
                        ' limit=' +
                        this._limit +
                        ' additionalLength=' +
                        additionalLength,
                );
            }

            this.resize(BufferBuilder.findSuitableCapacity(capacity, requiredCapacity));
        }
    }

    private resize(newCapacity: number): void {
        if (this.isDirect) {
            const byteBuffer = BufferBuilder.newDirectBuffer(newCapacity);
            const view = new Uint8Array(byteBuffer);
            this._buffer.getBytes(0, view, 0, this._limit);
            this._buffer.wrap(view);
        } else {
            // Arrays.copyOf(buffer.byteArray(), newCapacity)
            const original = this._buffer.byteArray();
            const copy = new Uint8Array(newCapacity);
            copy.set(original.length > newCapacity ? original.subarray(0, newCapacity) : original);
            this._buffer.wrap(copy);
        }
    }

    private static newDirectBuffer(newCapacity: number): ArrayBuffer {
        return new ArrayBuffer(newCapacity);
    }

    public static findSuitableCapacity(capacity: number, requiredCapacity: number): number {
        let newCapacity = Math.max(capacity, BufferBuilder.INIT_MIN_CAPACITY);

        while (newCapacity < requiredCapacity) {
            // newCapacity is at most MAX_CAPACITY here, so the 32-bit shift is exact
            newCapacity = newCapacity + (newCapacity >> 1);
            if (newCapacity > BufferBuilder.MAX_CAPACITY) {
                newCapacity = BufferBuilder.MAX_CAPACITY;
                break;
            }
        }

        return newCapacity;
    }
}
