#!/usr/bin/env node
// Builds the C helpers of the interop suite (T23) against the Aeron C 1.53.3 client library.
//
//   node test/interop/build-c.mjs
//
// Environment:
//   AERON_C_BUILD  CMake build directory of Aeron 1.53.3 (default: .refs/aeron/build). Needs binaries/aeronmd and
//                  lib/libaeron.so.
//   AERON_C_SRC    The Aeron checkout that holds the C client headers (default: the parent of AERON_C_BUILD when it
//                  is a checkout, else .refs/aeron).
//   CC             The C compiler (default: cc).
//
// Output: test/interop/c/.build/interop_publisher and interop_subscriber (untracked), linked to libaeron.so with an
// rpath, so they run without LD_LIBRARY_PATH. Exit code 2 when the C build is missing (the interop suite skips then).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const build = resolve(process.env.AERON_C_BUILD ?? join(root, '.refs', 'aeron', 'build'));
const checkout = join(root, '.refs', 'aeron');
const source = resolve(
    process.env.AERON_C_SRC ?? (existsSync(join(build, '..', 'aeron-client')) ? join(build, '..') : checkout),
);
const headers = join(source, 'aeron-client', 'src', 'main', 'c');
const lib = join(build, 'lib');
const outDir = join(root, 'test', 'interop', 'c', '.build');
const srcDir = join(root, 'test', 'interop', 'c');

if (!existsSync(join(build, 'binaries', 'aeronmd')) || !existsSync(join(lib, 'libaeron.so'))) {
    console.error('build-c: no Aeron C build in ' + build + ' (binaries/aeronmd and lib/libaeron.so are needed)');
    process.exit(2);
}

mkdirSync(outDir, { recursive: true });
for (const name of ['interop_publisher', 'interop_subscriber']) {
    const args = [
        '-std=gnu11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Wno-unused-parameter',
        '-I' + headers,
        '-I' + srcDir,
        join(srcDir, name + '.c'),
        '-L' + lib,
        '-laeron',
        '-Wl,-rpath,' + lib,
        '-o',
        join(outDir, name),
    ];
    const result = spawnSync(process.env.CC ?? 'cc', args, { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error('build-c: ' + name + ' failed');
        process.exit(result.status ?? 1);
    }
}

console.log('build-c: built the helpers in ' + outDir);
