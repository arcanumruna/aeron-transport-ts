// System tests of T22 (port-only, spec 4.1, D8, D11, D100): the event loop runner of an embedded driver and its clients.
// A driver that is not `INVOKER` runs itself on the event loop with the idle strategy of its context, and the conductors
// of the clients of the process run in its duty cycle. The tests use real UDP on the loopback, and an idle strategy that
// parks for a minute, so that only a wake up hook (D8) can make the runner run in the time of the test.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackoffIdleStrategy } from '../../src/agrona/concurrent/BackoffIdleStrategy.js';
import type { IdleStrategy } from '../../src/agrona/concurrent/IdleStrategy.js';
import { NoOpIdleStrategy } from '../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { Aeron } from '../../src/client/Aeron.js';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { DefaultNameResolver } from '../../src/driver/DefaultNameResolver.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import { Consumed, SystemNode, driveUntil, plan, sequences, transfer } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';

const STREAM_ID = 1001;
const MINUTE_NS = 60_000_000_000;

/** An idle strategy that parks for a minute when a cycle did no work, and counts what the runner asks of it. */
class ParksForAMinute implements IdleStrategy {
    public idles = 0;
    public parks = 0;

    public idle(workCount?: number): number {
        this.idles++;
        if (undefined !== workCount && workCount > 0) {
            return 0;
        }

        this.parks++;
        return MINUTE_NS;
    }

    public reset(): void {}

    public alias(): string {
        return 'parks-for-a-minute';
    }
}

/** An idle strategy that is a back off, and records the longest wait it asked for. */
class RecordingBackoff implements IdleStrategy {
    public readonly delegate = new BackoffIdleStrategy();
    public idles = 0;
    public longestWaitNs = 0;
    public spinsAndYields = 0;

    public idle(workCount?: number): number {
        this.idles++;
        const waitNs = this.delegate.idle(workCount);
        if (waitNs > this.longestWaitNs) {
            this.longestWaitNs = waitNs;
        } else if (0 === waitNs) {
            this.spinsAndYields++;
        }

        return waitNs;
    }

    public reset(): void {
        this.delegate.reset();
    }

    public alias(): string {
        return 'recording-backoff';
    }
}

