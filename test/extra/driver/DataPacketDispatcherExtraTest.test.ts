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
// Extra tests of T14 (port-only): `DataPacketDispatcher`, `PendingSetupMessageFromSource` and `UnknownSubscriptionException`
// beyond Java's 16 tests. The state of a session (no interest, pending setup, init in progress, cool down, active) across
// every operation and every ordering the tests of Java do not reach, a seeded random run that checks the invariants of the
// dispatcher against a model of what was asked of it, and the real path: a `ReceiveChannelEndpoint` with the real
// dispatcher and a `SendChannelEndpoint` over loopback, from the first data frame of an unknown session, through the
// setup eliciting status message and the setup frame, to the data of the new image.
import type { Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { Integer } from '../../../src/agrona/jdk.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { AeronEvent } from '../../../src/client/exceptions/AeronEvent.js';
import { ControlProtocolException } from '../../../src/client/exceptions/ControlProtocolException.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import type { PublicationImage } from '../../../src/driver/PublicationImage.js';
import type { Receiver } from '../../../src/driver/Receiver.js';
import { DataPacketDispatcher, SessionState, StreamInterest } from '../../../src/driver/DataPacketDispatcher.js';
import { UnknownSubscriptionException } from '../../../src/driver/exceptions/UnknownSubscriptionException.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../../src/driver/media/DataTransportPoller.js';
import { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import {
    asNetworkPublication,
    type EndpointPublication as NetworkPublication,
} from '../../support/PublicationFakes.js';
import { SendChannelEndpoint } from '../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { PendingSetupMessageFromSource } from '../../../src/driver/PendingSetupMessageFromSource.js';
import { newFakeConductorProxy, type FakeConductorProxy } from '../../support/ConductorProxyFake.js';
import { assertThrows } from '../../support/Assertions.js';
import { type ImageFake, type ReceiverFake, asImageFake, asReceiverFake } from '../../support/PublicationFakes.js';
import { type Fake, calledMembers, mock } from '../../support/Mockito.js';
import { mulberry32 } from '../../support/Random.js';
import { FakeSocket, freeUdpPort, waitUntil } from '../../support/Udp.js';

const { ACTIVE, PENDING_SETUP_FRAME, INIT_IN_PROGRESS, ON_COOL_DOWN, NO_INTEREST } = SessionState;

const STREAM = 1010;
const OTHER_STREAM = 2020;
const LIMIT = 4;
const SRC = new InetSocketAddress('127.0.0.1', 4510);
const CONTROL = new InetSocketAddress('224.20.30.39', 54326);

function newImage(sessionId: number, streamId: number, correlationId: number): ImageFake {
    return asImageFake({
        sessionId: vi.fn<PublicationImage['sessionId']>(() => sessionId),
        streamId: vi.fn<PublicationImage['streamId']>(() => streamId),
        correlationId: vi.fn<PublicationImage['correlationId']>(() => correlationId),
        isEndOfStream: vi.fn<PublicationImage['isEndOfStream']>(() => false),
        activate: vi.fn<PublicationImage['activate']>(),
        deactivate: vi.fn<PublicationImage['deactivate']>(),
        insertPacket: vi.fn<PublicationImage['insertPacket']>(() => 0),
        addDestinationConnectionIfUnknown: vi.fn<PublicationImage['addDestinationConnectionIfUnknown']>(),
        onRttMeasurement: vi.fn<PublicationImage['onRttMeasurement']>(),
    });
}

function newProxy(): FakeConductorProxy {
    return newFakeConductorProxy();
}

function newReceiver(): ReceiverFake {
    return asReceiverFake({ addPendingSetupMessage: vi.fn<Receiver['addPendingSetupMessage']>() });
}

function dataFlyweight(sessionId: number, streamId: number, termId = 7, termOffset = 64): DataHeaderFlyweight {
    const header = new DataHeaderFlyweight(new UnsafeBuffer(new Uint8Array(DataHeaderFlyweight.HEADER_LENGTH)));
    header.sessionId(sessionId).streamId(streamId).termId(termId).termOffset(termOffset);
    return header;
}

function setupFlyweight(sessionId: number, streamId: number, ttl = 0, flags = 0): SetupFlyweight {
    const setup = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH)));
    setup
        .version(HeaderFlyweight.CURRENT_VERSION)
        .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
        .frameLength(SetupFlyweight.HEADER_LENGTH)
        .flags(flags);
    setup
        .sessionId(sessionId)
        .streamId(streamId)
        .initialTermId(11)
        .activeTermId(12)
        .termOffset(0)
        .termLength(64 * 1024);
    setup.mtuLength(1408).ttl(ttl);
    return setup;
}

function rttFlyweight(sessionId: number, streamId: number, flags: number): RttMeasurementFlyweight {
    const rtt = new RttMeasurementFlyweight(new UnsafeBuffer(new Uint8Array(RttMeasurementFlyweight.HEADER_LENGTH)));
    rtt.version(HeaderFlyweight.CURRENT_VERSION)
        .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
        .frameLength(RttMeasurementFlyweight.HEADER_LENGTH)
        .flags(flags);
    rtt.sessionId(sessionId).streamId(streamId).echoTimestampNs(123456789n);
    return rtt;
}

