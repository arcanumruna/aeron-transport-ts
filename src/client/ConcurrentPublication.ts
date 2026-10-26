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
// Port of io/aeron/ConcurrentPublication.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { DirectBufferVector } from './DirectBufferVector.js';
import type { BufferClaim } from './logbuffer/BufferClaim.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from './protocol/DataHeaderFlyweight.js';
import { Publication } from './Publication.js';
import type { ClientConductor } from './ClientConductor.js';
import type { LogBuffers } from './LogBuffers.js';
import type { ReservedValueSupplier } from './ReservedValueSupplier.js';

const { align, SIZE_OF_LONG } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
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
    computeFragmentedFrameLength,
    computePosition,
    getAndAddRawTailOffset,
    indexByTermCount,
    rotateLog,
} = LogBufferDescriptor;
const { ADMIN_ACTION, CLOSED, MAX_POSITION_EXCEEDED } = Publication;

/**
 * Aeron publisher API for sending messages to subscribers of a given channel and streamId pair. Publishers
 * are created via the {@link Aeron.addPublication} method, and messages are sent via one of the {@link offer}
 * methods, or a {@link tryClaim} and {@link BufferClaim.commit} pair of methods.
 * <p>
 * The APIs used for try claim and offer are non-blocking and thread safe.
 * <p>
 * <b>Note:</b> ConcurrentPublication instances are thread safe. Therefore, they can be shared between multiple
 * threads (or, here, any number of callers): the tail of the log is claimed with one atomic add (spec D12).
 *
 * @see Aeron.addPublication
 */
