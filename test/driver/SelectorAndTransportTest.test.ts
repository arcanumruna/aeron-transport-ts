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
// Port of io/aeron/driver/SelectorAndTransportTest.java @ 1.53.3
import dgram from 'node:dgram';
import type { Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../src/driver/media/DataTransportPoller.js';
import type { DataPacketDispatcher } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import type { DriverConductorProxy, NetworkPublication } from '../../src/driver/media/SendChannelEndpoint.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import type { UdpTransportPoller } from '../../src/driver/media/UdpTransportPoller.js';
import { WildcardPortManager } from '../../src/driver/media/WildcardPortManager.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { type Fake, mock } from '../support/Mockito.js';
import { waitUntil } from '../support/Udp.js';

const RCV_PORT = 40123;
const SRC_PORT = 40124;
const SESSION_ID = 0xdeadbeef | 0;
const STREAM_ID = 0x44332211;
const TERM_ID = 0x99887766 | 0;
const FRAME_LENGTH = 32;
const TERM_LENGTH = 64 * 1024;

const SRC_DST = UdpChannel.parse('aeron:udp?interface=localhost:' + SRC_PORT + '|endpoint=localhost:' + RCV_PORT);
const RCV_DST = UdpChannel.parse('aeron:udp?endpoint=localhost:' + RCV_PORT);

describe('SelectorAndTransportTest', () => {
    // The Java test spins until a datagram has arrived. Here a datagram arrives as an event, so the loops that wait
    // for one yield to the event loop between polls (`waitUntil`), and fail at a hard cap rather than hang.
    const buffer = new UnsafeBuffer(new Uint8Array(256));

    const encodeDataHeader = new DataHeaderFlyweight();
    const statusMessage = new StatusMessageFlyweight();

    const rcvRemoteAddress = new InetSocketAddress('localhost', SRC_PORT);

    const mockSystemCounters = mock(SystemCounters).mock;
    const mockStatusMessagesReceivedCounter = mock(AtomicCounter).mock;
    const mockSendStatusIndicator = mock(AtomicCounter).mock;
    const mockReceiveStatusIndicator = mock(AtomicCounter).mock;

    // mock(DataPacketDispatcher.class): the placeholder type of ReceiveChannelEndpoint.ts (T14 ports the class)
    const mockDispatcher: Fake<DataPacketDispatcher> = {
        onDataPacket: vi.fn<DataPacketDispatcher['onDataPacket']>(),
        onSetupMessage: vi.fn<DataPacketDispatcher['onSetupMessage']>(),
        onRttMeasurement: vi.fn<DataPacketDispatcher['onRttMeasurement']>(),
    };
    // mock(NetworkPublication.class): the placeholder type of SendChannelEndpoint.ts (T15 ports the class)
    const mockPublication: Fake<NetworkPublication> = {
        sessionId: vi.fn<NetworkPublication['sessionId']>(),
        streamId: vi.fn<NetworkPublication['streamId']>(),
        termBufferLength: vi.fn<NetworkPublication['termBufferLength']>(),
        isValidStatusMessage: vi.fn<NetworkPublication['isValidStatusMessage']>(),
        timeOfLastStatusMessageNs: vi.fn<NetworkPublication['timeOfLastStatusMessageNs']>(),
        triggerSendSetupFrame: vi.fn<NetworkPublication['triggerSendSetupFrame']>(),
        onStatusMessage: vi.fn<NetworkPublication['onStatusMessage']>(),
        onError: vi.fn<NetworkPublication['onError']>(),
        onNak: vi.fn<NetworkPublication['onNak']>(),
        onRttMeasurement: vi.fn<NetworkPublication['onRttMeasurement']>(),
        responseCorrelationId: vi.fn<NetworkPublication['responseCorrelationId']>(),
    };
    // mock(DriverConductorProxy.class): the placeholder type of SendChannelEndpoint.ts (T17 ports the class)
    const mockDriverConductorProxy: Fake<DriverConductorProxy> = {
        reResolveEndpoint: vi.fn<DriverConductorProxy['reResolveEndpoint']>(),
        reResolveControl: vi.fn<DriverConductorProxy['reResolveControl']>(),
        responseSetup: vi.fn<DriverConductorProxy['responseSetup']>(),
        createPublicationImage: vi.fn<DriverConductorProxy['createPublicationImage']>(),
    };
    const errorHandler: ErrorHandler = { onError: vi.fn<ErrorHandler['onError']>() };

    const dataTransportPoller = new DataTransportPoller(errorHandler);
    const controlTransportPoller = new ControlTransportPoller(errorHandler, mockDriverConductorProxy);
    let sendChannelEndpoint: SendChannelEndpoint | null = null;
    let receiveChannelEndpoint: ReceiveChannelEndpoint | null = null;

    const nanoClock = new CachedNanoClock();
    const context = new MediaDriver.Context()
        .systemCounters(mockSystemCounters)
        .cachedNanoClock(nanoClock)
        .senderCachedNanoClock(nanoClock)
        .receiverCachedNanoClock(nanoClock)
        .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
        .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
        .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));

    beforeEach(() => {
        sendChannelEndpoint = null;
        receiveChannelEndpoint = null;
        for (const spy of Object.values(mockDispatcher)) {
            spy.mockReset();
        }
        for (const spy of Object.values(mockPublication)) {
            spy.mockReset();
        }
        for (const counter of [
            mockStatusMessagesReceivedCounter,
            mockSendStatusIndicator,
            mockReceiveStatusIndicator,
        ]) {
            for (const value of Object.values(counter)) {
                vi.mocked(value as () => void).mockClear();
            }
        }
        vi.mocked(mockSystemCounters.get).mockReset();
        vi.mocked(mockSystemCounters.get).mockReturnValue(mockStatusMessagesReceivedCounter);
        mockPublication.streamId.mockReturnValue(STREAM_ID);
        mockPublication.sessionId.mockReturnValue(SESSION_ID);
        mockPublication.termBufferLength.mockReturnValue(TERM_LENGTH);
        mockPublication.isValidStatusMessage.mockReturnValue(true);
    });

    afterEach(() => {
        if (null !== sendChannelEndpoint) {
            sendChannelEndpoint.close();
            processLoop(controlTransportPoller, 5);
        }

        if (null !== receiveChannelEndpoint) {
            receiveChannelEndpoint.close();
            processLoop(dataTransportPoller, 5);
        }

        dataTransportPoller.close();
        controlTransportPoller.close();
        vi.restoreAllMocks();
    });

    it('shouldHandleBasicSetupAndTearDown', () => {
        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            RCV_DST,
            mockDispatcher,
            mockReceiveStatusIndicator,
            context,
        );
        sendChannelEndpoint = new SendChannelEndpoint(SRC_DST, mockSendStatusIndicator, context);

        receiveChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);
        dataTransportPoller.registerForRead(receiveChannelEndpoint, receiveChannelEndpoint, 0);
        sendChannelEndpoint.openDatagramChannel(mockSendStatusIndicator);
        controlTransportPoller.registerForRead(sendChannelEndpoint);

        processLoop(dataTransportPoller, 5);
    });

    /**
     * `Mockito.mockStatic(DatagramChannel.class)` with a `spy` of the channel that `DatagramChannel.open` returns: the
     * sockets that `dgram.createSocket` creates, recorded so that the calls that set the buffer sizes can be verified.
     */
    function spyOnSockets(): Socket[] {
        const sockets: Socket[] = [];
        const createSocket = dgram.createSocket.bind(dgram) as (options: dgram.SocketOptions) => Socket;
        vi.spyOn(dgram, 'createSocket').mockImplementation(((options: dgram.SocketOptions) => {
            const socket = createSocket(options);
            vi.spyOn(socket, 'setSendBufferSize');
            vi.spyOn(socket, 'setRecvBufferSize');
            sockets.push(socket);
            return socket;
        }) as typeof dgram.createSocket);
        return sockets;
    }

    it('shouldSetSocketBufferSizesFromUdpChannelForReceiveChannel', () => {
        const channel = UdpChannel.parse('aeron:udp?endpoint=localhost:' + RCV_PORT + '|so-sndbuf=8k|so-rcvbuf=4k');
        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            channel,
            mockDispatcher,
            mockReceiveStatusIndicator,
            context,
        );

        const sockets = spyOnSockets();
        receiveChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);

        expect(sockets).toHaveLength(1);
        const spyChannel = sockets[0] as Socket;
        expect(spyChannel.setSendBufferSize).toHaveBeenCalledTimes(1);
        expect(spyChannel.setSendBufferSize).toHaveBeenCalledWith(8192);
        expect(spyChannel.setRecvBufferSize).toHaveBeenCalledTimes(1);
        expect(spyChannel.setRecvBufferSize).toHaveBeenCalledWith(4096);
    });

    it('shouldSetSocketBufferSizesFromUdpChannelForSendChannel', () => {
        const channel = UdpChannel.parse('aeron:udp?endpoint=localhost:' + RCV_PORT + '|so-sndbuf=8k|so-rcvbuf=4k');
        sendChannelEndpoint = new SendChannelEndpoint(channel, mockReceiveStatusIndicator, context);

        const sockets = spyOnSockets();
        sendChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);

        expect(sockets).toHaveLength(1);
        const spyChannel = sockets[0] as Socket;
        expect(spyChannel.setSendBufferSize).toHaveBeenCalledTimes(1);
        expect(spyChannel.setSendBufferSize).toHaveBeenCalledWith(8192);
        expect(spyChannel.setRecvBufferSize).toHaveBeenCalledTimes(1);
        expect(spyChannel.setRecvBufferSize).toHaveBeenCalledWith(4096);
    });

    it('shouldSendEmptyDataFrameUnicastFromSourceToReceiver', async () => {
        let dataHeadersReceived = 0;

        mockDispatcher.onDataPacket.mockImplementation(() => {
            dataHeadersReceived++;
            return 0;
        });

        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            RCV_DST,
            mockDispatcher,
            mockReceiveStatusIndicator,
            context,
        );
        sendChannelEndpoint = new SendChannelEndpoint(SRC_DST, mockSendStatusIndicator, context);

        receiveChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);
        dataTransportPoller.registerForRead(receiveChannelEndpoint, receiveChannelEndpoint, 0);
        sendChannelEndpoint.openDatagramChannel(mockSendStatusIndicator);
        controlTransportPoller.registerForRead(sendChannelEndpoint);

        encodeDataHeader.wrap(buffer);
        encodeDataHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(FRAME_LENGTH);
        encodeDataHeader.sessionId(SESSION_ID).streamId(STREAM_ID).termId(TERM_ID).termOffset(0);

        processLoop(dataTransportPoller, 5);
        sendChannelEndpoint.send(buffer, 0, FRAME_LENGTH);
        await waitUntil(() => {
            processLoop(dataTransportPoller, 1);
            return dataHeadersReceived >= 1;
        }, 'the data frame at the receiver');

        expect(dataHeadersReceived).toBe(1);
    });

    it('shouldSendMultipleDataFramesPerDatagramUnicastFromSourceToReceiver', async () => {
        let dataHeadersReceived = 0;

        mockDispatcher.onDataPacket.mockImplementation(() => {
            dataHeadersReceived++;
            return 0;
        });

        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            RCV_DST,
            mockDispatcher,
            mockReceiveStatusIndicator,
            context,
        );
        sendChannelEndpoint = new SendChannelEndpoint(SRC_DST, mockSendStatusIndicator, context);

        receiveChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);
        dataTransportPoller.registerForRead(receiveChannelEndpoint, receiveChannelEndpoint, 0);
        sendChannelEndpoint.openDatagramChannel(mockSendStatusIndicator);
        controlTransportPoller.registerForRead(sendChannelEndpoint);

        encodeDataHeader.wrap(buffer);
        encodeDataHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(FRAME_LENGTH);
        encodeDataHeader.sessionId(SESSION_ID).streamId(STREAM_ID).termId(TERM_ID);

        const alignedFrameLength = BitUtil.align(FRAME_LENGTH, FrameDescriptor.FRAME_ALIGNMENT);
        encodeDataHeader.wrap(buffer, alignedFrameLength, buffer.capacity() - alignedFrameLength);
        encodeDataHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(24);
        encodeDataHeader.sessionId(SESSION_ID).streamId(STREAM_ID).termId(TERM_ID);

        processLoop(dataTransportPoller, 5);
        sendChannelEndpoint.send(buffer, 0, 2 * alignedFrameLength);
        await waitUntil(() => {
            processLoop(dataTransportPoller, 1);
            return dataHeadersReceived >= 1;
        }, 'the data frames at the receiver');

        expect(dataHeadersReceived).toBe(1);
    });

    it('shouldHandleSmFrameFromReceiverToSender', async () => {
        let controlMessagesReceived = 0;

        mockPublication.onStatusMessage.mockImplementation(() => {
            controlMessagesReceived++;
        });

        receiveChannelEndpoint = new ReceiveChannelEndpoint(
            RCV_DST,
            mockDispatcher,
            mockReceiveStatusIndicator,
            context,
        );
        sendChannelEndpoint = new SendChannelEndpoint(SRC_DST, mockSendStatusIndicator, context);
        sendChannelEndpoint.registerForSend(mockPublication);

        receiveChannelEndpoint.openDatagramChannel(mockReceiveStatusIndicator);
        dataTransportPoller.registerForRead(receiveChannelEndpoint, receiveChannelEndpoint, 0);
        sendChannelEndpoint.openDatagramChannel(mockSendStatusIndicator);
        controlTransportPoller.registerForRead(sendChannelEndpoint);

        statusMessage.wrap(buffer);
        statusMessage
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .consumptionTermId(TERM_ID)
            .receiverWindowLength(1000)
            .consumptionTermOffset(0)
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(0)
            .headerType(HeaderFlyweight.HDR_TYPE_SM)
            .frameLength(StatusMessageFlyweight.HEADER_LENGTH);

        processLoop(dataTransportPoller, 5);
        receiveChannelEndpoint.sendTo(buffer, 0, statusMessage.frameLength(), rcvRemoteAddress);

        await waitUntil(() => {
            processLoop(controlTransportPoller, 1);
            return controlMessagesReceived >= 1;
        }, 'the status message at the sender');

        expect(vi.mocked(mockStatusMessagesReceivedCounter.incrementRelease)).toHaveBeenCalledTimes(1);
    });

    function processLoop(transportPoller: UdpTransportPoller, iterations: number): void {
        for (let i = 0; i < iterations; i++) {
            transportPoller.pollTransports();
        }
    }
});
