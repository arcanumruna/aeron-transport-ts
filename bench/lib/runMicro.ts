// `npm run bench:micro [-- --filter <substring>] [--samples <n>] [--json] [--file <substring>]`: runs the micro benches
// of bench/micro/*.bench.ts. One JSON line per bench on stdout, `{name, nsPerOp, p50, p99, p999, opsPerSec?}`, and a
// table on stderr (not with --json). A bench or a file that fails prints `{name, error}` instead of a result. Start the
// process with `--expose-gc` (bench:micro and the gate do): a full collection runs before every timed region.
import { readdirSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { DEFAULT_SAMPLES, measure } from './runner.js';
import type { BenchModule, ErrorLine, Result } from './types.js';

interface Options {
    filter: string;
    file: string;
    samples: number;
    json: boolean;
}

function parseArgs(argv: string[]): Options {
    const options: Options = { filter: '', file: '', samples: DEFAULT_SAMPLES, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--filter':
                options.filter = argv[++i] ?? '';
                break;
            case '--file':
                options.file = argv[++i] ?? '';
                break;
            case '--samples':
                options.samples = Number(argv[++i]);
                if (!Number.isInteger(options.samples) || options.samples < 10) {
                    throw new Error('--samples needs an integer of 10 or more');
                }
                break;
            case '--json':
                options.json = true;
                break;
            default:
                throw new Error('unknown argument: ' + arg);
        }
    }
    return options;
}

function format(value: number | undefined, digits = 1): string {
    return undefined === value ? '' : value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function printTable(results: Result[]): void {
    const rows = [
        ['bench', 'ns/op', 'p50', 'p99', 'p99.9', 'ops/s'],
        ...results.map((r) => [
            r.name,
            format(r.nsPerOp),
            format(r.p50),
            format(r.p99),
            format(r.p999),
            format(r.opsPerSec, 0),
        ]),
    ];
    const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => (row[c] as string).length)));
    for (const row of rows) {
        process.stderr.write(
            row.map((cell, c) => (0 === c ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  ') + '\n',
        );
    }
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const dir = new URL('../micro/', import.meta.url);
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.bench.ts') && f.includes(options.file))
        .sort();

    if (!options.json) {
        process.stderr.write(
            'load average ' +
                loadavg()
                    .map((l) => l.toFixed(2))
                    .join(' ') +
                ' on ' +
                availableParallelism() +
                ' cores\n',
        );
    }
    const results: Result[] = [];
    for (const file of files) {
        let module: BenchModule;
        try {
            module = (await import(new URL(file, dir).href)) as BenchModule;
        } catch (e) {
            const line: ErrorLine = { name: file, error: 'import: ' + (e instanceof Error ? e.message : String(e)) };
            process.stdout.write(JSON.stringify(line) + '\n');
            continue;
        }
        for (const bench of module.benches) {
            if (!bench.name.includes(options.filter)) {
                continue;
            }
            try {
                const result = await measure(bench, options.samples);
                results.push(result);
                process.stdout.write(JSON.stringify(result) + '\n');
            } catch (e) {
                const line: ErrorLine = { name: bench.name, error: e instanceof Error ? e.message : String(e) };
                process.stdout.write(JSON.stringify(line) + '\n');
            }
        }
    }
    if (!options.json) {
        printTable(results);
    }
}

main().catch((e: unknown) => {
    process.stderr.write(String(e instanceof Error ? (e.stack ?? e.message) : e) + '\n');
    process.exit(2);
});
