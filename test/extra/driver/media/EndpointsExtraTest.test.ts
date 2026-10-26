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
// Extra tests of T13 (port-only): the send and receive channel endpoints, the two pollers, the thread locals, the
// suppliers and the Context members, beyond Java's 19 tests. Each test names the mutation that turns it red where it is
// not obvious. The interaction-matrix rows for sockets (spec 8.4, plan): close with queued sends, a send error that
// surfaces later (D2), short sends for N cycles, port in use, IPv4 and IPv6 loopback, one datagram per transport per poll.
import type { Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseHelper } from '../../../../src/agrona/CloseHelper.js';
import type { ErrorHandler } from '../../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { CachedNanoClock } from '../../../../src/agrona/concurrent/CachedNanoClock.js';
import type { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { ByteOrder, ClassNotFoundException, IllegalStateException, Integer, Long } from '../../../../src/agrona/jdk.js';
import { System } from '../../../../src/agrona/jdkLang.js';
import { Aeron } from '../../../../src/client/Aeron.js';
import { ChannelUri } from '../../../../src/client/ChannelUri.js';
import { CommonContext } from '../../../../src/client/CommonContext.js';
import { ErrorCode } from '../../../../src/client/ErrorCode.js';
import { AeronEvent } from '../../../../src/client/exceptions/AeronEvent.js';
import { AeronException } from '../../../../src/client/exceptions/AeronException.js';
import { ControlProtocolException } from '../../../../src/client/exceptions/ControlProtocolException.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../../../src/client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { ResponseSetupFlyweight } from '../../../../src/client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { ChannelEndpointStatus } from '../../../../src/client/status/ChannelEndpointStatus.js';
import { Configuration } from '../../../../src/driver/Configuration.js';
import type { DataPacketDispatcher } from '../../../../src/driver/DataPacketDispatcher.js';
import { DefaultReceiveChannelEndpointSupplier } from '../../../../src/driver/DefaultReceiveChannelEndpointSupplier.js';
import { DefaultSendChannelEndpointSupplier } from '../../../../src/driver/DefaultSendChannelEndpointSupplier.js';
import { ClosedChannelException, InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../../../src/driver/media/DataTransportPoller.js';
import { ImageConnection } from '../../../../src/driver/media/ImageConnection.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { ReceiveDestinationTransport } from '../../../../src/driver/media/ReceiveDestinationTransport.js';
import type { NetworkPublication } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { SystemCounterDescriptor } from '../../../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../../../src/driver/status/SystemCounters.js';
import type { DriverConductorProxy } from '../../../../src/driver/DriverConductorProxy.js';
import { newFakeConductorProxy, type FakeConductorProxy } from '../../../support/ConductorProxyFake.js';
import { assertThrows } from '../../../support/Assertions.js';
import { type Fake, calledMembers } from '../../../support/Mockito.js';
import { FakeSocket, freeUdpPort, hasIpv6Loopback, waitUntil } from '../../../support/Udp.js';

const { LITTLE_ENDIAN } = ByteOrder;
const LOOPBACK = '127.0.0.1';

let context: MediaDriver.Context;
let errors: Error[];
let closeables: { close(): void }[];

function countersManager(): CountersManager {
    return context.countersManager() as CountersManager;
}

function systemCounters(): SystemCounters {
    return context.systemCounters() as SystemCounters;
}

function newStatusIndicator(): AtomicCounter {
    return countersManager().newCounter('status');
}

function counterValue(descriptor: SystemCounterDescriptor): number {
    return systemCounters().get(descriptor).get();
}

/** The members of the dispatcher that the endpoints call. */
type DispatcherMembers = Pick<DataPacketDispatcher, 'onDataPacket' | 'onSetupMessage' | 'onRttMeasurement'>;

/** A dispatcher that records what it is called with, and answers what a Mockito mock answers (0). */
function newDispatcher(): Fake<DispatcherMembers> & DataPacketDispatcher {
    return {
        onDataPacket: vi.fn<DataPacketDispatcher['onDataPacket']>(() => 0),
        onSetupMessage: vi.fn<DataPacketDispatcher['onSetupMessage']>(),
        onRttMeasurement: vi.fn<DataPacketDispatcher['onRttMeasurement']>(),
    } as unknown as Fake<DispatcherMembers> & DataPacketDispatcher;
}

/** A publication that records what it is called with. */
function newPublication(sessionId: number, streamId: number, termLength = 64 * 1024): Fake<NetworkPublication> {
    return {
        sessionId: vi.fn<NetworkPublication['sessionId']>(() => sessionId),
        streamId: vi.fn<NetworkPublication['streamId']>(() => streamId),
        termBufferLength: vi.fn<NetworkPublication['termBufferLength']>(() => termLength),
        isValidStatusMessage: vi.fn<NetworkPublication['isValidStatusMessage']>(() => true),
        timeOfLastStatusMessageNs: vi.fn<NetworkPublication['timeOfLastStatusMessageNs']>(() => 0),
        triggerSendSetupFrame: vi.fn<NetworkPublication['triggerSendSetupFrame']>(),
        onStatusMessage: vi.fn<NetworkPublication['onStatusMessage']>(),
        onError: vi.fn<NetworkPublication['onError']>(),
        onNak: vi.fn<NetworkPublication['onNak']>(),
        onRttMeasurement: vi.fn<NetworkPublication['onRttMeasurement']>(),
        responseCorrelationId: vi.fn<NetworkPublication['responseCorrelationId']>(() => Aeron.NULL_VALUE),
    };
}

function newProxy(): FakeConductorProxy {
    return newFakeConductorProxy();
}

function track<T extends { close(): void }>(closeable: T): T {
    closeables.push(closeable);
    return closeable;
}

/** A receive endpoint on an ephemeral loopback port, opened (so that its ring exists), and closed after the test. */
function newReceiveEndpoint(
    uri = 'aeron:udp?endpoint=127.0.0.1:0',
    dispatcher: DataPacketDispatcher = newDispatcher(),
): ReceiveChannelEndpoint {
    const endpoint = track(
        new ReceiveChannelEndpoint(UdpChannel.parse(uri), dispatcher, newStatusIndicator(), context),
    );
    endpoint.openDatagramChannel(null);
    return endpoint;
}

/** A send endpoint, not opened. */
function newSendEndpoint(uri = 'aeron:udp?endpoint=127.0.0.1:40001'): SendChannelEndpoint {
    return track(new SendChannelEndpoint(UdpChannel.parse(uri), newStatusIndicator(), context));
}

/** A send endpoint that is open (so that it is connected) and whose socket is replaced by a fake. */
function newFakeSendEndpoint(uri = 'aeron:udp?endpoint=127.0.0.1:40001'): {
    endpoint: SendChannelEndpoint;
    socket: FakeSocket;
} {
    const endpoint = newSendEndpoint(uri);
    endpoint.openDatagramChannel(null);
    const real = endpoint.sendDatagramChannel as Socket;
    const socket = new FakeSocket();
    endpoint.sendDatagramChannel = socket as unknown as Socket;
    endpoint._receiveDatagramChannel = real;
    return { endpoint, socket };
}

function portOf(socket: Socket | null): number {
    return (socket as Socket).address().port;
}

function rinfo(port = 5000): { address: string; family: 'IPv4'; port: number; size: number } {
    return { address: LOOPBACK, family: 'IPv4', port, size: 0 };
}

function bytesOf(length: number, build: (buffer: UnsafeBuffer) => void): Uint8Array {
    const bytes = new Uint8Array(length);
    build(new UnsafeBuffer(bytes));
    return bytes;
}

function dataFrame(sessionId: number, streamId: number, termId: number, termOffset: number, length = 32): Uint8Array {
    return bytesOf(length, (buffer) => {
        new DataHeaderFlyweight(buffer)
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(length);
        const header = new DataHeaderFlyweight(buffer);
        header.sessionId(sessionId).streamId(streamId).termId(termId).termOffset(termOffset);
    });
}

function setupFrame(sessionId: number, streamId: number): Uint8Array {
    return bytesOf(SetupFlyweight.HEADER_LENGTH, (buffer) => {
        const setup = new SetupFlyweight(buffer);
        setup
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
            .frameLength(SetupFlyweight.HEADER_LENGTH);
        setup
            .sessionId(sessionId)
            .streamId(streamId)
            .termOffset(0)
            .termLength(64 * 1024)
            .mtuLength(1408);
    });
}

function rttFrame(sessionId: number, streamId: number, receiverIdHigh: number, receiverIdLow: number): Uint8Array {
    return bytesOf(RttMeasurementFlyweight.HEADER_LENGTH, (buffer) => {
        const rtt = new RttMeasurementFlyweight(buffer);
        rtt.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
            .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
        rtt.sessionId(sessionId).streamId(streamId).receiverIdHigh(receiverIdHigh).receiverIdLow(receiverIdLow);
    });
}

function smFrame(sessionId: number, streamId: number, flags = 0): Uint8Array {
    return bytesOf(StatusMessageFlyweight.HEADER_LENGTH, (buffer) => {
        const sm = new StatusMessageFlyweight(buffer);
        sm.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SM)
            .frameLength(StatusMessageFlyweight.HEADER_LENGTH);
        sm.sessionId(sessionId)
            .streamId(streamId)
            .consumptionTermId(5)
            .consumptionTermOffset(0)
            .receiverWindowLength(1000)
            .flags(flags);
    });
}

function nakFrame(sessionId: number, streamId: number, termOffset = 0): Uint8Array {
    return bytesOf(NakFlyweight.HEADER_LENGTH, (buffer) => {
        const nak = new NakFlyweight(buffer);
        nak.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_NAK)
            .frameLength(NakFlyweight.HEADER_LENGTH);
        nak.sessionId(sessionId).streamId(streamId).termId(5).termOffset(termOffset).length(64);
    });
}

function errorFrame(sessionId: number, streamId: number): Uint8Array {
    return bytesOf(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH, (buffer) => {
        const error = new ErrorFlyweight(buffer);
        error
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_ERR)
            .frameLength(ErrorFlyweight.HEADER_LENGTH);
        error
            .sessionId(sessionId)
            .streamId(streamId)
            .receiverIdHigh(0)
            .receiverIdLow(9)
            .errorCode(1)
            .errorMessage('bad');
    });
}

function responseSetupFrame(sessionId: number, streamId: number, responseSessionId: number): Uint8Array {
    return bytesOf(ResponseSetupFlyweight.HEADER_LENGTH, (buffer) => {
        const setup = new ResponseSetupFlyweight(buffer);
        setup
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RSP_SETUP)
            .frameLength(ResponseSetupFlyweight.HEADER_LENGTH);
        setup.sessionId(sessionId).streamId(streamId).responseSessionId(responseSessionId);
    });
}

