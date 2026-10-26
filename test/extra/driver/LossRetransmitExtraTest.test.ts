/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Extra tests of T11 (port-only): the loss detector and the retransmit handler across the interaction matrix (single
// gap, many gaps, gap at term end, loss during rotation, NAK in flight, positions beyond 2^32 and near the cap, term
// id wrap), and `expectNoAllocation` on the per-message methods.
import { beforeEach, describe, expect, it } from 'vitest';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { OptimalMulticastDelayGenerator } from '../../../src/driver/OptimalMulticastDelayGenerator.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import type { FlowControl } from '../../../src/driver/FlowControl.js';
import { LossDetector } from '../../../src/driver/LossDetector.js';
import { RetransmitHandler } from '../../../src/driver/RetransmitHandler.js';
import { StaticDelayGenerator } from '../../../src/driver/StaticDelayGenerator.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { assertThrows } from '../../support/Assertions.js';

const { lossFound, rebuildOffset, pack } = LossDetector;
const { frameLengthOrdered } = FrameDescriptor;

const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const MASK = TERM_LENGTH - 1;
const SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);
const FRAME = 64;
const MS = 1_000_000;
const MTU = 1024;
const TERM_ID = 0x1234;

function ms(n: number): number {
    return n * MS;
}

/** Frames of `FRAME` bytes at every offset in [from, to) of the term. */
function fill(term: UnsafeBuffer, from: number, to: number): void {
    for (let offset = from; offset < to; offset += FRAME) {
        frameLengthOrdered(term, offset, FRAME);
    }
}

function newDetector(retry = ms(20)): { detector: LossDetector; gaps: number[][] } {
    const gaps: number[][] = [];
    const detector = new LossDetector(new StaticDelayGenerator(ms(20), retry), {
        onGapDetected: (termId, termOffset, length) => {
            gaps.push([termId, termOffset, length]);
        },
    });
    return { detector, gaps };
}

describe('LossDetectorPackExtraTest', () => {
    it.each([0, 32, 64 * 1024, 2 ** 30, 2 ** 31 - 1])('packs and unpacks rebuildOffset %d', (offset) => {
        for (const found of [false, true]) {
            const outcome = pack(offset, found);
            expect(rebuildOffset(outcome)).toBe(offset);
            expect(lossFound(outcome)).toBe(found);
        }
    });

    it('packs a 64 KiB term offset as a small integer (V8 does not box it)', () => {
        expect(pack(TERM_LENGTH, true)).toBe(TERM_LENGTH * 2 + 1);
        expect(pack(TERM_LENGTH, true)).toBeLessThan(2 ** 30);
    });

    it.each([-1, 2 ** 31, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY])('pack throws RangeError for %d', (offset) => {
        assertThrows(RangeError, () => pack(offset, false));
    });
});

