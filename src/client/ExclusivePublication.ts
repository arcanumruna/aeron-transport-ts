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
// Port of io/aeron/ExclusivePublication.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { ByteOrder, IllegalArgumentException } from '../agrona/jdk.js';
import type { MutableDirectBuffer } from '../agrona/MutableDirectBuffer.js';
import { DirectBufferVector } from './DirectBufferVector.js';
import type { BufferClaim } from './logbuffer/BufferClaim.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from './protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from './protocol/HeaderFlyweight.js';
import { Publication } from './Publication.js';
import type { ClientConductor } from './ClientConductor.js';
import type { LogBuffers } from './LogBuffers.js';
import type { ReservedValueSupplier } from './ReservedValueSupplier.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { align, SIZE_OF_LONG } = BitUtil;
const {
    HEADER_LENGTH,
    SESSION_ID_FIELD_OFFSET,
    STREAM_ID_FIELD_OFFSET,
    TERM_ID_FIELD_OFFSET,
    TERM_OFFSET_FIELD_OFFSET,
} = DataHeaderFlyweight;
const { HDR_TYPE_DATA, TYPE_FIELD_OFFSET } = HeaderFlyweight;
const {
    BEGIN_FRAG_FLAG,
    END_FRAG_FLAG,
    FRAME_ALIGNMENT,
    PADDING_FRAME_TYPE,
    frameFlags,
    frameLengthOrdered,
    frameType,
} = FrameDescriptor;
const {
    TERM_TAIL_COUNTERS_OFFSET,
    activeTermCount,
    activeTermCountOrdered,
    computeFragmentedFrameLength,
    computeTermBeginPosition,
    indexByTermCount,
    initialiseTailWithTermId,
    nextPartitionIndex,
} = LogBufferDescriptor;
const { ADMIN_ACTION, CLOSED, MAX_POSITION_EXCEEDED } = Publication;

/**
 * Aeron publisher API for sending messages to subscribers of a given channel and streamId pair. ExclusivePublications
 * each get their own session id so multiple can be concurrently active on the same media driver as independent
 * streams.
 * <p>
 * {@link ExclusivePublication}s are created via the {@link Aeron.addExclusivePublication} method, and messages are
 * sent via one of the {@link offer} methods, or a {@link tryClaim} and {@link BufferClaim.commit} pair of methods.
 * <p>
 * By using an exclusive publication instance, the claim of the tail of the log is a plain store in place of an
 * atomic add. <b>Note:</b> ExclusivePublication instances are NOT thread safe for offer and tryClaim methods, but
 * are for the other methods.
 *
 * @see Aeron.addExclusivePublication
 */
export class ExclusivePublication extends Publication {
    // The fields of Java that share a name with an accessor have a leading underscore (spec D80). The padding fields
    // of Java are not ported (no field layout in JS, spec D11, D19).
    private _termOffset: number = 0;
    private _termId: number = 0;
    private activePartitionIndex: number = 0;
    private termBeginPosition: number = 0;

    /** @internal package-private in Java */
    public constructor(
        clientConductor: ClientConductor,
        channel: string,
        streamId: number,
        sessionId: number,
        positionLimit: ReadablePosition,
        channelStatusId: number,
        logBuffers: LogBuffers,
        originalRegistrationId: number,
        registrationId: number,
    ) {
        super(
            clientConductor,
            channel,
            streamId,
            sessionId,
            positionLimit,
            channelStatusId,
            logBuffers,
            originalRegistrationId,
            registrationId,
        );

        const logMetaDataBuffer = logBuffers.metaDataBuffer();
        const termCount = activeTermCount(logMetaDataBuffer);
        const index = indexByTermCount(termCount);
        this.activePartitionIndex = index;

        const rawTail = LogBufferDescriptor.rawTail(logMetaDataBuffer, index);
        this._termId = LogBufferDescriptor.termId(rawTail);
        this._termOffset = LogBufferDescriptor.termOffset(rawTail);
        this.termBeginPosition = computeTermBeginPosition(this._termId, this._positionBitsToShift, this._initialTermId);
    }

    /**
     * Revoke the publication on close, which will inform the driver and the subscribers that this publication is
     * revoked: its stream is not to be continued by another publication.
     */
    public revokeOnClose(): void {
        this._revokeOnClose = true;
    }

    /**
     * Revoke the publication and close it: the driver and the subscribers are told that the stream is revoked.
     */
    public revoke(): void {
        if (!this._isClosed) {
            this._revokeOnClose = true;
            this.close();
        }
    }

