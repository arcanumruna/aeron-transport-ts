// Extra tests of T15 (port-only): the commands that `SenderProxy` queues for the `Sender`, and what it does when the
// queue is full.
import { describe, expect, it, vi } from 'vitest';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException } from '../../../src/agrona/jdk.js';
import type { ChannelUri } from '../../../src/client/ChannelUri.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import type { SendChannelEndpoint } from '../../../src/driver/media/SendChannelEndpoint.js';
import type { NetworkPublication } from '../../../src/driver/NetworkPublication.js';
import type { Sender } from '../../../src/driver/Sender.js';
import { SenderProxy } from '../../../src/driver/SenderProxy.js';
import { assertThrows } from '../../support/Assertions.js';

function counter(): AtomicCounter & { count: number } {
    const c = {
        count: 0,
        isClosed: () => false,
        increment: () => ++c.count,
    };
    return c as unknown as AtomicCounter & { count: number };
}

const endpoint = { name: 'endpoint' } as unknown as SendChannelEndpoint;
const publication = { name: 'publication' } as unknown as NetworkPublication;
const uri = { name: 'uri' } as unknown as ChannelUri;
const address = new InetSocketAddress('127.0.0.1', 4000);

describe('SenderProxyExtraTest', () => {
    it('each method queues a command that calls the matching method of the sender, in order', () => {
        const queue = new OneToOneConcurrentArrayQueue<() => void>(16);
        const proxy = new SenderProxy(queue, counter());
        const sender = {
            onRegisterSendChannelEndpoint: vi.fn(),
            onCloseSendChannelEndpoint: vi.fn(),
            onRemoveNetworkPublication: vi.fn(),
            onNewNetworkPublication: vi.fn(),
            onAddDestination: vi.fn(),
            onRemoveDestination: vi.fn(),
            onResolutionChange: vi.fn(),
        };
        proxy.sender(sender as unknown as Sender);

        proxy.registerSendChannelEndpoint(endpoint);
        proxy.closeSendChannelEndpoint(endpoint);
        proxy.removeNetworkPublication(publication);
        proxy.newNetworkPublication(publication);
        proxy.addDestination(endpoint, uri, address, 9);
        proxy.removeDestination(endpoint, uri, address);
        proxy.removeDestination(endpoint, 9);
        proxy.onResolutionChange(endpoint, 'host:1', address);

        expect(queue.size()).toBe(8);
        for (let command = queue.poll(); null !== command; command = queue.poll()) {
            command();
        }
        expect(sender.onRegisterSendChannelEndpoint).toHaveBeenCalledWith(endpoint);
        expect(sender.onCloseSendChannelEndpoint).toHaveBeenCalledWith(endpoint);
        expect(sender.onRemoveNetworkPublication).toHaveBeenCalledWith(publication);
        expect(sender.onNewNetworkPublication).toHaveBeenCalledWith(publication);
        expect(sender.onAddDestination).toHaveBeenCalledWith(endpoint, uri, address, 9);
        expect(sender.onRemoveDestination.mock.calls).toEqual([
            [endpoint, uri, address],
            [endpoint, 9],
        ]);
        expect(sender.onResolutionChange).toHaveBeenCalledWith(endpoint, 'host:1', address);
    });

    it('a full queue counts the failure once and throws (CommandProxy, spec D42)', () => {
        const failures = counter();
        const queue = new OneToOneConcurrentArrayQueue<() => void>(2);
        const proxy = new SenderProxy(queue, failures);
        proxy.newNetworkPublication(publication);
        proxy.newNetworkPublication(publication);
        expect(proxy.isApplyingBackpressure()).toBe(true);

        assertThrows(IllegalStateException, () => proxy.newNetworkPublication(publication));

        expect(failures.count).toBe(1);
        expect(queue.size()).toBe(2);
    });
});
