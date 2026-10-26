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
// Port of io/aeron/driver/PublicationImageTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { BufferUtil } from '../../src/agrona/BufferUtil.js';
import { ExpandableArrayBuffer } from '../../src/agrona/ExpandableArrayBuffer.js';
import { CachedEpochClock } from '../../src/agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import type { EpochNanoClock } from '../../src/agrona/concurrent/EpochNanoClock.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { Position } from '../../src/agrona/concurrent/status/Position.js';
import { ByteOrder, ThreadLocalRandom, TimeUnit } from '../../src/agrona/jdk.js';
import { StandardCharsets } from '../../src/agrona/jdkLang.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { CongestionControl } from '../../src/driver/CongestionControl.js';
import type { FeedbackDelayGenerator } from '../../src/driver/FeedbackDelayGenerator.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { PublicationImage } from '../../src/driver/PublicationImage.js';
import { SubscriberPosition } from '../../src/driver/SubscriberPosition.js';
import { SubscriptionLink } from '../../src/driver/SubscriptionLink.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { LossReport } from '../../src/driver/reports/LossReport.js';
import { ReceiverHwm } from '../../src/driver/status/ReceiverHwm.js';
import { ReceiverNaksSent } from '../../src/driver/status/ReceiverNaksSent.js';
import { ReceiverPos } from '../../src/driver/status/ReceiverPos.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { type Fake, calledMembers, mock } from '../support/Mockito.js';
import { expectInOrder } from '../support/InOrder.js';

const {
    PARTITION_COUNT,
    LOG_META_DATA_LENGTH,
    computePosition,
    positionBitsToShift: positionBitsToShiftOf,
    indexByPosition,
} = LogBufferDescriptor;
const {
    HEADER_LENGTH,
    BEGIN_AND_END_FLAGS,
    BEGIN_FLAG,
    END_FLAG,
    BEGIN_END_AND_EOS_FLAGS,
    HDR_TYPE_DATA,
    HDR_TYPE_PAD,
    HDR_TYPE_SETUP,
    HDR_TYPE_NAK,
    HDR_TYPE_EXT,
    CURRENT_VERSION,
} = DataHeaderFlyweight;
const { LITTLE_ENDIAN } = ByteOrder;
const { INVALID_PACKETS, HEARTBEATS_RECEIVED } = SystemCounterDescriptor;

const TERM_LENGTH = 64 * 1024;
const INITIAL_WINDOW_LENGTH = 128 * 1024;
const MAX_WINDOW_LENGHT = 1024 * 1024;
const CORRELATION_ID = 42;
const TRANSPORT_INDEX = 3;
const SESSION_ID = 888;
const STREAM_ID = 101010;
const INITIAL_TERM_ID = -444666;
const ACTIVE_TERM_ID = INITIAL_TERM_ID + 111;
const TERM_OFFSET = TERM_LENGTH - TERM_LENGTH / 4;
const FLAGS = FrameDescriptor.UNFRAGMENTED;
const SOURCE_IDENTITY = 'aeron:udp?endpoint=localhost:5555';