/** A buffer whose first frame has the end of stream flag, or not: what `DataHeaderFlyweight.isEndOfStream` reads. */
function packet(endOfStream: boolean): UnsafeBuffer {
    const buffer = new UnsafeBuffer(new Uint8Array(DataHeaderFlyweight.HEADER_LENGTH));
    new DataHeaderFlyweight(buffer)
        .version(HeaderFlyweight.CURRENT_VERSION)
        .headerType(HeaderFlyweight.HDR_TYPE_DATA)
        .flags(endOfStream ? DataHeaderFlyweight.BEGIN_AND_END_FLAGS | DataHeaderFlyweight.EOS_FLAG : 0xc0)
        .frameLength(DataHeaderFlyweight.HEADER_LENGTH);
    return buffer;
}

interface Fixture {
    proxy: FakeConductorProxy;
    receiver: ReceiverFake;
    dispatcher: DataPacketDispatcher;
    endpoint: ReceiveChannelEndpoint;
    sendSetup: Mock<ReceiveChannelEndpoint['sendSetupElicitingStatusMessage']>;
    sendRtt: Mock<ReceiveChannelEndpoint['sendRttMeasurement']>;
    ttlAsymmetry: Mock<ReceiveChannelEndpoint['possibleTtlAsymmetryEncountered']>;
}

function newFixture(multicast = false, multicastTtl = 0): Fixture {
    const proxy = newProxy();
    const receiver = newReceiver();
    const dispatcher = new DataPacketDispatcher(proxy, receiver, LIMIT);
    const endpoint = mock(ReceiveChannelEndpoint).mock;
    vi.mocked(endpoint.isMulticast).mockReturnValue(multicast);
    vi.mocked(endpoint.multicastTtl).mockReturnValue(multicastTtl);
    vi.mocked(endpoint.udpChannel).mockReturnValue({ remoteControl: () => CONTROL } as unknown as UdpChannel);
    return {
        proxy,
        receiver,
        dispatcher,
        endpoint,
        sendSetup: endpoint.sendSetupElicitingStatusMessage as Mock<
            ReceiveChannelEndpoint['sendSetupElicitingStatusMessage']
        >,
        sendRtt: vi.mocked(endpoint.sendRttMeasurement) as unknown as Mock<
            ReceiveChannelEndpoint['sendRttMeasurement']
        >,
        ttlAsymmetry: endpoint.possibleTtlAsymmetryEncountered as Mock<
            ReceiveChannelEndpoint['possibleTtlAsymmetryEncountered']
        >,
    };
}

describe('SessionState', () => {
    it('is the Java enum: names and ordinals in the Java order', () => {
        expect(SessionState.values().map((s) => s.name())).toEqual([
            'ACTIVE',
            'PENDING_SETUP_FRAME',
            'INIT_IN_PROGRESS',
            'ON_COOL_DOWN',
            'NO_INTEREST',
        ]);
        expect(SessionState.values().map((s) => s.ordinal())).toEqual([0, 1, 2, 3, 4]);
        expect(String(NO_INTEREST)).toBe('NO_INTEREST');
        expect(ACTIVE.ordinal()).toBe(0);
    });
});

describe('UnknownSubscriptionException', () => {
    it('is a ControlProtocolException with the error code UNKNOWN_SUBSCRIPTION', () => {
        const error = new UnknownSubscriptionException('no subscription for stream 7');
        expect(error).toBeInstanceOf(ControlProtocolException);
        expect(error.errorCode()).toBe(ErrorCode.UNKNOWN_SUBSCRIPTION);
        expect(error.message).toContain('no subscription for stream 7');
    });

    it('is what removing a subscription that does not exist throws, for the wildcard and for a session, and after the last removal', () => {
        const { dispatcher } = newFixture();
        expect(
            assertThrows(UnknownSubscriptionException, () => dispatcher.removeSubscription(STREAM)).message,
        ).toContain('no subscription for stream ' + STREAM);
        expect(
            assertThrows(UnknownSubscriptionException, () => dispatcher.removeSubscription(STREAM, 5)).message,
        ).toContain('no subscription for stream ' + STREAM);

        dispatcher.addSubscription(STREAM);
        dispatcher.removeSubscription(STREAM);
        assertThrows(UnknownSubscriptionException, () => dispatcher.removeSubscription(STREAM)); // mutation: the stream stays
        dispatcher.addSubscription(STREAM, 5);
        dispatcher.removeSubscription(STREAM, 5);
        assertThrows(UnknownSubscriptionException, () => dispatcher.removeSubscription(STREAM, 5));
    });
});

