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
// Port of io/aeron/FragmentAssembler.java @ 1.53.3
import { Int2ObjectHashMap } from '../agrona/collections/Int2ObjectHashMap.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { BufferBuilder } from './BufferBuilder.js';
import type { FragmentHandler } from './logbuffer/FragmentHandler.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import type { Header } from './logbuffer/Header.js';

const { BEGIN_FRAG_FLAG, END_FRAG_FLAG, UNFRAGMENTED } = FrameDescriptor;

/**
 * A {@link FragmentHandler} that sits in a chain-of-responsibility pattern that reassembles fragmented messages
 * so that the next handler in the chain only sees whole messages.
 * <p>
 * Unfragmented messages are delegated without copy. Fragmented messages are copied to a temporary
 * {@link BufferBuilder} for reassembly before delegation.
 * <p>
 * The {@link Header} passed to the delegate on assembling a message will be that of the last fragment.
 * <p>
 * Session based buffers will be allocated and grown as necessary based on the length of messages to be assembled.
 * When sessions go inactive see {@link UnavailableImageHandler}, it is possible to free the buffer by calling
 * {@link freeSessionBuffer}.
 */
export class FragmentAssembler implements FragmentHandler {
    private readonly _isDirectByteBuffer: boolean;
    private readonly initialBufferLength: number = 0;
    private readonly _delegate: FragmentHandler;
    private readonly builderBySessionIdMap = new Int2ObjectHashMap<BufferBuilder>();

    /**
     * Construct an adapter to reassemble message fragments and delegate on only whole messages. The three
     * constructors of Java are one.
     *
     * @param delegate            onto which whole messages are forwarded.
     * @param initialBufferLength to be used for each session, zero by default.
     * @param isDirectByteBuffer  is the underlying buffer to be a direct buffer, false by default.
     */
    public constructor(
        delegate: FragmentHandler,
        initialBufferLength: number = 0,
        isDirectByteBuffer: boolean = false,
    ) {
        this.initialBufferLength = initialBufferLength;
        this._delegate = delegate;
        this._isDirectByteBuffer = isDirectByteBuffer;
    }

    /**
     * Get the delegate unto which assembled messages are delegated.
     *
     * @return the delegate unto which assembled messages are delegated.
     */
    public delegate(): FragmentHandler {
        return this._delegate;
    }

    /**
     * Get whether the builder for each session uses a direct buffer.
     *
     * @return true if the builder uses a direct buffer.
     */
    public isDirectByteBuffer(): boolean {
        return this._isDirectByteBuffer;
    }

    /**
     * Callback for handling fragments of data being read from a log.
     * <p>
     * This method is where messages are reassembled.
     *
     * @param buffer containing the data.
     * @param offset at which the data begins.
     * @param length of the data in bytes.
     * @param header representing the meta data for the data.
     */
    public onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): void {
        const flags = header.flags();

        if ((flags & UNFRAGMENTED) === UNFRAGMENTED) {
            this._delegate.onFragment(buffer, offset, length, header);
        } else {
            this.handleFragment(buffer, offset, length, header, flags);
        }
    }

    private handleFragment(buffer: DirectBuffer, offset: number, length: number, header: Header, flags: number): void {
        if ((flags & BEGIN_FRAG_FLAG) === BEGIN_FRAG_FLAG) {
            const builder = this.getBufferBuilder(header.sessionId());
            builder.reset().captureHeader(header).append(buffer, offset, length);
            builder.nextTermOffset(header.nextTermOffset());
        } else {
            const builder = this.builderBySessionIdMap.get(header.sessionId());
            if (null !== builder) {
                if (header.termOffset() === builder.nextTermOffset()) {
                    builder.append(buffer, offset, length);

                    if ((flags & END_FRAG_FLAG) === END_FRAG_FLAG) {
                        this._delegate.onFragment(builder.buffer(), 0, builder.limit(), builder.completeHeader(header));
                        builder.reset();
                    } else {
                        builder.nextTermOffset(header.nextTermOffset());
                    }
                } else {
                    builder.reset();
                }
            }
        }
    }

    /**
     * Free an existing session buffer to reduce memory pressure when a connection goes inactive or no more
     * large messages are expected.
     *
     * @param sessionId to have its buffer freed
     * @return true if a buffer has been freed otherwise false.
     */
    public freeSessionBuffer(sessionId: number): boolean {
        return null !== this.builderBySessionIdMap.remove(sessionId);
    }

    /**
     * Clear down the cache of buffers by session for reassembling messages.
     */
    public clear(): void {
        this.builderBySessionIdMap.clear();
    }

    private getBufferBuilder(sessionId: number): BufferBuilder {
        let bufferBuilder = this.builderBySessionIdMap.get(sessionId);

        if (null === bufferBuilder) {
            bufferBuilder = new BufferBuilder(this.initialBufferLength, this._isDirectByteBuffer);
            this.builderBySessionIdMap.put(sessionId, bufferBuilder);
        }

        return bufferBuilder;
    }
}
