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
// Port of io/aeron/Publication.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import type { ReadablePosition } from '../agrona/concurrent/status/ReadablePosition.js';
import type { DirectBuffer } from '../agrona/DirectBuffer.js';
import { ByteOrder, IllegalArgumentException, Long } from '../agrona/jdk.js';
import type { DirectBufferVector } from './DirectBufferVector.js';
import { AeronException } from './exceptions/AeronException.js';
import type { BufferClaim } from './logbuffer/BufferClaim.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { HeaderWriter } from './logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from './protocol/DataHeaderFlyweight.js';
import type { ReservedValueSupplier } from './ReservedValueSupplier.js';
import { ChannelEndpointStatus } from './status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from './status/LocalSocketAddressStatus.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const { HEADER_LENGTH, RESERVED_VALUE_OFFSET } = DataHeaderFlyweight;
const { PARTITION_COUNT, TERM_TAIL_COUNTERS_OFFSET } = LogBufferDescriptor;
const { align, SIZE_OF_LONG } = BitUtil;

/**
 * The log buffers that a publication uses: the part of T19's `LogBuffers` that `Publication` calls (a forward
 * reference, spec D80). T19 makes `LogBuffers` satisfy it and replaces it with `import type { LogBuffers }`.
 */
export interface PublicationLogBuffers {
    metaDataBuffer(): UnsafeBuffer;
    termLength(): number;
    duplicateTermBuffers(): UnsafeBuffer[];
}

/**
 * The client conductor that a publication calls: the part of T19's `ClientConductor` that `Publication` and its
 * subclasses use (a forward reference, spec D80). T19 makes `ClientConductor` satisfy it and replaces it with
 * `import type { ClientConductor }`. Java's two overloads of `removeDestination` and of `asyncRemoveDestination`,
 * by the endpoint channel or by the registration id of the destination, are one method with a union parameter.
 */
export interface PublicationClientConductor {
    removePublication(publication: Publication): void;
    channelStatus(channelStatusId: number): number;
    countersReader(): CountersReader;
    addDestination(registrationId: number, endpointChannel: string): void;
    removeDestination(registrationId: number, destination: string | number): void;
    asyncAddDestination(registrationId: number, endpointChannel: string): number;
    asyncRemoveDestination(registrationId: number, destination: string | number): number;
}

/**
 * Aeron publisher API for sending messages to subscribers of a given channel and streamId pair. {@link Publication}s
 * are created via the {@link Aeron.addPublication} {@link Aeron.addExclusivePublication}
 * methods, and messages are sent via one of the {@link offer} methods.
 * <p>
 * The APIs used for tryClaim and offer are non-blocking.
 * <p>
 * <b>Note:</b> All methods are threadsafe except offer and tryClaim for the subclass
 * {@link ExclusivePublication}. In the case of {@link ConcurrentPublication} all methods are threadsafe.
 *
 * @see ConcurrentPublication
 * @see ExclusivePublication
 */
export abstract class Publication {
    /**
     * The publication is not connected to a subscriber, this can be an intermittent state as subscribers come and go.
     */
    public static readonly NOT_CONNECTED = -1;

    /**
     * The offer failed due to back pressure from the subscribers preventing further transmission.
     */
    public static readonly BACK_PRESSURED = -2;

    /**
     * The offer failed due to an administration action and should be retried.
     * The action is an operation such as log rotation which is likely to have succeeded by the next retry attempt.
     */
    public static readonly ADMIN_ACTION = -3;

    /**
     * The {@link Publication} has been closed and should no longer be used.
     */
    public static readonly CLOSED = -4;

    /**
     * The offer failed due to reaching the maximum position of the stream given term buffer length times the total
     * possible number of terms.
     * <p>
     * If this happens then the publication should be closed and a new one added. To make it less likely to happen then
     * increase the term buffer length.
     */
    public static readonly MAX_POSITION_EXCEEDED = -5;

