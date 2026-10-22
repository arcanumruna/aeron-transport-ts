#!/usr/bin/env node
// Captures golden wire frames from the real Aeron 1.53.3 C driver into test/golden/frames.json (plan T13).
//
// Topology, per scenario (nothing is hand-written: every byte comes from a C `aeronmd`):
//
//   publisher client -> pub driver --UDP--> [relay front] [relay back] --UDP--> sub driver -> subscriber client
//                                  <--UDP--                           <--UDP--
//
// The relay is a loopback UDP forwarder. It records every datagram in both directions, decodes it with an
// independent decoder (plain DataView reads by offset, written from aeron_udp_protocol.h and the Aeron transport
// protocol specification, NOT from the TypeScript flyweights, so the golden test is not circular), and can drop
// one chosen DATA frame to provoke a NAK and a retransmission.
//
// Usage:
//   node scripts/capture-golden.mjs [--out <file>] [--build <dir>] [--work <dir>] [--base-port <port>] [--only <name>]
// Environment (the flags win):
//   AERON_C_BUILD     CMake build directory of Aeron 1.53.3 containing binaries/{aeronmd,basic_publisher,
//                     basic_subscriber,streaming_publisher}. Required; see the README ("Golden wire vectors").
//   GOLDEN_WORK_DIR   scratch directory for aeron dirs and process logs (default: <os tmpdir>/aeron-golden-work)
//   GOLDEN_OUT        output file (default: test/golden/frames.json next to this script's repository root)
//   GOLDEN_BASE_PORT  first UDP port on 127.0.0.1 used by the relay and the drivers (default 41100)
//
// Deterministic inputs: the session id, initial term id, term length and MTU are pinned in the channel URIs, the
// message sizes and counts are fixed, and the dropped frame is chosen by ordinal. Not deterministic (set by the
// driver at run time): receiver ids, RTT timestamps, and which heartbeats / status messages fall between data.
// `config` in the output records every parameter, so a capture can be repeated and diffed.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, mkdirSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------------------------
// Independent decoder. Offsets are from aeron_udp_protocol.h (little-endian, `#pragma pack(4)`).
// ---------------------------------------------------------------------------------------------------------------
const FRAME_ALIGNMENT = 32;
const TYPE_NAMES = new Map([
    [0x00, 'PAD'],
    [0x01, 'DATA'],
    [0x02, 'NAK'],
    [0x03, 'SM'],
    [0x04, 'ERR'],
    [0x05, 'SETUP'],
    [0x06, 'RTTM'],
    [0x07, 'RES'],
    [0x0b, 'RSP_SETUP'],
]);

// Flag bits, copied from aeron_udp_protocol.h (AERON_DATA_HEADER_*_FLAG, AERON_STATUS_MESSAGE_HEADER_*_FLAG,
// AERON_SETUP_HEADER_*_FLAG, AERON_RTTM_HEADER_REPLY_FLAG). Not shared with the TypeScript sources on purpose: the
// golden test compares the TypeScript constants and decoding against these names.
const FLAG_NAMES = new Map([
    [
        0x00,
        [
            [0x80, 'BEGIN'],
            [0x40, 'END'],
            [0x20, 'EOS'],
            [0x10, 'REVOKED'],
        ],
    ], // PAD
    [
        0x01,
        [
            [0x80, 'BEGIN'],
            [0x40, 'END'],
            [0x20, 'EOS'],
            [0x10, 'REVOKED'],
        ],
    ], // DATA
    [
        0x03,
        [
            [0x80, 'SEND_SETUP'],
            [0x40, 'EOS'],
        ],
    ], // SM
    [
        0x05,
        [
            [0x80, 'SEND_RESPONSE'],
            [0x40, 'GROUP'],
        ],
    ], // SETUP
    [0x06, [[0x80, 'REPLY']]], // RTTM
]);

/** Names of the flag bits set in `flags` for a frame of `type` (bits the C header does not define are `0x..`). */
function flagNames(type, flags) {
    const defined = FLAG_NAMES.get(type) ?? [];
    const names = defined.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
    const known = defined.reduce((acc, [bit]) => acc | bit, 0);
    const unknown = flags & ~known;
    if (unknown !== 0) names.push(`0x${unknown.toString(16)}`);
    return names;
}

