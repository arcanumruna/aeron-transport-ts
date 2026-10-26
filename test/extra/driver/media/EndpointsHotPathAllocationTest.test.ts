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
// Extra tests of T13 (port-only, spec 5.3): the endpoint paths that run for every datagram allocate nothing in the port's
// own code. Receive: a datagram in the ring of a transport, one poll of the data poller (ring pop and copy, frame
// validation, type routing, the endpoint callback, the dispatcher call), and the same for the control poller. Send: the
// connected send with and without the channel send timestamp, the send to an address, the round robin of the multi
// destinations, and the receiver's status message, NAK, RTT measurement and setup eliciting frames. The dispatcher, the
// publication and the socket are plain objects (a `vi.fn` records its calls, which allocates). Node's own allocation per
// datagram (the `Buffer` and `rinfo` of a 'message' event, the send request) is outside these loops (spec 5.3).
import type { Socket } from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorHandler } from '../../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { ByteOrder, Integer } from '../../../../src/agrona/jdk.js';
import { ChannelUri } from '../../../../src/client/ChannelUri.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../../../src/client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { ResponseSetupFlyweight } from '../../../../src/client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import type { DataPacketDispatcher } from '../../../../src/driver/DataPacketDispatcher.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../../../src/driver/media/DataTransportPoller.js';
import { ImageConnection } from '../../../../src/driver/media/ImageConnection.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import {
    asNetworkPublication,
    type EndpointPublication as NetworkPublication,
} from '../../../support/PublicationFakes.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { newPlainConductorProxy } from '../../../support/ConductorProxyFake.js';
import { expectNoAllocation } from '../../../support/Allocation.js';

const { LITTLE_ENDIAN } = ByteOrder;
const LOOPBACK = '127.0.0.1';
const ITERATIONS = 500_000;

/** A dispatcher that counts what it is given. */
class CountingDispatcher {
    public data = 0;
    public setup = 0;
    public rtt = 0;

    public onDataPacket(): number {
        this.data++;
        return 0;
    }

    public onSetupMessage(): void {
        this.setup++;
    }

    public onRttMeasurement(): void {
        this.rtt++;
    }
}

/** A publication that counts what it is given. */
class CountingPublication implements NetworkPublication {
    public calls = 0;

    private readonly session: number;
    private readonly stream: number;
    public constructor(session: number, stream: number) {
        this.session = session;
        this.stream = stream;
    }

    public sessionId(): number {
        return this.session;
    }

    public streamId(): number {
        return this.stream;
    }

    public termBufferLength(): number {
        return 64 * 1024;
    }

    public isValidStatusMessage(): boolean {
        return true;
    }

    public timeOfLastStatusMessageNs(): number {
        return 0;
    }

    public triggerSendSetupFrame(): void {
        this.calls++;
    }

    public onStatusMessage(): void {
        this.calls++;
    }

    public onError(): void {
        this.calls++;
    }

    public onNak(): void {
        this.calls++;
    }

    public onRttMeasurement(): void {
        this.calls++;
    }

    public responseCorrelationId(): number {
        return -1;
    }
}

/** A socket that takes a datagram and does nothing, so that the loops measure this port's own code. */
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

const proxy = newPlainConductorProxy();

function bytesOf(length: number, build: (buffer: UnsafeBuffer) => void): Uint8Array {
    const bytes = new Uint8Array(length);
    build(new UnsafeBuffer(bytes));
    return bytes;
}

const rinfo = { address: LOOPBACK, family: 'IPv4' as const, port: 5000, size: 0 };

let context: MediaDriver.Context;
let errors: Error[];
let closeables: { close(): void }[];

function countersManager(ctx: MediaDriver.Context = context): CountersManager {
    return ctx.countersManager() as CountersManager;
}

function status(): AtomicCounter {
    return countersManager().newCounter('status');
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
    expect(errors).toEqual([]);
});

