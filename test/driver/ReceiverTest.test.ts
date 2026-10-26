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
// Port of io/aeron/driver/ReceiverTest.java @ 1.53.3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { CachedEpochClock } from '../../src/agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { ManyToOneConcurrentLinkedQueue } from '../../src/agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { OneToOneConcurrentArrayQueue } from '../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { Position } from '../../src/agrona/concurrent/status/Position.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermReader } from '../../src/client/logbuffer/TermReader.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { CongestionControl } from '../../src/driver/CongestionControl.js';
import { DataPacketDispatcher } from '../../src/driver/DataPacketDispatcher.js';
import { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import { DutyCycleTracker } from '../../src/driver/DutyCycleTracker.js';
import type { FeedbackDelayGenerator } from '../../src/driver/FeedbackDelayGenerator.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { PublicationImage } from '../../src/driver/PublicationImage.js';
import { Receiver } from '../../src/driver/Receiver.js';
import { ReceiverProxy } from '../../src/driver/ReceiverProxy.js';
import { SubscriberPosition } from '../../src/driver/SubscriberPosition.js';
import { SubscriptionLink } from '../../src/driver/SubscriptionLink.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { ControlTransportPoller } from '../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../src/driver/media/DataTransportPoller.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../src/driver/media/WildcardPortManager.js';
import { LossReport } from '../../src/driver/reports/LossReport.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { AtomicLongPosition } from '../support/AtomicLongPosition.js';
import { MockPosition } from '../support/MockPosition.js';
import { calledMembers, mock, type Fake } from '../support/Mockito.js';
import { TestLogFactory } from '../support/TestLogFactory.js';
import { Collector, freeUdpPort } from '../support/Udp.js';

const { TERM_MIN_LENGTH, computePosition, indexByTerm } = LogBufferDescriptor;
const { align } = BitUtil;

const TERM_BUFFER_LENGTH = TERM_MIN_LENGTH;
const MTU_LENGTH = 2048;
const POSITION_BITS_TO_SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_BUFFER_LENGTH);
// Java binds fixed ports (4005 and 40123); other test files bind their own fixed ports in parallel, so the ports are
// free ones, taken once.
const RCV_PORT = freeUdpPort();
const URI = 'aeron:udp?endpoint=localhost:' + RCV_PORT;
const UDP_CHANNEL = UdpChannel.parse(URI);
const UNTETHERED_TIMEOUT_NS = 1_000_000_000;
const CORRELATION_ID = 20;
const STREAM_ID = 1010;
const INITIAL_TERM_ID = 3;
const ACTIVE_TERM_ID = 3;
const SESSION_ID = 1;
const INITIAL_TERM_OFFSET = 0;
const ACTIVE_INDEX = indexByTerm(ACTIVE_TERM_ID, ACTIVE_TERM_ID);
const FAKE_PAYLOAD = new TextEncoder().encode('Hello there, message!');
const INITIAL_WINDOW_LENGTH = Configuration.INITIAL_WINDOW_LENGTH_DEFAULT;
const STATUS_MESSAGE_TIMEOUT = Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS;
const SOURCE_ADDRESS = new InetSocketAddress('localhost', 45679);
const SOURCE_IDENTITY = Configuration.sourceIdentity(SOURCE_ADDRESS);
const IS_RELIABLE = true;

const POSITION = new MockPosition();
const POSITIONS: SubscriberPosition[] = [];

