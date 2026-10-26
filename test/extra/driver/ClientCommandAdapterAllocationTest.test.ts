// Extra tests of T17 (port-only, spec 5.3): the decode of a client command and the encode of a driver response allocate
// nothing per command where Java allocates nothing. The commands that carry a channel or a reason (ADD_*,
// ADD_*_DESTINATION, REMOVE_*_DESTINATION, REJECT_IMAGE) read it into a `String` in Java too (control plane), so
// they are not in these loops. The conductor and the client proxy are plain objects that count (a `vi.fn` records its
// calls, which allocates). The ids stay below 2^30, small integers: a `long` above 2^31 is boxed (issue #19).
import { describe, expect, it } from 'vitest';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BroadcastBufferDescriptor } from '../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastTransmitter } from '../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { ManyToOneRingBuffer } from '../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { RingBufferDescriptor } from '../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { ControlProtocolEvents } from '../../../src/client/command/ControlProtocolEvents.js';
import { CorrelatedMessageFlyweight } from '../../../src/client/command/CorrelatedMessageFlyweight.js';
import { DestinationByIdMessageFlyweight } from '../../../src/client/command/DestinationByIdMessageFlyweight.js';
import { RemovePublicationFlyweight } from '../../../src/client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../../../src/client/command/RemoveSubscriptionFlyweight.js';
import { TerminateDriverFlyweight } from '../../../src/client/command/TerminateDriverFlyweight.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { ClientCommandAdapter } from '../../../src/driver/ClientCommandAdapter.js';
import { asConductor, type ClientCommandConductor } from '../../support/ClientCommandConductor.js';
import { ClientProxy } from '../../../src/driver/ClientProxy.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const ITERATIONS = 2_000_000;
const INDEX = 40;

/** Keeps the values of the loops alive. */
let sink = 0;

class CountingConductor implements ClientCommandConductor {
    public calls = 0;

    public notAcceptingClientCommands(): boolean {
        return false;
    }

    public onAddIpcPublication(): void {}
    public onAddNetworkPublication(): void {}

    public onRemovePublication(registrationId: number, correlationId: number, revoke: boolean): void {
        this.calls++;
        sink = (sink + registrationId + correlationId + (revoke ? 1 : 0)) | 0;
    }

    public onAddIpcSubscription(): void {}
    public onAddSpySubscription(): void {}
    public onAddNetworkSubscription(): void {}

    public onRemoveSubscription(registrationId: number, correlationId: number): void {
        this.calls++;
        sink = (sink + registrationId + correlationId) | 0;
    }

    public onAddSendDestination(): void {}

    public onRemoveSendDestination(registrationId: number, destination: string | number, correlationId: number): void {
        this.calls++;
        sink = (sink + registrationId + (destination as number) + correlationId) | 0;
    }

    public onAddRcvDestination(): void {}
    public onRemoveRcvDestination(): void {}

    public onClientKeepalive(clientId: number): void {
        this.calls++;
        sink = (sink + clientId) | 0;
    }

    public onClientClose(clientId: number): void {
        this.calls++;
        sink = (sink + clientId) | 0;
    }

    public onTerminateDriver(_buffer: unknown, tokenOffset: number, tokenLength: number): void {
        this.calls++;
        sink = (sink + tokenOffset + tokenLength) | 0;
    }

    public onRejectImage(): void {}
}

const silentErrorHandler: ErrorHandler = {
    onError: () => expect.unreachable('no command in these loops is an error'),
};

const failingProxy = {
    onError: (_correlationId: number, _code: ErrorCode, message: string) => expect.unreachable(message),
} as unknown as ClientProxy;

function newRing(): ManyToOneRingBuffer {
    return new ManyToOneRingBuffer(new UnsafeBuffer(new ArrayBuffer(64 * 1024 + RingBufferDescriptor.TRAILER_LENGTH)));
}

