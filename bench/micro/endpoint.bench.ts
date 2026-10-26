// Micro benches of the per-datagram paths of the channel endpoints and the transport pollers (phase 2, T13, T14): the data
// poller (a datagram in the ring, one poll: pop and copy, frame validation, routing, the endpoint callback, a dispatcher
// that counts), the control poller (a status message to a publication that counts), the send of a packet on the connected
// socket with and without the channel send timestamp, and the receiver's status message with and without a group tag.
// With the real `DataPacketDispatcher` (T14) the data poller bench continues to the stream, the session and the image.
// The sockets take a datagram and do nothing, so the numbers are this port's own cost and not the kernel's.
import type { Socket } from 'node:dgram';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import type { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import type { DataPacketDispatcher, PublicationImage } from '../../src/driver/DataPacketDispatcher.js';
import { DataPacketDispatcher as RealDataPacketDispatcher } from '../../src/driver/DataPacketDispatcher.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ControlTransportPoller } from '../../src/driver/media/ControlTransportPoller.js';
import { DataTransportPoller } from '../../src/driver/media/DataTransportPoller.js';
import { ImageConnection } from '../../src/driver/media/ImageConnection.js';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import type { NetworkPublication as RealNetworkPublication } from '../../src/driver/NetworkPublication.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import type { SyncBench } from '../lib/types.js';

/** The members of a publication that a `SendChannelEndpoint` calls. */
type NetworkPublication = Pick<
    RealNetworkPublication,
    | 'sessionId'
    | 'streamId'
    | 'termBufferLength'
    | 'isValidStatusMessage'
    | 'timeOfLastStatusMessageNs'
    | 'triggerSendSetupFrame'
    | 'onStatusMessage'
    | 'onError'
    | 'onNak'
    | 'onRttMeasurement'
    | 'responseCorrelationId'
>;

const OPS_PER_SAMPLE = 1_000;

/** A `DriverConductorProxy` whose members do nothing (the real class queues a closure per call). */
function noOpConductorProxy(): DriverConductorProxy {
    return {
        reResolveEndpoint: () => {},
        reResolveControl: () => {},
        responseSetup: () => {},
        createPublicationImage: () => {},
    } as unknown as DriverConductorProxy;
}
const MTU = 1408;
const rinfo = { address: '127.0.0.1', family: 'IPv4' as const, port: 5000, size: 128 };

class CountingDispatcher {
    public count = 0;

    public onDataPacket(): number {
        this.count++;
        return 0;
    }

    public onSetupMessage(): void {
        this.count++;
    }

    public onRttMeasurement(): void {
        this.count++;
    }
}

class CountingPublication implements NetworkPublication {
    public count = 0;

    public sessionId(): number {
        return -7;
    }

    public streamId(): number {
        return 1001;
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

    public triggerSendSetupFrame(): void {}

    public onStatusMessage(): void {
        this.count++;
    }

    public onError(): void {}

    public onNak(): void {}

    public onRttMeasurement(): void {}

    public responseCorrelationId(): number {
        return -1;
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

function newContext(): MediaDriver.Context {
    return new MediaDriver.Context().conclude();
}

function status(context: MediaDriver.Context): AtomicCounter {
    return (context.countersManager() as CountersManager).newCounter('status');
}

function dataPollBench(): SyncBench {
    let context: MediaDriver.Context;
    let endpoint: ReceiveChannelEndpoint;
    let poller: DataTransportPoller;
    const dispatcher = new CountingDispatcher();
    const frame = new Uint8Array(128);
    let bytes = 0;
    return {
        name: 'DataTransportPoller poll: ReceiveChannelEndpoint data frame 128B (ring, validate, route, dispatcher)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            context = newContext();
            endpoint = new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
                dispatcher as unknown as DataPacketDispatcher,
                status(context),
                context,
            );
            endpoint.openDatagramChannel(null);
            poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
            poller.registerForRead(endpoint, endpoint, 0);
            const header = new DataHeaderFlyweight(new UnsafeBuffer(frame));
            header
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_DATA)
                .frameLength(128);
            header.sessionId(-7).streamId(1001).termId(5).termOffset(64);
        },
        op: () => {
            endpoint.onMessage(frame, rinfo);
            bytes += poller.pollTransports();
        },
        teardown: () => {
            poller.close();
            context.close();
            if (bytes < 0 || dispatcher.count < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

class CountingImage implements PublicationImage {
    public inserted = 0;

    public sessionId(): number {
        return -7;
    }

    public streamId(): number {
        return 1001;
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

    public addDestinationConnectionIfUnknown(): void {}

    public onRttMeasurement(): void {}
}

function dispatchBench(): SyncBench {
    let context: MediaDriver.Context;
    let endpoint: ReceiveChannelEndpoint;
    let poller: DataTransportPoller;
    const image = new CountingImage();
    const frame = new Uint8Array(128);
    let bytes = 0;
    return {
        name: 'DataTransportPoller poll: data frame 128B to DataPacketDispatcher to PublicationImage.insertPacket',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            context = newContext();
            const dispatcher = new RealDataPacketDispatcher(
                noOpConductorProxy(),
                { addPendingSetupMessage: () => {} },
                10,
            );
            endpoint = new ReceiveChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0'),
                dispatcher,
                status(context),
                context,
            );
            endpoint.openDatagramChannel(null);
            poller = new DataTransportPoller(context.countedErrorHandler() as ErrorHandler);
            poller.registerForRead(endpoint, endpoint, 0);
            dispatcher.addSubscription(1001);
            const setup = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH)));
            setup
                .sessionId(-7)
                .streamId(1001)
                .termOffset(0)
                .termLength(64 * 1024)
                .mtuLength(1408);
            dispatcher.onSetupMessage(endpoint, setup, new InetSocketAddress('127.0.0.1', 5000), 0);
            dispatcher.addPublicationImage(image);
            const header = new DataHeaderFlyweight(new UnsafeBuffer(frame));
            header
                .version(HeaderFlyweight.CURRENT_VERSION)
                .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                .headerType(HeaderFlyweight.HDR_TYPE_DATA)
                .frameLength(128);
            header.sessionId(-7).streamId(1001).termId(5).termOffset(64);
        },
        op: () => {
            endpoint.onMessage(frame, rinfo);
            bytes += poller.pollTransports();
        },
        teardown: () => {
            poller.close();
            context.close();
            if (bytes < 0 || image.inserted < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function controlPollBench(): SyncBench {
    let context: MediaDriver.Context;
    let endpoint: SendChannelEndpoint;
    let poller: ControlTransportPoller;
    const publication = new CountingPublication();
    const frame = new Uint8Array(StatusMessageFlyweight.HEADER_LENGTH);
    let bytes = 0;
    return {
        name: 'ControlTransportPoller poll: SendChannelEndpoint status message (ring, validate, route, publication)',
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            context = newContext();
            endpoint = new SendChannelEndpoint(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:40001'),
                status(context),
                context,
            );
            endpoint.openDatagramChannel(null);
            poller = new ControlTransportPoller(context.countedErrorHandler() as ErrorHandler, noOpConductorProxy());
            poller.registerForRead(endpoint);
            endpoint.registerForSend(publication as unknown as RealNetworkPublication);
            const sm = new StatusMessageFlyweight(new UnsafeBuffer(frame));
            sm.version(HeaderFlyweight.CURRENT_VERSION)
                .headerType(HeaderFlyweight.HDR_TYPE_SM)
                .frameLength(StatusMessageFlyweight.HEADER_LENGTH);
            sm.sessionId(-7).streamId(1001).consumptionTermId(5).consumptionTermOffset(0).receiverWindowLength(1000);
        },
        op: () => {
            endpoint.onMessage(frame, rinfo);
            bytes += poller.pollTransports();
        },
        teardown: () => {
            poller.close();
            context.close();
            if (bytes < 0 || publication.count < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function sendBench(name: string, uri: string): SyncBench {
    let context: MediaDriver.Context;
    let endpoint: SendChannelEndpoint;
    let buffer: UnsafeBuffer;
    const socket = new SinkSocket();
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            context = newContext();
            endpoint = new SendChannelEndpoint(UdpChannel.parse(uri), status(context), context);
            endpoint.openDatagramChannel(null);
            const real = endpoint.sendDatagramChannel as Socket;
            endpoint.sendDatagramChannel = socket as unknown as Socket;
            endpoint._receiveDatagramChannel = real;
            buffer = new UnsafeBuffer(new ArrayBuffer(MTU));
            const frames = new DataHeaderFlyweight();
            for (let i = 0; i < 4; i++) {
                frames.wrap(buffer, i * 32, 32);
                frames
                    .frameLength(32)
                    .version(HeaderFlyweight.CURRENT_VERSION)
                    .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
                    .headerType(HeaderFlyweight.HDR_TYPE_DATA);
            }
        },
        op: () => {
            if (MTU !== endpoint.send(buffer, 0, MTU)) {
                throw new Error('short');
            }
        },
        teardown: () => {
            endpoint.close();
            context.close();
            if (socket.sends < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function statusMessageBench(name: string, uri: string): SyncBench {
    let context: MediaDriver.Context;
    let endpoint: ReceiveChannelEndpoint;
    const socket = new SinkSocket();
    const connections = [new ImageConnection(0, new InetSocketAddress('127.0.0.1', 6001))];
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            context = newContext();
            endpoint = new ReceiveChannelEndpoint(
                UdpChannel.parse(uri),
                new CountingDispatcher() as unknown as DataPacketDispatcher,
                status(context),
                context,
            );
            endpoint.openDatagramChannel(null);
            const real = endpoint.sendDatagramChannel as Socket;
            endpoint.sendDatagramChannel = socket as unknown as Socket;
            endpoint._receiveDatagramChannel = real;
        },
        op: (i) => {
            endpoint.sendStatusMessage(connections, -7, 1001, 5, (i & 0xff) * 32, 65536, 0);
        },
        teardown: () => {
            endpoint.close();
            context.close();
            if (socket.sends < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

export const benches: SyncBench[] = [
    dataPollBench(),
    dispatchBench(),
    controlPollBench(),
    sendBench(
        'SendChannelEndpoint send 1408B, connected (slot copy + socket.send)',
        'aeron:udp?endpoint=127.0.0.1:40001',
    ),
    sendBench(
        'SendChannelEndpoint send 1408B, connected, channel send timestamp on 4 begin frames',
        'aeron:udp?endpoint=127.0.0.1:40001|channel-snd-ts-offset=reserved',
    ),
    statusMessageBench(
        'ReceiveChannelEndpoint sendStatusMessage (frame, slot copy + socket.send)',
        'aeron:udp?endpoint=127.0.0.1:0',
    ),
    statusMessageBench(
        'ReceiveChannelEndpoint sendStatusMessage with a group tag',
        'aeron:udp?endpoint=127.0.0.1:0|gtag=4660',
    ),
];
