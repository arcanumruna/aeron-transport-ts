// The end-to-end benches of T24 (spec 5.3, D110), in the gate with the micro benches: two `MediaDriver`s and two `Aeron`
// clients of one process on the real loopback (bench/lib/e2e.ts), default configuration, the application waking the
// runner after an offer (D101). The latency benches time one round trip each (offer, the echo of the other node, the
// read), a sample is one round trip; the throughput benches stream messages one way and a sample is the ns per message
// of a window of 100 messages read, while the stream keeps going. They need a quiet host as the micro benches do, and
// more: the kernel and the event loop are in the path.
import { Loopback, MAX_UNFRAGMENTED, oneWay, roundTrips } from '../lib/e2e.js';
import type { RunBench, RunSamples } from '../lib/types.js';

const WARM_UP_ROUND_TRIPS = 3_000;
const WARM_UP_MESSAGES = 50_000;
const WINDOW = 100;

function check(lb: Loopback): void {
    const errors = lb.errors();
    if (errors.length > 0) {
        throw new Error('the nodes reported ' + errors.length + ' errors, the first: ' + String(errors[0]));
    }
}

function latencyBench(name: string, size: number): RunBench {
    let lb: Loopback | undefined;
    return {
        name,
        throughput: false,
        setup: async () => {
            lb = await Loopback.create(true);
            await roundTrips(lb, size, new Float64Array(WARM_UP_ROUND_TRIPS));
        },
        run: async ({ samples }): Promise<RunSamples> => {
            const out = new Float64Array(samples);
            await roundTrips(lb as Loopback, size, out);
            check(lb as Loopback);
            let sum = 0;
            for (const ns of out) {
                sum += ns;
            }
            return { samplesNsPerOp: Array.from(out), totalOps: samples, elapsedMs: sum / 1e6 };
        },
        teardown: () => lb?.close(),
    };
}

function throughputBench(name: string, size: number): RunBench {
    let lb: Loopback | undefined;
    return {
        name,
        setup: async () => {
            lb = await Loopback.create(false);
            await oneWay(lb, size, WINDOW, new Float64Array(WARM_UP_MESSAGES / WINDOW));
        },
        run: async ({ samples }): Promise<RunSamples> => {
            const out = new Float64Array(samples);
            const moved = await oneWay(lb as Loopback, size, WINDOW, out);
            check(lb as Loopback);
            let sum = 0;
            for (const ns of out) {
                sum += ns * WINDOW;
            }
            return { samplesNsPerOp: Array.from(out), totalOps: moved.messages, elapsedMs: sum / 1e6 };
        },
        teardown: () => lb?.close(),
    };
}

export const benches: RunBench[] = [
    latencyBench('Unicast round trip 32 B (TS to TS on the loopback: offer, echo, read)', 32),
    latencyBench(
        'Unicast round trip ' + MAX_UNFRAGMENTED + ' B (TS to TS on the loopback: offer, echo, read)',
        MAX_UNFRAGMENTED,
    ),
    throughputBench('Unicast stream 64 B (TS to TS on the loopback, ns per message)', 64),
    throughputBench(
        'Unicast stream ' + MAX_UNFRAGMENTED + ' B (TS to TS on the loopback, ns per message)',
        MAX_UNFRAGMENTED,
    ),
];
