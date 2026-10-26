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
// Port of io/aeron/PublicationTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Integer, Long, ThreadLocalRandom } from '../../src/agrona/jdk.js';
import { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { DirectBufferVector } from '../../src/client/DirectBufferVector.js';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { Publication } from '../../src/client/Publication.js';
import type { ReservedValueSupplier } from '../../src/client/ReservedValueSupplier.js';
import { ChannelEndpointStatus } from '../../src/client/status/ChannelEndpointStatus.js';
import { newFakeLogBuffers, newFakePublicationConductor } from '../support/ClientFakes.js';
import type { FakePublicationConductor } from '../support/ClientFakes.js';
import { MockPosition } from '../support/MockPosition.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { align } = BitUtil;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { BACK_PRESSURED, ADMIN_ACTION, CLOSED, MAX_POSITION_EXCEEDED, NOT_CONNECTED, errorString } = Publication;
const {
    LOG_META_DATA_LENGTH,
    PARTITION_COUNT,
    TERM_MIN_LENGTH,
    activeTermCount,
    computePosition,
    indexByTermCount,
    initialTermId,
    initialiseTailWithTermId,
    isConnected,
    mtuLength,
    packTail,
    pageSize,
    rawTail,
    rawTailVolatile,
    storeDefaultFrameHeader,
    termId,
    termLength,
    termOffset,
} = LogBufferDescriptor;

const CHANNEL = 'aeron:udp?endpoint=localhost:40124';
const STREAM_ID_1 = 1002;
const SESSION_ID_1 = 13;
const TERM_ID_1 = 1;
const CORRELATION_ID = 2000;
const SEND_BUFFER_CAPACITY = 1024;
const PARTITION_INDEX = 0;
const MTU_LENGTH = 4096;
const PAGE_SIZE = 4 * 1024;
const TERM_LENGTH = TERM_MIN_LENGTH * 4;
const MAX_PAYLOAD_SIZE = MTU_LENGTH - HEADER_LENGTH;
const MAX_MESSAGE_SIZE = FrameDescriptor.computeMaxMessageLength(TERM_LENGTH);
const TOTAL_ALIGNED_MAX_MESSAGE_SIZE =
    Math.trunc(MAX_MESSAGE_SIZE / MAX_PAYLOAD_SIZE) * MTU_LENGTH +
    align((MAX_MESSAGE_SIZE % MAX_PAYLOAD_SIZE) + HEADER_LENGTH, FRAME_ALIGNMENT);
const POSITION_BITS_TO_SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);
const DEFAULT_FRAME_TYPE = DataHeaderFlyweight.HDR_TYPE_RTTM;
const SESSION_ID = 42;
const STREAM_ID = 111;

type Row = readonly [
    length: number,
    termId: number,
    termCount: number,
    tailAfterUpdate: bigint,
    expectedPosition: number,
];

const TRY_CLAIM_POSITIONS: Row[] = [
    [100, 31, 30, packTail(31, 16 * 1024), computePosition(31, 16 * 1024 + 160, POSITION_BITS_TO_SHIFT, TERM_ID_1)],
    [999, 7, 6, packTail(212, 8192), computePosition(212, 8192 + 1056, POSITION_BITS_TO_SHIFT, TERM_ID_1)],
];

const OFFER_POSITIONS: Row[] = [
    [124, 5, 4, packTail(11, 3072), computePosition(11, 3072 + 160, POSITION_BITS_TO_SHIFT, TERM_ID_1)],
    [
        MAX_MESSAGE_SIZE,
        77,
        76,
        packTail(77, 1024),
        computePosition(77, 1024 + TOTAL_ALIGNED_MAX_MESSAGE_SIZE, POSITION_BITS_TO_SHIFT, TERM_ID_1),
    ],
];

/** `ThreadLocalRandom.current().nextBytes(new byte[length])`. */
function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    ThreadLocalRandom.current().nextBytes(bytes);
    return bytes;
}

