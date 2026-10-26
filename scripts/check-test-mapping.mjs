// Checks that every mapped Aeron/Agrona JUnit test has a vitest test with the same name, and the reverse.
// Reads the "Tests" and "Skipped tests" tables of docs/mapping.md (spec §8.1).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHOD = /^\s*(?:(?:public|protected|private|static|final|synchronized)\s+)*[\w<>[\],\s]+?\s+(\w+)\s*\(/;

const TEST_NAME = /^(?:[\w.]+\.)?(Test|ParameterizedTest|RepeatedTest|TestTemplate)$/;

/**
 * Consumes the annotations at the start of a line (`@Test`, `@ValueSource(ints = { 1 })`), including one whose
 * parentheses stay open at the end of the line.
 * @returns the rest of the line, whether a test annotation was seen, and the parentheses still open
 */
function consumeAnnotations(line) {
    let i = 0;
    let isTest = false;
    for (;;) {
        while (/\s/.test(line[i] ?? '')) i++;
        if (line[i] !== '@') break;
        const name = /^@([\w.]+)/.exec(line.slice(i));
        if (!name) break;
        if (TEST_NAME.test(name[1])) isTest = true;
        i += name[0].length;
        while (/\s/.test(line[i] ?? '')) i++;
        if (line[i] === '(') {
            let depth = 0;
            for (; i < line.length; i++) {
                const c = line[i];
                if (c === '"' || c === "'") i = skipString(line, i) - 1;
                else if (c === '(') depth++;
                else if (c === ')' && --depth === 0) {
                    i++;
                    break;
                }
            }
            if (depth > 0) return { rest: '', isTest, open: depth };
        }
    }
    return { rest: line.slice(i), isTest, open: 0 };
}

/** Test method names declared in a Java test file, and the simple name of the class it extends (if any). */
export function javaTestNames(path) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const own = [];
    let pending = false;
    let open = 0; // unclosed parentheses of a multi-line annotation such as @CsvSource({ ... })
    for (const line of lines) {
        if (open > 0) {
            const code = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
            open = Math.max(0, open + (code.match(/\(/g) ?? []).length - (code.match(/\)/g) ?? []).length);
            continue;
        }
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue; // a comment line between the annotation and the method
        const { rest, isTest, open: stillOpen } = consumeAnnotations(line);
        open = stillOpen;
        if (isTest) pending = true;
        if (pending && rest.trim() !== '') {
            const m = METHOD.exec(rest);
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

/**
 * `it` titles in a TS test file: name (title up to the first space), and whether it is skipped. `it.each` and `it.for` (vitest's
 * `each` whose callback also gets the test context, so that a row can `skip`) take the table first and the title in the
 * call that follows.
 */
export function tsTestTitles(src) {
    const out = [];
    const re = /\bit((?:\.(?:skip|only|todo|each|for|fails))*)\s*(?:<[^()]*>)?\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const mods = m[1];
        let open = m.index + m[0].length - 1;
        if (mods.includes('.each') || mods.includes('.for')) {
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
 * @param opts.fileExists optional: whether a repo-relative path exists; when given, every TS file named in the
 *        "Sources" table must exist
 * @param opts.findJavaTest optional: whether the Java test `<name>` exists under the source root `prefix`; when given,
 *        every Sources row with such a test needs a Tests row or a Not-ported row
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
    // The shared suite functions a TS test file calls: `export function x` of a module it imports from `./Y.js` that is
    // not itself a `.test.ts` file (such as `MapKeyEqualityTests.ts` or `Int2ObjectHashMapTestSuite.ts`).
    const suitesOf = (cell) => {
        const src = opts.readTs(cell);
        const dir = cell.slice(0, cell.lastIndexOf('/') + 1);
        const out = [];
        for (const m of src.matchAll(/from '\.\/(\w+)\.js'/g)) {
            const path = `${dir}${m[1]}.ts`;
            let text;
            try {
                text = opts.readTs(path);
            } catch {
                continue; // a source module, not a test module
            }
            const fn = /export function (\w+)/.exec(text)?.[1];
            if (fn && new RegExp(`\\b${fn}\\s*\\(`).test(src.replace(m[0], ''))) out.push({ path, fn });
        }
        return out;
    };
    const tsAll = (cell) => {
        const java = rows.find((r) => r[1] === cell)?.[0];
        let titles = tsTestTitles(opts.readTs(cell));
        const base = java ? javaTestNames(javaPath(java)).base : undefined;
        const b = base ? byBase.get(base) : undefined;
        // A suite of the Java base class is counted through the base below, not twice.
        const baseFiles = b ? [b.ts, ...suitesOf(b.ts).map((x) => x.path)] : [];
        for (const { path } of suitesOf(cell))
            if (!baseFiles.includes(path)) titles = [...tsTestTitles(opts.readTs(path)), ...titles];
        if (b) {
            // The TS subclass must call the shared base function; its titles count only if it does.
            const src = opts.readTs(cell);
            const fns = [b.ts, ...suitesOf(b.ts).map((x) => x.path)].map(
                (p) => /export function (\w+)/.exec(opts.readTs(p))?.[1],
            );
            if (fns.some((fn) => fn && new RegExp(`\\b${fn}\\s*\\(`).test(src))) titles = [...tsAll(b.ts), ...titles];
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

    // Every TS file in the "Sources" table must exist (a deleted file must lose its row).
    if (opts.fileExists) {
        for (const [java, ts] of tableRows(md, 'Sources')) {
            for (const path of ts.match(/(?:src|test|scripts)\/[\w./-]+/g) ?? [])
                if (!opts.fileExists(path)) errors.push(`${path}: Sources row for ${java} points at a missing file`);
        }
    }

    // Every Sources row whose `<Name>Test.java` exists in the Java test tree needs a Tests row or a "Not ported" row
    // that names the test.
    if (opts.findJavaTest) {
        const testsMapped = new Set(rows.map(([java]) => java.slice(java.lastIndexOf('/') + 1).replace(/\.java$/, '')));
        const notPorted = tableRows(md, 'Not ported')
            .map(([member]) => member ?? '')
            .join('\n');
        for (const [java] of tableRows(md, 'Sources')) {
            const m = /^(\w+):.*\/(\w+)\.java$/.exec(java);
            if (!m || m[2].endsWith('Test')) continue;
            const test = `${m[2]}Test`;
            if (!opts.findJavaTest(m[1], test)) continue;
            if (!testsMapped.has(test) && !new RegExp(`\\b${test}\\b`).test(notPorted))
                errors.push(`${test}.java: Java test of the ported ${m[2]} has no Tests row and no "Not ported" row`);
        }
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

/** Whether a file called `name` exists under `dir`, in a path that has a `src/<kind>` segment (skips `.git` and build output). */
function hasFile(dir, name, kind) {
    for (const f of readdirSync(dir)) {
        if (f === '.git' || f === 'build' || f === 'node_modules') continue;
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
            if (hasFile(p, name, kind)) return true;
        } else if (f === name && p.includes(`/src/${kind}/`)) return true;
    }
    return false;
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
    const errors = checkMapping(md, {
        roots,
        readTs: (p) => readFileSync(join(repo, p), 'utf8'),
        fileExists: (p) => existsSync(join(repo, p)),
        findJavaTest: (prefix, name) => hasFile(roots[prefix], `${name}.java`, 'test'),
    });

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
