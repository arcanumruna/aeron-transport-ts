// The fan-out end-to-end benches of phase 3 T14 (D121), in the gate with the other end-to-end benches (e2e.bench.ts):
// multicast with 1 and 3 subscriptions, MDC dynamic and manual with 2 and 4 destinations, MDS with 2 destinations, each as
// a latency bench (one 32 B message offered at a time, a sample is the ns until the last subscriber has read it; 5 pairs)
// and a throughput bench (a 64 B stream, a sample is the ns per message of a window of 100 read by the slowest
// subscriber; 3 pairs). The drivers and clients are those of bench/lib/fanout.ts. The unicast reference of the report is
// the `Unicast` benches of e2e.bench.ts.
//
// The next import is a guard: a base without phase 3 has no multicast flow control, so this file fails to import there
// and the gate reports "n/a in base" instead of a NO_VERDICT for benches that the base cannot run.
import '../../src/driver/MinMulticastFlowControl.js';
import { summarize } from '../lib/e2e.js';
import { FANOUT_SCENARIOS, Fanout, fanoutLatency, fanoutStream, type FanoutScenario } from '../lib/fanout.js';
import type { RunBench, RunSamples } from '../lib/types.js';

const WARM_UP_MESSAGES = 3_000;
const WINDOW = 100;

function check(f: Fanout): void {
    const errors = f.errors();
    if (errors.length > 0) {
        throw new Error('the nodes reported ' + errors.length + ' errors, the first: ' + String(errors[0]));
    }
}

function latencyBench(scenario: FanoutScenario): RunBench {
    let f: Fanout | undefined;
    return {
        name: 'Fan-out latency 32 B, ' + scenario.name + ' (offer to the read by the last subscriber)',
        throughput: false,
        setup: async () => {
            f = await Fanout.create(scenario);
            await fanoutLatency(f, 32, new Float64Array(WARM_UP_MESSAGES));
        },
        run: async ({ samples }): Promise<RunSamples> => {
            const out = new Float64Array(samples);
            await fanoutLatency(f as Fanout, 32, out);
            check(f as Fanout);
            return { samplesNsPerOp: Array.from(out), totalOps: samples, elapsedMs: sum(out) / 1e6 };
        },
        teardown: () => f?.close(),
    };
}

function throughputBench(scenario: FanoutScenario): RunBench {
    let f: Fanout | undefined;
    return {
        name: 'Fan-out stream 64 B, ' + scenario.name + ' (ns per message, paced by the slowest subscriber)',
        setup: async () => {
            f = await Fanout.create(scenario);
            await fanoutStream(f, 64, WINDOW, new Float64Array(50_000 / WINDOW));
        },
        run: async ({ samples }): Promise<RunSamples> => {
            const out = new Float64Array(samples);
            const moved = await fanoutStream(f as Fanout, 64, WINDOW, out);
            check(f as Fanout);
            return { samplesNsPerOp: Array.from(out), totalOps: moved.messages, elapsedMs: (sum(out) * WINDOW) / 1e6 };
        },
        teardown: () => f?.close(),
    };
}

function sum(values: Float64Array): number {
    return summarize(values).mean * values.length;
}

const scenarios = FANOUT_SCENARIOS.filter((s) => 'unicast' !== s.kind);

export const benches: RunBench[] = [...scenarios.map(latencyBench), ...scenarios.map(throughputBench)];