/** What the fake socket was given, as a flyweight-readable buffer. */
function sentBytes(socket: FakeSocket, index: number): UnsafeBuffer {
    const sent = socket.sent[index] as FakeSocket['sent'][number];
    return new UnsafeBuffer(Uint8Array.from(sent.bytesAtSend));
}

beforeEach(() => {
    errors = [];
    closeables = [];
    const handler: ErrorHandler = { onError: (e) => errors.push(e) };
    context = new MediaDriver.Context().errorHandler(handler).conclude();
});

afterEach(() => {
    for (const closeable of closeables) {
        closeable.close();
    }
    context.close();
});

describe('ReceiveChannelEndpointThreadLocals', () => {
    it('hands out frames that are set up for their type, in buffers that do not overlap', () => {
        const locals = new ReceiveChannelEndpointThreadLocals();

        const sm = locals.statusMessageFlyweight();
        expect(sm.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SM);
        expect(sm.frameLength()).toBe(StatusMessageFlyweight.HEADER_LENGTH);
        expect(locals.statusMessageBuffer().capacity()).toBe(StatusMessageFlyweight.HEADER_LENGTH + 8);
        const nak = locals.nakFlyweight();
        expect(nak.headerType()).toBe(HeaderFlyweight.HDR_TYPE_NAK);
        expect(nak.frameLength()).toBe(NakFlyweight.HEADER_LENGTH);
        const rtt = locals.rttMeasurementFlyweight();
        expect(rtt.headerType()).toBe(HeaderFlyweight.HDR_TYPE_RTTM);
        expect(rtt.frameLength()).toBe(RttMeasurementFlyweight.HEADER_LENGTH);
        const responseSetup = locals.responseSetupHeader();
        expect(responseSetup.headerType()).toBe(HeaderFlyweight.HDR_TYPE_RSP_SETUP);
        expect(responseSetup.frameLength()).toBe(ResponseSetupFlyweight.HEADER_LENGTH);
        const error = locals.errorFlyweight();
        expect(error.headerType()).toBe(HeaderFlyweight.HDR_TYPE_ERR);
        expect(error.frameLength()).toBe(ErrorFlyweight.HEADER_LENGTH);
        expect(locals.errorBuffer().capacity()).toBe(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH);

        // a write to the largest part of one buffer reaches no other (mutation: overlapping offsets)
        const buffers = [
            locals.statusMessageBuffer(),
            locals.nakBuffer(),
            locals.rttMeasurementBuffer(),
            locals.responseSetupBuffer(),
            locals.errorBuffer(),
        ];
        const before = buffers.map((b) => Array.from({ length: b.capacity() }, (_, i) => b.getByte(i)));
        for (let which = 0; which < buffers.length; which++) {
            const target = buffers[which] as UnsafeBuffer;
            for (let i = 0; i < target.capacity(); i++) {
                target.putByte(i, 0x5a);
            }
            buffers.forEach((other, index) => {
                if (index !== which) {
                    expect(Array.from({ length: other.capacity() }, (_, i) => other.getByte(i))).toEqual(before[index]);
                }
            });
            for (let i = 0; i < target.capacity(); i++) {
                target.putByte(i, before[which]?.[i] as number);
            }
        }
    });

    it('hands out consecutive receiver ids from a random start', () => {
        const locals = new ReceiveChannelEndpointThreadLocals();
        const first = locals.nextReceiverId();
        expect(typeof first).toBe('bigint');
        expect(BigInt.asIntN(64, first)).toBe(first);
        expect(locals.nextReceiverId()).toBe(BigInt.asIntN(64, first + 1n));
        expect(locals.nextReceiverId()).toBe(BigInt.asIntN(64, first + 2n));
        expect(locals.toString()).toBe(
            'ReceiveChannelEndpointThreadLocals{nextReceiverId=' + BigInt.asIntN(64, first + 3n) + '}',
        );
        expect(new ReceiveChannelEndpointThreadLocals().nextReceiverId()).not.toBe(first);
    });
});

describe('ImageConnection', () => {
    it('starts at the end of the stream position of Long.MAX_VALUE, with the time and address it was given', () => {
        const address = new InetSocketAddress(LOOPBACK, 1234);
        const connection = new ImageConnection(77, address);
        expect(connection.timeOfLastActivityNs).toBe(77);
        expect(connection.timeOfLastFrameNs).toBe(0);
        expect(connection.eosPosition).toBe(Long.MAX_VALUE);
        expect(connection.isEos).toBe(false);
        expect(connection.controlAddress).toBe(address);
    });
});

