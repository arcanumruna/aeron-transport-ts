// The world of a deterministic simulation (T22, spec 8.2): nodes that are each a `MediaDriver` and an `Aeron` client, stepped by
// hand on one manual clock over a `SimNetwork` that replaces `dgram.createSocket`. A step advances the clock, delivers the
// datagrams that are due and runs one duty cycle of every driver and every client conductor, in the order the nodes
// were added. `run` repeats steps until a condition holds, with a hard cap, and fails at the cap instead of hanging.
import dgram from 'node:dgram';
import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { AgentInvoker } from '../../src/agrona/concurrent/AgentInvoker.js';
import { Aeron } from '../../src/client/Aeron.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import { ManualClock } from './EmbeddedRig.js';
import { SimNetwork } from './SimNetwork.js';
import type { FaultModel } from './SimNetwork.js';

/** One step of a simulation is this long on the clock. */
export const STEP_NS = 1_000_000;

/** The most steps `run` takes before it gives up. */
export const MAX_STEPS = 200_000;

/**
 * The most steps `run` waits for a `progress` probe to change (issue #49). The longest wait of a healthy run, over all of
 * the netsim scenarios and their seeds, is about 1,000 steps (a small window under heavy loss), so this is eight times
 * that; the runs are deterministic per seed, so the margin is for changes of the code, not for timing. A broken build
 * that delivers nothing fails after this many steps instead of MAX_STEPS.
 */
export const MAX_STALLED_STEPS = 8_000;

export class SimNode {
    public readonly errors: Error[] = [];
    public readonly driver: MediaDriver;
    public readonly aeron: Aeron;
    private readonly clientInvoker: AgentInvoker;
    private isClosed = false;

    public constructor(clock: ManualClock, configure: (ctx: MediaDriver.Context) => void) {
        const driverContext = new MediaDriver.Context()
            .threadingMode(ThreadingMode.INVOKER)
            .epochClock(clock)
            .nanoClock(clock)
            .errorHandler({ onError: (e) => void this.errors.push(e) });
        configure(driverContext);
        this.driver = MediaDriver.launch(driverContext);
        this.aeron = Aeron.connect(
            new Aeron.Context()
                .mediaDriver(this.driver)
                .useConductorAgentInvoker(true)
                .epochClock(clock)
                .nanoClock(clock)
                .errorHandler({ onError: (e) => void this.errors.push(e) }),
        );
        this.clientInvoker = this.aeron.conductorAgentInvoker() as AgentInvoker;
    }

    public cycle(): number {
        if (this.isClosed) {
            return 0;
        }
        return this.driver.sharedAgentInvoker().invoke() + this.clientInvoker.invoke();
    }

    public close(): void {
        if (!this.isClosed) {
            this.aeron.close();
            this.driver.close();
            this.isClosed = true;
        }
    }
}

export class SimWorld {
    public readonly clock = new ManualClock();
    public readonly network: SimNetwork;
    public steps = 0;
    private readonly nodes: SimNode[] = [];
    private readonly createSocket: MockInstance;

    public constructor(seed: number, model: FaultModel) {
        this.network = new SimNetwork(seed, model, this.clock);
        this.createSocket = vi
            .spyOn(dgram, 'createSocket')
            .mockImplementation(((options?: { reuseAddr?: boolean }) => this.network.newSocket(options)) as never);
    }

    public addNode(configure: (ctx: MediaDriver.Context) => void = () => {}): SimNode {
        const node = new SimNode(this.clock, configure);
        this.nodes.push(node);
        return node;
    }

    /** Leave a node out of the world: closed, its port free, its sockets gone. */
    public removeNode(node: SimNode): void {
        node.close();
        this.nodes.splice(this.nodes.indexOf(node), 1);
    }

    /** One step: time passes, the datagrams that are due arrive, and every node runs a duty cycle. */
    public step(): void {
        this.steps++;
        this.clock.ns += STEP_NS;
        this.network.deliverDue();
        for (const node of this.nodes.slice()) {
            node.cycle();
        }
    }

    /**
     * Steps until the condition holds. Fails with what it waited for, after `maxSteps` steps, at the first error of a node,
     * or, when a `progress` probe is given, when its value has not changed for MAX_STALLED_STEPS steps. Returns the steps
     * it took.
     */
    public run(condition: () => boolean, what: string, maxSteps = MAX_STEPS, progress?: () => number): number {
        let lastProgress = progress?.();
        let stalled = 0;
        for (let taken = 0; taken < maxSteps; taken++) {
            this.failOnError(what);
            if (condition()) {
                return taken;
            }
            if (undefined !== progress) {
                const now = progress();
                stalled = now === lastProgress ? stalled + 1 : 0;
                lastProgress = now;
                if (stalled >= MAX_STALLED_STEPS) {
                    throw new Error(
                        'no ' +
                            what +
                            ': no progress for ' +
                            stalled +
                            ' steps at step ' +
                            this.steps +
                            ' (' +
                            this.errorsOf() +
                            ')',
                    );
                }
            }
            this.step();
        }
        this.failOnError(what);

        if (condition()) {
            return maxSteps;
        }
        throw new Error('no ' + what + ' after ' + maxSteps + ' steps (' + this.errorsOf() + ')');
    }

    /** Steps for a time on the clock, with the condition held at each step end: for "nothing happens" checks. */
    public runFor(ns: number): void {
        const until = this.clock.ns + ns;
        while (this.clock.ns < until) {
            this.failOnError('the end of the time');
            this.step();
        }
        this.failOnError('the end of the time');
    }

    /**
     * Fails at the first error of any node (issue #49). Every scenario asserts at its end that no node had an error, so
     * the first one is the failure; on a broken build the scenario would otherwise run to the step cap, which takes
     * minutes when each step throws.
     */
    private failOnError(what: string): void {
        const errors = this.errorsOf();
        if ('' !== errors) {
            throw new Error(
                'error of a node while waiting for ' + what + ' after ' + this.steps + ' steps (' + errors + ')',
            );
        }
    }

    /** The nodes that are in the world now. */
    public allNodes(): readonly SimNode[] {
        return this.nodes;
    }

    public errorsOf(): string {
        return this.nodes
            .flatMap((node) => node.errors)
            .map(String)
            .join('; ');
    }

    public close(): void {
        for (const node of this.nodes.splice(0)) {
            node.close();
        }
        this.createSocket.mockRestore();
    }
}