describe('DataPacketDispatcher: data', () => {
    it('ignores data for a stream without a subscription, and returns what the image applied for the data it dispatches', () => {
        const f = newFixture();
        expect(f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0)).toBe(0);
        expect(f.sendSetup).not.toHaveBeenCalled();

        const image = newImage(1, STREAM, 100);
        image.insertPacket.mockReturnValue(96);
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.addPublicationImage(image);
        const buffer = packet(false);
        expect(f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM, 8, 128), buffer, 96, SRC, 3)).toBe(96);
        expect(image.insertPacket).toHaveBeenCalledWith(8, 128, buffer, 96, 3, SRC);
    });

    it('data for a stream of another subscription goes nowhere', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(OTHER_STREAM);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();
        expect(calledMembers(f.receiver)).toEqual([]);
    });

    it('end of stream data does not elicit a setup message, and is not remembered as an interest', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);

        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(true), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();

        // the same session, now with ordinary data: the setup message is elicited (mutation: EOS data records an interest)
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(1);
    });

    it('session specific subscriptions: data of another session is NO_INTEREST until a subscription for it is added', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM, 5);

        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();

        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(5, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(1);
        expect(f.sendSetup).toHaveBeenCalledWith(0, SRC, 5, STREAM);

        // adding the subscription clears NO_INTEREST for that session
        f.dispatcher.addSubscription(STREAM, 6);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2);
        expect(f.sendSetup).toHaveBeenLastCalledWith(0, SRC, 6, STREAM);
    });

    it('adding the wildcard subscription clears NO_INTEREST and keeps the other states of the sessions', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM, 5);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0); // NO_INTEREST
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(5, STREAM), packet(false), 96, SRC, 0); // PENDING_SETUP_FRAME
        expect(f.sendSetup).toHaveBeenCalledTimes(1);

        f.dispatcher.addSubscription(STREAM);

        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2); // 6 is elicited now
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(5, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2); // 5 is still pending
    });

    it('elicits the setup message on the control address of a multicast transport, not at the sender of the data', () => {
        const f = newFixture(true);
        f.dispatcher.addSubscription(STREAM);

        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 2);

        expect(f.sendSetup).toHaveBeenCalledWith(2, CONTROL, 1, STREAM);
        expect(f.receiver.addPendingSetupMessage).toHaveBeenCalledWith(1, STREAM, 2, f.endpoint, false, CONTROL);
    });

    it('a data frame for a session in INIT_IN_PROGRESS or ON_COOL_DOWN neither elicits nor is dispatched', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), SRC, 0); // INIT_IN_PROGRESS
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();

        const image = newImage(2, STREAM, 7);
        f.dispatcher.addPublicationImage(image);
        f.dispatcher.removePublicationImage(image); // ON_COOL_DOWN
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(2, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();
        expect(image.insertPacket).not.toHaveBeenCalled();
    });
});

