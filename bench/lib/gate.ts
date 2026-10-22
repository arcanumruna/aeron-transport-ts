// `npm run bench:gate -- --base <ref> [--pairs n] [--filter s] [--samples n]`: the performance regression gate.
//
// 1. Resolves <ref> (default origin/main) to a sha and extracts it with `git archive` into a fresh directory under the
//    temp directory, outside the repository, with a symlink to node_modules and the CANDIDATE's bench/ and worker
//    loader copied in: base and candidate run the same bench code against their own src/.
// 2. Runs each bench file in the base: a bench whose import or setup fails there (the API does not exist yet) is
//    "n/a in base", not a failure.
// 3. Interleaves separate processes, base, candidate, base, candidate, for --pairs pairs (default 5).
// 4. For each bench, the verdict (verdict.ts) is on the median of the per-pair ratios candidate / base.
// 5. Prints a table and exits 1 on a failure. The scratch directory is deleted at the end, also on a failure.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median } from './stats.js';
import type { ErrorLine, Result } from './types.js';
import { type Pair, ratios, RULES, verdict } from './verdict.js';

interface Options {
    base: string;
    pairs: number;
    filter: string;
    samples: number;
}

/** Latency benches need this many pairs for a verdict; a throughput bench needs 3. */
const LATENCY_PAIRS = 5;

function parseArgs(argv: string[]): Options {
    const options: Options = { base: 'origin/main', pairs: 5, filter: '', samples: 2000 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--base':
                options.base = argv[++i] ?? '';
                break;
            case '--pairs':
                options.pairs = Number(argv[++i]);
                if (!Number.isInteger(options.pairs) || options.pairs < 1) {
                    throw new Error('--pairs needs a positive integer');
                }
                break;
            case '--filter':
                options.filter = argv[++i] ?? '';
                break;
            case '--samples':
                options.samples = Number(argv[++i]);
                break;
            default:
                throw new Error('unknown argument: ' + arg);
        }
    }
    return options;
}

type Line = Result | ErrorLine;

/** Runs one bench file in `cwd` as a separate process; the JSON lines it printed, and whether it ran at all. */
function runFile(cwd: string, file: string, options: Options): { lines: Line[]; ok: boolean; stderr: string } {
    const args = [
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
    const run = spawnSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 1 << 26,
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
    return { lines, ok: 0 === run.status, stderr: run.stderr ?? '' };
}

function isError(line: Line): line is ErrorLine {
    return 'error' in line;
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

function main(): number {
    const options = parseArgs(process.argv.slice(2));
    const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const sha = execFileSync('git', ['rev-parse', '--verify', options.base + '^{commit}'], {
        cwd: repo,
        encoding: 'utf8',
    }).trim();
    const files = readdirSync(join(repo, 'bench', 'micro'))
        .filter((f) => f.endsWith('.bench.ts'))
        .sort();

    process.stderr.write(
        'bench gate: base ' + options.base + ' (' + sha.slice(0, 12) + '), ' + options.pairs + ' pairs\n',
    );
    if (options.pairs < LATENCY_PAIRS) {
        process.stderr.write(
            'warning: ' +
                options.pairs +
                ' pairs; latency benches need ' +
                LATENCY_PAIRS +
                ' (throughput benches 3) for a verdict\n',
        );
    }

    const scratch = mkdtempSync(join(tmpdir(), 'aeron-bench-gate-'));
    const pairs = new Map<string, Pair[]>();
    const order: string[] = [];
    const errors = new Map<string, string>();
    try {
        prepareBase(repo, sha, scratch);

        for (let k = 0; k < options.pairs; k++) {
            for (const file of files) {
                // A then B: base, candidate, base, candidate
                const base = runFile(scratch, file, options);
                const cand = runFile(repo, file, options);
                const baseResults = new Map<string, Result>();
                for (const line of base.lines) {
                    if (!isError(line)) {
                        baseResults.set(line.name, line);
                    }
                }
                for (const line of cand.lines) {
                    if (isError(line)) {
                        errors.set(line.name, line.error);
                        if (!order.includes(line.name)) {
                            order.push(line.name);
                        }
                        continue;
                    }
                    if (!order.includes(line.name)) {
                        order.push(line.name);
                    }
                    const b = baseResults.get(line.name);
                    if (undefined === b) {
                        continue; // reported as n/a in base below, unless an earlier pair had it
                    }
                    const list = pairs.get(line.name) ?? [];
                    list.push({ base: b, cand: line });
                    pairs.set(line.name, list);
                }
                if (!cand.ok && 0 === cand.lines.length) {
                    errors.set(file, 'the candidate run failed: ' + cand.stderr.trim().split('\n').slice(-3).join(' '));
                    if (!order.includes(file)) {
                        order.push(file);
                    }
                }
            }
        }

        // the table and the verdicts
        let failed = false;
        const width = Math.max(...order.map((n) => n.length), 5);
        const header = [pad('bench', width), ...RULES.map((r) => r.label.padStart(8)), '  verdict'].join(' ');
        process.stderr.write(
            '\nmedian ratio candidate / base over the pairs (ns/op, p50: limit 1.05; p99, p99.9: 1.10; ops/s: 0.95)\n',
        );
        process.stderr.write(header + '\n');
        for (const name of order) {
            const error = errors.get(name);
            if (undefined !== error) {
                failed = true;
                process.stderr.write(pad(name, width) + '  FAIL: ' + error + '\n');
                continue;
            }
            const list = pairs.get(name);
            if (undefined === list || 0 === list.length) {
                process.stderr.write(pad(name, width) + '  n/a in base\n');
                continue;
            }
            const { pass, failures } = verdict(list);
            const cells = RULES.map((rule) => {
                const r = ratios(list, rule.metric);
                return (0 === r.length ? '-' : median(r).toFixed(3)).padStart(8);
            });
            process.stderr.write([pad(name, width), ...cells, '  ' + (pass ? 'pass' : 'FAIL')].join(' ') + '\n');
            if (!pass) {
                failed = true;
                for (const failure of failures) {
                    process.stderr.write('    ' + name + ': ' + failure + '\n');
                }
            }
        }
        process.stderr.write(failed ? '\nbench gate: FAILED\n' : '\nbench gate: passed\n');
        return failed ? 1 : 0;
    } finally {
        try {
            unlinkSync(join(scratch, 'node_modules'));
        } catch {
            // not created yet
        }
        rmSync(scratch, { recursive: true, force: true });
    }
}

process.exitCode = main();