describe('ReceiverTest', () => {
    // JUnit makes a new instance of the test class for each test: everything but the statics is made in beforeEach.
    let mockFeedbackDelayGenerator: Fake<FeedbackDelayGenerator>;
    let mockDataTransportPoller: DataTransportPoller;
    let mockControlTransportPoller: ControlTransportPoller;
    let mockSystemCounters: SystemCounters;
    let mockHighestReceivedPosition: AtomicLongPosition;
    let mockRebuildPosition: AtomicLongPosition;
    let mockSubscriberPosition: Position;
    let rcvNaksSent: AtomicCounter;
    let dataBuffer: UnsafeBuffer;
    let setupBuffer: UnsafeBuffer;
    let mockErrorHandler: ErrorHandler;
    let dataHeader: DataHeaderFlyweight;
    let statusHeader: StatusMessageFlyweight;
    let setupHeader: SetupFlyweight;
    let nanoClock: CachedNanoClock;
    let epochClock: CachedEpochClock;
    let rawLog: RawLog;
    let header: Header;
    let termBuffers: UnsafeBuffer[];
    let senderChannel: Collector;
    let senderAddress: InetSocketAddress;
    let receiver: Receiver;
    let receiverProxy: ReceiverProxy;
    let toConductorQueue: ManyToOneConcurrentLinkedQueue<() => void>;
    let driverConductorProxy: DriverConductorProxy;
    let congestionControl: Fake<CongestionControl>;
    let ctx: MediaDriver.Context;
    let systemCounters: AtomicCounter[];
    let receiveChannelEndpoint: ReceiveChannelEndpoint;

    /** A `PublicationImage` as every test of the Java class makes it, at `initialTermOffset`. */
    function newImage(initialTermOffset: number): PublicationImage {
        return new PublicationImage(
            CORRELATION_ID,
            ctx,
            receiveChannelEndpoint,
            0,
            senderAddress,
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            ACTIVE_TERM_ID,
            initialTermOffset,
            0,
            IS_RELIABLE,
            UNTETHERED_TIMEOUT_NS,
            UNTETHERED_TIMEOUT_NS,
            UNTETHERED_TIMEOUT_NS,
            rawLog,
            mockFeedbackDelayGenerator,
            POSITIONS,
            mockHighestReceivedPosition,
            mockRebuildPosition,
            rcvNaksSent,
            SOURCE_IDENTITY,
            congestionControl,
        );
    }

    beforeEach(() => {
        mockFeedbackDelayGenerator = {
            generateDelayNs: vi.fn<FeedbackDelayGenerator['generateDelayNs']>(() => 0),
            retryDelayNs: vi.fn<FeedbackDelayGenerator['retryDelayNs']>(() => 0),
        };
        mockDataTransportPoller = mock(DataTransportPoller).mock;
        vi.mocked(mockDataTransportPoller.pollTransports).mockReturnValue(0);
        mockControlTransportPoller = mock(ControlTransportPoller).mock;
        mockSystemCounters = mock(SystemCounters).mock;
        mockHighestReceivedPosition = new AtomicLongPosition();
        vi.spyOn(mockHighestReceivedPosition, 'setRelease');
        vi.spyOn(mockHighestReceivedPosition, 'proposeMaxRelease');
        mockRebuildPosition = new AtomicLongPosition();
        vi.spyOn(mockRebuildPosition, 'setRelease');
        vi.spyOn(mockRebuildPosition, 'proposeMaxRelease');
        mockSubscriberPosition = new MockPosition();
        rcvNaksSent = mock(AtomicCounter).mock;
        dataBuffer = new UnsafeBuffer(new Uint8Array(2 * 1024));
        setupBuffer = new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH));
        mockErrorHandler = { onError: vi.fn<ErrorHandler['onError']>() };
        dataHeader = new DataHeaderFlyweight();
        statusHeader = new StatusMessageFlyweight();
        setupHeader = new SetupFlyweight();
        nanoClock = new CachedNanoClock();
        epochClock = new CachedEpochClock();
        rawLog = TestLogFactory.newLogBuffers(TERM_BUFFER_LENGTH);
        header = new Header(INITIAL_TERM_ID, TERM_BUFFER_LENGTH);
        toConductorQueue = new ManyToOneConcurrentLinkedQueue<() => void>();
        driverConductorProxy = new DriverConductorProxy(toConductorQueue);
        congestionControl = {
            shouldMeasureRtt: vi.fn<CongestionControl['shouldMeasureRtt']>(() => false),
            onRttMeasurementSent: vi.fn<CongestionControl['onRttMeasurementSent']>(),
            onRttMeasurement: vi.fn<CongestionControl['onRttMeasurement']>(),
            onTrackRebuild: vi.fn<CongestionControl['onTrackRebuild']>(() => 0),
            initialWindowLength: vi.fn<CongestionControl['initialWindowLength']>(() => 0),
            maxWindowLength: vi.fn<CongestionControl['maxWindowLength']>(() => 0),
            close: vi.fn<CongestionControl['close']>(),
        };
        ctx = new MediaDriver.Context()
            .systemCounters(mockSystemCounters)
            .errorHandler(mockErrorHandler)
            .nanoClock(nanoClock)
            .epochClock(epochClock)
            .cachedNanoClock(nanoClock)
            .senderCachedNanoClock(nanoClock)
            .receiverCachedNanoClock(nanoClock)
            .lossReport(mock(LossReport).mock)
            .receiverDutyCycleTracker(new DutyCycleTracker());
        systemCounters = [];

        const subscriptionLink = mock(SubscriptionLink).mock;
        vi.mocked(subscriptionLink.isTether).mockReturnValue(true);
        vi.mocked(subscriptionLink.isReliable).mockReturnValue(true);
        POSITIONS.push(new SubscriberPosition(subscriptionLink, null, POSITION));

        POSITION.value = computePosition(ACTIVE_TERM_ID, 0, POSITION_BITS_TO_SHIFT, ACTIVE_TERM_ID);

        for (const descriptor of SystemCounterDescriptor.values()) {
            systemCounters[descriptor.id()] = mock(AtomicCounter).mock;
        }
        vi.mocked(mockSystemCounters.get).mockImplementation(
            (descriptor) => systemCounters[descriptor.id()] as AtomicCounter,
        );

        vi.mocked(congestionControl.onTrackRebuild).mockReturnValue(
            CongestionControl.packOutcome(INITIAL_WINDOW_LENGTH, false),
        );
        congestionControl.initialWindowLength.mockReturnValue(INITIAL_WINDOW_LENGTH);

        const receiverCtx = new MediaDriver.Context()
            .driverCommandQueue(toConductorQueue)
            .dataTransportPoller(mockDataTransportPoller)
            .controlTransportPoller(mockControlTransportPoller)
            .logFactory(new TestLogFactory())
            .systemCounters(mockSystemCounters)
            .receiverCommandQueue(new OneToOneConcurrentArrayQueue<() => void>(Configuration.CMD_QUEUE_CAPACITY))
            .nanoClock(nanoClock)
            .cachedNanoClock(nanoClock)
            .senderCachedNanoClock(nanoClock)
            .receiverCachedNanoClock(nanoClock)
            .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
            .driverConductorProxy(driverConductorProxy)
            .receiverDutyCycleTracker(new DutyCycleTracker());

        receiverProxy = new ReceiverProxy(
            receiverCtx.receiverCommandQueue() as OneToOneConcurrentArrayQueue<() => void>,
            mock(AtomicCounter).mock,
        );

        receiver = new Receiver(receiverCtx);
        receiverProxy.receiver(receiver);

        senderChannel = new Collector();
        senderAddress = new InetSocketAddress('localhost', senderChannel.port);

        termBuffers = rawLog.termBuffers();

        const receiverChannelContext = new MediaDriver.Context()
            .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
            .systemCounters(mockSystemCounters)
            .cachedNanoClock(nanoClock)
            .senderCachedNanoClock(nanoClock)
            .receiverCachedNanoClock(nanoClock)
            .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
            .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));

        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            UdpChannel.parse(URI),
            new DataPacketDispatcher(driverConductorProxy, receiver, ctx.streamSessionLimit()),
            mock(AtomicCounter).mock,
            receiverChannelContext,
        );
    });

    afterEach(() => {
        // CloseHelper.closeAll(receiveChannelEndpoint, senderChannel, receiver::onClose): the collector is closed by
        // test/support/Udp.ts after each test
        receiveChannelEndpoint.close();
        receiver.onClose();
    });

    it('shouldCreateRcvTermAndSendSmOnSetup', async () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const image = newImage(INITIAL_TERM_OFFSET);

        const messagesRead = drainConductorQueue(() => {
            // pass in new term buffer from conductor, which should trigger SM
            receiverProxy.newPublicationImage(receiveChannelEndpoint, image);
        });

        expect(messagesRead).toBe(1);

        nanoClock.advance(STATUS_MESSAGE_TIMEOUT * 2);
        receiver.doWork();

        // do { rcvAddress = senderChannel.receive(rcvBuffer) } while (null == rcvAddress): the datagram arrives as an
        // event (spec D1), so the wait yields to the event loop and fails at a cap
        await senderChannel.waitFor(1, 'the status message');
        const received = senderChannel.received[0] as { message: Buffer; rinfo: { port: number } };

        statusHeader.wrap(new UnsafeBuffer(Uint8Array.from(received.message)));

        expect(received.rinfo.port).toBe(UDP_CHANNEL.remoteData().getPort());
        expect(statusHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SM);
        expect(statusHeader.streamId()).toBe(STREAM_ID);
        expect(statusHeader.sessionId()).toBe(SESSION_ID);
        expect(statusHeader.consumptionTermId()).toBe(ACTIVE_TERM_ID);
        expect(statusHeader.frameLength()).toBe(StatusMessageFlyweight.HEADER_LENGTH);
    });

    it('shouldInsertDataIntoLogAfterInitialExchange', () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const commandsRead = drainConductorQueue(() => {
            const image = newImage(INITIAL_TERM_OFFSET);

            receiverProxy.newPublicationImage(receiveChannelEndpoint, image);
        });

        expect(commandsRead).toBe(1);

        receiver.doWork();

        fillDataFrame(dataHeader, 0);
        receiveChannelEndpoint.onDataPacket(
            dataHeader,
            dataBuffer,
            alignFrame(dataHeader.frameLength()),
            senderAddress,
            0,
        );

        const readOutcome = readTerm(INITIAL_TERM_OFFSET, 0);

        expect(readOutcome).toBe(1);
    });

    it('shouldNotOverwriteDataFrameWithHeartbeat', () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const commandsRead = drainConductorQueue(() => {
            const image = newImage(INITIAL_TERM_OFFSET);

            receiverProxy.newPublicationImage(receiveChannelEndpoint, image);
        });

        expect(commandsRead).toBe(1);

        receiver.doWork();

        fillDataFrame(dataHeader, 0); // initial data frame
        receiveChannelEndpoint.onDataPacket(
            dataHeader,
            dataBuffer,
            alignFrame(dataHeader.frameLength()),
            senderAddress,
            0,
        );

        fillDataFrame(dataHeader, 0); // heartbeat with same term offset
        receiveChannelEndpoint.onDataPacket(
            dataHeader,
            dataBuffer,
            alignFrame(dataHeader.frameLength()),
            senderAddress,
            0,
        );

        const readOutcome = readTerm(INITIAL_TERM_OFFSET, 0);

        expect(readOutcome).toBe(1);
    });

    it('shouldOverwriteHeartbeatWithDataFrame', () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiver.doWork();
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const commandsRead = drainConductorQueue(() => {
            const image = newImage(INITIAL_TERM_OFFSET);

            receiverProxy.newPublicationImage(receiveChannelEndpoint, image);
        });

        expect(commandsRead).toBe(1);

        receiver.doWork();

        fillDataFrame(dataHeader, 0); // heartbeat with same term offset
        receiveChannelEndpoint.onDataPacket(
            dataHeader,
            dataBuffer,
            alignFrame(dataHeader.frameLength()),
            senderAddress,
            0,
        );

        fillDataFrame(dataHeader, 0); // initial data frame
        receiveChannelEndpoint.onDataPacket(
            dataHeader,
            dataBuffer,
            alignFrame(dataHeader.frameLength()),
            senderAddress,
            0,
        );

        const readOutcome = readTerm(INITIAL_TERM_OFFSET, 0);

        expect(readOutcome).toBe(1);
    });

    it('shouldHandleNonZeroTermOffsetCorrectly', () => {
        const initialTermOffset = align(TERM_BUFFER_LENGTH / 16, FrameDescriptor.FRAME_ALIGNMENT);
        const alignedDataFrameLength = align(
            DataHeaderFlyweight.HEADER_LENGTH + FAKE_PAYLOAD.length,
            FrameDescriptor.FRAME_ALIGNMENT,
        );

        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader, initialTermOffset);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const commandsRead = drainConductorQueue(() => {
            const image = newImage(initialTermOffset);

            receiverProxy.newPublicationImage(receiveChannelEndpoint, image);
        });

        expect(commandsRead).toBe(1);

        expect(mockHighestReceivedPosition.setRelease).toHaveBeenCalledTimes(1);
        expect(mockHighestReceivedPosition.setRelease).toHaveBeenCalledWith(initialTermOffset);

        receiver.doWork();

        fillDataFrame(dataHeader, initialTermOffset); // initial data frame
        receiveChannelEndpoint.onDataPacket(dataHeader, dataBuffer, alignedDataFrameLength, senderAddress, 0);

        expect(mockHighestReceivedPosition.proposeMaxRelease).toHaveBeenCalledTimes(1);
        expect(mockHighestReceivedPosition.proposeMaxRelease).toHaveBeenCalledWith(
            initialTermOffset + alignedDataFrameLength,
        );

        const readOutcome = readTerm(initialTermOffset, initialTermOffset);

        expect(readOutcome).toBe(1);
    });

    it('shouldRemoveImageFromDispatcherWithNoActivity', () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const mockImage = mockPublicationImage();
        vi.mocked(mockImage.isConnected).mockReturnValue(false);

        receiver.onNewPublicationImage(receiveChannelEndpoint, mockImage);
        receiver.doWork();

        expect(mockImage.removeFromDispatcher).toHaveBeenCalledTimes(1);
    });

    it('shouldNotRemoveImageFromDispatcherOnRemoveSubscription', () => {
        receiveChannelEndpoint.openChannel();
        receiverProxy.registerReceiveChannelEndpoint(receiveChannelEndpoint);
        receiverProxy.addSubscription(receiveChannelEndpoint, STREAM_ID);

        receiver.doWork();
        receiver.doWork();

        fillSetupFrame(setupHeader);
        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const mockImage = mockPublicationImage();
        vi.mocked(mockImage.isConnected).mockReturnValue(true);

        receiver.onNewPublicationImage(receiveChannelEndpoint, mockImage);
        receiver.onRemoveSubscription(receiveChannelEndpoint, STREAM_ID);
        receiver.doWork();

        expect(mockImage.deactivate).toHaveBeenCalledTimes(1);
        expect(mockImage.removeFromDispatcher).not.toHaveBeenCalled();
    });

    it('shouldRejectInvalidStatusMessage', () => {
        fillSetupFrame(setupHeader);
        setupHeader.termOffset(-1);
        expect(setupHeader.isValid()).toBe(false);

        receiveChannelEndpoint.onSetupMessage(setupHeader, setupBuffer, SetupFlyweight.HEADER_LENGTH, senderAddress, 0);

        const invalidPackets = mockSystemCounters.get(SystemCounterDescriptor.INVALID_PACKETS);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        // verifyNoMoreInteractions(invalidPackets)
        expect(calledMembers(invalidPackets)).toEqual(['increment']);
    });

    /** `mock(PublicationImage.class)` with the answers of the tests: the session and stream ids, 0 for the work counts. */
    function mockPublicationImage(): PublicationImage {
        const mockImage = mock(PublicationImage).mock;
        vi.mocked(mockImage.sessionId).mockReturnValue(SESSION_ID);
        vi.mocked(mockImage.streamId).mockReturnValue(STREAM_ID);
        vi.mocked(mockImage.sendPendingStatusMessage).mockReturnValue(0);
        vi.mocked(mockImage.processPendingLoss).mockReturnValue(0);
        vi.mocked(mockImage.initiateAnyRttMeasurements).mockReturnValue(0);
        return mockImage;
    }

    /** `TermReader.read` of the one frame that the tests expect, with the assertions of the handler. */
    function readTerm(termOffset: number, expectedTermOffset: number): number {
        return TermReader.read(
            termBuffers[ACTIVE_INDEX] as UnsafeBuffer,
            termOffset,
            {
                onFragment: (_buffer, _offset, _length, header) => {
                    expect(header.type()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
                    expect(header.termId()).toBe(ACTIVE_TERM_ID);
                    expect(header.streamId()).toBe(STREAM_ID);
                    expect(header.sessionId()).toBe(SESSION_ID);
                    expect(header.termOffset()).toBe(expectedTermOffset);
                    expect(header.frameLength()).toBe(DataHeaderFlyweight.HEADER_LENGTH + FAKE_PAYLOAD.length);
                },
            },
            2147483647,
            header,
            mockErrorHandler,
            0,
            mockSubscriberPosition,
        );
    }

    function alignFrame(i: number): number {
        return BitUtil.align(i, FrameDescriptor.FRAME_ALIGNMENT);
    }

    function fillDataFrame(dataHeader: DataHeaderFlyweight, termOffset: number): void {
        dataHeader.wrap(dataBuffer);
        dataHeader.termOffset(termOffset).termId(ACTIVE_TERM_ID).streamId(STREAM_ID).sessionId(SESSION_ID);
        dataHeader
            .frameLength(DataHeaderFlyweight.HEADER_LENGTH + FAKE_PAYLOAD.length)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .version(HeaderFlyweight.CURRENT_VERSION);

        dataBuffer.putBytes(dataHeader.dataOffset(), FAKE_PAYLOAD);
    }

    function fillSetupFrame(setupHeader: SetupFlyweight, termOffset = 0): void {
        setupHeader.wrap(setupBuffer);
        setupHeader
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .initialTermId(INITIAL_TERM_ID)
            .activeTermId(ACTIVE_TERM_ID)
            .termOffset(termOffset)
            .termLength(TERM_BUFFER_LENGTH)
            .mtuLength(MTU_LENGTH)
            .frameLength(SetupFlyweight.HEADER_LENGTH)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
            .flags(0)
            .version(HeaderFlyweight.CURRENT_VERSION);
    }

    function drainConductorQueue(consumer: (command: () => void) => void): number {
        let workCount = 0;
        for (let i = 0; i < 1000; i++) {
            const command = toConductorQueue.poll();
            if (null !== command) {
                consumer(command);
                workCount++;
            } else {
                return workCount;
            }
        }

        throw new Error('the conductor queue did not drain in 1000 commands');
    }
});
