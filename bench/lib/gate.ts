// `npm run bench:gate -- --base <ref> [--pairs n] [--filter s] [--file s] [--samples n] [--seed n] [--ignore-load] [--inject spec]`: the performance regression gate.
//
// 1. Resolves <ref> (default origin/main) to a sha and extracts it with `git archive` into a fresh directory under the
//    temp directory, outside the repository, with a symlink to node_modules and the CANDIDATE's bench/ and worker
//    loader copied in: base and candidate run the same bench code against their own src/.
// 2. A bench file that fails to import in the base (the API does not exist yet) is "n/a in base", not a failure;
//    any other failure of the base is NO_VERDICT.
// 3. Runs base and candidate as separate processes, --pairs pairs (default 5), in an order drawn per pair from --seed.
// 4. For each bench, the verdict (verdict.ts) is on the median of the per-pair ratios candidate / base.
// 5. Prints a table. Exit 0: everything passes; 1: a failure; 3: no verdict (and no failure), also when the host is too
//    busy; 2: a usage error. The scratch directory is deleted at the end, also on a failure.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BenchModule } from './types.js';
import {
    EXIT_NO_VERDICT,
    EXIT_USAGE,
    type Expected,
    type Line,
    MIN_TAIL_SAMPLES,
    type PairLines,
    REQUIRED_PAIRS,
    RULES,
    summarize,
} from './verdict.js';

interface Options {
    base: string;
    pairs: number;
    filter: string;
    /** Only the bench files whose name contains this (the tests of the gate use it). */
    file: string;
    samples: number;
    seed: number;
    ignoreLoad: boolean;
    /** A delay for the candidate runs only (bench/lib/inject.ts): the tests of the gate use it. */
    inject: string;
}

class UsageError extends Error {}

/** A load average per core above this makes the host too busy for a latency verdict. */
const MAX_LOAD_PER_CORE = 0.5;

function parseArgs(argv: string[]): Options {
    const options: Options = {
        base: 'origin/main',
        pairs: 5,
        filter: '',
        file: '',
        samples: 2000,
        seed: (Date.now() ^ (process.pid << 8)) >>> 0,
        ignoreLoad: false,
        inject: '',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--base':
                options.base = argv[++i] ?? '';
                break;
            case '--pairs':
                options.pairs = Number(argv[++i]);
                if (!Number.isInteger(options.pairs) || options.pairs < 1) {
                    throw new UsageError('--pairs needs a positive integer');
                }
                break;
            case '--filter':
                options.filter = argv[++i] ?? '';
                break;
            case '--file':
                options.file = argv[++i] ?? '';
                break;
            case '--samples':
                options.samples = Number(argv[++i]);
                if (!Number.isInteger(options.samples) || options.samples < 10) {
                    throw new UsageError('--samples needs an integer of 10 or more');
                }
                break;
            case '--seed':
                options.seed = Number(argv[++i]);
                if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
                    throw new UsageError('--seed needs an integer from 0 to 4294967295');
                }
                break;
            case '--ignore-load':
                options.ignoreLoad = true;
                break;
            case '--inject':
                options.inject = argv[++i] ?? '';
                if ('' === options.inject) {
                    throw new UsageError('--inject needs a spec, as TermReader.read:+20%');
                }
                break;
            default:
                throw new UsageError('unknown argument: ' + arg);
        }
    }
    return options;
}

/** mulberry32: a small seeded PRNG, so that the A/B order of a run can be repeated with `--seed`. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Runs one bench file in `cwd` as a separate process; the JSON lines it printed, and a line for a process that failed. */
function runFile(cwd: string, file: string, options: Options, inject = ''): Line[] {
    const args = [
        '--expose-gc',
        '--experimental-transform-types',
        '--import',
        './test/support/workerRegister.mjs',
        '--no-warnings',
        'bench/lib/runMicro.ts',
        '--json',
        '--file',
        file,
        '--samples',
        String(options.samples),
    ];
    if ('' !== options.filter) {
        args.push('--filter', options.filter);
    }
    // the delay is for the candidate runs only: the base never inherits one from the environment of the gate
    const env = { ...process.env };
    delete env['AERON_BENCH_INJECT'];
    if ('' !== inject) {
        env['AERON_BENCH_INJECT'] = inject;
    }
    const run = spawnSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        timeout: 20 * 60 * 1000,
        maxBuffer: 1 << 26,
        env,
    });
    const lines: Line[] = [];
    for (const text of (run.stdout ?? '').split('\n')) {
        if (text.startsWith('{')) {
            try {
                lines.push(JSON.parse(text) as Line);
            } catch {
                // not one of ours
            }
        }
    }
    if (0 !== run.status) {
        const tail = (run.stderr ?? '').trim().split('\n').slice(-3).join(' ');
        lines.push({ name: file, error: 'the process failed (' + String(run.status ?? run.signal) + '): ' + tail });
    }
    return lines;
}

/** The benches the candidate's bench modules export (matching the filter); a module that does not import is one entry. */
async function expectedBenches(repo: string, files: readonly string[], filter: string): Promise<Expected[]> {
    const expected: Expected[] = [];
    for (const file of files) {
        try {
            const module = (await import(pathToFileURL(join(repo, 'bench', 'micro', file)).href)) as BenchModule;
            for (const bench of module.benches) {
                if (bench.name.includes(filter)) {
                    expected.push({ name: bench.name, file });
                }
            }
        } catch {
            expected.push({ name: file, file });
        }
    }
    return expected;
}