const align = (value, alignment) => (value + alignment - 1) & ~(alignment - 1);
const hex = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');

/**
 * Decodes the frame that starts at `offset` of the datagram with plain DataView reads.
 * @returns a record of the header fields plus type specific fields; 64 bit values are decimal strings.
 */
export function decodeFrame(bytes, offset) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const i32 = (o) => dv.getInt32(offset + o, true);
    const i64 = (o) => dv.getBigInt64(offset + o, true).toString();
    const avail = bytes.byteLength - offset;

    const frame = {
        offset,
        frameLength: i32(0),
        version: dv.getUint8(offset + 4),
        flags: dv.getUint8(offset + 5),
        type: dv.getUint16(offset + 6, true),
    };
    frame.typeName = TYPE_NAMES.get(frame.type) ?? 'UNKNOWN';
    frame.flagNames = flagNames(frame.type, frame.flags);
    // Bytes of this frame present in the datagram. A PAD frame is sent as a bare header although its frame length
    // covers the whole padded region, so this can be shorter than frameLength.
    const present = Math.min(avail, frame.frameLength);
    const f = {};
    let fixed;
    switch (frame.type) {
        case 0x00: // PAD
        case 0x01: // DATA
            fixed = 32;
            f.termOffset = i32(8);
            f.sessionId = i32(12);
            f.streamId = i32(16);
            f.termId = i32(20);
            f.reservedValue = i64(24);
            break;
        case 0x02: // NAK
            fixed = 28;
            f.sessionId = i32(8);
            f.streamId = i32(12);
            f.termId = i32(16);
            f.termOffset = i32(20);
            f.length = i32(24);
            break;
        case 0x03: // SM
            fixed = 36;
            f.sessionId = i32(8);
            f.streamId = i32(12);
            f.consumptionTermId = i32(16);
            f.consumptionTermOffset = i32(20);
            f.receiverWindowLength = i32(24);
            f.receiverId = i64(28);
            break;
        case 0x05: // SETUP
            fixed = 40;
            f.termOffset = i32(8);
            f.sessionId = i32(12);
            f.streamId = i32(16);
            f.initialTermId = i32(20);
            f.activeTermId = i32(24);
            f.termLength = i32(28);
            f.mtuLength = i32(32);
            f.ttl = i32(36);
            break;
        case 0x06: // RTTM
            fixed = 40;
            f.sessionId = i32(8);
            f.streamId = i32(12);
            f.echoTimestampNs = i64(16);
            f.receptionDelta = i64(24);
            f.receiverId = i64(32);
            break;
        default:
            throw new Error(`capture: unexpected frame type 0x${frame.type.toString(16)} at offset ${offset}`);
    }
    frame.fields = f;
    // The DATA payload, or the SM application specific feedback, is everything from `fixed` to `presentLength`; the
    // test slices it out of the datagram hex.
    frame.fixedLength = fixed;
    frame.presentLength = present;
    frame.trailingLength = Math.max(fixed, present) - fixed;
    return frame;
}

/** Walks every frame of a datagram with FRAME_ALIGNMENT stepping. */
export function decodeDatagram(bytes) {
    const frames = [];
    let offset = 0;
    while (offset < bytes.byteLength) {
        const frame = decodeFrame(bytes, offset);
        frames.push(frame);
        if (frame.frameLength === 0) {
            // A heartbeat is a bare DATA header whose frame length field is 0 (see DataHeaderFlyweight.isHeartbeat).
            if (frame.type !== 0x01 || bytes.byteLength !== 32)
                throw new Error('capture: unexpected zero length frame');
            break;
        }
        if (frame.frameLength < 0) throw new Error(`capture: negative frame length at offset ${offset}`);
        offset += align(frame.frameLength, FRAME_ALIGNMENT);
    }
    return frames;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i];
        if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`bad argument ${key}`);
        args[key.slice(2)] = argv[i + 1];
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const buildDir = args.build ?? process.env.AERON_C_BUILD;
const workDir = resolve(args.work ?? process.env.GOLDEN_WORK_DIR ?? join(tmpdir(), 'aeron-golden-work'));
const outFile = resolve(args.out ?? process.env.GOLDEN_OUT ?? join(REPO_ROOT, 'test/golden/frames.json'));
const basePort = Number(args['base-port'] ?? process.env.GOLDEN_BASE_PORT ?? 41100);
const only = args.only;