describe('DataPacketDispatcher: setup messages', () => {
    it('ignores a setup message for a stream without a subscription', () => {
        const f = newFixture();
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), SRC, 0);
        expect(calledMembers(f.proxy)).toEqual([]);
    });

    it('creates the image for a session it has no interest in yet, with the fields of the setup message', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(9, STREAM, 0, 0x80), SRC, 4);

        expect(f.proxy.createPublicationImage).toHaveBeenCalledTimes(1);
        expect(f.proxy.createPublicationImage).toHaveBeenCalledWith(
            9,
            STREAM,
            11,
            12,
            0,
            64 * 1024,
            1408,
            4,
            0x80,
            SRC,
            SRC,
            f.endpoint,
        );
    });

    it('a setup message for a session that is not subscribed to is NO_INTEREST, and is not forwarded', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM, 5);

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(6, STREAM), SRC, 0);
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(5, STREAM), SRC, 0);

        expect(f.proxy.createPublicationImage).toHaveBeenCalledTimes(1);
        expect(f.proxy.createPublicationImage.mock.calls[0]?.[0]).toBe(5);

        // NO_INTEREST for 6 means ordinary data does not elicit either
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(6, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();
    });

    it('a setup message for the pending session creates the image once, and for an active image adds the destination', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0); // PENDING_SETUP_FRAME

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), SRC, 0);
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), SRC, 0); // INIT_IN_PROGRESS: ignored
        expect(f.proxy.createPublicationImage).toHaveBeenCalledTimes(1);

        const image = newImage(1, STREAM, 100);
        f.dispatcher.addPublicationImage(image);
        const other = new InetSocketAddress('127.0.0.1', 4511);
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), other, 2);
        expect(image.addDestinationConnectionIfUnknown).toHaveBeenCalledWith(2, other);
        expect(f.proxy.createPublicationImage).toHaveBeenCalledTimes(1);
    });

    it('a multicast setup message sends the image the control address of the transport and counts a TTL that is too low', () => {
        const f = newFixture(true, 2);
        f.dispatcher.addSubscription(STREAM);

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM, 5), SRC, 1);
        expect(f.ttlAsymmetry).toHaveBeenCalledTimes(1);
        expect(f.proxy.createPublicationImage.mock.calls[0]?.[9]).toBe(CONTROL); // controlAddress
        expect(f.proxy.createPublicationImage.mock.calls[0]?.[10]).toBe(SRC); // srcAddress

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(2, STREAM, 2), SRC, 1); // the TTL of the transport is enough
        expect(f.ttlAsymmetry).toHaveBeenCalledTimes(1);
    });

    it('refuses a setup message at the session limit with an AeronEvent, whatever the session, and counts only active images', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        for (let session = 0; session < LIMIT; session++) {
            f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(session, STREAM), SRC, 0);
        }
        // images that are being created do not count
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(LIMIT, STREAM), SRC, 0);
        expect(f.proxy.createPublicationImage).toHaveBeenCalledTimes(LIMIT + 1);

        const images = [0, 1, 2, 3].map((session) => newImage(session, STREAM, 100 + session));
        images.forEach((image) => f.dispatcher.addPublicationImage(image));
        const error = assertThrows(AeronEvent, () =>
            f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(77, STREAM), SRC, 0),
        );
        expect(error.message).toContain('exceeded session limit, streamId=' + STREAM + ' sourceAddress=');

        // a setup message for an active image is refused too: the limit is checked first (as in Java)
        assertThrows(AeronEvent, () => f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(0, STREAM), SRC, 0));

        // removing an image makes room
        f.dispatcher.removePublicationImage(images[3] as PublicationImage);
        f.dispatcher.removeSessionInterestByState(3, STREAM, ON_COOL_DOWN);
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(77, STREAM), SRC, 0);
        expect(f.proxy.createPublicationImage).toHaveBeenLastCalledWith(
            77,
            STREAM,
            11,
            12,
            0,
            64 * 1024,
            1408,
            0,
            0,
            SRC,
            SRC,
            f.endpoint,
        );
    });

    it('the session limit is per stream', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.addSubscription(OTHER_STREAM);
        for (let session = 0; session < LIMIT; session++) {
            f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(session, STREAM), SRC, 0);
            f.dispatcher.addPublicationImage(newImage(session, STREAM, session));
        }

        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, OTHER_STREAM), SRC, 0);

        expect(f.proxy.createPublicationImage).toHaveBeenLastCalledWith(
            1,
            OTHER_STREAM,
            11,
            12,
            0,
            64 * 1024,
            1408,
            0,
            0,
            SRC,
            SRC,
            f.endpoint,
        );
    });
});