    // The fields of Java that are package-private and that share a name with a method have a leading underscore
    // (spec D80). They are public here, `@internal`, for the conductor and the tests.
    /** @internal package-private in Java */
    public readonly _originalRegistrationId: number;
    /** @internal package-private in Java */
    public readonly _registrationId: number;
    /** @internal package-private in Java */
    public readonly _maxPossiblePosition: number;
    /** @internal package-private in Java */
    public readonly _channelStatusId: number;
    /** @internal package-private in Java */
    public readonly _streamId: number;
    /** @internal package-private in Java */
    public readonly _sessionId: number;
    /** @internal package-private in Java */
    public readonly _maxMessageLength: number;
    /** @internal package-private in Java */
    public readonly maxFramedLength: number;
    /** @internal package-private in Java */
    public readonly _initialTermId: number;
    /** @internal package-private in Java */
    public readonly _maxPayloadLength: number;
    /** @internal package-private in Java */
    public readonly _positionBitsToShift: number;
    /** @internal package-private in Java */
    public readonly _termBufferLength: number;
    /** @internal package-private in Java: `volatile boolean isClosed`, read by {@link isClosed} */
    public _isClosed: boolean = false;
    /** @internal package-private in Java: `revokeOnClose`, read by the conductor */
    public _revokeOnClose: boolean = false;

    /** @internal package-private in Java */
    public readonly _positionLimit: ReadablePosition;
    /** @internal package-private in Java */
    public readonly termBuffers: UnsafeBuffer[];
    /** @internal package-private in Java */
    public readonly logMetaDataBuffer: UnsafeBuffer;
    /** @internal package-private in Java */
    public readonly headerWriter: HeaderWriter;
    /** @internal package-private in Java */
    public readonly _logBuffers: PublicationLogBuffers;
    /** @internal package-private in Java */
    public readonly conductor: PublicationClientConductor;
    /** @internal package-private in Java */
    public readonly _channel: string;

    /**
     * Scratch of the readers of a raw tail: its two halves, the term offset in `[0]` and the term id in `[1]`
     * (spec D12), so that the position of a publication is read atomically without a `bigint`. The publication is
     * used by one thread at a time per call, as the scratch of `NetworkPublication.producerPosition` is.
     *
     * @internal port only
     */
    protected readonly rawTailHalves = new Int32Array(2);

    /**
     * Receives the term id of the old raw tail from `getAndAddRawTailOffset` (spec D12).
     *
     * @internal port only
     */
    protected readonly termIdHolder = new Int32Array(1);