describe('Event loop runner', () => {
    const nodes: SystemNode[] = [];

    afterEach(() => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
    });

    function newNode(configure?: (ctx: MediaDriver.Context) => void): SystemNode {
        const node = new SystemNode(configure);
        nodes.push(node);
        return node;
    }

    /** Wait until the runner has done a cycle with nothing to do and is now parked for a minute. */
    async function parked(idle: ParksForAMinute, what: string): Promise<void> {
        let seen = -1;
        await driveUntil(() => {
            const quiet = idle.parks > 0 && idle.parks === seen;
            seen = idle.parks;
            return quiet;
        }, 'a parked runner ' + what);
    }

    it('aDriverThatIsNotInvokerRunsItselfAndAnInvokerDriverDoesNot', () => {
        for (const mode of ThreadingMode.values()) {
            const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(mode));
            try {
                const runner = driver.runner();
                if (ThreadingMode.INVOKER === mode) {
                    expect(runner).toBeNull();
                    expect(driver.host(driver.sharedAgentInvoker())).toBe(false);
                } else {
                    expect(runner).not.toBeNull();
                    expect(runner!.isClosed()).toBe(false);
                    expect(runner!.agent().roleName()).toBe(driver.sharedAgentInvoker().agent().roleName());
                }
                expect(driver.sharedAgentInvoker().isRunning()).toBe(true);
            } finally {
                driver.close();
            }
        }
    });

    it('theDefaultPathConnectsAndTheSynchronousCallsDoNotWaitForTheDriverTimeoutRegression', async () => {
        // Aeron.connect without useConductorAgentInvoker used to start a conductor that nothing drove the driver for:
        // addPublication waited for the driver timeout (10 s) on the one thread that the driver would have run on
        const node = newNode();
        const started = performance.now();

        const publication = node.aeron.addPublication('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), STREAM_ID);
        const subscription = node.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), STREAM_ID);

        expect(performance.now() - started).toBeLessThan(2_000);
        expect(publication).not.toBeNull();
        expect(subscription.isClosed()).toBe(false);
        // the client has no invoker of its own: its conductor is run by the runner of the driver
        expect(node.aeron.conductorAgentInvoker()).toBeNull();
        expect(node.errors).toEqual([]);
    });

    it('aClientThatClosesIsNoLongerRunByTheRunner', async () => {
        const node = newNode();
        const second = Aeron.connect(new Aeron.Context().mediaDriver(node.driver));
        const clientId = second.clientId();
        expect(clientId).not.toBe(node.aeron.clientId());

        second.close();
        expect(second.isClosed()).toBe(true);

        // the driver and the first client go on
        const publication = node.aeron.addPublication('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), STREAM_ID);
        expect(publication).not.toBeNull();
        expect(node.errors).toEqual([]);
    });

    it('theRunnerBacksOffInsteadOfSpinningWhenThereIsNothingToDo', async () => {
        const idle = new RecordingBackoff();
        const node = newNode((ctx) => void ctx.sharedIdleStrategy(idle));

        // spins and yields (a turn of the event loop each), then parks: a wait the runner turns into a timer
        await driveUntil(() => idle.longestWaitNs > 0, 'a park');
        expect(idle.spinsAndYields).toBeGreaterThan(0);
        const parked = idle.idles;

        // while it is parked it cycles a few times a millisecond at most: far fewer than a spin would
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        expect(idle.idles - parked).toBeLessThan(150);
        expect(node.errors).toEqual([]);
    });

    it('aRunnerWithNoIdleStrategyDoesNotStarveTheEventLoop', async () => {
        const node = newNode((ctx) => void ctx.sharedIdleStrategy(NoOpIdleStrategy.INSTANCE));
        const port = freeUdpPort();
        const other = newNode();
        const subscription = other.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
        const publication = node.aeron.addPublication(
            'aeron:udp?endpoint=127.0.0.1:' + port,
            STREAM_ID,
        ) as ConcurrentPublication;

        // a timer, an I/O event and a promise all get their turn while the runner has a duty cycle after every turn
        let timers = 0;
        const interval = setInterval(() => timers++, 1);
        try {
            await driveUntil(() => publication.isConnected() && subscription.imageCount() === 1, 'connected');
            const consumed = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 300, () => 100),
                consumed,
                100,
                'all messages',
            );
            expect(consumed.sequences).toEqual(sequences(0, 300));
            await driveUntil(() => timers >= 5, 'timers');
        } finally {
            clearInterval(interval);
        }
    });

    describe('the wake up hooks of D8 cut short a park', () => {
        it('aCommandOfTheClientRunsTheDriverNow', async () => {
            const idle = new ParksForAMinute();
            const node = newNode((ctx) => void ctx.sharedIdleStrategy(idle));
            await parked(idle, 'before the command');

            // the facade call writes the command and wakes the runner, which would otherwise sleep for a minute
            const id = node.aeron.asyncAddPublication('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), STREAM_ID);
            await driveUntil(() => null !== node.aeron.getPublication(id), 'the publication');
            expect(node.errors).toEqual([]);
        });

        it('aDatagramArrivingRunsTheDriverNow', async () => {
            const idle = new ParksForAMinute();
            const subscriber = newNode((ctx) => void ctx.sharedIdleStrategy(idle));
            const publisher = newNode();
            const port = freeUdpPort();

            const subscription = subscriber.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
            await parked(idle, 'before the setup frame');
            const publication = publisher.aeron.addPublication(
                'aeron:udp?endpoint=127.0.0.1:' + port,
                STREAM_ID,
            ) as ConcurrentPublication;

            // the setup frame is a datagram: the parked driver makes the image and answers with a status message
            await driveUntil(() => publication.isConnected() && subscription.imageCount() === 1, 'connected stream');
            const consumed = new Consumed();
            await transfer(
                publication,
                subscription,
                plan(0, 50, () => 100),
                consumed,
                100,
                'all messages',
            );
            expect(consumed.sequences).toEqual(sequences(0, 50));
        });

        it('theEndOfAHostNameLookUpRunsTheClientNow', async () => {
            const lookups: {
                host: string;
                callback: (err: Error | null, address?: string, family?: number) => void;
            }[] = [];
            vi.spyOn(dns, 'lookup').mockImplementation(((
                host: string,
                _options: unknown,
                callback: (err: Error | null, address?: string, family?: number) => void,
            ) => {
                lookups.push({ host, callback });
            }) as never);

            const idle = new ParksForAMinute();
            const node = newNode((ctx) => void ctx.sharedIdleStrategy(idle));
            await parked(idle, 'before the add');

            const id = node.aeron.asyncAddSubscription('aeron:udp?endpoint=a-name.example:' + freeUdpPort(), STREAM_ID);
            expect(lookups.map((l) => l.host)).toEqual(['a-name.example']);
            expect(node.aeron.getSubscription(id)).toBeNull();

            // the look-up completes on the event loop and wakes the parked runner, which writes the command and adds it
            await parked(idle, 'while the look-up is out');
            expect(node.aeron.isCommandActive(id)).toBe(true);
            // the calls that ask the client about a command run its conductor themselves (Java's rule), so the wait is on the
            // runner: a cycle of its idle strategy after the end of the look-up, with no call of the client
            const cyclesBefore = idle.idles;
            lookups[0]!.callback(null, '127.0.0.1', 4);
            await driveUntil(() => idle.idles > cyclesBefore, 'a cycle after the look-up');
            await driveUntil(() => !node.aeron.isCommandActive(id), 'the command to be done');
            expect(node.aeron.getSubscription(id)).not.toBeNull();
            expect(node.errors).toEqual([]);
        });

        it('theEndOfADriverHostNameLookUpRunsTheDriverNow', async () => {
            const lookups: {
                host: string;
                callback: (err: Error | null, address?: string, family?: number) => void;
            }[] = [];
            vi.spyOn(dns, 'lookup').mockImplementation(((
                host: string,
                _options: unknown,
                callback: (err: Error | null, address?: string, family?: number) => void,
            ) => {
                lookups.push({ host, callback });
            }) as never);

            const idle = new ParksForAMinute();
            const node = newNode((ctx) => void ctx.sharedIdleStrategy(idle));
            await parked(idle, 'before the re-resolution');

            // the conductor asks the native resource agent to resolve a name again; the agent starts a look-up
            const proxy = node.driver.context().nativeResourceAgentProxy()!;
            const result = proxy.reResolveAddress('another-name.example:5050', 'endpoint');
            node.driver.wake();
            await driveUntil(() => lookups.length === 1, 'the look-up to start');
            await parked(idle, 'while the look-up is out');
            expect(result.get()).toBeNull();

            // it ends: the callback completes the result and wakes the runner, with no other event to do it
            const cyclesBefore = idle.idles;
            lookups[0]!.callback(null, '127.0.0.1', 4);
            expect(result.get()).not.toBeNull();
            await driveUntil(() => idle.idles > cyclesBefore, 'a cycle after the look-up');
        });
    });

    it('closingTheDriverEndsTheRunnerAndFreesTheClientToo', async () => {
        const node = newNode();
        const runner = node.driver.runner()!;
        const publication = node.aeron.addPublication('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), STREAM_ID);
        expect(publication).not.toBeNull();

        node.driver.close();

        expect(runner.isClosed()).toBe(true);
        expect(node.driver.sharedAgentInvoker().isClosed()).toBe(true);
        // a second close is harmless, and so is the close of the client afterwards
        node.driver.close();
        node.aeron.close();
        expect(node.aeron.isClosed()).toBe(true);
    });

    it('aMessageOfAParkedRunnerLeavesAfterACallToWake', async () => {
        // offer does not wake the runner (D100): the application that cannot wait for the end of a park calls wake
        const idle = new ParksForAMinute();
        const publisher = newNode((ctx) => void ctx.sharedIdleStrategy(idle));
        const subscriber = newNode();
        const port = freeUdpPort();
        const subscription = subscriber.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, STREAM_ID);
        const publication = publisher.aeron.addPublication(
            'aeron:udp?endpoint=127.0.0.1:' + port,
            STREAM_ID,
        ) as ConcurrentPublication;
        await driveUntil(() => publication.isConnected() && subscription.imageCount() === 1, 'connected stream');
        await parked(idle, 'before the offer');

        const message = new UnsafeBuffer(new Uint8Array(8));
        message.putInt(0, 7);
        expect(publication.offer(message, 0, 8)).toBeGreaterThan(0);
        publisher.driver.wake();

        const received: number[] = [];
        await driveUntil(() => {
            subscription.poll({ onFragment: (buffer, offset) => void received.push(buffer.getInt(offset)) }, 10);
            return received.length > 0;
        }, 'the message');
        expect(received).toEqual([7]);
    });

    beforeEach(() => {
        DefaultNameResolver.clearCache();
    });
});