describe('DataPacketDispatcher: images and subscriptions', () => {
    it('adding an image for a stream with no subscription does nothing, not even activate it', () => {
        const f = newFixture();
        const image = newImage(1, STREAM, 100);
        f.dispatcher.addPublicationImage(image);
        expect(image.activate).not.toHaveBeenCalled();
    });

    it('removing an image deactivates it always, but leaves a newer image of the session active (correlation ids differ)', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        const old = newImage(1, STREAM, 100);
        const current = newImage(1, STREAM, 200);
        f.dispatcher.addPublicationImage(old);
        f.dispatcher.addPublicationImage(current);

        f.dispatcher.removePublicationImage(old);
        expect(old.deactivate).toHaveBeenCalledTimes(1);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(current.insertPacket).toHaveBeenCalledTimes(1);

        f.dispatcher.removePublicationImage(current);
        expect(current.deactivate).toHaveBeenCalledTimes(1);
        // removing an image of an unknown stream deactivates it and does not throw
        const stranger = newImage(1, 99, 1);
        f.dispatcher.removePublicationImage(stranger);
        expect(stranger.deactivate).toHaveBeenCalledTimes(1);
    });

    it('removing the wildcard subscription deactivates the images that no session subscription holds, and keeps the others', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.addSubscription(STREAM, 2);
        const held = newImage(2, STREAM, 20);
        const free = newImage(3, STREAM, 30);
        f.dispatcher.addPublicationImage(held);
        f.dispatcher.addPublicationImage(free);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(4, STREAM), packet(false), 96, SRC, 0); // PENDING for 4

        f.dispatcher.removeSubscription(STREAM);

        expect(free.deactivate).toHaveBeenCalledTimes(1);
        expect(held.deactivate).not.toHaveBeenCalled();
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(2, STREAM), packet(false), 96, SRC, 0);
        expect(held.insertPacket).toHaveBeenCalledTimes(1);
        // the interest of 4 was removed with the wildcard, and 4 is not subscribed to: its data is NO_INTEREST, nothing is elicited
        f.sendSetup.mockClear();
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(4, STREAM), packet(false), 96, SRC, 0);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(5, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).not.toHaveBeenCalled();
    });

    it('removing a session subscription under the wildcard keeps the image and the interest; without it deactivates the image', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.addSubscription(STREAM, 2);
        const image = newImage(2, STREAM, 20);
        f.dispatcher.addPublicationImage(image);

        f.dispatcher.removeSubscription(STREAM, 2);
        expect(image.deactivate).not.toHaveBeenCalled();
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(2, STREAM), packet(false), 96, SRC, 0);
        expect(image.insertPacket).toHaveBeenCalledTimes(1);

        const g = newFixture();
        g.dispatcher.addSubscription(STREAM, 2);
        const only = newImage(2, STREAM, 20);
        g.dispatcher.addPublicationImage(only);
        g.dispatcher.removeSubscription(STREAM, 2);
        expect(only.deactivate).toHaveBeenCalledTimes(1);
        assertThrows(UnknownSubscriptionException, () => g.dispatcher.removeSubscription(STREAM, 2));
        expect(g.dispatcher.shouldElicitSetupMessage()).toBe(false);
    });

    it('shouldElicitSetupMessage follows the subscriptions', () => {
        const f = newFixture();
        expect(f.dispatcher.shouldElicitSetupMessage()).toBe(false);
        f.dispatcher.addSubscription(STREAM);
        expect(f.dispatcher.shouldElicitSetupMessage()).toBe(true);
        f.dispatcher.addSubscription(OTHER_STREAM, 3);
        f.dispatcher.removeSubscription(STREAM);
        expect(f.dispatcher.shouldElicitSetupMessage()).toBe(true);
        f.dispatcher.removeSubscription(OTHER_STREAM, 3);
        expect(f.dispatcher.shouldElicitSetupMessage()).toBe(false);
    });

    it('removeSessionInterestByState removes the interest only when it is in that state', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0); // PENDING_SETUP_FRAME

        f.dispatcher.removeSessionInterestByState(1, STREAM, ON_COOL_DOWN); // another state: nothing
        f.dispatcher.removeSessionInterestByState(1, STREAM, NO_INTEREST);
        f.dispatcher.removeSessionInterestByState(1, STREAM, INIT_IN_PROGRESS);
        f.dispatcher.removeSessionInterestByState(2, STREAM, PENDING_SETUP_FRAME); // another session
        f.dispatcher.removeSessionInterestByState(1, 99, PENDING_SETUP_FRAME); // another stream
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(1);

        f.dispatcher.removeSessionInterestByState(1, STREAM, PENDING_SETUP_FRAME);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2);
    });

    it('StreamInterest: the session limit is a count of the active images', () => {
        const interest = new StreamInterest(true);
        expect(interest.isSessionLimitExceeded(0)).toBe(true);
        expect(interest.isSessionLimitExceeded(1)).toBe(false);
        interest.activeImageByIdMap.put(1, newImage(1, 1, 1));
        expect(interest.isSessionLimitExceeded(1)).toBe(true);
        expect(interest.findActive(1)).not.toBeNull();
        expect(interest.findActive(2)).toBeNull();
    });
});

describe('DataPacketDispatcher: RTT measurements', () => {
    it('a reply is answered at the sender of the measurement with the echo timestamp, a request goes to the image', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        const image = newImage(1, STREAM, 100);
        f.dispatcher.addPublicationImage(image);

        const request = rttFlyweight(1, STREAM, 0);
        f.dispatcher.onRttMeasurement(f.endpoint, request, SRC, 2);
        expect(image.onRttMeasurement).toHaveBeenCalledWith(request, 2, SRC);
        expect(f.sendRtt).not.toHaveBeenCalled();

        const reply = rttFlyweight(1, STREAM, RttMeasurementFlyweight.REPLY_FLAG);
        f.dispatcher.onRttMeasurement(f.endpoint, reply, SRC, 2);
        expect(f.sendRtt).toHaveBeenCalledWith(2, SRC, 1, STREAM, 123456789n, 0n, false);
        expect(image.onRttMeasurement).toHaveBeenCalledTimes(1);
    });

    it('a reply on a multicast transport is answered on the control address of the transport', () => {
        const f = newFixture(true);
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.addPublicationImage(newImage(1, STREAM, 100));

        f.dispatcher.onRttMeasurement(f.endpoint, rttFlyweight(1, STREAM, RttMeasurementFlyweight.REPLY_FLAG), SRC, 0);

        expect(f.sendRtt).toHaveBeenCalledWith(0, CONTROL, 1, STREAM, 123456789n, 0n, false);
    });

    it('a measurement for a stream or a session without an image is ignored', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.onRttMeasurement(f.endpoint, rttFlyweight(1, STREAM, 0), SRC, 0);
        f.dispatcher.onRttMeasurement(f.endpoint, rttFlyweight(1, 99, RttMeasurementFlyweight.REPLY_FLAG), SRC, 0);
        f.dispatcher.onRttMeasurement(f.endpoint, rttFlyweight(1, STREAM, RttMeasurementFlyweight.REPLY_FLAG), SRC, 0);
        expect(f.sendRtt).not.toHaveBeenCalled();
    });
});

