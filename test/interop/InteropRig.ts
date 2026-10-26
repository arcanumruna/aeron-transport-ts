// Support of the interop tests (T23, spec 8.3): the Aeron C 1.53.3 media driver (`aeronmd`) and the C helpers of
// test/interop/c (a publisher and a subscriber that print one JSON object per line), run as child processes, each with
// an `aeron.dir` of its own under a temp directory, and the TS transport on the other side. Every wait ends at a hard
// deadline and fails, and every process is killed at the end of the test (`InteropEnv.dispose`), so none is left behind.
//
// The C build: `AERON_C_BUILD` (the CMake build directory of Aeron 1.53.3) or `.refs/aeron/build`. Without it the suite
// is skipped with a message (`interopAvailable`). The helpers are built on first use by `build-c.mjs`.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../support/Random.js';
import { driveUntil as driveUntilTurns } from '../support/SystemRig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const C_BUILD = resolve(process.env.AERON_C_BUILD ?? join(ROOT, '.refs', 'aeron', 'build'));
const HELPERS = join(ROOT, 'test', 'interop', 'c', '.build');

function haveDriver(): boolean {
    return existsSync(join(C_BUILD, 'binaries', 'aeronmd')) && existsSync(join(C_BUILD, 'lib', 'libaeron.so'));
}

/** The helpers exist and are not older than their sources. */
function haveHelpers(): boolean {
    const sources = ['interop_publisher.c', 'interop_subscriber.c', 'interop_common.h'].map((name) =>
        join(ROOT, 'test', 'interop', 'c', name),
    );
    const newest = Math.max(...sources.map((source) => statSync(source).mtimeMs));
    return ['interop_publisher', 'interop_subscriber'].every((name) => {
        const binary = join(HELPERS, name);
        return existsSync(binary) && statSync(binary).mtimeMs >= newest;
    });
}

function checkAvailable(): string | null {
    if (!haveDriver()) {
        return 'no Aeron C 1.53.3 build in ' + C_BUILD + ' (set AERON_C_BUILD to its CMake build directory)';
    }

    if (!haveHelpers()) {
        const built = spawnSync(process.execPath, [join(ROOT, 'test', 'interop', 'build-c.mjs')], {
            env: { ...process.env, AERON_C_BUILD: C_BUILD },
            encoding: 'utf8',
        });
        if (built.status !== 0 || !haveHelpers()) {
            return 'the C helpers of test/interop/c did not build: ' + built.stderr;
        }
    }

    return null;
}

/** Why the interop suite cannot run here, or null when it can. */
export const interopSkipReason: string | null = checkAvailable();
export const interopAvailable = interopSkipReason === null;

if (!interopAvailable) {
    console.warn('interop tests skipped: ' + interopSkipReason);
}

/**
 * Turns of the event loop until the condition holds; fails at the time cap (the wall time of real processes and UDP,
 * not a count of turns: an idle loop takes millions of turns a second).
 */
export function driveUntil(condition: () => boolean, what: string, capMs = 20_000): Promise<void> {
    return driveUntilTurns(condition, what, capMs, Number.MAX_SAFE_INTEGER);
}

/** One line of JSON that a helper printed. */
export interface HelperEvent {
    readonly event: string;
    readonly [key: string]: unknown;
}

export interface SessionSummary {
    readonly sessionId: number;
    readonly first: number;
    readonly last: number;
    readonly count: number;
}

export interface SubscriberSummary extends HelperEvent {
    readonly count: number;
    readonly errors: number;
    readonly firstError: string;
    readonly available: number;
    readonly unavailable: number;
    readonly eos: number;
    readonly sessions: readonly SessionSummary[];
}

export interface PublisherSummary {
    readonly sent: number;
    readonly first: number;
    readonly position: number;
    readonly sessionId: number;
    readonly backPressured: number;
    readonly notConnected: number;
    readonly adminAction: number;
}

/** A child process with its output kept: the JSON lines of stdout, and stderr as text for the failure messages. */
export class ChildHandle {
    public readonly events: HelperEvent[] = [];
    public stderr = '';
    public exitCode: number | null | undefined = undefined;
    private pending = '';
    private readonly child: ChildProcess;

    public constructor(
        public readonly name: string,
        command: string,
        args: readonly string[],
        env: Record<string, string>,
    ) {
        this.child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child.stdout?.setEncoding('utf8');
        this.child.stderr?.setEncoding('utf8');
        this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
        this.child.stderr?.on('data', (chunk: string) => void (this.stderr += chunk));
        this.child.stdin?.on('error', () => {});
        this.child.on('exit', (code, signal) => void (this.exitCode = code ?? (signal ? -1 : 0)));
        this.child.on('error', (e) => void (this.stderr += 'spawn error: ' + e.message));
    }