describe('ClientCommandAdapter hot path allocation', () => {
    const buffer = new UnsafeBuffer(new Uint8Array(1024));
    const counting = new CountingConductor();
    const conductor = asConductor(counting);
    const adapter = new ClientCommandAdapter(silentErrorHandler, newRing(), failingProxy, conductor);

    function encode(typeId: number): number {
        switch (typeId) {
            case ControlProtocolEvents.CLIENT_KEEPALIVE:
            case ControlProtocolEvents.CLIENT_CLOSE: {
                new CorrelatedMessageFlyweight().wrap(buffer, INDEX).clientId(11).correlationId(12);
                return CorrelatedMessageFlyweight.LENGTH;
            }
            case ControlProtocolEvents.REMOVE_SUBSCRIPTION: {
                const fw = new RemoveSubscriptionFlyweight().wrap(buffer, INDEX);
                fw.clientId(11).correlationId(12);
                fw.registrationId(13);
                return RemoveSubscriptionFlyweight.length();
            }
            case ControlProtocolEvents.REMOVE_PUBLICATION: {
                const fw = new RemovePublicationFlyweight().wrap(buffer, INDEX);
                fw.clientId(11).correlationId(12);
                fw.registrationId(13);
                fw.revoke(true);
                return RemovePublicationFlyweight.length();
            }
            case ControlProtocolEvents.REMOVE_DESTINATION_BY_ID: {
                const fw = new DestinationByIdMessageFlyweight().wrap(buffer, INDEX);
                fw.clientId(11).correlationId(12);
                fw.resourceRegistrationId(13).destinationRegistrationId(14);
                return DestinationByIdMessageFlyweight.MESSAGE_LENGTH;
            }
            default: {
                const fw = new TerminateDriverFlyweight().wrap(buffer, INDEX);
                fw.clientId(11).correlationId(12);
                fw.tokenBuffer(new UnsafeBuffer(new Uint8Array([1, 2, 3, 4])), 0, 4);
                return fw.length();
            }
        }
    }

    it.each([
        ['CLIENT_KEEPALIVE', ControlProtocolEvents.CLIENT_KEEPALIVE],
        ['CLIENT_CLOSE', ControlProtocolEvents.CLIENT_CLOSE],
        ['REMOVE_SUBSCRIPTION', ControlProtocolEvents.REMOVE_SUBSCRIPTION],
        ['REMOVE_PUBLICATION', ControlProtocolEvents.REMOVE_PUBLICATION],
        ['REMOVE_DESTINATION_BY_ID', ControlProtocolEvents.REMOVE_DESTINATION_BY_ID],
        ['TERMINATE_DRIVER', ControlProtocolEvents.TERMINATE_DRIVER],
    ])('onMessage %s allocates nothing', async (_name, typeId) => {
        const length = encode(typeId);
        const before = counting.calls;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                adapter.onMessage(typeId, buffer, INDEX, length);
            }
        }, ITERATIONS);

        expect(counting.calls).toBeGreaterThan(before + ITERATIONS);
    });

    it('write to the ring and receive allocate nothing', async () => {
        const ring = newRing();
        const reading = new ClientCommandAdapter(silentErrorHandler, ring, failingProxy, conductor);
        const length = encode(ControlProtocolEvents.CLIENT_KEEPALIVE);
        const before = counting.calls;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                ring.write(ControlProtocolEvents.CLIENT_KEEPALIVE, buffer, INDEX, length);
                reading.receive();
            }
        }, ITERATIONS);

        expect(counting.calls).toBeGreaterThan(before + ITERATIONS);
    });
});

describe('ClientProxy hot path allocation', () => {
    const transmitterBuffer = new UnsafeBuffer(new ArrayBuffer(64 * 1024 + BroadcastBufferDescriptor.TRAILER_LENGTH));
    const proxy = new ClientProxy(new BroadcastTransmitter(transmitterBuffer));
    const LOG_FILE = 'a/long/log/file/name/1234567890.logbuffer';
    const CHANNEL = 'aeron:udp?endpoint=localhost:20121';

    it.each([
        ['onError', () => proxy.onError(12, ErrorCode.GENERIC_ERROR, 'a message of some length')],
        ['onPublicationReady', () => proxy.onPublicationReady(12, 13, 1003, 5, LOG_FILE, 7, 8, false)],
        ['onPublicationReady exclusive', () => proxy.onPublicationReady(12, 13, 1003, 5, LOG_FILE, 7, 8, true)],
        ['onSubscriptionReady', () => proxy.onSubscriptionReady(12, 8)],
        ['operationSucceeded', () => proxy.operationSucceeded(12)],
        ['onAvailableImage', () => proxy.onAvailableImage(12, 1003, 5, 13, 7, LOG_FILE, '127.0.0.1:40123')],
        ['onUnavailableImage', () => proxy.onUnavailableImage(12, 13, 1003, CHANNEL)],
        ['onClientTimeout', () => proxy.onClientTimeout(12)],
    ])('%s allocates nothing', async (_name, respond) => {
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                respond();
            }
        }, ITERATIONS);
    });
});