describe('LossDetectorMatrixExtraTest', () => {
    let term: UnsafeBuffer;

    beforeEach(() => {
        term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
    });

    function scan(
        detector: LossDetector,
        rebuild: number,
        hwm: number,
        nowNs: number,
        initialTermId = TERM_ID,
    ): number {
        return detector.scan(term, rebuild, hwm, nowNs, MASK, SHIFT, initialTermId);
    }

    it('reports a single gap once, then again on each retry, and the rebuild offset stops at the gap', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, 128);
        fill(term, 192, 320);

        const first = scan(detector, 0, 320, 0);
        expect(rebuildOffset(first)).toBe(128);
        expect(lossFound(first)).toBe(true);
        expect(gaps).toEqual([]);

        expect(lossFound(scan(detector, 0, 320, ms(20)))).toBe(false);
        expect(gaps).toEqual([[TERM_ID, 128, 64]]);
        scan(detector, 0, 320, ms(39));
        expect(gaps.length).toBe(1);
        scan(detector, 0, 320, ms(40));
        expect(gaps).toEqual([
            [TERM_ID, 128, 64],
            [TERM_ID, 128, 64],
        ]);
    });

    it('reports the first of many gaps, then the next one once the first is filled', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, 64);
        fill(term, 128, 192);
        fill(term, 256, 320);

        scan(detector, 0, 320, 0);
        scan(detector, 0, 320, ms(20));
        expect(gaps).toEqual([[TERM_ID, 64, 64]]);

        fill(term, 64, 128);
        const outcome = scan(detector, 64, 320, ms(21));
        expect(rebuildOffset(outcome)).toBe(192);
        expect(lossFound(outcome)).toBe(true);
        scan(detector, 192, 320, ms(41));
        expect(gaps).toEqual([
            [TERM_ID, 64, 64],
            [TERM_ID, 192, 64],
        ]);
    });

    it('reports a gap at the very end of the term', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, TERM_LENGTH - FRAME);

        const outcome = scan(detector, 0, TERM_LENGTH, 0);
        expect(rebuildOffset(outcome)).toBe(TERM_LENGTH - FRAME);
        expect(lossFound(outcome)).toBe(true);
        scan(detector, 0, TERM_LENGTH, ms(20));
        expect(gaps).toEqual([[TERM_ID, TERM_LENGTH - FRAME, FRAME]]);
    });

    it('completes a full term with no loss, then loses in the next term (rotation)', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, TERM_LENGTH);

        // the high water mark is already in the next term: the scan is limited to the end of this one
        const complete = scan(detector, 0, TERM_LENGTH + 256, 0);
        expect(rebuildOffset(complete)).toBe(TERM_LENGTH);
        expect(lossFound(complete)).toBe(false);
        expect(gaps).toEqual([]);

        const next = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        fill(next, 0, 64);
        fill(next, 128, 256);
        const outcome = detector.scan(next, TERM_LENGTH, TERM_LENGTH + 256, ms(1), MASK, SHIFT, TERM_ID);
        expect(rebuildOffset(outcome)).toBe(64);
        expect(lossFound(outcome)).toBe(true);
        detector.scan(next, TERM_LENGTH, TERM_LENGTH + 256, ms(21), MASK, SHIFT, TERM_ID);
        expect(gaps).toEqual([[TERM_ID + 1, 64, 64]]);
    });

    it('stops reporting when the gap is filled between scans', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, 64);
        fill(term, 128, 192);
        scan(detector, 0, 192, 0);
        fill(term, 64, 128);
        const outcome = scan(detector, 0, 192, ms(100));
        expect(rebuildOffset(outcome)).toBe(192);
        expect(lossFound(outcome)).toBe(false);
        expect(gaps).toEqual([]);
    });

    it('does nothing when the rebuild position has reached the high water mark', () => {
        const { detector, gaps } = newDetector();
        const outcome = scan(detector, 4096, 4096, ms(500));
        expect(rebuildOffset(outcome)).toBe(4096);
        expect(lossFound(outcome)).toBe(false);
        expect(gaps).toEqual([]);
    });

    const TERM_COUNTS = [
        65535, // position just below 2^32
        65536, // 2^32
        65537,
        2 ** 20 + 3,
        2 ** 31 - 2,
        2 ** 31 - 1, // the last term below the cap, termLength * 2^31
    ];

    it.each(TERM_COUNTS.flatMap((count) => [0, 5, 0x7fffffff, -0x80000000, -3].map((initial) => [count, initial])))(
        'finds the gap at term count %d with initial term id %d (positions past 2^32, term id wrap)',
        (count, initialTermId) => {
            const { detector, gaps } = newDetector();
            fill(term, 0, 64);
            fill(term, 128, 192);
            const base = count! * TERM_LENGTH;
            expect(base + 192).toBeLessThanOrEqual(LogBufferDescriptor.maxPossiblePosition(TERM_LENGTH));

            const first = scan(detector, base, base + 192, 0, initialTermId);
            expect(rebuildOffset(first)).toBe(64);
            expect(lossFound(first)).toBe(true);
            scan(detector, base, base + 192, ms(20), initialTermId);
            expect(gaps).toEqual([[(initialTermId! + count!) | 0, 64, 64]]);
        },
    );

    it('limits the scan to the term end when the high water mark is terms ahead, beyond 2^32', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, TERM_LENGTH - 128);
        const base = 70000 * TERM_LENGTH + TERM_LENGTH - 192;
        const outcome = scan(detector, base, base + 5 * TERM_LENGTH, 0, 7);
        expect(rebuildOffset(outcome)).toBe(TERM_LENGTH - 128);
        scan(detector, base, base + 5 * TERM_LENGTH, ms(20), 7);
        expect(gaps).toEqual([[70000 + 7, TERM_LENGTH - 128, 128]]);
    });

    it('compares the deadline across 2^40 ns', () => {
        const { detector, gaps } = newDetector();
        fill(term, 0, 64);
        fill(term, 128, 192);
        const t0 = 2 ** 40;
        scan(detector, 0, 192, t0);
        scan(detector, 0, 192, t0 + ms(19));
        expect(gaps.length).toBe(0);
        scan(detector, 0, 192, t0 + ms(20));
        expect(gaps.length).toBe(1);
    });
});

