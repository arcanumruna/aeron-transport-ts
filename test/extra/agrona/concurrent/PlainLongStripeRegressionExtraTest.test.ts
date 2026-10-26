// Not in Aeron (issue #22, spec D16): a plain `putLong`, and so `AtomicCounter.setPlain`, takes no stripe lock on a
// `SharedArrayBuffer`. A striped reader on another thread can therefore see a torn value (JLS 17.7 allows it for a plain
// `long`), which is why no counter that is read on another thread is written with a plain operation. A tear cannot be
// provoked on purpose, so the test pins the cause that is deterministic: with the stripe of the word held, the plain
// store completes and the atomic store waits.
import { afterEach, describe, expect, it } from 'vitest';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';

const OFFSET = 128;
const SPIN_CAP_DEFAULT = 1 << 28;

describe('PlainLongStripeRegression', () => {
    afterEach(() => {
        UnsafeBuffer.setStripeSpinCapForTests(SPIN_CAP_DEFAULT);
    });

    it('plainPutLongAndSetPlainTakeNoStripeWhileAnAtomicStoreWaitsOnItRegression', () => {
        const table = LongStripes.table()!;
        const buffer = new UnsafeBuffer(new SharedArrayBuffer(1024));
        const counter = new AtomicCounter(buffer, 1);
        const stripe = LongStripes.stripe(OFFSET);
        expect(stripe).toBeLessThan(table.length);

        UnsafeBuffer.setStripeSpinCapForTests(1000);
        Atomics.store(table, stripe, 1); // a writer holds the stripe of the word at OFFSET
        try {
            buffer.putLong(OFFSET + 8, 7); // another stripe: unaffected, as a control
            expect(buffer.getLongVolatile(OFFSET + 8)).toBe(7);

            buffer.putLong(OFFSET, 5);
            expect(buffer.getLong(OFFSET)).toBe(5);
            counter.setPlain(9);
            expect(counter.getPlain()).toBe(9);

            expect(() => buffer.putLongVolatile(OFFSET, 6)).toThrow(/stripe/);
            expect(() => counter.set(10)).toThrow(/stripe/);
            expect(() => buffer.getLongVolatile(OFFSET)).toThrow(/stripe/);
        } finally {
            Atomics.store(table, stripe, 0);
        }
    });
});
