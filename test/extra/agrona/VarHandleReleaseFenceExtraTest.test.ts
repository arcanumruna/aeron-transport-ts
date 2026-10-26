// Not in Agrona: VarHandle.releaseFence() is the empty function on x64 and a sequentially consistent Atomics
// read-modify-write on every other architecture (spec D21), chosen once at module load.
import { describe, expect, it } from 'vitest';
import { RELEASE_FENCE_IS_NO_OP, VarHandle } from '../../../src/agrona/jdk.js';

describe('VarHandleReleaseFenceExtraTest', () => {
    it('theFlagFollowsTheArchitecture', () => {
        expect(RELEASE_FENCE_IS_NO_OP).toBe('x64' === process.arch);
    });

    it('releaseFenceIsTheNoOpOnX64AndTheAtomicsFormOtherwise', () => {
        const text = VarHandle.releaseFence.toString();
        if ('x64' === process.arch) {
            expect(text).not.toContain('Atomics');
            expect(VarHandle.releaseFence).toHaveLength(0);
        } else {
            expect(text).toContain('Atomics.add(FENCE, 0, 0)');
        }
    });

    it('releaseFenceReturnsNothingAndIsStable', () => {
        expect(VarHandle.releaseFence()).toBeUndefined();
        expect(VarHandle.releaseFence).toBe(VarHandle.releaseFence);
    });
});
