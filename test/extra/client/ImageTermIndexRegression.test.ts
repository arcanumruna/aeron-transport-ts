// Regression tests of issue #82 (port-only, spec D137): the image reads its position as two `int` halves and works out
// the index of the active term with `int` arithmetic, so that no position above 2^31 is formed as a double. The index
// must equal `LogBufferDescriptor.indexByPosition` for every term length and every position, and the halves must be
// the same from the default `Position.getHalves` and from the counter of an `UnsafeBufferPosition`.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { Image } from '../../../src/client/Image.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';

const { indexByPosition, positionBitsToShift, TERM_MIN_LENGTH, TERM_MAX_LENGTH } = LogBufferDescriptor;
const TWO_TO_32 = 4294967296;
const MAX_POSITION = 2 ** 53 - 1;

/** A seeded generator of 32-bit values (mulberry32). */
const random = (seed: number): (() => number) => {
    let state = seed | 0;
    return (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    };
};

const halvesOf = (position: number): [number, number] => {
    const high = Math.floor(position / TWO_TO_32);
    return [(position - high * TWO_TO_32) | 0, high];
};

/** The positions to check for one term length: every term boundary near the edges of the halves and random ones. */
const positionsFor = (termLength: number, next: () => number): number[] => {
    const positions: number[] = [0, 1, termLength - 1, termLength, 2 * termLength, 3 * termLength, MAX_POSITION];
    for (const edge of [2 ** 31, TWO_TO_32, 2 ** 40, 2 ** 52, MAX_POSITION - 4 * termLength]) {
        for (let term = -4; term <= 4; term++) {
            const base = Math.floor(edge / termLength) * termLength + term * termLength;
            for (const offset of [0, 32, termLength - 32]) {
                const position = base + offset;
                if (position >= 0 && position <= MAX_POSITION) {
                    positions.push(position);
                }
            }
        }
    }
    for (let i = 0; i < 2_000; i++) {
        positions.push(((next() & 0x1fffff) * TWO_TO_32 + next()) % (MAX_POSITION + 1));
    }
    return positions;
};

describe('ImageTermIndexRegression', () => {
    it('termIndexMatchesIndexByPositionForEveryTermLengthRegression', () => {
        const next = random(82);
        let checked = 0;
        for (let termLength = TERM_MIN_LENGTH; termLength <= TERM_MAX_LENGTH; termLength *= 2) {
            const shift = positionBitsToShift(termLength);
            for (const position of positionsFor(termLength, next)) {
                const [low, high] = halvesOf(position);
                expect(Image.termIndex(low, high, shift), `position ${position} shift ${shift}`).toBe(
                    indexByPosition(position, shift),
                );
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(15 * 2_000);
    });

    it('getHalvesOfTheCounterMatchesTheDefaultSplitRegression', () => {
        const next = random(137);
        const metaData = new UnsafeBuffer(new Uint8Array(CountersReader.METADATA_LENGTH));
        const values = new UnsafeBuffer(new Uint8Array(CountersReader.COUNTER_LENGTH));
        const manager = new CountersManager(metaData, values);
        const position = new UnsafeBufferPosition(values, manager.allocate('position'), manager);
        const counterHalves = new Int32Array(2);
        const defaultHalves = new Int32Array(2);

        const samples = [0, 1, 2 ** 31 - 1, 2 ** 31, TWO_TO_32 - 1, TWO_TO_32, 2 ** 40 + 96, MAX_POSITION];
        for (let i = 0; i < 2_000; i++) {
            samples.push(((next() & 0x1fffff) * TWO_TO_32 + next()) % (MAX_POSITION + 1));
        }

        for (const value of samples) {
            position.set(value);
            position.getHalves(counterHalves);
            // the default of Position, through get()
            Object.getPrototypeOf(UnsafeBufferPosition.prototype).getHalves.call(position, defaultHalves);

            const [low, high] = halvesOf(value);
            expect([counterHalves[0], counterHalves[1]], `value ${value}`).toEqual([low, high]);
            expect([defaultHalves[0], defaultHalves[1]], `value ${value}`).toEqual([low, high]);
            expect(counterHalves[1]! * TWO_TO_32 + (counterHalves[0]! >>> 0)).toBe(value);
        }
    });
});