describe('PendingSetupMessageFromSource', () => {
    it('keeps what it is given, asks the dispatcher of the endpoint, and removes only its PENDING_SETUP_FRAME interest', () => {
        const f = newFixture();
        f.dispatcher.addSubscription(STREAM);
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0); // PENDING_SETUP_FRAME
        vi.mocked(f.endpoint.dispatcher).mockReturnValue(f.dispatcher);

        const pending = new PendingSetupMessageFromSource(1, STREAM, 3, f.endpoint, true, SRC);
        expect([pending.sessionId(), pending.streamId(), pending.transportIndex(), pending.isPeriodic()]).toEqual([
            1,
            STREAM,
            3,
            true,
        ]);
        expect(pending.channelEndpoint()).toBe(f.endpoint);
        expect(pending.controlAddress()).toBe(SRC);
        expect(pending.timeOfStatusMessageNs()).toBe(0);
        expect(pending.shouldElicitSetupMessage()).toBe(true);

        const moved = new InetSocketAddress('127.0.0.1', 4999);
        pending.controlAddress(moved);
        pending.timeOfStatusMessageNs(Integer.MAX_VALUE * 4);
        expect(pending.controlAddress()).toBe(moved);
        expect(pending.timeOfStatusMessageNs()).toBe(Integer.MAX_VALUE * 4);
        expect(pending.toString()).toContain(
            'PendingSetupMessageFromSource{sessionId=1, streamId=1010, transportIndex=3, periodic=true',
        );

        pending.removeFromDataPacketDispatcher();
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2); // the interest was gone, so the data elicits again

        // an interest in another state is not removed
        f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(1, STREAM), SRC, 0); // INIT_IN_PROGRESS
        pending.removeFromDataPacketDispatcher();
        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(1, STREAM), packet(false), 96, SRC, 0);
        expect(f.sendSetup).toHaveBeenCalledTimes(2);

        f.dispatcher.removeSubscription(STREAM);
        expect(pending.shouldElicitSetupMessage()).toBe(false);
    });
});

describe('DataPacketDispatcher: a seeded random run keeps its invariants', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
        'seed %d: images get data only while active, one create request per interest, no elicit without interest',
        (seed) => {
            const random = mulberry32(seed);
            const pick = (n: number): number => Math.floor(random() * n);
            const f = newFixture();
            const wildcard = new Set<number>();
            const sessionSubs = new Map<number, Set<number>>();
            const images = new Map<string, ImageFake>(); // active images, by 'stream:session'
            const created = new Set<string>(); // create requests with no image yet
            const requestsBefore = (): number => f.proxy.createPublicationImage.mock.calls.length;
            let correlationId = 1000;
            let delivered = 0;
            let imagesAdded = 0;
            const streams = [STREAM, OTHER_STREAM];

            for (let step = 0; step < 4000; step++) {
                const stream = streams[pick(2)] as number;
                const session = pick(6);
                const key = stream + ':' + session;
                const subscribed = wildcard.has(stream) || (sessionSubs.get(stream)?.has(session) ?? false);
                switch (pick(9)) {
                    case 0:
                        f.dispatcher.addSubscription(stream);
                        wildcard.add(stream);
                        break;
                    case 1:
                        f.dispatcher.addSubscription(stream, session);
                        sessionSubs.set(stream, (sessionSubs.get(stream) ?? new Set<number>()).add(session));
                        break;
                    case 2:
                        if (wildcard.has(stream)) {
                            f.dispatcher.removeSubscription(stream);
                            wildcard.delete(stream);
                            for (const [imageKey, image] of [...images]) {
                                if (
                                    imageKey.startsWith(stream + ':') &&
                                    !(sessionSubs.get(stream)?.has(Number(imageKey.split(':')[1])) ?? false)
                                ) {
                                    images.delete(imageKey);
                                    expect(image.deactivate).toHaveBeenCalled();
                                }
                            }
                            // the interest of the sessions that no subscription holds is gone: a new setup message asks again
                            for (const createdKey of [...created]) {
                                if (
                                    createdKey.startsWith(stream + ':') &&
                                    !(sessionSubs.get(stream)?.has(Number(createdKey.split(':')[1])) ?? false)
                                ) {
                                    created.delete(createdKey);
                                }
                            }
                        }
                        break;
                    case 3: {
                        const before = f.sendSetup.mock.calls.length;
                        const eos = pick(4) === 0;
                        const buffer = packet(eos);
                        const image = images.get(key);
                        f.dispatcher.onDataPacket(f.endpoint, dataFlyweight(session, stream), buffer, 96, SRC, 0);
                        if (undefined !== image) {
                            expect(image.insertPacket).toHaveBeenCalled();
                            image.insertPacket.mockClear();
                            delivered++;
                        } else if (f.sendSetup.mock.calls.length > before) {
                            expect(subscribed, 'elicited without interest: ' + key).toBe(true);
                            expect(eos).toBe(false);
                        }
                        for (const other of images.values()) {
                            expect(other.insertPacket).not.toHaveBeenCalled(); // no other image saw the packet
                        }
                        break;
                    }
                    case 4: {
                        const before = requestsBefore();
                        const limitReached =
                            [...images.keys()].filter((k) => k.startsWith(stream + ':')).length >= LIMIT;
                        let thrown = false;
                        try {
                            f.dispatcher.onSetupMessage(f.endpoint, setupFlyweight(session, stream), SRC, 0);
                        } catch (e) {
                            thrown = e instanceof AeronEvent;
                            expect(thrown).toBe(true);
                        }
                        const streamHasInterest = wildcard.has(stream) || (sessionSubs.get(stream)?.size ?? 0) > 0;
                        expect(thrown).toBe(limitReached && streamHasInterest);
                        if (requestsBefore() > before) {
                            expect(created.has(key) || images.has(key), 'a second create request for ' + key).toBe(
                                false,
                            );
                            created.add(key);
                            expect(subscribed).toBe(true);
                        }
                        break;
                    }
                    case 5:
                        if (created.has(key)) {
                            const image = newImage(session, stream, ++correlationId);
                            f.dispatcher.addPublicationImage(image);
                            created.delete(key);
                            if (wildcard.has(stream) || (sessionSubs.get(stream)?.has(session) ?? false)) {
                                images.set(key, image);
                                expect(image.activate).toHaveBeenCalled();
                                imagesAdded++;
                            } else {
                                // the stream interest is gone: the image is not added
                                if (!wildcard.has(stream) && (sessionSubs.get(stream)?.size ?? 0) === 0) {
                                    expect(image.activate).not.toHaveBeenCalled();
                                } else {
                                    images.set(key, image);
                                }
                            }
                        }
                        break;
                    case 6: {
                        const image = images.get(key);
                        if (undefined !== image) {
                            image.isEndOfStream.mockReturnValue(pick(2) === 0);
                            f.dispatcher.removePublicationImage(image);
                            images.delete(key);
                            expect(image.deactivate).toHaveBeenCalled();
                        }
                        break;
                    }
                    case 7:
                        f.dispatcher.removeSessionInterestByState(
                            session,
                            stream,
                            [PENDING_SETUP_FRAME, ON_COOL_DOWN, NO_INTEREST][pick(3)] as SessionState,
                        );
                        break;
                    default: {
                        const set = sessionSubs.get(stream);
                        if (set?.has(session)) {
                            f.dispatcher.removeSubscription(stream, session);
                            set.delete(session);
                            if (!wildcard.has(stream)) {
                                created.delete(key); // the interest in the session goes with its subscription
                                const image = images.get(key);
                                if (undefined !== image) {
                                    images.delete(key);
                                    expect(image.deactivate).toHaveBeenCalled();
                                }
                            }
                        }
                    }
                }
            }

            // the run is not vacuous: every kind of event happened
            expect(delivered).toBeGreaterThan(20);
            expect(imagesAdded).toBeGreaterThan(5);
            expect(f.proxy.createPublicationImage.mock.calls.length).toBeGreaterThan(10);
            expect(f.sendSetup.mock.calls.length).toBeGreaterThan(10);
        },
    );
});

