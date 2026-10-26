// Extra tests of T21 (no Java counterpart): the `Random` stand-in against Java's sequence and against an independent
// `bigint` model of its generator, the random generator seeded (the same seed gives the same drops), the two forms of
// `shouldDropFrame`, and the factory and the system properties of `DebugChannelEndpointConfiguration`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllegalArgumentException } from '../../../../src/agrona/jdk.js';
import { System } from '../../../../src/agrona/jdkLang.js';
import { Random } from '../../../../src/agrona/jdkRandom.js';
import { FixedLossGenerator } from '../../../../src/driver/ext/FixedLossGenerator.js';
import { MultiGapLossGenerator } from '../../../../src/driver/ext/MultiGapLossGenerator.js';
import { RandomLossGenerator } from '../../../../src/driver/ext/RandomLossGenerator.js';
import { DebugChannelEndpointConfiguration } from '../../../../src/driver/ext/DebugChannelEndpointConfiguration.js';
import { assertThrows } from '../../../support/Assertions.js';

const MASK_48 = (1n << 48n) - 1n;

/** `java.util.Random` written with `bigint`s from its specification: the reference for the 24 bit halves of the port. */
function referenceDoubles(seed: bigint, count: number): number[] {
    let state = (seed ^ 0x5deece66dn) & MASK_48;
    const next = (bits: bigint): bigint => {
        state = (state * 0x5deece66dn + 0xbn) & MASK_48;
        return state >> (48n - bits);
    };
    const doubles: number[] = [];
    for (let i = 0; i < count; i++) {
        doubles.push(Number((next(26n) << 27n) + next(27n)) * 2 ** -53);
    }

    return doubles;
}