    /** @internal package-private in Java */
    protected constructor(
        clientConductor: PublicationClientConductor,
        channel: string,
        streamId: number,
        sessionId: number,
        positionLimit: ReadablePosition,
        channelStatusId: number,
        logBuffers: PublicationLogBuffers,
        originalRegistrationId: number,
        registrationId: number,
    ) {
        const logMetaDataBuffer = logBuffers.metaDataBuffer();
        this._termBufferLength = logBuffers.termLength();
        this._maxMessageLength = FrameDescriptor.computeMaxMessageLength(this._termBufferLength);
        this._maxPayloadLength = LogBufferDescriptor.mtuLength(logMetaDataBuffer) - HEADER_LENGTH;
        this.maxFramedLength = LogBufferDescriptor.computeFragmentedFrameLength(
            this._maxMessageLength,
            this._maxPayloadLength,
        );
        // Java: termBufferLength * (1L << 31); the cap below 2^53 is spec D13
        this._maxPossiblePosition = LogBufferDescriptor.maxPossiblePosition(this._termBufferLength);
        this.conductor = clientConductor;
        this._channel = channel;
        this._streamId = streamId;
        this._sessionId = sessionId;
        this._initialTermId = LogBufferDescriptor.initialTermId(logMetaDataBuffer);
        this.termBuffers = logBuffers.duplicateTermBuffers();
        this.logMetaDataBuffer = logMetaDataBuffer;
        this._logBuffers = logBuffers;
        this._originalRegistrationId = originalRegistrationId;
        this._registrationId = registrationId;
        this._positionLimit = positionLimit;
        this._channelStatusId = channelStatusId;
        this._positionBitsToShift = LogBufferDescriptor.positionBitsToShift(this._termBufferLength);
        this.headerWriter = HeaderWriter.newInstance(LogBufferDescriptor.defaultFrameHeader(logMetaDataBuffer));

        for (let i = 0; i < PARTITION_COUNT; i++) {
            const tailCounterOffset = TERM_TAIL_COUNTERS_OFFSET + i * SIZE_OF_LONG;
            logMetaDataBuffer.boundsCheck(tailCounterOffset, SIZE_OF_LONG);
        }
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
     * Get the length in bytes for each term partition in the log buffer.
     *
     * @return the length in bytes for each term partition in the log buffer.
     */
    public termBufferLength(): number {
        return this._termBufferLength;
    }

    /**
     * The maximum possible position this stream can reach due to its term buffer length.
     * <p>
     * Maximum possible position is term-length times 2^31 in bytes, and below 2^53 (spec D13).
     *
     * @return the maximum possible position this stream can reach due to it term buffer length.
     */
    public maxPossiblePosition(): number {
        return this._maxPossiblePosition;
    }

    /**
     * Media address for delivery to the channel.
     *
     * @return Media address for delivery to the channel.
     */
    public channel(): string {
        return this._channel;
    }

    /**
     * Stream identity for scoping within the channel media address.
     *
     * @return Stream identity for scoping within the channel media address.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Session under which messages are published. Identifies this Publication instance. Sessions are unique across
     * all active publications on a driver instance.
     *
     * @return the session id for this publication.
     */
    public sessionId(): number {
        return this._sessionId;
    }

    /**
     * The initial term id assigned when this {@link Publication} was created. This can be used to determine how many
     * terms have passed since creation.
     *
     * @return the initial term id.
     */
    public initialTermId(): number {
        return this._initialTermId;
    }

    /**
     * Maximum message length supported in bytes. Messages may be made of multiple fragments if greater than
     * MTU length.
     *
     * @return maximum message length supported in bytes.
     */
    public maxMessageLength(): number {
        return this._maxMessageLength;
    }

    /**
     * Maximum length of a message payload that fits within a message fragment.
     * <p>
     * This is the MTU length minus the message fragment header length.
     *
     * @return maximum message fragment payload length.
     */
    public maxPayloadLength(): number {
        return this._maxPayloadLength;
    }

    /**
     * Get the registration used to register this Publication with the media driver by the first publisher.
     *
     * @return original registration id
     */
    public originalRegistrationId(): number {
        return this._originalRegistrationId;
    }

    /**
     * Is this Publication the original instance added to the driver? If not then it was added after another client
     * has already added the publication.
     *
     * @return true if this instance is the first added otherwise false.
     */
    public isOriginal(): boolean {
        return this._originalRegistrationId === this._registrationId;
    }

    /**
     * Get the registration id used to register this Publication with the media driver.
     * <p>
     * If this value is different from the {@link originalRegistrationId} then a previous active registration exists.
     *
     * @return registration id
     */
    public registrationId(): number {
        return this._registrationId;
    }

    /**
     * Has the {@link Publication} seen an active Subscriber recently?
     *
     * @return true if this {@link Publication} has recently seen an active subscriber otherwise false.
     */
    public isConnected(): boolean {
        return !this._isClosed && LogBufferDescriptor.isConnected(this.logMetaDataBuffer);
    }

    /**
     * Remove resources used by this Publication when there are no more references.
     * <p>
     * Publications are reference counted and are only truly closed when the ref count reaches zero.
     */
    public close(): void {
        if (!this._isClosed) {
            this.conductor.removePublication(this);
        }
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
     * Get the status of the media channel for this Publication.
     * <p>
     * The status will be {@link ChannelEndpointStatus.ERRORED} if a socket exception occurs on setup
     * and {@link ChannelEndpointStatus.ACTIVE} if all is well.
     *
     * @return status for the channel as one of the constants from {@link ChannelEndpointStatus} with it being
     * {@link ChannelEndpointStatus.NO_ID_ALLOCATED} if the publication is closed.
     * @see ChannelEndpointStatus
     */
    public channelStatus(): number {
        if (this._isClosed) {
            return ChannelEndpointStatus.NO_ID_ALLOCATED;
        }

        return this.conductor.channelStatus(this._channelStatusId);
    }

    /**
     * Get the counter used to represent the channel status for this publication.
     *
     * @return the counter used to represent the channel status for this publication.
     */
    public channelStatusId(): number {
        return this._channelStatusId;
    }

    /**
     * Fetches the local socket address for this publication. If the channel is not
     * {@link ChannelEndpointStatus.ACTIVE}, then this will return an empty list.
     * <p>
     * The format is as follows:
     * <br>
     * <br>
     * IPv4: <code>ip address:port</code>
     * <br>
     * IPv6: <code>[ip6 address]:port</code>
     * <br>
     * <br>
     * This is to match the formatting used in the Aeron URI. For publications this will be the control address and
     * is likely to only contain a single entry.
     *
     * @return local socket addresses for this publication.
     * @see channelStatus
     */
    public localSocketAddresses(): string[] {
        return LocalSocketAddressStatus.findAddresses(
            this.conductor.countersReader(),
            this.channelStatus(),
            this._channelStatusId,
        );
    }

    /**
     * Get the current position to which the publication has advanced for this stream.
     * <p>
     * The raw tail is read as one atomic snapshot of its two halves, without a `bigint` (spec D12, as
     * `NetworkPublication.producerPosition`).
     *
     * @return the current position to which the publication has advanced for this stream or {@link CLOSED}.
     */
    public position(): number {
        if (this._isClosed) {
            return Publication.CLOSED;
        }

        const logMetaDataBuffer = this.logMetaDataBuffer;
        const rawTailHalves = this.rawTailHalves;
        logMetaDataBuffer.getLongVolatileHalves(
            TERM_TAIL_COUNTERS_OFFSET +
                SIZE_OF_LONG *
                    LogBufferDescriptor.indexByTermCount(LogBufferDescriptor.activeTermCount(logMetaDataBuffer)),
            rawTailHalves,
        );
        const termOffset = Math.min(rawTailHalves[0]! >>> 0, this._termBufferLength) | 0;

        return LogBufferDescriptor.computePosition(
            rawTailHalves[1]!,
            termOffset,
            this._positionBitsToShift,
            this._initialTermId,
        );
    }

    /**
     * Get the position limit beyond which this {@link Publication} will be back pressured.
     * <p>
     * This should only be used as a guide to determine when back pressure is likely to be applied.
     *
     * @return the position limit beyond which this {@link Publication} will be back pressured.
     */
    public positionLimit(): number {
        if (this._isClosed) {
            return Publication.CLOSED;
        }

        return this._positionLimit.getVolatile();
    }

    /**
     * Get the counter id for the position limit after which the publication will be back pressured.
     *
     * @return the counter id for the position limit after which the publication will be back pressured.
     */
    public positionLimitId(): number {
        return this._positionLimit.id();
    }

    /**
     * Available window for offering into a publication before the {@link positionLimit} is reached.
     *
     * @return window for offering into a publication before the {@link positionLimit} is reached. If
     * the publication is closed then {@link CLOSED} will be returned.
     */
    public abstract availableWindow(): number;

    /**
     * Non-blocking publish of a buffer containing a message, or of a partial buffer: the offsets and the supplier of
     * the four overloads of Java (`offer(buffer)`, `offer(buffer, offset, length)` and
     * `offer(buffer, offset, length, reservedValueSupplier)`) are optional parameters (spec D80).
     *
     * @param buffer                containing message.
     * @param offset                offset in the buffer at which the encoded message begins, 0 by default.
     * @param length                in bytes of the encoded message, the capacity of the buffer by default.
     * @param reservedValueSupplier {@link ReservedValueSupplier} for the frame, none by default.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     */
    public abstract offer(
        buffer: DirectBuffer,
        offset?: number,
        length?: number,
        reservedValueSupplier?: ReservedValueSupplier | null,
    ): number;

    /**
     * Non-blocking publish of a message composed of two parts, e.g. a header and encapsulated payload. Java's
     * `offer` of six and of seven arguments (spec D80).
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
    public abstract offerTwoBuffers(
        bufferOne: DirectBuffer,
        offsetOne: number,
        lengthOne: number,
        bufferTwo: DirectBuffer,
        offsetTwo: number,
        lengthTwo: number,
        reservedValueSupplier?: ReservedValueSupplier | null,
    ): number;

    /**
     * Non-blocking publish by gathering buffer vectors into a message. Java's `offer` of the vectors (spec D80).
     *
     * @param vectors               which make up the message.
     * @param reservedValueSupplier {@link ReservedValueSupplier} for the frame, none by default.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     */
    public abstract offerVectored(
        vectors: readonly DirectBufferVector[],
        reservedValueSupplier?: ReservedValueSupplier | null,
    ): number;

    /**
     * Try to claim a range in the publication log into which a message can be written with zero copy semantics.
     * Once the message has been written then {@link BufferClaim.commit} should be called thus making it available.
     * A claim length cannot be greater than {@link maxPayloadLength}.
     * <p>
     * <b>Note:</b> This method can only be used for message lengths less than MTU length minus header.
     * If the claim is held for more than the aeron.publication.unblock.timeout system property then the driver will
     * assume the publication thread is dead and will unblock the claim thus allowing other threads to make progress
     * for {@link ConcurrentPublication} and other claims to be sent to reach end-of-stream (EOS).
     *
     * @param length      of the range to claim, in bytes.
     * @param bufferClaim to be populated if the claim succeeds.
     * @return The new stream position, otherwise a negative error value of {@link NOT_CONNECTED},
     * {@link BACK_PRESSURED}, {@link ADMIN_ACTION}, {@link CLOSED}, or {@link MAX_POSITION_EXCEEDED}.
     * @throws IllegalArgumentException if the length is greater than {@link maxPayloadLength} within an MTU.
     * @see BufferClaim.commit
     * @see BufferClaim.abort
     */
    public abstract tryClaim(length: number, bufferClaim: BufferClaim): number;

    /**
     * Add a destination manually to a multi-destination-cast Publication.
     *
     * @param endpointChannel for the destination to add.
     */
    public addDestination(endpointChannel: string): void {
        if (this._isClosed) {
            throw new AeronException('Publication is closed');
        }

        this.conductor.addDestination(this._originalRegistrationId, endpointChannel);
    }

    /**
     * Remove a previously added destination manually from a multi-destination-cast Publication. The two overloads of
     * Java (by the endpoint channel, or by the registration id of the destination) are one method.
     *
     * @param destination the endpoint channel, or the registration id, of the destination to remove.
     */
    public removeDestination(destination: string | number): void {
        if (this._isClosed) {
            throw new AeronException('Publication is closed');
        }

        this.conductor.removeDestination(this._originalRegistrationId, destination);
    }

    /**
     * Asynchronously add a destination manually to a multi-destination-cast Publication.
     * <p>
     * Errors will be delivered asynchronously to the {@link Aeron.Context.errorHandler}. Completion can be
     * tracked by passing the returned correlation id to {@link Aeron.isCommandActive}.
     *
     * @param endpointChannel for the destination to add.
     * @return the correlationId for the command.
     */
    public asyncAddDestination(endpointChannel: string): number {
        if (this._isClosed) {
            throw new AeronException('Publication is closed');
        }

        return this.conductor.asyncAddDestination(this._registrationId, endpointChannel);
    }

    /**
     * Asynchronously remove a previously added destination from a multi-destination-cast Publication. The two
     * overloads of Java (by the endpoint channel, or by the registration id of the destination) are one method.
     * <p>
     * Errors will be delivered asynchronously to the {@link Aeron.Context.errorHandler}. Completion can be
     * tracked by passing the returned correlation id to {@link Aeron.isCommandActive}.
     *
     * @param destination the endpoint channel, or the registration id, of the destination to remove.
     * @return the correlationId for the command.
     */
    public asyncRemoveDestination(destination: string | number): number {
        if (this._isClosed) {
            throw new AeronException('Publication is closed');
        }

        return this.conductor.asyncRemoveDestination(this._registrationId, destination);
    }

    /** @internal package-private in Java */
    public internalClose(): void {
        this._isClosed = true;
    }

    /** @internal package-private in Java */
    public logBuffers(): PublicationLogBuffers {
        return this._logBuffers;
    }

    /** @internal package-private in Java */
    protected backPressureStatus(currentPosition: number, messageLength: number): number {
        if (
            currentPosition + align((messageLength + HEADER_LENGTH) | 0, FRAME_ALIGNMENT) >=
            this._maxPossiblePosition
        ) {
            return Publication.MAX_POSITION_EXCEEDED;
        }

        if (LogBufferDescriptor.isConnected(this.logMetaDataBuffer)) {
            return Publication.BACK_PRESSURED;
        }

        return Publication.NOT_CONNECTED;
    }

    /** @internal package-private in Java */
    protected checkPositiveLength(length: number): void {
        if (length < 0) {
            throw new IllegalArgumentException('invalid length: ' + length);
        }
    }

    /** @internal package-private in Java */
    protected checkPayloadLength(length: number): void {
        if (length < 0) {
            throw new IllegalArgumentException('invalid length: ' + length);
        }

        if (length > this._maxPayloadLength) {
            throw new IllegalArgumentException(
                'claim exceeds maxPayloadLength of ' + this._maxPayloadLength + ', length=' + length,
            );
        }
    }

    /** @internal package-private in Java */
    protected checkMaxMessageLength(length: number): void {
        if (length > this._maxMessageLength) {
            throw new IllegalArgumentException(
                'message exceeds maxMessageLength of ' + this._maxMessageLength + ', length=' + length,
            );
        }
    }

    /** @internal package-private in Java */
    protected static validateAndComputeLength(lengthOne: number, lengthTwo: number): number {
        if (lengthOne < 0) {
            throw new IllegalArgumentException('lengthOne < 0: ' + lengthOne);
        }

        if (lengthTwo < 0) {
            throw new IllegalArgumentException('lengthTwo < 0: ' + lengthTwo);
        }

        const totalLength = (lengthOne + lengthTwo) | 0;
        if (totalLength < 0) {
            throw new IllegalArgumentException('overflow totalLength=' + totalLength);
        }

        return totalLength;
    }

    /**
     * Write the reserved value that a supplier returned into the header of a frame, as Java's
     * `termBuffer.putLong(termOffset + RESERVED_VALUE_OFFSET, reservedValue, LITTLE_ENDIAN)`: a `number` goes in
     * without a `bigint` (spec D81). A value outside the range of a `long` throws `RangeError` and writes nothing.
     *
     * @internal port only
     */
    protected static putReservedValue(termBuffer: UnsafeBuffer, frameOffset: number, value: bigint | number): void {
        if ('number' === typeof value) {
            termBuffer.putLong(frameOffset + RESERVED_VALUE_OFFSET, value, LITTLE_ENDIAN);
        } else {
            termBuffer.putLongBigInt(frameOffset + RESERVED_VALUE_OFFSET, Long.checkInt64(value), LITTLE_ENDIAN);
        }
    }

    /**
     * Returns a string representation of a position. Generally used for errors. If the position is a valid error then
     * String name of the error will be returned. If the value is 0 or greater the text will be "NONE". If the position
     * is negative, but not a known error code then "UNKNOWN" will be returned.
     *
     * @param position position value returned from a call to offer.
     * @return String representation of the error.
     */
    public static errorString(position: number): string {
        if (Publication.MAX_POSITION_EXCEEDED <= position && position < 0) {
            const errorCode = position | 0;
            switch (errorCode) {
                case Publication.NOT_CONNECTED:
                    return 'NOT_CONNECTED';
                case Publication.BACK_PRESSURED:
                    return 'BACK_PRESSURED';
                case Publication.ADMIN_ACTION:
                    return 'ADMIN_ACTION';
                case Publication.CLOSED:
                    return 'CLOSED';
                case Publication.MAX_POSITION_EXCEEDED:
                    return 'MAX_POSITION_EXCEEDED';
                default:
                    return 'UNKNOWN';
            }
        } else if (0 <= position) {
            return 'NONE';
        }

        return 'UNKNOWN';
    }

    public toString(): string {
        return (
            'Publication{' +
            'originalRegistrationId=' +
            this._originalRegistrationId +
            ', registrationId=' +
            this._registrationId +
            ', isClosed=' +
            this._isClosed +
            ', isConnected=' +
            this.isConnected() +
            ', initialTermId=' +
            this._initialTermId +
            ', termBufferLength=' +
            this._termBufferLength +
            ', sessionId=' +
            this._sessionId +
            ', streamId=' +
            this._streamId +
            ", channel='" +
            this._channel +
            "'" +
            ', position=' +
            this.position() +
            '}'
        );
    }
}