describe('LossDetectorAllocationExtraTest', () => {
    it('scan allocates nothing (gap, retries and fills)', async () => {
        let count = 0;
        const detector = new LossDetector(new StaticDelayGenerator(3, 5), {
            onGapDetected: (_termId, termOffset, length) => {
                count = (count + termOffset + length) & 0xffff;
            },
        });
        const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        fill(term, 0, 64);
        fill(term, 128, 4096);
        let sink = 0;

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                const outcome = detector.scan(term, 0, 4096, i, MASK, SHIFT, TERM_ID);
                sink = (sink + rebuildOffset(outcome) + (lossFound(outcome) ? 1 : 0)) & 0xffff;
                detector.scan(term, 4096, 4096, i, MASK, SHIFT, TERM_ID);
            }
        });
        expect(Number.isInteger(sink + count)).toBe(true);
    });

    it('scan allocates nothing at positions beyond 2^32 (at most the arguments boxed by the call)', async () => {
        const detector = new LossDetector(new StaticDelayGenerator(3, 5), { onGapDetected: () => {} });
        const term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
        fill(term, 0, 64);
        fill(term, 128, 4096);
        const base = 2 ** 20 * TERM_LENGTH;
        let sink = 0;

        // the two positions are heap numbers when they cross a call that is not inlined (spec 5.3), nothing else is
        await expectNoAllocation(
            (n) => {
                for (let i = 0; i < n; i++) {
                    const outcome = detector.scan(term, base, base + 4096, i, MASK, SHIFT, TERM_ID);
                    sink = (sink + rebuildOffset(outcome)) & 0xffff;
                }
            },
            undefined,
            2,
        );
        expect(Number.isInteger(sink)).toBe(true);
    });
});