export class ConcurrentPublication extends Publication {
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
    }

    /**
     * {@inheritDoc}
     */
    public availableWindow(): number {
        if (this._isClosed) {
            return CLOSED;
        }

        return this._positionLimit.getVolatile() - this.position();
    }

    /**
     * {@inheritDoc}
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
            const logMetaDataBuffer = this.logMetaDataBuffer;
            const termCount = activeTermCount(logMetaDataBuffer);
            const index = indexByTermCount(termCount);
            const termBuffer = this.termBuffers[index] as UnsafeBuffer;
            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + index * SIZE_OF_LONG;
            const rawTailHalves = this.rawTailHalves;
            logMetaDataBuffer.getLongVolatileHalves(tailCounterOffset, rawTailHalves);
            const termOffset = Math.min(rawTailHalves[0]! >>> 0, termBuffer.capacity()) | 0;
            const termId = rawTailHalves[1]!;

            if (termCount !== ((termId - this._initialTermId) | 0)) {
                return ADMIN_ACTION;
            }

            const position = computePosition(termId, termOffset, this._positionBitsToShift, this._initialTermId);
            if (position < limit) {
                if (length <= this._maxPayloadLength) {
                    this.checkPositiveLength(length);
                    newPosition = this.appendUnfragmentedMessage(
                        termBuffer,
                        tailCounterOffset,
                        buffer,
                        offset,
                        length,
                        reservedValueSupplier,
                    );
                } else {
                    this.checkMaxMessageLength(length);
                    newPosition = this.appendFragmentedMessage(
                        termBuffer,
                        tailCounterOffset,
                        buffer,
                        offset,
                        length,
                        reservedValueSupplier,
                    );
                }
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * {@inheritDoc}
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
            const logMetaDataBuffer = this.logMetaDataBuffer;
            const termCount = activeTermCount(logMetaDataBuffer);
            const index = indexByTermCount(termCount);
            const termBuffer = this.termBuffers[index] as UnsafeBuffer;
            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + index * SIZE_OF_LONG;
            const rawTailHalves = this.rawTailHalves;
            logMetaDataBuffer.getLongVolatileHalves(tailCounterOffset, rawTailHalves);
            const termOffset = Math.min(rawTailHalves[0]! >>> 0, termBuffer.capacity()) | 0;
            const termId = rawTailHalves[1]!;

            if (termCount !== ((termId - this._initialTermId) | 0)) {
                return ADMIN_ACTION;
            }

            const position = computePosition(termId, termOffset, this._positionBitsToShift, this._initialTermId);

            const length = Publication.validateAndComputeLength(lengthOne, lengthTwo);
            if (position < limit) {
                if (length <= this._maxPayloadLength) {
                    newPosition = this.appendUnfragmentedMessageTwoBuffers(
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
                    newPosition = this.appendFragmentedMessageTwoBuffers(
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
                }
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    /**
     * {@inheritDoc}
     */
    public offerVectored(
        vectors: readonly DirectBufferVector[],
        reservedValueSupplier: ReservedValueSupplier | null = null,
    ): number {
        const length = DirectBufferVector.validateAndComputeLength(vectors);
        let newPosition = CLOSED;

        if (!this._isClosed) {
            const limit = this._positionLimit.getVolatile();
            const logMetaDataBuffer = this.logMetaDataBuffer;
            const termCount = activeTermCount(logMetaDataBuffer);
            const index = indexByTermCount(termCount);
            const termBuffer = this.termBuffers[index] as UnsafeBuffer;
            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + index * SIZE_OF_LONG;
            const rawTailHalves = this.rawTailHalves;
            logMetaDataBuffer.getLongVolatileHalves(tailCounterOffset, rawTailHalves);
            const termOffset = Math.min(rawTailHalves[0]! >>> 0, termBuffer.capacity()) | 0;
            const termId = rawTailHalves[1]!;

            if (termCount !== ((termId - this._initialTermId) | 0)) {
                return ADMIN_ACTION;
            }

            const position = computePosition(termId, termOffset, this._positionBitsToShift, this._initialTermId);

            if (position < limit) {
                if (length <= this._maxPayloadLength) {
                    newPosition = this.appendUnfragmentedMessageVectored(
                        termBuffer,
                        tailCounterOffset,
                        vectors,
                        length,
                        reservedValueSupplier,
                    );
                } else {
                    this.checkMaxMessageLength(length);
                    newPosition = this.appendFragmentedMessageVectored(
                        termBuffer,
                        tailCounterOffset,
                        vectors,
                        length,
                        reservedValueSupplier,
                    );
                }
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
            const logMetaDataBuffer = this.logMetaDataBuffer;
            const termCount = activeTermCount(logMetaDataBuffer);
            const index = indexByTermCount(termCount);
            const termBuffer = this.termBuffers[index] as UnsafeBuffer;
            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + index * SIZE_OF_LONG;
            const rawTailHalves = this.rawTailHalves;
            logMetaDataBuffer.getLongVolatileHalves(tailCounterOffset, rawTailHalves);
            const termOffset = Math.min(rawTailHalves[0]! >>> 0, termBuffer.capacity()) | 0;
            const termId = rawTailHalves[1]!;

            if (termCount !== ((termId - this._initialTermId) | 0)) {
                return ADMIN_ACTION;
            }

            const position = computePosition(termId, termOffset, this._positionBitsToShift, this._initialTermId);

            if (position < limit) {
                newPosition = this.claim(termBuffer, tailCounterOffset, length, bufferClaim);
            } else {
                newPosition = this.backPressureStatus(position, length);
            }
        }

        return newPosition;
    }

    private appendUnfragmentedMessage(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        buffer: DirectBuffer,
        offset: number,
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        // Java: logMetaDataBuffer.getAndAddLong(tailCounterOffset, alignedLength), then termId and termOffset (D12)
        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            alignedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + alignedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        this.headerWriter.write(termBuffer, termOffset, frameLength, termId);
        termBuffer.putBytes(termOffset + HEADER_LENGTH, buffer, offset, length);

        if (null !== reservedValueSupplier) {
            const reservedValue = reservedValueSupplier.get(termBuffer, termOffset, frameLength);
            Publication.putReservedValue(termBuffer, termOffset, reservedValue);
        }

        frameLengthOrdered(termBuffer, termOffset, frameLength);

        return position;
    }

    private appendFragmentedMessage(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        buffer: DirectBuffer,
        offset: number,
        length: number,
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const maxPayloadLength = this._maxPayloadLength;
        const framedLength = computeFragmentedFrameLength(length, maxPayloadLength);
        const termLength = termBuffer.capacity();

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            framedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + framedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        let frameOffset = termOffset;
        let flags = BEGIN_FRAG_FLAG;
        let remaining = length;

        do {
            const bytesToWrite = Math.min(remaining, maxPayloadLength);
            const frameLength = bytesToWrite + HEADER_LENGTH;
            const alignedLength = align(frameLength, FRAME_ALIGNMENT);

            this.headerWriter.write(termBuffer, frameOffset, frameLength, termId);
            termBuffer.putBytes(frameOffset + HEADER_LENGTH, buffer, offset + (length - remaining), bytesToWrite);

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

        return position;
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

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            alignedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + alignedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        this.headerWriter.write(termBuffer, termOffset, frameLength, termId);
        termBuffer.putBytes(termOffset + HEADER_LENGTH, bufferOne, offsetOne, lengthOne);
        termBuffer.putBytes(termOffset + HEADER_LENGTH + lengthOne, bufferTwo, offsetTwo, lengthTwo);

        if (null !== reservedValueSupplier) {
            const reservedValue = reservedValueSupplier.get(termBuffer, termOffset, frameLength);
            Publication.putReservedValue(termBuffer, termOffset, reservedValue);
        }

        frameLengthOrdered(termBuffer, termOffset, frameLength);

        return position;
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
        reservedValueSupplier: ReservedValueSupplier | null,
    ): number {
        const maxPayloadLength = this._maxPayloadLength;
        const length = lengthOne + lengthTwo;
        const framedLength = computeFragmentedFrameLength(length, maxPayloadLength);
        const termLength = termBuffer.capacity();

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            framedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + framedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        let frameOffset = termOffset;
        let flags = BEGIN_FRAG_FLAG;
        let remaining = length;
        let positionOne = 0;
        let positionTwo = 0;

        do {
            const bytesToWrite = Math.min(remaining, maxPayloadLength);
            const frameLength = bytesToWrite + HEADER_LENGTH;
            const alignedLength = align(frameLength, FRAME_ALIGNMENT);

            this.headerWriter.write(termBuffer, frameOffset, frameLength, termId);

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

        return position;
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

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            alignedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + alignedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        this.headerWriter.write(termBuffer, termOffset, frameLength, termId);

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

        return position;
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

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            framedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + framedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        let frameOffset = termOffset;
        let flags = BEGIN_FRAG_FLAG;
        let remaining = length;
        let vectorIndex = 0;
        let vectorOffset = 0;

        do {
            const bytesToWrite = Math.min(remaining, maxPayloadLength);
            const frameLength = bytesToWrite + HEADER_LENGTH;
            const alignedLength = align(frameLength, FRAME_ALIGNMENT);

            this.headerWriter.write(termBuffer, frameOffset, frameLength, termId);

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

        return position;
    }

    private claim(
        termBuffer: UnsafeBuffer,
        tailCounterOffset: number,
        length: number,
        bufferClaim: BufferClaim,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const termLength = termBuffer.capacity();

        const unsignedOffset = getAndAddRawTailOffset(
            this.logMetaDataBuffer,
            tailCounterOffset,
            alignedLength,
            this.termIdHolder,
        );
        const termId = this.termIdHolder[0]!;
        const termOffset = Math.min(unsignedOffset, termLength) | 0;

        const resultingOffset = termOffset + alignedLength;
        const position = computePosition(termId, resultingOffset, this._positionBitsToShift, this._initialTermId);
        if (resultingOffset > termLength) {
            return this.handleEndOfLog(termBuffer, termLength, termId, termOffset, position);
        }

        this.headerWriter.write(termBuffer, termOffset, frameLength, termId);
        bufferClaim.wrap(termBuffer, termOffset, frameLength);

        return position;
    }

    private handleEndOfLog(
        termBuffer: UnsafeBuffer,
        termLength: number,
        termId: number,
        termOffset: number,
        position: number,
    ): number {
        if (termOffset < termLength) {
            const paddingLength = termLength - termOffset;
            this.headerWriter.write(termBuffer, termOffset, paddingLength, termId);
            frameType(termBuffer, termOffset, PADDING_FRAME_TYPE);
            frameLengthOrdered(termBuffer, termOffset, paddingLength);
        }

        if (position >= this._maxPossiblePosition) {
            return MAX_POSITION_EXCEEDED;
        }

        rotateLog(this.logMetaDataBuffer, (termId - this._initialTermId) | 0, termId);

        return ADMIN_ACTION;
    }
}