describe('SendChannelEndpoint', () => {
    it('keys its publications by the halves of (sessionId, streamId): ids of any sign and size find their own publication', () => {
        const endpoint = newSendEndpoint();
        const proxy = newProxy();
        const ids: [number, number][] = [
            [Integer.MIN_VALUE, Integer.MAX_VALUE],
            [Integer.MAX_VALUE, Integer.MIN_VALUE],
            [-1, 0],
            [0, -1],
            [0xdeadbeef | 0, 0x44332211],
            [1 << 21, 5],
            [5, 1 << 21],
        ];
        const publications = ids.map(([sessionId, streamId]) => newPublication(sessionId, streamId));
        publications.forEach((publication) => endpoint.registerForSend(publication));

        ids.forEach(([sessionId, streamId], i) => {
            const frame = smFrame(sessionId, streamId);
            const sm = new StatusMessageFlyweight(new UnsafeBuffer(frame));
            endpoint.onStatusMessage(sm, sm, frame.length, new InetSocketAddress(LOOPBACK, 4000), proxy);
            publications.forEach((publication, j) => {
                expect(publication.onStatusMessage, 'publication ' + j + ' for ids ' + i).toHaveBeenCalledTimes(
                    j === i ? 1 : 0,
                );
            });
            publications[i]?.onStatusMessage.mockClear();
        });

        // unregistered: not found any more (mutation: unregisterForSend removes nothing)
        endpoint.unregisterForSend(publications[0] as NetworkPublication);
        const frame = smFrame(Integer.MIN_VALUE, Integer.MAX_VALUE);
        const sm = new StatusMessageFlyweight(new UnsafeBuffer(frame));
        endpoint.onStatusMessage(sm, sm, frame.length, new InetSocketAddress(LOOPBACK, 4000), proxy);
        expect(publications[0]?.onStatusMessage).toHaveBeenCalledTimes(0);
        expect(counterValue(SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED)).toBe(ids.length + 1);
    });

    it('routes a status message by its flags: SEND_SETUP triggers a setup frame, another goes to onStatusMessage, a rejected one is counted', () => {
        const endpoint = newSendEndpoint();
        const proxy = newProxy();
        const publication = newPublication(7, 8);
        endpoint.registerForSend(publication);
        const address = new InetSocketAddress(LOOPBACK, 4000);

        const setupFrame = smFrame(7, 8, StatusMessageFlyweight.SEND_SETUP_FLAG);
        const setup = new StatusMessageFlyweight(new UnsafeBuffer(setupFrame));
        endpoint.onStatusMessage(setup, setup, setupFrame.length, address, proxy);
        expect(publication.triggerSendSetupFrame).toHaveBeenCalledTimes(1);
        expect(publication.triggerSendSetupFrame).toHaveBeenCalledWith(setup, address);
        expect(publication.onStatusMessage).toHaveBeenCalledTimes(0);
        expect(publication.isValidStatusMessage).toHaveBeenCalledTimes(0); // a setup eliciting SM is not bounds checked

        const plainFrame = smFrame(7, 8);
        const plain = new StatusMessageFlyweight(new UnsafeBuffer(plainFrame));
        endpoint.onStatusMessage(plain, plain, plainFrame.length, address, proxy);
        expect(publication.onStatusMessage).toHaveBeenCalledTimes(1);
        expect(publication.onStatusMessage).toHaveBeenCalledWith(plain, address, proxy);

        publication.isValidStatusMessage.mockReturnValue(false);
        endpoint.onStatusMessage(plain, plain, plainFrame.length, address, proxy);
        expect(publication.onStatusMessage).toHaveBeenCalledTimes(1);
        expect(counterValue(SystemCounterDescriptor.STATUS_MESSAGES_REJECTED)).toBe(1);
        expect(counterValue(SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED)).toBe(3);
        expect(counterValue(SystemCounterDescriptor.INVALID_PACKETS)).toBe(0);

        // a status message for no publication is counted as received and goes nowhere
        const otherFrame = smFrame(1, 2);
        const other = new StatusMessageFlyweight(new UnsafeBuffer(otherFrame));
        endpoint.onStatusMessage(other, other, otherFrame.length, address, proxy);
        expect(counterValue(SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED)).toBe(4);
        expect(publication.onStatusMessage).toHaveBeenCalledTimes(1);
    });

    it('routes NAK, error, RTT measurement and response setup frames to the publication of the frame', () => {
        const endpoint = newSendEndpoint();
        const proxy = newProxy();
        const publication = newPublication(7, 8);
        endpoint.registerForSend(publication);
        const address = new InetSocketAddress(LOOPBACK, 4000);

        const nakBytes = nakFrame(7, 8);
        const nak = new NakFlyweight(new UnsafeBuffer(nakBytes));
        endpoint.onNakMessage(nak, nak, nakBytes.length, address);
        expect(publication.onNak).toHaveBeenCalledWith(nak);
        expect(counterValue(SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBe(1);

        const errorBytes = errorFrame(7, 8);
        const error = new ErrorFlyweight(new UnsafeBuffer(errorBytes));
        endpoint.onError(error, error, errorBytes.length, address, proxy);
        expect(publication.onError).toHaveBeenCalledWith(error, address, Aeron.NULL_VALUE, proxy);
        expect(counterValue(SystemCounterDescriptor.ERROR_FRAMES_RECEIVED)).toBe(1);

        const rttBytes = rttFrame(7, 8, 0, 0);
        const rtt = new RttMeasurementFlyweight(new UnsafeBuffer(rttBytes));
        endpoint.onRttMeasurement(rtt, rtt, rttBytes.length, address);
        expect(publication.onRttMeasurement).toHaveBeenCalledWith(rtt, address);

        // a response setup goes to the conductor only when the publication has a response correlation id
        const setupBytes = responseSetupFrame(7, 8, 99);
        const responseSetup = new ResponseSetupFlyweight(new UnsafeBuffer(setupBytes));
        endpoint.onResponseSetup(responseSetup, responseSetup, setupBytes.length, address, proxy);
        expect(proxy.responseSetup).toHaveBeenCalledTimes(0);
        publication.responseCorrelationId.mockReturnValue(1234);
        endpoint.onResponseSetup(responseSetup, responseSetup, setupBytes.length, address, proxy);
        expect(proxy.responseSetup).toHaveBeenCalledWith(1234, 99);

        // frames for a session that is not registered go nowhere
        const otherNak = nakFrame(70, 80);
        const other = new NakFlyweight(new UnsafeBuffer(otherNak));
        endpoint.onNakMessage(other, other, otherNak.length, address);
        expect(publication.onNak).toHaveBeenCalledTimes(1);
    });

    it('counts a NAK for a registered publication that is out of the term as invalid, and does not pass it on', () => {
        const endpoint = newSendEndpoint();
        const publication = newPublication(7, 8, 64 * 1024);
        endpoint.registerForSend(publication);

        const bytes = nakFrame(7, 8, 64 * 1024); // an offset at the end of the term
        const nak = new NakFlyweight(new UnsafeBuffer(bytes));
        endpoint.onNakMessage(nak, nak, bytes.length, new InetSocketAddress(LOOPBACK, 4000));

        expect(publication.onNak).toHaveBeenCalledTimes(0);
        expect(counterValue(SystemCounterDescriptor.INVALID_PACKETS)).toBe(1);
        expect(counterValue(SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBe(0);
    });

    it('re-resolves an explicit endpoint only when every publication has been silent for the timeout, and then once per timeout', () => {
        const endpoint = newSendEndpoint('aeron:udp?endpoint=localhost:10002');
        const proxy = newProxy();
        const publication = newPublication(7, 8);
        publication.timeOfLastStatusMessageNs.mockReturnValue(1_000_000_000);
        endpoint.registerForSend(publication);
        const timeout = SendChannelEndpoint.DESTINATION_TIMEOUT;
        expect(timeout).toBe(5_000_000_000);

        endpoint.checkForReResolution(timeout, proxy); // the publication heard an SM 4 s ago
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(0);

        endpoint.checkForReResolution(timeout + 1_000_000_000, proxy); // exactly the timeout: not yet
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(0);

        endpoint.checkForReResolution(timeout + 1_000_000_001, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(1);
        expect(proxy.reResolveEndpoint.mock.calls[0]?.[0]).toBe('localhost:10002');
        expect(proxy.reResolveEndpoint.mock.calls[0]?.[1]).toBe(endpoint);

        endpoint.checkForReResolution(2 * timeout + 1_000_000_000, proxy); // within the timeout of the last resolution
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(1);
        endpoint.checkForReResolution(2 * timeout + 1_000_000_002, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(2);
    });

    it('does not re-resolve a multicast channel, or a channel without an explicit endpoint', () => {
        const proxy = newProxy();
        const multicast = newSendEndpoint('aeron:udp?endpoint=224.20.30.39:54326|interface=localhost');
        const noEndpoint = newSendEndpoint('aeron:udp?control=127.0.0.1:20000|control-mode=dynamic');
        multicast.checkForReResolution(Long.MAX_VALUE, proxy);
        noEndpoint.checkForReResolution(Long.MAX_VALUE, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(0);
    });

    it('is closed only when nothing references it, its status is not closing and the indicator is open', () => {
        const endpoint = newSendEndpoint();
        expect(endpoint.shouldBeClosed()).toBe(true);
        endpoint.incRef();
        expect(endpoint.shouldBeClosed()).toBe(false);
        endpoint.incRef();
        endpoint.decRef();
        expect(endpoint.shouldBeClosed()).toBe(false);
        endpoint.decRef();
        expect(endpoint.shouldBeClosed()).toBe(true);
        expect(endpoint.status()).toBe(ChannelEndpointStatus.INITIALIZING);

        endpoint.indicateClosing();
        expect(endpoint.status()).toBe(ChannelEndpointStatus.CLOSING);
        expect(endpoint.shouldBeClosed()).toBe(false);
    });

    it('indicateActive needs the status INITIALIZING', () => {
        const endpoint = newSendEndpoint();
        endpoint.openDatagramChannel(null);

        endpoint.indicateActive();
        expect(endpoint.status()).toBe(ChannelEndpointStatus.ACTIVE);

        const error = assertThrows(IllegalStateException, () => endpoint.indicateActive());
        expect(error.message).toBe('channel cannot be registered unless INITIALIZING: status=ACTIVE');
    });

    it('openChannel needs the local socket address indicator, and sets it ACTIVE with the bound address', () => {
        const endpoint = newSendEndpoint('aeron:udp?endpoint=127.0.0.1:40001|interface=127.0.0.1:0');
        const error = assertThrows(Error, () => endpoint.openChannel());
        expect(error.message).toBe('localSocketAddressIndicator not allocated');
        endpoint.close();

        const second = newSendEndpoint('aeron:udp?endpoint=127.0.0.1:40001');
        const indicator = newStatusIndicator();
        second.localSocketAddressIndicator(indicator);
        second.openChannel();
        expect(indicator.get()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(second.bindAddressAndPort()).toMatch(/^127\.0\.0\.1:\d+$/);
        expect(second.statusIndicatorCounterId()).toBeGreaterThanOrEqual(0);
        expect(second.originalUriString()).toBe('aeron:udp?endpoint=127.0.0.1:40001');
    });

    it('a bind to a port in use fails with the channel error and the status ERRORED', () => {
        const port = freeUdpPort();
        const first = newSendEndpoint('aeron:udp?endpoint=127.0.0.1:40001|interface=127.0.0.1:' + port);
        first.openDatagramChannel(null);

        const statusIndicator = newStatusIndicator();
        const second = track(
            new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001|interface=127.0.0.1:' + port),
                statusIndicator,
                context,
            ),
        );
        const error = assertThrows(AeronException, () => second.openDatagramChannel(statusIndicator));
        expect(error.message).toContain('channel error - ');
        expect(statusIndicator.get()).toBe(ChannelEndpointStatus.ERRORED);
        expect(second.sendDatagramChannel).toBeNull();
    });

    it('sends the bytes it is given to the connected address, in the slot, and a buffer reused at once arrives unchanged', () => {
        const { endpoint, socket } = newFakeSendEndpoint();
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        for (let i = 0; i < 64; i++) {
            buffer.putByte(i, i);
        }

        expect(endpoint.send(buffer, 8, 40)).toBe(40);
        buffer.putByte(8, 0x7f); // the caller reuses the buffer

        expect(socket.sent).toHaveLength(1);
        expect(Array.from(socket.sent[0]?.bytesAtSend as Uint8Array)).toEqual(
            Array.from({ length: 40 }, (_, i) => i + 8),
        );
        expect(socket.sent[0]?.port).toBeUndefined(); // connected: no address
    });

    it('send on a socket that is not connected (response control mode) sends nothing, and reports nothing', () => {
        const endpoint = newSendEndpoint(
            'aeron:udp?control-mode=response|control=127.0.0.1:0|endpoint=127.0.0.1:40001',
        );
        endpoint.openDatagramChannel(null);
        const socket = new FakeSocket();
        const real = endpoint.sendDatagramChannel as Socket;
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        endpoint._receiveDatagramChannel = real;
        expect(endpoint.isConnected()).toBe(false);

        expect(endpoint.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32)).toBe(0);

        expect(socket.sent).toHaveLength(0);
        expect(errors).toEqual([]);
    });

    it('send before open and after close returns 0 and does not throw; a send error from a socket that was closed is dropped', () => {
        const endpoint = newSendEndpoint();
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        expect(endpoint.send(buffer, 0, 32)).toBe(0);
        expect(endpoint.sendTo(buffer, 0, 32, new InetSocketAddress(LOOPBACK, 1))).toBe(0);

        const { endpoint: open, socket } = newFakeSendEndpoint();
        expect(open.send(buffer, 0, 32)).toBe(32);
        open.close();
        expect(socket.closed).toBe(true);
        expect(open.send(buffer, 0, 32)).toBe(0);
        // libuv completes the queued send with an error after the close: nothing is reported
        socket.sent[0]?.callback?.(Object.assign(new Error('late'), { code: 'EMSGSIZE' }), 0);
        expect(errors).toEqual([]);
    });

    it('short sends while libuv holds a datagram send nothing and keep the caller buffer, then succeed once drained', () => {
        const { endpoint, socket } = newFakeSendEndpoint();
        const buffer = new UnsafeBuffer(new Uint8Array(32).fill(1));
        socket.queueCount = 1;

        for (let cycle = 0; cycle < 5; cycle++) {
            expect(endpoint.send(buffer, 0, 32)).toBe(0);
        }
        expect(socket.sent).toHaveLength(0);

        socket.queueCount = 0;
        expect(endpoint.send(buffer, 0, 32)).toBe(32);
        expect(socket.sent).toHaveLength(1);
    });

    it('a send error that surfaces later is reported at the next poll of the control poller, which goes on polling', () => {
        const { endpoint, socket } = newFakeSendEndpoint();
        const poller = new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, newProxy());
        poller.registerForRead(endpoint);

        expect(endpoint.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32)).toBe(32);
        socket.sent[0]?.callback?.(Object.assign(new Error('boom'), { code: 'EMSGSIZE' }), 0);
        expect(errors).toEqual([]); // not at once

        expect(poller.pollTransports()).toBe(0);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(AeronEvent);
        expect(errors[0]?.message).toContain('failed to send datagram to /127.0.0.1:40001');
        expect(errors[0]?.message).toContain('boom');

        poller.pollTransports();
        expect(errors).toHaveLength(1); // once
    });

    it('applies the send timestamp to the begin frames of a packet it sends, once per packet, and not to a packet it sends to an address', () => {
        const clock = {
            nanoTime: vi.fn<() => number>(),
            nanoTimeHalves: vi.fn((out: Int32Array) => {
                out[0] = 0x01020304;
                out[1] = 0x00000bcd;
            }),
        };
        const stamped = new MediaDriver.Context()
            .errorHandler({ onError: (e) => errors.push(e) })
            .channelSendTimestampClock(clock)
            .conclude();
        const endpoint = track(
            new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001|channel-snd-ts-offset=reserved'),
                stamped.countersManager()?.newCounter('status') as AtomicCounter,
                stamped,
            ),
        );
        endpoint.openDatagramChannel(null);
        const socket = new FakeSocket();
        const real = endpoint.sendDatagramChannel as Socket;
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        endpoint._receiveDatagramChannel = real;

        const buffer = new UnsafeBuffer(new Uint8Array(96));
        for (let i = 0; i < 2; i++) {
            new DataHeaderFlyweight(buffer).wrap(buffer, i * 32, 32);
        }
        const frames = new DataHeaderFlyweight();
        for (let i = 0; i < 3; i++) {
            frames.wrap(buffer, i * 32, 32);
            frames
                .frameLength(32)
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_DATA);
        }

        expect(endpoint.send(buffer, 0, 96)).toBe(96);

        expect(clock.nanoTimeHalves).toHaveBeenCalledTimes(1);
        const sent = sentBytes(socket, 0);
        for (let i = 0; i < 3; i++) {
            expect(sent.getInt(i * 32 + 24, LITTLE_ENDIAN)).toBe(0x01020304);
            expect(sent.getInt(i * 32 + 28, LITTLE_ENDIAN)).toBe(0x00000bcd);
        }

        // sendTo an address stamps too (Java: send(ByteBuffer, InetSocketAddress)), through the same method
        expect(endpoint.sendTo(buffer, 0, 32, new InetSocketAddress(LOOPBACK, 4000))).toBe(32);
        expect(clock.nanoTimeHalves).toHaveBeenCalledTimes(2);
        stamped.close();
    });

    it('does not read the clock for a channel without a send timestamp, or for a packet without a begin data frame', () => {
        const clock = { nanoTime: vi.fn<() => number>(), nanoTimeHalves: vi.fn() };
        const stamped = new MediaDriver.Context()
            .errorHandler({ onError: (e) => errors.push(e) })
            .channelSendTimestampClock(clock)
            .conclude();
        const plain = track(
            new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001'),
                stamped.countersManager()?.newCounter('status') as AtomicCounter,
                stamped,
            ),
        );
        plain.openDatagramChannel(null);
        const real = plain.sendDatagramChannel as Socket;
        plain.sendDatagramChannel = new FakeSocket() as unknown as Socket;
        plain._receiveDatagramChannel = real;
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        new DataHeaderFlyweight(buffer)
            .frameLength(32)
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA);
        plain.send(buffer, 0, 32);
        expect(clock.nanoTimeHalves).toHaveBeenCalledTimes(0);

        // a middle fragment (no BEGIN flag) and a padding frame are not stamped
        const withTimestamp = track(
            new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001|channel-snd-ts-offset=reserved'),
                stamped.countersManager()?.newCounter('status') as AtomicCounter,
                stamped,
            ),
        );
        new DataHeaderFlyweight(buffer)
            .frameLength(32)
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(0)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA);
        withTimestamp.applyChannelSendTimestamp(buffer, 0, 32);
        new DataHeaderFlyweight(buffer)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_PAD);
        withTimestamp.applyChannelSendTimestamp(buffer, 0, 32);
        expect(clock.nanoTimeHalves).toHaveBeenCalledTimes(0);
        stamped.close();
    });

    it('validateAllowsManualControl accepts a manual channel and refuses the others with INVALID_CHANNEL', () => {
        newSendEndpoint('aeron:udp?control-mode=manual').validateAllowsManualControl();

        for (const uri of [
            'aeron:udp?endpoint=127.0.0.1:40001',
            'aeron:udp?control=127.0.0.1:0|control-mode=dynamic',
        ]) {
            const error = assertThrows(ControlProtocolException, () =>
                newSendEndpoint(uri).validateAllowsManualControl(),
            );
            expect(error.message).toContain('channel does not allow manual control');
            expect(error.errorCode()).toBe(ErrorCode.INVALID_CHANNEL);
        }
    });

    it('matchesTag compares with the channel of the endpoint and its connect address', () => {
        const endpoint = newSendEndpoint('aeron:udp?endpoint=127.0.0.1:40001|tags=77');
        expect(endpoint.matchesTag(UdpChannel.parse('aeron:udp?tags=77'))).toBe(true);
        expect(endpoint.matchesTag(UdpChannel.parse('aeron:udp?tags=78'))).toBe(false);
    });

    it('resolutionChange of a unicast endpoint reconnects to the new address and keeps the status ACTIVE', async () => {
        const endpoint = newSendEndpoint('aeron:udp?endpoint=127.0.0.1:40001');
        endpoint.openDatagramChannel(null);
        const status = endpoint.statusIndicatorCounterId();
        expect(status).toBeGreaterThanOrEqual(0);

        endpoint.resolutionChange('127.0.0.1:40002', new InetSocketAddress(LOOPBACK, 40002));

        expect(endpoint.isConnected()).toBe(true);
        expect(endpoint.status()).toBe(ChannelEndpointStatus.ACTIVE);
        await Promise.resolve();
    });
});

