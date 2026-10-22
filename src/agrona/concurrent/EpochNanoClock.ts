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
// Port of org/agrona/concurrent/EpochNanoClock.java @ Agrona 2.6.1
/**
 * Clock representing the time in nanoseconds since 1 Jan 1970 UTC.
 * <p>
 * The value is a {@code number} (spec D5), but the nanoseconds since the epoch (about 1.8e18) are above 2^53, so a
 * clock cannot return them exactly: see {@link SystemEpochNanoClock} for the granularity (spec D17).
 */
export interface EpochNanoClock {
    /**
     * Time in nanoseconds since 1 Jan 1970 UTC.
     *
     * @return the number of nanoseconds since 1 Jan 1970 UTC.
     */
    nanoTime(): number;

    /** Addition (spec D17): the exact nanoTime() as the two int halves of the Java long, out[0] = low, out[1] = high. No allocation. */
    nanoTimeHalves(out: Int32Array): void;
}

const TWO_21 = 2097152;
const TWO_11 = 2048;

/** Writes ms * 1e6 + subNs (ms a safe integer in [0, 2^41), subNs in [0, 1e6)) exactly into out as [lo, hi]. */
export function epochNanosHalves(ms: number, subNs: number, out: Int32Array): void {
    const msHi = Math.floor(ms / TWO_21);
    const msLo = ms - msHi * TWO_21;
    const b = msLo * 1e6 + subNs;
    const bHi = Math.floor(b / TWO_21);
    const bLo = b - bHi * TWO_21;
    const c = msHi * 1e6 + bHi;
    const hi = Math.floor(c / TWO_11);
    out[0] = ((c - hi * TWO_11) * TWO_21 + bLo) | 0;
    out[1] = hi | 0;
}