/** Extracts `sha` into a fresh directory outside the repository and makes it runnable. */
function prepareBase(repo: string, sha: string, scratch: string): void {
    execFileSync('sh', ['-c', 'git archive "$0" | tar -x -C "$1"', sha, scratch], { cwd: repo, stdio: 'inherit' });
    symlinkSync(join(repo, 'node_modules'), join(scratch, 'node_modules'), 'dir');
    // the candidate's bench code and worker loader, so that both sides run the same benches
    rmSync(join(scratch, 'bench'), { recursive: true, force: true });
    cpSync(join(repo, 'bench'), join(scratch, 'bench'), { recursive: true });
    mkdirSync(join(scratch, 'test', 'support'), { recursive: true });
    for (const f of ['workerRegister.mjs', 'workerHooks.mjs']) {
        cpSync(join(repo, 'test', 'support', f), join(scratch, 'test', 'support', f));
    }
}

function pad(text: string, width: number): string {
    return text.padEnd(width);
}

async function main(): Promise<number> {
    const options = parseArgs(process.argv.slice(2));
    const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

    const cores = availableParallelism();
    const load = loadavg();
    process.stderr.write('load average ' + load.map((l) => l.toFixed(2)).join(' ') + ' on ' + cores + ' cores\n');
    if (load[0]! > MAX_LOAD_PER_CORE * cores) {
        if (!options.ignoreLoad) {
            process.stderr.write(
                'warning: the 1-minute load average ' +
                    load[0]!.toFixed(2) +
                    ' is over ' +
                    MAX_LOAD_PER_CORE * cores +
                    ' (0.5 x cores): the host is too busy for a verdict; NO_VERDICT (--ignore-load overrides)\n',
            );
            return EXIT_NO_VERDICT;
        }
    }
    if ('' !== options.inject) {
        process.stderr.write(
            '--inject ' + options.inject + ': a delay in the candidate runs only (a test of the gate)\n',
        );
    }
    if (options.ignoreLoad) {
        process.stderr.write('--ignore-load: the load average is not checked; the numbers are for local experiments\n');
    }

    const sha = execFileSync('git', ['rev-parse', '--verify', options.base + '^{commit}'], {
        cwd: repo,
        encoding: 'utf8',
    }).trim();
    const files = readdirSync(join(repo, 'bench', 'micro'))
        .filter((f) => f.endsWith('.bench.ts') && f.includes(options.file))
        .sort();
    const expected = await expectedBenches(repo, files, options.filter);

    process.stderr.write(
        'bench gate: base ' +
            options.base +
            ' (' +
            sha.slice(0, 12) +
            '), ' +
            options.pairs +
            ' pairs, seed ' +
            options.seed +
            '\n',
    );
    if (options.pairs < REQUIRED_PAIRS.latency) {
        process.stderr.write(
            'warning: ' +
                options.pairs +
                ' pairs; latency benches need ' +
                REQUIRED_PAIRS.latency +
                ' (throughput benches ' +
                REQUIRED_PAIRS.throughput +
                ') for a verdict\n',
        );
    }

    const scratch = mkdtempSync(join(tmpdir(), 'aeron-bench-gate-'));
    const random = prng(options.seed);
    const runs: PairLines[] = [];
    try {
        prepareBase(repo, sha, scratch);

        for (let k = 0; k < options.pairs; k++) {
            const base: Line[] = [];
            const cand: Line[] = [];
            for (const file of files) {
                // base and candidate in an order drawn per pair from the seed, so that neither always runs first
                if (random() < 0.5) {
                    base.push(...runFile(scratch, file, options));
                    cand.push(...runFile(repo, file, options, options.inject));
                } else {
                    cand.push(...runFile(repo, file, options, options.inject));
                    base.push(...runFile(scratch, file, options));
                }
            }
            runs.push({ base, cand });
        }

        const summary = summarize(runs, expected, REQUIRED_PAIRS);

        const width = Math.max(...summary.benches.map((b) => b.name.length), 5);
        process.stderr.write(
            '\nmedian ratio candidate / base over the pairs (ns/op, p50: limit 1.05; p99, p99.9: 1.10 from ' +
                MIN_TAIL_SAMPLES +
                ' samples, else information (~); ops/s: 0.95)\n',
        );
        process.stderr.write(
            [pad('bench', width), ...RULES.map((r) => r.label.padStart(9)), '  verdict'].join(' ') + '\n',
        );
        for (const bench of summary.benches) {
            const cells = RULES.map((rule) => {
                const metric = bench.metrics.find((m) => m.label === rule.label);
                if (undefined === metric || Number.isNaN(metric.median)) {
                    return '-'.padStart(9);
                }
                return (metric.median.toFixed(3) + ('INFO' === metric.status ? '~' : '')).padStart(9);
            });
            process.stderr.write([pad(bench.name, width), ...cells, '  ' + bench.status].join(' ') + '\n');
            for (const note of bench.notes) {
                process.stderr.write('    ' + bench.name + ': ' + note + '\n');
            }
        }
        process.stderr.write('\nbench gate: ' + summary.status + ' (exit ' + summary.exitCode + ')\n');
        return summary.exitCode;
    } finally {
        try {
            unlinkSync(join(scratch, 'node_modules'));
        } catch {
            // not created yet
        }
        rmSync(scratch, { recursive: true, force: true });
    }
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (e: unknown) => {
        process.stderr.write(String(e instanceof Error ? (e.stack ?? e.message) : e) + '\n');
        process.exitCode = e instanceof UsageError ? EXIT_USAGE : 1;
    },
);
