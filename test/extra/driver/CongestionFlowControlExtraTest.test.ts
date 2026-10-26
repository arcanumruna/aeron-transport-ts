// Extra tests for the T10 classes (no Java counterpart): the packed congestion control outcome at its bounds, the
// Cubic algorithm with literal values worked out from the formulas, the suppliers, and zero allocation on the
// per-message methods.
import { describe, expect, it } from 'vitest';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { CountedErrorHandler } from '../../../src/agrona/concurrent/CountedErrorHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { IllegalArgumentException, Integer, ThreadLocalRandom } from '../../../src/agrona/jdk.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { CongestionControl } from '../../../src/driver/CongestionControl.js';
import { DefaultCongestionControlSupplier } from '../../../src/driver/DefaultCongestionControlSupplier.js';
import { DefaultUnicastFlowControlSupplier } from '../../../src/driver/DefaultUnicastFlowControlSupplier.js';
import { CubicCongestionControl } from '../../../src/driver/ext/CubicCongestionControl.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { OptimalMulticastDelayGenerator } from '../../../src/driver/OptimalMulticastDelayGenerator.js';
import { StaticDelayGenerator } from '../../../src/driver/StaticDelayGenerator.js';
import { StaticWindowCongestionControl } from '../../../src/driver/StaticWindowCongestionControl.js';
import { UnicastFlowControl } from '../../../src/driver/UnicastFlowControl.js';
import { assertThrows } from '../../support/Assertions.js';
import { expectNoAllocation } from '../../support/Allocation.js';

const { packOutcome, receiverWindowLength, shouldForceStatusMessage } = CongestionControl;

const MTU = 1000;
const TERM_LENGTH = 1 << 20;
const MAX_CWND = 131; // min(128 KiB window, TERM_LENGTH / 2) / MTU
const CUBIC_URI = 'aeron:udp?endpoint=127.0.0.1:9999|cc=cubic';
const SOURCE = new InetSocketAddress('127.0.0.1', 9999);

function newCountersManager(): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(64 * CountersReader.METADATA_LENGTH)),
        new UnsafeBuffer(new ArrayBuffer(64 * CountersReader.COUNTER_LENGTH)),
    );
}

function newContext(countersManager: CountersManager): MediaDriver.Context {
    const errors: Error[] = [];
    return new MediaDriver.Context()
        .tempBuffer(new UnsafeBuffer(new ArrayBuffer(4096)))
        .countedErrorHandler(
            new CountedErrorHandler({ onError: (e) => errors.push(e) }, countersManager.newCounter('errors')),
        );
}

function newCubic(
    countersManager: CountersManager,
    clock: CachedNanoClock,
    uri = CUBIC_URI,
): { cc: CubicCongestionControl; context: MediaDriver.Context } {
    const context = newContext(countersManager);
    const cc = new CubicCongestionControl(
        1,
        UdpChannel.parse(uri),
        2,
        3,
        TERM_LENGTH,
        MTU,
        SOURCE,
        SOURCE,
        clock,
        context,
        countersManager,
    );
    return { cc, context };
}

/** The value of the counter whose label starts with `prefix`, or null once it is freed. */
function counterValue(countersManager: CountersManager, prefix: string): number | null {
    let value: number | null = null;
    countersManager.forEach((id, label) => {
        if (label.startsWith(prefix)) {
            value = countersManager.getCounterValue(id);
        }
    });
    return value;
}

describe('CongestionControlOutcomeExtraTest', () => {
    const windows = [Integer.MIN_VALUE, -2, -1, 0, 1, 2, 1000, 1 << 29, (1 << 30) - 1, 1 << 30, Integer.MAX_VALUE];

    it.each(windows.flatMap((w) => [[w, false] as const, [w, true] as const]))(
        'packOutcomeRoundTrips %i %s',
        (window, force) => {
            const outcome = packOutcome(window, force);

            expect(Number.isSafeInteger(outcome)).toBe(true);
            expect(receiverWindowLength(outcome)).toBe(window);
            expect(shouldForceStatusMessage(outcome)).toBe(force);
        },
    );

    it('packOutcomeKeepsTheForceBitApartFromTheWindow', () => {
        expect(packOutcome(5, false)).toBe(10);
        expect(packOutcome(5, true)).toBe(11);
        expect(CongestionControl.FORCE_STATUS_MESSAGE_BIT).toBe(1);
    });

    it.each([[Integer.MAX_VALUE + 1], [Integer.MIN_VALUE - 1], [1.5], [NaN], [Infinity]])(
        'packOutcomeRejectsAWindowThatIsNotAnInt %f',
        (window) => {
            assertThrows(RangeError, () => packOutcome(window, false));
        },
    );

    it('thresholdIsAQuarterOfTheWindow', () => {
        expect(CongestionControl.threshold(1000)).toBe(250);
        expect(CongestionControl.threshold(0)).toBe(0);
    });
});

