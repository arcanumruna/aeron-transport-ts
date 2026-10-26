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
// Extra tests of T14 (port-only, spec 5.3): the receive path from the ring of a transport to the image allocates nothing
// per datagram. A datagram is put in the ring, one poll of the data poller takes it, the endpoint validates and routes it,
// and the real `DataPacketDispatcher` finds the stream and the session and calls the image (or ignores the datagram, as it
// does for a session it waits for or has no interest in). The image, the receiver, the conductor proxy and the socket are
// plain objects that count (a `vi.fn` records its calls, which allocates). A new session allocates, once, when its
// interest is first recorded: the loops here run on sessions that have their state already. The RTT reply is not in
// these loops: it reads the echo timestamp, a 64-bit wire value, as a `bigint` (spec 5.2), once per measurement.
import type { Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { Integer } from '../../../src/agrona/jdk.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';
import type { PublicationImage, Receiver } from '../../../src/driver/DataPacketDispatcher.js';
import { DataPacketDispatcher } from '../../../src/driver/DataPacketDispatcher.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { DataTransportPoller } from '../../../src/driver/media/DataTransportPoller.js';
import { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import type { DriverConductorProxy } from '../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const ITERATIONS = 500_000;
const STREAM = 1001;
const SRC = new InetSocketAddress('127.0.0.1', 5000);
const rinfo = { address: '127.0.0.1', family: 'IPv4' as const, port: 5000, size: 0 };

class CountingImage implements PublicationImage {
    public inserted = 0;
    public destinations = 0;
    public rtts = 0;

    public constructor(
        private readonly session: number,
        private readonly stream: number,
    ) {}

    public sessionId(): number {
        return this.session;
    }

    public streamId(): number {
        return this.stream;
    }

    public correlationId(): number {
        return 77;
    }

    public isEndOfStream(): boolean {
        return false;
    }

    public activate(): void {}

    public deactivate(): void {}

    public insertPacket(_termId: number, _termOffset: number, _buffer: UnsafeBuffer, length: number): number {
        this.inserted++;
        return length;
    }

    public addDestinationConnectionIfUnknown(): void {
        this.destinations++;
    }

    public onRttMeasurement(): void {
        this.rtts++;
    }
}

class SinkSocket {
    public sends = 0;

    public getSendQueueCount(): number {
        return 0;
    }

    public send(): void {
        this.sends++;
    }

    public close(): void {}
}

const receiver: Receiver = { addPendingSetupMessage: () => {} };
const proxy: DriverConductorProxy = {
    reResolveEndpoint: () => {},
    reResolveControl: () => {},
    responseSetup: () => {},
    createPublicationImage: () => {},
};

function bytesOf(length: number, build: (buffer: UnsafeBuffer) => void): Uint8Array {
    const bytes = new Uint8Array(length);
    build(new UnsafeBuffer(bytes));
    return bytes;
}

function dataFrame(sessionId: number, streamId: number): Uint8Array {
    return bytesOf(128, (buffer) => {
        const header = new DataHeaderFlyweight(buffer);
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(128);
        header.sessionId(sessionId).streamId(streamId).termId(5).termOffset(64);
    });
}

function setupFrame(sessionId: number, streamId: number): Uint8Array {
    return bytesOf(SetupFlyweight.HEADER_LENGTH, (buffer) => {
        const flyweight = new SetupFlyweight(buffer);
        flyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
            .frameLength(SetupFlyweight.HEADER_LENGTH);
        flyweight
            .sessionId(sessionId)
            .streamId(streamId)
            .termOffset(0)
            .termLength(64 * 1024)
            .mtuLength(1408);
    });
}

function rttFrame(sessionId: number, streamId: number): Uint8Array {
    return bytesOf(RttMeasurementFlyweight.HEADER_LENGTH, (buffer) => {
        const flyweight = new RttMeasurementFlyweight(buffer);
        flyweight
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
            .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
        flyweight.sessionId(sessionId).streamId(streamId); // a request for all receivers
    });
}

let context: MediaDriver.Context;
let errors: Error[];
let endpoint: ReceiveChannelEndpoint;
let poller: DataTransportPoller;
let dispatcher: DataPacketDispatcher;
let socket: SinkSocket;

beforeEach(() => {
    errors = [];
    const handler: ErrorHandler = { onError: (e) => errors.push(e) };
    context = new MediaDriver.Context().errorHandler(handler).conclude();
    dispatcher = new DataPacketDispatcher(proxy, receiver, 10);
    endpoint = new ReceiveChannelEndpoint(
        UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
        dispatcher,
        (context.countersManager() as CountersManager).newCounter('status'),
        context,
    );
    endpoint.openDatagramChannel(null);
    socket = new SinkSocket();
    endpoint.sendDatagramChannel = socket as unknown as Socket;
    poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
    poller.registerForRead(endpoint, endpoint, 0);
});

afterEach(() => {
    poller.close();
    endpoint.close();
    context.close();
    expect(errors).toEqual([]);
});

/** A session with an image: the interest, the setup message and the image, as the conductor makes them. */
function withImage(sessionId: number): CountingImage {
    dispatcher.addSubscription(STREAM);
    dispatcher.onSetupMessage(endpoint, new SetupFlyweight(new UnsafeBuffer(setupFrame(sessionId, STREAM))), SRC, 0);
    const image = new CountingImage(sessionId, STREAM);
    dispatcher.addPublicationImage(image);
    return image;
}

describe('the receive path to the dispatcher allocates nothing per datagram', () => {
    it('data frames for an active image, for ids of any size', async () => {
        const image = withImage(Integer.MIN_VALUE + 1);
        const frame = dataFrame(Integer.MIN_VALUE + 1, STREAM);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(frame, rinfo);
                poller.pollTransports();
            }
        }, ITERATIONS);

        expect(image.inserted).toBeGreaterThan(ITERATIONS);
    });

    it('data frames of a session that waits for its setup message, of a session nobody subscribed to, and of a stream nobody subscribed to', async () => {
        dispatcher.addSubscription(STREAM, 5); // only session 5
        const pending = dataFrame(5, STREAM);
        const noInterest = dataFrame(6, STREAM);
        const noStream = dataFrame(7, 99);
        // the first frames record the interest (allocating, once) and elicit the setup message
        for (const frame of [pending, noInterest, noStream]) {
            endpoint.onMessage(frame, rinfo);
            poller.pollTransports();
        }
        expect(socket.sends).toBe(1);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(pending, rinfo);
                endpoint.onMessage(noInterest, rinfo);
                endpoint.onMessage(noStream, rinfo);
                poller.pollTransports();
                poller.pollTransports();
                poller.pollTransports();
            }
        }, ITERATIONS / 3);

        expect(socket.sends).toBe(1); // nothing was elicited again
    });

    it('setup messages for an active image, for a session that is being created and for a stream nobody subscribed to', async () => {
        const image = withImage(3);
        dispatcher.onSetupMessage(endpoint, new SetupFlyweight(new UnsafeBuffer(setupFrame(4, STREAM))), SRC, 0);
        const active = setupFrame(3, STREAM);
        const initializing = setupFrame(4, STREAM);
        const noStream = setupFrame(5, 99);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(active, rinfo);
                endpoint.onMessage(initializing, rinfo);
                endpoint.onMessage(noStream, rinfo);
                poller.pollTransports();
                poller.pollTransports();
                poller.pollTransports();
            }
        }, ITERATIONS / 3);

        expect(image.destinations).toBeGreaterThan(0);
    });

    it('RTT measurement requests for an image, for a session without one and for a stream nobody subscribed to', async () => {
        const image = withImage(3);
        const known = rttFrame(3, STREAM);
        const unknown = rttFrame(4, STREAM);
        const noStream = rttFrame(3, 99);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(known, rinfo);
                endpoint.onMessage(unknown, rinfo);
                endpoint.onMessage(noStream, rinfo);
                poller.pollTransports();
                poller.pollTransports();
                poller.pollTransports();
            }
        }, ITERATIONS / 3);

        expect(image.rtts).toBeGreaterThan(0);
    });
});
