// Checks that every mapped Aeron/Agrona JUnit test has a vitest test with the same name, and the reverse.
// Reads the "Tests" and "Skipped tests" tables of docs/mapping.md (spec §8.1).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_ANNOTATION = /^\s*@(Test|ParameterizedTest|RepeatedTest|TestTemplate)\b/;
const METHOD = /^\s*(?:(?:public|protected|private|static|final|synchronized)\s+)*[\w<>[\],\s]+?\s+(\w+)\s*\(/;

/** Test method names declared in a Java test file, and the simple name of the class it extends (if any). */
export function javaTestNames(path) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const own = [];
    let pending = false;
    for (const line of lines) {
        if (TEST_ANNOTATION.test(line)) {
            pending = true;
            continue;
        }
        if (pending && !/^\s*@/.test(line) && line.trim() !== '') {
            const m = METHOD.exec(line);
            if (m) own.push(m[1]);
            pending = false;
        }
    }
    const ext = /\bclass\s+\w+(?:<[^>]*>)?\s+extends\s+(\w+)/.exec(lines.join('\n'));
    return { own, base: ext ? ext[1] : undefined };
}

function skipString(src, i) {
    const q = src[i];
    for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === q) return i + 1;
    }
    return i;
}

function matchParen(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
            i = skipString(src, i) - 1;
        } else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return i;
    }
    return -1;
}