describe('StaticWindowCongestionControlExtraTest', () => {
    it('shouldReturnTheSameOutcomeForEveryRebuild', () => {
        const context = new MediaDriver.Context().initialWindowLength(16536);
        const cc = new StaticWindowCongestionControl(
            0,
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999'),
            0,
            0,
            TERM_LENGTH,
            MTU,
            null,
            null,
            null,
            context,
            null,
        );

        const outcome = cc.onTrackRebuild(1, 2, 3, 4, 5, 6, true);

        expect(receiverWindowLength(outcome)).toBe(16536);
        expect(shouldForceStatusMessage(outcome)).toBe(false);
        expect(cc.onTrackRebuild(7, 8, 9, 10, 11, 12, false)).toBe(outcome);
        expect(cc.maxWindowLength()).toBe(16536);
        expect(cc.shouldMeasureRtt(0)).toBe(false);
    });

    it('perMessageMethodsAllocateNothing', async () => {
        const cc = new StaticWindowCongestionControl(
            0,
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999'),
            0,
            0,
            TERM_LENGTH,
            MTU,
            null,
            null,
            null,
            new MediaDriver.Context().initialWindowLength(16536),
            null,
        );
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                cc.onRttMeasurementSent(i);
                cc.onRttMeasurement(i, 5, SOURCE);
                sink = (sink + cc.onTrackRebuild(i, i, i, i, i, i, 0 === (i & 7))) & 0xffff;
                if (cc.shouldMeasureRtt(i)) {
                    sink = (sink + 1) & 0xffff;
                }
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });
});

describe('CubicCongestionControlExtraTest', () => {
    it('shouldStartWithTenSegmentsAndRegisterTwoCounters', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());

        expect(cc.initialWindowLength()).toBe(10 * MTU);
        expect(cc.maxWindowLength()).toBe(131072);
        expect(cc.maxCongestionWindow()).toBe(MAX_CWND);
        expect(counterValue(countersManager, 'rcv-cc-cubic-wnd')).toBe(10 * MTU);
        expect(counterValue(countersManager, 'rcv-cc-cubic-rtt')).toBe(0);
    });

    it('shouldFreeItsCountersOnClose', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());

        cc.close();

        expect(counterValue(countersManager, 'rcv-cc-cubic-wnd')).toBeNull();
        expect(counterValue(countersManager, 'rcv-cc-cubic-rtt')).toBeNull();
    });

    it('shouldShrinkTheWindowByAFifthOnLossAndForceAStatusMessage', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());

        const outcome = cc.onTrackRebuild(1_000_000_000, 0, 0, 0, 0, 0, true);

        expect(receiverWindowLength(outcome)).toBe(8 * MTU);
        expect(shouldForceStatusMessage(outcome)).toBe(true);
        expect(counterValue(countersManager, 'rcv-cc-cubic-wnd')).toBe(8 * MTU);
    });

    it('shouldGrowBackToTheWindowBeforeTheLossOneSecondAfterIt', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());
        cc.onTrackRebuild(1_000_000_000, 0, 0, 0, 0, 0, true); // cwnd 8, w_max 10, k = cbrt(5)

        // C * (1 - k)^3 = 0.4 * (-0.71)^3 = -0.14, which (int) truncates to 0: cwnd = w_max
        const outcome = cc.onTrackRebuild(2_000_000_000, 0, 0, 0, 0, 0, false);

        expect(receiverWindowLength(outcome)).toBe(10 * MTU);
        expect(shouldForceStatusMessage(outcome)).toBe(false);
        expect(counterValue(countersManager, 'rcv-cc-cubic-wnd')).toBe(10 * MTU);
    });

    it('shouldNotChangeTheWindowBeforeTheUpdateTimeout', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());
        cc.onTrackRebuild(0, 0, 0, 0, 0, 0, true);

        // lastUpdate (0) + windowUpdateTimeout (100 us) is not before 99,999 ns
        const outcome = cc.onTrackRebuild(99_999, 0, 0, 0, 0, 0, false);

        expect(receiverWindowLength(outcome)).toBe(8 * MTU);
    });

    it('shouldForceAStatusMessageWhenTheWindowIsOneSegmentAndConsumptionMoves', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());
        // 10 -> 8 -> 6 -> 4 -> 3 -> 2 -> 1 segments
        let outcome = 0;
        for (let i = 0; i < 6; i++) {
            outcome = cc.onTrackRebuild(0, 0, 0, 0, 0, 0, true);
        }
        expect(receiverWindowLength(outcome)).toBe(MTU);
        // a further loss never goes below one segment
        expect(receiverWindowLength(cc.onTrackRebuild(0, 0, 0, 0, 0, 0, true))).toBe(MTU);

        const moved = cc.onTrackRebuild(0, 100, 0, 0, 0, 0, false);
        const stayed = cc.onTrackRebuild(0, 100, 100, 0, 0, 0, false);

        expect(receiverWindowLength(moved)).toBe(MTU);
        expect(shouldForceStatusMessage(moved)).toBe(true);
        expect(shouldForceStatusMessage(stayed)).toBe(false);
    });

    it('shouldRecordTheMeasuredRtt', () => {
        const countersManager = newCountersManager();
        const { cc } = newCubic(countersManager, new CachedNanoClock());

        cc.onRttMeasurementSent(10);
        cc.onRttMeasurement(20, 12_345, SOURCE);

        expect(counterValue(countersManager, 'rcv-cc-cubic-rtt')).toBe(12_345);
    });

    it('shouldHonourTheChannelReceiverWindow', () => {
        const { cc } = newCubic(newCountersManager(), new CachedNanoClock(), CUBIC_URI + '|rcv-wnd=4096');

        expect(cc.maxWindowLength()).toBe(4096);
        expect(cc.maxCongestionWindow()).toBe(4);
        expect(cc.initialWindowLength()).toBe(4 * MTU);
    });

    it('shouldNotLeakCountersWhenTheConstructorFails', () => {
        const countersManager = newCountersManager();
        const context = newContext(countersManager);
        context.tempBuffer(new UnsafeBuffer(new ArrayBuffer(4)));

        assertThrows(Error, () => {
            // a 4 byte temp buffer is too small for the counter key and label
            new CubicCongestionControl(
                1,
                UdpChannel.parse(CUBIC_URI),
                2,
                3,
                TERM_LENGTH,
                MTU,
                SOURCE,
                SOURCE,
                new CachedNanoClock(),
                context,
                countersManager,
            );
        });

        expect(counterValue(countersManager, 'rcv-cc-cubic-wnd')).toBeNull();
        expect(counterValue(countersManager, 'rcv-cc-cubic-rtt')).toBeNull();
    });

    it('perMessageMethodsAllocateNothing', async () => {
        const { cc } = newCubic(newCountersManager(), new CachedNanoClock());
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                cc.onRttMeasurementSent(i);
                cc.onRttMeasurement(i, 1000 + (i & 1023), SOURCE);
                sink = (sink + cc.onTrackRebuild(i * 1000, i, i >> 1, i, i, i, 0 === (i & 15))) & 0xffff;
                if (cc.shouldMeasureRtt(i)) {
                    sink = (sink + 1) & 0xffff;
                }
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });
});

