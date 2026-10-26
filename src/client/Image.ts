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
// Port of io/aeron/Image.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { Position } from '../agrona/concurrent/status/Position.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import { ByteOrder, IllegalArgumentException, Long } from '../agrona/jdk.js';
import type { BlockHandler } from './logbuffer/BlockHandler.js';
import { ControlledFragmentHandler } from './logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from './logbuffer/FragmentHandler.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { Header } from './logbuffer/Header.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';
import type { RawBlockHandler } from './logbuffer/RawBlockHandler.js';
import { TermBlockScanner } from './logbuffer/TermBlockScanner.js';
import { DataHeaderFlyweight } from './protocol/DataHeaderFlyweight.js';
import type { Subscription } from './Subscription.js';

const { ABORT, BREAK, COMMIT } = ControlledFragmentHandler.Action;
const { FRAME_ALIGNMENT, frameLengthVolatile, isPaddingFrame } = FrameDescriptor;
const { HEADER_LENGTH, TERM_ID_FIELD_OFFSET } = DataHeaderFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * The log buffers that an image uses: the part of T19's `LogBuffers` that `Image` calls (a forward reference, spec
 * D80). T19 makes `LogBuffers` satisfy it and replaces it with `import type { LogBuffers }`. The log is in memory
 * (spec D4), so `fileChannel()` has no file to return: it answers `null`.
 */
export interface ImageLogBuffers {
    metaDataBuffer(): UnsafeBuffer;
    termLength(): number;
    duplicateTermBuffers(): UnsafeBuffer[];
    fileChannel(): unknown;
}

/**
 * Represents a replicated publication {@link Image} from a publisher to a {@link Subscription}.
 * Each {@link Image} identifies a source publisher by session id.
 * <p>
 * By default, fragmented messages are not reassembled before delivery. If an application must
 * receive whole messages, whether or not they were fragmented, then the Subscriber
 * should be created with a {@link FragmentAssembler} or a custom implementation.
 * <p>
 * It is an application's responsibility to {@link poll} the {@link Image} for new messages.
 * <p>
 * <b>Note:</b>Images are not threadsafe and should not be shared between subscribers.
 */
export class Image {
    private readonly _correlationId: number;
    private readonly _joinPosition: number;
    private readonly _sessionId: number;
    private readonly _initialTermId: number;
    private readonly termLengthMask: number;
    private readonly _positionBitsToShift: number;
    private readonly mtu: number;

    private finalPosition: number = 0;
    private eosPosition: number = Long.MAX_VALUE;
    private isEos: boolean = false;
    private isRevoked: boolean = false;
    private _isClosed: boolean = false;

    private readonly subscriberPosition: Position;
    private readonly termBuffers: UnsafeBuffer[];
    private readonly header: Header;
    private readonly errorHandler: ErrorHandler;
    private readonly _logBuffers: ImageLogBuffers;
    private readonly _sourceIdentity: string;
    private readonly _subscription: Subscription;

    /**
     * Construct a new image over a log to represent a stream of messages from a {@link Publication}.
     *
     * @param subscription       to which this {@link Image} belongs.
     * @param sessionId          of the stream of messages.
     * @param subscriberPosition for indicating the position of the subscriber in the stream.
     * @param logBuffers         containing the stream of messages.
     * @param errorHandler       to be called if an error occurs when polling for messages.
     * @param sourceIdentity     of the source sending the stream of messages.
     * @param correlationId      of the request to the media driver.
     */
    public constructor(
        subscription: Subscription,
        sessionId: number,
        subscriberPosition: Position,
        logBuffers: ImageLogBuffers,
        errorHandler: ErrorHandler,
        sourceIdentity: string,
        correlationId: number,
    ) {
        this._subscription = subscription;
        this._sessionId = sessionId;
        this.subscriberPosition = subscriberPosition;
        this._logBuffers = logBuffers;
        this.errorHandler = errorHandler;
        this._sourceIdentity = sourceIdentity;
        this._correlationId = correlationId;
        this._joinPosition = subscriberPosition.get();

        this.termBuffers = logBuffers.duplicateTermBuffers();

        const termLength = logBuffers.termLength();
        this.termLengthMask = termLength - 1;
        this._positionBitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        this._initialTermId = LogBufferDescriptor.initialTermId(logBuffers.metaDataBuffer());
        this.mtu = LogBufferDescriptor.mtuLength(logBuffers.metaDataBuffer());
        this.header = new Header(this._initialTermId, this._positionBitsToShift, this);
    }

