// A `MediaDriver` launched as `INVOKER` and an `Aeron` client connected to it in the same process (spec 4.3, D15), with the
// duty cycles driven by the test: the driver's `sharedAgentInvoker()` is the client's `driverAgentInvoker`, the conductor
// of the client is an `AgentInvoker` too, and `until` runs both a capped number of times, giving the event loop a turn
// between the cycles so that the datagrams of real UDP on the loopback arrive. Nothing waits on the clock.
import type { AgentInvoker } from '../../src/agrona/concurrent/AgentInvoker.js';
import { Aeron } from '../../src/client/Aeron.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';

/** The most duty cycles `until` runs before it gives up. */
export const MAX_CYCLES = 20_000;

/** The time of a rig with a manual clock that one duty cycle advances (1 ms). */
export const CYCLE_NS = 1_000_000;

/**
 * One clock for the driver and the client, which only `EmbeddedRig.cycle` advances: a linger of seconds takes some thousands
 * of cycles and no wall time. Starts at a time that is not 0 (a driver heartbeat of 0 is "no driver").
 */
export class ManualClock {
    public ns = 1_000_000 * CYCLE_NS;

    public time(): number {
        return Math.floor(this.ns / 1_000_000);
    }

    public nanoTime(): number {
        return this.ns;
    }
}

export class EmbeddedRig {
    public readonly driver: MediaDriver;
    public readonly aeron: Aeron;
    public readonly errors: Error[] = [];
    /** The clock of the driver and the client when the rig is made with `manualClock`, otherwise null. */
    public readonly clock: ManualClock | null;

    /**
     * @param manualClock       true for a clock that only the duty cycles advance (the synchronous calls of the client, which wait
     *                          for the driver against the clock, must not be used then).
     * @param configureDriver   to set options on the context of the driver.
     * @param configureClient   to set options on the context of the client.
     */
    public constructor(
        manualClock = false,
        configureDriver: (ctx: MediaDriver.Context) => void = () => {},
        configureClient: (ctx: Aeron.Context) => void = () => {},
    ) {
        this.clock = manualClock ? new ManualClock() : null;
        const driverContext = new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER).errorHandler({
            onError: (e) => void this.errors.push(e),
        });
        if (null !== this.clock) {
            driverContext.epochClock(this.clock).nanoClock(this.clock);
        }
        configureDriver(driverContext);
        this.driver = MediaDriver.launch(driverContext);

        const clientContext = new Aeron.Context()
            .mediaDriver(this.driver)
            .useConductorAgentInvoker(true)
            .errorHandler({ onError: (e) => void this.errors.push(e) });
        if (null !== this.clock) {
            clientContext.epochClock(this.clock).nanoClock(this.clock);
        }
        configureClient(clientContext);
        this.aeron = Aeron.connect(clientContext);
    }

    /** One duty cycle of the driver and one of the client conductor. */
    public cycle(): number {
        if (null !== this.clock) {
            this.clock.ns += CYCLE_NS;
        }
        return (
            this.driver.sharedAgentInvoker().invoke() + (this.aeron.conductorAgentInvoker() as AgentInvoker).invoke()
        );
    }

    /** Run duty cycles, with a turn of the event loop between them, until the condition holds; fail at the cap. */
    public async until(condition: () => boolean, what: string, maxCycles = MAX_CYCLES): Promise<void> {
        for (let i = 0; i < maxCycles; i++) {
            if (condition()) {
                return;
            }
            this.cycle();
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        throw new Error('no ' + what + ' after ' + maxCycles + ' duty cycles; errors: ' + this.errors.map(String));
    }

    public close(): void {
        this.aeron.close();
        this.driver.close();
    }
}