describe('MultiSndDestination (sending; the behaviour is tested again in phase 3)', () => {
    function newMdc(uri: string): { endpoint: SendChannelEndpoint; socket: FakeSocket; counter: AtomicCounter } {
        const endpoint = newSendEndpoint(uri);
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        endpoint.allocateDestinationsCounterForMdc(new UnsafeBuffer(new Uint8Array(1024)), countersManager(), 42, uri);
        const counter = (endpoint as unknown as { mdcDestinationsCounter: AtomicCounter }).mdcDestinationsCounter;
        return { endpoint, socket, counter };
    }

    function destinationUri(port: number): ChannelUri {
        return ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:' + port);
    }

    function smFrom(receiverId: number): StatusMessageFlyweight {
        const frame = smFrame(0, 0);
        const sm = new StatusMessageFlyweight(new UnsafeBuffer(frame));
        sm.receiverIdHigh(0).receiverIdLow(receiverId);
        return sm;
    }

    it('manual control: every destination gets the datagram, starting from a rotating index', () => {
        const { endpoint, socket, counter } = newMdc('aeron:udp?control-mode=manual');
        for (let i = 0; i < 3; i++) {
            endpoint.addDestination(destinationUri(50001 + i), new InetSocketAddress(LOOPBACK, 50001 + i), 100 + i);
            expect(counter.get()).toBe(i + 1);
        }
        const buffer = new UnsafeBuffer(new Uint8Array(32));

        const ports: number[][] = [];
        for (let call = 0; call < 4; call++) {
            const before = socket.sent.length;
            expect(endpoint.send(buffer, 0, 32)).toBe(32);
            ports.push(socket.sent.slice(before).map((sent) => sent.port as number));
        }

        expect(ports).toEqual([
            [50001, 50002, 50003],
            [50002, 50003, 50001],
            [50003, 50001, 50002],
            [50001, 50002, 50003], // the index wrapped
        ]);
    });

    it('manual control: an unresolved destination counts as sent, and a short send to any destination is the result', () => {
        const { endpoint, socket } = newMdc('aeron:udp?control-mode=manual');
        endpoint.addDestination(
            destinationUri(50001),
            InetSocketAddress.createUnresolved('nohost.invalid', 50001),
            100,
        );
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        expect(endpoint.send(buffer, 0, 32)).toBe(32);
        expect(socket.sent).toHaveLength(0);

        endpoint.addDestination(destinationUri(50002), new InetSocketAddress(LOOPBACK, 50002), 101);
        socket.queueCount = 1;
        expect(endpoint.send(buffer, 0, 32)).toBe(0); // libuv holds a datagram: nothing advances
        socket.queueCount = 0;
        expect(endpoint.send(buffer, 0, 32)).toBe(32);
        expect(socket.sent.map((sent) => sent.port)).toEqual([50002]);
    });

    it('manual control: remove by address and by registration id, an unknown one removes nothing, the counter follows', () => {
        const { endpoint, counter } = newMdc('aeron:udp?control-mode=manual');
        for (let i = 0; i < 3; i++) {
            endpoint.addDestination(destinationUri(50001 + i), new InetSocketAddress(LOOPBACK, 50001 + i), 100 + i);
        }

        endpoint.removeDestination(destinationUri(50002), new InetSocketAddress(LOOPBACK, 50002));
        expect(counter.get()).toBe(2);
        endpoint.removeDestination(destinationUri(59999), new InetSocketAddress(LOOPBACK, 59999));
        expect(counter.get()).toBe(2);
        endpoint.removeDestination(100);
        expect(counter.get()).toBe(1);
        endpoint.removeDestination(12345);
        expect(counter.get()).toBe(1);
        endpoint.removeDestination(102);
        expect(counter.get()).toBe(0);
    });

    it('manual control: a status message from a destination fixes its receiver id; the error frame of that receiver finds its registration id', () => {
        const { endpoint } = newMdc('aeron:udp?control-mode=manual');
        endpoint.addDestination(destinationUri(50001), new InetSocketAddress(LOOPBACK, 50001), 100);
        endpoint.addDestination(destinationUri(50002), new InetSocketAddress(LOOPBACK, 50002), 101);
        const publication = newPublication(7, 8);
        endpoint.registerForSend(publication);
        const proxy = newProxy();

        const frame = smFrame(7, 8);
        const sm = new StatusMessageFlyweight(new UnsafeBuffer(frame));
        sm.receiverIdHigh(3).receiverIdLow(4);
        endpoint.onStatusMessage(sm, sm, frame.length, new InetSocketAddress(LOOPBACK, 50002), proxy);

        const errorBytes = errorFrame(7, 8);
        const error = new ErrorFlyweight(new UnsafeBuffer(errorBytes));
        error.receiverIdHigh(3).receiverIdLow(4);
        endpoint.onError(error, error, errorBytes.length, new InetSocketAddress(LOOPBACK, 50002), proxy);
        expect(publication.onError.mock.calls[0]?.[2]).toBe(101);

        error.receiverIdLow(5); // another receiver id from the same port: not a match
        endpoint.onError(error, error, errorBytes.length, new InetSocketAddress(LOOPBACK, 50002), proxy);
        expect(publication.onError.mock.calls[1]?.[2]).toBe(Aeron.NULL_VALUE);
    });

    it('manual control: re-resolves a destination that has been silent for the timeout, and updates it on a resolution change', () => {
        const nanoClock = context.senderCachedNanoClock() as CachedNanoClock;
        nanoClock.update(0);
        const { endpoint } = newMdc('aeron:udp?control-mode=manual');
        endpoint.addDestination(destinationUri(50001), new InetSocketAddress(LOOPBACK, 50001), 100);
        const proxy = newProxy();
        const timeout = SendChannelEndpoint.DESTINATION_TIMEOUT;

        endpoint.checkForReResolution(timeout, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(0);
        endpoint.checkForReResolution(timeout + 1, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(1);
        expect(proxy.reResolveEndpoint.mock.calls[0]?.[0]).toBe('127.0.0.1:50001');
        endpoint.checkForReResolution(timeout + 2, proxy);
        expect(proxy.reResolveEndpoint).toHaveBeenCalledTimes(1);

        endpoint.resolutionChange('127.0.0.1:50001', new InetSocketAddress(LOOPBACK, 50099));
        const socket = endpoint.sendDatagramChannel as unknown as FakeSocket;
        endpoint.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32);
        expect(socket.sent[0]?.port).toBe(50099);
    });

    it('dynamic control: a status message adds its sender, a repeat renews it, and a destination silent for the timeout is removed on a send', () => {
        const nanoClock = context.senderCachedNanoClock() as CachedNanoClock;
        nanoClock.update(0);
        const { endpoint, socket, counter } = newMdc('aeron:udp?control=127.0.0.1:50000|control-mode=dynamic');
        const proxy = newProxy();
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        const status = (receiverId: number, port: number): void => {
            const sm = smFrom(receiverId);
            endpoint.onStatusMessage(
                sm,
                sm,
                StatusMessageFlyweight.HEADER_LENGTH,
                new InetSocketAddress(LOOPBACK, port),
                proxy,
            );
        };

        status(1, 50001);
        status(2, 50002);
        status(1, 50001); // known: renewed, not added
        status(1, 50003); // same receiver id, another port: another destination
        expect(counter.get()).toBe(3);
        endpoint.send(buffer, 0, 32);
        expect(socket.sent.map((sent) => sent.port).sort()).toEqual([50001, 50002, 50003]);

        const timeout = SendChannelEndpoint.DESTINATION_TIMEOUT;
        nanoClock.update(timeout);
        status(2, 50002);
        nanoClock.update(timeout + 1);
        socket.sent.length = 0;
        endpoint.send(buffer, 0, 32);
        expect(socket.sent.map((sent) => sent.port)).toEqual([50002]);
        expect(counter.get()).toBe(1);
    });
});

describe('ReceiveChannelEndpoint', () => {
    it('counts references per stream, per stream and session, and per response stream; decrementing an unknown one fails and leaves nothing behind', () => {
        const endpoint = newReceiveEndpoint();
        expect(endpoint.shouldBeClosed()).toBe(true);
        expect(endpoint.distinctSubscriptionCount()).toBe(0);

        expect(endpoint.incRefToStream(1001)).toBe(1);
        expect(endpoint.incRefToStream(1001)).toBe(2);
        expect(endpoint.shouldBeClosed()).toBe(false);
        expect(endpoint.decRefToStream(1001)).toBe(1);
        expect(endpoint.decRefToStream(1001)).toBe(0);
        expect(endpoint.shouldBeClosed()).toBe(true);

        const error = assertThrows(IllegalStateException, () => endpoint.decRefToStream(1001));
        expect(error.message).toBe('unknown stream Id: 1001');
        expect(endpoint.distinctSubscriptionCount()).toBe(0);
        expect(endpoint.incRefToStream(1001)).toBe(1); // the failed decrement left no -1 behind
        endpoint.decRefToStream(1001);

        expect(endpoint.incRefToStreamAndSession(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(1);
        expect(endpoint.incRefToStreamAndSession(Integer.MAX_VALUE, Integer.MIN_VALUE)).toBe(1);
        expect(endpoint.incRefToStreamAndSession(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(2);
        expect(endpoint.distinctSubscriptionCount()).toBe(2);
        expect(endpoint.decRefToStreamAndSession(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(1);
        expect(endpoint.decRefToStreamAndSession(Integer.MIN_VALUE, Integer.MAX_VALUE)).toBe(0);
        expect(endpoint.decRefToStreamAndSession(Integer.MAX_VALUE, Integer.MIN_VALUE)).toBe(0);
        const sessionError = assertThrows(IllegalStateException, () => endpoint.decRefToStreamAndSession(3, -4));
        expect(sessionError.message).toBe('unknown stream Id + session Id: 3 -4');
        expect(endpoint.distinctSubscriptionCount()).toBe(0);

        expect(endpoint.incResponseRefToStream(9)).toBe(1);
        expect(endpoint.shouldBeClosed()).toBe(false);
        expect(endpoint.decResponseRefToStream(9)).toBe(0);
        const responseError = assertThrows(IllegalStateException, () => endpoint.decResponseRefToStream(9));
        expect(responseError.message).toBe('unknown stream Id: 9');
        expect(endpoint.shouldBeClosed()).toBe(true);
    });

    it('is not closed while images reference it, or when it is closing', () => {
        const endpoint = newReceiveEndpoint();
        endpoint.incRefImages();
        expect(endpoint.shouldBeClosed()).toBe(false);
        endpoint.decRefImages();
        expect(endpoint.shouldBeClosed()).toBe(true);
        endpoint.indicateClosing();
        expect(endpoint.status()).toBe(ChannelEndpointStatus.CLOSING);
        expect(endpoint.shouldBeClosed()).toBe(false);
    });

    it('indicateActive needs the status INITIALIZING, appends the bound address and sets the local socket address indicator', () => {
        const endpoint = newReceiveEndpoint();
        const local = newStatusIndicator();
        endpoint.localSocketAddressIndicator(local);

        endpoint.indicateActive();

        expect(endpoint.status()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(local.get()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(endpoint.statusIndicatorCounter().label()).toContain('127.0.0.1:');
        const error = assertThrows(AeronException, () => endpoint.indicateActive());
        expect(error.message).toContain('channel cannot be registered unless INITIALIZING: status=ACTIVE');
    });

    it('the local socket address indicator is not used by control-mode=manual (MDS), which opens no socket of its own', () => {
        const endpoint = track(
            new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?control-mode=manual'),
                newDispatcher(),
                newStatusIndicator(),
                context,
            ),
        );
        const error = assertThrows(IllegalStateException, () =>
            endpoint.localSocketAddressIndicator(newStatusIndicator()),
        );
        expect(error.message).toBe('local socket address indicator not used for MDS');
        expect(endpoint.hasDestinationControl()).toBe(true);
        endpoint.openChannel();
        expect(endpoint.sendDatagramChannel).toBeNull();
        endpoint.validateAllowsDestinationControl();

        const unicast = newReceiveEndpoint();
        expect(unicast.hasDestinationControl()).toBe(false);
        const refused = assertThrows(ControlProtocolException, () => unicast.validateAllowsDestinationControl());
        expect(refused.errorCode()).toBe(ErrorCode.INVALID_CHANNEL);
    });

    it('answers the transport index questions of a unicast channel and refuses any other index', () => {
        const endpoint = newReceiveEndpoint();
        expect(endpoint.isMulticast()).toBe(false);
        expect(endpoint.isMulticast(0)).toBe(false);
        expect(endpoint.multicastTtl()).toBe(0);
        expect(endpoint.udpChannel()).toBe(endpoint.subscriptionUdpChannel());
        expect(endpoint.udpChannel(0)).toBe(endpoint.subscriptionUdpChannel());
        expect(endpoint.hasDestination(0)).toBe(true);
        expect(endpoint.hasDestination(1)).toBe(false);

        expect(assertThrows(IllegalStateException, () => endpoint.isMulticast(1)).message).toBe(
            'isMulticast for unknown index 1',
        );
        expect(assertThrows(IllegalStateException, () => endpoint.udpChannel(1)).message).toBe(
            'udpChannel for unknown index 1',
        );
        expect(assertThrows(IllegalStateException, () => endpoint.multicastTtl(2)).message).toBe(
            'multicastTtl for unknown index 2',
        );
    });

    it('has the tag of its channel, and an explicit control address only when the channel has one', () => {
        const tagged = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|tags=88');
        expect(tagged.hasTag()).toBe(true);
        expect(tagged.tag()).toBe(88);
        expect(tagged.matchesTag(UdpChannel.parse('aeron:udp?tags=88'))).toBe(true);
        expect(tagged.hasExplicitControl()).toBe(false);
        expect(tagged.explicitControlAddress()).toBeNull();

        const mdc = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:40500|control-mode=dynamic');
        expect(mdc.hasExplicitControl()).toBe(true);
        expect(mdc.explicitControlAddress()?.getPort()).toBe(40500);
        mdc.updateControlAddress(0, new InetSocketAddress(LOOPBACK, 40501));
        expect(mdc.explicitControlAddress()?.getPort()).toBe(40501);

        // without an explicit control an update changes nothing
        tagged.updateControlAddress(0, new InetSocketAddress(LOOPBACK, 40501));
        expect(tagged.explicitControlAddress()).toBeNull();
    });

    it('re-resolves an explicit control address once the activity of the channel is older than the timeout', () => {
        const nanoClock = context.receiverCachedNanoClock() as CachedNanoClock;
        nanoClock.update(0);
        const mdc = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:40500|control-mode=dynamic');
        const plain = newReceiveEndpoint();
        const proxy = newProxy();
        const timeout = ReceiveChannelEndpoint.DESTINATION_ADDRESS_TIMEOUT;
        expect(timeout).toBe(5_000_000_000);

        mdc.checkForReResolution(timeout, proxy);
        expect(proxy.reResolveControl).toHaveBeenCalledTimes(0);
        mdc.checkForReResolution(timeout + 1, proxy);
        expect(proxy.reResolveControl).toHaveBeenCalledTimes(1);
        const call = proxy.reResolveControl.mock.calls[0] as Parameters<DriverConductorProxy['reResolveControl']>;
        expect(call[0]).toBe('127.0.0.1:40500');
        expect(call[2]).toBe(mdc);
        mdc.checkForReResolution(timeout + 2, proxy); // activity time was set to now
        expect(proxy.reResolveControl).toHaveBeenCalledTimes(1);

        plain.checkForReResolution(Long.MAX_VALUE, proxy);
        expect(proxy.reResolveControl).toHaveBeenCalledTimes(1);
    });

    it('a data, setup or RTT frame updates the time of last activity from the cached clock of the receiver', () => {
        const nanoClock = context.receiverCachedNanoClock() as CachedNanoClock;
        nanoClock.update(100);
        const dispatcher = newDispatcher();
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcher);
        expect(endpoint.timeOfLastActivityNs).toBe(100);
        const address = new InetSocketAddress(LOOPBACK, 5000);

        nanoClock.update(200);
        const data = dataFrame(1, 2, 3, 0);
        endpoint.onDataPacket(new DataHeaderFlyweight(new UnsafeBuffer(data)), new UnsafeBuffer(data), 32, address, 0);
        expect(endpoint.timeOfLastActivityNs).toBe(200);
        expect(dispatcher.onDataPacket).toHaveBeenCalledTimes(1);

        nanoClock.update(300);
        const setupBytes = setupFrame(1, 2);
        const setup = new SetupFlyweight(new UnsafeBuffer(setupBytes));
        endpoint.onSetupMessage(setup, setup, setupBytes.length, address, 0);
        expect(endpoint.timeOfLastActivityNs).toBe(300);

        nanoClock.update(400);
        const rttBytes = rttFrame(1, 2, 0, 0);
        const rtt = new RttMeasurementFlyweight(new UnsafeBuffer(rttBytes));
        endpoint.onRttMeasurement(rtt, rtt, rttBytes.length, address, 0);
        expect(endpoint.timeOfLastActivityNs).toBe(400);

        // an invalid setup message does not count as activity
        nanoClock.update(500);
        const invalid = setupFrame(1, 2);
        new SetupFlyweight(new UnsafeBuffer(invalid)).mtuLength(111).termOffset(-5);
        const invalidSetup = new SetupFlyweight(new UnsafeBuffer(invalid));
        endpoint.onSetupMessage(invalidSetup, invalidSetup, invalid.length, address, 0);
        expect(endpoint.timeOfLastActivityNs).toBe(400);
    });

    it('passes an RTT measurement on only when it asks for this receiver or for all receivers', () => {
        const dispatcher = newDispatcher();
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcher);
        const fields = endpoint as unknown as { receiverIdHigh: number; receiverIdLow: number };
        const address = new InetSocketAddress(LOOPBACK, 5000);
        const send = (high: number, low: number): void => {
            const bytes = rttFrame(1, 2, high, low);
            const rtt = new RttMeasurementFlyweight(new UnsafeBuffer(bytes));
            endpoint.onRttMeasurement(rtt, rtt, bytes.length, address, 0);
        };

        send(0, 0); // all receivers
        expect(dispatcher.onRttMeasurement).toHaveBeenCalledTimes(1);
        send(fields.receiverIdHigh, fields.receiverIdLow); // this one
        expect(dispatcher.onRttMeasurement).toHaveBeenCalledTimes(2);
        send(fields.receiverIdHigh, fields.receiverIdLow ^ 1); // another (mutation: compares one half only)
        send(fields.receiverIdHigh ^ 1, fields.receiverIdLow);
        send(0, 1);
        send(1, 0);
        expect(dispatcher.onRttMeasurement).toHaveBeenCalledTimes(2);
    });

    it('sends a setup eliciting status message with the SEND_SETUP flag, the receiver id and the group tag of the channel', () => {
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|gtag=4660');
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        const source = new InetSocketAddress(LOOPBACK, 7777);

        endpoint.sendSetupElicitingStatusMessage(0, source, 11, 22);

        expect(socket.sent).toHaveLength(1);
        expect(socket.sent[0]?.port).toBe(7777);
        const sm = new StatusMessageFlyweight(sentBytes(socket, 0));
        expect(sm.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SM);
        expect(sm.frameLength()).toBe(StatusMessageFlyweight.HEADER_LENGTH + 8);
        expect(sm.flags()).toBe(StatusMessageFlyweight.SEND_SETUP_FLAG);
        expect(sm.sessionId()).toBe(11);
        expect(sm.streamId()).toBe(22);
        expect(sm.receiverWindowLength()).toBe(0);
        expect(sm.groupTag()).toBe(4660n);
        const fields = endpoint as unknown as { receiverId: bigint };
        expect(sm.receiverId()).toBe(fields.receiverId);
    });

    it('takes the group tag of the context when the channel has none, and none at all otherwise', () => {
        const tagged = new MediaDriver.Context()
            .errorHandler({ onError: (e) => errors.push(e) })
            .receiverGroupTag(99)
            .conclude();
        const endpoint = track(
            new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
                newDispatcher(),
                tagged.countersManager()?.newCounter('status') as AtomicCounter,
                tagged,
            ),
        );
        endpoint.openDatagramChannel(null);
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        endpoint.sendSetupElicitingStatusMessage(0, new InetSocketAddress(LOOPBACK, 7777), 1, 2);
        expect(new StatusMessageFlyweight(sentBytes(socket, 0)).groupTag()).toBe(99n);
        tagged.close();

        const none = newReceiveEndpoint();
        const noneSocket = new FakeSocket();
        none.sendDatagramChannel = noneSocket as unknown as Socket;
        none.sendSetupElicitingStatusMessage(0, new InetSocketAddress(LOOPBACK, 7777), 1, 2);
        const sm = new StatusMessageFlyweight(sentBytes(noneSocket, 0));
        expect(sm.frameLength()).toBe(StatusMessageFlyweight.HEADER_LENGTH);
        expect(sm.groupTag()).toBe(0n);
    });

    it('sends status, NAK, RTT measurement, response setup and error frames to the first image connection', () => {
        const endpoint = newReceiveEndpoint();
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        const connections = [new ImageConnection(0, new InetSocketAddress(LOOPBACK, 6001))];

        endpoint.sendStatusMessage(connections, 5, 6, 7, 8, 9000, 0);
        endpoint.sendNakMessage(connections, 5, 6, 7, 8, 64);
        endpoint.sendRttMeasurement(connections, 5, 6, 123456789012345n, 77n, true);
        endpoint.sendResponseSetup(connections, 5, 6, 4242);
        endpoint.sendErrorFrame(connections, 5, 6, ErrorCode.GENERIC_ERROR.value(), 'failed');

        expect(socket.sent).toHaveLength(5);
        expect(socket.sent.every((sent) => sent.port === 6001)).toBe(true);

        const sm = new StatusMessageFlyweight(sentBytes(socket, 0));
        expect([
            sm.headerType(),
            sm.sessionId(),
            sm.streamId(),
            sm.consumptionTermId(),
            sm.consumptionTermOffset(),
        ]).toEqual([HeaderFlyweight.HDR_TYPE_SM, 5, 6, 7, 8]);
        expect(sm.receiverWindowLength()).toBe(9000);
        expect(socket.sent[0]?.length).toBe(StatusMessageFlyweight.HEADER_LENGTH);

        const nak = new NakFlyweight(sentBytes(socket, 1));
        expect([
            nak.headerType(),
            nak.sessionId(),
            nak.streamId(),
            nak.termId(),
            nak.termOffset(),
            nak.length(),
        ]).toEqual([HeaderFlyweight.HDR_TYPE_NAK, 5, 6, 7, 8, 64]);
        expect(socket.sent[1]?.length).toBe(NakFlyweight.HEADER_LENGTH);

        const rtt = new RttMeasurementFlyweight(sentBytes(socket, 2));
        expect(rtt.headerType()).toBe(HeaderFlyweight.HDR_TYPE_RTTM);
        expect(rtt.echoTimestampNs()).toBe(123456789012345n);
        expect(rtt.receptionDelta()).toBe(77n);
        expect(rtt.flags()).toBe(RttMeasurementFlyweight.REPLY_FLAG);
        expect(socket.sent[2]?.length).toBe(RttMeasurementFlyweight.HEADER_LENGTH);

        const responseSetup = new ResponseSetupFlyweight(sentBytes(socket, 3));
        expect([responseSetup.headerType(), responseSetup.responseSessionId()]).toEqual([
            HeaderFlyweight.HDR_TYPE_RSP_SETUP,
            4242,
        ]);

        const error = new ErrorFlyweight(sentBytes(socket, 4));
        expect(error.headerType()).toBe(HeaderFlyweight.HDR_TYPE_ERR);
        expect(error.errorMessage()).toBe('failed');
        expect(error.errorCode()).toBe(ErrorCode.GENERIC_ERROR.value());
        expect(socket.sent[4]?.length).toBe(error.frameLength());
        expect(counterValue(SystemCounterDescriptor.ERROR_FRAMES_SENT)).toBe(1);

        // the RTT measurement to one source: the transport index form
        endpoint.sendRttMeasurement(0, new InetSocketAddress(LOOPBACK, 6002), 5, 6, 1n, 0n, false);
        expect(socket.sent[5]?.port).toBe(6002);
        expect(new RttMeasurementFlyweight(sentBytes(socket, 5)).flags()).toBe(0);
    });

    it('counts a short send for each frame that is not sent, N cycles in a row, and sends again when libuv has drained', () => {
        const endpoint = newReceiveEndpoint();
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        const connections = [new ImageConnection(0, new InetSocketAddress(LOOPBACK, 6001))];
        socket.queueCount = 1;

        for (let cycle = 1; cycle <= 7; cycle++) {
            endpoint.sendStatusMessage(connections, 5, 6, 7, 8, 9000, 0);
            expect(counterValue(SystemCounterDescriptor.SHORT_SENDS)).toBe(cycle);
        }
        expect(socket.sent).toHaveLength(0);

        socket.queueCount = 0;
        endpoint.sendStatusMessage(connections, 5, 6, 7, 8, 9000, 0);
        expect(socket.sent).toHaveLength(1);
        expect(counterValue(SystemCounterDescriptor.SHORT_SENDS)).toBe(7);

        // the other send forms count too
        socket.queueCount = 1;
        endpoint.sendNakMessage(connections, 5, 6, 7, 8, 64);
        endpoint.sendSetupElicitingStatusMessage(0, new InetSocketAddress(LOOPBACK, 6001), 1, 2);
        expect(counterValue(SystemCounterDescriptor.SHORT_SENDS)).toBe(9);
    });

    it('the shared frame buffer is reused at once: a datagram handed to libuv does not change with the next frame', () => {
        const endpoint = newReceiveEndpoint();
        const socket = new FakeSocket();
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        const connections = [new ImageConnection(0, new InetSocketAddress(LOOPBACK, 6001))];

        endpoint.sendStatusMessage(connections, 5, 6, 7, 8, 9000, 0);
        const first = socket.sent[0] as FakeSocket['sent'][number];
        const slotAfterFirst = Uint8Array.from(first.slot.subarray(0, first.length));
        endpoint.sendNakMessage(connections, 50, 60, 70, 80, 640); // the thread locals are overwritten: other frame

        expect(socket.sent).toHaveLength(2);
        expect(Array.from(first.bytesAtSend)).toEqual(Array.from(slotAfterFirst));
    });

    it('a send to a closed endpoint, or to one that is not open, is not sent and not counted as an error', () => {
        const endpoint = newReceiveEndpoint();
        const connections = [new ImageConnection(0, new InetSocketAddress(LOOPBACK, 6001))];
        endpoint.close();

        endpoint.sendStatusMessage(connections, 5, 6, 7, 8, 9000, 0);

        expect(counterValue(SystemCounterDescriptor.SHORT_SENDS)).toBe(1);
        expect(errors).toEqual([]);
    });

    it('toString names the fields that matter', () => {
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|gtag=5');
        const text = endpoint.toString();
        expect(text).toContain('ReceiveChannelEndpoint{groupTag=5');
        expect(text).toContain('isChannelReceiveTimestampEnabled=false');
        expect(text).toContain('imageRefCount=0');
        expect(text).toContain('multiRcvDestination=null');
    });
});

describe('ReceiveChannelEndpoint with destinations (MDS; behaviour is tested in phase 3)', () => {
    it('keeps the destinations by index, reusing a freed index, and answers per index', () => {
        const endpoint = track(
            new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?control-mode=manual'),
                newDispatcher(),
                newStatusIndicator(),
                context,
            ),
        );
        const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0');
        const other = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0|tags=3');
        const first = track(new ReceiveDestinationTransport(channel, context, newStatusIndicator(), endpoint));
        const second = track(new ReceiveDestinationTransport(other, context, newStatusIndicator(), endpoint));

        expect(endpoint.addDestination(first)).toBe(0);
        expect(endpoint.addDestination(second)).toBe(1);
        expect(endpoint.hasDestination(0)).toBe(true);
        expect(endpoint.hasDestination(1)).toBe(true);
        expect(endpoint.hasDestination(2)).toBe(false);
        expect(endpoint.destination(0)).toBe(first);
        expect(endpoint.destination(1)).toBe(second);
        expect(endpoint.destination(channel)).toBe(0);
        expect(endpoint.destination(other)).toBe(1);
        expect(endpoint.udpChannel(1)).toBe(other);
        expect(endpoint.isMulticast(0)).toBe(false);

        endpoint.removeDestination(0);
        expect(endpoint.hasDestination(0)).toBe(false);
        expect(endpoint.destination(channel)).toBe(-1);
        expect(endpoint.addDestination(second)).toBe(0); // the freed index is reused
        expect(assertThrows(IllegalStateException, () => endpoint.udpChannel(5)).message).toBe(
            'udpChannel for unknown index 5',
        );
    });
});

describe('ReceiveDestinationTransport', () => {
    it('takes the buffer lengths of its endpoint, indicates ACTIVE with its bound address, and has a control address only when explicit', () => {
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0|so-rcvbuf=64k|so-sndbuf=32k');
        const local = newStatusIndicator();
        const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:40500|control-mode=manual');
        const transport = track(new ReceiveDestinationTransport(channel, context, local, endpoint));
        expect(transport.socketRcvbufLength()).toBe(endpoint.socketRcvbufLength());
        expect(transport.socketSndbufLength()).toBe(endpoint.socketSndbufLength());
        expect(transport.hasExplicitControl()).toBe(true);
        expect(transport.explicitControlAddress()?.getPort()).toBe(40500);

        transport.openChannel(local);
        transport.indicateActive();
        expect(local.get()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(assertThrows(IllegalStateException, () => transport.indicateActive()).message).toBe(
            'channel cannot be registered unless INITIALIZING: status=ACTIVE',
        );

        transport.timeOfLastActivityNs(1234);
        expect(transport.timeOfLastActivityNs()).toBe(1234);
        transport.currentControlAddress(new InetSocketAddress(LOOPBACK, 40501));
        expect(transport.explicitControlAddress()?.getPort()).toBe(40501);
        expect(transport.udpChannel()).toBe(channel);
        expect(transport.toString()).toContain('ReceiveDestinationTransport{currentControlAddress=');

        // closing closes the indicator
        transport.close();
        expect(local.isClosed()).toBe(true);
    });
});

describe('DataTransportPoller', () => {
    function newDataPoller(): DataTransportPoller {
        return track(new DataTransportPoller(context.countedErrorHandler() as ErrorHandler));
    }

    it('takes one datagram from each transport per poll and returns the bytes received', () => {
        const poller = newDataPoller();
        const dispatcherA = newDispatcher();
        const offsetsA: number[] = [];
        dispatcherA.onDataPacket.mockImplementation((_endpoint, header) => {
            offsetsA.push(header.termOffset());
            return 0;
        });
        const dispatcherB = newDispatcher();
        const a = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcherA);
        const b = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcherB);
        poller.registerForRead(a, a, 0);
        poller.registerForRead(b, b, 3);

        for (let i = 0; i < 3; i++) {
            a.onMessage(dataFrame(1, 2, 3, i * 32), rinfo(5000));
        }
        b.onMessage(dataFrame(1, 2, 3, 0, 64), rinfo(5001));

        expect(poller.pollTransports()).toBe(32 + 64);
        expect(dispatcherA.onDataPacket).toHaveBeenCalledTimes(1);
        expect(dispatcherB.onDataPacket).toHaveBeenCalledTimes(1);
        expect(dispatcherB.onDataPacket.mock.calls[0]?.[5]).toBe(3); // the transport index of the registration
        expect(poller.pollTransports()).toBe(32);
        expect(poller.pollTransports()).toBe(32);
        expect(poller.pollTransports()).toBe(0);
        expect(dispatcherA.onDataPacket).toHaveBeenCalledTimes(3);
        expect(dispatcherB.onDataPacket).toHaveBeenCalledTimes(1);
        // in order (mutation: the poller takes the newest first)
        expect(offsetsA).toEqual([0, 32, 64]);
    });

    it('routes by frame type: data and padding, setup and RTT measurement; any other valid frame is ignored; an invalid one is counted', () => {
        const poller = newDataPoller();
        const dispatcher = newDispatcher();
        const endpoint = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcher);
        poller.registerForRead(endpoint, endpoint, 0);
        const send = (bytes: Uint8Array): void => {
            endpoint.onMessage(bytes, rinfo());
            poller.pollTransports();
        };

        send(dataFrame(1, 2, 3, 0));
        const pad = dataFrame(1, 2, 3, 32);
        new HeaderFlyweight(new UnsafeBuffer(pad)).headerType(HeaderFlyweight.HDR_TYPE_PAD);
        send(pad);
        expect(dispatcher.onDataPacket).toHaveBeenCalledTimes(2);

        send(setupFrame(1, 2));
        expect(dispatcher.onSetupMessage).toHaveBeenCalledTimes(1);

        send(rttFrame(1, 2, 0, 0));
        expect(dispatcher.onRttMeasurement).toHaveBeenCalledTimes(1);

        // control frames are valid but are not for the data poller
        send(smFrame(1, 2));
        send(nakFrame(1, 2));
        expect(counterValue(SystemCounterDescriptor.INVALID_PACKETS)).toBe(0);
        expect(dispatcher.onDataPacket).toHaveBeenCalledTimes(2);

        // too short, wrong version
        send(new Uint8Array(7));
        const wrongVersion = dataFrame(1, 2, 3, 0);
        new HeaderFlyweight(new UnsafeBuffer(wrongVersion)).version(9);
        send(wrongVersion);
        expect(counterValue(SystemCounterDescriptor.INVALID_PACKETS)).toBe(2);
        expect(dispatcher.onDataPacket).toHaveBeenCalledTimes(2);
    });

    it('reports an error of one transport to the error handler and goes on with the others, in the same poll and the next', () => {
        const poller = newDataPoller();
        const failing = newDispatcher();
        failing.onDataPacket.mockImplementation(() => {
            throw new Error('dispatch failed');
        });
        const good = newDispatcher();
        const a = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', failing);
        const b = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', good);
        poller.registerForRead(a, a, 0);
        poller.registerForRead(b, b, 0);
        a.onMessage(dataFrame(1, 2, 3, 0), rinfo());
        b.onMessage(dataFrame(1, 2, 3, 0), rinfo());

        expect(poller.pollTransports()).toBe(64);

        expect(errors.map((e) => e.message)).toEqual(['dispatch failed']);
        expect(good.onDataPacket).toHaveBeenCalledTimes(1);
        b.onMessage(dataFrame(1, 2, 3, 32), rinfo());
        expect(poller.pollTransports()).toBe(32);
        expect(good.onDataPacket).toHaveBeenCalledTimes(2);
    });

    it('registering a transport that is not open fails with ClosedChannelException and registers nothing', () => {
        const poller = newDataPoller();
        const endpoint = track(
            new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
                newDispatcher(),
                newStatusIndicator(),
                context,
            ),
        );

        assertThrows(ClosedChannelException, () => poller.registerForRead(endpoint, endpoint, 0));
        expect(poller.pollTransports()).toBe(0);
    });

    it('cancelRead stops the polling of that transport only; cancelReadForAllTransports stops every transport of an endpoint', () => {
        const poller = newDataPoller();
        const dispatcher = newDispatcher();
        const a = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcher);
        const b = newReceiveEndpoint('aeron:udp?endpoint=127.0.0.1:0', dispatcher);
        const destination = track(
            new ReceiveDestinationTransport(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
                context,
                newStatusIndicator(),
                a,
            ),
        );
        destination.openChannel(newStatusIndicator());
        poller.registerForRead(a, a, 0);
        poller.registerForRead(a, destination, 1);
        poller.registerForRead(b, b, 0);
        const feed = (): void => {
            a.onMessage(dataFrame(1, 2, 3, 0), rinfo());
            destination.onMessage(dataFrame(1, 2, 3, 0), rinfo());
            b.onMessage(dataFrame(1, 2, 3, 0), rinfo());
        };

        feed();
        expect(poller.pollTransports()).toBe(96);

        poller.cancelRead(a, destination);
        feed();
        expect(poller.pollTransports()).toBe(64); // a and b, not the destination (its datagram stays in its ring)

        poller.cancelReadForAllTransports(a);
        feed();
        expect(poller.pollTransports()).toBe(32); // b only

        poller.cancelRead(a, destination); // already gone: nothing happens
        poller.cancelReadForAllTransports(a);
        expect(poller.pollTransports()).toBe(0);
    });

    it('close closes every endpoint it polls, reports one that fails to close and still closes the rest', () => {
        const poller = newDataPoller();
        const a = newReceiveEndpoint();
        const b = newReceiveEndpoint();
        const c = newReceiveEndpoint();
        poller.registerForRead(a, a, 0);
        poller.registerForRead(b, b, 0);
        poller.registerForRead(c, c, 0);
        const closeB = vi.spyOn(b, 'close').mockImplementation(() => {
            throw new Error('close failed');
        });

        poller.close();

        expect(a.sendDatagramChannel).not.toBeNull(); // close() keeps the socket field, but the transport is closed:
        expect(a.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32)).toBe(0);
        expect(c.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32)).toBe(0);
        expect(closeB).toHaveBeenCalledTimes(1);
        closeB.mockRestore();
        expect(errors.map((e) => e.message)).toEqual(['close failed']);
        expect(poller.pollTransports()).toBe(0); // forgotten
    });

    it('checkForReResolutions asks every endpoint', () => {
        const poller = newDataPoller();
        const a = newReceiveEndpoint();
        const b = newReceiveEndpoint();
        poller.registerForRead(a, a, 0);
        poller.registerForRead(b, b, 0);
        const spyA = vi.spyOn(a, 'checkForReResolution');
        const spyB = vi.spyOn(b, 'checkForReResolution');
        const proxy = newProxy();

        poller.checkForReResolutions(42, proxy);

        expect(spyA).toHaveBeenCalledWith(42, proxy);
        expect(spyB).toHaveBeenCalledWith(42, proxy);
        expect(poller.toString()).toBe('DataTransportPoller{}');
    });
});

