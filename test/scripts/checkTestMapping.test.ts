import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkMapping, javaTestNames, tsTestTitles } from '../../scripts/check-test-mapping.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (path: string): string => readFileSync(join(fixtures, path), 'utf8');

const JAVA_ROW = '| `fx:pkg/SampleTest.java` | `ts/Sample.test.ts` | 4 | 4 | |';
const BASE_ROW = '| `fx:pkg/BaseTests.java` | `ts/BaseTests.ts` | 1 | 1 | base |';
const SKIP_ROW = '| `ts/Sample.test.ts` | shouldDoC | Disabled in Aeron |';

function mapping(testRows: string[], skipRows: string[]): string {
    return [
        '## Tests',
        '| Java test | TypeScript test | Java | TS | Notes |',
        '|---|---|---|---|---|',
        ...testRows,
        '',
        '## Skipped tests',
        '| TypeScript test | Test | Reason |',
        '|---|---|---|',
        ...skipRows,
        '',
    ].join('\n');
}

function run(md: string, overrides: Record<string, string> = {}): string[] {
    return checkMapping(md, {
        roots: { fx: join(fixtures, 'java') },
        readTs: (path: string) => overrides[path] ?? read(path),
    });
}

describe('checkTestMapping', () => {
    it('collects Java test names including inherited ones', () => {
        const names = javaTestNames(join(fixtures, 'java/pkg/SampleTest.java'));
        expect(names.own).toEqual(['shouldDoA', 'shouldDoB', 'shouldDoC']);
        expect(names.base).toBe('BaseTests');
    });

    it('collects Java test names whose annotations span several lines', () => {
        const names = javaTestNames(join(fixtures, 'java/pkg/MultiLineAnnotationTest.java'));
        expect(names.own).toEqual(['alignWithLongValues', 'isX64ArchSystemTest']);
    });

    it('collects Java test names declared on the line of the annotation and after a comment', () => {
        const names = javaTestNames(join(fixtures, 'java/pkg/OneLineAnnotationTest.java'));
        expect(names.own).toEqual(['shouldA', 'shouldB', 'shouldC', 'shouldD', 'shouldE']);
    });

    it('collects TS titles of it.each with a type argument', () => {
        const src =
            "it.each<[string, bigint]>([['a', 1n]])('shouldDoA %s', () => {});\nit.skip.each<number>([1])('shouldDoB %s', () => {});";
        expect(tsTestTitles(src)).toEqual([
            { name: 'shouldDoA', skip: false },
            { name: 'shouldDoB', skip: true },
        ]);
    });

    it('collects TS titles of it.for like it.each', () => {
        const src =
            "it.for(['a', 'b'])('shouldDoA %s', (row, { skip }) => {});\nit.skip.for<number>([1])('shouldDoB %s', () => {});";
        expect(tsTestTitles(src)).toEqual([
            { name: 'shouldDoA', skip: false },
            { name: 'shouldDoB', skip: true },
        ]);
    });

    it('collects TS titles, it.each prefixes and skips', () => {
        const titles = tsTestTitles(read('ts/Sample.test.ts'));
        expect(titles.map((t) => t.name)).toEqual(['shouldDoA', 'shouldDoB', 'shouldDoC']);
        expect(titles.filter((t) => t.skip).map((t) => t.name)).toEqual(['shouldDoC']);
    });

    it('passes when names, counts and skips match', () => {
        expect(run(mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW]))).toEqual([]);
    });

    it('fails on a Java test with no TS test', () => {
        const ts = read('ts/Sample.test.ts').replace("it('shouldDoA', () => {});", '');
        const errors = run(mapping([BASE_ROW, JAVA_ROW.replace('| 4 | 4 |', '| 4 | 3 |')], [SKIP_ROW]), {
            'ts/Sample.test.ts': ts,
        });
        expect(errors.join('\n')).toContain('missing TS test shouldDoA');
    });

    it('fails on a TS test with no Java test', () => {
        const ts = read('ts/Sample.test.ts').replace("it('shouldDoA'", "it('shouldDoX'");
        expect(run(mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW]), { 'ts/Sample.test.ts': ts }).join('\n')).toContain(
            'TS test shouldDoX has no Java test',
        );
    });

    it('fails when an inherited base test is not pulled in', () => {
        const ts = read('ts/Sample.test.ts').replace('baseTests();', '');
        expect(run(mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW]), { 'ts/Sample.test.ts': ts }).join('\n')).toContain(
            'missing TS test shouldDoBaseThing',
        );
    });

    it('fails when the recorded counts are stale', () => {
        expect(run(mapping([BASE_ROW, JAVA_ROW.replace('| 4 | 4 |', '| 5 | 4 |')], [SKIP_ROW])).join('\n')).toContain(
            'Java count is 4, mapping says 5',
        );
    });

    it('fails on a skip missing from the skip table', () => {
        expect(run(mapping([BASE_ROW, JAVA_ROW], [])).join('\n')).toContain('skipped test shouldDoC is not listed');
    });

    it('fails on a skip table row with no skipped test', () => {
        const extra = '| `ts/Sample.test.ts` | shouldDoA | wrong |';
        expect(run(mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW, extra])).join('\n')).toContain(
            'listed skip shouldDoA is not an it.skip',
        );
    });

    describe('Sources table', () => {
        const sources = (rows: string[]): string =>
            ['## Sources', '| Java source | TypeScript source | Notes |', '|---|---|---|', ...rows, ''].join('\n') +
            mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW]);
        const exists = (present: string[]) => (path: string) => present.includes(path);
        const runWith = (md: string, fileExists: (path: string) => boolean): string[] =>
            checkMapping(md, { roots: { fx: join(fixtures, 'java') }, readTs: read, fileExists });

        it('passes when every TypeScript file of a row exists', () => {
            const md = sources([
                '| `aeron:a/A.java` | `src/client/A.ts` | note |',
                '| (no Java file) | `test/support/B.ts`, `test/support/C.ts` | helpers |',
            ]);
            expect(runWith(md, exists(['src/client/A.ts', 'test/support/B.ts', 'test/support/C.ts']))).toEqual([]);
        });

        it('fails on a row that points at a file that does not exist, such as a deleted stand-in', () => {
            const md = sources([
                '| `aeron:a/A.java` | `src/client/A.ts` | note |',
                '| (none) | `src/client/ChannelUriLogBuffer.ts` | Stand-in until T9 |',
            ]);
            expect(runWith(md, exists(['src/client/A.ts']))).toEqual([
                'src/client/ChannelUriLogBuffer.ts: Sources row for (none) points at a missing file',
            ]);
        });

        it('fails on each missing file of a row that names several', () => {
            const md = sources(['| (no Java file) | `test/support/B.ts`, `test/support/C.ts` | helpers |']);
            expect(runWith(md, exists(['test/support/B.ts'])).join('\n')).toContain('test/support/C.ts');
        });
    });

    describe('unmapped Java tests (issue 5)', () => {
        const sourcesWith = (notPorted: string[]): string =>
            [
                '## Sources',
                '| Java source | TypeScript source | Notes |',
                '|---|---|---|',
                '| `fx:src/main/java/Widget.java` | `src/Widget.ts` | note |',
                '',
                '## Not ported',
                '| Java member | Reason |',
                '|---|---|',
                ...notPorted,
                '',
            ].join('\n') + mapping([BASE_ROW, JAVA_ROW], [SKIP_ROW]);
        const runWith = (md: string, javaTests: string[]): string[] =>
            checkMapping(md, {
                roots: { fx: join(fixtures, 'java') },
                readTs: read,
                findJavaTest: (_prefix: string, name: string) => javaTests.includes(name),
            });

        it('fails a Sources row whose Java test has neither a Tests row nor a Not ported row Regression', () => {
            expect(runWith(sourcesWith([]), ['WidgetTest']).join('\n')).toContain('WidgetTest.java');
        });

        it('passes when the Not ported table names the test', () => {
            expect(runWith(sourcesWith(['| `WidgetTest` (3) | reason |']), ['WidgetTest'])).toEqual([]);
        });

        it('passes when there is no Java test for the source', () => {
            expect(runWith(sourcesWith([]), [])).toEqual([]);
        });
    });
});
