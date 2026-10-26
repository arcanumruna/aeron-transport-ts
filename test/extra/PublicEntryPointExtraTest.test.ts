// Tests the port adds (issue #7): the package has one entry point, `src/index.ts`, listed in `package.json` `exports`,
// and the built declarations carry no `@internal` member (`stripInternal` in tsconfig.build.json).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../../src/index.js';

const ROOT = new URL('../../', import.meta.url).pathname;

interface Json {
    main?: string;
    types?: string;
    exports: Record<string, unknown>;
    compilerOptions: { stripInternal?: boolean };
}

function read(path: string): Json {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Json;
}

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

describe('PublicEntryPointExtraTest', () => {
    it('theEntryPointExportsTheClientAndDriverApiRegression', () => {
        for (const name of [
            'Aeron',
            'AeronContext',
            'MediaDriver',
            'MediaDriverContext',
            'ConcurrentPublication',
            'ExclusivePublication',
            'Publication',
            'Subscription',
            'Image',
            'ChannelUri',
            'ChannelUriStringBuilder',
            'BufferClaim',
            'Header',
            'FragmentAssembler',
            'ControlledFragmentAssembler',
            'ControlledFragmentHandler',
            'UnsafeBuffer',
            'BackoffIdleStrategy',
            'AeronException',
            'DriverTimeoutException',
        ]) {
            expect(api, name).toHaveProperty(name);
            expect(typeof (api as Record<string, unknown>)[name], name).not.toBe('undefined');
        }
    });

    it('packageJsonExportsTheEntryPointWithTypesRegression', () => {
        const pkg = read('package.json');
        expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
        expect(pkg.main).toBe('./dist/index.js');
        expect(pkg.types).toBe('./dist/index.d.ts');
        expect(read('tsconfig.build.json').compilerOptions.stripInternal).toBe(true);
    });

    it('theBuiltDeclarationsHaveNoInternalMemberRegression', () => {
        const out = mkdtempSync(join(tmpdir(), 'aeron-ts-build-'));
        try {
            execFileSync(
                process.execPath,
                [
                    join(ROOT, 'node_modules/typescript/bin/tsc'),
                    '-p',
                    join(ROOT, 'tsconfig.build.json'),
                    '--outDir',
                    out,
                ],
                { cwd: ROOT, stdio: 'pipe' },
            );
            expect(statSync(join(out, 'index.d.ts')).isFile()).toBe(true);
            expect(statSync(join(out, 'index.js')).isFile()).toBe(true);
            const map = readFileSync(join(out, 'agrona/collections/Int2ObjectHashMap.d.ts'), 'utf8');
            expect(map).not.toMatch(/\b_keys\b/);
            expect(map).toMatch(/class Int2ObjectHashMap\b/);
            for (const file of files(out).filter((f) => f.endsWith('.d.ts'))) {
                expect(readFileSync(file, 'utf8'), file).not.toContain('@internal');
            }
        } finally {
            rmSync(out, { recursive: true, force: true });
        }
    }, 120_000);
});
