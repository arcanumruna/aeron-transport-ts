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
// Port of io/aeron/ImageFragmentAssembler.java @ 1.53.3
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
 * This handler is only for use with a single {@link Image} as it has a single buffer builder: create one
 * for each image.
 */
export class ImageFragmentAssembler implements FragmentHandler {
    private readonly _delegate: FragmentHandler;
    private readonly builder: BufferBuilder;

    /**
     * Construct an adapter to reassemble message fragments and delegate on only whole messages. The three
     * constructors of Java are one.
     *
     * @param delegate            onto which whole messages are forwarded.
     * @param initialBufferLength to be used for the image, zero by default.
     * @param isDirectByteBuffer  is the underlying buffer to be a direct buffer, false by default.
     */
    public constructor(
        delegate: FragmentHandler,
        initialBufferLength: number = 0,
        isDirectByteBuffer: boolean = false,
    ) {
        this._delegate = delegate;
        this.builder = new BufferBuilder(initialBufferLength, isDirectByteBuffer);
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
     * Get the {@link BufferBuilder} for the image, for use in tests and diagnostics.
     *
     * @return the {@link BufferBuilder} used for reassembly.
     */
    public bufferBuilder(): BufferBuilder {
        return this.builder;
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
            this.builder.reset().captureHeader(header).append(buffer, offset, length);
            this.builder.nextTermOffset(header.nextTermOffset());
        } else if (header.termOffset() === this.builder.nextTermOffset()) {
            this.builder.append(buffer, offset, length);

            if ((flags & END_FRAG_FLAG) === END_FRAG_FLAG) {
                this._delegate.onFragment(
                    this.builder.buffer(),
                    0,
                    this.builder.limit(),
                    this.builder.completeHeader(header),
                );
                this.builder.reset();
            } else {
                this.builder.nextTermOffset(header.nextTermOffset());
            }
        } else {
            this.builder.reset();
        }
    }
}