describe('RetransmitHandlerMatrixExtraTest', () => {
    const clock = new CachedNanoClock();
    const TERM = 64 * 1024;
    let sent: number[][];
    let sender: { resend: (termId: number, termOffset: number, length: number) => void };
    let overflow: AtomicCounter;
    const fc = {
        maxRetransmissionLength: (termOffset: number, resendLength: number, termLength: number): number =>
            Math.min(resendLength, termLength - termOffset),
    } as unknown as FlowControl;

    function newHandler(group: boolean, max: number, delay = ms(20), linger = ms(40)): RetransmitHandler {
        return new RetransmitHandler(
            clock,
            new StaticDelayGenerator(delay),
            new StaticDelayGenerator(linger),
            group,
            max,
            overflow,
        );
    }

    function nak(handler: RetransmitHandler, termId: number, offset: number, length: number): void {
        handler.onNak(termId, offset, length, TERM, MTU, fc, sender);
    }

    beforeEach(() => {
        clock.update(0);
        sent = [];
        sender = {
            resend: (termId, termOffset, length) => {
                sent.push([termId, termOffset, length]);
            },
        };
        const counters = new CountersManager(
            new UnsafeBuffer(new ArrayBuffer(8 * CountersReader.METADATA_LENGTH)),
            new UnsafeBuffer(new ArrayBuffer(8 * CountersReader.COUNTER_LENGTH)),
        );
        overflow = counters.newCounter('overflow');
    });

    it('unicast keeps one action: a later, non overlapping NAK replaces a delayed one', () => {
        const handler = newHandler(false, 16);
        nak(handler, TERM_ID, 0, 64);
        nak(handler, TERM_ID, 1024, 64);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent).toEqual([[TERM_ID, 1024, 64]]);
        expect(overflow.get()).toBe(0);
    });

    it('RetransmitHandlerOptimalDelayNanAdversarialRegression: a NaN delay is 0, so a NAK resends at once', () => {
        const generator = new OptimalMulticastDelayGenerator(0, 10);
        expect(generator.generateNewOptimalDelay()).toBeNaN();
        const handler = new RetransmitHandler(clock, generator, new StaticDelayGenerator(ms(40)), true, 16, overflow);

        nak(handler, TERM_ID, 0, 64);

        expect(sent).toEqual([[TERM_ID, 0, 64]]);
    });

    it('unicast ignores a NAK inside the range of the active one, in delay and in linger', () => {
        const handler = newHandler(false, 16);
        nak(handler, TERM_ID, 0, 256);
        nak(handler, TERM_ID, 128, 64);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        nak(handler, TERM_ID, 192, 64);
        clock.update(ms(30));
        handler.processTimeouts(ms(30), sender);
        expect(sent).toEqual([[TERM_ID, 0, 256]]);
    });

    it('group semantics: the pool is full, the overflow counter counts, a freed slot takes the next NAK', () => {
        const handler = newHandler(true, 4);
        for (let i = 0; i < 4; i++) {
            nak(handler, TERM_ID, i * 1024, 64);
        }
        nak(handler, TERM_ID, 4 * 1024, 64);
        nak(handler, TERM_ID, 5 * 1024, 64);
        expect(overflow.get()).toBe(2);

        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent.map((s) => s[1])).toEqual([0, 1024, 2048, 3072]);

        // still lingering: no room
        nak(handler, TERM_ID, 4 * 1024, 64);
        expect(overflow.get()).toBe(3);

        // the lingers (40 ms from the clock at 21 ms) expire at 61 ms
        clock.update(ms(62));
        handler.processTimeouts(ms(62), sender);
        nak(handler, TERM_ID, 4 * 1024, 64);
        expect(overflow.get()).toBe(3);
        clock.update(ms(100));
        handler.processTimeouts(ms(100), sender);
        expect(sent[4]).toEqual([TERM_ID, 4 * 1024, 64]);
    });

    it('the same term offset in another term id is not suppressed (term rotation)', () => {
        const handler = newHandler(true, 4);
        nak(handler, TERM_ID, 512, 64);
        nak(handler, TERM_ID + 1, 512, 64);
        nak(handler, TERM_ID - 1, 512, 64);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent).toEqual([
            [TERM_ID, 512, 64],
            [TERM_ID + 1, 512, 64],
            [TERM_ID - 1, 512, 64],
        ]);
    });

    it('clamps a NAK at the term end through the flow control', () => {
        const handler = newHandler(true, 4);
        nak(handler, TERM_ID, TERM - 128, 4096);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent).toEqual([[TERM_ID, TERM - 128, 128]]);
    });

    it('a NAK in flight (delayed) is cancelled by a received retransmit, a lingering one is not', () => {
        const handler = newHandler(true, 4);
        nak(handler, TERM_ID, 0, 64);
        nak(handler, TERM_ID, 1024, 64);
        handler.onRetransmitReceived(TERM_ID, 0);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent).toEqual([[TERM_ID, 1024, 64]]);

        // 1024 now lingers: the received retransmit does not remove it, so a repeated NAK is still suppressed
        handler.onRetransmitReceived(TERM_ID, 1024);
        nak(handler, TERM_ID, 1024, 64);
        clock.update(ms(40));
        handler.processTimeouts(ms(40), sender);
        expect(sent.length).toBe(1);
    });

    it('a retransmit received for an unknown offset or term changes nothing', () => {
        const handler = newHandler(true, 4);
        handler.onRetransmitReceived(TERM_ID, 0);
        nak(handler, TERM_ID, 0, 64);
        handler.onRetransmitReceived(TERM_ID, 64);
        handler.onRetransmitReceived(TERM_ID + 1, 0);
        clock.update(ms(21));
        handler.processTimeouts(ms(21), sender);
        expect(sent).toEqual([[TERM_ID, 0, 64]]);
    });

    it('starts the linger from the clock, not from the time given to processTimeouts', () => {
        const handler = newHandler(true, 4);
        nak(handler, TERM_ID, 0, 64);
        clock.update(ms(10));
        handler.processTimeouts(ms(21), sender); // the delay (20 ms from t=0) has expired by the given time (strictly)
        expect(sent.length).toBe(1);
        // the linger expires at clock (10 ms) + 40 ms = 50 ms: a time of 49 ms does not remove it
        handler.processTimeouts(ms(49), sender);
        nak(handler, TERM_ID, 0, 64);
        clock.update(ms(100));
        handler.processTimeouts(ms(49), sender);
        expect(sent.length).toBe(1);
        // at 51 ms it does: the same NAK is taken again and sent once its delay expires
        handler.processTimeouts(ms(51), sender);
        nak(handler, TERM_ID, 0, 64);
        clock.update(ms(130));
        handler.processTimeouts(ms(130), sender);
        expect(sent.length).toBe(2);
    });

    it('works with times beyond 2^40 ns', () => {
        const t0 = 2 ** 45;
        const handler = newHandler(true, 4);
        clock.update(t0);
        nak(handler, TERM_ID, 0, 64);
        handler.processTimeouts(t0 + ms(19), sender);
        expect(sent.length).toBe(0);
        clock.update(t0 + ms(21));
        handler.processTimeouts(t0 + ms(21), sender);
        expect(sent.length).toBe(1);
        clock.update(t0 + ms(62));
        handler.processTimeouts(t0 + ms(62), sender);
        nak(handler, TERM_ID, 0, 64);
        clock.update(t0 + ms(83));
        handler.processTimeouts(t0 + ms(83), sender);
        expect(sent.length).toBe(2);
    });

    it('ignores a NAK of length 0 and processTimeouts with nothing active', () => {
        const handler = newHandler(true, 4);
        nak(handler, TERM_ID, 0, 0);
        handler.processTimeouts(ms(1000), sender);
        expect(sent).toEqual([]);
        expect(overflow.get()).toBe(0);
    });
});