describe('ControlTransportPoller', () => {
    it('routes by frame type: NAK, status message, error, RTT measurement and response setup; data frames are ignored', () => {
        const proxy = newProxy();
        const poller = track(new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, proxy));
        const endpoint = newSendEndpoint();
        endpoint.openDatagramChannel(null);
        poller.registerForRead(endpoint);
        const publication = newPublication(7, 8);
        endpoint.registerForSend(publication);
        const send = (bytes: Uint8Array): number => {
            endpoint.onMessage(bytes, rinfo(40001));
            return poller.pollTransports();
        };

        expect(send(nakFrame(7, 8))).toBe(NakFlyweight.HEADER_LENGTH);
        expect(publication.onNak).toHaveBeenCalledTimes(1);
        send(smFrame(7, 8));
        expect(publication.onStatusMessage).toHaveBeenCalledTimes(1);
        expect(publication.onStatusMessage.mock.calls[0]?.[2]).toBe(proxy);
        send(errorFrame(7, 8));
        expect(publication.onError).toHaveBeenCalledTimes(1);
        send(rttFrame(7, 8, 0, 0));
        expect(publication.onRttMeasurement).toHaveBeenCalledTimes(1);
        publication.responseCorrelationId.mockReturnValue(55);
        send(responseSetupFrame(7, 8, 66));
        expect(proxy.responseSetup).toHaveBeenCalledWith(55, 66);

        send(dataFrame(7, 8, 1, 0));
        send(setupFrame(7, 8));
        expect(counterValue(SystemCounterDescriptor.INVALID_PACKETS)).toBe(0);
        expect(calledMembers(publication).sort()).toEqual(
            [
                'onError',
                'onNak',
                'onRttMeasurement',
                'onStatusMessage',
                'responseCorrelationId',
                'sessionId',
                'streamId',
                'termBufferLength',
                'isValidStatusMessage',
            ].sort(),
        );
        expect(poller.toString()).toBe('ControlTransportPoller{}');
    });

    it('reports an error of an endpoint and goes on; cancelRead stops the polling of that endpoint', () => {
        const poller = track(new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, newProxy()));
        const bad = newSendEndpoint();
        const good = newSendEndpoint();
        bad.openDatagramChannel(null);
        good.openDatagramChannel(null);
        poller.registerForRead(bad);
        poller.registerForRead(good);
        const failing = newPublication(7, 8);
        failing.onNak.mockImplementation(() => {
            throw new Error('nak failed');
        });
        bad.registerForSend(failing);
        const fine = newPublication(7, 8);
        good.registerForSend(fine);
        bad.onMessage(nakFrame(7, 8), rinfo(40001));
        good.onMessage(nakFrame(7, 8), rinfo(40001));

        poller.pollTransports();

        expect(errors.map((e) => e.message)).toEqual(['nak failed']);
        expect(fine.onNak).toHaveBeenCalledTimes(1);

        poller.cancelRead(good);
        good.onMessage(nakFrame(7, 8), rinfo(40001));
        expect(poller.pollTransports()).toBe(0);
        expect(fine.onNak).toHaveBeenCalledTimes(1);
    });

    it('registering an endpoint that is not open fails; close closes the endpoints; checkForReResolutions asks each', () => {
        const proxy = newProxy();
        const poller = track(new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, proxy));
        const closed = newSendEndpoint();
        assertThrows(ClosedChannelException, () => poller.registerForRead(closed));

        const endpoint = newSendEndpoint();
        endpoint.openDatagramChannel(null);
        poller.registerForRead(endpoint);
        const spy = vi.spyOn(endpoint, 'checkForReResolution');
        poller.checkForReResolutions(7, proxy);
        expect(spy).toHaveBeenCalledWith(7, proxy);

        poller.close();
        expect(endpoint.send(new UnsafeBuffer(new Uint8Array(32)), 0, 32)).toBe(0);
        expect(poller.pollTransports()).toBe(0);
    });
});

