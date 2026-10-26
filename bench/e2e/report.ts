// `npm run bench:e2e [-- --runs n] [--rtt n] [--windows n] [--idle n] [--json]`: the end-to-end report of T24 (spec 5.3,
// D110). TS to TS on the loopback, two drivers and two clients in this process (bench/lib/e2e.ts), and the raw `dgram`
// floor with the same sizes beside it, in markdown on stdout (the CI job appends it to $GITHUB_STEP_SUMMARY) and one JSON
// object with `--json`. It never gates anything: `bench:gate` judges the same figures against a base (bench/micro/e2e.bench.ts).
//
//   latency          ping/pong round trips of 32, 512 and 1376 byte messages (the one-way latency is about half);
//                    --runs runs (default 5), interleaved: each run does every size, Aeron then `dgram`, in turn
//   throughput       one-way streams of 64 and 1376 byte messages, --runs runs (default 3), msgs/s and MB/s
//   allocation       bytes per message by where they were allocated, minor collections per 1000 messages
//   after idle       the first message after the runners have been idle, with and without `MediaDriver.wake()` (D101)
import { availableParallelism, cpus, loadavg } from 'node:os';
import {
    DgramPair,
    Loopback,
    firstMessageAfterIdle,
    measureAllocation,
    medianOfRuns,
    oneWay,
    roundTrips,
    summarize,
    sleep,
    turn,
    type Allocation,
} from '../lib/e2e.js';

declare const gc: (() => void) | undefined;

interface Options {
    runs: number;
    streamRuns: number;
    rtt: number;
    windows: number;
    idle: number;
    json: boolean;
}

const RTT_SIZES = [32, 512, 1376];
const STREAM_SIZES = [64, 1376];
const WINDOW = 100;
const WARM_UP_ROUND_TRIPS = 3_000;
const IDLE_MS = 150;

function parseArgs(argv: string[]): Options {
    const o: Options = { runs: 5, streamRuns: 3, rtt: 3000, windows: 500, idle: 30, json: false };
    for (let i = 0; i < argv.length; i++) {
        const number = (): number => {
            const v = Number(argv[++i]);
            if (!Number.isInteger(v) || v < 1) {
                throw new Error(argv[i - 1] + ' needs a positive integer');
            }
            return v;
        };
        switch (argv[i]) {
            case '--runs':
                o.runs = number();
                break;
            case '--stream-runs':
                o.streamRuns = number();
                break;
            case '--rtt':
                o.rtt = number();
                break;
            case '--windows':
                o.windows = number();
                break;
            case '--idle':
                o.idle = number();
                break;
            case '--json':
                o.json = true;
                break;
            default:
                throw new Error('unknown argument: ' + argv[i]);
        }
    }
    return o;
}

async function settle(): Promise<void> {
    if ('function' === typeof gc) {
        gc();
    }
    await turn();
}

type Summary = ReturnType<typeof summarize>;

function us(ns: number): string {
    return (ns / 1000).toFixed(1);
}

function table(header: string[], rows: string[][], left = 1): string {
    return [
        '| ' + header.join(' | ') + ' |',
        '| ' + header.map((_, i) => (i < left ? '---' : '---:')).join(' | ') + ' |',
        ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
    ].join('\n');
}

