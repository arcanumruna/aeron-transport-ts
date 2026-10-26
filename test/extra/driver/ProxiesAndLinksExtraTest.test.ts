// Extra tests of T17 (port-only, spec 5.3): `CommandProxy` and `DriverConductorProxy` (the command a call queues, what
// it calls when the conductor drains it, a full queue, a conductor that is not set), `AeronClient`, `PublicationLink`,
// `SubscriptionLink` and `NetworkSubscriptionLink` (liveness, matching, linking and closing) and
// `UntetheredSubscription` (its state). Nothing here waits on time: the clocks are numbers given to `onTimeEvent`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ManyToOneConcurrentLinkedQueue } from '../../../src/agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ReadablePosition } from '../../../src/agrona/concurrent/status/ReadablePosition.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException, TimeUnit } from '../../../src/agrona/jdk.js';
import { InferableBoolean } from '../../../src/client/CommonContext.js';
import { ClientProxy } from '../../../src/driver/ClientProxy.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { AeronClient } from '../../../src/driver/AeronClient.js';
import type { DriverConductor } from '../../../src/driver/DriverConductor.js';
import { asConductor } from '../../support/ClientCommandConductor.js';
import { CommandProxy, type Runnable } from '../../../src/driver/CommandProxy.js';
import { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import type { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from '../../../src/driver/media/ReceiveDestinationTransport.js';
import type { SendChannelEndpoint } from '../../../src/driver/media/SendChannelEndpoint.js';
import type { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NetworkSubscriptionLink, ResponseSetupState } from '../../../src/driver/NetworkSubscriptionLink.js';
import { PublicationLink, type LinkedPublication } from '../../../src/driver/PublicationLink.js';
import type { Subscribable } from '../../../src/driver/Subscribable.js';
import { SubscriptionLink, type SubscriptionLinkImage } from '../../../src/driver/SubscriptionLink.js';
import { SubscriptionParams } from '../../../src/driver/SubscriptionParams.js';
import { UntetheredSubscription, UntetheredSubscriptionState } from '../../../src/driver/UntetheredSubscription.js';

function newCounter(): AtomicCounter {
    return new AtomicCounter(new UnsafeBuffer(new ArrayBuffer(64)), 0);
}

class TestProxy extends CommandProxy {
    public constructor(queue: OneToOneConcurrentArrayQueue<Runnable>, failCount: AtomicCounter) {
        super(queue, failCount);
    }

    public send(cmd: Runnable): void {
        this.offer(cmd);
    }
}

/** The members of the conductor that each class under test calls (formerly their narrow interfaces). */
type DriverConductorProxyTarget = Pick<
    DriverConductor,
    | 'onReResolveEndpoint'
    | 'onReResolveControl'
    | 'closeReceiveDestination'
    | 'responseSetup'
    | 'responseConnected'
    | 'receiveChannelEndpointClosed'
    | 'sendChannelEndpointClosed'
    | 'onCreatePublicationImage'
    | 'onPublicationError'
>;
type AeronClientConductor = Pick<DriverConductor, 'clientTimeout' | 'unavailableCounter'>;
type SubscriptionLinkConductor = Pick<DriverConductor, 'notifyUnavailableImageLink' | 'cleanupSubscriptionLink'>;

describe('CommandProxy extra', () => {
    it('queues a command and counts nothing', () => {
        const queue = new OneToOneConcurrentArrayQueue<Runnable>(4);
        const failCount = newCounter();
        const proxy = new TestProxy(queue, failCount);
        const cmd = vi.fn();

        proxy.send(cmd);

        expect(queue.poll()).toBe(cmd);
        expect(failCount.get()).toBe(0);
    });

    it('a full queue counts one failure and throws, and the queue is unchanged (it cannot drain while the producer runs)', () => {
        const queue = new OneToOneConcurrentArrayQueue<Runnable>(2);
        const failCount = newCounter();
        const proxy = new TestProxy(queue, failCount);
        const commands = [vi.fn(), vi.fn()];
        commands.forEach((c) => proxy.send(c));
        expect(proxy.isApplyingBackpressure()).toBe(true);

        expect(() => proxy.send(vi.fn())).toThrow(IllegalStateException);
        expect(() => proxy.send(vi.fn())).toThrow(IllegalStateException);

        expect(failCount.get()).toBe(2);
        expect(queue.poll()).toBe(commands[0]);
        expect(proxy.isApplyingBackpressure()).toBe(false);
        proxy.send(vi.fn());
        expect(proxy.isApplyingBackpressure()).toBe(true);
    });

    it('a full queue with a closed fail counter does not count', () => {
        const queue = new OneToOneConcurrentArrayQueue<Runnable>(1);
        const failCount = newCounter();
        const proxy = new TestProxy(queue, failCount);
        proxy.send(vi.fn());
        failCount.close();

        expect(() => proxy.send(vi.fn())).toThrow(IllegalStateException);

        expect(failCount.get()).toBe(0);
    });
});

describe('DriverConductorProxy extra', () => {
    const channelEndpoint = {} as SendChannelEndpoint;
    const receiveEndpoint = {} as ReceiveChannelEndpoint;
    const udpChannel = {} as UdpChannel;
    const destination = {} as ReceiveDestinationTransport;
    const address = new InetSocketAddress('127.0.0.1', 4000);
    const source = new InetSocketAddress('127.0.0.1', 4001);

    let queue: ManyToOneConcurrentLinkedQueue<Runnable>;
    let proxy: DriverConductorProxy;
    let conductor: { [K in keyof DriverConductorProxyTarget]: Mock<DriverConductorProxyTarget[K]> } & DriverConductor;

    beforeEach(() => {
        queue = new ManyToOneConcurrentLinkedQueue<Runnable>();
        proxy = new DriverConductorProxy(queue);
        conductor = {
            onReResolveEndpoint: vi.fn(),
            onReResolveControl: vi.fn(),
            closeReceiveDestination: vi.fn(),
            responseSetup: vi.fn(),
            responseConnected: vi.fn(),
            receiveChannelEndpointClosed: vi.fn(),
            sendChannelEndpointClosed: vi.fn(),
            onCreatePublicationImage: vi.fn(),
            onPublicationError: vi.fn(),
        } as unknown as typeof conductor;
        proxy.driverConductor(conductor);
    });

    function drain(): number {
        let n = 0;
        for (let cmd = queue.poll(); null !== cmd; cmd = queue.poll()) {
            cmd();
            n++;
        }
        return n;
    }

    it('a call only queues a command: the conductor is called when the command is drained, once, with the arguments', () => {
        proxy.reResolveEndpoint('host:1', channelEndpoint, address);
        proxy.reResolveControl('host:2', udpChannel, receiveEndpoint, null);
        proxy.closeReceiveDestination(destination);
        proxy.responseSetup(5, 6);
        proxy.responseConnected(7);
        proxy.receiveChannelEndpointClosed(receiveEndpoint);
        proxy.sendChannelEndpointClosed(channelEndpoint);
        proxy.createPublicationImage(1, 2, 3, 4, 5, 6, 7, 8, 9, address, source, receiveEndpoint);
        proxy.onPublicationError(1, 2, 3, 4, 5n, null, source, 6, 'msg');
        for (const member of Object.values(conductor)) {
            expect(member).not.toHaveBeenCalled();
        }

        expect(drain()).toBe(9);

        expect(conductor.onReResolveEndpoint.mock.calls).toEqual([['host:1', channelEndpoint, address]]);
        expect(conductor.onReResolveControl.mock.calls).toEqual([['host:2', udpChannel, receiveEndpoint, null]]);
        expect(conductor.closeReceiveDestination.mock.calls).toEqual([[destination]]);
        expect(conductor.responseSetup.mock.calls).toEqual([[5, 6]]);
        expect(conductor.responseConnected.mock.calls).toEqual([[7]]);
        expect(conductor.receiveChannelEndpointClosed.mock.calls).toEqual([[receiveEndpoint]]);
        expect(conductor.sendChannelEndpointClosed.mock.calls).toEqual([[channelEndpoint]]);
        expect(conductor.onCreatePublicationImage.mock.calls).toEqual([
            [1, 2, 3, 4, 5, 6, 7, 8, 9, address, source, receiveEndpoint],
        ]);
        expect(conductor.onPublicationError.mock.calls).toEqual([[1, 2, 3, 4, 5n, null, source, 6, 'msg']]);
    });

    it('the commands run in the order they were queued', () => {
        const order: string[] = [];
        conductor.responseSetup.mockImplementation(() => order.push('setup'));
        conductor.responseConnected.mockImplementation(() => order.push('connected'));
        conductor.sendChannelEndpointClosed.mockImplementation(() => order.push('closed'));

        proxy.responseConnected(1);
        proxy.sendChannelEndpointClosed(channelEndpoint);
        proxy.responseSetup(1, 2);
        drain();

        expect(order).toEqual(['connected', 'closed', 'setup']);
    });

    it('a command drained before the conductor was set is an IllegalStateException', () => {
        const unset = new DriverConductorProxy(queue);

        unset.responseConnected(1);

        expect(() => drain()).toThrow(IllegalStateException);
    });
});

describe('AeronClient extra', () => {
    const CLIENT_ID = 77;
    const TIMEOUT_NS = TimeUnit.SECONDS.toNanos(5);
    let clientTimeouts: AtomicCounter;
    let heartbeat: AtomicCounter;
    let client: AeronClient;
    let conductor: { [K in keyof AeronClientConductor]: Mock<AeronClientConductor[K]> } & DriverConductor;

    beforeEach(() => {
        clientTimeouts = newCounter();
        heartbeat = newCounter();
        client = new AeronClient(CLIENT_ID, TIMEOUT_NS, clientTimeouts, heartbeat);
        conductor = { clientTimeout: vi.fn(), unavailableCounter: vi.fn() } as unknown as typeof conductor;
    });

    it('is alive up to the liveness timeout after its last keepalive and times out after it, once reported', () => {
        client.timeOfLastKeepaliveMs(1_000);

        client.onTimeEvent(0, 1_000 + 5_000, conductor);
        expect(client.hasTimedOut()).toBe(false);
        expect(client.hasReachedEndOfLife()).toBe(false);
        expect(conductor.clientTimeout).not.toHaveBeenCalled();

        client.onTimeEvent(0, 1_000 + 5_001, conductor);
        expect(client.hasTimedOut()).toBe(true);
        expect(client.hasReachedEndOfLife()).toBe(true);
        expect(conductor.clientTimeout.mock.calls).toEqual([[CLIENT_ID]]);
        expect(conductor.unavailableCounter.mock.calls).toEqual([[CLIENT_ID, heartbeat.id()]]);
        expect(clientTimeouts.get()).toBe(1);
    });

    it('a keepalive moves the deadline', () => {
        client.timeOfLastKeepaliveMs(1_000);
        client.timeOfLastKeepaliveMs(4_000);

        client.onTimeEvent(0, 9_000, conductor);

        expect(client.hasTimedOut()).toBe(false);
    });

    it('a client closed by command is not a timeout: its heartbeat is zeroed and the timeout is not counted', () => {
        client.timeOfLastKeepaliveMs(1_000);
        client.onClosedByCommand();
        expect(heartbeat.get()).toBe(0);

        client.onTimeEvent(0, 5_001, conductor);

        expect(client.hasReachedEndOfLife()).toBe(true);
        expect(conductor.clientTimeout).not.toHaveBeenCalled();
        expect(clientTimeouts.get()).toBe(0);
        expect(conductor.unavailableCounter.mock.calls).toEqual([[CLIENT_ID, heartbeat.id()]]);
    });

    it('a timeout shorter than a millisecond is a millisecond', () => {
        const quick = new AeronClient(CLIENT_ID, 1, clientTimeouts, heartbeat);
        quick.timeOfLastKeepaliveMs(10);

        quick.onTimeEvent(0, 11, conductor);
        expect(quick.hasTimedOut()).toBe(false);
        quick.onTimeEvent(0, 12, conductor);
        expect(quick.hasTimedOut()).toBe(true);
    });

    it('close closes the heartbeat counter; clientId and toString report the client', () => {
        expect(client.clientId()).toBe(CLIENT_ID);
        expect(client.toString()).toContain('clientId=77');
        expect(client.toString()).toContain('clientLivenessTimeoutMs=5000');

        client.close();

        expect(heartbeat.isClosed()).toBe(true);
    });
});

describe('PublicationLink extra', () => {
    it('takes a reference on the publication, releases it on close, and revokes it', () => {
        const calls: string[] = [];
        const publication: LinkedPublication = {
            incRef: () => calls.push('incRef'),
            decRef: () => calls.push('decRef'),
            revoke: () => calls.push('revoke'),
        };
        const client = new AeronClient(1, TimeUnit.SECONDS.toNanos(5), newCounter(), newCounter());

        const link = new PublicationLink(42, client, publication);
        expect(calls).toEqual(['incRef']);
        expect(link.registrationId()).toBe(42);

        link.revoke();
        link.close();
        expect(calls).toEqual(['incRef', 'revoke', 'decRef']);
    });

    it('reaches the end of its life when its client has timed out, not before', () => {
        const heartbeat = newCounter();
        const client = new AeronClient(1, TimeUnit.SECONDS.toNanos(5), newCounter(), heartbeat);
        const link = new PublicationLink(42, client, { incRef() {}, decRef() {}, revoke() {} });
        client.timeOfLastKeepaliveMs(100);

        link.onTimeEvent(0, 200, undefined);
        expect(link.hasReachedEndOfLife()).toBe(false);

        client.onTimeEvent(0, 100 + 5_001, asConductor({ clientTimeout() {}, unavailableCounter() {} }));
        link.onTimeEvent(0, 5_200, undefined);
        expect(link.hasReachedEndOfLife()).toBe(true);
    });
});

class TestLink extends SubscriptionLink {
    public constructor(registrationId: number, streamId: number, client: AeronClient, params: SubscriptionParams) {
        super(registrationId, streamId, 'aeron:udp?endpoint=localhost:1', client, params);
    }
}

class TestSubscribable implements Subscribable {
    public readonly removed: Array<[SubscriptionLink, ReadablePosition]> = [];

    public constructor(private readonly id: number) {}

    public subscribableRegistrationId(): number {
        return this.id;
    }

    public addSubscriber(): void {}

    public removeSubscriber(link: SubscriptionLink, position: ReadablePosition): void {
        this.removed.push([link, position]);
    }
}

describe('SubscriptionLink extra', () => {
    let client: AeronClient;
    let params: SubscriptionParams;
    let conductor: { [K in keyof SubscriptionLinkConductor]: Mock<SubscriptionLinkConductor[K]> } & DriverConductor;

    beforeEach(() => {
        client = new AeronClient(1, TimeUnit.SECONDS.toNanos(5), newCounter(), newCounter());
        params = new SubscriptionParams();
        conductor = {
            notifyUnavailableImageLink: vi.fn(),
            cleanupSubscriptionLink: vi.fn(),
        } as unknown as typeof conductor;
    });

    it('takes its flags from the params and answers Java defaults for what only a subclass knows', () => {
        params.hasSessionId = true;
        params.sessionId = -9;
        params.isSparse = false;
        params.isTether = false;
        params.isRejoin = false;
        params.isResponse = true;
        params.group = InferableBoolean.FORCE_TRUE;

        const link = new TestLink(5, 1003, client, params);

        expect(link.registrationId()).toBe(5);
        expect(link.streamId()).toBe(1003);
        expect(link.channel()).toBe('aeron:udp?endpoint=localhost:1');
        expect(link.aeronClient()).toBe(client);
        expect(link.sessionId()).toBe(-9);
        expect(link.hasSessionId()).toBe(true);
        expect(link.isSparse()).toBe(false);
        expect(link.isTether()).toBe(false);
        expect(link.isRejoin()).toBe(false);
        expect(link.isResponse()).toBe(true);
        expect(link.group()).toBe(InferableBoolean.FORCE_TRUE);
        expect(link.isReliable()).toBe(true);
        expect(link.channelEndpoint()).toBeNull();
        expect(link.supportsMds()).toBe(false);
        expect(link.matchesNetworkPublication({ streamId: () => 1003, sessionId: () => -9 })).toBe(false);
        expect(link.matchesIpcPublication({ streamId: () => 1003, sessionId: () => -9 })).toBe(false);
        expect(link.matchesImage({} as SubscriptionLinkImage)).toBe(false);
    });

    it('sessionId(sessionId, hasSessionId) sets both', () => {
        const link = new TestLink(5, 1003, client, params);
        expect(link.hasSessionId()).toBe(false);

        link.sessionId(12, true);
        expect([link.sessionId(), link.hasSessionId()]).toEqual([12, true]);
        link.sessionId(0, false);
        expect([link.sessionId(), link.hasSessionId()]).toEqual([0, false]);
    });

    it.each([
        // hasSessionId, sessionId, isResponse, candidate, expected
        [false, 0, false, 77, true],
        [false, 0, true, 77, false],
        [true, 77, false, 77, true],
        [true, 77, false, 78, false],
        [true, 77, true, 77, true],
        [false, 77, true, 77, true],
        [false, 5, false, 77, true],
    ])(
        'isWildcardOrSessionIdMatch(hasSessionId %s, sessionId %i, isResponse %s, %i) is %s',
        (has, id, response, candidate, expected) => {
            params.hasSessionId = has;
            params.sessionId = id;
            params.isResponse = response;

            expect(new TestLink(5, 1003, client, params).isWildcardOrSessionIdMatch(candidate)).toBe(expected);
        },
    );

    it('link, isLinked and unlink are by identity of the subscribable', () => {
        const link = new TestLink(5, 1003, client, params);
        const a = new TestSubscribable(1);
        const b = new TestSubscribable(1);
        const position = {} as ReadablePosition;

        link.link(a, position);

        expect(link.isLinked(a)).toBe(true);
        expect(link.isLinked(b)).toBe(false);
        link.unlink(b);
        expect(link.isLinked(a)).toBe(true);
        link.unlink(a);
        expect(link.isLinked(a)).toBe(false);
    });

    it('notifyUnavailableImages tells the conductor about every linked subscribable', () => {
        const link = new TestLink(5, 1003, client, params);
        link.link(new TestSubscribable(11), {} as ReadablePosition);
        link.link(new TestSubscribable(12), {} as ReadablePosition);

        link.notifyUnavailableImages(conductor);

        expect(conductor.notifyUnavailableImageLink.mock.calls).toEqual([
            [11, link],
            [12, link],
        ]);
    });

    it('close removes the subscriber from every linked subscribable, with its position, even when it unlinks itself', () => {
        const link = new TestLink(5, 1003, client, params);
        const a = new TestSubscribable(11);
        const b = new TestSubscribable(12);
        const positionA = {} as ReadablePosition;
        const positionB = {} as ReadablePosition;
        link.link(a, positionA);
        link.link(b, positionB);
        a.removeSubscriber = (l, p) => {
            a.removed.push([l, p]);
            l.unlink(a);
        };

        link.close();

        expect(a.removed).toEqual([[link, positionA]]);
        expect(b.removed).toEqual([[link, positionB]]);
    });

    it('is cleaned up by the conductor when its client has timed out, not before', () => {
        const link = new TestLink(5, 1003, client, params);
        link.onTimeEvent(0, 0, conductor);
        expect(link.hasReachedEndOfLife()).toBe(false);
        expect(conductor.cleanupSubscriptionLink).not.toHaveBeenCalled();

        client.timeOfLastKeepaliveMs(0);
        client.onTimeEvent(0, 5_001, asConductor({ clientTimeout() {}, unavailableCounter() {} }));
        link.onTimeEvent(0, 5_001, conductor);

        expect(link.hasReachedEndOfLife()).toBe(true);
        expect(conductor.cleanupSubscriptionLink.mock.calls).toEqual([[link]]);
    });

    it('toString names the class and the fields', () => {
        const text = new TestLink(5, 1003, client, params).toString();

        expect(text).toMatch(/^TestLink\{registrationId=5, streamId=1003, sessionId=0, hasSessionId=false, /);
        expect(text).toContain("channel='aeron:udp?endpoint=localhost:1'");
        expect(text).toContain('positionBySubscribableMap={}');
    });
});

describe('NetworkSubscriptionLink extra', () => {
    let client: AeronClient;
    let params: SubscriptionParams;
    let endpoint: ReceiveChannelEndpoint;
    let otherEndpoint: ReceiveChannelEndpoint;

    beforeEach(() => {
        client = new AeronClient(1, TimeUnit.SECONDS.toNanos(5), newCounter(), newCounter());
        params = new SubscriptionParams();
        endpoint = { hasDestinationControl: vi.fn(() => false) } as unknown as ReceiveChannelEndpoint;
        otherEndpoint = {} as ReceiveChannelEndpoint;
    });

    function image(of: ReceiveChannelEndpoint, streamId: number, sessionId: number): SubscriptionLinkImage {
        return { channelEndpoint: () => of, streamId: () => streamId, sessionId: () => sessionId };
    }

    it('matches an image of its endpoint and stream, and of its session when it has one', () => {
        const wildcard = new NetworkSubscriptionLink(5, endpoint, 1003, 'aeron:udp', client, params);
        params.hasSessionId = true;
        params.sessionId = 77;
        const specific = new NetworkSubscriptionLink(6, endpoint, 1003, 'aeron:udp', client, params);

        expect(wildcard.matchesImage(image(endpoint, 1003, 1))).toBe(true);
        expect(wildcard.matchesImage(image(endpoint, 1003, 77))).toBe(true);
        expect(wildcard.matchesImage(image(endpoint, 1004, 1))).toBe(false);
        expect(wildcard.matchesImage(image(otherEndpoint, 1003, 1))).toBe(false);
        expect(specific.matchesImage(image(endpoint, 1003, 77))).toBe(true);
        expect(specific.matchesImage(image(endpoint, 1003, 78))).toBe(false);
    });

    it('matchesSession is endpoint, stream and session; matchesParams also needs the same hasSessionId', () => {
        const wildcard = new NetworkSubscriptionLink(5, endpoint, 1003, 'aeron:udp', client, params);
        const sessionParams = new SubscriptionParams();
        sessionParams.hasSessionId = true;
        sessionParams.sessionId = 77;

        expect(wildcard.matchesSession(endpoint, 1003, 5)).toBe(true);
        expect(wildcard.matchesSession(endpoint, 1004, 5)).toBe(false);
        expect(wildcard.matchesSession(otherEndpoint, 1003, 5)).toBe(false);
        expect(wildcard.matchesParams(endpoint, 1003, params)).toBe(true);
        expect(wildcard.matchesParams(endpoint, 1003, sessionParams)).toBe(false);

        const specific = new NetworkSubscriptionLink(6, endpoint, 1003, 'aeron:udp', client, sessionParams);
        expect(specific.matchesParams(endpoint, 1003, sessionParams)).toBe(true);
        expect(specific.matchesParams(endpoint, 1003, params)).toBe(false);
        sessionParams.sessionId = 78;
        expect(specific.matchesParams(endpoint, 1003, sessionParams)).toBe(false);
    });

    it('reports its endpoint, its reliability, its response setup state and whether its endpoint supports MDS', () => {
        params.isReliable = false;
        const link = new NetworkSubscriptionLink(5, endpoint, 1003, 'aeron:udp', client, params);

        expect(link.channelEndpoint()).toBe(endpoint);
        expect(link.isReliable()).toBe(false);
        expect(link.responseSetupState()).toBe(ResponseSetupState.PENDING);
        link.responseSetupState(ResponseSetupState.COMPLETE);
        expect(link.responseSetupState()).toBe(ResponseSetupState.COMPLETE);
        link.responseSetupState(ResponseSetupState.ERROR);
        expect(link.responseSetupState()).toBe(ResponseSetupState.ERROR);
        expect(NetworkSubscriptionLink.ResponseSetupState).toBe(ResponseSetupState);
        expect(ResponseSetupState.values().map((s) => s.name())).toEqual(['PENDING', 'COMPLETE', 'ERROR']);

        expect(link.supportsMds()).toBe(false);
        (endpoint.hasDestinationControl as Mock).mockReturnValue(true);
        expect(link.supportsMds()).toBe(true);
    });
});

describe('UntetheredSubscription extra', () => {
    it('starts ACTIVE at the time it is given, and a state change sets the state and the time', () => {
        const link = new TestLink(5, 1003, new AeronClient(1, 1, newCounter(), newCounter()), new SubscriptionParams());
        const position = {} as ReadablePosition;

        const untethered = new UntetheredSubscription(link, position, 1_000);

        expect(untethered.state()).toBe(UntetheredSubscriptionState.ACTIVE);
        expect(untethered.timeOfLastUpdateNs).toBe(1_000);
        expect(untethered.subscriptionLink).toBe(link);
        expect(untethered.position).toBe(position);

        untethered.state(UntetheredSubscription.State.LINGER, 2_000, 1003, 7);
        expect(untethered.state()).toBe(UntetheredSubscriptionState.LINGER);
        expect(untethered.timeOfLastUpdateNs).toBe(2_000);

        untethered.state(UntetheredSubscriptionState.RESTING, 3_000, 1003, 7);
        expect(untethered.state()).toBe(UntetheredSubscriptionState.RESTING);
        expect(untethered.timeOfLastUpdateNs).toBe(3_000);
        expect(UntetheredSubscriptionState.values().map((s) => s.ordinal())).toEqual([0, 1, 2]);
        expect(String(UntetheredSubscriptionState.RESTING)).toBe('RESTING');
    });
});

describe('MediaDriver.Context extra (T17)', () => {
    it('conclude creates the driver command queue, the client proxy and the driver conductor proxy over that queue, and keeps a queue it is given', () => {
        const context = new MediaDriver.Context();
        try {
            context.conclude();

            const queue = context.driverCommandQueue() as ManyToOneConcurrentLinkedQueue<Runnable>;
            expect(queue).toBeInstanceOf(ManyToOneConcurrentLinkedQueue);
            expect(context.clientProxy()).toBeInstanceOf(ClientProxy);
            const proxy = context.driverConductorProxy() as DriverConductorProxy;
            expect(proxy).toBeInstanceOf(DriverConductorProxy);
            expect(context.controlTransportPoller()).not.toBeNull();

            // the proxy queues on the queue of the context
            proxy.responseConnected(1);
            expect(queue.size()).toBe(1);
            expect(context.toString()).toContain('driverCommandQueue=');
            expect(context.toString()).toContain('clientProxy=ClientProxy{}');
        } finally {
            context.close();
        }

        const given = new ManyToOneConcurrentLinkedQueue<Runnable>();
        const other = new MediaDriver.Context().driverCommandQueue(given);
        try {
            other.conclude();
            expect(other.driverCommandQueue()).toBe(given);
        } finally {
            other.close();
        }
    });
});