describe('SupplierExtraTest', () => {
    const supplier = new DefaultCongestionControlSupplier();

    function create(uri: string) {
        const countersManager = newCountersManager();
        return supplier.newInstance(
            1,
            UdpChannel.parse(uri),
            2,
            3,
            TERM_LENGTH,
            MTU,
            SOURCE,
            SOURCE,
            new CachedNanoClock(),
            newContext(countersManager),
            countersManager,
        );
    }

    it('shouldDefaultToStaticWindow', () => {
        expect(create('aeron:udp?endpoint=127.0.0.1:9999')).toBeInstanceOf(StaticWindowCongestionControl);
    });

    it('shouldSelectStaticWindowByName', () => {
        expect(create('aeron:udp?endpoint=127.0.0.1:9999|cc=static')).toBeInstanceOf(StaticWindowCongestionControl);
    });

    it('shouldSelectCubicByName', () => {
        expect(create(CUBIC_URI)).toBeInstanceOf(CubicCongestionControl);
    });

    it('shouldRejectAnUnknownCongestionControl', () => {
        assertThrows(IllegalArgumentException, () => create('aeron:udp?endpoint=127.0.0.1:9999|cc=bbr'));
    });

    it('shouldSupplyUnicastFlowControlForAChannelWithoutFc', () => {
        const flowControl = new DefaultUnicastFlowControlSupplier().newInstance(
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999'),
            1,
            2,
        );

        expect(flowControl).toBeInstanceOf(UnicastFlowControl);
    });

    it('shouldRejectAnFcOnAUnicastChannel', () => {
        assertThrows(IllegalArgumentException, () =>
            new DefaultUnicastFlowControlSupplier().newInstance(
                UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|fc=max'),
                1,
                2,
            ),
        );
    });
});