describe('RetransmitHandlerAllocationExtraTest', () => {
    const overflow = { increment: () => 0 } as unknown as AtomicCounter;
    const fc = {
        maxRetransmissionLength: (_termOffset: number, resendLength: number) => resendLength,
    } as unknown as FlowControl;

    it.each([true, false])(
        'onNak, onRetransmitReceived and processTimeouts allocate nothing (group %s)',
        async (group) => {
            let now = 0;
            let sink = 0;
            const sender = {
                resend: (termId: number, termOffset: number, length: number) => {
                    sink = (sink + termId + termOffset + length) & 0xffff;
                },
            };
            const handler = new RetransmitHandler(
                { nanoTime: () => now },
                new StaticDelayGenerator(3),
                new StaticDelayGenerator(5),
                group,
                16,
                overflow,
            );

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    now = i;
                    handler.onNak(TERM_ID, (i & 255) * 64, 64, TERM_LENGTH, MTU, fc, sender);
                    handler.onRetransmitReceived(TERM_ID, ((i + 3) & 255) * 64);
                    handler.processTimeouts(i, sender);
                }
            });
            expect(Number.isInteger(sink)).toBe(true);
        },
    );

    it('onNak with an immediate retransmit (zero delay) allocates nothing', async () => {
        let now = 0;
        let sink = 0;
        const sender = {
            resend: (_termId: number, termOffset: number) => {
                sink = (sink + termOffset) & 0xffff;
            },
        };
        const handler = new RetransmitHandler(
            { nanoTime: () => now },
            new StaticDelayGenerator(0),
            new StaticDelayGenerator(5),
            true,
            16,
            overflow,
        );

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                now = i;
                handler.onNak(TERM_ID, (i & 63) * 64, 64, TERM_LENGTH, MTU, fc, sender);
                handler.processTimeouts(i, sender);
            }
        });
        expect(Number.isInteger(sink)).toBe(true);
    });
});

describe('OptimalMulticastDelayGeneratorExtraTest', () => {
    it('OptimalMulticastDelayGeneratorNanDelayAdversarialRegression: a NaN delay is 0 as Java (long) casts it', () => {
        expect(new OptimalMulticastDelayGenerator(0, 10).generateDelayNs()).toBe(0);
    });

    it('OptimalMulticastDelayGeneratorRetryDelayRegression: retryDelayNs is an integer, 0 for a degenerate group', () => {
        expect(new OptimalMulticastDelayGenerator(0, 10).retryDelayNs()).toBe(0);
        expect(Number.isInteger(new OptimalMulticastDelayGenerator(1_000_000, 10).generateDelayNs())).toBe(true);
    });
});