describe('endpoints over loopback (the real path)', () => {
    async function roundTrip(host: string, uriHost: string): Promise<void> {
        const dispatcher = newDispatcher();
        const seen: number[] = [];
        dispatcher.onDataPacket.mockImplementation((_endpoint, header) => {
            seen.push(header.termOffset());
            return 0;
        });
        const smSeen: number[] = [];
        const publication = newPublication(7, 8);
        publication.onStatusMessage.mockImplementation(() => {
            smSeen.push(1);
        });

        const port = freeUdpPort();
        const receive = track(
            new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=' + uriHost + ':' + port),
                dispatcher,
                newStatusIndicator(),
                context,
            ),
        );
        const send = track(
            new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=' + uriHost + ':' + port + '|interface=' + uriHost),
                newStatusIndicator(),
                context,
            ),
        );
        send.registerForSend(publication);
        receive.openDatagramChannel(null);
        send.openDatagramChannel(null);
        const dataPoller = track(new DataTransportPoller(context.countedErrorHandler() as ErrorHandler));
        const controlPoller = track(
            new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, newProxy()),
        );
        dataPoller.registerForRead(receive, receive, 0);
        controlPoller.registerForRead(send);

        // a burst of frames from the sender, every one delivered once and in order
        const buffer = new UnsafeBuffer(new Uint8Array(32));
        const frame = new DataHeaderFlyweight(buffer);
        frame
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(32);
        frame.sessionId(7).streamId(8).termId(1);
        const count = 100;
        let sent = 0;
        await waitUntil(() => {
            while (sent < count) {
                frame.termOffset(sent * 32);
                if (32 !== send.send(buffer, 0, 32)) {
                    break; // short send: libuv holds a datagram; try again after a turn
                }
                sent++;
            }
            dataPoller.pollTransports();
            return seen.length >= count;
        }, count + ' data frames at the receiver');
        expect(seen).toEqual(Array.from({ length: count }, (_, i) => i * 32));

        // and a status message back, from the receiver to the sender
        const senderPort = portOf(send.receiveDatagramChannel());
        const connection = [new ImageConnection(0, new InetSocketAddress(InetAddress.getByName(host), senderPort))];
        receive.sendStatusMessage(connection, 7, 8, 5, 0, 1000, 0);
        await waitUntil(() => {
            controlPoller.pollTransports();
            return smSeen.length >= 1;
        }, 'the status message at the sender');
        expect(smSeen).toHaveLength(1);
        expect(errors).toEqual([]);
    }

    it('IPv4: a burst of data frames is delivered once and in order, and a status message comes back', async () => {
        await roundTrip(LOOPBACK, LOOPBACK);
    });

    it('IPv6: the same over [::1]', async (ctx) => {
        if (!hasIpv6Loopback()) {
            ctx.skip();
        }
        await roundTrip('::1', '[::1]');
    });
});

