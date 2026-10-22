/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port-only (spec D16), no Java counterpart
import { getEnvironmentData, isMainThread, setEnvironmentData } from 'node:worker_threads';

/**
 * The striped lock table behind the 64-bit atomics of `UnsafeBuffer` on a `SharedArrayBuffer` (spec D16). JavaScript has
 * no allocation-free 64-bit atomic, so a `long` is guarded by a stripe, as the JVM does on CPUs without 64-bit atomics:
 * a sequence lock in a table outside the data. The table is one process-wide `SharedArrayBuffer`, created by the main
 * thread when this module loads and handed to every worker through `worker_threads` environment data (nested workers
 * inherit it).
 * <p>
 * A stripe is an `int` that is even when free and odd while a writer holds it; a writer adds two on release, so a reader
 * can tell that a write happened between two loads.
 */
export class LongStripes {
    /** Number of stripes, a power of two. */
    public static readonly STRIPE_COUNT = 1024;

    /** Ints per stripe: one stripe per 64-byte cache line, against false sharing. */
    public static readonly STRIPE_STRIDE = 16;

    /** Key of the table in worker_threads environment data. */
    public static readonly ENVIRONMENT_KEY = 'aeron-transport-ts.LongStripes';

    /** Length of the table in bytes. */
    public static readonly TABLE_LENGTH = LongStripes.STRIPE_COUNT * LongStripes.STRIPE_STRIDE * 4;

    /**
     * The table of this thread, or null in a worker that was given none.
     *
     * @return the table.
     */
    public static table(): Int32Array | null {
        return TABLE;
    }

    /**
     * Index into {@link table} of the stripe guarding the long at an absolute byte address.
     *
     * @param address of the long, a multiple of 8.
     * @return a multiple of {@link STRIPE_STRIDE} in [0, 16368].
     */
    public static stripe(address: number): number {
        return (Math.imul(address >>> 3, 0x9e3779b1 | 0) >>> 22) << 4; // top 10 bits, times STRIPE_STRIDE
    }
}

function initialise(): Int32Array | null {
    if (isMainThread) {
        const table = new Int32Array(new SharedArrayBuffer(LongStripes.TABLE_LENGTH));
        setEnvironmentData(LongStripes.ENVIRONMENT_KEY, table.buffer);
        return table;
    }

    const shared: unknown = getEnvironmentData(LongStripes.ENVIRONMENT_KEY);
    return shared instanceof SharedArrayBuffer && shared.byteLength === LongStripes.TABLE_LENGTH
        ? new Int32Array(shared)
        : null;
}

const TABLE = initialise();