if (!buildDir) {
    console.error('capture-golden: set AERON_C_BUILD (or --build) to the Aeron 1.53.3 C build directory');
    process.exit(2);
}
const bin = (name) => join(resolve(buildDir), 'binaries', name);
for (const name of ['aeronmd', 'basic_publisher', 'basic_subscriber', 'streaming_publisher']) {
    if (!existsSync(bin(name))) {
        console.error(`capture-golden: ${bin(name)} not found (build: see README "Golden wire vectors")`);
        process.exit(2);
    }
}

// Pinned values chosen so that a swapped field, a signedness mistake or a truncation shows up: the session id is
// 0x87654321 as an int (negative), the stream id is 0x12345678, and the publication starts one term after the
// initial term (activeTermId != initialTermId in SETUP).
const SESSION_ID = -2023406815;
const STREAM_ID = 0x12345678;
const INITIAL_TERM_ID = -1234;
const TERM_LENGTH = 65536;
const MTU = 1408;
/** Datagrams kept per frame class and scenario (the relay still forwards and counts all of them). */
const MAX_PER_CLASS = 12;
/** Runs of a scenario before giving up on its expectations. */
const MAX_ATTEMPTS = 3;

/**
 * Scenarios. `drop` selects one pub->sub DATA frame with a payload by ordinal (1-based) for the relay to drop.
 * `subscribers` lists the subscriber client lifetimes, as [startMs, stopMs|null] from scenario start, to elicit a
 * SETUP via a status message.
 */
const SCENARIOS = [
    {
        name: 'basic',
        description: 'SETUP, SM, small DATA, heartbeats, EOS, RTTM request and reply (cubic congestion control)',
        publisher: ['basic_publisher', '-m', '4', '-l', '2s'],
        expect: [
            'pub->sub:SETUP',
            'sub->pub:SM:0x0:',
            'pub->sub:DATA:0xc0:payload',
            'pub->sub:DATA:0xc0:heartbeat',
            'pub->sub:DATA:0xe0:heartbeat',
            'sub->pub:RTTM:0x80:',
            'pub->sub:RTTM:0x0:',
        ],
        subscriberChannelExtra: '|cc=cubic',
        subDriverEnv: { AERON_CUBICCONGESTIONCONTROL_MEASURERTT: 'true' },
        subscribers: [[0, null]],
        publisherStartMs: 500,
        runMs: 9000,
    },
    {
        name: 'fragmented',
        description: 'BEGIN / middle / END fragments of a 3-MTU message',
        publisher: ['streaming_publisher', '-L', '3500', '-m', '3', '-l', '2s'],
        expect: ['pub->sub:DATA:0x80:payload', 'pub->sub:DATA:0x0:payload', 'pub->sub:DATA:0x40:payload'],
        subscribers: [[0, null]],
        publisherStartMs: 500,
        runMs: 5000,
    },
    {
        name: 'pad',
        description: 'PAD at term end (64 KiB term, 1000 byte messages leave a 64 byte tail)',
        publisher: ['streaming_publisher', '-L', '1000', '-m', '100', '-l', '2s'],
        expect: ['pub->sub:PAD:'],
        subscribers: [[0, null]],
        publisherStartMs: 500,
        runMs: 6000,
    },
    {
        name: 'loss',
        description: 'relay drops the 3rd data frame: NAK, then the retransmitted DATA',
        publisher: ['basic_publisher', '-m', '8', '-l', '2s'],
        subscribers: [[0, null]],
        drop: 3,
        expect: ['sub->pub:NAK:', 'retransmit'],
        publisherStartMs: 500,
        runMs: 12000,
    },
    {
        name: 'setup-elicit',
        description: 'subscriber restarted while the publication stays connected: SM with SEND_SETUP flag',
        publisher: ['basic_publisher', '-m', '30', '-l', '1s'],
        expect: ['sub->pub:SM:0x80:'],
        subscribers: [
            [0, 3000],
            [4500, null],
        ],
        publisherStartMs: 500,
        runMs: 12000,
    },
];