async function main(): Promise<void> {
    const o = parseArgs(process.argv.slice(2));
    const log = (text: string): void => void process.stderr.write(text + '\n');
    const result: Record<string, unknown> = {};

    // ---- latency: Aeron (wake after each offer), Aeron (no wake) and the dgram floor, interleaved per run and size
    log('latency: ' + o.runs + ' runs of ' + o.rtt + ' round trips per size');
    const lb = await Loopback.create(true);
    const floor = await DgramPair.create();
    const runs = new Map<string, Summary[]>();
    const add = (key: string, s: Summary): void => void runs.set(key, [...(runs.get(key) ?? []), s]);
    for (const size of RTT_SIZES) {
        lb.wake = true;
        await roundTrips(lb, size, new Float64Array(WARM_UP_ROUND_TRIPS));
        await floor.roundTrips(size, new Float64Array(WARM_UP_ROUND_TRIPS));
    }
    for (let run = 0; run < o.runs; run++) {
        for (const size of RTT_SIZES) {
            const out = new Float64Array(o.rtt);
            // the order within the run alternates, so that neither always goes first
            const order = 0 === run % 2 ? ['wake', 'nowake', 'dgram'] : ['dgram', 'nowake', 'wake'];
            for (const what of order) {
                await settle();
                if ('dgram' === what) {
                    await floor.roundTrips(size, out);
                } else {
                    lb.wake = 'wake' === what;
                    await roundTrips(lb, size, out);
                }
                add(what + ':' + size, summarize(out));
            }
        }
    }
    if (lb.errors().length > 0) {
        throw new Error('the nodes reported errors: ' + lb.errors().map(String).join('; '));
    }
    lb.close();
    floor.close();

    const rows: string[][] = [];
    const latency: Record<string, unknown> = {};
    for (const size of RTT_SIZES) {
        for (const [what, label] of [
            ['wake', 'Aeron TS, wake after each offer'],
            ['nowake', 'Aeron TS, no wake (default)'],
            ['dgram', 'raw dgram floor'],
        ] as const) {
            const all = runs.get(what + ':' + size) as Summary[];
            const m = medianOfRuns(all);
            latency[what + ':' + size] = { ...m, runs: all.length };
            rows.push([String(size), label, us(m.p50), us(m.p99), us(m.p999), String(all.length)]);
        }
    }
    result['latency'] = latency;

    // ---- throughput
    log('throughput: ' + o.streamRuns + ' runs of ' + o.windows * WINDOW + ' messages per size');
    const tputRows: string[][] = [];
    const throughput: Record<string, unknown> = {};
    const lbs = await Loopback.create(false);
    const floors = await DgramPair.create();
    for (const size of STREAM_SIZES) {
        await oneWay(lbs, size, WINDOW, new Float64Array(500));
        await floors.oneWay(size, WINDOW, new Float64Array(500));
    }
    const rates = new Map<string, { msgs: number[]; mb: number[] }>();
    for (let run = 0; run < o.streamRuns; run++) {
        for (const size of STREAM_SIZES) {
            const order = 0 === run % 2 ? ['aeron', 'dgram'] : ['dgram', 'aeron'];
            for (const what of order) {
                await settle();
                const out = new Float64Array(o.windows);
                const t0 = performance.now();
                const moved =
                    'aeron' === what ? await oneWay(lbs, size, WINDOW, out) : await floors.oneWay(size, WINDOW, out);
                const seconds = (performance.now() - t0) / 1e3;
                const key = what + ':' + size;
                const r = rates.get(key) ?? { msgs: [], mb: [] };
                r.msgs.push(moved.messages / seconds);
                r.mb.push(moved.bytes / seconds / 1e6);
                rates.set(key, r);
            }
        }
    }
    if (lbs.errors().length > 0) {
        throw new Error('the nodes reported errors: ' + lbs.errors().map(String).join('; '));
    }
    const med = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] as number;
    for (const size of STREAM_SIZES) {
        for (const [what, label] of [
            ['aeron', 'Aeron TS'],
            ['dgram', 'raw dgram floor (credit of 64 datagrams)'],
        ] as const) {
            const r = rates.get(what + ':' + size) as { msgs: number[]; mb: number[] };
            throughput[what + ':' + size] = { msgsPerSec: med(r.msgs), mbPerSec: med(r.mb), runs: r.msgs.length };
            tputRows.push([
                String(size),
                label,
                Math.round(med(r.msgs)).toLocaleString('en-US'),
                med(r.mb).toFixed(1),
                String(r.msgs.length),
            ]);
        }
    }
    result['throughput'] = throughput;

    // ---- allocation (the 64 byte stream, then the 32 byte round trips)
    log('allocation');
    const allocRows: string[][] = [];
    const allocations: Record<string, Allocation> = {};
    const measured: [string, () => Promise<number>][] = [
        [
            'stream 64 B',
            async () => {
                const out = new Float64Array(o.windows);
                return (await oneWay(lbs, 64, WINDOW, out)).messages;
            },
        ],
        [
            'stream 1376 B',
            async () => {
                const out = new Float64Array(o.windows / 5);
                return (await oneWay(lbs, 1376, WINDOW, out)).messages;
            },
        ],
    ];
    for (const [label, run] of measured) {
        await settle();
        const a = await measureAllocation(run);
        allocations[label] = a;
        allocRows.push([
            label,
            a.portBytesPerMessage.toFixed(1),
            a.nodeBytesPerMessage.toFixed(1),
            a.harnessBytesPerMessage.toFixed(1),
            a.otherBytesPerMessage.toFixed(1),
            a.scavengesPer1000.toFixed(2),
        ]);
    }
    lbs.close();
    floors.close();
    const rtt = await Loopback.create(true);
    await roundTrips(rtt, 32, new Float64Array(WARM_UP_ROUND_TRIPS));
    await settle();
    const a = await measureAllocation(async () => {
        const out = new Float64Array(o.rtt);
        await roundTrips(rtt, 32, out);
        return o.rtt * 2;
    });
    rtt.close();
    allocations['round trip 32 B (2 messages)'] = a;
    allocRows.push([
        'round trip 32 B (per message, 2 per trip)',
        a.portBytesPerMessage.toFixed(1),
        a.nodeBytesPerMessage.toFixed(1),
        a.harnessBytesPerMessage.toFixed(1),
        a.otherBytesPerMessage.toFixed(1),
        a.scavengesPer1000.toFixed(2),
    ]);
    result['allocation'] = allocations;

    // ---- the first message after the runners have been idle
    log('first message after idle: ' + o.idle + ' messages each, ' + IDLE_MS + ' ms idle before each');
    const idleLb = await Loopback.create(false);
    await oneWay(idleLb, 32, WINDOW, new Float64Array(100));
    const idleFloor = await DgramPair.create();
    const withWake: Float64Array[] = [];
    const withoutWake: Float64Array[] = [];
    const floorIdle: Float64Array[] = [];
    // interleaved in blocks of 10 so that a slow minute of the host lands in all three
    for (let block = 0; block < o.idle / 10; block++) {
        withoutWake.push(await firstMessageAfterIdle(idleLb, 10, IDLE_MS, false));
        withWake.push(await firstMessageAfterIdle(idleLb, 10, IDLE_MS, true));
        const f = new Float64Array(10);
        for (let i = 0; i < 10; i++) {
            await sleep(IDLE_MS);
            f[i] = await idleFloor.firstMessage(32);
        }
        floorIdle.push(f);
    }
    if (idleLb.errors().length > 0) {
        throw new Error('the nodes reported errors: ' + idleLb.errors().map(String).join('; '));
    }
    idleLb.close();
    idleFloor.close();
    const joined = (parts: Float64Array[]): Float64Array => Float64Array.from(parts.flatMap((p) => [...p]));
    const idle: Record<string, Summary & { max: number }> = {};
    const idleRows: string[][] = [];
    for (const [key, label, parts] of [
        ['nowake', 'Aeron TS, offer only (default)', withoutWake],
        ['wake', 'Aeron TS, offer then MediaDriver.wake()', withWake],
        ['dgram', 'raw dgram floor, send to read', floorIdle],
    ] as const) {
        const samples = joined(parts);
        const s = { ...summarize(samples), max: Math.max(...samples) };
        idle[key] = s;
        idleRows.push([label, us(s.p50), us(s.p99), us(s.max), String(samples.length)]);
    }
    result['firstMessageAfterIdle'] = idle;

    const host =
        (cpus()[0]?.model ?? 'unknown cpu') +
        ', ' +
        availableParallelism() +
        ' cores, load average at the end ' +
        loadavg()
            .map((l) => l.toFixed(2))
            .join(' ');
    const text = [
        '### End-to-end benches: TS to TS on the loopback',
        '',
        'Node ' +
            process.version +
            ', ' +
            host +
            '. Two drivers and two clients in one process, default configuration.',
        '',
        '**Round trip latency** (µs; one way is about half). Medians over the runs of the p50, p99 and p99.9 of ' +
            o.rtt +
            ' round trips each.',
        '',
        table(['bytes', 'path', 'p50', 'p99', 'p99.9', 'runs'], rows, 2),
        '',
        '**Throughput**, one way, median over the runs. Aeron packs small messages into one datagram, so a message is not a datagram; the floor is datagrams per second.',
        '',
        table(['bytes', 'path', 'msgs/s', 'MB/s', 'runs'], tputRows, 2),
        '',
        '**Allocation**, bytes per message by where they were allocated (sampling heap profiler, estimates), and minor collections per 1000 messages. `port` is `src/`, `node` the dgram buffers and timers, `harness` the promise and `setImmediate` of each turn of the bench.',
        '',
        table(['run', 'port B/msg', 'node B/msg', 'harness B/msg', 'other B/msg', 'scavenges/1000'], allocRows),
        '',
        'Top allocation sites in `src/` (64 B stream): ' +
            (allocations['stream 64 B']?.portSites ?? [])
                .map((s) => s.site + ' ' + s.bytesPerMessage.toFixed(1))
                .join('; '),
        '',
        '**First message after the runners went idle** (' +
            IDLE_MS +
            ' ms of nothing before each; µs from `offer` to the read; D101).',
        '',
        table(['path', 'p50', 'p99', 'max', 'n'], idleRows),
        '',
    ].join('\n');
    process.stdout.write(o.json ? JSON.stringify(result) + '\n' : text);
}

main().catch((e: unknown) => {
    process.stderr.write(String(e instanceof Error ? (e.stack ?? e.message) : e) + '\n');
    process.exit(1);
});
