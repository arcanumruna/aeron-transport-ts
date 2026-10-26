// Extra tests of T20 (port-only, spec 5.3): `Image.poll`, `controlledPoll`, `boundedPoll`, `boundedControlledPoll`,
// `blockPoll` and `rawPoll`, and `Subscription.poll`, `controlledPoll`, `blockPoll` and `rawPoll`, allocate nothing per
// fragment in the port's own code, over a log on an ArrayBuffer and over one on a SharedArrayBuffer, across the
// rotation of the terms and the padding frame at the end of each. Each loop offers one message with a
// `ConcurrentPublication` (which `PublicationAllocationTest` shows allocates nothing) and polls it. A minor collection
// happens only after something is allocated, so the test counts the collections over a long loop (see
// test/support/Allocation.ts). Each case runs twice: from position 0 and from a position of 2^40 (the `LargePosition`
// cases), where a position is outside V8's 31-bit small integers.
import { afterAll, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Long } from '../../../src/agrona/jdk.js';
import { Action, ControlledFragmentHandler } from '../../../src/client/logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from '../../../src/client/logbuffer/FragmentHandler.js';
import { Publication } from '../../../src/client/Publication.js';
import { ImageFragmentAssembler } from '../../../src/client/ImageFragmentAssembler.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../support/Backing.js';
import { ClientRig } from '../../support/ClientRig.js';

const ITERATIONS = 300_000;
const { ADMIN_ACTION } = Publication;
const { CONTINUE, COMMIT } = ControlledFragmentHandler.Action;

/** The term count at which the `LargePosition` cases start: a position of 2^40 for the 64 KiB terms. */
const LARGE_TERM_COUNT = 2 ** 24;

/**
 * Interim allowance, in heap numbers per iteration, for the `LargePosition` cases (spec D16, as in
 * `RingBufferHotPathAllocationTest`'s `LARGE_POSITION_HEAP_NUMBERS`). Above 2^31 a position is a double, and V8 boxes
 * it into a heap number each time it crosses a call that is not inlined: the result of `offer` and of the append
 * methods, `Position.get` and `setRelease`, and `getVolatile` of the position limit. Whether those calls are inlined
 * depends on the JIT and on the host's load, so on CI the same loop allocates on some runs and not on others. The
 * bound is the worst case measured with inlining off (`--no-turbo-inlining`): the fragmented case boxes about 3.3 per
 * message, so 4. Issue #19 drives this down to 0; the position-0 cases keep 0.
 */
const LARGE_POSITION_HEAP_NUMBERS = 4;

/** Keeps the values of the loops alive. */
let sink = 0;

/** A fragment handler and a controlled one: it sums and continues. */
class Sum implements FragmentHandler, ControlledFragmentHandler {
    public total = 0;

    public onFragment(_buffer: unknown, offset: number, length: number): Action {
        this.total = (this.total + offset + length) | 0;
        sink = this.total;
        return CONTINUE;
    }
}

class CommitSum extends Sum {
    public override onFragment(buffer: unknown, offset: number, length: number): Action {
        super.onFragment(buffer, offset, length);
        return COMMIT;
    }
}

describe.each([
    [ARRAY_BACKING, ''],
    [SHARED_BACKING, 'Shared'],
] as const)('ImageAllocation %s', (backing, suffix) => {
    describe.each([
        ['', 0],
        ['LargePosition', LARGE_TERM_COUNT],
    ] as const)('%s', (where, termCount) => {
        const title = (name: string): string => name + where + suffix;
        const rig = (): ClientRig => new ClientRig({ backing, termCount });

        /** Offers one message of `length` bytes; the rotation of the log is an administrative action and nothing is lost. */
        const produce = (r: ClientRig, src: UnsafeBuffer, length: number): void => {
            let position = r.publication.offer(src, 0, length);
            if (ADMIN_ACTION === position) {
                r.cleanNextTerm();
                position = r.publication.offer(src, 0, length);
            }
            if (position < 0) {
                throw new Error('offer failed: ' + Publication.errorString(position));
            }
        };

        const loop = (name: string, length: number, poll: (r: ClientRig) => number): void => {
            it(title(name), async () => {
                const r = rig();
                const src = new UnsafeBuffer(new Uint8Array(length));
                const start = r.image.position();
                let read = 0;

                await expectNoAllocation(
                    (n) => {
                        for (let i = 0; i < n; i++) {
                            produce(r, src, length);
                            read += poll(r);
                        }
                    },
                    ITERATIONS,
                    0 === termCount ? 0 : LARGE_POSITION_HEAP_NUMBERS,
                );

                expect(read).toBeGreaterThan(0);
                expect(r.image.position()).toBeGreaterThan(start);
                expect(r.image.position()).toBe(r.publication.position());
            });
        };

        const sum = new Sum();
        const commitSum = new CommitSum();
        const blockHandler = {
            onBlock: (_buffer: unknown, offset: number, length: number): void => {
                sink = offset + length;
            },
        };
        const rawHandler = {
            onBlock: (
                _channel: unknown,
                _fileOffset: number,
                _buffer: unknown,
                offset: number,
                length: number,
            ): void => {
                sink = offset + length;
            },
        };

        loop('imagePollAllocatesNothing', 64, (r) => r.image.poll(sum, 10));
        loop('imageControlledPollAllocatesNothing', 64, (r) => r.image.controlledPoll(sum, 10));
        loop('imageControlledPollWithCommitAllocatesNothing', 64, (r) => r.image.controlledPoll(commitSum, 10));
        loop('imageBoundedPollAllocatesNothing', 64, (r) => r.image.boundedPoll(sum, Long.MAX_VALUE, 10));
        loop('imageBoundedControlledPollAllocatesNothing', 64, (r) =>
            r.image.boundedControlledPoll(sum, Long.MAX_VALUE, 10),
        );
        loop('imageBlockPollAllocatesNothing', 64, (r) => (r.image.blockPoll(blockHandler, 1 << 20) > 0 ? 1 : 0));
        loop('imageRawPollAllocatesNothing', 64, (r) => (r.image.rawPoll(rawHandler, 1 << 20) > 0 ? 1 : 0));
        loop('subscriptionPollAllocatesNothing', 64, (r) => r.subscription.poll(sum, 10));
        loop('subscriptionControlledPollAllocatesNothing', 64, (r) => r.subscription.controlledPoll(sum, 10));
        loop('subscriptionBlockPollAllocatesNothing', 64, (r) =>
            r.subscription.blockPoll(blockHandler, 1 << 20) > 0 ? 1 : 0,
        );
        loop('subscriptionRawPollAllocatesNothing', 64, (r) =>
            r.subscription.rawPoll(rawHandler, 1 << 20) > 0 ? 1 : 0,
        );

        const assembler = new ImageFragmentAssembler(sum);
        loop('fragmentedMessageThroughTheAssemblerAllocatesNothing', 6_000, (r) => r.subscription.poll(assembler, 10));
    });
});

afterAll(() => {
    expect(Number.isFinite(sink)).toBe(true);
});