/** `it` titles in a TS test file: name (title up to the first space), and whether it is skipped. */
export function tsTestTitles(src) {
    const out = [];
    const re = /\bit((?:\.(?:skip|only|todo|each|fails))*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const mods = m[1];
        let open = m.index + m[0].length - 1;
        if (mods.includes('.each')) {
            const close = matchParen(src, open);
            if (close < 0) continue;
            const next = /^\s*\(/.exec(src.slice(close + 1));
            if (!next) continue;
            open = close + 1 + next[0].length - 1;
        }
        const t = /^\(\s*(['"`])((?:\\.|(?!\1).)*)\1/s.exec(src.slice(open));
        if (!t) continue;
        out.push({ name: t[2].split(/\s/)[0], skip: mods.includes('.skip') || mods.includes('.todo') });
    }
    return out;
}

function tableRows(md, heading) {
    const head = new RegExp(`(^|\\n)## ${heading}\\n`).exec(md);
    if (head === null) return [];
    const rest = md.slice(head.index + head[0].length);
    const end = rest.search(/\n## /);
    return (end < 0 ? rest : rest.slice(0, end))
        .split('\n')
        .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
        .slice(1)
        .map((l) =>
            l
                .slice(1, l.lastIndexOf('|'))
                .split('|')
                .map((c) => c.trim().replace(/^`|`$/g, '')),
        );
}

function multisetDiff(a, b) {
    const counts = new Map();
    for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
    const out = [];
    for (const x of a) {
        const n = counts.get(x) ?? 0;
        if (n === 0) out.push(x);
        else counts.set(x, n - 1);
    }
    return out;
}

/**
 * @param md mapping.md text
 * @param opts.roots map of prefix (`aeron`, `agrona`) to a directory; a Java cell is `prefix:relative/path`
 * @param opts.readTs reads a TS test file by its repo-relative path
 * @returns error messages, empty when the mapping holds
 */
export function checkMapping(md, opts) {
    const errors = [];
    const rows = tableRows(md, 'Tests');
    const javaPath = (cell) => {
        const i = cell.indexOf(':');
        const root = opts.roots[cell.slice(0, i)];
        if (root === undefined) throw new Error(`unknown source prefix in ${cell}`);
        return join(root, cell.slice(i + 1));
    };
    const byBase = new Map();
    for (const [java, ts] of rows)
        byBase.set(java.slice(java.lastIndexOf('/') + 1).replace(/\.java$/, ''), { java, ts });

    const javaAll = (cell, seen = new Set()) => {
        if (seen.has(cell)) return [];
        seen.add(cell);
        const { own, base } = javaTestNames(javaPath(cell));
        if (base === undefined) return own;
        const b = byBase.get(base);
        if (b === undefined) return own; // a non-test base class (no row): contributes no tests
        return [...javaAll(b.java, seen), ...own];
    };
    const tsAll = (cell) => {
        const java = rows.find((r) => r[1] === cell)?.[0];
        let titles = tsTestTitles(opts.readTs(cell));
        const base = java ? javaTestNames(javaPath(java)).base : undefined;
        const b = base ? byBase.get(base) : undefined;
        if (b) {
            const src = opts.readTs(cell);
            // The TS subclass must call the shared base function; its titles count only if it does.
            const fn = /export function (\w+)/.exec(opts.readTs(b.ts))?.[1];
            if (fn && new RegExp(`\\b${fn}\\s*\\(`).test(src)) titles = [...tsAll(b.ts), ...titles];
        }
        return titles;
    };

    const skips = [];
    for (const [java, ts, javaCount, tsCount] of rows) {
        const jn = javaAll(java);
        const tt = tsAll(ts);
        const tn = tt.map((t) => t.name);
        for (const name of multisetDiff(jn, tn)) errors.push(`${ts}: missing TS test ${name} (from ${java})`);
        for (const name of multisetDiff(tn, jn)) errors.push(`${ts}: TS test ${name} has no Java test in ${java}`);
        if (Number(javaCount) !== jn.length)
            errors.push(`${ts}: Java count is ${jn.length}, mapping says ${javaCount}`);
        if (Number(tsCount) !== tn.length) errors.push(`${ts}: TS count is ${tn.length}, mapping says ${tsCount}`);
        for (const t of tsTestTitles(opts.readTs(ts))) if (t.skip) skips.push(`${ts}|${t.name}`);
    }

    const listed = tableRows(md, 'Skipped tests').map(([ts, name]) => `${ts}|${name}`);
    for (const s of multisetDiff(skips, listed)) {
        const [ts, name] = s.split('|');
        errors.push(`${ts}: skipped test ${name} is not listed in "Skipped tests"`);
    }
    for (const s of multisetDiff(listed, skips)) {
        const [ts, name] = s.split('|');
        errors.push(`${ts}: listed skip ${name} is not an it.skip`);
    }
    return errors;
}

function main() {
    const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
    const refs = process.env.REFS_DIR ?? join(repo, '.refs');
    const roots = {
        aeron: process.env.AERON_SRC ?? join(refs, 'aeron'),
        agrona: process.env.AGRONA_SRC ?? join(refs, 'agrona'),
    };
    for (const [k, v] of Object.entries(roots)) {
        if (!existsSync(v)) {
            console.error(`${k} sources not found at ${v}; run npm run fetch:refs`);
            process.exit(2);
        }
    }
    const md = readFileSync(join(repo, 'docs/mapping.md'), 'utf8');
    const errors = checkMapping(md, { roots, readTs: (p) => readFileSync(join(repo, p), 'utf8') });

    // Every TS test file under test/ (outside extras, interop, system, scripts) must have a mapping row.
    const mapped = new Set(tableRows(md, 'Tests').map((r) => r[1]));
    const walk = (dir) =>
        readdirSync(join(repo, dir)).flatMap((f) => {
            const p = `${dir}/${f}`;
            return statSync(join(repo, p)).isDirectory() ? walk(p) : [p];
        });
    for (const f of walk('test')) {
        if (!f.endsWith('.test.ts') || /^test\/(extra|interop|system|scripts|golden)\//.test(f)) continue;
        if (!mapped.has(f)) errors.push(`${f}: no row in docs/mapping.md`);
    }

    if (errors.length > 0) {
        for (const e of errors) console.error(e);
        process.exit(1);
    }
    console.log(`test mapping ok (${mapped.size} files)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
