// Extra tests of T18 (port-only, spec D42, D55): a full command queue of the sender or the receiver must never leave a
// publication or a subscription registered that the agent was not told of. `CommandProxy.offer` throws on a full queue
// (Java spins), so the conductor checks the room first and waits (a command) or refuses (a removal).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import type { SubscriptionLink } from '../../../src/driver/SubscriptionLink.js';
import type { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import { NetworkPublication } from '../../../src/driver/NetworkPublication.js';
import { DriverConductor } from '../../../src/driver/DriverConductor.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { DriverProxy } from '../../../src/client/DriverProxy.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';

const { CMD_QUEUE_CAPACITY } = Configuration;
const MAX_CYCLES = 100_000;
vi.setConfig({ testTimeout: 60_000 });

describe('DriverConductor with a full sender or receiver queue', () => {
    let ctx: MediaDriver.Context;
    let conductor: DriverConductor;
    let agent: NativeResourceAgent;
    let driverProxy: DriverProxy;
    let errors: Error[];

    function newConductor(
        senderCapacity: number,
        receiverCapacity: number,
        termLength = LogBufferDescriptor.TERM_MIN_LENGTH,
        clock: CachedNanoClock | null = null,
    ): void {
        errors = [];
        const context = new MediaDriver.Context();
        if (null !== clock) {
            context.nanoClock(clock).senderCachedNanoClock(clock).receiverCachedNanoClock(clock);
        }
        ctx = context
            .threadingMode(ThreadingMode.INVOKER)
            .publicationTermBufferLength(termLength)
            .counterValuesBufferLength(2 * 1024 * 1024)
            .errorHandler({ onError: (e) => errors.push(e) })
            .senderCommandQueue(new OneToOneConcurrentArrayQueue<() => void>(senderCapacity))
            .receiverCommandQueue(new OneToOneConcurrentArrayQueue<() => void>(receiverCapacity))
            .conclude();
        // the sender and the receiver never run: their queues only fill
        agent = new NativeResourceAgent(ctx);
        (ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy).nativeResourceAgent(agent);
        conductor = new DriverConductor(ctx);
        (ctx.driverConductorProxy() as DriverConductorProxy).driverConductor(conductor);
        conductor.onStart();
        driverProxy = new DriverProxy(ctx.toDriverCommands() as never, ctx.toDriverCommands()!.nextCorrelationId());
    }

    function cycle(): number {
        return conductor.doWork() + agent.doWork();
    }

    /** Cycles until what the conductor holds has not changed for a while: a command that waits keeps it busy. */
    function settle(): void {
        let unchanged = 0;
        let last = -1;
        for (let i = 0; unchanged < 30; i++) {
            expect(i, 'the conductor did not settle').toBeLessThan(MAX_CYCLES);
            cycle();
            const now = conductor.networkPublications.length + conductor.subscriptionLinks.length;
            unchanged = now === last ? unchanged + 1 : 0;
            last = now;
        }
    }

    function sizeOf(queue: OneToOneConcurrentArrayQueue<() => void> | null): number {
        return (queue as OneToOneConcurrentArrayQueue<() => void>).size();
    }

    beforeEach(() => {
        errors = [];
    });

    afterEach(() => {
        agent.onClose();
        conductor.onClose();
    });

    it('more addPublication commands than the queue holds leave every registered publication known to the sender', () => {
        newConductor(CMD_QUEUE_CAPACITY, CMD_QUEUE_CAPACITY);
        const requests = CMD_QUEUE_CAPACITY + 76;
        const base = 'aeron:udp?endpoint=127.0.0.1:';
        for (let i = 0; i < requests; i++) {
            driverProxy.addPublication(base + (30_000 + (i % 7)), 1000 + i);
        }

        settle();

        const queue = ctx.senderCommandQueue();
        expect(queue!.remainingCapacity()).toBe(0);
        // each registered publication is one command of the sender, and the endpoints they share one each
        const publications = conductor.networkPublications.length;
        const registrations = sizeOf(queue) - publications;
        expect(publications).toBeGreaterThan(0);
        expect(publications).toBeLessThan(requests);
        expect(publications + conductor.publicationLinks.length).toBe(2 * publications);
        expect(registrations).toBe(7); // the 7 endpoints of the 7 ports
        expect(errors).toEqual([]);

        // the sender takes its commands: the commands that waited are registered
        let command: (() => void) | null;
        while (null !== (command = queue!.poll())) {
            // the sender is not wired: the command is dropped, only the count matters
            void command;
        }
        settle();
        expect(conductor.networkPublications.length).toBeGreaterThan(publications);
        expect(errors).toEqual([]);
    });

    it('a subscription waits for room in the receiver queue and is then registered once with the receiver', () => {
        newConductor(CMD_QUEUE_CAPACITY, 4);
        for (let i = 0; i < 10; i++) {
            driverProxy.addSubscription('aeron:udp?endpoint=127.0.0.1:' + (30_100 + i), 2000 + i);
        }

        settle();

        const queue = ctx.receiverCommandQueue();
        // every subscription link is known to the receiver: a register and an add per endpoint, two commands each
        expect(sizeOf(queue)).toBe(2 * conductor.subscriptionLinks.length);
        expect(conductor.subscriptionLinks.length).toBeLessThan(10);
        expect(errors).toEqual([]);

        for (let round = 0; round < 40 && conductor.subscriptionLinks.length < 10; round++) {
            while (null !== queue!.poll()) {
                // dropped
            }
            settle();
            expect(sizeOf(queue)).toBeLessThanOrEqual(4);
        }
        expect(conductor.subscriptionLinks.length).toBe(10);
        expect(errors).toEqual([]);
    });

    it('a removal that the receiver queue cannot hold is refused before anything is removed', () => {
        newConductor(CMD_QUEUE_CAPACITY, 6);
        const id = driverProxy.addSubscription('aeron:udp?endpoint=127.0.0.1:30200', 3000);
        settle();
        expect(conductor.subscriptionLinks.length).toBe(1);

        // leave one free slot in the queue
        const queue = ctx.receiverCommandQueue()!;
        while (queue.remainingCapacity() > 1) {
            queue.offer(() => {});
        }

        expect(() => conductor.onRemoveSubscription(id, 77)).toThrowError(/receiver command queue is full/);
        expect(conductor.subscriptionLinks.length).toBe(1);
        const error = (() => {
            try {
                conductor.onRemoveSubscription(id, 77);
            } catch (e) {
                return e as { errorCode(): ErrorCode };
            }
            return null;
        })();
        expect(error!.errorCode()).toBe(ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE);

        while (null !== queue.poll()) {
            // dropped
        }
        conductor.onRemoveSubscription(id, 77);
        expect(conductor.subscriptionLinks.length).toBe(0);
    });

    function fill(queue: OneToOneConcurrentArrayQueue<() => void>): void {
        while (queue.remainingCapacity() > 0) {
            queue.offer(() => {});
        }
    }

    function drain(queue: OneToOneConcurrentArrayQueue<() => void>): void {
        while (null !== queue.poll()) {
            // dropped
        }
    }

    // issue #44; mutation: cleanupPublication offers without the room check, or never retries
    it('a publication whose linger ends while the sender queue is full is cleaned up once the queue has room Regression', () => {
        const clock = new CachedNanoClock();
        newConductor(CMD_QUEUE_CAPACITY, CMD_QUEUE_CAPACITY, LogBufferDescriptor.TERM_MIN_LENGTH, clock);
        const queue = ctx.senderCommandQueue() as OneToOneConcurrentArrayQueue<() => void>;
        const registrationId = driverProxy.addPublication('aeron:udp?endpoint=127.0.0.1:30300', 4000);
        settle();
        expect(conductor.networkPublications.length).toBe(1);
        const publication = conductor.networkPublications[0] as NetworkPublication;
        drain(queue);

        driverProxy.removePublication(registrationId, false);
        settle();
        drain(queue);
        fill(queue);
        const full = sizeOf(queue);
        const step = Configuration.timerIntervalNs();
        for (let i = 0; i < 40 && NetworkPublication.State.DONE !== publication.state(); i++) {
            clock.advance(step);
            cycle();
            // a full queue: nothing is offered, nothing throws
            expect(sizeOf(queue)).toBe(full);
            expect(errors).toEqual([]);
        }
        // the linger has ended long ago: only the queue holds the cleanup back
        expect(publication.state()).toBe(NetworkPublication.State.DONE);
        expect(publication.hasReachedEndOfLife()).toBe(false);

        drain(queue);
        for (let i = 0; i < 10; i++) {
            clock.advance(step);
            cycle();
        }
        // the removal of the publication and the close of the endpoint, once each
        expect(sizeOf(queue)).toBe(2);
        expect(errors).toEqual([]);
    });

    it('a receive endpoint that cannot be closed because the receiver queue is full is closed once it has room Regression', () => {
        newConductor(CMD_QUEUE_CAPACITY, CMD_QUEUE_CAPACITY);
        const queue = ctx.receiverCommandQueue() as OneToOneConcurrentArrayQueue<() => void>;
        driverProxy.addSubscription('aeron:udp?endpoint=127.0.0.1:30400', 5000);
        settle();
        const link = conductor.subscriptionLinks[0] as SubscriptionLink;
        const endpoint = link.channelEndpoint() as ReceiveChannelEndpoint;
        drain(queue);
        endpoint.decRefToStream(5000);
        expect(endpoint.shouldBeClosed()).toBe(true);

        fill(queue);
        conductor.tryCloseReceiveChannelEndpoint(endpoint);
        cycle();
        expect(sizeOf(queue)).toBe(CMD_QUEUE_CAPACITY);
        expect(endpoint.shouldBeClosed()).toBe(true);

        drain(queue);
        cycle();
        expect(sizeOf(queue)).toBe(1);
        expect(endpoint.shouldBeClosed()).toBe(false); // CLOSING
        cycle();
        expect(sizeOf(queue)).toBe(1); // asked once
        expect(errors).toEqual([]);
    });
});