function newReceive(dispatcher: CountingDispatcher, uri = 'aeron:udp?endpoint=127.0.0.1:0'): ReceiveChannelEndpoint {
    const endpoint = new ReceiveChannelEndpoint(
        UdpChannel.parse(uri),
        dispatcher as unknown as DataPacketDispatcher,
        status(),
        context,
    );
    closeables.push(endpoint);
    endpoint.openDatagramChannel(null);
    return endpoint;
}

function newSend(uri = 'aeron:udp?endpoint=127.0.0.1:40001', ctx: MediaDriver.Context = context): SendChannelEndpoint {
    const endpoint = new SendChannelEndpoint(UdpChannel.parse(uri), countersManager(ctx).newCounter('status'), ctx);
    closeables.push(endpoint);
    endpoint.openDatagramChannel(null);
    const real = endpoint.sendDatagramChannel as Socket;
    endpoint.sendDatagramChannel = new SinkSocket() as unknown as Socket;
    endpoint._receiveDatagramChannel = real;
    return endpoint;
}

describe('the receive path of the data poller allocates nothing per datagram', () => {
    it('data frames: ring, copy, validation, routing, endpoint callback, dispatcher', async () => {
        const dispatcher = new CountingDispatcher();
        const endpoint = newReceive(dispatcher);
        const poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
        closeables.push(poller);
        poller.registerForRead(endpoint, endpoint, 0);
        const frame = bytesOf(128, (buffer) => {
            const header = new DataHeaderFlyweight(buffer);
            header
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_DATA)
                .frameLength(128);
            header.sessionId(Integer.MIN_VALUE).streamId(Integer.MAX_VALUE).termId(5).termOffset(64);
        });
        let bytes = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(frame, rinfo);
                bytes += poller.pollTransports();
            }
        }, ITERATIONS);

        expect(dispatcher.data).toBeGreaterThan(ITERATIONS);
        expect(bytes).toBe(dispatcher.data * 128);
    });

    it('setup, RTT measurement and padding frames', async () => {
        const dispatcher = new CountingDispatcher();
        const endpoint = newReceive(dispatcher);
        const poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
        closeables.push(poller);
        poller.registerForRead(endpoint, endpoint, 0);
        const setup = bytesOf(SetupFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new SetupFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
                .frameLength(SetupFlyweight.HEADER_LENGTH);
            flyweight
                .sessionId(1)
                .streamId(2)
                .termOffset(0)
                .termLength(64 * 1024)
                .mtuLength(1408);
        });
        const rtt = bytesOf(RttMeasurementFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new RttMeasurementFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
                .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
            flyweight.sessionId(1).streamId(2).receiverIdHigh(0).receiverIdLow(0);
        });
        const pad = bytesOf(32, (buffer) => {
            new DataHeaderFlyweight(buffer)
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_PAD)
                .frameLength(32);
        });

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(setup, rinfo);
                endpoint.onMessage(rtt, rinfo);
                endpoint.onMessage(pad, rinfo);
                poller.pollTransports();
                poller.pollTransports();
                poller.pollTransports();
            }
        }, ITERATIONS);

        expect(dispatcher.setup).toBeGreaterThan(0);
        expect(dispatcher.rtt).toBeGreaterThan(0);
        expect(dispatcher.data).toBeGreaterThan(0);
    });
});

