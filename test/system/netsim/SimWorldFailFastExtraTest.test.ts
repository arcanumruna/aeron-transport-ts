// Tests the port adds (issue #49): a netsim scenario on a broken build fails within a few steps, not at the step cap.
// A node's error handler is fed by the driver and the client conductor; every netsim scenario asserts that no node had
// an error, so the world fails at the first one, naming it.
import { describe, expect, it } from 'vitest';
import { MAX_STALLED_STEPS, MAX_STEPS, SimWorld } from '../../support/SimWorld.js';
import { faultModelOf } from '../../support/SimScenario.js';

describe('SimWorldFailFastExtraTest', () => {
    it('runFailsAtOnceWhenANodeHasAnErrorRegression', () => {
        const world = new SimWorld(1, faultModelOf(1));
        try {
            const node = world.addNode();
            world.run(() => world.steps >= 3, 'three steps');
            node.errors.push(new Error('boom in a duty cycle'));
            const before = world.steps;
            expect(() => world.run(() => false, 'a stream that never comes')).toThrow(/boom in a duty cycle/);
            expect(world.steps - before).toBeLessThanOrEqual(1);
        } finally {
            world.close();
        }
    });

    it('runForFailsAtOnceWhenANodeHasAnErrorRegression', () => {
        const world = new SimWorld(1, faultModelOf(1));
        try {
            const node = world.addNode();
            node.errors.push(new Error('boom while idle'));
            expect(() => world.runFor(60_000_000_000)).toThrow(/boom while idle/);
            expect(world.steps).toBeLessThanOrEqual(1);
        } finally {
            world.close();
        }
    });

    it('runFailsWhenTheProgressProbeStandsStillRegression', () => {
        const world = new SimWorld(1, faultModelOf(1));
        try {
            world.addNode();
            expect(() =>
                world.run(
                    () => false,
                    'a stream that is stuck',
                    MAX_STEPS,
                    () => 7,
                ),
            ).toThrow(/no a stream that is stuck: no progress for 8000 steps/);
            expect(world.steps).toBeLessThanOrEqual(MAX_STALLED_STEPS);
        } finally {
            world.close();
        }
    });

    it('aProgressProbeThatMovesDoesNotStopTheRunRegression', () => {
        const world = new SimWorld(1, faultModelOf(1));
        try {
            world.addNode();
            expect(
                world.run(
                    () => world.steps >= MAX_STALLED_STEPS * 2,
                    'twice the stall',
                    MAX_STEPS,
                    () => world.steps,
                ),
            ).toBe(MAX_STALLED_STEPS * 2);
        } finally {
            world.close();
        }
    });

    it('aWorldWithoutErrorsStillRunsRegression', () => {
        const world = new SimWorld(1, faultModelOf(1));
        try {
            world.addNode();
            expect(world.run(() => world.steps >= 10, 'ten steps')).toBe(10);
            world.runFor(5_000_000);
        } finally {
            world.close();
        }
    });
});