describe('PublicationTest', () => {
    let logMetaDataBuffer: UnsafeBuffer;
    let termBuffers: UnsafeBuffer[];
    let conductor: FakePublicationConductor;
    let publicationLimit: MockPosition;
    let publication: ConcurrentPublication;
    // `getAndAddLong` of the raw tail is `getAndAddLongHalves` here (spec D12): `spy(...)` that calls through
    let getAndAddLongHalves: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logMetaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));
        getAndAddLongHalves = vi.spyOn(logMetaDataBuffer, 'getAndAddLongHalves');
        termBuffers = new Array<UnsafeBuffer>(PARTITION_COUNT);
        conductor = newFakePublicationConductor();
        publicationLimit = new MockPosition();

        publicationLimit.value = 2 * SEND_BUFFER_CAPACITY;
        const logBuffers = newFakeLogBuffers(termBuffers, TERM_LENGTH, logMetaDataBuffer);

        const defaultHeader = DataHeaderFlyweight.createDefaultHeader(SESSION_ID, STREAM_ID, TERM_ID_1);
        defaultHeader.putShort(DataHeaderFlyweight.TYPE_FIELD_OFFSET, DEFAULT_FRAME_TYPE, LITTLE_ENDIAN);
        storeDefaultFrameHeader(logMetaDataBuffer, defaultHeader);

        initialTermId(logMetaDataBuffer, TERM_ID_1);
        mtuLength(logMetaDataBuffer, MTU_LENGTH);
        termLength(logMetaDataBuffer, TERM_LENGTH);
        pageSize(logMetaDataBuffer, PAGE_SIZE);
        isConnected(logMetaDataBuffer, false);

        for (let i = 0; i < PARTITION_COUNT; i++) {
            termBuffers[i] = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        }

        publication = new ConcurrentPublication(
            conductor,
            CHANNEL,
            STREAM_ID_1,
            SESSION_ID_1,
            publicationLimit,
            ChannelEndpointStatus.NO_ID_ALLOCATED,
            logBuffers,
            CORRELATION_ID,
            CORRELATION_ID,
        );

        initialiseTailWithTermId(logMetaDataBuffer, PARTITION_INDEX, TERM_ID_1);

        conductor.removePublication.mockImplementation((p) => {
            if (p === publication) {
                publication.internalClose();
            }
        });
    });

    function assertFrameType(partitionIndex: number, termOffset: number, expectedFrameType: number): void {
        expect(FrameDescriptor.frameType(termBuffers[partitionIndex]!, termOffset)).toBe(expectedFrameType);
    }

    function assertFrameLength(partitionIndex: number, termOffset: number, expectedFrameLength: number): void {
        expect(FrameDescriptor.frameLength(termBuffers[partitionIndex]!, termOffset)).toBe(expectedFrameLength);
    }

    it('shouldEnsureThePublicationIsOpenBeforeReadingPosition', () => {
        publication.close();
        expect(publication.position()).toBe(CLOSED);

        expect(conductor.removePublication).toHaveBeenCalledTimes(1);
        expect(conductor.removePublication).toHaveBeenCalledWith(publication);
    });

    it('shouldReportThatPublicationHasNotBeenConnectedYet', () => {
        publicationLimit.value = 0;
        isConnected(logMetaDataBuffer, false);
        expect(publication.isConnected()).toBe(false);
    });

    it('shouldReportThatPublicationHasBeenConnectedYet', () => {
        isConnected(logMetaDataBuffer, true);
        expect(publication.isConnected()).toBe(true);
    });

    it('shouldReportInitialPosition', () => {
        expect(publication.position()).toBe(0);
    });

    it('shouldReportMaxMessageLength', () => {
        expect(publication.maxMessageLength()).toBe(FrameDescriptor.computeMaxMessageLength(TERM_LENGTH));
    });

    it('shouldRemovePublicationOnClose', () => {
        publication.close();

        expect(conductor.removePublication).toHaveBeenCalledTimes(1);
        expect(conductor.removePublication).toHaveBeenCalledWith(publication);
    });

    it('shouldReturnErrorMessages', () => {
        expect(errorString(-1)).toBe('NOT_CONNECTED');
        expect(errorString(-2)).toBe('BACK_PRESSURED');
        expect(errorString(-3)).toBe('ADMIN_ACTION');
        expect(errorString(-4)).toBe('CLOSED');
        expect(errorString(-5)).toBe('MAX_POSITION_EXCEEDED');
        expect(errorString(0)).toBe('NONE');
        expect(errorString(1)).toBe('NONE');
        expect(errorString(-6)).toBe('UNKNOWN');
        expect(errorString(Long.MIN_VALUE)).toBe('UNKNOWN');
    });

    /**
     * One of the nested classes of Java (`TryClaim`, `Offer`, `OfferWithTwoBuffers`, `VectorOffer`): the abstract
     * `invoke`, `onError` and `onSuccess`, and `BaseTests`, the tests all four inherit.
     */
    interface Variant {
        /** Called before each test (`@BeforeEach` of the nested class). */
        before?(): void;
        invoke(length: number, reservedValueSupplier: ReservedValueSupplier | null): number;
        onError(termBuffer: UnsafeBuffer, termOffset: number, length: number): void;
        onSuccess(termBuffer: UnsafeBuffer, termOffset: number, length: number): void;
    }

    function baseTests(name: string, newVariant: () => Variant, extra: (variant: () => Variant) => void): void {
        describe(name, () => {
            let variant: Variant;

            beforeEach(() => {
                variant = newVariant();
                variant.before?.();
            });

            function testPositionUponSuccess(
                length: number,
                termId_: number,
                termCount: number,
                tailAfterUpdate: bigint,
                expectedPosition: number,
            ): void {
                publicationLimit.value = Long.MAX_VALUE;
                isConnected(logMetaDataBuffer, true);
                activeTermCount(logMetaDataBuffer, termCount);
                const partitionIndex = indexByTermCount(termCount);
                const rawTail_ = packTail(termId_, 192);
                rawTail(logMetaDataBuffer, partitionIndex, rawTail_);
                // doAnswer(invocation -> tailAfterUpdate).when(logMetaDataBuffer).getAndAddLong(anyInt(), anyLong())
                getAndAddLongHalves.mockImplementation((_index: number, _delta: number, out: Int32Array) => {
                    out[0] = Number(BigInt.asIntN(32, tailAfterUpdate));
                    out[1] = Number(BigInt.asIntN(32, tailAfterUpdate >> 32n));
                });

                const position = variant.invoke(length, {
                    get: (_termBuffer, termOffset_, frameLength) => termOffset_ ^ frameLength,
                });

                expect(position).toBe(expectedPosition);
                const buffer = termBuffers[partitionIndex]!;
                const termOffset_ = termOffset(tailAfterUpdate);
                assertFrameType(partitionIndex, termOffset_, DEFAULT_FRAME_TYPE);
                expect(FrameDescriptor.frameSessionId(buffer, termOffset_)).toBe(SESSION_ID);
                expect(DataHeaderFlyweight.streamId(buffer, termOffset_)).toBe(STREAM_ID);
                expect(DataHeaderFlyweight.termId(buffer, termOffset_)).toBe(termId(tailAfterUpdate));
                variant.onSuccess(buffer, termOffset_, length);
            }

            it('returnsClosedIfPublicationWasClosed', () => {
                const length = 6;
                const termOffset = 0;
                publication.close();

                expect(variant.invoke(length, null)).toBe(CLOSED);

                variant.onError(termBuffers[PARTITION_INDEX]!, termOffset, length);
                assertFrameType(PARTITION_INDEX, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(PARTITION_INDEX, termOffset, 0);
            });

            it('returnsAdminActionIfTermCountAndTermIdDoNotMatch', () => {
                const termCount = 9;
                const termOffset = 0;
                const length = 10;
                expect(indexByTermCount(termCount)).toBe(PARTITION_INDEX);
                initialiseTailWithTermId(logMetaDataBuffer, PARTITION_INDEX, TERM_ID_1 + 5);

                expect(variant.invoke(length, null)).toBe(ADMIN_ACTION);

                variant.onError(termBuffers[PARTITION_INDEX]!, termOffset, length);
                assertFrameType(PARTITION_INDEX, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(PARTITION_INDEX, termOffset, 0);
            });

            it('returnsMaxPositionExceededIfPublicationLimitReached', () => {
                const partitionIndex = 1;
                const termOffset = TERM_LENGTH - 140;
                const length = 100;
                publicationLimit.value = 16;
                rawTail(logMetaDataBuffer, partitionIndex, packTail(Integer.MIN_VALUE, termOffset));
                activeTermCount(logMetaDataBuffer, Integer.MAX_VALUE);
                isConnected(logMetaDataBuffer, true);

                expect(variant.invoke(length, null)).toBe(MAX_POSITION_EXCEEDED);

                variant.onError(termBuffers[partitionIndex]!, termOffset, length);
                assertFrameType(partitionIndex, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(partitionIndex, termOffset, 0);
            });

            it('returnsBackPressuredIfPublicationLimitReached', () => {
                const partitionIndex = 1;
                const termOffset = 64;
                const length = 11;
                publicationLimit.value = 16;
                rawTail(logMetaDataBuffer, partitionIndex, packTail(TERM_ID_1 + 1, termOffset));
                activeTermCount(logMetaDataBuffer, 1);
                isConnected(logMetaDataBuffer, true);

                expect(variant.invoke(length, { get: () => 0x7fffffffffffffffn })).toBe(BACK_PRESSURED);

                const termBuffer = termBuffers[partitionIndex]!;
                variant.onError(termBuffer, termOffset, length);
                assertFrameType(partitionIndex, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(partitionIndex, termOffset, 0);
                expect(DataHeaderFlyweight.reservedValue(termBuffer, termOffset)).toBe(0n);
            });

            it('returnsNotConnectedIfPublicationLimitReachedAndNotConnected', () => {
                const partitionIndex = 1;
                const termOffset = 0;
                const length = 10;
                publicationLimit.value = 16;
                initialiseTailWithTermId(logMetaDataBuffer, partitionIndex, TERM_ID_1 + 1);
                activeTermCount(logMetaDataBuffer, 1);

                expect(variant.invoke(length, null)).toBe(NOT_CONNECTED);

                variant.onError(termBuffers[partitionIndex]!, termOffset, length);
                assertFrameType(partitionIndex, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(partitionIndex, termOffset, 0);
            });

            it('returnsAdminActionIfTermWasRotated', () => {
                const termOffset = TERM_LENGTH - 64;
                const length = 60;
                publicationLimit.value = 1 + Integer.MAX_VALUE;
                rawTailVolatile(logMetaDataBuffer, 0, packTail(TERM_ID_1, termOffset));
                rawTailVolatile(logMetaDataBuffer, 1, packTail(TERM_ID_1 + 1 - PARTITION_COUNT, 555));
                rawTailVolatile(logMetaDataBuffer, 2, packTail(STREAM_ID, 777));

                expect(variant.invoke(length, null)).toBe(ADMIN_ACTION);

                variant.onError(termBuffers[0]!, termOffset, length);
                assertFrameType(0, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(0, termOffset, 64);
                expect(rawTail(logMetaDataBuffer, 0)).toBe(packTail(TERM_ID_1, termOffset + 96));
                expect(rawTail(logMetaDataBuffer, 1)).toBe(packTail(TERM_ID_1 + 1, 0));
                expect(rawTail(logMetaDataBuffer, 2)).toBe(packTail(STREAM_ID, 777));
            });

            it('returnsMaxPositionExceededIfThereIsNotEnoughSpaceLeft', () => {
                const partitionIndex = 1;
                const termOffset = TERM_LENGTH - 128;
                const length = 96;
                publicationLimit.value = 1 + Integer.MAX_VALUE;
                rawTail(logMetaDataBuffer, partitionIndex, packTail(Integer.MIN_VALUE, termOffset));
                rawTail(logMetaDataBuffer, 0, packTail(55, 55));
                rawTail(logMetaDataBuffer, 2, packTail(222, 222));
                activeTermCount(logMetaDataBuffer, Integer.MAX_VALUE);
                isConnected(logMetaDataBuffer, true);

                expect(variant.invoke(length, null)).toBe(MAX_POSITION_EXCEEDED);

                variant.onError(termBuffers[partitionIndex]!, termOffset, length);
                assertFrameType(partitionIndex, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                assertFrameLength(partitionIndex, termOffset, 0);
                expect(rawTail(logMetaDataBuffer, partitionIndex)).toBe(packTail(Integer.MIN_VALUE, termOffset));
                expect(rawTail(logMetaDataBuffer, 0)).toBe(packTail(55, 55));
                expect(rawTail(logMetaDataBuffer, 2)).toBe(packTail(222, 222));
            });

            extra(() => variant);
            // the rows of the parameterized test of the nested class (tryClaimPositions or offerPositions)
            positionsTest(name, () => variant, testPositionUponSuccess);
        });
    }

    /** `TryClaim.tryClaimShouldReturnPositionAtWhichTheClaimedSpaceEnds` and `OfferBase.returnsPositionAfterDataIsCopied`. */
    function positionsTest(name: string, variant: () => Variant, testPositionUponSuccess: (...row: Row) => void): void {
        void variant;
        if ('TryClaim' === name) {
            it.each(TRY_CLAIM_POSITIONS)(
                'tryClaimShouldReturnPositionAtWhichTheClaimedSpaceEnds %#',
                (length, termId_, termCount, tailAfterUpdate, expectedPosition) => {
                    testPositionUponSuccess(length, termId_, termCount, tailAfterUpdate, expectedPosition);
                },
            );
        } else {
            it.each(OFFER_POSITIONS)(
                'returnsPositionAfterDataIsCopied %#',
                (length, termId_, termCount, tailAfterUpdate, expectedPosition) => {
                    testPositionUponSuccess(length, termId_, termCount, tailAfterUpdate, expectedPosition);
                },
            );
        }
    }

    /** `OfferBase.onError` and `OfferBase.onSuccess`, over the `buffer(processedBytes)` of the nested class. */
    function offerBase(buffer: (processedBytes: number) => UnsafeBuffer): Pick<Variant, 'onError' | 'onSuccess'> {
        return {
            onError(termBuffer, termOffset, length) {
                let offset = termOffset + HEADER_LENGTH;
                for (let i = 0, capacity = termBuffer.capacity(); offset < capacity && i < length; i++, offset++) {
                    expect(termBuffer.getByte(offset)).toBe(0);
                }
            },

            onSuccess(termBuffer, termOffset, length) {
                let index = 0;
                let processedBytes = 0;
                let offset = termOffset;
                let dataBuffer = buffer(0);
                while (processedBytes < length) {
                    const frameLength = FrameDescriptor.frameLength(termBuffer, offset);
                    if (frameLength <= 0) {
                        break;
                    }

                    const chunkLength = frameLength - HEADER_LENGTH;
                    const frameFlags = FrameDescriptor.frameFlags(termBuffer, offset);

                    if (0 === processedBytes) {
                        expect(frameFlags & FrameDescriptor.BEGIN_FRAG_FLAG).toBe(FrameDescriptor.BEGIN_FRAG_FLAG);
                    }

                    if (length === processedBytes + chunkLength) {
                        expect(frameFlags & FrameDescriptor.END_FRAG_FLAG).toBe(FrameDescriptor.END_FRAG_FLAG);
                    }

                    expect(DataHeaderFlyweight.reservedValue(termBuffer, offset)).toBe(BigInt(offset ^ frameLength));
                    offset += HEADER_LENGTH;

                    for (let i = 0; i < chunkLength; i++) {
                        expect(termBuffer.getByte(offset++)).toBe(dataBuffer.getByte(index++));
                        const nextBuffer = buffer(++processedBytes);
                        if (nextBuffer !== dataBuffer) {
                            dataBuffer = nextBuffer;
                            index = 0;
                        }
                    }
                }
                expect(processedBytes).toBe(length);
            },
        };
    }

    // @Nested class TryClaim extends BaseTests
    baseTests(
        'TryClaim',
        () => {
            const bufferClaim = new BufferClaim();
            return {
                invoke: (length) => publication.tryClaim(length, bufferClaim),

                onError() {
                    const buffer = bufferClaim.buffer();
                    expect(buffer.capacity()).toBe(0);
                },

                onSuccess(termBuffer, termOffset, length) {
                    expect(DataHeaderFlyweight.fragmentLength(termBuffer, termOffset)).toBe(-(length + HEADER_LENGTH));
                    expect(DataHeaderFlyweight.reservedValue(termBuffer, termOffset)).toBe(0n);
                    expect(bufferClaim.length()).toBe(length);
                },
            };
        },
        () => {},
    );

    // @Nested class Offer extends OfferBase
    baseTests(
        'Offer',
        () => {
            const sendBuffer = new UnsafeBuffer(randomBytes(MAX_MESSAGE_SIZE));
            return {
                ...offerBase(() => sendBuffer),
                invoke: (length, reservedValueSupplier) =>
                    publication.offer(sendBuffer, 0, length, reservedValueSupplier),
                sendBuffer,
            } as Variant & { sendBuffer: UnsafeBuffer };
        },
        (variant) => {
            it('offerWithAnOffset', () => {
                const sendBuffer = (variant() as Variant & { sendBuffer: UnsafeBuffer }).sendBuffer;
                const partitionIndex = 2;
                const termId_ = TERM_ID_1 + 2;
                const termOffset = 992;
                const offset = 11;
                const length = 23;
                publicationLimit.value = Long.MAX_VALUE;
                isConnected(logMetaDataBuffer, true);
                rawTail(logMetaDataBuffer, partitionIndex, packTail(termId_, termOffset));
                activeTermCount(logMetaDataBuffer, 2);

                const position = publication.offer(
                    sendBuffer,
                    offset,
                    length,
                    // Long.MIN_VALUE
                    { get: () => -(2n ** 63n) },
                );

                expect(position).toBe(525344);
                const termBuffer = termBuffers[partitionIndex]!;
                expect(DataHeaderFlyweight.reservedValue(termBuffer, termOffset)).toBe(-(2n ** 63n));
                for (let i = 0; i < length; i++) {
                    expect(termBuffer.getByte(termOffset + HEADER_LENGTH + i)).toBe(sendBuffer.getByte(offset + i));
                }
            });
        },
    );

    // @Nested class OfferWithTwoBuffers extends OfferBase
    baseTests(
        'OfferWithTwoBuffers',
        () => {
            let buffer1: UnsafeBuffer = new UnsafeBuffer();
            let buffer2: UnsafeBuffer = new UnsafeBuffer();
            return {
                ...offerBase((processedBytes) => (processedBytes < buffer1.capacity() ? buffer1 : buffer2)),
                invoke(length, reservedValueSupplier) {
                    const bytes = randomBytes(length);
                    const chunk1Length = Math.trunc(length * 0.25);
                    const chunk2Length = length - chunk1Length;
                    buffer1 = new UnsafeBuffer(bytes.buffer, 0, chunk1Length);
                    buffer2 = new UnsafeBuffer(bytes.buffer, chunk1Length, chunk2Length);

                    return publication.offerTwoBuffers(
                        buffer1,
                        0,
                        chunk1Length,
                        buffer2,
                        0,
                        chunk2Length,
                        reservedValueSupplier,
                    );
                },
            };
        },
        () => {
            it('offerWithOffsets', () => {
                const partitionIndex = 1;
                const termId_ = TERM_ID_1 + 1;
                const termOffset = 64;
                publicationLimit.value = Long.MAX_VALUE;
                isConnected(logMetaDataBuffer, true);
                rawTail(logMetaDataBuffer, partitionIndex, packTail(termId_, termOffset));
                activeTermCount(logMetaDataBuffer, 1);

                const bytes = randomBytes(16);
                const buffer1 = new UnsafeBuffer(bytes.buffer, 0, 8);
                const buffer2 = new UnsafeBuffer(bytes.buffer, 8, 8);

                const lengthOne = 5;
                const offsetOne = 2;
                const lengthTwo = 3;
                const offsetTwo = 4;
                const position = publication.offerTwoBuffers(
                    buffer1,
                    offsetOne,
                    lengthOne,
                    buffer2,
                    offsetTwo,
                    lengthTwo,
                    { get: () => -1 },
                );

                expect(position).toBe(262272);
                const termBuffer = termBuffers[partitionIndex]!;
                expect(DataHeaderFlyweight.reservedValue(termBuffer, termOffset)).toBe(-1n);
                for (let i = 0; i < lengthOne; i++) {
                    expect(termBuffer.getByte(termOffset + HEADER_LENGTH + i)).toBe(buffer1.getByte(offsetOne + i));
                }
                for (let i = 0; i < lengthTwo; i++) {
                    expect(termBuffer.getByte(termOffset + HEADER_LENGTH + lengthOne + i)).toBe(
                        buffer2.getByte(offsetTwo + i),
                    );
                }
            });
        },
    );

    // @Nested class VectorOffer extends OfferBase
    baseTests(
        'VectorOffer',
        () => {
            const vectors: DirectBufferVector[] = new Array<DirectBufferVector>(3);
            return {
                ...offerBase(() => vectors[0]!.buffer() as UnsafeBuffer),
                invoke(length, reservedValueSupplier) {
                    const bytes = randomBytes(length);
                    const numVectors = vectors.length;
                    const chunkSize = Math.trunc(length / numVectors);
                    const buffer = new UnsafeBuffer(bytes);
                    for (let i = 0, offset = 0; i < numVectors; i++) {
                        const size = numVectors - 1 === i ? length - offset : chunkSize;
                        vectors[i] = new DirectBufferVector(buffer, offset, size);
                        offset += size;
                    }

                    return publication.offerVectored(vectors, reservedValueSupplier);
                },
            };
        },
        () => {},
    );
});
