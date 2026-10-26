// The randomness of a simulated run (phase 3, T11, D117): the network draws its faults from the seed, but the drivers draw their
// own: the ids of sessions and registrations (`ThreadLocalRandom.nextInt`, over `Math.random`), the delay of a multicast nak
// (`ThreadLocalRandom.nextDouble`, an xorshift generator of its own) and the id of a receiver (`crypto.randomBytes`). A failing
// seed is a repro only if those are fixed too: `seedDriverRandomness` fixes the first two from the seed, and
// `randomBytesHook` is what a test that mocks `node:crypto` (see `MultiDestinationLossPropertiesTest`) calls for the third.
import { vi } from 'vitest';
import { ThreadLocalRandom } from '../../src/agrona/jdk.js';
import { mulberry32 } from './Random.js';

/** The `randomBytes` of the run, or null for the real one. */
export const randomBytesHook: { fn: ((size: number) => Buffer) | null } = { fn: null };

interface XorShiftState {
    s0: number;
    s1: number;
    s2: number;
    s3: number;
}

/** Fixes the randomness of the drivers from the seed. Returns the function that puts it back. */
export function seedDriverRandomness(seed: number): () => void {
    const random = mulberry32(seed * 6151 + 29);
    const spy = vi.spyOn(Math, 'random').mockImplementation(random);

    const state = ThreadLocalRandom.current() as unknown as XorShiftState;
    const saved: XorShiftState = { s0: state.s0, s1: state.s1, s2: state.s2, s3: state.s3 };
    const word = (): number => Math.floor(random() * 4_294_967_296) | 0;
    state.s0 = word() | 1;
    state.s1 = word();
    state.s2 = word();
    state.s3 = word();

    randomBytesHook.fn = (size: number): Buffer => {
        const bytes = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
            bytes[i] = Math.floor(random() * 256);
        }
        return bytes;
    };

    return () => {
        spy.mockRestore();
        Object.assign(state, saved);
        randomBytesHook.fn = null;
    };
}
