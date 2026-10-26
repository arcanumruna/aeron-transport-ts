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
// Port of io/aeron/driver/media/ReceiveChannelEndpointThreadLocals.java @ 1.53.3
import { randomBytes } from 'node:crypto';
import { BitUtil } from '../../agrona/BitUtil.js';
import { BufferUtil } from '../../agrona/BufferUtil.js';
import { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../client/logbuffer/FrameDescriptor.js';
import { ErrorFlyweight } from '../../client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import { ResponseSetupFlyweight } from '../../client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';

const { CACHE_LINE_LENGTH, SIZE_OF_LONG } = BitUtil;
const { FRAME_ALIGNMENT } = FrameDescriptor;

/**
 * Thread local variables that will only be accessed in the context of the Receiver agent thread from within a
 * {@link ReceiveChannelEndpoint} subclass.
 * <p>
 * Java's `ByteBuffer` slices are `UnsafeBuffer` windows over one aligned `ArrayBuffer` (spec D9): a frame is sent as
 * `(buffer, 0, length)`.
 */
export class ReceiveChannelEndpointThreadLocals {
    private readonly smBuffer: UnsafeBuffer;
    private readonly _statusMessageFlyweight: StatusMessageFlyweight;
    private readonly _nakBuffer: UnsafeBuffer;
    private readonly _nakFlyweight: NakFlyweight;
    private readonly _rttMeasurementBuffer: UnsafeBuffer;
    private readonly _rttMeasurementFlyweight: RttMeasurementFlyweight;
    private readonly _responseSetupBuffer: UnsafeBuffer;
    private readonly _responseSetupHeader: ResponseSetupFlyweight;
    private readonly _errorBuffer: UnsafeBuffer;
    private readonly _errorFlyweight: ErrorFlyweight;
    private _nextReceiverId: bigint;

    /**
     * Construct a set of local state to be used by the receiver thread.
     */
    public constructor() {
        const smLength = StatusMessageFlyweight.HEADER_LENGTH + SIZE_OF_LONG;
        const bufferLength =
            BitUtil.align(smLength, CACHE_LINE_LENGTH) +
            BitUtil.align(NakFlyweight.HEADER_LENGTH, CACHE_LINE_LENGTH) +
            BitUtil.align(RttMeasurementFlyweight.HEADER_LENGTH, CACHE_LINE_LENGTH) +
            BitUtil.align(ResponseSetupFlyweight.HEADER_LENGTH, CACHE_LINE_LENGTH) +
            BitUtil.align(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH, CACHE_LINE_LENGTH);

        // UUID.randomUUID() most significant bits ^ least significant bits: 64 random bits as a signed long
        this._nextReceiverId = randomBytes(8).readBigInt64LE(0);

        const byteBuffer = BufferUtil.allocateDirectAligned(bufferLength, CACHE_LINE_LENGTH);

        this.smBuffer = new UnsafeBuffer(byteBuffer, 0, smLength);
        this._statusMessageFlyweight = new StatusMessageFlyweight(this.smBuffer);

        const nakMessageOffset = BitUtil.align(smLength, FRAME_ALIGNMENT);
        this._nakBuffer = new UnsafeBuffer(byteBuffer, nakMessageOffset, NakFlyweight.HEADER_LENGTH);
        this._nakFlyweight = new NakFlyweight(this._nakBuffer);

        const rttMeasurementOffset = nakMessageOffset + BitUtil.align(NakFlyweight.HEADER_LENGTH, FRAME_ALIGNMENT);
        this._rttMeasurementBuffer = new UnsafeBuffer(
            byteBuffer,
            rttMeasurementOffset,
            RttMeasurementFlyweight.HEADER_LENGTH,
        );
        this._rttMeasurementFlyweight = new RttMeasurementFlyweight(this._rttMeasurementBuffer);

        const responseSetupOffset =
            rttMeasurementOffset + BitUtil.align(RttMeasurementFlyweight.HEADER_LENGTH, CACHE_LINE_LENGTH);
        this._responseSetupBuffer = new UnsafeBuffer(
            byteBuffer,
            responseSetupOffset,
            ResponseSetupFlyweight.HEADER_LENGTH,
        );
        this._responseSetupHeader = new ResponseSetupFlyweight(this._responseSetupBuffer);

        const errorOffset = responseSetupOffset + BitUtil.align(ResponseSetupFlyweight.HEADER_LENGTH, FRAME_ALIGNMENT);
        this._errorBuffer = new UnsafeBuffer(byteBuffer, errorOffset, ErrorFlyweight.MAX_ERROR_FRAME_LENGTH);
        this._errorFlyweight = new ErrorFlyweight(this._errorBuffer);

        this._statusMessageFlyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SM)
            .frameLength(StatusMessageFlyweight.HEADER_LENGTH);

        this._nakFlyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_NAK)
            .frameLength(NakFlyweight.HEADER_LENGTH);

        this._rttMeasurementFlyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
            .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);

        this._responseSetupHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RSP_SETUP)
            .frameLength(ResponseSetupFlyweight.HEADER_LENGTH);

        this._errorFlyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_ERR)
            .frameLength(ErrorFlyweight.HEADER_LENGTH);
    }

    /**
     * Buffer for writing status messages to send.
     *
     * @return buffer for writing status messages to send.
     */
    public statusMessageBuffer(): UnsafeBuffer {
        return this.smBuffer;
    }

    /**
     * Flyweight over the {@link statusMessageBuffer}.
     *
     * @return flyweight over the {@link statusMessageBuffer}.
     */
    public statusMessageFlyweight(): StatusMessageFlyweight {
        return this._statusMessageFlyweight;
    }

    /**
     * Buffer for writing NAK messages to send.
     *
     * @return buffer for writing NAK messages to send.
     */
    public nakBuffer(): UnsafeBuffer {
        return this._nakBuffer;
    }

    /**
     * Flyweight over the {@link nakBuffer}.
     *
     * @return flyweight over the {@link nakBuffer}.
     */
    public nakFlyweight(): NakFlyweight {
        return this._nakFlyweight;
    }

    /**
     * Buffer for writing RTT measurement messages to send.
     *
     * @return buffer for writing RTT measurement messages to send.
     */
    public rttMeasurementBuffer(): UnsafeBuffer {
        return this._rttMeasurementBuffer;
    }

    /**
     * Flyweight over the {@link rttMeasurementBuffer}.
     *
     * @return flyweight over the {@link rttMeasurementBuffer}.
     */
    public rttMeasurementFlyweight(): RttMeasurementFlyweight {
        return this._rttMeasurementFlyweight;
    }

    /**
     * Buffer for writing Response Setup messages to send.
     *
     * @return buffer for writing Response Setup messages to send.
     */
    public responseSetupBuffer(): UnsafeBuffer {
        return this._responseSetupBuffer;
    }

    /**
     * Flyweight over the {@link responseSetupBuffer}.
     *
     * @return flyweight over the {@link responseSetupBuffer}.
     */
    public responseSetupHeader(): ResponseSetupFlyweight {
        return this._responseSetupHeader;
    }

    /**
     * Buffer for writing the Error messages to send.
     *
     * @return buffer for writing the error messages to send.
     */
    public errorBuffer(): UnsafeBuffer {
        return this._errorBuffer;
    }

    /**
     * Flyweight over the {@link errorBuffer}.
     *
     * @return flyweight over the {@link errorBuffer}.
     */
    public errorFlyweight(): ErrorFlyweight {
        return this._errorFlyweight;
    }

    /**
     * Get the next receiver id to be used for a receiver channel identity. A `bigint`, since a receiver id is an opaque
     * 64-bit value (spec 5.2); it is read once per endpoint, when the endpoint is created.
     *
     * @return the next receiver id to be used for a receiver channel identity.
     */
    public nextReceiverId(): bigint {
        const id = this._nextReceiverId;
        this._nextReceiverId = BigInt.asIntN(64, id + 1n);

        return id;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return 'ReceiveChannelEndpointThreadLocals{' + 'nextReceiverId=' + this._nextReceiverId + '}';
    }
}
