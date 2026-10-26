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
// Port of io/aeron/driver/SenderTest.java @ 1.53.3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { CachedEpochClock } from '../../src/agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { OneToOneConcurrentArrayQueue } from '../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { HeaderWriter } from '../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { DutyCycleTracker } from '../../src/driver/DutyCycleTracker.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../src/driver/media/ControlTransportPoller.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import { NetworkPublicationThreadLocals } from '../../src/driver/NetworkPublicationThreadLocals.js';
import { PublicationParams } from '../../src/driver/PublicationParams.js';
import { RetransmitHandler } from '../../src/driver/RetransmitHandler.js';
import { Sender } from '../../src/driver/Sender.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { UnicastFlowControl } from '../../src/driver/UnicastFlowControl.js';
import { AtomicLongPosition } from '../support/AtomicLongPosition.js';
import { mock } from '../support/Mockito.js';
import { mockConductorProxy, whenReturn } from '../support/PublicationFakes.js';
import { TestLogFactory } from '../support/TestLogFactory.js';

const { FRAME_ALIGNMENT, frameLengthOrdered } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { align } = BitUtil;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const MAX_FRAME_LENGTH = 1024;
const SESSION_ID = 1;
const STREAM_ID = 1002;
const INITIAL_TERM_ID = 3;
const PAYLOAD = new TextEncoder().encode('Payload is here!');

const HEADER = DataHeaderFlyweight.createDefaultHeader(SESSION_ID, STREAM_ID, INITIAL_TERM_ID);
const FRAME_LENGTH = HEADER.capacity() + PAYLOAD.length;
const ALIGNED_FRAME_LENGTH = align(FRAME_LENGTH, FRAME_ALIGNMENT);

