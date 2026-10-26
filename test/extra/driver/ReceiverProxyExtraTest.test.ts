// Extra tests of T16 (port-only): the commands that `ReceiverProxy` queues for the `Receiver`, with the overloads of Java
// that differ by the session id, and what it does when the queue is full.
import { describe, expect, it, vi } from 'vitest';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException } from '../../../src/agrona/jdk.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import type { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from '../../../src/driver/media/ReceiveDestinationTransport.js';
import type { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import type { PublicationImage } from '../../../src/driver/PublicationImage.js';
import type { Receiver } from '../../../src/driver/Receiver.js';
import { ReceiverProxy } from '../../../src/driver/ReceiverProxy.js';
import { assertThrows } from '../../support/Assertions.js';

function counter(): AtomicCounter & { count: number } {
    const c = {
        count: 0,
        isClosed: () => false,
        increment: () => ++c.count,
    };
    return c as unknown as AtomicCounter & { count: number };
}

const endpoint = { name: 'endpoint' } as unknown as ReceiveChannelEndpoint;
const image = { name: 'image' } as unknown as PublicationImage;
const transport = { name: 'transport' } as unknown as ReceiveDestinationTransport;
const channel = { name: 'channel' } as unknown as UdpChannel;
const address = new InetSocketAddress('127.0.0.1', 4000);

function fakeReceiver() {
    return {
        onAddSubscription: vi.fn(),
        onRemoveSubscription: vi.fn(),
        onNewPublicationImage: vi.fn(),
        onRegisterReceiveChannelEndpoint: vi.fn(),
        onCloseReceiveChannelEndpoint: vi.fn(),
        onRemoveCoolDown: vi.fn(),
        onRemoveInitInProgress: vi.fn(),
        onAddDestination: vi.fn(),
        onRemoveDestination: vi.fn(),
        onResolutionChange: vi.fn(),
        onRequestSetup: vi.fn(),
        onRejectImage: vi.fn(),
    };
}

describe('ReceiverProxyExtraTest', () => {
    it('each method queues a command that calls the matching method of the receiver, in order, with the arguments', () => {
        const queue = new OneToOneConcurrentArrayQueue<() => void>(32);
        const proxy = new ReceiverProxy(queue, counter());
        const receiver = fakeReceiver();
        proxy.receiver(receiver as unknown as Receiver);
        expect(proxy.receiver()).toBe(receiver);

        proxy.addSubscription(endpoint, 1001);
        proxy.addSubscription(endpoint, 1002, 0);
        proxy.removeSubscription(endpoint, 1003);
        proxy.removeSubscription(endpoint, 1004, -7);
        proxy.newPublicationImage(endpoint, image);
        proxy.registerReceiveChannelEndpoint(endpoint);
        proxy.closeReceiveChannelEndpoint(endpoint);
        proxy.removeCoolDown(endpoint, 5, 6);
        proxy.removeInitInProgress(endpoint, 7, 8);
        proxy.addDestination(endpoint, transport);
        proxy.removeDestination(endpoint, channel);
        proxy.onResolutionChange(endpoint, channel, address);
        proxy.requestSetup(endpoint, 9, 10);
        proxy.rejectImage(42, 4096, 'because');

        expect(queue.size()).toBe(14);
        for (let command = queue.poll(); null !== command; command = queue.poll()) {
            command();
        }
        // the session id decides which overload runs: 0 is a session id, not the absence of one
        expect(receiver.onAddSubscription.mock.calls).toEqual([
            [endpoint, 1001],
            [endpoint, 1002, 0],
        ]);
        expect(receiver.onRemoveSubscription.mock.calls).toEqual([
            [endpoint, 1003],
            [endpoint, 1004, -7],
        ]);
        expect(receiver.onNewPublicationImage.mock.calls).toEqual([[endpoint, image]]);
        expect(receiver.onRegisterReceiveChannelEndpoint.mock.calls).toEqual([[endpoint]]);
        expect(receiver.onCloseReceiveChannelEndpoint.mock.calls).toEqual([[endpoint]]);
        expect(receiver.onRemoveCoolDown.mock.calls).toEqual([[endpoint, 5, 6]]);
        expect(receiver.onRemoveInitInProgress.mock.calls).toEqual([[endpoint, 7, 8]]);
        expect(receiver.onAddDestination.mock.calls).toEqual([[endpoint, transport]]);
        expect(receiver.onRemoveDestination.mock.calls).toEqual([[endpoint, channel]]);
        expect(receiver.onResolutionChange.mock.calls).toEqual([[endpoint, channel, address]]);
        expect(receiver.onRequestSetup.mock.calls).toEqual([[endpoint, 9, 10]]);
        expect(receiver.onRejectImage.mock.calls).toEqual([[42, 4096, 'because']]);
    });

    it('the command reads the receiver when it runs, as the lambda of Java reads its field', () => {
        const queue = new OneToOneConcurrentArrayQueue<() => void>(4);
        const proxy = new ReceiverProxy(queue, counter());
        const receiver = fakeReceiver();
        proxy.addSubscription(endpoint, 1);
        proxy.receiver(receiver as unknown as Receiver);

        (queue.poll() as () => void)();

        expect(receiver.onAddSubscription.mock.calls).toEqual([[endpoint, 1]]);
    });

    it('a full queue counts the failure once and throws (CommandProxy, spec D42)', () => {
        const failures = counter();
        const queue = new OneToOneConcurrentArrayQueue<() => void>(2);
        const proxy = new ReceiverProxy(queue, failures);
        proxy.requestSetup(endpoint, 1, 2);
        proxy.requestSetup(endpoint, 1, 2);
        expect(proxy.isApplyingBackpressure()).toBe(true);

        assertThrows(IllegalStateException, () => proxy.requestSetup(endpoint, 1, 2));

        expect(failures.count).toBe(1);
        expect(queue.size()).toBe(2);
    });
});
