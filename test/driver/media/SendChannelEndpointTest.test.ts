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
// Port of io/aeron/driver/media/SendChannelEndpointTest.java @ 1.53.3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import type { EpochNanoClock } from '../../../src/agrona/concurrent/EpochNanoClock.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { CloseHelper } from '../../../src/agrona/CloseHelper.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';
import { NakFlyweight } from '../../../src/client/protocol/NakFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ReceiveChannelEndpointThreadLocals } from '../../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import {
    asNetworkPublication,
    type EndpointPublication as NetworkPublication,
} from '../../support/PublicationFakes.js';
import { DynamicSndMultiDestination, SendChannelEndpoint } from '../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../../src/driver/media/WildcardPortManager.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { newFakeConductorProxy, type FakeConductorProxy } from '../../support/ConductorProxyFake.js';
import { type Fake, calledMembers, lastCallOrder, mock } from '../../support/Mockito.js';

const { LITTLE_ENDIAN } = ByteOrder;
const { DESTINATION_TIMEOUT } = SendChannelEndpoint;
const SIZE_OF_LONG = 8;

/** `mock(DriverConductorProxy.class)`: a fake whose members record their calls. */
function mockConductorProxy(): FakeConductorProxy {
    return newFakeConductorProxy();
}

/** `mock(NetworkPublication.class)`: a fake whose members record their calls and answer what a mock answers. */
function mockPublication(): Fake<NetworkPublication> {
    return {
        sessionId: vi.fn<NetworkPublication['sessionId']>(() => 0),
        streamId: vi.fn<NetworkPublication['streamId']>(() => 0),
        termBufferLength: vi.fn<NetworkPublication['termBufferLength']>(() => 0),
        isValidStatusMessage: vi.fn<NetworkPublication['isValidStatusMessage']>(() => false),
        timeOfLastStatusMessageNs: vi.fn<NetworkPublication['timeOfLastStatusMessageNs']>(() => 0),
        triggerSendSetupFrame: vi.fn<NetworkPublication['triggerSendSetupFrame']>(),
        onStatusMessage: vi.fn<NetworkPublication['onStatusMessage']>(),
        onError: vi.fn<NetworkPublication['onError']>(),
        onNak: vi.fn<NetworkPublication['onNak']>(),
        onRttMeasurement: vi.fn<NetworkPublication['onRttMeasurement']>(),
        responseCorrelationId: vi.fn<NetworkPublication['responseCorrelationId']>(() => -1),
    };
}

/** The `invocationCallOrder` of the first call to a mock function. */
function orderOf(fn: unknown): number {
    return vi.mocked(fn as () => void).mock.invocationCallOrder[0] as number;
}

