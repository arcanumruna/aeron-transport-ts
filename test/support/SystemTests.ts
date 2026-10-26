// The parts of Aeron's `Tests`, `SystemTests` and `TestMediaDriver` that the ported system tests call (phase 3, T5, D115).
// A test makes its drivers and clients here: each driver is an embedded `INVOKER` MediaDriver (D3) and each client has
// an `AgentInvoker` of its own, and `drainUntil` is the only wait there is: every turn runs one duty cycle of every
// driver and client conductor, gives the event loop a turn (the datagrams of real UDP arrive in it) and checks the
// condition, with a hard cap in turns that fails the test where Java's `Tests.await*` would spin until its timeout.
// With a manual clock a turn is also 1 ms of the clock of every driver and client, so the timeouts of the driver (image
// liveness, linger, receiver timeouts) pass without wall time.
import { afterEach } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AgentInvoker } from '../../src/agrona/concurrent/AgentInvoker.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { Aeron } from '../../src/client/Aeron.js';
import type { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { AeronException } from '../../src/client/exceptions/AeronException.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import { DebugChannelEndpointConfiguration } from '../../src/driver/ext/DebugChannelEndpointConfiguration.js';
import { DebugReceiveChannelEndpoint } from '../../src/driver/ext/DebugReceiveChannelEndpoint.js';
import type { LossGenerator } from '../../src/driver/ext/LossGenerator.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { LossReport } from '../../src/driver/reports/LossReport.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import { CYCLE_NS, ManualClock } from './EmbeddedRig.js';

/** The most duty cycles a driver gets to finish the commands that are queued when its test closes it. */
const QUIESCE_CYCLES = 1000;

/** The most turns `drainUntil` takes before it fails, unless the call gives another cap. */
export const DEFAULT_MAX_TURNS = 1_000_000;

/** A driver of a test and the clients connected to it. */
export class TestNode {
    public readonly clients: TestClient[] = [];
    private closed = false;

    public constructor(
        public readonly name: string,
        public readonly driver: MediaDriver,
        public readonly errors: Error[],
    ) {}

    /** The first client, which `SystemTests.launch` connects. */
    public get aeron(): Aeron {
        return (this.clients[0] as TestClient).aeron;
    }

    public isClosed(): boolean {
        return this.closed;
    }

    /** @internal */
    public closeAll(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        // clients before the driver, as the Java tests close them (try-with-resources in reverse)
        for (const client of this.clients.splice(0).reverse()) {
            client.close();
        }
        // The agents of Java's driver are threads, which have long since taken the commands a client left in their queues when
        // the test closes the driver (a destination added the moment before the close, say, whose transport is open). The
        // driver here runs only when it is invoked: let it finish them, so that no socket outlives its driver.
        const invoker = this.driver.sharedAgentInvoker();
        let quiet = false;
        for (let i = 0; i < QUIESCE_CYCLES; i++) {
            if (0 === invoker.invoke()) {
                quiet = true;
                break;
            }
        }
        this.driver.close();
        if (!quiet) {
            // a close path that keeps producing work (a leak, a command that requeues itself) must not hide behind the cap
            throw new Error(
                'driver ' +
                    this.name +
                    ' still had work after ' +
                    QUIESCE_CYCLES +
                    ' duty cycles when its test closed it',
            );
        }
    }
}

export class TestClient {
    public readonly invoker: AgentInvoker;
    private closed = false;

    public constructor(
        public readonly aeron: Aeron,
        public readonly driver: MediaDriver,
    ) {
        this.invoker = aeron.conductorAgentInvoker() as AgentInvoker;
    }

    public close(): void {
        if (!this.closed) {
            this.closed = true;
            this.aeron.close();
        }
    }

    public isClosed(): boolean {
        return this.closed;
    }
}

export class SystemTests {
    public static readonly DEFAULT_MAX_TURNS = DEFAULT_MAX_TURNS;

    /** The clock of every driver and client when the test was begun with `manualClock`. */
    public readonly clock: ManualClock | null;
    public readonly nodes: TestNode[] = [];
    public turns = 0;
    private nextNodeId = 0;

    /**
     * @param testName    names the drivers (there is no Aeron directory, D4: the name is for messages and for telling
     *                    two drivers of one test apart).
     * @param manualClock true to give the drivers and clients a clock that one turn advances by 1 ms.
     */
    public constructor(
        public readonly testName: string,
        manualClock = false,
    ) {
        this.clock = manualClock ? new ManualClock() : null;
    }

    /** `TestMediaDriver.launch`: an embedded INVOKER driver with a client connected to it. */
    public launch(
        configureDriver: (ctx: MediaDriver.Context) => void = () => {},
        configureClient: (ctx: Aeron.Context) => void = () => {},
    ): TestNode {
        const name = this.testName + '-driver' + this.nextNodeId++;
        const errors: Error[] = [];
        const driverContext = new MediaDriver.Context()
            .threadingMode(ThreadingMode.INVOKER)
            .errorHandler({ onError: (e) => void errors.push(e) });
        if (null !== this.clock) {
            driverContext.epochClock(this.clock).nanoClock(this.clock);
        }
        configureDriver(driverContext);

        const node = new TestNode(name, MediaDriver.launch(driverContext), errors);
        this.nodes.push(node);
        this.connect(node, configureClient);
        return node;
    }

    /** Another client of a driver of the test. */
    public connect(node: TestNode, configureClient: (ctx: Aeron.Context) => void = () => {}): TestClient {
        const errors = node.errors;
        const context = new Aeron.Context()
            .mediaDriver(node.driver)
            .useConductorAgentInvoker(true)
            .errorHandler({ onError: (e) => void errors.push(e) });
        if (null !== this.clock) {
            context.epochClock(this.clock).nanoClock(this.clock);
        }
        configureClient(context);
        const client = new TestClient(Aeron.connect(context), node.driver);
        node.clients.push(client);
        return client;
    }

    /** Every error the drivers and clients of the test have reported. */
    public errors(): Error[] {
        return this.nodes.flatMap((node) => node.errors);
    }

    /** One turn without the event loop: the clock, then a duty cycle of every driver and client, in the order made. */
    public cycle(): number {
        if (null !== this.clock) {
            this.clock.ns += CYCLE_NS;
        }
        this.turns++;
        let work = 0;
        for (const node of this.nodes) {
            if (node.isClosed()) {
                continue;
            }
            work += node.driver.sharedAgentInvoker().invoke();
            for (const client of node.clients.slice()) {
                if (!client.isClosed()) {
                    work += client.invoker.invoke();
                }
            }
        }
        return work;
    }

    /**
     * `Tests.await` / `while (...) Tests.yield()`: cycles and turns of the event loop until the condition holds. Fails at
     * `maxTurns` with what it waited for and the errors reported so far.
     */
    public async drainUntil(
        condition: () => boolean,
        maxTurns = DEFAULT_MAX_TURNS,
        what: () => string = () => 'condition',
    ): Promise<void> {
        for (let turn = 0; turn < maxTurns; turn++) {
            if (condition()) {
                return;
            }
            this.cycle();
            await new Promise<void>((resolve) => setImmediate(resolve));
        }

        if (condition()) {
            return;
        }
        throw new Error('no ' + what() + ' after ' + maxTurns + ' turns; errors: [' + this.errors().map(String) + ']');
    }

    /**
     * `Tests.executeUntil(condition, iterationConsumer, maxIterations, timeoutNs)`: the iteration, then (if the condition
     * does not hold yet) a turn, until the condition holds, `maxIterations` iterations have run or `timeoutNs` has passed.
     * It stops at the limits and does not fail, as Java's does. The time is the turns taken, 1 ms of the manual clock each
     * (`CYCLE_NS`): no wall time is read. Returns the number of iterations run.
     */
    public async executeUntil(
        condition: () => boolean,
        iteration: (i: number) => void,
        maxIterations: number,
        timeoutNs: number,
    ): Promise<number> {
        const startTurns = this.turns;
        for (let i = 0; ; i++) {
            iteration(i);
            if (condition() || (this.turns - startTurns) * CYCLE_NS >= timeoutNs || i >= maxIterations) {
                return i + 1;
            }
            this.cycle();
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
    }

    /** `Tests.awaitConnected(Publication)` */
    public awaitConnectedPublication(publication: Publication, maxTurns = DEFAULT_MAX_TURNS): Promise<void> {
        return this.drainUntil(
            () => publication.isConnected(),
            maxTurns,
            () => 'connected publication ' + publication,
        );
    }

    /** `Tests.awaitConnected(Subscription)` */
    public awaitConnectedSubscription(subscription: Subscription, maxTurns = DEFAULT_MAX_TURNS): Promise<void> {
        return this.drainUntil(
            () => subscription.isConnected(),
            maxTurns,
            () => 'connected subscription ' + subscription.channel(),
        );
    }

    /** `Tests.awaitConnected`, either kind. */
    public awaitConnected(resource: Publication | Subscription, maxTurns = DEFAULT_MAX_TURNS): Promise<void> {
        return this.drainUntil(
            () => resource.isConnected(),
            maxTurns,
            () => 'connected ' + resource,
        );
    }

    /** `Tests.awaitConnections` */
    public awaitConnections(
        subscription: Subscription,
        connectionCount: number,
        maxTurns = DEFAULT_MAX_TURNS,
    ): Promise<void> {
        return this.drainUntil(
            () => subscription.imageCount() >= connectionCount,
            maxTurns,
            () => connectionCount + ' images of ' + subscription.channel() + ' (has ' + subscription.imageCount() + ')',
        );
    }

    /** `Tests.awaitAvailableWindow(Publication)`: the publication has window to send into. */
    public awaitAvailable(publication: Publication, maxTurns = DEFAULT_MAX_TURNS): Promise<void> {
        return this.drainUntil(
            () => publication.availableWindow() > 0,
            maxTurns,
            () => 'available window of ' + publication,
        );
    }

    /** `Tests.awaitPosition(CountersReader, counterId, position)`: fails at once for a counter that is not allocated. */
    public awaitPosition(
        counters: CountersReader,
        counterId: number,
        position: number,
        maxTurns = DEFAULT_MAX_TURNS,
    ): Promise<void> {
        return this.drainUntil(
            () => {
                if (counters.getCounterValue(counterId) >= position) {
                    return true;
                }
                if (counters.getCounterState(counterId) !== CountersReader.RECORD_ALLOCATED) {
                    throw new Error('count not active: ' + counterId);
                }
                return false;
            },
            maxTurns,
            () =>
                'position ' +
                position +
                ' of counter ' +
                counterId +
                ' (at ' +
                counters.getCounterValue(counterId) +
                ')',
        );
    }

    /** `Tests.awaitCounterDelta(counters, counterId, delta)`: the delta is from the value now. */
    public awaitCounterDelta(
        counters: CountersReader,
        counterId: number,
        delta: number,
        maxTurns = DEFAULT_MAX_TURNS,
    ): Promise<void> {
        return this.awaitCounterDeltaFrom(counters, counterId, counters.getCounterValue(counterId), delta, maxTurns);
    }

    /** `Tests.awaitCounterDelta(counters, counterId, initialValue, delta)` */
    public awaitCounterDeltaFrom(
        counters: CountersReader,
        counterId: number,
        initialValue: number,
        delta: number,
        maxTurns = DEFAULT_MAX_TURNS,
    ): Promise<void> {
        const expected = initialValue + delta;
        return this.drainUntil(
            () => counters.getCounterValue(counterId) >= expected,
            maxTurns,
            () => "'" + counters.getCounterLabel(counterId) + "' to reach " + expected,
        );
    }

    /** `Tests.reAddSubscription`: adds the subscription, again while the driver refuses it with a warning (it is closing). */
    public async reAddSubscription(
        aeron: Aeron,
        channel: string,
        streamId: number,
        maxTurns = DEFAULT_MAX_TURNS,
    ): Promise<Subscription> {
        let subscription: Subscription | null = null;
        await this.drainUntil(
            () => {
                try {
                    subscription = aeron.addSubscription(channel, streamId);
                    return true;
                } catch (ex) {
                    if (ex instanceof RegistrationException && ex.category() === AeronException.Category.WARN) {
                        return false;
                    }
                    throw ex;
                }
            },
            maxTurns,
            () => 'subscription of ' + channel,
        );
        return subscription as unknown as Subscription;
    }

    /** Teardown: every client is closed before its driver; the first error a close throws is thrown after the rest. */
    public close(): void {
        let failure: unknown = null;
        for (const node of this.nodes.splice(0).reverse()) {
            try {
                node.closeAll();
            } catch (ex) {
                failure ??= ex;
            }
        }

        if (null !== failure) {
            throw failure;
        }
    }
}

/** The parts of `TestMediaDriver` that the ported system tests call, as statics. */
export const TestMediaDriver = {
    /**
     * `TestMediaDriver.enableRandomLoss(context, rate, seed, loseDataMessages, loseControlMessages)`, Java driver: a debug
     * receive endpoint that drops frames of the data and/or control stream at random.
     */
    enableRandomLoss(
        context: MediaDriver.Context,
        rate: number,
        seed: number,
        loseDataMessages: boolean,
        loseControlMessages: boolean,
    ): void {
        const never: LossGenerator = { shouldDropFrame: () => false };
        const dataLossGenerator = loseDataMessages
            ? DebugChannelEndpointConfiguration.lossGeneratorSupplier(rate, seed)
            : never;
        const controlLossGenerator = loseControlMessages
            ? DebugChannelEndpointConfiguration.lossGeneratorSupplier(rate, seed)
            : never;
        context.receiveChannelEndpointSupplier({
            newInstance: (udpChannel, dispatcher, statusIndicator, ctx) =>
                new DebugReceiveChannelEndpoint(
                    udpChannel,
                    dispatcher,
                    statusIndicator,
                    ctx,
                    dataLossGenerator,
                    controlLossGenerator,
                ),
        });
    },
};

/**
 * The loss report of a driver that has no file (spec D50): the buffer that the context's `LossReport` writes to. Make one
 * with `newLossReport` and set it with `context.lossReport(report)`.
 */
export function newLossReportBuffer(capacity = 64 * 1024): { buffer: UnsafeBuffer; report: LossReport } {
    const buffer = new UnsafeBuffer(new Uint8Array(capacity));
    return { buffer, report: new LossReport(buffer) };
}

/**
 * `SystemTests.verifyLossOccurredForStream(aeronDirectoryName, streamId)`: reads the entries of the loss report (the layout of
 * `LossReportReader`) and says whether one for the stream observed loss (an observation count and total bytes lost above 0);
 * the test asserts that it is true.
 */
export function verifyLossOccurredForStream(buffer: UnsafeBuffer, streamId: number): boolean {
    const { SIZE_OF_INT, align } = BitUtil;
    let offset = 0;
    while (offset + LossReport.ENTRY_ALIGNMENT <= buffer.capacity()) {
        const observationCount = buffer.getLongVolatile(offset + LossReport.OBSERVATION_COUNT_OFFSET);
        if (observationCount <= 0) {
            break;
        }

        const totalBytesLost = buffer.getLong(offset + LossReport.TOTAL_BYTES_LOST_OFFSET);
        const entryStreamId = buffer.getInt(offset + LossReport.STREAM_ID_OFFSET);
        if (entryStreamId === streamId && totalBytesLost > 0) {
            return true;
        }

        const channelLength = buffer.getInt(offset + LossReport.CHANNEL_OFFSET);
        const sourceOffset = offset + LossReport.CHANNEL_OFFSET + align(SIZE_OF_INT + channelLength, SIZE_OF_INT);
        const sourceLength = buffer.getInt(sourceOffset);
        offset += align(sourceOffset + SIZE_OF_INT + sourceLength - offset, LossReport.ENTRY_ALIGNMENT);
    }

    return false;
}

const open = new Set<SystemTests>();

afterEach(() => {
    const pending = [...open];
    open.clear();
    for (const tests of pending) {
        tests.close();
    }
});

/**
 * The system tests of the current test: `systemTests()` in the test, and whatever it launched is closed (clients before
 * drivers) after it, even when it failed.
 */
export function systemTests(testName: string, manualClock = false): SystemTests {
    const tests = new SystemTests(testName.replace(/[^A-Za-z0-9]+/g, '_'), manualClock);
    open.add(tests);
    return tests;
}