describe('PublicationImageTest', () => {
    // JUnit makes a new instance of the test class for each test: everything is made in beforeEach.
    let ctx: MediaDriver.Context;
    let receiveChannelEndpoint: ReceiveChannelEndpoint;
    let controlAddress: InetSocketAddress;
    let rawLog: Fake<RawLog>;
    let feedbackDelayGenerator: Fake<FeedbackDelayGenerator>;
    let congestionControl: Fake<CongestionControl>;
    let epochClock: CachedEpochClock;
    let nanoClock: CachedNanoClock;
    let buffer: UnsafeBuffer;
    let countersManager: CountersManager;
    let headerFlyweight: DataHeaderFlyweight;
    let lossReport: LossReport;
    let subscriberPositions: SubscriberPosition[];
    // mock(EpochNanoClock.class): the receive timestamp is read as the halves of the addition nanoTimeHalves (spec D17)
    let channelReceiveTimestampClock: {
        nanoTime: ReturnType<typeof vi.fn<EpochNanoClock['nanoTime']>>;
        nanoTimeHalves: ReturnType<typeof vi.fn<EpochNanoClock['nanoTimeHalves']>>;
    };
    let hwmPosition: Position;
    let rcvPosition: Position;
    let rcvNaksSent: AtomicCounter;
    let image: PublicationImage;

    /** The `PublicationImage` that every test but two builds in the same way (the two others change the channel). */
    function newImage(isReliable: boolean): PublicationImage {
        return new PublicationImage(
            CORRELATION_ID,
            ctx,
            receiveChannelEndpoint,
            TRANSPORT_INDEX,
            controlAddress,
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            FLAGS,
            isReliable,
            ctx.untetheredWindowLimitTimeoutNs(),
            ctx.untetheredLingerTimeoutNs(),
            ctx.untetheredRestingTimeoutNs(),
            rawLog,
            feedbackDelayGenerator,
            subscriberPositions,
            hwmPosition,
            rcvPosition,
            rcvNaksSent,
            SOURCE_IDENTITY,
            congestionControl,
        );
    }

    /** `when(receiveChannelEndpoint.subscriptionUdpChannel()).thenReturn(udpChannel)` and `originalUriString()`. */
    function stubChannel(udpChannel: UdpChannel, uri: string): void {
        vi.mocked(receiveChannelEndpoint.subscriptionUdpChannel).mockReturnValue(udpChannel);
        vi.mocked(receiveChannelEndpoint.originalUriString).mockReturnValue(uri);
    }

    /** `when(clock.nanoTime()).thenReturn(ns)`, for the halves of the addition `nanoTimeHalves` (spec D17). */
    function stubReceiveTimestamp(receiveTimestamp: number): void {
        channelReceiveTimestampClock.nanoTimeHalves.mockImplementation((out: Int32Array) => {
            const high = Math.floor(receiveTimestamp / 4294967296);
            out[0] = (receiveTimestamp - high * 4294967296) | 0;
            out[1] = high | 0;
        });
    }

    beforeEach(() => {
        ctx = new MediaDriver.Context();
        receiveChannelEndpoint = mock(ReceiveChannelEndpoint).mock;
        controlAddress = mock(InetSocketAddress).mock;
        rawLog = {
            termLength: vi.fn<RawLog['termLength']>(),
            termBuffers: vi.fn<RawLog['termBuffers']>(),
            metaData: vi.fn<RawLog['metaData']>(),
            fileName: vi.fn<RawLog['fileName']>(),
            free: vi.fn<RawLog['free']>(),
            close: vi.fn<RawLog['close']>(),
        };
        // a Mockito mock answers 0 and false for the members that are not stubbed
        feedbackDelayGenerator = {
            generateDelayNs: vi.fn<FeedbackDelayGenerator['generateDelayNs']>(() => 0),
            retryDelayNs: vi.fn<FeedbackDelayGenerator['retryDelayNs']>(() => 0),
        };
        congestionControl = {
            shouldMeasureRtt: vi.fn<CongestionControl['shouldMeasureRtt']>(() => false),
            onRttMeasurementSent: vi.fn<CongestionControl['onRttMeasurementSent']>(),
            onRttMeasurement: vi.fn<CongestionControl['onRttMeasurement']>(),
            onTrackRebuild: vi.fn<CongestionControl['onTrackRebuild']>(() => 0),
            initialWindowLength: vi.fn<CongestionControl['initialWindowLength']>(() => 0),
            maxWindowLength: vi.fn<CongestionControl['maxWindowLength']>(() => 0),
            close: vi.fn<CongestionControl['close']>(),
        };
        epochClock = new CachedEpochClock();
        nanoClock = new CachedNanoClock();
        buffer = new UnsafeBuffer(new Uint8Array(1024));
        countersManager = new CountersManager(
            new UnsafeBuffer(BufferUtil.allocateDirectAligned(256 * 1024, BitUtil.CACHE_LINE_LENGTH)),
            new UnsafeBuffer(BufferUtil.allocateDirectAligned(64 * 1024, BitUtil.CACHE_LINE_LENGTH)),
            StandardCharsets.US_ASCII,
        );
        headerFlyweight = new DataHeaderFlyweight();
        lossReport = mock(LossReport).mock;
        subscriberPositions = [];
        channelReceiveTimestampClock = {
            nanoTime: vi.fn<EpochNanoClock['nanoTime']>(),
            nanoTimeHalves: vi.fn<EpochNanoClock['nanoTimeHalves']>(),
        };

        epochClock.update(TimeUnit.HOURS.toMillis(1));
        nanoClock.update(TimeUnit.HOURS.toNanos(1));
        ctx.channelReceiveTimestampClock(channelReceiveTimestampClock as unknown as EpochNanoClock)
            .receiverCachedNanoClock(nanoClock)
            .nanoClock(nanoClock)
            .epochClock(epochClock)
            .imageLivenessTimeoutNs(TimeUnit.SECONDS.toNanos(10))
            .untetheredWindowLimitTimeoutNs(TimeUnit.SECONDS.toNanos(1))
            .untetheredLingerTimeoutNs(TimeUnit.MILLISECONDS.toNanos(150))
            .untetheredRestingTimeoutNs(TimeUnit.MILLISECONDS.toNanos(800))
            .statusMessageTimeoutNs(TimeUnit.MILLISECONDS.toNanos(150))
            .systemCounters(new SystemCounters(countersManager))
            .lossReport(lossReport);

        const channel = 'aeron:udp?endpoint=localhost:5555';
        const channelUri = ChannelUri.parse(channel);
        const udpChannel = mock(UdpChannel).mock;
        vi.mocked(udpChannel.channelUri).mockReturnValue(channelUri);
        vi.mocked(udpChannel.isChannelReceiveTimestampEnabled).mockReturnValue(false);
        vi.mocked(udpChannel.channelReceiveTimestampOffset).mockReturnValue(0);
        stubChannel(udpChannel, channel);

        const subscriptionLink1 = mock(SubscriptionLink).mock;
        vi.mocked(subscriptionLink1.isReliable).mockReturnValue(true);
        vi.mocked(subscriptionLink1.isTether).mockReturnValue(true);
        const subscriberPosition1 = mock(SubscriberPosition).mock;
        vi.mocked(subscriberPosition1.subscription).mockReturnValue(subscriptionLink1);
        const subscriptionLink2 = mock(SubscriptionLink).mock;
        vi.mocked(subscriptionLink1.isReliable).mockReturnValue(false);
        vi.mocked(subscriptionLink1.isTether).mockReturnValue(false);
        vi.mocked(subscriptionLink2.isReliable).mockReturnValue(false);
        vi.mocked(subscriptionLink2.isTether).mockReturnValue(false);
        const subscriberPosition2 = mock(SubscriberPosition).mock;
        vi.mocked(subscriberPosition2.subscription).mockReturnValue(subscriptionLink2);
        subscriberPositions.push(subscriberPosition1);
        subscriberPositions.push(subscriberPosition2);

        const termBuffers: UnsafeBuffer[] = [];
        for (let i = 0; i < PARTITION_COUNT; i++) {
            termBuffers[i] = new UnsafeBuffer(new Uint8Array(TERM_LENGTH));
        }
        rawLog.termBuffers.mockReturnValue(termBuffers);
        rawLog.metaData.mockReturnValue(new UnsafeBuffer(new Uint8Array(LOG_META_DATA_LENGTH)));
        rawLog.termLength.mockReturnValue(TERM_LENGTH);

        congestionControl.initialWindowLength.mockReturnValue(INITIAL_WINDOW_LENGTH);
        congestionControl.maxWindowLength.mockReturnValue(MAX_WINDOW_LENGHT);

        const clientId = 117;
        const registrationId = 73249234983274;
        const tempBuffer = new ExpandableArrayBuffer();
        hwmPosition = ReceiverHwm.allocate(
            tempBuffer,
            countersManager,
            clientId,
            registrationId,
            SESSION_ID,
            STREAM_ID,
            channel,
        );
        rcvPosition = ReceiverPos.allocate(
            tempBuffer,
            countersManager,
            clientId,
            registrationId,
            SESSION_ID,
            STREAM_ID,
            channel,
        );
        rcvNaksSent = ReceiverNaksSent.allocate(
            tempBuffer,
            countersManager,
            clientId,
            registrationId,
            SESSION_ID,
            STREAM_ID,
            channel,
        );

        expect(countersManager.getCounterOwnerId(hwmPosition.id())).toBe(clientId);
        expect(countersManager.getCounterOwnerId(rcvPosition.id())).toBe(clientId);
        expect(countersManager.getCounterOwnerId(rcvNaksSent.id())).toBe(clientId);

        image = newImage(subscriptionLink1.isReliable());

        const position = computePosition(
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            positionBitsToShiftOf(TERM_LENGTH),
            INITIAL_TERM_ID,
        );
        expect(hwmPosition.get()).toBe(position);
        expect(rcvPosition.get()).toBe(position);

        ThreadLocalRandom.current().nextBytes(buffer.byteArray());
    });

    it('shouldAdvanceHighWaterMarkByLogicalLengthWhenItContainsPaddingFrame', () => {
        const totalLength = 512;
        const packetLength = 288;
        const termId = ACTIVE_TERM_ID;
        const termOffset = TERM_LENGTH - totalLength;
        let offset = 0;
        offset += writeFrame(offset, termOffset, termId, 65, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 65);
        offset += writeFrame(offset, termOffset + offset, termId, 96, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 96);
        offset += writeFrame(offset, termOffset + offset, termId, 224, BEGIN_AND_END_FLAGS, HDR_TYPE_PAD, 0x888aa888);
        expect(offset).toBe(totalLength);
        const srcAddress = mock(InetSocketAddress).mock;

        const bytes = image.insertPacket(termId, termOffset, buffer, packetLength, TRANSPORT_INDEX, srcAddress);

        expect(bytes).toBe(packetLength);
        const positionBitsToShift = positionBitsToShiftOf(TERM_LENGTH);
        const packetPosition = computePosition(termId, termOffset, positionBitsToShift, INITIAL_TERM_ID);
        expect(hwmPosition.get()).toBe(packetPosition + totalLength);
        const activeTermBuffer = rawLog.termBuffers()[
            indexByPosition(packetPosition, positionBitsToShift)
        ] as UnsafeBuffer;
        for (let i = 0; i < packetLength; i++) {
            expect(activeTermBuffer.getByte(termOffset + i)).toBe(buffer.getByte(i));
        }
        for (let i = packetLength; i < totalLength; i++) {
            expect(activeTermBuffer.getByte(termOffset + i)).toBe(0);
        }
    });

    it('shouldAdvanceHighWaterMarkPositionOnHeartbeat', () => {
        const termId = ACTIVE_TERM_ID;
        const termOffset = TERM_OFFSET + 1024;
        writeFrame(0, termOffset, termId, 0, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, -1);
        FrameDescriptor.frameLengthOrdered(buffer, 0, 0);
        const srcAddress = mock(InetSocketAddress).mock;
        const packetLength = HEADER_LENGTH;
        const heartBeatsCounter = (ctx.systemCounters() as SystemCounters).get(HEARTBEATS_RECEIVED);
        const oldHeartBeatCount = heartBeatsCounter.getPlain();

        const bytes = image.insertPacket(termId, termOffset, buffer, packetLength, TRANSPORT_INDEX, srcAddress);

        expect(bytes).toBe(packetLength);
        const positionBitsToShift = positionBitsToShiftOf(TERM_LENGTH);
        const packetPosition = computePosition(termId, termOffset, positionBitsToShift, INITIAL_TERM_ID);
        expect(hwmPosition.get()).toBe(packetPosition);
        expect(heartBeatsCounter.getPlain()).toBe(oldHeartBeatCount + 1);
        const activeTermBuffer = rawLog.termBuffers()[
            indexByPosition(packetPosition, positionBitsToShift)
        ] as UnsafeBuffer;
        for (let i = 0; i < packetLength; i++) {
            expect(activeTermBuffer.getByte(termOffset + i)).toBe(0);
        }
    });

    it('shouldOnlyRecordUniqueLoss', () => {
        const reportEntry = mock(LossReport.ReportEntry).mock;
        vi.mocked(lossReport.createEntry).mockReturnValue(reportEntry);

        const termId = 0;
        const offset = 0;
        const length = 1024;

        // first activation => must be recorded
        epochClock.update(100);
        image.onGapDetected(termId, offset, length);
        expect(image.beginLossChange).toBe(1);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset);
        expect(image.lossLength).toBe(length);
        expect(image.endLossChange).toBe(1);

        // same loss => no reporting
        epochClock.update(200);
        image.onGapDetected(termId, offset, length);
        expect(image.beginLossChange).toBe(2);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset);
        expect(image.lossLength).toBe(length);
        expect(image.endLossChange).toBe(2);

        // smaller loss => no reporting
        epochClock.update(300);
        image.onGapDetected(termId, offset, 32);
        expect(image.beginLossChange).toBe(3);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset);
        expect(image.lossLength).toBe(32);
        expect(image.endLossChange).toBe(3);

        // loss length increased => record
        epochClock.update(400);
        image.onGapDetected(termId, offset, length + 128);
        expect(image.beginLossChange).toBe(4);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset);
        expect(image.lossLength).toBe(length + 128);
        expect(image.endLossChange).toBe(4);

        // overlapping loss => record
        epochClock.update(500);
        image.onGapDetected(termId, offset + 512, 800);
        expect(image.beginLossChange).toBe(5);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset + 512);
        expect(image.lossLength).toBe(800);
        expect(image.endLossChange).toBe(5);

        // non-overlapping loss => record
        epochClock.update(600);
        image.onGapDetected(termId, offset + 512 + 800, 32);
        expect(image.beginLossChange).toBe(6);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset + 512 + 800);
        expect(image.lossLength).toBe(32);
        expect(image.endLossChange).toBe(6);

        // non-overlapping loss => record
        epochClock.update(700);
        image.onGapDetected(termId, offset + 4096, 2048);
        expect(image.beginLossChange).toBe(7);
        expect(image.lossTermId).toBe(termId);
        expect(image.lossTermOffset).toBe(offset + 4096);
        expect(image.lossLength).toBe(2048);
        expect(image.endLossChange).toBe(7);

        // loss in different term => record
        epochClock.update(800);
        image.onGapDetected(termId + 11, 0, 256);
        expect(image.beginLossChange).toBe(8);
        expect(image.lossTermId).toBe(termId + 11);
        expect(image.lossTermOffset).toBe(0);
        expect(image.lossLength).toBe(256);
        expect(image.endLossChange).toBe(8);

        // inOrder(lossReport, reportEntry): createEntry, then the five observations, and no other call on either
        const createEntry = vi.mocked(lossReport.createEntry);
        const recordObservation = vi.mocked(reportEntry.recordObservation);
        expect(createEntry.mock.calls).toEqual([
            [length, 100, SESSION_ID, STREAM_ID, receiveChannelEndpoint.originalUriString(), SOURCE_IDENTITY],
        ]);
        expect(recordObservation.mock.calls).toEqual([
            [128, 400],
            [160, 500],
            [32, 600],
            [2048, 700],
            [256, 800],
        ]);
        expectInOrder(
            [createEntry, 0],
            [recordObservation, 0],
            [recordObservation, 1],
            [recordObservation, 2],
            [recordObservation, 3],
            [recordObservation, 4],
        );
        expect(calledMembers(lossReport)).toEqual(['createEntry']);
        expect(calledMembers(reportEntry)).toEqual(['recordObservation']);
    });

    it.each([HDR_TYPE_DATA, HDR_TYPE_PAD])('shouldRejectFrameIfTermOffsetIsNegative %s', (type) => {
        const termId = 0;
        const termOffset = -128;
        const alignedFrameLength = writeFrame(0, termOffset, termId, 32, 0, type, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, alignedFrameLength, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it.each([HDR_TYPE_DATA, HDR_TYPE_PAD])('shouldRejectFrameIfTermOffsetExceedsTermLength %s', (type) => {
        const termId = 0;
        const termOffset = TERM_LENGTH * 4;
        const alignedFrameLength = writeFrame(0, termOffset, termId, 100, 0, type, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, alignedFrameLength, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it.each([HDR_TYPE_DATA, HDR_TYPE_PAD])('shouldRejectFrameIfTermOffsetIsNotAlignedOnFrameBoundary %s', (type) => {
        const termId = 0;
        const termOffset = 500;
        const alignedFrameLength = writeFrame(0, termOffset, termId, 32, 0, type, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, alignedFrameLength, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it.each<[number, number]>([
        [0, 130],
        [1, 160],
        [0, 2147483647],
        [1, 2147483616],
    ])('shouldRejectFrameIfTermOffsetPlusAlignedFrameLengthExceedTermBufferLength %s %s', (type, frameLength) => {
        const termId = 0;
        const termOffset = TERM_LENGTH - 128;
        headerFlyweight.wrap(buffer, 0, HEADER_LENGTH);
        headerFlyweight.termOffset(termOffset).frameLength(frameLength).headerType(type);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, HEADER_LENGTH, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it('shouldRejectPacketIfLastDataFrameIfIncomplete', () => {
        const termId = 5;
        const termOffset = 64;
        const alignedLength = writeFrame(0, termOffset, termId, 100, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        writeFrame(alignedLength, termOffset + alignedLength, termId, 200, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, 384, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it.each([HDR_TYPE_PAD - 1, HDR_TYPE_DATA + 1, HDR_TYPE_EXT])(
        'shouldRejectPacketContainingAnInvalidFrameType %s',
        (type) => {
            const termOffset = 128;
            const termId = -19;
            const alignedLength = writeFrame(0, termOffset, termId, 32, BEGIN_AND_END_FLAGS, type, 0);
            const srcAddress = mock(InetSocketAddress).mock;

            expect(image.insertPacket(termId, termOffset, buffer, alignedLength, TRANSPORT_INDEX, srcAddress)).toBe(0);

            expect(invalidPackets()).toBe(1);
        },
    );

    it('shouldRejectPacketIfSubsequentFramesHaveInvalidTermOffset', () => {
        const termId = 5;
        const termOffset = 64;
        const alignedLength = writeFrame(0, termOffset, termId, 100, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        writeFrame(alignedLength, termOffset + 111, termId, 200, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, 512, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it('shouldRejectPacketIfSubsequentFramesExceedTermLength', () => {
        const termId = 111;
        const termOffset = TERM_LENGTH - 128;
        const frameLength1 = writeFrame(0, termOffset, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        const frameLength2 = writeFrame(
            frameLength1,
            termOffset + frameLength1,
            termId,
            77,
            BEGIN_AND_END_FLAGS,
            HDR_TYPE_DATA,
            0,
        );
        const srcAddress = mock(InetSocketAddress).mock;

        expect(
            image.insertPacket(termId, termOffset, buffer, frameLength1 + frameLength2, TRANSPORT_INDEX, srcAddress),
        ).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it('shouldRejectPacketIfItHasTrailingBytes', () => {
        const termId = 42;
        const termOffset = 1024;
        writeFrame(0, termOffset, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        writeFrame(96, termOffset + 96, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        buffer.putInt(192, -1024, LITTLE_ENDIAN);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, 256, TRANSPORT_INDEX, srcAddress)).toBe(0);

        expect(invalidPackets()).toBe(1);
    });

    it('shouldAcceptPacketThatEndsWithPaddingFrameExceedingThePacketLength', () => {
        const termId = 42;
        const termOffset = 1024;
        writeFrame(0, termOffset, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        writeFrame(96, termOffset + 96, termId, 192, BEGIN_AND_END_FLAGS, HDR_TYPE_PAD, 0);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, 128, TRANSPORT_INDEX, srcAddress)).toBe(128);

        expect(invalidPackets()).toBe(0);
    });

    it.each([HDR_TYPE_SETUP, HDR_TYPE_DATA, HDR_TYPE_NAK])('shouldAllowAnyPacketTypesAsHeartbeat %s', (type) => {
        const termId = -9;
        const termOffset = 64;
        headerFlyweight.wrap(buffer, 0, HEADER_LENGTH);
        headerFlyweight.termId(termId).termOffset(termOffset).frameLength(0).headerType(type);
        const srcAddress = mock(InetSocketAddress).mock;

        expect(image.insertPacket(termId, termOffset, buffer, HEADER_LENGTH, TRANSPORT_INDEX, srcAddress)).toBe(
            HEADER_LENGTH,
        );

        expect(invalidPackets()).toBe(0);
    });

    it.each([UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET, 16])(
        'shouldTimestampEveryBeginFrameUsingSpecifiedOffset %s',
        (channelReceiveTimestampOffset) => {
            const termId = 8;
            const termOffset = 64;
            buffer.setMemory(0, buffer.capacity(), 0);
            let offset = writeFrame(0, termOffset, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 32, BEGIN_FLAG, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 64, 0, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 96, 0, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 32, END_FLAG, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 50, BEGIN_AND_END_FLAGS, HDR_TYPE_PAD, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 100, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
            offset += writeFrame(offset, termOffset + offset, termId, 200, BEGIN_END_AND_EOS_FLAGS, HDR_TYPE_PAD, 0);

            const srcAddress = mock(InetSocketAddress).mock;
            const uri = 'aeron:udp?endpoint=localhost:5050';
            const udpChannel = mock(UdpChannel).mock;
            vi.mocked(udpChannel.channelUri).mockReturnValue(ChannelUri.parse(uri));
            vi.mocked(udpChannel.isChannelReceiveTimestampEnabled).mockReturnValue(true);
            vi.mocked(udpChannel.channelReceiveTimestampOffset).mockReturnValue(channelReceiveTimestampOffset);
            stubChannel(udpChannel, uri);
            const receiveTimestamp = 6328236423844368;
            stubReceiveTimestamp(receiveTimestamp);

            image = newImage(true);

            expect(image.insertPacket(termId, termOffset, buffer, offset, TRANSPORT_INDEX, srcAddress)).toBe(offset);

            expect(invalidPackets()).toBe(0);
            expect(channelReceiveTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(1);
            expect(channelReceiveTimestampClock.nanoTime).toHaveBeenCalledTimes(0);

            const timestampOffset = HEADER_LENGTH + channelReceiveTimestampOffset;
            expect(buffer.getLong(timestampOffset, LITTLE_ENDIAN)).toBe(receiveTimestamp);
            expect(buffer.getLong(96 + timestampOffset, LITTLE_ENDIAN)).toBe(receiveTimestamp);
            expect(buffer.getLong(160 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
            expect(buffer.getLong(256 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
            expect(buffer.getLong(384 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
            expect(buffer.getLong(448 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
            expect(buffer.getLong(544 + timestampOffset, LITTLE_ENDIAN)).toBe(receiveTimestamp);
            expect(buffer.getLong(704 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
        },
    );

    it('shouldOnlyTimestampFramesIfOffsetIsNotOutOfBounds', () => {
        const termId = 8;
        const termOffset = 64;
        buffer.setMemory(0, buffer.capacity(), 0);
        let offset = writeFrame(0, termOffset, termId, 64, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 32, BEGIN_FLAG, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 64, 0, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 96, 0, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 32, END_FLAG, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 100, BEGIN_AND_END_FLAGS, HDR_TYPE_DATA, 0);
        offset += writeFrame(offset, termOffset + offset, termId, 200, BEGIN_END_AND_EOS_FLAGS, HDR_TYPE_PAD, 0);

        const channelReceiveTimestampOffset = 56;
        const srcAddress = mock(InetSocketAddress).mock;
        const uri = 'aeron:udp?endpoint=localhost:5050';
        const udpChannel = mock(UdpChannel).mock;
        vi.mocked(udpChannel.channelUri).mockReturnValue(ChannelUri.parse(uri));
        vi.mocked(udpChannel.isChannelReceiveTimestampEnabled).mockReturnValue(true);
        vi.mocked(udpChannel.channelReceiveTimestampOffset).mockReturnValue(channelReceiveTimestampOffset);
        stubChannel(udpChannel, uri);
        const receiveTimestamp = -57834574957934;
        stubReceiveTimestamp(receiveTimestamp);

        image = newImage(true);

        expect(image.insertPacket(termId, termOffset, buffer, offset, TRANSPORT_INDEX, srcAddress)).toBe(offset);

        expect(invalidPackets()).toBe(0);
        expect(channelReceiveTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(1);
        expect(channelReceiveTimestampClock.nanoTime).toHaveBeenCalledTimes(0);

        const timestampOffset = HEADER_LENGTH + channelReceiveTimestampOffset;
        expect(buffer.getLong(timestampOffset, LITTLE_ENDIAN)).toBe(receiveTimestamp);
        expect(buffer.getLong(96 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
        expect(buffer.getLong(160 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
        expect(buffer.getLong(256 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
        expect(buffer.getLong(384 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
        expect(buffer.getLong(448 + timestampOffset, LITTLE_ENDIAN)).toBe(receiveTimestamp);
        expect(buffer.getLong(608 + timestampOffset, LITTLE_ENDIAN)).toBe(0);
    });

    /** `ctx.systemCounters().get(INVALID_PACKETS).get()`. */
    function invalidPackets(): number {
        return (ctx.systemCounters() as SystemCounters).get(INVALID_PACKETS).get();
    }

    function writeFrame(
        offset: number,
        termOffset: number,
        termId: number,
        length: number,
        flags: number,
        type: number,
        reservedValue: number,
    ): number {
        const frameLength = length + HEADER_LENGTH;
        headerFlyweight.wrap(buffer, offset, frameLength);
        headerFlyweight.frameLength(frameLength).version(CURRENT_VERSION).flags(flags).headerType(type);
        // the reserved value is a `long` (a bigint, spec D5): Java widens the `int`, with its sign
        headerFlyweight
            .termOffset(termOffset)
            .sessionId(SESSION_ID)
            .streamId(STREAM_ID)
            .termId(termId)
            .reservedValue(BigInt(reservedValue | 0));

        return BitUtil.align(frameLength, FrameDescriptor.FRAME_ALIGNMENT);
    }
});