// ---------------------------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = new Set();
/** Driver directories of the running scenario, removed on a signal as well as at the end of a scenario. */
const driverDirs = new Set();

function start(name, cmd, cmdArgs, env, logFile) {
    const fd = openSync(logFile, 'w');
    const child = spawn(cmd, cmdArgs, { env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    child.once('error', (err) => {
        console.error(`capture-golden: cannot start ${name} (${cmd}): ${err.message}`);
        killAll();
        removeDriverDirs();
        process.exit(1);
    });
    const exited = new Promise((r) => child.once('exit', r));
    children.add(child);
    exited.then(() => children.delete(child));
    return { name, child, exited };
}

async function stop(proc, timeoutMs = 4000) {
    if (proc.child.exitCode !== null || proc.child.signalCode !== null) return;
    proc.child.kill('SIGINT');
    const t = await Promise.race([proc.exited.then(() => 'ok'), sleep(timeoutMs).then(() => 'timeout')]);
    if (t === 'timeout') {
        proc.child.kill('SIGKILL');
        await proc.exited;
    }
}

function killAll() {
    for (const c of children) c.kill('SIGKILL');
}
function removeDriverDirs() {
    for (const d of driverDirs) rmSync(d, { recursive: true, force: true });
    driverDirs.clear();
}
process.on('exit', killAll);
// Exit status 128 + signal number, as a shell reports a process killed by that signal.
for (const [sig, code] of [
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
]) {
    process.on(sig, () => {
        killAll();
        removeDriverDirs();
        process.exit(code);
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------------------------------------------
function bindSocket(port) {
    return new Promise((res, rej) => {
        // Large buffers so a burst of datagrams is not dropped by the relay itself (the kernel caps the size).
        const s = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 << 20, sendBufferSize: 8 << 20 });
        s.once('error', rej);
        s.bind(port, '127.0.0.1', () => res(s));
    });
}

async function startRelay(scenario, frontPort, backPort, subPort) {
    const front = await bindSocket(frontPort); // the publisher driver sends here
    const back = await bindSocket(backPort); // the subscriber driver sees this as the sender
    const records = [];
    const classCounts = new Map(); // class key -> datagrams seen, kept or not
    let total = 0;
    let senderAddr = null;
    let dataSeen = 0;
    let droppedRecord = null;
    const t0 = process.hrtime.bigint();

    // Frame class of a datagram, used to bound the file size: continuous RTTM exchanges and thousands of identical
    // heartbeats / status messages add nothing after the first few.
    const classOf = (direction, f) => {
        const shape = f.frameLength === 0 ? 'heartbeat' : f.trailingLength > 0 ? 'payload' : 'bare';
        return `${direction}:${f.typeName}:0x${f.flags.toString(16)}:${shape}`;
    };
    // Rare, structurally important frames are always kept.
    const ALWAYS_KEPT = new Set(['PAD', 'NAK', 'SETUP']);

    const record = (direction, msg) => {
        const bytes = new Uint8Array(msg);
        const frames = decodeDatagram(bytes);
        const rec = { scenario: scenario.name, seq: total++, direction, hex: hex(bytes), frames };
        let keep = false;
        for (const f of frames) {
            const key = classOf(direction, f);
            classCounts.set(key, (classCounts.get(key) ?? 0) + 1);
            keep ||= ALWAYS_KEPT.has(f.typeName) || classCounts.get(key) <= MAX_PER_CLASS;
        }
        rec.keep = keep;
        return rec;
    };
    const commit = (rec) => {
        const keep = rec.keep || rec.dropped || rec.retransmitOf !== undefined;
        delete rec.keep;
        if (keep) records.push(rec);
    };

    front.on('message', (msg, rinfo) => {
        senderAddr = rinfo;
        const rec = record('pub->sub', msg);
        const first = rec.frames[0];
        let drop = false;
        if (first.type === 0x01 && first.frameLength > 32) {
            dataSeen++;
            if (droppedRecord === null && scenario.drop === dataSeen) {
                drop = true;
                droppedRecord = rec;
                rec.dropped = true;
            }
        }
        if (
            droppedRecord !== null &&
            rec !== droppedRecord &&
            first.type === 0x01 &&
            first.fields.termId === droppedRecord.frames[0].fields.termId &&
            first.fields.termOffset === droppedRecord.frames[0].fields.termOffset
        ) {
            rec.retransmitOf = droppedRecord.seq;
        }
        commit(rec);
        if (!drop) back.send(msg, subPort, '127.0.0.1');
    });
    back.on('message', (msg) => {
        commit(record('sub->pub', msg));
        if (senderAddr) front.send(msg, senderAddr.port, senderAddr.address);
    });

    return {
        records,
        classCounts,
        elapsedMs: () => Number((process.hrtime.bigint() - t0) / 1000000n),
        close: () => {
            front.close();
            back.close();
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// One scenario
// ---------------------------------------------------------------------------------------------------------------
async function runScenario(scenario, index) {
    const ports = { front: basePort + index * 10, back: basePort + index * 10 + 1, sub: basePort + index * 10 + 2 };
    const dir = join(workDir, scenario.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const pubDir = join(dir, 'pub-aeron');
    const subDir = join(dir, 'sub-aeron');
    driverDirs.add(pubDir).add(subDir);

    const pubChannel =
        `aeron:udp?endpoint=127.0.0.1:${ports.front}|term-length=${TERM_LENGTH}|mtu=${MTU}` +
        `|session-id=${SESSION_ID}|init-term-id=${INITIAL_TERM_ID}|term-id=${INITIAL_TERM_ID + 1}|term-offset=0`;
    const subChannel = `aeron:udp?endpoint=127.0.0.1:${ports.sub}${scenario.subscriberChannelExtra ?? ''}`;

    const driverEnv = {
        AERON_DIR_DELETE_ON_START: 'true',
        AERON_THREADING_MODE: 'SHARED',
        AERON_PRINT_CONFIGURATION: 'false',
    };
    const relay = await startRelay(scenario, ports.front, ports.back, ports.sub);
    const procs = [];
    try {
        procs.push(
            start('pub-driver', bin('aeronmd'), [], { ...driverEnv, AERON_DIR: pubDir }, join(dir, 'pub-driver.log')),
        );
        procs.push(
            start(
                'sub-driver',
                bin('aeronmd'),
                [],
                { ...driverEnv, ...scenario.subDriverEnv, AERON_DIR: subDir },
                join(dir, 'sub-driver.log'),
            ),
        );
        await sleep(1000);

        const events = [];
        for (const [i, [startMs, stopMs]] of scenario.subscribers.entries()) {
            events.push({
                at: startMs,
                run: async () => {
                    const p = start(
                        `subscriber-${i}`,
                        bin('basic_subscriber'),
                        ['-p', subDir, '-c', subChannel, '-s', String(STREAM_ID)],
                        {},
                        join(dir, `subscriber-${i}.log`),
                    );
                    procs.push(p);
                    if (stopMs !== null) {
                        await sleep(stopMs - startMs);
                        await stop(p);
                    }
                },
            });
        }
        const [exe, ...exeArgs] = scenario.publisher;
        events.push({
            at: scenario.publisherStartMs,
            run: async () => {
                procs.push(
                    start(
                        'publisher',
                        bin(exe),
                        ['-p', pubDir, '-c', pubChannel, '-s', String(STREAM_ID), ...exeArgs],
                        {},
                        join(dir, 'publisher.log'),
                    ),
                );
            },
        });
        const running = events.map(async (e) => {
            await sleep(e.at);
            await e.run();
        });
        await Promise.race([Promise.all(running), sleep(scenario.runMs)]);
        await sleep(Math.max(0, scenario.runMs - relay.elapsedMs()));
    } finally {
        for (const p of procs.slice().reverse()) await stop(p);
        relay.close();
        // The driver directories hold the memory mapped term buffers (about 100 MB each); keep only the logs.
        removeDriverDirs();
    }
    return { relay, pubChannel, subChannel };
}

/** Scenario expectations that a run did not meet (a burst can lose a datagram; the capture is then repeated). */
function missingExpectations(scenario, relay) {
    const missing = [];
    for (const want of scenario.expect ?? []) {
        if (want === 'retransmit') {
            if (!relay.records.some((r) => r.retransmitOf !== undefined)) missing.push(want);
        } else if (![...relay.classCounts.keys()].some((k) => k.startsWith(want))) {
            missing.push(want);
        }
    }
    return missing;
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------
mkdirSync(workDir, { recursive: true });
const datagrams = [];
const scenarioMeta = [];
let index = 0;
for (const scenario of SCENARIOS) {
    if (only && scenario.name !== only) {
        index++;
        continue;
    }
    console.error(`capture-golden: scenario ${scenario.name} ...`);
    let result;
    for (let attempt = 1; ; attempt++) {
        result = await runScenario(scenario, index);
        const missing = missingExpectations(scenario, result.relay);
        if (missing.length === 0) break;
        console.error(`capture-golden:   attempt ${attempt} lacks ${missing.join(', ')}`);
        if (attempt === MAX_ATTEMPTS) throw new Error(`scenario ${scenario.name} never produced ${missing.join(', ')}`);
    }
    index++;
    const { relay, pubChannel, subChannel } = result;
    const counts = {};
    for (const [key, n] of relay.classCounts) counts[key.split(':')[1]] = (counts[key.split(':')[1]] ?? 0) + n;
    console.error(`capture-golden:   ${relay.records.length} kept; seen ${JSON.stringify(counts)}`);
    // NAKs that the deliberate drop did not cause (the relay can drop datagrams under a burst). Kept in the file
    // (NAK is always kept) and counted here so they are visible; the test scopes its NAK checks to the deliberate one.
    const droppedFrame = relay.records.find((r) => r.dropped)?.frames[0];
    const naks = relay.records.filter((r) => r.frames[0].type === 0x02);
    const unintendedNaks = naks.filter(
        (r) =>
            droppedFrame === undefined ||
            r.frames[0].fields.termId !== droppedFrame.fields.termId ||
            r.frames[0].fields.termOffset !== droppedFrame.fields.termOffset,
    );
    console.error(`capture-golden:   ${naks.length} NAK(s), ${unintendedNaks.length} not for the deliberate drop`);
    scenarioMeta.push({
        name: scenario.name,
        description: scenario.description,
        publisher: scenario.publisher,
        publisherChannel: pubChannel,
        subscriberChannel: subChannel,
        subscriberDriverEnv: scenario.subDriverEnv ?? {},
        dropDataFrameOrdinal: scenario.drop ?? null,
        subscribers: scenario.subscribers,
        unintendedNaks: unintendedNaks.map((r) => ({ seq: r.seq, ...r.frames[0].fields })),
        datagramsSeenByClass: Object.fromEntries(relay.classCounts),
    });
    datagrams.push(...relay.records);
}

const output = {
    generator: 'scripts/capture-golden.mjs',
    aeron: '1.53.3 (C driver)',
    note:
        'Every datagram was captured on loopback between two real Aeron C drivers; field values were decoded by an ' +
        'independent DataView decoder in the capture script. 64 bit values are decimal strings.',
    config: {
        sessionId: SESSION_ID,
        streamId: STREAM_ID,
        initialTermId: INITIAL_TERM_ID,
        termLength: TERM_LENGTH,
        mtu: MTU,
        seed: 'none: no randomness in the script; drop is chosen by data frame ordinal',
    },
    scenarios: scenarioMeta,
    datagrams,
};
if (only && !(args.out ?? process.env.GOLDEN_OUT)) {
    console.error('capture-golden: --only given, not overwriting the output file; summary only');
} else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(output, null, 1) + '\n');
    console.error(`capture-golden: wrote ${datagrams.length} datagrams to ${outFile}`);
}