describe('suppliers, Configuration and the Context', () => {
    afterEach(() => {
        System.clearProperty(Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
        System.clearProperty(Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
    });

    it('the default suppliers create the default endpoints', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001');
        const send = track(
            new DefaultSendChannelEndpointSupplier().newInstance(udpChannel, newStatusIndicator(), context),
        );
        expect(send).toBeInstanceOf(SendChannelEndpoint);
        expect(send.constructor).toBe(SendChannelEndpoint);

        const dispatcher = newDispatcher();
        const receive = track(
            new DefaultReceiveChannelEndpointSupplier().newInstance(
                udpChannel,
                dispatcher,
                newStatusIndicator(),
                context,
            ),
        );
        expect(receive).toBeInstanceOf(ReceiveChannelEndpoint);
        expect(receive.dispatcher()).toBe(dispatcher);
    });

    it('Configuration reads the suppliers: the default without a property or by its class name, any other name is a ClassNotFoundException', () => {
        expect(Configuration.sendChannelEndpointSupplier()).toBeInstanceOf(DefaultSendChannelEndpointSupplier);
        expect(Configuration.receiveChannelEndpointSupplier()).toBeInstanceOf(DefaultReceiveChannelEndpointSupplier);

        System.setProperty(
            Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME,
            'io.aeron.driver.DefaultSendChannelEndpointSupplier',
        );
        System.setProperty(
            Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME,
            'io.aeron.driver.DefaultReceiveChannelEndpointSupplier',
        );
        expect(Configuration.sendChannelEndpointSupplier()).toBeInstanceOf(DefaultSendChannelEndpointSupplier);
        expect(Configuration.receiveChannelEndpointSupplier()).toBeInstanceOf(DefaultReceiveChannelEndpointSupplier);

        System.setProperty(Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME, 'com.example.Nope');
        System.setProperty(Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME, 'com.example.Nada');
        expect(assertThrows(ClassNotFoundException, () => Configuration.sendChannelEndpointSupplier()).message).toBe(
            'com.example.Nope',
        );
        expect(assertThrows(ClassNotFoundException, () => Configuration.receiveChannelEndpointSupplier()).message).toBe(
            'com.example.Nada',
        );
    });

    it('conclude creates the suppliers, the thread locals and the data transport poller, and keeps the ones it is given', () => {
        expect(context.sendChannelEndpointSupplier()).toBeInstanceOf(DefaultSendChannelEndpointSupplier);
        expect(context.receiveChannelEndpointSupplier()).toBeInstanceOf(DefaultReceiveChannelEndpointSupplier);
        expect(context.receiveChannelEndpointThreadLocals()).toBeInstanceOf(ReceiveChannelEndpointThreadLocals);
        expect(context.dataTransportPoller()).toBeInstanceOf(DataTransportPoller);
        expect(context.controlTransportPoller()).toBeInstanceOf(ControlTransportPoller);

        const sendSupplier = new DefaultSendChannelEndpointSupplier();
        const receiveSupplier = new DefaultReceiveChannelEndpointSupplier();
        const threadLocals = new ReceiveChannelEndpointThreadLocals();
        const poller = new DataTransportPoller({ onError: () => {} });
        const own = new MediaDriver.Context()
            .sendChannelEndpointSupplier(sendSupplier)
            .receiveChannelEndpointSupplier(receiveSupplier)
            .receiveChannelEndpointThreadLocals(threadLocals)
            .dataTransportPoller(poller)
            .conclude();
        expect(own.sendChannelEndpointSupplier()).toBe(sendSupplier);
        expect(own.receiveChannelEndpointSupplier()).toBe(receiveSupplier);
        expect(own.receiveChannelEndpointThreadLocals()).toBe(threadLocals);
        expect(own.dataTransportPoller()).toBe(poller);
        own.close();
    });

    it('the send slot length of the transport and Configuration.MAX_UDP_PAYLOAD_LENGTH are one value (they do not import each other)', () => {
        expect(SetupFlyweight.MAX_UDP_PAYLOAD_LENGTH).toBe(Configuration.MAX_UDP_PAYLOAD_LENGTH);
        expect(CommonContext.ENDPOINT_PARAM_NAME).toBe('endpoint');
        CloseHelper.close(null);
    });
});