    private onStdout(chunk: string): void {
        this.pending += chunk;
        let newline = this.pending.indexOf('\n');
        while (newline >= 0) {
            const line = this.pending.slice(0, newline).trim();
            this.pending = this.pending.slice(newline + 1);
            if (line.startsWith('{')) {
                try {
                    this.events.push(JSON.parse(line) as HelperEvent);
                } catch {
                    this.stderr += 'unparsable line: ' + line + '\n';
                }
            }
            newline = this.pending.indexOf('\n');
        }
    }

    public hasExited(): boolean {
        return this.exitCode !== undefined;
    }

    public count(event: string): number {
        return this.events.filter((e) => e.event === event).length;
    }

    public ofKind(event: string): HelperEvent[] {
        return this.events.filter((e) => e.event === event);
    }

    /** End of the helper's stdin: a publisher closes its publication, a subscriber stops reading. */
    public closeInput(): void {
        this.child.stdin?.end();
    }

    public kill(): void {
        if (!this.hasExited()) {
            this.child.kill('SIGKILL');
        }
    }

    public describe(): string {
        return (
            this.name +
            ' (exit ' +
            String(this.exitCode) +
            ') events ' +
            JSON.stringify(this.events.slice(-6)) +
            ' stderr ' +
            this.stderr.slice(-600)
        );
    }
}

export interface DriverOptions {
    /** `recv-msg-mask` of the C loss interceptor (a hex mask of `1 << frame type`), with `rate` and `seed`. */
    readonly loss?: { readonly rate: number; readonly seed: number; readonly mask: number };
}

/** The processes and directories of one test; `dispose` ends and removes them all. */
export class InteropEnv {
    private readonly children: ChildHandle[] = [];
    private readonly directories: string[] = [];
    private readonly closers: (() => void)[] = [];
    private readonly root = mkdtempSync(join(tmpdir(), 'aeron-interop-'));

    /** Something to close at the end of the test (a relay, a node). */
    public onDispose(close: () => void): void {
        this.closers.push(close);
    }

    private newDirectory(name: string): string {
        const dir = join(this.root, name + this.directories.length);
        this.directories.push(dir);
        return dir;
    }

    /** An `aeronmd` of its own `aeron.dir`; resolves when its CnC file exists. */
    public async startDriver(options: DriverOptions = {}): Promise<string> {
        const dir = this.newDirectory('driver');
        const env: Record<string, string> = {
            AERON_DIR: dir,
            AERON_DIR_DELETE_ON_START: 'true',
            AERON_DIR_DELETE_ON_SHUTDOWN: 'true',
            AERON_THREADING_MODE: 'SHARED',
            AERON_PRINT_CONFIGURATION: 'false',
        };
        if (options.loss) {
            env.AERON_UDP_CHANNEL_INCOMING_INTERCEPTORS = 'loss';
            env.AERON_UDP_CHANNEL_TRANSPORT_BINDINGS_LOSS_ARGS =
                'rate=' +
                options.loss.rate +
                '|seed=' +
                options.loss.seed +
                '|recv-msg-mask=0x' +
                options.loss.mask.toString(16);
        }

        const driver = this.track(new ChildHandle('aeronmd', join(C_BUILD, 'binaries', 'aeronmd'), [], env));
        await driveUntil(
            () => {
                if (driver.hasExited()) {
                    throw new Error('aeronmd exited: ' + driver.describe());
                }
                return existsSync(join(dir, 'cnc.dat'));
            },
            'the C driver (cnc.dat)',
            15_000,
        );
        return dir;
    }

    private track(child: ChildHandle): ChildHandle {
        this.children.push(child);
        return child;
    }

    /** A C subscriber (`interop_subscriber`); `args` are its options. Waits for its "ready" line. */
    public async startSubscriber(dir: string, channel: string, args: readonly string[] = []): Promise<ChildHandle> {
        const sub = this.track(
            new ChildHandle(
                'interop_subscriber',
                join(HELPERS, 'interop_subscriber'),
                ['-d', dir, '-c', channel, ...args],
                {},
            ),
        );
        await driveUntil(
            () => sub.count('ready') > 0 || (sub.hasExited() && fail(sub)),
            'the C subscriber to be ready',
            15_000,
        );
        return sub;
    }

