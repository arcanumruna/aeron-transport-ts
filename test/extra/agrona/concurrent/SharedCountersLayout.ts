// The shared layout of SharedCountersExtraTest and SharedCounters.worker.ts: counter 0 of a counters buffer, then two
// ints after it for the workers.
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';

export const COUNTER_ID = 0;
export const BARRIER = 2 * CountersReader.COUNTER_LENGTH;
export const DONE = BARRIER + 4;
export const CAPACITY = 2 * CountersReader.COUNTER_LENGTH + 64;

/** The writer increments the counter WRITES times from START, across the 2^32 boundary. */
export const WRITES = 1_000_000;
export const START = 2 ** 32 - 500_000;
export const READERS = 3;

/**
 * The stepping writer sets the counter to k * STEP for k = 1 .. STEPS: both halves change on every write, and the low
 * half crosses a 2^32 boundary each time. A read is whole only if its high half equals its low half.
 */
export const STEP = 2 ** 32 + 1;
export const STEPS = 1_000_000;
