// The layout of the SharedArrayBuffer and the sequence of the writer that SharedAtomicsExtraTest and its worker script
// (SharedAtomics.worker.ts) share. Plain numbers and functions only, so that a worker can import it.

/** Byte indexes in the shared buffer. */
export const BARRIER = 0;
export const COUNTER = 8;
export const SHORT_SLOTS = 16; // 4 shorts, one per worker
export const SEQ = 64; // the sequence int of the sequence lock
export const VALUE = 68; // the two 8 byte slots of the sequence lock, 68..84: a multiple of 4 and not of 8, to use the int halves
export const PROGRESS = 88; // the number of values the writer has written
export const DONE = 92;
export const CAPACITY = 128;

export const TWO_POW_32 = 4294967296;

/** The writer visits the boundaries m * 2^32 for m in [0, BOUNDARIES), and writes B - 3 ... B + 3 around each. */
export const BOUNDARIES = 256;
export const PASSES = 400;

/** The number of values in one pass: B = 0 has no negative side. */
export const PASS_LENGTH = 4 + (BOUNDARIES - 1) * 7;

/** The value written at position `index` of a pass. */
export function valueAt(index: number): number {
    if (index < 4) {
        return index;
    }
    const m = 1 + Math.floor((index - 4) / 7);
    return m * TWO_POW_32 + ((index - 4) % 7) - 3;
}

/** The position in a pass of `value`, or -1 when the writer never writes it. */
export function indexOf(value: number): number {
    const m = Math.round(value / TWO_POW_32);
    const d = value - m * TWO_POW_32;
    if (m < 0 || m >= BOUNDARIES || d < -3 || d > 3 || (0 === m && d < 0)) {
        return -1;
    }
    return 0 === m ? d : 4 + (m - 1) * 7 + (d + 3);
}