    /**
     * Number of bits to right shift a position to get a term count for how far the stream has progressed.
     *
     * @return of bits to right shift a position to get a term count for how far the stream has progressed.
     */
    public positionBitsToShift(): number {
        return this._positionBitsToShift;
    }

    /**
     * The length in bytes of each term partition in the log buffer.
     *
     * @return the length in bytes of each term partition in the log buffer.
     */
    public termBufferLength(): number {
        return this.termLengthMask + 1;
    }

    /**
     * Get the length in bytes of the MTU (Maximum Transmission Unit) the Sender used for the datagram.
     *
     * @return the length in bytes of the MTU (Maximum Transmission Unit) the Sender used for the datagram.
     */
    public mtuLength(): number {
        return this.mtu;
    }

    /**
     * The sessionId for the steam of messages. Sessions are unique within a {@link Subscription} and unique across
     * all {@link Publication}s from a {@link sourceIdentity}.
     *
     * @return the sessionId for the steam of messages.
     */
    public sessionId(): number {
        return this._sessionId;
    }

    /**
     * The source identity of the sending publisher as an abstract concept appropriate for the media.
     *
     * @return source identity of the sending publisher as an abstract concept appropriate for the media.
     */
    public sourceIdentity(): string {
        return this._sourceIdentity;
    }

    /**
     * The initial term at which the stream started for this session.
     *
     * @return the initial term id.
     */
    public initialTermId(): number {
        return this._initialTermId;
    }

    /**
     * The correlationId for identification of the image with the media driver.
     *
     * @return the correlationId for identification of the image with the media driver.
     */
    public correlationId(): number {
        return this._correlationId;
    }

    /**
     * Get the {@link Subscription} to which this {@link Image} belongs.
     *
     * @return the {@link Subscription} to which this {@link Image} belongs.
     */
    public subscription(): Subscription {
        return this._subscription;
    }

    /**
     * Has this object been closed and should no longer be used?
     *
     * @return true if it has been closed otherwise false.
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * The position at which this stream was joined by the subscriber.
     *
     * @return the position at which this stream was joined by the subscriber.
     */
    public joinPosition(): number {
        return this._joinPosition;
    }

    /**
     * The position this {@link Image} has been consumed to by the subscriber.
     *
     * @return the position this {@link Image} has been consumed to by the subscriber.
     */
    public position(): number {
        if (this._isClosed) {
            return this.finalPosition;
        }

        return this.subscriberPosition.get();
    }

    /**
     * Get the counter id used to represent the subscriber position.
     *
     * @return the counter id used to represent the subscriber position.
     */
    public subscriberPositionId(): number {
        return this.subscriberPosition.id();
    }

    /**
     * Is the current consumed position at the end of the stream?
     *
     * @return true if at the end of the stream or false if not.
     */
    public isEndOfStream(): boolean {
        if (this._isClosed) {
            return this.isEos;
        }

        return (
            this.subscriberPosition.get() >= LogBufferDescriptor.endOfStreamPosition(this._logBuffers.metaDataBuffer())
        );
    }

    /**
     * Get the position the stream will end at.
     *
     * @return the position the stream will end at, {@link LogBufferDescriptor.MAX_POSITION} (the `Long.MAX_VALUE` of
     * Java, spec D12) until it is known.
     */
    public endOfStreamPosition(): number {
        if (this._isClosed) {
            return this.eosPosition;
        }

        return LogBufferDescriptor.endOfStreamPosition(this._logBuffers.metaDataBuffer());
    }

