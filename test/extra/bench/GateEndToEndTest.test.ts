// Not in Aeron: the bench gate itself, end to end (T24, spec D110). The real `bench:gate` runs, as separate processes, a
// real bench (`TermReader.read` of 16 fragments, bench/micro/termreader.bench.ts) against a base and a candidate:
//
//   1. a candidate with a delay of 20% injected into `TermReader.read` fails the gate (exit 1, the bench and the ratios
//      named);
//   2. the same commit as base and candidate passes it (exit 0).
//
// The repository under test is a scratch copy: the sources of HEAD (so that base and candidate are the same commit, whatever
// is uncommitted in the working tree) with the working tree's `bench/` and `test/support/` over them, committed in a
// scratch git repository outside this one. The gate is started from that copy, so its base (`git archive HEAD`) and its
// candidate (the copy's working tree) share every line of `src/`. The delay is injected by the bench harness
// (bench/lib/inject.ts, `--inject`) into the candidate processes only; nothing in `src/` has a hook.
//
// A timing test cannot be deterministic on a shared host: the gate itself sees a spread of +-30% between two processes
// of the same code. So the sizes are chosen for the verdict to be robust, and the gate's own rule for noise is applied:
//
//   - 20% is four times the 5% limit of p50 and ns/op, and the delay is 20% of the median cost of the very call that the
//     bench times (calibrated in the bench process, so it is 20% on any host); the benched call is the 16 fragment read
//     (~350 ns), long enough that a clock tick or a collection is a small part of a sample;
//   - 9 pairs for the delay and 11 for the same commit: the verdict is on the median of the per-pair ratios, and the
//     samples of a pair are 1000 samples of 1000 reads in each of 3 repeats (the bench runner's own rule);
//   - "noise is never a verdict: rerun with 15 pairs" (bench/README.md): a first run that does not give the expected
//     verdict is rerun once with 15 pairs, and the rerun is the one that counts. A gate that fails the same commit
//     at 15 pairs, or passes the delayed one, is broken.
//
// Runtime: about 30 s each when the host is idle, a minute or more under the load of the whole suite.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSpec } from '../../../bench/lib/inject.js';
import { EXIT_FAIL, EXIT_PASS } from '../../../bench/lib/verdict.js';

const REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const BENCH_FILE = 'termreader';
const BENCH = 'TermReader read: 16 fragments of 64 B';
const SAMPLES = 1000;
const TIMEOUT_MS = 600_000;

interface GateRun {
    status: number | null;
    output: string;
}

