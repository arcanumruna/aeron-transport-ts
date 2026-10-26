// Deterministic simulation of T22 (port-only, spec 8.2, 8.4): the stream crosses many terms, from an initial term id of the
// seed (near the maximum int, negative, or anywhere), at an offset of the seed in a term of the seed, over an in-memory network
// with a seeded fault model. 200 seeds. Produced equals consumed, and both ends are at the same position, which is the
// start plus the aligned frames of the messages plus the padding at the end of each term.
import { describe, expect, it } from 'vitest';
import { Consumed, lengths, plan, sequences } from '../../support/SystemRig.js';
import { mulberry32 } from '../../support/Random.js';
import { SimWorld } from '../../support/SimWorld.js';
import {
    SEEDS,
    addStream,
    awaitConnected,
    carry,
    faultModelOf,
    mixedLengths,
    seedsOf,
} from '../../support/SimScenario.js';

const TERM_LENGTH = 65536;
const MAX_MESSAGE = TERM_LENGTH / 8;

function frameLength(length: number): number {
    return Math.ceil((length + 32) / 32) * 32;
}

/** The position after the messages, from `startOffset` in a term: frames do not straddle terms, a padding frame fills the rest. */
function endOffsetOf(startOffset: number, sizes: readonly number[]): { terms: number; offset: number } {
    let offset = startOffset;
    let terms = 0;
    for (const size of sizes) {
        const frames = framesOf(size);
        if (offset + frames.firstFrame > TERM_LENGTH) {
            terms++;
            offset = 0;
        }
        // a message of many frames is appended whole: it needs the rest of the term, or a padding frame and the next term
        const needed = frames.total;
        if (offset + needed > TERM_LENGTH) {
            terms++;
            offset = 0;
        }
        offset += needed;
        if (offset === TERM_LENGTH) {
            terms++;
            offset = 0;
        }
    }
    return { terms, offset };
}

function framesOf(length: number): { firstFrame: number; total: number } {
    const maxPayload = 1408 - 32;
    const fragments = Math.ceil(length / maxPayload);
    let total = 0;
    for (let i = 0; i < fragments; i++) {
        const payload = i === fragments - 1 ? length - maxPayload * (fragments - 1) : maxPayload;
        total += frameLength(payload);
    }
    return { firstFrame: frameLength(Math.min(length, maxPayload)), total };
}

describe('Netsim term rotation', () => {
    it('theStreamCrossesTermsFromAnyInitialTermIdUnderFaults', () => {
        for (const seed of seedsOf(SEEDS)) {
            const random = mulberry32(seed * 31 + 5);
            const world = new SimWorld(seed, faultModelOf(seed, 0.8));
            try {
                // the initial term id: near the maximum (the stream wraps), negative, or any other
                const kind = seed % 4;
                const initialTermId =
                    0 === kind
                        ? 2147483647 - Math.floor(random() * 6)
                        : 1 === kind
                          ? -1 - Math.floor(random() * 6)
                          : Math.floor(random() * 4294967296) | 0;
                const termsAhead = Math.floor(random() * 3);
                const termId = (initialTermId + termsAhead) | 0;
                const termOffset = Math.floor((random() * (TERM_LENGTH - 2048)) / 32) * 32;
                const startPosition = termsAhead * TERM_LENGTH + termOffset;

                const publisher = world.addNode();
                const subscriber = world.addNode();
                const { publication, subscription } = addStream(world, publisher, subscriber, 1 === seed % 2, {
                    sessionId: 77 + seed,
                    initialTermId,
                    termId,
                    termOffset,
                });
                expect(publication.position()).toBe(startPosition);
                awaitConnected(world, publication, subscription);
                expect(subscription.imageAtIndex(0).joinPosition()).toBe(startPosition);

                // sizes of a few frames at most: about 5 terms of data
                const sizes = mixedLengths(seed, 400, 3000).map((size) => Math.min(size, 3000));
                const work = plan(0, sizes.length, (sequence) => sizes[sequence] as number);
                const { consumed } = carry(world, publication, subscription, work, MAX_MESSAGE, new Consumed());

                const end = endOffsetOf(termOffset, sizes);
                expect(consumed.problems).toEqual([]);
                expect(consumed.sequences).toEqual(sequences(0, sizes.length));
                expect(consumed.lengths).toEqual(lengths(work));
                expect(end.terms + termsAhead).toBeGreaterThanOrEqual(3);
                expect(publication.position()).toBe((termsAhead + end.terms) * TERM_LENGTH + end.offset);
                expect(subscription.imageAtIndex(0).position()).toBe(publication.position());
                expect(publisher.errors.map(String)).toEqual([]);
                expect(subscriber.errors.map(String)).toEqual([]);
            } catch (ex) {
                throw new Error('seed ' + seed + ': ' + (ex as Error).message, { cause: ex });
            } finally {
                world.close();
            }
        }
    }, 120_000);
});