    /**
     * Count of observed active transports within the image liveness timeout.
     * <p>
     * If the image is closed, then this is 0. This may also be 0 if no actual datagrams have arrived. IPC
     * Images also will be 0.
     *
     * @return count of active transports - typically 1 or more unless Multi-Destination-Cast.
     */
    public activeTransportCount(): number {
        if (this._isClosed) {
            return 0;
        }

        return LogBufferDescriptor.activeTransportCount(this._logBuffers.metaDataBuffer());
    }

    /**
     * Has the publication been revoked?
     *
     * @return true if the publication was revoked, otherwise false.
     */
    public isPublicationRevoked(): boolean {
        if (this._isClosed) {
            return this.isRevoked;
        }

        return LogBufferDescriptor.isPublicationRevoked(this._logBuffers.metaDataBuffer());
    }

    /**
     * The `FileChannel` of the log: the log is in memory (spec D4) and has no file, so this is `null`.
     *
     * @return the file channel of the log, none.
     */
    public fileChannel(): unknown {
        return this._logBuffers.fileChannel();
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered via the {@link FragmentHandler} up to a limited number of fragments as specified.
     * <p>
     * Use a {@link FragmentAssembler} to assemble messages which span multiple fragments.
     *
     * @param fragmentHandler to which message fragments are delivered.
     * @param fragmentLimit   for the number of fragments to be consumed during one polling operation.
     * @return the number of fragments that have been consumed.
     * @see FragmentAssembler
     * @see ImageFragmentAssembler
     */
    public poll(fragmentHandler: FragmentHandler, fragmentLimit: number): number {
        if (this._isClosed) {
            return 0;
        }

        let fragmentsRead = 0;
        const initialPosition = this.subscriberPosition.get();
        const initialOffset = initialPosition & this.termLengthMask;
        let offset = initialOffset;
        const termBuffer = this.activeTermBuffer(initialPosition);
        const capacity = termBuffer.capacity();
        const header = this.header;
        header.buffer(termBuffer);

        try {
            while (fragmentsRead < fragmentLimit && offset < capacity && !this._isClosed) {
                const frameLength = frameLengthVolatile(termBuffer, offset);
                if (frameLength <= 0) {
                    break;
                }

                const frameOffset = offset;
                offset += BitUtil.align(frameLength, FRAME_ALIGNMENT);

                if (!isPaddingFrame(termBuffer, frameOffset)) {
                    ++fragmentsRead;
                    header.offset(frameOffset);
                    fragmentHandler.onFragment(
                        termBuffer,
                        frameOffset + HEADER_LENGTH,
                        frameLength - HEADER_LENGTH,
                        header,
                    );
                }
            }
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        } finally {
            const newPosition = initialPosition + (offset - initialOffset);
            if (newPosition > initialPosition && !this._isClosed) {
                this.subscriberPosition.setRelease(newPosition);
            }
        }

        return fragmentsRead;
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered via the {@link ControlledFragmentHandler} up to a limited number of fragments as specified.
     * <p>
     * Use a {@link ControlledFragmentAssembler} to assemble messages which span multiple fragments.
     * <p>
     * To assemble messages that span multiple fragments then use {@link ControlledImageFragmentAssembler}.
     *
     * @param handler       to which message fragments are delivered.
     * @param fragmentLimit for the number of fragments to be consumed during one polling operation.
     * @return the number of fragments that have been consumed.
     * @see ControlledFragmentAssembler
     * @see ImageControlledFragmentAssembler
     */
    public controlledPoll(handler: ControlledFragmentHandler, fragmentLimit: number): number {
        if (this._isClosed) {
            return 0;
        }

        let fragmentsRead = 0;
        let initialPosition = this.subscriberPosition.get();
        let initialOffset = initialPosition & this.termLengthMask;
        let offset = initialOffset;
        const termBuffer = this.activeTermBuffer(initialPosition);
        const capacity = termBuffer.capacity();
        const header = this.header;
        header.buffer(termBuffer);

        try {
            while (fragmentsRead < fragmentLimit && offset < capacity && !this._isClosed) {
                const length = frameLengthVolatile(termBuffer, offset);
                if (length <= 0) {
                    break;
                }

                const frameOffset = offset;
                const alignedLength = BitUtil.align(length, FRAME_ALIGNMENT);
                offset += alignedLength;

                if (isPaddingFrame(termBuffer, frameOffset)) {
                    continue;
                }

                ++fragmentsRead;
                header.offset(frameOffset);

                const action = handler.onFragment(
                    termBuffer,
                    frameOffset + HEADER_LENGTH,
                    length - HEADER_LENGTH,
                    header,
                );

                if (ABORT === action) {
                    --fragmentsRead;
                    offset -= alignedLength;
                    break;
                }

                if (BREAK === action) {
                    break;
                }

                if (COMMIT === action) {
                    initialPosition += offset - initialOffset;
                    initialOffset = offset;
                    if (!this._isClosed) {
                        this.subscriberPosition.setRelease(initialPosition);
                    }
                }
            }
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        } finally {
            const resultingPosition = initialPosition + (offset - initialOffset);
            if (resultingPosition > initialPosition && !this._isClosed) {
                this.subscriberPosition.setRelease(resultingPosition);
            }
        }

        return fragmentsRead;
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered via the {@link FragmentHandler} up to a limited number of fragments as specified or
     * the maximum position specified.
     * <p>
     * Use a {@link FragmentAssembler} to assemble messages which span multiple fragments.
     *
     * @param handler       to which message fragments are delivered.
     * @param limitPosition to consume messages up to.
     * @param fragmentLimit for the number of fragments to be consumed during one polling operation.
     * @return the number of fragments that have been consumed.
     * @see FragmentAssembler
     * @see ImageFragmentAssembler
     */
    public boundedPoll(handler: FragmentHandler, limitPosition: number, fragmentLimit: number): number {
        if (this._isClosed) {
            return 0;
        }

        const initialPosition = this.subscriberPosition.get();
        if (initialPosition >= limitPosition) {
            return 0;
        }

        let fragmentsRead = 0;
        const initialOffset = initialPosition & this.termLengthMask;
        let offset = initialOffset;
        const termBuffer = this.activeTermBuffer(initialPosition);
        // Java: (int)Math.min(termBuffer.capacity(), (limitPosition - initialPosition) + offset); the minimum is at
        // most the capacity, an int, so the cast is exact
        const limitOffset = Math.min(termBuffer.capacity(), limitPosition - initialPosition + offset);
        const header = this.header;
        header.buffer(termBuffer);

        try {
            while (fragmentsRead < fragmentLimit && offset < limitOffset && !this._isClosed) {
                const length = frameLengthVolatile(termBuffer, offset);
                if (length <= 0) {
                    break;
                }

                const frameOffset = offset;
                const alignedLength = BitUtil.align(length, FRAME_ALIGNMENT);
                offset += alignedLength;

                if (isPaddingFrame(termBuffer, frameOffset)) {
                    continue;
                }

                ++fragmentsRead;
                header.offset(frameOffset);
                handler.onFragment(termBuffer, frameOffset + HEADER_LENGTH, length - HEADER_LENGTH, header);
            }
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        } finally {
            const resultingPosition = initialPosition + (offset - initialOffset);
            if (resultingPosition > initialPosition && !this._isClosed) {
                this.subscriberPosition.setRelease(resultingPosition);
            }
        }

        return fragmentsRead;
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered via the {@link ControlledFragmentHandler} up to a limited number of fragments as specified or
     * the maximum position specified.
     * <p>
     * To assemble messages that span multiple fragments then use {@link ControlledImageFragmentAssembler}.
     *
     * @param handler       to which message fragments are delivered.
     * @param limitPosition to consume messages up to.
     * @param fragmentLimit for the number of fragments to be consumed during one polling operation.
     * @return the number of fragments that have been consumed.
     * @see ControlledFragmentAssembler
     * @see ImageControlledFragmentAssembler
     */
    public boundedControlledPoll(
        handler: ControlledFragmentHandler,
        limitPosition: number,
        fragmentLimit: number,
    ): number {
        if (this._isClosed) {
            return 0;
        }

        const subscriberPosition = this.subscriberPosition;
        let initialPosition = subscriberPosition.get();
        if (initialPosition >= limitPosition) {
            return 0;
        }

        let fragmentsRead = 0;
        let initialOffset = initialPosition & this.termLengthMask;
        let offset = initialOffset;
        const termBuffer = this.activeTermBuffer(initialPosition);
        const limitOffset = Math.min(termBuffer.capacity(), limitPosition - initialPosition + offset);
        const header = this.header;
        header.buffer(termBuffer);

        try {
            while (fragmentsRead < fragmentLimit && offset < limitOffset && !this._isClosed) {
                const length = frameLengthVolatile(termBuffer, offset);
                if (length <= 0) {
                    break;
                }

                const frameOffset = offset;
                const alignedLength = BitUtil.align(length, FRAME_ALIGNMENT);
                offset += alignedLength;

                if (isPaddingFrame(termBuffer, frameOffset)) {
                    continue;
                }

                ++fragmentsRead;
                header.offset(frameOffset);

                const action = handler.onFragment(
                    termBuffer,
                    frameOffset + HEADER_LENGTH,
                    length - HEADER_LENGTH,
                    header,
                );

                if (ABORT === action) {
                    --fragmentsRead;
                    offset -= alignedLength;
                    break;
                }

                if (BREAK === action) {
                    break;
                }

                if (COMMIT === action) {
                    initialPosition += offset - initialOffset;
                    initialOffset = offset;
                    if (!this._isClosed) {
                        subscriberPosition.setRelease(initialPosition);
                    }
                }
            }
        } catch (ex) {
            this.errorHandler.onError(ex as Error);
        } finally {
            const resultingPosition = initialPosition + (offset - initialOffset);
            if (resultingPosition > initialPosition && !this._isClosed) {
                subscriberPosition.setRelease(resultingPosition);
            }
        }

        return fragmentsRead;
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered as a block of fragments up to a limited number of bytes.
     * <p>
     * Note: If the {@link Image} is closed, the position will only be updated to the end of the current block
     * (not the end of the block before it was closed).
     *
     * @param handler          to which block of messages is delivered.
     * @param blockLengthLimit up to which a block may be in length.
     * @return the number of bytes that have been consumed.
     */
    public blockPoll(handler: BlockHandler, blockLengthLimit: number): number {
        if (this._isClosed) {
            return 0;
        }

        const position = this.subscriberPosition.get();
        const offset = position & this.termLengthMask;
        const limitOffset = Math.min(offset + blockLengthLimit, this.termLengthMask + 1);
        const termBuffer = this.activeTermBuffer(position);
        const resultingOffset = TermBlockScanner.scan(termBuffer, offset, limitOffset);
        const length = resultingOffset - offset;

        if (resultingOffset > offset) {
            try {
                const termId = termBuffer.getInt(offset + TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);

                handler.onBlock(termBuffer, offset, length, this._sessionId, termId);
            } catch (ex) {
                this.errorHandler.onError(ex as Error);
            } finally {
                if (!this._isClosed) {
                    this.subscriberPosition.setRelease(position + length);
                }
            }
        }

        return length;
    }

    /**
     * Poll for new messages in a stream. If new messages are found beyond the last consumed position then they
     * will be delivered as a block of fragments up to a limited number of bytes, with the `FileChannel` of the log
     * (none: the log is in memory, spec D4).
     * <p>
     * Note: If the {@link Image} is closed, the position will only be updated to the end of the current block
     * (not the end of the block before it was closed).
     *
     * @param handler          to which block of messages is delivered.
     * @param blockLengthLimit up to which a block may be in length.
     * @return the number of bytes that have been consumed.
     */
    public rawPoll(handler: RawBlockHandler, blockLengthLimit: number): number {
        if (this._isClosed) {
            return 0;
        }

        const position = this.subscriberPosition.get();
        const offset = position & this.termLengthMask;
        const activeIndex = LogBufferDescriptor.indexByPosition(position, this._positionBitsToShift);
        const termBuffer = this.termBuffers[activeIndex] as UnsafeBuffer;
        const capacity = termBuffer.capacity();
        const limitOffset = Math.min(offset + blockLengthLimit, capacity);
        const resultingOffset = TermBlockScanner.scan(termBuffer, offset, limitOffset);
        const length = resultingOffset - offset;

        if (resultingOffset > offset) {
            try {
                const fileOffset = capacity * activeIndex + offset;
                const termId = termBuffer.getInt(offset + TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);

                handler.onBlock(
                    this._logBuffers.fileChannel(),
                    fileOffset,
                    termBuffer,
                    offset,
                    length,
                    this._sessionId,
                    termId,
                );
            } catch (ex) {
                this.errorHandler.onError(ex as Error);
            } finally {
                if (!this._isClosed) {
                    this.subscriberPosition.setRelease(position + length);
                }
            }
        }

        return length;
    }

    /**
     * Reject the image, the media driver is asked to stop it and to report the reason to the publisher.
     *
     * @param reason the reason for rejecting the image.
     */
    public reject(reason: string): void {
        this._subscription.rejectImage(this._correlationId, this.position(), reason);
    }

    private activeTermBuffer(position: number): UnsafeBuffer {
        return this.termBuffers[
            LogBufferDescriptor.indexByPosition(position, this._positionBitsToShift)
        ] as UnsafeBuffer;
    }

    // Never called, in Java either (a leftover of the position setter that was removed).
    private validatePosition(position: number): void {
        const currentPosition = this.subscriberPosition.get();
        const limitPosition = currentPosition - (currentPosition & this.termLengthMask) + this.termLengthMask + 1;
        if (position < currentPosition || position > limitPosition) {
            throw new IllegalArgumentException(
                position + ' position out of range: ' + currentPosition + '-' + limitPosition,
            );
        }

        if (0 !== (position & (FRAME_ALIGNMENT - 1))) {
            throw new IllegalArgumentException(position + ' position not aligned to FRAME_ALIGNMENT');
        }
    }

    /** @internal package-private in Java */
    public logBuffers(): ImageLogBuffers {
        return this._logBuffers;
    }

    /** @internal package-private in Java */
    public close(): void {
        this.finalPosition = this.subscriberPosition.getVolatile();
        this.eosPosition = LogBufferDescriptor.endOfStreamPosition(this._logBuffers.metaDataBuffer());
        this.isEos = this.finalPosition >= this.eosPosition;
        this.isRevoked = LogBufferDescriptor.isPublicationRevoked(this._logBuffers.metaDataBuffer());
        this._isClosed = true;
    }

    public toString(): string {
        return (
            'Image{' +
            'correlationId=' +
            this._correlationId +
            ', sessionId=' +
            this._sessionId +
            ', isClosed=' +
            this._isClosed +
            ', isEos=' +
            this.isEndOfStream() +
            ', initialTermId=' +
            this._initialTermId +
            ', termLength=' +
            (this.termLengthMask + 1) +
            ', joinPosition=' +
            this._joinPosition +
            ', position=' +
            this.position() +
            ', endOfStreamPosition=' +
            this.endOfStreamPosition() +
            ', activeTransportCount=' +
            this.activeTransportCount() +
            ", sourceIdentity='" +
            this._sourceIdentity +
            "'" +
            ', subscription=' +
            String(this._subscription) +
            '}'
        );
    }
}