    /**
     * {@inheritDoc}
     */
    public override position(): number {
        if (this._isClosed) {
            return CLOSED;
        }

        return this.termBeginPosition + this._termOffset;
    }

    /**
     * {@inheritDoc}
     */
    public availableWindow(): number {
        if (this._isClosed) {
            return CLOSED;
        }

        return this._positionLimit.getVolatile() - (this.termBeginPosition + this._termOffset);
    }

    /**
     * The current term-id of the publication.
     *
     * @return the current term-id of the publication.
     */
    public termId(): number {
        return this._termId;
    }

    /**
     * The current term-offset of the publication.
     *
     * @return the current term-offset of the publication.
     */
    public termOffset(): number {
        return this._termOffset;
    }

    /**
     * Non-blocking publish of a partial buffer containing a message.
     *
     * @param buffer                containing message.
     * @param offset                offset in the buffer at which the encoded message begins, 0 by default.
     * @param length                in bytes of the encoded message, the capacity of the buffer by default.
     * @param reservedValueSupplier {@link ReservedValueSupplier} for the frame, none by default.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     */
    public offer(
        buffer: DirectBuffer,
        offset: number = 0,
        length: number = buffer.capacity(),
        reservedValueSupplier: ReservedValueSupplier | null = null,
    ): number {
        let newPosition = CLOSED;
        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const position = this.termBeginPosition + this._termOffset;

            if (position < limit) {
                const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
                const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
                let result: number;

                if (length <= this._maxPayloadLength) {
                    this.checkPositiveLength(length);
                    result = this.appendUnfragmentedMessage(
                        tailCounterOffset,
                        termBuffer,
                        buffer,
                        offset,
                        length,
                        reservedValueSupplier,
                    );
                } else {
                    this.checkMaxMessageLength(length);
                    result = this.appendFragmentedMessage(
                        termBuffer,
                        tailCounterOffset,
                        buffer,
                        offset,
                        length,
                        reservedValueSupplier,
                    );
                }

                newPosition = this.newPosition(result);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * Non-blocking publish of a message composed of two parts, e.g. a header and encapsulated payload.
     *
     * @param bufferOne             containing the first part of the message.
     * @param offsetOne             at which the first part of the message begins.
     * @param lengthOne             of the first part of the message.
     * @param bufferTwo             containing the second part of the message.
     * @param offsetTwo             at which the second part of the message begins.
     * @param lengthTwo             of the second part of the message.
     * @param reservedValueSupplier {@link ReservedValueSupplier} for the frame, none by default.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     */
    public offerTwoBuffers(
        bufferOne: DirectBuffer,
        offsetOne: number,
        lengthOne: number,
        bufferTwo: DirectBuffer,
        offsetTwo: number,
        lengthTwo: number,
        reservedValueSupplier: ReservedValueSupplier | null = null,
    ): number {
        let newPosition = CLOSED;
        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const position = this.termBeginPosition + this._termOffset;
            const length = Publication.validateAndComputeLength(lengthOne, lengthTwo);

            if (position < limit) {
                const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
                const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
                let result: number;

                if (length <= this._maxPayloadLength) {
                    this.checkPositiveLength(length);
                    result = this.appendUnfragmentedMessageTwoBuffers(
                        termBuffer,
                        tailCounterOffset,
                        bufferOne,
                        offsetOne,
                        lengthOne,
                        bufferTwo,
                        offsetTwo,
                        lengthTwo,
                        reservedValueSupplier,
                    );
                } else {
                    this.checkMaxMessageLength(length);
                    result = this.appendFragmentedMessageTwoBuffers(
                        termBuffer,
                        tailCounterOffset,
                        bufferOne,
                        offsetOne,
                        lengthOne,
                        bufferTwo,
                        offsetTwo,
                        lengthTwo,
                        this._maxPayloadLength,
                        reservedValueSupplier,
                    );
                }

                newPosition = this.newPosition(result);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * Non-blocking publish by gathering buffer vectors into a message.
     *
     * @param vectors               which make up the message.
     * @param reservedValueSupplier {@link ReservedValueSupplier} for the frame, none by default.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     */
    public offerVectored(
        vectors: readonly DirectBufferVector[],
        reservedValueSupplier: ReservedValueSupplier | null = null,
    ): number {
        const length = DirectBufferVector.validateAndComputeLength(vectors);
        let newPosition = CLOSED;

        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const position = this.termBeginPosition + this._termOffset;

            if (position < limit) {
                const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
                const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
                let result: number;

                if (length <= this._maxPayloadLength) {
                    result = this.appendUnfragmentedMessageVectored(
                        termBuffer,
                        tailCounterOffset,
                        vectors,
                        length,
                        reservedValueSupplier,
                    );
                } else {
                    this.checkMaxMessageLength(length);
                    result = this.appendFragmentedMessageVectored(
                        termBuffer,
                        tailCounterOffset,
                        vectors,
                        length,
                        reservedValueSupplier,
                    );
                }

                newPosition = this.newPosition(result);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * {@inheritDoc}
     */
    public tryClaim(length: number, bufferClaim: BufferClaim): number {
        this.checkPayloadLength(length);
        let newPosition = CLOSED;

        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const position = this.termBeginPosition + this._termOffset;

            if (position < limit) {
                const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
                const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
                const result = this.claim(termBuffer, tailCounterOffset, length, bufferClaim);

                newPosition = this.newPosition(result);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * Append a padding record to log of a given length to make up the log to a position.
     *
     * @param length of the range to claim, in bytes.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     * @throws IllegalArgumentException if the length is greater than {@link maxMessageLength}.
     */
    public appendPadding(length: number): number {
        if (length > this.maxFramedLength) {
            throw new IllegalArgumentException(
                'padding exceeds maxFramedLength of ' + this.maxFramedLength + ', length=' + length,
            );
        }

        let newPosition = CLOSED;
        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const position = this.termBeginPosition + this._termOffset;

            if (position < limit) {
                this.checkPositiveLength(length);
                const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
                const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
                const result = this.appendPaddingFrame(termBuffer, tailCounterOffset, length);

                newPosition = this.newPosition(result);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * Offer a block of pre-formatted message fragments directly into the current term.
     *
     * @param buffer containing the pre-formatted block of message fragments.
     * @param offset offset in the buffer at which the first fragment begins.
     * @param length in bytes of the encoded block.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     * @throws IllegalArgumentException if the length is greater than the remaining size of the current term, or
     * if the first frame within the block is not properly formatted, i.e. if it does not contain the correct
     * `sessionId`, `streamId` and `termId`, and a `termOffset` that matches the one of the publication.
     */
    public offerBlock(buffer: MutableDirectBuffer, offset: number, length: number): number {
        if (this._isClosed) {
            return CLOSED;
        }

        if (this._termOffset >= this._termBufferLength) {
            this.rotateTerm();
        }

        const limit = this._positionLimit.getVolatile();
        const position = this.termBeginPosition + this._termOffset;

        if (position < limit) {
            this.checkBlockLength(length);
            this.checkFirstFrame(buffer, offset);

            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + this.activePartitionIndex * SIZE_OF_LONG;
            const termBuffer = this.termBuffers[this.activePartitionIndex] as UnsafeBuffer;
            const result = this.appendBlock(termBuffer, tailCounterOffset, buffer, offset, length);

            return this.newPosition(result);
        }

        return this.backPressureStatus(position, length);
    }

    private checkBlockLength(length: number): void {
        const remaining = this._termBufferLength - this._termOffset;
        if (length > remaining) {
            throw new IllegalArgumentException(
                'invalid block length ' + length + ', remaining space in term is ' + remaining,
            );
        }
    }

    private checkFirstFrame(buffer: MutableDirectBuffer, offset: number): void {
        const frameType = HDR_TYPE_DATA;
        const blockTermOffset = buffer.getInt(offset + TERM_OFFSET_FIELD_OFFSET, LITTLE_ENDIAN);
        const blockSessionId = buffer.getInt(offset + SESSION_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        const blockStreamId = buffer.getInt(offset + STREAM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        const blockTermId = buffer.getInt(offset + TERM_ID_FIELD_OFFSET, LITTLE_ENDIAN);
        const blockFrameType = buffer.getShort(offset + TYPE_FIELD_OFFSET, LITTLE_ENDIAN) & 0xffff;

        if (
            blockTermOffset !== this._termOffset ||
            blockSessionId !== this._sessionId ||
            blockStreamId !== this._streamId ||
            blockTermId !== this._termId ||
            frameType !== blockFrameType
        ) {
            throw new IllegalArgumentException(
                'improperly formatted block:' +
                    ' termOffset=' +
                    blockTermOffset +
                    ' (expected=' +
                    this._termOffset +
                    '),' +
                    ' sessionId=' +
                    blockSessionId +
                    ' (expected=' +
                    this._sessionId +
                    '),' +
                    ' streamId=' +
                    blockStreamId +
                    ' (expected=' +
                    this._streamId +
                    '),' +
                    ' termId=' +
                    blockTermId +
                    ' (expected=' +
                    this._termId +
                    '),' +
                    ' frameType=' +
                    blockFrameType +
                    ' (expected=' +
                    frameType +
                    ')',
            );
        }
    }

    private newPosition(resultingOffset: number): number {
        if (resultingOffset > 0) {
            this._termOffset = resultingOffset;
            return this.termBeginPosition + resultingOffset;
        }

        if (this.termBeginPosition + this._termBufferLength >= this._maxPossiblePosition) {
            return MAX_POSITION_EXCEEDED;
        }

        this.rotateTerm();

        return ADMIN_ACTION;
    }

    private rotateTerm(): void {
        const nextIndex = nextPartitionIndex(this.activePartitionIndex);
        const nextTermId = (this._termId + 1) | 0;

        this.activePartitionIndex = nextIndex;
        this._termOffset = 0;
        this._termId = nextTermId;
        this.termBeginPosition += this._termBufferLength;

        const termCount = (nextTermId - this._initialTermId) | 0;

        initialiseTailWithTermId(this.logMetaDataBuffer, nextIndex, nextTermId);
        activeTermCountOrdered(this.logMetaDataBuffer, termCount);
    }

    private handleEndOfLog(termBuffer: UnsafeBuffer, termLength: number): number {
        if (this._termOffset < termLength) {
            const offset = this._termOffset;
            const paddingLength = termLength - offset;
            this.headerWriter.write(termBuffer, offset, paddingLength, this._termId);
            frameType(termBuffer, offset, PADDING_FRAME_TYPE);
            frameLengthOrdered(termBuffer, offset, paddingLength);
        }

        return -1;
    }

    /**
     * Java's `logMetaDataBuffer.putLongRelease(tailCounterOffset, packTail(termId, resultingOffset))`: the two halves
     * of the raw tail in one volatile store, without a `bigint` (spec D12, D16).
     */
    private storeTail(tailCounterOffset: number, resultingOffset: number): void {
        this.logMetaDataBuffer.putLongVolatileHalves(tailCounterOffset, resultingOffset, this._termId);
    }

    private appendUnfragmentedMessage(
        tailCounterOffset: number,
        termBuffer: UnsafeBuffer,
        srcBuffer: DirectBuffer,
        srcOffset: number,
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + alignedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            const termOffset = this._termOffset;
            this.headerWriter.write(termBuffer, termOffset, frameLength, this._termId);
            termBuffer.putBytes(termOffset + HEADER_LENGTH, srcBuffer, srcOffset, length);

            if (null !== reservedValueSupplier) {
                const reservedValue = reservedValueSupplier.get(termBuffer, termOffset, frameLength);
                Publication.putReservedValue(termBuffer, termOffset, reservedValue);
            }

            frameLengthOrdered(termBuffer, termOffset, frameLength);
        }

        return resultingOffset;
    }

    private appendFragmentedMessage(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        srcBuffer: DirectBuffer,
        srcOffset: number,
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const maxPayloadLength = this._maxPayloadLength;
        const framedLength = computeFragmentedFrameLength(length, maxPayloadLength);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + framedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            let frameOffset = this._termOffset;
            let flags = BEGIN_FRAG_FLAG;
            let remaining = length;
            do {
                const bytesToWrite = Math.min(remaining, maxPayloadLength);
                const frameLength = bytesToWrite + HEADER_LENGTH;
                const alignedLength = align(frameLength, FRAME_ALIGNMENT);

                this.headerWriter.write(termBuffer, frameOffset, frameLength, this._termId);
                termBuffer.putBytes(
                    frameOffset + HEADER_LENGTH,
                    srcBuffer,
                    srcOffset + (length - remaining),
                    bytesToWrite,
                );

                if (remaining <= maxPayloadLength) {
                    flags |= END_FRAG_FLAG;
                }

                frameFlags(termBuffer, frameOffset, flags);

                if (null !== reservedValueSupplier) {
                    const reservedValue = reservedValueSupplier.get(termBuffer, frameOffset, frameLength);
                    Publication.putReservedValue(termBuffer, frameOffset, reservedValue);
                }

                frameLengthOrdered(termBuffer, frameOffset, frameLength);

                flags = 0;
                frameOffset += alignedLength;
                remaining -= bytesToWrite;
            } while (remaining > 0);
        }

        return resultingOffset;
    }

    private appendUnfragmentedMessageTwoBuffers(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        bufferOne: DirectBuffer,
        offsetOne: number,
        lengthOne: number,
        bufferTwo: DirectBuffer,
        offsetTwo: number,
        lengthTwo: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const frameLength = lengthOne + lengthTwo + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + alignedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            const termOffset = this._termOffset;
            this.headerWriter.write(termBuffer, termOffset, frameLength, this._termId);
            termBuffer.putBytes(termOffset + HEADER_LENGTH, bufferOne, offsetOne, lengthOne);
            termBuffer.putBytes(termOffset + HEADER_LENGTH + lengthOne, bufferTwo, offsetTwo, lengthTwo);

            if (null !== reservedValueSupplier) {
                const reservedValue = reservedValueSupplier.get(termBuffer, termOffset, frameLength);
                Publication.putReservedValue(termBuffer, termOffset, reservedValue);
            }

            frameLengthOrdered(termBuffer, termOffset, frameLength);
        }

        return resultingOffset;
    }

    private appendFragmentedMessageTwoBuffers(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        bufferOne: DirectBuffer,
        offsetOne: number,
        lengthOne: number,
        bufferTwo: DirectBuffer,
        offsetTwo: number,
        lengthTwo: number,
        maxPayloadLength: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const length = lengthOne + lengthTwo;
        const framedLength = computeFragmentedFrameLength(length, maxPayloadLength);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + framedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            let frameOffset = this._termOffset;
            let flags = BEGIN_FRAG_FLAG;
            let remaining = length;
            let positionOne = 0;
            let positionTwo = 0;

            do {
                const bytesToWrite = Math.min(remaining, maxPayloadLength);
                const frameLength = bytesToWrite + HEADER_LENGTH;
                const alignedLength = align(frameLength, FRAME_ALIGNMENT);

                this.headerWriter.write(termBuffer, frameOffset, frameLength, this._termId);

                let bytesWritten = 0;
                let payloadOffset = frameOffset + HEADER_LENGTH;
                do {
                    const remainingOne = lengthOne - positionOne;
                    if (remainingOne > 0) {
                        const numBytes = Math.min(bytesToWrite - bytesWritten, remainingOne);
                        termBuffer.putBytes(payloadOffset, bufferOne, offsetOne + positionOne, numBytes);

                        bytesWritten += numBytes;
                        payloadOffset += numBytes;
                        positionOne += numBytes;
                    } else {
                        const numBytes = Math.min(bytesToWrite - bytesWritten, lengthTwo - positionTwo);
                        termBuffer.putBytes(payloadOffset, bufferTwo, offsetTwo + positionTwo, numBytes);

                        bytesWritten += numBytes;
                        payloadOffset += numBytes;
                        positionTwo += numBytes;
                    }
                } while (bytesWritten < bytesToWrite);

                if (remaining <= maxPayloadLength) {
                    flags |= END_FRAG_FLAG;
                }

                frameFlags(termBuffer, frameOffset, flags);

                if (null !== reservedValueSupplier) {
                    const reservedValue = reservedValueSupplier.get(termBuffer, frameOffset, frameLength);
                    Publication.putReservedValue(termBuffer, frameOffset, reservedValue);
                }

                frameLengthOrdered(termBuffer, frameOffset, frameLength);

                flags = 0;
                frameOffset += alignedLength;
                remaining -= bytesToWrite;
            } while (remaining > 0);
        }

        return resultingOffset;
    }

    private appendUnfragmentedMessageVectored(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        vectors: readonly DirectBufferVector[],
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + alignedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            const termOffset = this._termOffset;
            this.headerWriter.write(termBuffer, termOffset, frameLength, this._termId);

            let offset = termOffset + HEADER_LENGTH;
            for (let i = 0, count = vectors.length; i < count; i++) {
                const vector = vectors[i] as DirectBufferVector;
                termBuffer.putBytes(offset, vector.buffer(), vector.offset(), vector.length());
                offset += vector.length();
            }

            if (null !== reservedValueSupplier) {
                const reservedValue = reservedValueSupplier.get(termBuffer, termOffset, frameLength);
                Publication.putReservedValue(termBuffer, termOffset, reservedValue);
            }

            frameLengthOrdered(termBuffer, termOffset, frameLength);
        }

        return resultingOffset;
    }

    private appendFragmentedMessageVectored(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        vectors: readonly DirectBufferVector[],
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const maxPayloadLength = this._maxPayloadLength;
        const framedLength = computeFragmentedFrameLength(length, maxPayloadLength);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + framedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            let frameOffset = this._termOffset;
            let flags = BEGIN_FRAG_FLAG;
            let remaining = length;
            let vectorIndex = 0;
            let vectorOffset = 0;

            do {
                const bytesToWrite = Math.min(remaining, maxPayloadLength);
                const frameLength = bytesToWrite + HEADER_LENGTH;
                const alignedLength = align(frameLength, FRAME_ALIGNMENT);

                this.headerWriter.write(termBuffer, frameOffset, frameLength, this._termId);

                let bytesWritten = 0;
                let payloadOffset = frameOffset + HEADER_LENGTH;
                do {
                    const vector = vectors[vectorIndex] as DirectBufferVector;
                    const vectorRemaining = vector.length() - vectorOffset;
                    const numBytes = Math.min(bytesToWrite - bytesWritten, vectorRemaining);

                    termBuffer.putBytes(payloadOffset, vector.buffer(), vector.offset() + vectorOffset, numBytes);

                    bytesWritten += numBytes;
                    payloadOffset += numBytes;
                    vectorOffset += numBytes;

                    if (vectorRemaining <= numBytes) {
                        vectorIndex++;
                        vectorOffset = 0;
                    }
                } while (bytesWritten < bytesToWrite);

                if (remaining <= maxPayloadLength) {
                    flags |= END_FRAG_FLAG;
                }

                frameFlags(termBuffer, frameOffset, flags);

                if (null !== reservedValueSupplier) {
                    const reservedValue = reservedValueSupplier.get(termBuffer, frameOffset, frameLength);
                    Publication.putReservedValue(termBuffer, frameOffset, reservedValue);
                }

                frameLengthOrdered(termBuffer, frameOffset, frameLength);

                flags = 0;
                frameOffset += alignedLength;
                remaining -= bytesToWrite;
            } while (remaining > 0);
        }

        return resultingOffset;
    }

    /**
     * @internal package-private in Java
     */
    public claim(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        length: number,
        bufferClaim: BufferClaim,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + alignedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            this.headerWriter.write(termBuffer, this._termOffset, frameLength, this._termId);
            bufferClaim.wrap(termBuffer, this._termOffset, frameLength);
        }

        return resultingOffset;
    }

    /** Java's private `appendPadding(UnsafeBuffer, int, int)`; the public `appendPadding(int)` has the same name. */
    private appendPaddingFrame(termBuffer: UnsafeBuffer, tailCounterOffset: number, length: number): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        let resultingOffset = this._termOffset + alignedLength;
        this.storeTail(tailCounterOffset, resultingOffset);

        if (resultingOffset > termLength) {
            resultingOffset = this.handleEndOfLog(termBuffer, termLength);
        } else {
            this.headerWriter.write(termBuffer, this._termOffset, frameLength, this._termId);
            frameType(termBuffer, this._termOffset, PADDING_FRAME_TYPE);
            frameLengthOrdered(termBuffer, this._termOffset, frameLength);
        }

        return resultingOffset;
    }

    private appendBlock(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        buffer: MutableDirectBuffer,
        offset: number,
        length: number,
    ): number {
        const termOffset = this._termOffset;
        const resultingOffset = termOffset + length;

        this.storeTail(tailCounterOffset, resultingOffset);

        // Java copies the block's first 32 bytes as four `long`s, the first one with a release store, and the rest
        // of the block with `putBytes` before them. The same bytes are copied here without a `long` (D5 cannot hold
        // all 64 bits): the body, then words 1 to 3, then the version, flags and type, and last the frame length with
        // the release store that publishes the block (spec D82).
        termBuffer.putBytes(termOffset + HEADER_LENGTH, buffer, offset + HEADER_LENGTH, length - HEADER_LENGTH);
        termBuffer.putBytes(termOffset + 8, buffer, offset + 8, HEADER_LENGTH - 8);
        termBuffer.putInt(termOffset + 4, buffer.getInt(offset + 4, LITTLE_ENDIAN), LITTLE_ENDIAN);
        termBuffer.putIntRelease(termOffset, buffer.getInt(offset, LITTLE_ENDIAN));

        return resultingOffset;
    }
}