    /** A C publisher (`interop_publisher`); `args` are its options. */
    public startPublisher(dir: string, channel: string, args: readonly string[] = []): ChildHandle {
        return this.track(
            new ChildHandle(
                'interop_publisher',
                join(HELPERS, 'interop_publisher'),
                ['-d', dir, '-c', channel, ...args],
                {},
            ),
        );
    }

    /** Waits for the child to print its line `event`; fails when it exits without it. */
    public async waitForEvent(child: ChildHandle, event: string, capMs = 60_000, atLeast = 1): Promise<HelperEvent> {
        await driveUntil(
            () => child.count(event) >= atLeast || (child.hasExited() && child.count(event) < atLeast && fail(child)),
            event + ' of ' + child.name,
            capMs,
        );
        return child.ofKind(event)[atLeast - 1] as HelperEvent;
    }

    /** The summary of a C subscriber, which has exited when it prints it. */
    public async subscriberSummary(sub: ChildHandle, capMs = 60_000): Promise<SubscriberSummary> {
        const summary = (await this.waitForEvent(sub, 'summary', capMs)) as SubscriberSummary;
        await driveUntil(() => sub.hasExited(), 'the exit of ' + sub.name, 10_000);
        return summary;
    }

    /** The line a C publisher prints when it has offered all its messages. */
    public async publisherSent(pub: ChildHandle, capMs = 60_000): Promise<PublisherSummary> {
        return (await this.waitForEvent(pub, 'sent', capMs)) as unknown as PublisherSummary;
    }

    public dispose(): void {
        for (const close of this.closers.splice(0)) {
            try {
                close();
            } catch {
                // the test is over; the next closer still runs
            }
        }

        for (const child of this.children.splice(0)) {
            child.kill();
        }

        rmSync(this.root, { recursive: true, force: true });
    }
}

function fail(child: ChildHandle): never {
    throw new Error('process ended early: ' + child.describe());
}

/** The type of a datagram's first frame (the u16 at offset 6 of a frame header), or -1 for a short datagram. */
function frameType(datagram: Uint8Array): number {
    return datagram.length >= 8 ? (datagram[6] as number) | ((datagram[7] as number) << 8) : -1;
}

const FRAME_TYPE_DATA = 0x01;
const DATA_HEADER_LENGTH = 32;

/**
 * A loopback UDP forwarder between a C publisher's driver and a TS subscription that drops DATA frames that carry a
 * payload, with a seeded rate. The C driver sends to `frontPort`; the datagrams go on to `targetPort` (the TS
 * subscription's endpoint) from a socket of the relay, so the replies (status messages, NAKs) come back to the relay
 * and go to the C driver's socket. Heartbeats, setup and every control frame pass.
 */
export class LossyRelay {
    public dropped = 0;
    public forwarded = 0;
    private readonly front: dgram.Socket;
    private readonly back: dgram.Socket;
    private sender: { port: number; address: string } | null = null;
    private readonly random: () => number;

    private constructor(
        frontPort: number,
        private readonly targetPort: number,
        private readonly rate: number,
        seed: number,
    ) {
        this.random = mulberry32(seed);
        this.front = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 << 20, sendBufferSize: 8 << 20 });
        this.back = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 << 20, sendBufferSize: 8 << 20 });
        this.front.on('error', () => {});
        this.back.on('error', () => {});
        this.front.on('message', (message, remote) => {
            this.sender = { port: remote.port, address: remote.address };
            if (
                frameType(message) === FRAME_TYPE_DATA &&
                message.length > DATA_HEADER_LENGTH &&
                this.random() < this.rate
            ) {
                this.dropped++;
                return;
            }
            this.forwarded++;
            this.back.send(message, this.targetPort, '127.0.0.1');
        });
        this.back.on('message', (message) => {
            if (this.sender) {
                this.front.send(message, this.sender.port, this.sender.address);
            }
        });
    }

    public static async open(frontPort: number, targetPort: number, rate: number, seed: number): Promise<LossyRelay> {
        const relay = new LossyRelay(frontPort, targetPort, rate, seed);
        await Promise.all([
            new Promise<void>((resolveBind) => relay.front.bind(frontPort, '127.0.0.1', resolveBind)),
            new Promise<void>((resolveBind) => relay.back.bind(0, '127.0.0.1', resolveBind)),
        ]);
        return relay;
    }

    public close(): void {
        this.front.close();
        this.back.close();
    }
}
