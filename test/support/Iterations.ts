// The 1,000,000- and 10,000,000-iteration loops of the Java tests run 100 times fewer iterations unless
// AERON_TS_FULL_ITERATIONS is set (the Node 24 CI job sets it). Tests divide Java's iteration count by this.
export const ITERATIONS_SCALE = process.env.AERON_TS_FULL_ITERATIONS ? 1 : 100;

/** The timeout of a test with one of those loops: the vitest default is 10 s, too short for the full counts. */
export const ROUND_TRIP_TIMEOUT_MS = ITERATIONS_SCALE === 1 ? 180_000 : 30_000;