describe('SendChannelEndpointTest', () => {
    const mockSystemCounters = mock(SystemCounters).mock;
    const mockStatusIndicator = mock(AtomicCounter).mock;
    const mockConductorProxyFake = mockConductorProxy();
    const nanoClock = new CachedNanoClock();
    const systemCounters: AtomicCounter[] = [];
    const sendTimestampClock = {
        nanoTime: vi.fn<EpochNanoClock['nanoTime']>(),
        nanoTimeHalves: vi.fn<EpochNanoClock['nanoTimeHalves']>(),
    };
    const header = new DataHeaderFlyweight();

    const context = new MediaDriver.Context()
        .systemCounters(mockSystemCounters)
        .cachedNanoClock(nanoClock)
        .senderCachedNanoClock(nanoClock)
        .receiverCachedNanoClock(nanoClock)
        .channelSendTimestampClock(sendTimestampClock as unknown as EpochNanoClock)
        .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
        .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
        .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));

    let endpoint: SendChannelEndpoint | null = null;

    beforeEach(() => {
        endpoint = null;
        sendTimestampClock.nanoTime.mockReset();
        sendTimestampClock.nanoTimeHalves.mockReset();
        mockConductorProxyFake.reResolveEndpoint.mockClear();
        for (const descriptor of SystemCounterDescriptor.values()) {
            systemCounters[descriptor.id()] = mock(AtomicCounter).mock;
        }
        const get = vi.mocked(mockSystemCounters.get);
        get.mockReset();
        get.mockImplementation(
            (descriptor: SystemCounterDescriptor) => systemCounters[descriptor.id()] as AtomicCounter,
        );
    });

    afterEach(() => {
        CloseHelper.close(endpoint);
    });

    function counter(descriptor: SystemCounterDescriptor): AtomicCounter {
        return mockSystemCounters.get(descriptor);
    }

    it('shouldSkipReResolveForResponseControlMode', () => {
        const responseChannel = UdpChannel.parse(
            'aeron:udp?control-mode=response|control=127.0.0.1:10001|endpoint=127.0.0.1:10002',
        );

        endpoint = new SendChannelEndpoint(responseChannel, mockStatusIndicator, context);

        endpoint.checkForReResolution(DESTINATION_TIMEOUT * 2, mockConductorProxyFake);

        expect(mockConductorProxyFake.reResolveEndpoint).toHaveBeenCalledTimes(0);
    });

    it('shouldReResolveExplicitEndpointAfterTimeout', () => {
        const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:10002');

        endpoint = new SendChannelEndpoint(channel, mockStatusIndicator, context);

        endpoint.checkForReResolution(DESTINATION_TIMEOUT * 2, mockConductorProxyFake);

        expect(mockConductorProxyFake.reResolveEndpoint).toHaveBeenCalledTimes(1);
        const [endpointArg, channelEndpointArg] = mockConductorProxyFake.reResolveEndpoint.mock.calls[0] as unknown[];
        expect(typeof endpointArg).toBe('string');
        expect(channelEndpointArg).toBeInstanceOf(SendChannelEndpoint);
    });

    it('shouldRejectInvalidErrorFrame', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555'),
            mockStatusIndicator,
            context,
        );

        const flyweight = new ErrorFlyweight(new UnsafeBuffer(new Uint8Array(ErrorFlyweight.HEADER_LENGTH)));

        endpoint.onError(
            flyweight,
            flyweight,
            ErrorFlyweight.HEADER_LENGTH,
            mock(InetSocketAddress).mock,
            mockConductorProxyFake,
        );

        const invalidPackets = counter(SystemCounterDescriptor.INVALID_PACKETS);
        const errorFramesReceived = counter(SystemCounterDescriptor.ERROR_FRAMES_RECEIVED);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        // verifyNoMoreInteractions(invalidPackets)
        expect(calledMembers(invalidPackets)).toEqual(['increment']);
        // verifyNoInteractions(errorFramesReceived)
        expect(calledMembers(errorFramesReceived)).toEqual([]);
    });

    it('shouldRejectInvalidNakFrame', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555'),
            mockStatusIndicator,
            context,
        );
        const publication = mockPublication();
        endpoint.registerForSend(asNetworkPublication(publication));

        const flyweight = new NakFlyweight(new UnsafeBuffer(new Uint8Array(NakFlyweight.HEADER_LENGTH)));
        flyweight.termOffset(-1);

        endpoint.onNakMessage(
            flyweight,
            flyweight,
            NakFlyweight.HEADER_LENGTH,
            new InetSocketAddress('192.168.0.10', 2048),
        );

        const invalidPackets = counter(SystemCounterDescriptor.INVALID_PACKETS);
        const nakFramesReceived = counter(SystemCounterDescriptor.NAK_MESSAGES_RECEIVED);
        // inOrder.verify(publication).termBufferLength(); inOrder.verify(invalidPackets).increment();
        expect(publication.termBufferLength).toHaveBeenCalledTimes(1);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        expect(orderOf(publication.termBufferLength)).toBeLessThan(orderOf(invalidPackets.increment));
        // inOrder.verifyNoMoreInteractions()
        expect(lastCallOrder(invalidPackets, nakFramesReceived, publication)).toBe(orderOf(invalidPackets.increment));
        expect(publication.onNak).toHaveBeenCalledTimes(0);
        expect(calledMembers(nakFramesReceived)).toEqual([]);
    });

    it('shouldRejectInvalidStatusMessageFrame', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555'),
            mockStatusIndicator,
            context,
        );
        const publication = mockPublication();
        const termLength = 128 * 1024;
        publication.termBufferLength.mockReturnValue(termLength);
        endpoint.registerForSend(asNetworkPublication(publication));

        const flyweight = new StatusMessageFlyweight(
            new UnsafeBuffer(new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH)),
        );
        flyweight.consumptionTermOffset(termLength + 1).receiverWindowLength(1024);

        endpoint.onStatusMessage(
            flyweight,
            flyweight,
            StatusMessageFlyweight.HEADER_LENGTH,
            mock(InetSocketAddress).mock,
            mockConductorProxyFake,
        );

        const invalidPackets = counter(SystemCounterDescriptor.INVALID_PACKETS);
        const smReceived = counter(SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED);
        expect(publication.termBufferLength).toHaveBeenCalledTimes(1);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        expect(orderOf(publication.termBufferLength)).toBeLessThan(orderOf(invalidPackets.increment));
        expect(lastCallOrder(invalidPackets, smReceived, publication)).toBe(orderOf(invalidPackets.increment));
        expect(calledMembers(smReceived)).toEqual([]);
    });

    it('shouldRejectInvalidStatusMessageFrameEvenWhenThereIsNoPublication', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555'),
            mockStatusIndicator,
            context,
        );

        const flyweight = new StatusMessageFlyweight(
            new UnsafeBuffer(new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH)),
        );
        flyweight.consumptionTermOffset(0).receiverWindowLength(LogBufferDescriptor.TERM_MAX_LENGTH);

        endpoint.onStatusMessage(
            flyweight,
            flyweight,
            StatusMessageFlyweight.HEADER_LENGTH,
            mock(InetSocketAddress).mock,
            mockConductorProxyFake,
        );

        const invalidPackets = counter(SystemCounterDescriptor.INVALID_PACKETS);
        const smReceived = counter(SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        expect(lastCallOrder(invalidPackets, smReceived)).toBe(orderOf(invalidPackets.increment));
    });

    it.each([0, DataHeaderFlyweight.HEADER_LENGTH - 1])(
        'applySendChannelTimestampIsANoOpIfPacketIsShorterThanDataFrame [%d]',
        (packetLength) => {
            endpoint = new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=localhost:5555|channel-snd-ts-offset=0'),
                mockStatusIndicator,
                context,
            );
            const buffer = new UnsafeBuffer(new Uint8Array(10 + packetLength));
            const position = 10;
            expect(buffer.capacity() - position).toBe(packetLength);

            endpoint.applyChannelSendTimestamp(buffer, position, packetLength);

            expect(sendTimestampClock.nanoTime).toHaveBeenCalledTimes(0);
            expect(sendTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(0);
        },
    );

    it.each([-1, 0])('applySendChannelTimestampIsANoOpIfFirstFrameIsEmpty [%d]', (firstFrameLength) => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555|channel-snd-ts-offset=16'),
            mockStatusIndicator,
            context,
        );
        const buffer = new UnsafeBuffer(new Uint8Array(DataHeaderFlyweight.HEADER_LENGTH));
        expect(buffer.capacity()).toBe(DataHeaderFlyweight.HEADER_LENGTH);
        header.wrap(buffer);
        header.frameLength(firstFrameLength);

        endpoint.applyChannelSendTimestamp(buffer, 0, DataHeaderFlyweight.HEADER_LENGTH);

        expect(sendTimestampClock.nanoTime).toHaveBeenCalledTimes(0);
        expect(sendTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(0);
    });

    /** The frames of the two timestamp tests, written at `position` of a 1024 byte buffer. */
    function writeFrames(buffer: UnsafeBuffer, position: number): void {
        // empty data frame
        header.wrap(buffer, position, 32);
        header
            .frameLength(32)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // padding frame
        header.wrap(buffer, position + 32, 32);
        header
            .frameLength(128)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(DataHeaderFlyweight.HDR_TYPE_PAD);

        // start of the fragmented frame
        header.wrap(buffer, position + 160, 32);
        header
            .frameLength(56)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_FLAG)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // continues
        header.wrap(buffer, position + 224, 32);
        header
            .frameLength(100)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(0)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // continues
        header.wrap(buffer, position + 352, 32);
        header
            .frameLength(100)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(0)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // end of fragmented frame
        header.wrap(buffer, position + 480, 32);
        header
            .frameLength(70)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.END_FLAG)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // non-fragmented message
        header.wrap(buffer, position + 576, 32);
        header
            .frameLength(100)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(DataHeaderFlyweight.HDR_TYPE_DATA);

        // padding frame
        header.wrap(buffer, position + 704, 32);
        header
            .frameLength(4096)
            .version(DataHeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(DataHeaderFlyweight.HDR_TYPE_PAD);
    }

    /**
     * `when(sendTimestampClock.nanoTime()).thenReturn(ns).thenThrow(new RuntimeException("second call"))`, for the
     * halves of the addition `nanoTimeHalves` (spec D17): the first call writes the low and high halves of `ns`.
     */
    function stubSendTimestamp(sendTimestampNs: number): void {
        sendTimestampClock.nanoTimeHalves
            .mockImplementationOnce((out: Int32Array) => {
                const high = Math.floor(sendTimestampNs / 4294967296);
                out[0] = (sendTimestampNs - high * 4294967296) | 0;
                out[1] = high | 0;
            })
            .mockImplementation(() => {
                throw new Error('second call');
            });
    }

    it('applySendChannelTimestampsToAllBeginDataFramesWithinAPacketWhenOffsetIsWithinMessageBody', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555|channel-snd-ts-offset=16'),
            mockStatusIndicator,
            context,
        );
        const buffer = new UnsafeBuffer(new Uint8Array(1024));
        const position = 64;
        expect(buffer.capacity() - position).toBe(960);
        const sendTimestampNs = 47239472340932;
        stubSendTimestamp(sendTimestampNs);

        writeFrames(buffer, position);

        endpoint.applyChannelSendTimestamp(buffer, position, buffer.capacity() - position);

        const tsOffset = DataHeaderFlyweight.DATA_OFFSET + 16;

        // padding frame is skipped
        header.wrap(buffer, position + 32, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(0);

        // fragment message start
        header.wrap(buffer, position + 160, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(sendTimestampNs);

        header.wrap(buffer, position + 224, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(0);

        header.wrap(buffer, position + 352, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(0);

        // fragment message end
        header.wrap(buffer, position + 480, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(0);

        // non-fragmented message
        header.wrap(buffer, position + 576, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(sendTimestampNs);

        // last padding frame
        header.wrap(buffer, position + 704, tsOffset + SIZE_OF_LONG);
        expect(header.getLong(tsOffset, LITTLE_ENDIAN)).toBe(0);

        expect(sendTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(1);
        expect(sendTimestampClock.nanoTime).toHaveBeenCalledTimes(0);
    });

    it('applySendChannelTimestampsToAllBeginDataFramesWithinAPacketWhenUsingReservedValue', () => {
        endpoint = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=localhost:5555|channel-snd-ts-offset=reserved'),
            mockStatusIndicator,
            context,
        );
        const buffer = new UnsafeBuffer(new Uint8Array(1024));
        const position = 64;
        expect(buffer.capacity() - position).toBe(960);
        const sendTimestampNs = 12391236812638;
        stubSendTimestamp(sendTimestampNs);

        writeFrames(buffer, position);

        endpoint.applyChannelSendTimestamp(buffer, position, buffer.capacity() - position);

        // empty data frame
        header.wrap(buffer, position, 32);
        expect(header.reservedValue()).toBe(BigInt(sendTimestampNs));

        // padding frame is skipped
        header.wrap(buffer, position + 32, 32);
        expect(header.reservedValue()).toBe(0n);

        // fragment message start
        header.wrap(buffer, position + 160, 32);
        expect(header.reservedValue()).toBe(BigInt(sendTimestampNs));

        header.wrap(buffer, position + 224, 32);
        expect(header.reservedValue()).toBe(0n);

        header.wrap(buffer, position + 352, 32);
        expect(header.reservedValue()).toBe(0n);

        // fragment message end
        header.wrap(buffer, position + 480, 32);
        expect(header.reservedValue()).toBe(0n);

        // non-fragmented message
        header.wrap(buffer, position + 576, 32);
        expect(header.reservedValue()).toBe(BigInt(sendTimestampNs));

        // last padding frame
        header.wrap(buffer, position + 704, 32);
        expect(header.reservedValue()).toBe(0n);

        expect(sendTimestampClock.nanoTimeHalves).toHaveBeenCalledTimes(1);
        expect(sendTimestampClock.nanoTime).toHaveBeenCalledTimes(0);
    });

    it('shouldRemoveOnlyInactiveDestinationsWhenTheLastOneIsAlsoInactive', () => {
        const clock = new CachedNanoClock();
        const errorHandler: ErrorHandler = { onError: vi.fn() };
        const destinations = new DynamicSndMultiDestination(clock, errorHandler);
        destinations.destinationsCounter(mock(AtomicCounter).mock);

        const sm = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH)));
        const one = InetSocketAddress.createUnresolved('localhost', 10001);
        const two = InetSocketAddress.createUnresolved('localhost', 10002);
        const three = InetSocketAddress.createUnresolved('localhost', 10003);

        clock.update(0);
        destinations.onStatusMessage(sm.receiverId(1n), one);
        destinations.onStatusMessage(sm.receiverId(2n), two);
        destinations.onStatusMessage(sm.receiverId(3n), three);
        expect(destinations.destinations.length).toBe(3);

        clock.update(DESTINATION_TIMEOUT);
        destinations.onStatusMessage(sm.receiverId(2n), two);

        // one and three have timed out, two has not
        clock.update(DESTINATION_TIMEOUT * 2);
        destinations.send(null as unknown as SendChannelEndpoint, new UnsafeBuffer(new Uint8Array(64)), 0, 64);

        expect(destinations.destinations.length).toBe(1);
        expect(destinations.destinations[0]?.receiverId()).toBe(2n);
    });
});