describe('the real path: a receive endpoint with the dispatcher, a send endpoint, over loopback', () => {
    let context: MediaDriver.Context;
    let errors: Error[];
    let closeables: { close(): void }[];

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
        expect(errors).toEqual([]);
    });

    function status(): AtomicCounter {
        return (context.countersManager() as CountersManager).newCounter('status');
    }

    it('data of an unknown session elicits a setup, the setup creates the image, and the data then reaches the image', async () => {
        const sessionId = Integer.MIN_VALUE + 3;
        const streamId = 1001;
        const proxy = newProxy();
        const receiver = newReceiver();
        const dispatcher = new DataPacketDispatcher(proxy, receiver, 10);
        dispatcher.addSubscription(streamId);

        const port = freeUdpPort();
        const receive = new ReceiveChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:' + port),
            dispatcher,
            status(),
            context,
        );
        const send = new SendChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:' + port + '|interface=127.0.0.1'),
            status(),
            context,
        );
        closeables.push(receive, send);
        receive.openDatagramChannel(null);
        send.openDatagramChannel(null);
        const dataPoller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
        const controlPoller = new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, newProxy());
        closeables.push(dataPoller, controlPoller);
        dataPoller.registerForRead(receive, receive, 0);
        controlPoller.registerForRead(send);

        // the sender's publication: it answers a setup eliciting status message with a setup frame
        let setupRequests = 0;
        const sendSetupFrame = (): void => {
            const frame = setupFlyweight(sessionId, streamId);
            setupRequests++;
            expect(send.send(frame, 0, SetupFlyweight.HEADER_LENGTH)).toBe(SetupFlyweight.HEADER_LENGTH);
        };
        // the poller reuses its flyweight, so the fields are read when the publication is called
        const triggers: { flags: number; sessionId: number; streamId: number }[] = [];
        const publication: Fake<NetworkPublication> = {
            sessionId: vi.fn<NetworkPublication['sessionId']>(() => sessionId),
            streamId: vi.fn<NetworkPublication['streamId']>(() => streamId),
            termBufferLength: vi.fn<NetworkPublication['termBufferLength']>(() => 64 * 1024),
            isValidStatusMessage: vi.fn<NetworkPublication['isValidStatusMessage']>(() => true),
            timeOfLastStatusMessageNs: vi.fn<NetworkPublication['timeOfLastStatusMessageNs']>(() => 0),
            triggerSendSetupFrame: vi.fn<NetworkPublication['triggerSendSetupFrame']>((msg) => {
                triggers.push({ flags: msg.flags(), sessionId: msg.sessionId(), streamId: msg.streamId() });
                sendSetupFrame();
            }),
            onStatusMessage: vi.fn<NetworkPublication['onStatusMessage']>(),
            onError: vi.fn<NetworkPublication['onError']>(),
            onNak: vi.fn<NetworkPublication['onNak']>(),
            onRttMeasurement: vi.fn<NetworkPublication['onRttMeasurement']>(),
            responseCorrelationId: vi.fn<NetworkPublication['responseCorrelationId']>(() => -1),
        };
        send.registerForSend(asNetworkPublication(publication));

        // the conductor: it makes an image for the request and adds it to the dispatcher
        const image = newImage(sessionId, streamId, 4242);
        const seen: number[] = [];
        image.insertPacket.mockImplementation((_termId, termOffset, _buffer, length) => {
            seen.push(termOffset);
            return length;
        });
        proxy.createPublicationImage.mockImplementation(() => {
            dispatcher.addPublicationImage(image);
        });

        // the first data frame of a session the receiver does not know
        const data = new UnsafeBuffer(new Uint8Array(32));
        const frame = new DataHeaderFlyweight(data);
        frame
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(32);
        frame.sessionId(sessionId).streamId(streamId).termId(5).termOffset(0);
        expect(send.send(data, 0, 32)).toBe(32);

        await waitUntil(() => {
            dataPoller.pollTransports();
            controlPoller.pollTransports();
            return proxy.createPublicationImage.mock.calls.length > 0;
        }, 'the image to be requested');

        // one setup eliciting status message went to the sender (SEND_SETUP flag, the session), and one setup came back
        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toEqual({ flags: StatusMessageFlyweight.SEND_SETUP_FLAG, sessionId, streamId });
        expect(setupRequests).toBe(1);
        expect(receiver.addPendingSetupMessage).toHaveBeenCalledTimes(1);
        expect(proxy.createPublicationImage.mock.calls[0]?.slice(0, 9)).toEqual([
            sessionId,
            streamId,
            11,
            12,
            0,
            64 * 1024,
            1408,
            0,
            0,
        ]);
        expect(image.activate).toHaveBeenCalledTimes(1);

        // and now the data of the session reaches the image, once each, in order
        const count = 50;
        let sent = 0;
        await waitUntil(() => {
            while (sent < count) {
                frame.termOffset(sent * 32);
                if (32 !== send.send(data, 0, 32)) {
                    break;
                }
                sent++;
            }
            dataPoller.pollTransports();
            return seen.length >= count;
        }, count + ' data frames at the image');
        expect(seen).toEqual(Array.from({ length: count }, (_, i) => i * 32));
        expect(triggers).toHaveLength(1); // no second elicit while the image is active
    });

    it('a real endpoint sends the setup eliciting status message of the dispatcher through the socket', () => {
        const proxy = newProxy();
        const receiver = newReceiver();
        const dispatcher = new DataPacketDispatcher(proxy, receiver, 10);
        dispatcher.addSubscription(1001);
        const receive = new ReceiveChannelEndpoint(
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
            dispatcher,
            status(),
            context,
        );
        closeables.push(receive);
        receive.openDatagramChannel(null);
        const socket = new FakeSocket();
        receive.sendDatagramChannel = socket as unknown as Socket;
        const poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
        closeables.push(poller);
        poller.registerForRead(receive, receive, 0);
        const bytes = new Uint8Array(32);
        const header = new DataHeaderFlyweight(new UnsafeBuffer(bytes));
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(32);
        header.sessionId(7).streamId(1001).termId(1).termOffset(0);

        receive.onMessage(bytes, { address: '127.0.0.1', family: 'IPv4', port: 5555, size: 32 });
        poller.pollTransports();

        expect(socket.sent).toHaveLength(1);
        expect(socket.sent[0]?.port).toBe(5555);
        const sm = new StatusMessageFlyweight(
            new UnsafeBuffer(Uint8Array.from(socket.sent[0]?.bytesAtSend as Uint8Array)),
        );
        expect(sm.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SM);
        expect(sm.flags()).toBe(StatusMessageFlyweight.SEND_SETUP_FLAG);
        expect([sm.sessionId(), sm.streamId()]).toEqual([7, 1001]);
        expect(receiver.addPendingSetupMessage).toHaveBeenCalledWith(7, 1001, 0, receive, false, expect.anything());
    });
});