describe('SenderTest', () => {
    const mockTransportPoller = mock(ControlTransportPoller).mock;

    let rawLog: RawLog;
    let publication: NetworkPublication;
    let sender: Sender;

    // spy(new UnicastFlowControl()): the test verifies nothing on it, so it is the real object
    let flowControl: UnicastFlowControl;
    const mockRetransmitHandler = mock(RetransmitHandler).mock;
    const mockDriverConductorProxy = mockConductorProxy();

    let nanoClock: CachedNanoClock;

    // Queue<ByteBuffer>: the frames are copies, as the Java answer copies the buffer
    const receivedFrames: UnsafeBuffer[] = [];

    const udpChannel = UdpChannel.parse('aeron:udp?endpoint=localhost:40123');
    const rcvAddress = udpChannel.remoteData();
    const dataHeader = new DataHeaderFlyweight();
    const setupHeader = new SetupFlyweight();
    const mockSystemCounters = mock(SystemCounters).mock;
    let senderCommandQueue: OneToOneConcurrentArrayQueue<() => void>;

    const headerWriter = HeaderWriter.newInstance(HEADER);

    const errorHandler: ErrorHandler = { onError: vi.fn<ErrorHandler['onError']>() };

    /** `Answer<Integer> saveByteBufferAnswer`: copies the frame that was sent and answers its length. */
    function saveByteBufferAnswer(buffer: UnsafeBuffer, offset: number, length: number): number {
        const copy = new Uint8Array(length);
        buffer.getBytes(offset, copy, 0, length);
        receivedFrames.push(new UnsafeBuffer(copy));

        return length;
    }

    /** `receivedFrames.remove()`: throws when the queue is empty, as `Queue.remove()` does. */
    function removeFrame(): UnsafeBuffer {
        const frame = receivedFrames.shift();
        if (undefined === frame) {
            throw new Error('NoSuchElementException');
        }

        return frame;
    }

    /** A Mockito mock of a flyweight answers 0 for the `int` and `long` members that are not stubbed. */
    function mockStatusMessage(consumptionTermId: number, consumptionTermOffset: number, receiverWindowLength: number) {
        const msg = mock(StatusMessageFlyweight).mock;
        whenReturn(msg.consumptionTermId, consumptionTermId);
        whenReturn(msg.consumptionTermOffset, consumptionTermOffset);
        whenReturn(msg.receiverWindowLength, receiverWindowLength);
        whenReturn(msg.flags, 0);
        whenReturn(msg.receiverIdHigh, 0);
        whenReturn(msg.receiverIdLow, 0);

        return msg;
    }

    beforeEach(() => {
        receivedFrames.length = 0;
        rawLog = TestLogFactory.newLogBuffers(TERM_BUFFER_LENGTH);
        flowControl = new UnicastFlowControl();
        nanoClock = new CachedNanoClock();
        senderCommandQueue = new OneToOneConcurrentArrayQueue<() => void>(Configuration.CMD_QUEUE_CAPACITY);

        // a Mockito mock answers 0 for the int that it is not stubbed to answer
        vi.mocked(mockTransportPoller.pollTransports).mockReturnValue(0);
        const mockSendChannelEndpoint = mock(SendChannelEndpoint).mock;
        vi.mocked(mockSendChannelEndpoint.udpChannel).mockReturnValue(udpChannel);
        vi.mocked(mockSendChannelEndpoint.multicastTtl).mockReturnValue(0);
        vi.mocked(mockSendChannelEndpoint.send).mockImplementation(saveByteBufferAnswer);
        const mockCounter = mock(AtomicCounter).mock;
        vi.mocked(mockCounter.get).mockReturnValue(0);
        vi.mocked(mockSystemCounters.get).mockReturnValue(mockCounter);

        const ctx = new MediaDriver.Context()
            .cachedEpochClock(new CachedEpochClock())
            .cachedNanoClock(nanoClock)
            .senderCachedNanoClock(nanoClock)
            .receiverCachedNanoClock(nanoClock)
            .controlTransportPoller(mockTransportPoller)
            .systemCounters(mockSystemCounters)
            .senderCommandQueue(senderCommandQueue)
            .nanoClock(nanoClock)
            .errorHandler(errorHandler)
            .senderDutyCycleTracker(new DutyCycleTracker());
        sender = new Sender(ctx);

        LogBufferDescriptor.initialiseTailWithTermId(rawLog.metaData(), 0, INITIAL_TERM_ID);

        const params = new PublicationParams();
        params.entityTag = 101;
        params.mtuLength = MAX_FRAME_LENGTH;
        params.lingerTimeoutNs = Configuration.publicationLingerTimeoutNs();
        params.signalEos = true;

        publication = new NetworkPublication(
            1,
            ctx,
            params,
            mockSendChannelEndpoint,
            rawLog,
            Configuration.producerWindowLength(TERM_BUFFER_LENGTH, Configuration.publicationTermWindowLength()),
            new AtomicLongPosition(),
            new AtomicLongPosition(),
            new AtomicLongPosition(),
            new AtomicLongPosition(),
            mock(AtomicCounter).mock,
            mock(AtomicCounter).mock,
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            flowControl,
            mockRetransmitHandler,
            new NetworkPublicationThreadLocals(),
            false,
        );

        expect(senderCommandQueue.offer(() => sender.onNewNetworkPublication(publication))).toBe(true);
    });

    afterEach(() => {
        sender.onClose();
    });

    it('shouldSendSetupFrameOnChannelWhenTimeoutWithoutStatusMessage', () => {
        sender.doWork();
        expect(receivedFrames.length).toBe(1);
        nanoClock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS - 1);
        sender.doWork();
        expect(receivedFrames.length).toBe(1);

        nanoClock.advance(10);
        sender.doWork();
        expect(receivedFrames.length).toBe(2);

        setupHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(setupHeader.frameLength()).toBe(SetupFlyweight.HEADER_LENGTH);
        expect(setupHeader.initialTermId()).toBe(INITIAL_TERM_ID);
        expect(setupHeader.activeTermId()).toBe(INITIAL_TERM_ID);
        expect(setupHeader.streamId()).toBe(STREAM_ID);
        expect(setupHeader.sessionId()).toBe(SESSION_ID);
        expect(setupHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SETUP);
        expect(setupHeader.flags()).toBe(0);
        expect(setupHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);
    });

    it('shouldSendMultipleSetupFramesOnChannelWhenTimeoutWithoutStatusMessage', () => {
        sender.doWork();
        expect(receivedFrames.length).toBe(1);

        nanoClock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS - 1);
        sender.doWork();

        nanoClock.advance(10);
        sender.doWork();

        expect(receivedFrames.length).toBe(2);
    });

    it('shouldNotSendSetupFrameOnlyOnceAfterReceivingStatusMessage', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, 0);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);
        sender.doWork();

        expect(receivedFrames.length).toBe(1);
        dataHeader.wrap(removeFrame());
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA); // heartbeat
        expect(dataHeader.frameLength()).toBe(0);

        nanoClock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS + 10);
        sender.doWork();

        expect(receivedFrames.length).toBe(1);
        dataHeader.wrap(removeFrame());
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA); // heartbeat
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(1));
    });

    it('shouldSendSetupFrameAfterReceivingStatusMessageWithSetupBit', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        sender.doWork();

        expect(receivedFrames.length).toBe(1); // setup frame
        removeFrame();

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);
        sender.doWork();

        expect(receivedFrames.length).toBe(1); // data
        removeFrame();

        publication.triggerSendSetupFrame(msg, rcvAddress);

        sender.doWork();
        expect(receivedFrames.length).toBe(0); // setup has been sent already, have to wait

        nanoClock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS + 10);
        sender.doWork();

        expect(receivedFrames.length).toBe(2);

        setupHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(setupHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SETUP);
        dataHeader.wrap(removeFrame());
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.frameLength()).toBe(0);
    });

    it('shouldSendHeartbeatsEvenIfSendingPeriodicSetupFrames', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        sender.doWork();

        expect(receivedFrames.length).toBe(1); // heartbeat
        removeFrame();

        publication.triggerSendSetupFrame(msg, rcvAddress);
        nanoClock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS + 10);
        sender.doWork();

        expect(receivedFrames.length).toBe(2);

        setupHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(setupHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SETUP);
        dataHeader.wrap(removeFrame());
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA); // heartbeat is sent after setup
        expect(dataHeader.frameLength()).toBe(0);
    });

    it('shouldBeAbleToSendOnChannel', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);
        sender.doWork();

        expect(receivedFrames.length).toBe(1);

        dataHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(dataHeader.frameLength()).toBe(FRAME_LENGTH);
        expect(dataHeader.termId()).toBe(INITIAL_TERM_ID);
        expect(dataHeader.streamId()).toBe(STREAM_ID);
        expect(dataHeader.sessionId()).toBe(SESSION_ID);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(1));
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(dataHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);
    });

    it('shouldBeAbleToSendOnChannelTwice', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, 2 * ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);

        const offset = appendUnfragmentedMessage(
            rawLog,
            0,
            INITIAL_TERM_ID,
            0,
            headerWriter,
            buffer,
            0,
            PAYLOAD.length,
        );

        sender.doWork();

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, offset, headerWriter, buffer, 0, PAYLOAD.length);

        sender.doWork();

        expect(receivedFrames.length).toBe(2);

        dataHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(dataHeader.frameLength()).toBe(FRAME_LENGTH);
        expect(dataHeader.termId()).toBe(INITIAL_TERM_ID);
        expect(dataHeader.streamId()).toBe(STREAM_ID);
        expect(dataHeader.sessionId()).toBe(SESSION_ID);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(1));
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(dataHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);

        dataHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(dataHeader.frameLength()).toBe(FRAME_LENGTH);
        expect(dataHeader.termId()).toBe(INITIAL_TERM_ID);
        expect(dataHeader.streamId()).toBe(STREAM_ID);
        expect(dataHeader.sessionId()).toBe(SESSION_ID);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(2));
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(dataHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);
    });

    it('shouldNotSendUntilStatusMessageReceived', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);
        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);

        sender.doWork();
        expect(receivedFrames.length).toBe(1);
        setupHeader.wrap(removeFrame());
        expect(setupHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SETUP);

        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);
        sender.doWork();

        expect(receivedFrames.length).toBe(1);

        dataHeader.wrap(new UnsafeBuffer(removeFrame()));

        expect(dataHeader.frameLength()).toBe(FRAME_LENGTH);
        expect(dataHeader.termId()).toBe(INITIAL_TERM_ID);
        expect(dataHeader.streamId()).toBe(STREAM_ID);
        expect(dataHeader.sessionId()).toBe(SESSION_ID);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(1));
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(dataHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);
    });

    it('shouldNotBeAbleToSendAfterUsingUpYourWindow', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);
        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);

        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        sender.doWork();

        expect(receivedFrames.length).toBe(1);

        dataHeader.wrap(new UnsafeBuffer(removeFrame()));
        expect(dataHeader.frameLength()).toBe(FRAME_LENGTH);
        expect(dataHeader.termId()).toBe(INITIAL_TERM_ID);
        expect(dataHeader.streamId()).toBe(STREAM_ID);
        expect(dataHeader.sessionId()).toBe(SESSION_ID);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(1));
        expect(dataHeader.headerType()).toBe(HeaderFlyweight.HDR_TYPE_DATA);
        expect(dataHeader.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(dataHeader.version()).toBe(HeaderFlyweight.CURRENT_VERSION);

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);

        sender.doWork();

        expect(receivedFrames.length).toBe(0);
    });

    it('shouldSendLastDataFrameAsHeartbeatWhenIdle', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);

        sender.doWork();

        expect(receivedFrames.length).toBe(1); // should send ticks
        removeFrame(); // skip data frame

        nanoClock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS - 1);
        sender.doWork();

        expect(receivedFrames.length).toBe(0); // should not send yet
        nanoClock.advance(10);
        sender.doWork();

        expect(receivedFrames.length).toBeGreaterThanOrEqual(1); // should send ticks

        dataHeader.wrap(removeFrame());
        expect(dataHeader.frameLength()).toBe(0);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(2));
    });

    it('shouldSendMultipleDataFramesAsHeartbeatsWhenIdle', () => {
        const msg = mockStatusMessage(INITIAL_TERM_ID, 0, ALIGNED_FRAME_LENGTH);

        publication.onStatusMessage(msg, rcvAddress, mockDriverConductorProxy);

        const buffer = new UnsafeBuffer(new ArrayBuffer(PAYLOAD.length));
        buffer.putBytes(0, PAYLOAD);

        appendUnfragmentedMessage(rawLog, 0, INITIAL_TERM_ID, 0, headerWriter, buffer, 0, PAYLOAD.length);

        expect(sender.doWork()).not.toBe(0);

        expect(receivedFrames.length).toBe(1); // should send ticks
        removeFrame(); // skip data (heartbeat) frame

        nanoClock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS - 1);
        expect(sender.doWork()).toBe(0);
        expect(receivedFrames.length).toBe(0); // should not send yet

        nanoClock.advance(10);
        expect(sender.doWork()).not.toBe(0);
        expect(receivedFrames.length).toBeGreaterThanOrEqual(1); // should send ticks

        dataHeader.wrap(removeFrame());
        expect(dataHeader.frameLength()).toBe(0);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(2));

        nanoClock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS - 1);
        expect(sender.doWork()).toBe(0);
        expect(receivedFrames.length).toBe(0); // should not send yet

        nanoClock.advance(10);
        expect(sender.doWork()).not.toBe(0);
        expect(receivedFrames.length).toBeGreaterThanOrEqual(1); // should send ticks

        dataHeader.wrap(removeFrame());
        expect(dataHeader.frameLength()).toBe(0);
        expect(dataHeader.termOffset()).toBe(offsetOfMessage(2));
    });

    function offsetOfMessage(offset: number): number {
        return (offset - 1) * align(HEADER.capacity() + PAYLOAD.length, FRAME_ALIGNMENT);
    }

    function appendUnfragmentedMessage(
        rawLog: { termBuffers(): UnsafeBuffer[]; metaData(): UnsafeBuffer },
        partitionIndex: number,
        termId: number,
        termOffset: number,
        header: HeaderWriter,
        srcBuffer: DirectBuffer,
        srcOffset: number,
        length: number,
    ): number {
        const termBuffer = rawLog.termBuffers()[partitionIndex] as UnsafeBuffer;
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const resultingOffset = termOffset + alignedLength;
        const rawTail = LogBufferDescriptor.packTail(termId, resultingOffset);

        LogBufferDescriptor.rawTail(rawLog.metaData(), partitionIndex, rawTail);

        header.write(termBuffer, termOffset, frameLength, termId);
        termBuffer.putBytes(termOffset + HEADER_LENGTH, srcBuffer, srcOffset, length);

        frameLengthOrdered(termBuffer, termOffset, frameLength);

        return resultingOffset;
    }
});