describe('UnicastFlowControlExtraTest', () => {
    const POSITION_BITS = 16; // 64 KiB terms
    const INITIAL_TERM_ID = 5;

    function statusMessage(termId: number, termOffset: number, window: number): StatusMessageFlyweight {
        const flyweight = new StatusMessageFlyweight(new UnsafeBuffer(new ArrayBuffer(64)));
        flyweight.consumptionTermId(termId).consumptionTermOffset(termOffset).receiverWindowLength(window);
        return flyweight;
    }

    it('shouldSetTheLimitToThePositionPlusTheWindow', () => {
        const flowControl = new UnicastFlowControl();
        const sm = statusMessage(INITIAL_TERM_ID + 2, 128, 1000);

        const limit = flowControl.onStatusMessage(sm, SOURCE, 0, INITIAL_TERM_ID, POSITION_BITS, 0);

        expect(limit).toBe(
            LogBufferDescriptor.computePosition(INITIAL_TERM_ID + 2, 128, POSITION_BITS, INITIAL_TERM_ID) + 1000,
        );
        expect(limit).toBe(2 * 65536 + 128 + 1000);
    });

    it('shouldNeverMoveTheLimitBack', () => {
        const flowControl = new UnicastFlowControl();
        const sm = statusMessage(INITIAL_TERM_ID, 0, 1000);

        expect(flowControl.onStatusMessage(sm, SOURCE, 5000, INITIAL_TERM_ID, POSITION_BITS, 0)).toBe(5000);
        expect(flowControl.onIdle(0, 5000, 4000, false)).toBe(5000);
        expect(flowControl.onSetup(null as never, 5000, 4000, POSITION_BITS, 0)).toBe(5000);
        expect(flowControl.hasRequiredReceivers()).toBe(true);
    });

    it('shouldHandleATermIdRollOver', () => {
        const flowControl = new UnicastFlowControl();
        const initialTermId = Integer.MAX_VALUE;
        const sm = statusMessage(Integer.MIN_VALUE, 0, 100);

        const limit = flowControl.onStatusMessage(sm, SOURCE, 0, initialTermId, POSITION_BITS, 0);

        expect(limit).toBe(65536 + 100);
    });

    it('perMessageMethodsAllocateNothing', async () => {
        const flowControl = new UnicastFlowControl();
        const sm = statusMessage(INITIAL_TERM_ID + 1, 64, 4096);
        let sink = 0;

        await expectNoAllocation((n) => {
            let limit = 0;
            for (let i = 0; i < n; i++) {
                limit = flowControl.onStatusMessage(sm, SOURCE, limit, INITIAL_TERM_ID, POSITION_BITS, i);
                sink = (sink + flowControl.onIdle(i, limit, i, false)) & 0xffff;
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });
});

describe('DelayGeneratorExtraTest', () => {
    it('staticDelayGeneratorConstructors', () => {
        const same = new StaticDelayGenerator(7);
        const split = new StaticDelayGenerator(7, 9);
        const deprecated = new StaticDelayGenerator(7, true);

        expect([same.generateDelayNs(), same.retryDelayNs()]).toEqual([7, 7]);
        expect([split.generateDelayNs(), split.retryDelayNs()]).toEqual([7, 9]);
        expect([deprecated.generateDelayNs(), deprecated.retryDelayNs()]).toEqual([7, 7]);
        expect(StaticDelayGenerator.ZERO_DELAY_GENERATOR.generateDelayNs()).toBe(0);
        expect(split.toString()).toBe('StaticDelayGenerator{delayInNs=7, retryDelayNs=9}');
    });

    it('staticGenerateDelayNsAllocatesNothing', async () => {
        const fixed = new StaticDelayGenerator(1000, 2000);
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sink = (sink + fixed.generateDelayNs() + fixed.retryDelayNs()) & 0xffff;
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });

    it('optimalGenerateDelayNsAllocatesNothing', async () => {
        const optimal = new OptimalMulticastDelayGenerator(60_000_000, 10);
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sink = (sink + optimal.generateDelayNs() + optimal.retryDelayNs()) & 0xffff;
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });

    it('nextDoubleIsUniformInTheUnitInterval', () => {
        const random = ThreadLocalRandom.current();
        const buckets = new Array<number>(10).fill(0);
        const samples = 200_000;

        for (let i = 0; i < samples; i++) {
            const value = random.nextDouble();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
            buckets[Math.floor(value * 10)]!++;
        }

        for (const count of buckets) {
            expect(count).toBeGreaterThan(samples / 10 - 1000);
            expect(count).toBeLessThan(samples / 10 + 1000);
        }
    });

    it('optimalDelayIsAWholeNumberOfNanoseconds', () => {
        const generator = new OptimalMulticastDelayGenerator(60_000_000, 10);

        for (let i = 0; i < 1000; i++) {
            const delay = generator.generateDelayNs();
            expect(Number.isInteger(delay)).toBe(true);
            expect(delay).toBeLessThanOrEqual(60_000_000);
        }
    });
});