describe('the receive path of the control poller allocates nothing per datagram', () => {
    it('status messages, NAKs, errors and RTT measurements, for ids of any size', async () => {
        const endpoint = newSend();
        const poller = new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, proxy);
        closeables.push(poller);
        poller.registerForRead(endpoint);
        const publication = new CountingPublication(Integer.MIN_VALUE, Integer.MAX_VALUE);
        endpoint.registerForSend(asNetworkPublication(publication));
        const sm = bytesOf(StatusMessageFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new StatusMessageFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_SM)
                .frameLength(StatusMessageFlyweight.HEADER_LENGTH);
            flyweight
                .sessionId(Integer.MIN_VALUE)
                .streamId(Integer.MAX_VALUE)
                .consumptionTermId(5)
                .consumptionTermOffset(0)
                .receiverWindowLength(1000);
        });
        const nak = bytesOf(NakFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new NakFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_NAK)
                .frameLength(NakFlyweight.HEADER_LENGTH);
            flyweight.sessionId(Integer.MIN_VALUE).streamId(Integer.MAX_VALUE).termId(5).termOffset(0).length(64);
        });
        const error = bytesOf(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH, (buffer) => {
            const flyweight = new ErrorFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_ERR)
                .frameLength(ErrorFlyweight.HEADER_LENGTH);
            flyweight.sessionId(Integer.MIN_VALUE).streamId(Integer.MAX_VALUE).errorCode(1).errorMessage('x');
        });
        const rtt = bytesOf(RttMeasurementFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new RttMeasurementFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
                .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
            flyweight.sessionId(Integer.MIN_VALUE).streamId(Integer.MAX_VALUE);
        });
        const responseSetup = bytesOf(ResponseSetupFlyweight.HEADER_LENGTH, (buffer) => {
            const flyweight = new ResponseSetupFlyweight(buffer);
            flyweight
                .version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_RSP_SETUP)
                .frameLength(ResponseSetupFlyweight.HEADER_LENGTH);
            flyweight.sessionId(Integer.MIN_VALUE).streamId(Integer.MAX_VALUE).responseSessionId(3);
        });

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.onMessage(sm, rinfo);
                endpoint.onMessage(nak, rinfo);
                endpoint.onMessage(error, rinfo);
                endpoint.onMessage(rtt, rinfo);
                endpoint.onMessage(responseSetup, rinfo);
                for (let j = 0; j < 5; j++) {
                    poller.pollTransports();
                }
            }
        }, ITERATIONS / 5);

        expect(publication.calls).toBeGreaterThan(0);
    });
});

describe('the send path allocates nothing per datagram', () => {
    function beginFrames(buffer: UnsafeBuffer, count: number): void {
        const frames = new DataHeaderFlyweight();
        for (let i = 0; i < count; i++) {
            frames.wrap(buffer, i * 32, 32);
            frames
                .frameLength(32)
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_DATA);
        }
    }

    it('send to the connected address, and sendTo an address', async () => {
        const endpoint = newSend();
        const buffer = new UnsafeBuffer(new Uint8Array(1408));
        beginFrames(buffer, 4);
        const target = new InetSocketAddress(LOOPBACK, 4444);
        let sent = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sent += endpoint.send(buffer, 0, 1408);
                sent += endpoint.sendTo(buffer, 0, 1408, target);
            }
        }, ITERATIONS);

        expect(sent).toBeGreaterThan(0);
        expect(sent % 2816).toBe(0);
    });

    it('send with the channel send timestamp, the clock read once per packet as two halves (D17)', async () => {
        const stamped = new MediaDriver.Context().errorHandler({ onError: (e) => errors.push(e) }).conclude();
        closeables.push({ close: () => stamped.close() });
        const endpoint = newSend('aeron:udp?endpoint=127.0.0.1:40001|channel-snd-ts-offset=reserved', stamped);
        const buffer = new UnsafeBuffer(new Uint8Array(1408));
        beginFrames(buffer, 4);
        let sent = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sent += endpoint.send(buffer, 0, 128);
            }
        }, ITERATIONS);

        expect(sent % 128).toBe(0);
        // the first frame carries the timestamp of the clock (the reserved value field, as two halves)
        expect(buffer.getInt(24, LITTLE_ENDIAN) !== 0 || buffer.getInt(28, LITTLE_ENDIAN) !== 0).toBe(true);
    });

    it('manual and dynamic multi destination sends: the round robin, the activity check and the status message', async () => {
        const manual = newSend('aeron:udp?control-mode=manual');
        manual.allocateDestinationsCounterForMdc(
            new UnsafeBuffer(new Uint8Array(1024)),
            countersManager(),
            1,
            'aeron:udp?control-mode=manual',
        );
        for (let i = 0; i < 3; i++) {
            manual.addDestination(
                ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:' + (50001 + i)),
                new InetSocketAddress(LOOPBACK, 50001 + i),
                100 + i,
            );
        }
        const dynamic = newSend('aeron:udp?control=127.0.0.1:50000|control-mode=dynamic');
        dynamic.allocateDestinationsCounterForMdc(
            new UnsafeBuffer(new Uint8Array(1024)),
            countersManager(),
            2,
            'aeron:udp?control=127.0.0.1:50000|control-mode=dynamic',
        );
        const sm = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH)));
        sm.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SM)
            .frameLength(StatusMessageFlyweight.HEADER_LENGTH);
        sm.sessionId(1).streamId(2).consumptionTermId(0).consumptionTermOffset(0).receiverWindowLength(1000);
        const proxyArg = proxy;
        const addresses = [1, 2, 3].map((i) => new InetSocketAddress(LOOPBACK, 50000 + i));
        for (let i = 0; i < 3; i++) {
            sm.receiverIdHigh(i).receiverIdLow(i + 1);
            dynamic.onStatusMessage(
                sm,
                sm,
                StatusMessageFlyweight.HEADER_LENGTH,
                addresses[i] as InetSocketAddress,
                proxyArg,
            );
        }
        const buffer = new UnsafeBuffer(new Uint8Array(1408));
        let sent = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sent += manual.send(buffer, 0, 128);
                sent += dynamic.send(buffer, 0, 128);
                sm.receiverIdLow((i % 3) + 1);
                dynamic.onStatusMessage(
                    sm,
                    sm,
                    StatusMessageFlyweight.HEADER_LENGTH,
                    addresses[i % 3] as InetSocketAddress,
                    proxyArg,
                );
            }
        }, ITERATIONS / 2);

        expect(sent).toBeGreaterThan(0);
    });
});