describe('RandomExtraTest', () => {
    it('shouldGiveTheSequenceOfJavaUtilRandom', () => {
        // the first values of new Random(42).nextDouble() and new Random(0).nextDouble(), as the JDK prints them
        const random42 = new Random(42);
        expect(random42.nextDouble()).toBe(0.7275636800328681);
        expect(random42.nextDouble()).toBe(0.6832234717598454);

        const random0 = new Random(0);
        expect(random0.nextDouble()).toBe(0.730967787376657);
        expect(random0.nextDouble()).toBe(0.24053641567148587);
    });

    it.each([0, 1, 42, -1, -42, 0xffffff, 0x1000000, 0xffffffff, 0x100000000, 123456789012, -123456789012])(
        'shouldMatchTheBigintModelForSeed %i',
        (seed) => {
            const random = new Random(seed);
            const expected = referenceDoubles(BigInt(seed), 1000);
            for (let i = 0; i < expected.length; i++) {
                expect(random.nextDouble(), 'draw ' + i).toBe(expected[i]);
            }
        },
    );

    it('shouldMatchTheBigintModelAtTheLargestSeeds', () => {
        for (const seed of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
            const random = new Random(seed);
            const expected = referenceDoubles(BigInt(seed), 100);
            for (let i = 0; i < expected.length; i++) {
                expect(random.nextDouble()).toBe(expected[i]);
            }
        }
    });

    it('shouldStayInTheUnitInterval', () => {
        const random = new Random();
        for (let i = 0; i < 10_000; i++) {
            const value = random.nextDouble();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it('shouldRestartTheSequenceOnSetSeed', () => {
        const random = new Random(7);
        const first = [random.nextDouble(), random.nextDouble()];
        random.setSeed(7);
        expect([random.nextDouble(), random.nextDouble()]).toEqual(first);
    });
});

describe('RandomLossGeneratorExtraTest', () => {
    const drops = (generator: RandomLossGenerator, count: number): boolean[] => {
        const result: boolean[] = [];
        for (let i = 0; i < count; i++) {
            result.push(generator.shouldDropFrame(null, null, 1408));
        }

        return result;
    };

    it('shouldDropTheSameFramesForTheSameSeed', () => {
        const first = drops(new RandomLossGenerator(0.3, 12345), 2000);
        const second = drops(new RandomLossGenerator(0.3, 12345), 2000);
        const other = drops(new RandomLossGenerator(0.3, 12346), 2000);

        expect(second).toEqual(first);
        expect(other).not.toEqual(first);
    });

    it('shouldDropWhereTheJavaRandomIsAtOrBelowTheRate', () => {
        const rate = 0.25;
        const expected = referenceDoubles(99n, 500).map((value) => value <= rate);
        expect(drops(new RandomLossGenerator(rate, 99), 500)).toEqual(expected);
    });

    it('shouldDropTheRateOfFramesOverALongRun', () => {
        const dropped = drops(new RandomLossGenerator(0.1, 2024), 100_000).filter((drop) => drop).length;
        expect(dropped).toBeGreaterThan(9_500);
        expect(dropped).toBeLessThan(10_500);
    });

    it('shouldDropEveryFrameAtARateOfOneAndNoneAtZero', () => {
        expect(drops(new RandomLossGenerator(1.0, 5), 1000).every((drop) => drop)).toBe(true);
        expect(drops(new RandomLossGenerator(0.0, 5), 1000).some((drop) => drop)).toBe(false);
    });

    it('shouldSeedFromTheClockWhenTheSeedIsMinusOne', () => {
        // two unseeded generators differ with a probability of 1 - 2^-1000 over 1000 draws at a rate of one half
        expect(drops(new RandomLossGenerator(0.5), 1000)).not.toEqual(drops(new RandomLossGenerator(0.5, -1), 1000));
    });

    it('shouldIgnoreTheStreamArgumentsOfTheLongForm', () => {
        const shortForm = new RandomLossGenerator(0.5, 31);
        const longForm = new RandomLossGenerator(0.5, 31);
        for (let i = 0; i < 500; i++) {
            expect(longForm.shouldDropFrame(null, null, 1, 2, 3, i * 32, 1408)).toBe(
                shortForm.shouldDropFrame(null, null, 1408),
            );
        }
    });
});

describe('LossGeneratorFormsExtraTest', () => {
    it('shouldNotDropInTheShortFormOfTheFixedAndMultiGapGenerators', () => {
        const fixed = new FixedLossGenerator(0, 0, 1408);
        const multi = new MultiGapLossGenerator(0, 8, 4, 1);
        expect(fixed.shouldDropFrame(null, null, 1408)).toBe(false);
        expect(multi.shouldDropFrame(null, null, 8)).toBe(false);
        // the short form leaves the state alone: the long form still drops the first frame once
        expect(fixed.shouldDropFrame(null, null, 1, 2, 0, 0, 1408)).toBe(true);
        expect(multi.shouldDropFrame(null, null, 1, 2, 0, 8, 8)).toBe(true);
    });

    it('shouldDropAtTheHighestAndLowestTermOffsets', () => {
        // a term offset past the signed range of an int cannot occur; the largest one is 2^30 (the largest term)
        const fixed = new FixedLossGenerator(-2147483648, 1073741824 - 1408, 1408);
        expect(fixed.shouldDropFrame(null, null, 1, 2, -2147483648, 1073741824 - 1408, 1408)).toBe(true);
        expect(fixed.shouldDropFrame(null, null, 1, 2, -2147483648, 1073741824 - 1408, 1408)).toBe(false);
        expect(fixed.shouldDropFrame(null, null, 1, 2, 2147483647, 1073741824 - 1408, 1408)).toBe(false);
    });

    it('shouldKeepStreamsAndSessionsApartForNegativeIds', () => {
        const fixed = new FixedLossGenerator(0, 0, 64);
        expect(fixed.shouldDropFrame(null, null, -1, -2, 0, 0, 64)).toBe(true);
        expect(fixed.shouldDropFrame(null, null, -2, -1, 0, 0, 64)).toBe(true); // the swapped pair is another stream
        expect(fixed.shouldDropFrame(null, null, -1, -2, 0, 0, 64)).toBe(false);
        expect(fixed.shouldDropFrame(null, null, -2, -1, 0, 0, 64)).toBe(false);
    });

    it('shouldRejectAGapAsLongAsTheRadix', () => {
        assertThrows(IllegalArgumentException, () => new MultiGapLossGenerator(0, 8, 8, 1));
        assertThrows(IllegalArgumentException, () => new MultiGapLossGenerator(0, 5, 8, 1)); // 5 is rounded up to 8
        expect(() => new MultiGapLossGenerator(0, 8, 7, 1)).not.toThrow();
    });

    it('shouldRoundTheRadixUpToAPowerOfTwo', () => {
        const rounded = new MultiGapLossGenerator(0, 5, 2, 2);
        const exact = new MultiGapLossGenerator(0, 8, 2, 2);
        for (let offset = 0; offset < 64; offset += 4) {
            expect(rounded.shouldDropFrame(null, null, 1, 2, 0, offset, 4), 'offset ' + offset).toBe(
                exact.shouldDropFrame(null, null, 1, 2, 0, offset, 4),
            );
        }
    });

    it('shouldDropNothingPastTheLastGapOrInAnotherTerm', () => {
        const generator = new MultiGapLossGenerator(5, 16, 8, 2);
        // gaps at [16, 24) and [32, 40); lastGapLimit is 2 * 16 + 8 = 40
        expect(generator.shouldDropFrame(null, null, 1, 2, 4, 16, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 1, 2, 5, 16, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 1, 2, 5, 32, 8)).toBe(true);
        expect(generator.shouldDropFrame(null, null, 1, 2, 5, 48, 8)).toBe(false);
        expect(generator.shouldDropFrame(null, null, 1, 2, 5, 64, 8)).toBe(false);
    });
});

describe('DebugChannelEndpointConfigurationExtraTest', () => {
    const PROPS = [
        DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_RATE_PROP_NAME,
        DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_SEED_PROP_NAME,
        DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_RATE_PROP_NAME,
        DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_SEED_PROP_NAME,
        DebugChannelEndpointConfiguration.SEND_DATA_LOSS_RATE_PROP_NAME,
        DebugChannelEndpointConfiguration.SEND_DATA_LOSS_SEED_PROP_NAME,
        DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_RATE_PROP_NAME,
        DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_SEED_PROP_NAME,
    ];

    afterEach(() => {
        for (const name of PROPS) {
            System.clearProperty(name);
        }
        vi.resetModules();
    });

    it('shouldHaveJavasPropertyNames', () => {
        expect(PROPS).toEqual([
            'aeron.debug.receive.data.loss.rate',
            'aeron.debug.receive.data.loss.seed',
            'aeron.debug.receive.control.loss.rate',
            'aeron.debug.receive.control.loss.seed',
            'aeron.debug.send.data.loss.rate',
            'aeron.debug.send.data.loss.seed',
            'aeron.debug.send.control.loss.rate',
            'aeron.debug.send.control.loss.seed',
        ]);
    });

    it('shouldSupplyAGeneratorThatNeverDropsAtARateOfZero', () => {
        for (const supplier of [
            DebugChannelEndpointConfiguration.receiveDataLossGeneratorSupplier,
            DebugChannelEndpointConfiguration.receiveControlLossGeneratorSupplier,
            DebugChannelEndpointConfiguration.sendDataLossGeneratorSupplier,
            DebugChannelEndpointConfiguration.sendControlLossGeneratorSupplier,
        ]) {
            const generator = supplier();
            for (let i = 0; i < 100; i++) {
                expect(generator.shouldDropFrame(null, null, 1408)).toBe(false);
                expect(generator.shouldDropFrame(null, null, 1, 2, 3, i * 32, 1408)).toBe(false);
            }
        }
    });

    it('shouldSupplyARandomGeneratorOfTheGivenRateAndSeed', () => {
        const supplied = DebugChannelEndpointConfiguration.lossGeneratorSupplier(0.4, 77);
        const direct = new RandomLossGenerator(0.4, 77);
        for (let i = 0; i < 500; i++) {
            expect(supplied.shouldDropFrame(null, null, 1408)).toBe(direct.shouldDropFrame(null, null, 1408));
        }
    });

    /** The module graph is loaded afresh (the properties live in a module of it), so the properties are set in it. */
    async function loadWith(
        properties: Record<string, string>,
    ): Promise<typeof import('../../../../src/driver/ext/DebugChannelEndpointConfiguration.js')> {
        vi.resetModules();
        const { System: freshSystem } = await import('../../../../src/agrona/jdkLang.js');
        for (const [name, value] of Object.entries(properties)) {
            freshSystem.setProperty(name, value);
        }

        return import('../../../../src/driver/ext/DebugChannelEndpointConfiguration.js');
    }

    it('shouldReadTheRatesAndSeedsOfThePropertiesWhenTheModuleLoads', async () => {
        const loaded = await loadWith({
            [DebugChannelEndpointConfiguration.SEND_DATA_LOSS_RATE_PROP_NAME]: '0.5',
            [DebugChannelEndpointConfiguration.SEND_DATA_LOSS_SEED_PROP_NAME]: '1234',
            [DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_RATE_PROP_NAME]: '1',
            [DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_SEED_PROP_NAME]: '0x10',
        });
        const sendData = loaded.DebugChannelEndpointConfiguration.sendDataLossGeneratorSupplier();
        const direct = new RandomLossGenerator(0.5, 1234);
        for (let i = 0; i < 200; i++) {
            expect(sendData.shouldDropFrame(null, null, 100)).toBe(direct.shouldDropFrame(null, null, 100));
        }

        const receiveControl = loaded.DebugChannelEndpointConfiguration.receiveControlLossGeneratorSupplier();
        expect(receiveControl.shouldDropFrame(null, null, 100)).toBe(true);

        // the others keep the default of no loss
        const sendControl = loaded.DebugChannelEndpointConfiguration.sendControlLossGeneratorSupplier();
        expect(sendControl.shouldDropFrame(null, null, 100)).toBe(false);
    });

    it('shouldRejectAMalformedRateWhenTheModuleLoads', async () => {
        await expect(
            loadWith({ [DebugChannelEndpointConfiguration.SEND_DATA_LOSS_RATE_PROP_NAME]: 'lots' }),
        ).rejects.toThrow('For input string: "lots"');
    });
});