describe('GateEndToEnd', () => {
    let scratch = '';
    let copy = '';

    beforeAll(() => {
        scratch = mkdtempSync(join(tmpdir(), 'aeron-gate-test-'));
        copy = join(scratch, 'repo');
        execFileSync('sh', ['-c', 'mkdir "$1" && git archive HEAD | tar -x -C "$1"', 'sh', copy], { cwd: REPO });
        for (const dir of ['bench', 'test/support']) {
            cpSync(join(REPO, dir), join(copy, dir), { recursive: true });
        }
        symlinkSync(join(REPO, 'node_modules'), join(copy, 'node_modules'), 'dir');
        const git = (...args: string[]): void => {
            execFileSync('git', ['-c', 'user.name=gate test', '-c', 'user.email=', ...args], {
                cwd: copy,
                stdio: 'pipe',
            });
        };
        git('init', '-q');
        git('add', '--', 'src', 'bench', 'test', 'package.json', 'tsconfig.json');
        git('commit', '-q', '--allow-empty-message', '-m', 'the commit under test');
    }, TIMEOUT_MS);

    afterAll(() => {
        rmSync(scratch, { recursive: true, force: true });
    });

    /** `bench:gate` of the copy, HEAD of the copy as the base. */
    function gate(pairs: number, inject?: string, calibrate = false): GateRun {
        const args = [
            '--experimental-transform-types',
            '--import',
            './test/support/workerRegister.mjs',
            '--no-warnings',
            'bench/lib/gate.ts',
            '--base',
            'HEAD',
            '--file',
            BENCH_FILE,
            '--filter',
            BENCH,
            '--pairs',
            String(pairs),
            '--samples',
            String(SAMPLES),
            // the host of a test run is not idle (the other test files run beside this one); the pairs are interleaved
            '--ignore-load',
            // the verdict tests below size their own noise rule; the A/A run has a test of its own
            ...(calibrate ? [] : ['--no-calibrate']),
            ...(undefined === inject ? [] : ['--inject', inject]),
        ];
        const run = spawnSync(process.execPath, args, { cwd: copy, encoding: 'utf8', timeout: TIMEOUT_MS });
        return { status: run.status, output: (run.stdout ?? '') + (run.stderr ?? '') };
    }

    /** The first run, and, if it did not give `expected`, the rerun with 15 pairs, which is the one that counts. */
    function verdictOf(pairs: number, expected: number, inject?: string): GateRun {
        const first = gate(pairs, inject);
        return first.status === expected ? first : gate(15, inject);
    }

    it(
        'aCandidateWithADelayOf20PercentInTermReaderReadFailsTheGate',
        () => {
            const run = verdictOf(9, EXIT_FAIL, 'TermReader.read:+20%');
            // the gate says that it injects, and only into the candidate
            expect(run.output).toContain('--inject TermReader.read:+20%: a delay in the candidate runs only');
            expect(run.status, run.output).toBe(EXIT_FAIL);
            // the failure names the bench, the metric and the ratio of every pair
            expect(run.output).toMatch(
                new RegExp(
                    BENCH + ': (ns/op|p50): median ratio \\d+\\.\\d{3} > 1\\.05 \\(pairs: (\\d+\\.\\d{3}(, )?)+\\)',
                ),
            );
            expect(run.output).toContain('bench gate: FAIL');
        },
        TIMEOUT_MS,
    );

    it(
        'theSameCommitAsBaseAndCandidatePassesTheGate',
        () => {
            const run = verdictOf(11, EXIT_PASS);
            expect(run.status, run.output).toBe(EXIT_PASS);
            expect(run.output).toContain('bench gate: PASS');
            expect(run.output).not.toContain('--inject');
        },
        TIMEOUT_MS,
    );

    it(
        'theGateRunsTheBaseAgainstItselfFirstUnlessToldNotTo',
        () => {
            // 5 pairs: the A/A run and the A/B run. The verdict depends on the host (a noisy one is NO_VERDICT with
            // the spread), so this asserts what the gate says it did and that the A/A figures are in the output.
            const run = gate(5, undefined, true);
            expect(run.status, run.output).not.toBe(2);
            expect(run.output).toContain('A/A calibration: the base against itself, 5 pairs');
            expect(run.output).not.toContain('--no-calibrate');
            if (EXIT_PASS !== run.status) {
                expect(run.output).toMatch(/A\/A median ratio \d+\.\d{3}, spread \d+\.\d{3}|median ratio \d+\.\d{3} >/);
            }

            const skipped = gate(5);
            expect(skipped.output).toContain('--no-calibrate: no A/A run');
            expect(skipped.output).not.toContain('A/A calibration');
        },
        TIMEOUT_MS,
    );
});

describe('GateInjectSpec', () => {
    it('theSpecIsTheFunctionAndAPercentage', () => {
        expect(parseSpec('TermReader.read:+20%')).toEqual({ target: 'TermReader.read', percent: 20 });
        expect(parseSpec('TermReader.read:+12.5%')).toEqual({ target: 'TermReader.read', percent: 12.5 });
    });

    it.each([
        '',
        'TermReader.read',
        'TermReader.read:20%',
        'TermReader.read:+20',
        'Other.read:+20%',
        'TermReader.read:-5%',
    ])('aSpecThatIsNotOneIsRefused: %s', (spec) => {
        expect(() => parseSpec(spec)).toThrow('AERON_BENCH_INJECT needs TermReader.read:+<percent>%');
    });
});