describe("the receiver's frames allocate nothing per message", () => {
    function connections(): ImageConnection[] {
        return [new ImageConnection(0, new InetSocketAddress(LOOPBACK, 6001))];
    }

    it('status message (with and without a group tag), NAK, RTT measurement, setup eliciting message and response setup', async () => {
        const plain = newReceive(new CountingDispatcher());
        const tagged = newReceive(new CountingDispatcher(), 'aeron:udp?endpoint=127.0.0.1:0|gtag=4660');
        const plainSocket = new SinkSocket();
        const taggedSocket = new SinkSocket();
        plain.sendDatagramChannel = plainSocket as unknown as Socket;
        tagged.sendDatagramChannel = taggedSocket as unknown as Socket;
        const targets = connections();
        const source = new InetSocketAddress(LOOPBACK, 6001);
        const echo = 123456789012345n;
        const delta = 77n;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                plain.sendStatusMessage(targets, i, 2, 3, 4, 5000, 0);
                tagged.sendStatusMessage(targets, i, 2, 3, 4, 5000, 0);
                plain.sendNakMessage(targets, i, 2, 3, 4, 64);
                plain.sendRttMeasurement(targets, i, 2, echo, delta, true);
                plain.sendRttMeasurement(0, source, i, 2, echo, delta, false);
                plain.sendSetupElicitingStatusMessage(0, source, i, 2);
                plain.sendResponseSetup(targets, i, 2, 9);
            }
        }, ITERATIONS / 4);

        expect(plainSocket.sends).toBeGreaterThan(0);
        expect(taggedSocket.sends).toBeGreaterThan(0);
    });

    it('a short send (libuv holds a datagram) counts and allocates nothing', async () => {
        const endpoint = newReceive(new CountingDispatcher());
        const socket = {
            getSendQueueCount: () => 1,
            send: () => {},
            close: () => {},
        };
        endpoint.sendDatagramChannel = socket as unknown as Socket;
        const targets = connections();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                endpoint.sendStatusMessage(targets, i, 2, 3, 4, 5000, 0);
            }
        }, ITERATIONS);
    });
});
