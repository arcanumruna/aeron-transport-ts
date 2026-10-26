// Extra tests of T20 (port-only, spec 5.3): `offer` (one buffer, two buffers, vectors, with a reserved value supplier),
// `tryClaim` + `commit` and `appendPadding` of `ConcurrentPublication` and `ExclusivePublication` allocate nothing per
// message in the port's own code, over a log on an ArrayBuffer and over one on a SharedArrayBuffer (the log of a real
// stream, spec D16), unfragmented and fragmented, across the rotation of the terms. A minor collection happens only
// after something is allocated, so the test counts the collections over a long loop (test/support/Allocation.ts).
// Each case runs twice: from position 0, and from a position of 2^40 (the `LargePosition` cases), where a position is
// outside V8's 31-bit small integers: it allocates nothing there either (measured with an allowance of 0).
import { afterAll, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BufferClaim } from '../../../src/client/logbuffer/BufferClaim.js';
import { DirectBufferVector } from '../../../src/client/DirectBufferVector.js';
import type { ExclusivePublication } from '../../../src/client/ExclusivePublication.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { Publication } from '../../../src/client/Publication.js';
import type { ReservedValueSupplier } from '../../../src/client/ReservedValueSupplier.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../support/Backing.js';
import { ClientRig } from '../../support/ClientRig.js';

const ITERATIONS = 300_000;
const { ADMIN_ACTION } = Publication;

/** The term count at which the `LargePosition` cases start: a position of 2^40 for the 64 KiB terms. */
const LARGE_TERM_COUNT = 2 ** 24;

/** Keeps the values of the loops alive. */
let sink = 0;

describe.each([
    ['ConcurrentPublication', false],
    ['ExclusivePublication', true],
] as const)('PublicationAllocation %s', (_name, exclusive) => {
    describe.each([
        [ARRAY_BACKING, ''],
        [SHARED_BACKING, 'Shared'],
    ] as const)('%s', (backing, suffix) => {
        describe.each([
            ['', 0],
            ['LargePosition', LARGE_TERM_COUNT],
        ] as const)('%s', (where, termCount) => {
            const title = (name: string): string => name + where + suffix;
            const rig = (): ClientRig => new ClientRig({ backing, exclusive, termCount });

            /** An offer that is back pressured never happens (the limit is the maximum); a rotation is `ADMIN_ACTION`. */
            const check = (position: number): void => {
                if (position < 0 && ADMIN_ACTION !== position) {
                    throw new Error('offer failed: ' + Publication.errorString(position));
                }
                sink = position;
            };

            it(title('offerOfAnUnfragmentedMessageAllocatesNothing'), async () => {
                const { publication } = rig();
                const src = new UnsafeBuffer(new Uint8Array(64));

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        check(publication.offer(src, 0, 64));
                    }
                }, ITERATIONS);
            });

            it(title('offerOfAFragmentedMessageAllocatesNothing'), async () => {
                const { publication } = rig();
                const src = new UnsafeBuffer(new Uint8Array(6_000));

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        check(publication.offer(src, 0, 6_000));
                    }
                }, ITERATIONS / 10);
            });

            it(title('offerWithAReservedValueSupplierAllocatesNothing'), async () => {
                const { publication } = rig();
                const src = new UnsafeBuffer(new Uint8Array(64));
                let counter = 0;
                // the supplier returns a `number`: a timestamp or a checksum, no `bigint` (spec D81)
                const supplier: ReservedValueSupplier = { get: () => ++counter };

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        check(publication.offer(src, 0, 64, supplier));
                    }
                }, ITERATIONS);
            });

            it(title('offerTwoBuffersAllocatesNothing'), async () => {
                const { publication } = rig();
                const one = new UnsafeBuffer(new Uint8Array(32));
                const two = new UnsafeBuffer(new Uint8Array(40));

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        check(publication.offerTwoBuffers(one, 0, 32, two, 0, 40));
                    }
                }, ITERATIONS);
            });

            it(title('offerVectoredAllocatesNothing'), async () => {
                const { publication } = rig();
                const buffer = new UnsafeBuffer(new Uint8Array(100));
                const vectors = [new DirectBufferVector(buffer, 0, 30), new DirectBufferVector(buffer, 30, 70)];

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        check(publication.offerVectored(vectors));
                    }
                }, ITERATIONS);
            });

            it(title('tryClaimAndCommitAllocateNothing'), async () => {
                const { publication } = rig();
                const claim = new BufferClaim();

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        const position = publication.tryClaim(64, claim);
                        check(position);
                        if (position > 0) {
                            claim.buffer().putInt(claim.offset(), i);
                            claim.commit();
                        }
                    }
                }, ITERATIONS);
            });

            it(title('tryClaimAndAbortAllocateNothing'), async () => {
                const { publication } = rig();
                const claim = new BufferClaim();

                await expectNoAllocation((n) => {
                    for (let i = 0; i < n; i++) {
                        const position = publication.tryClaim(64, claim);
                        check(position);
                        if (position > 0) {
                            claim.abort();
                        }
                    }
                }, ITERATIONS);
            });

            if (exclusive) {
                it(title('appendPaddingAllocatesNothing'), async () => {
                    const publication = rig().publication as ExclusivePublication;

                    await expectNoAllocation((n) => {
                        for (let i = 0; i < n; i++) {
                            check(publication.appendPadding(64));
                        }
                    }, ITERATIONS);
                });
            }

            it(title('theMeasuredLoopsWroteFrames'), () => {
                // guards the loops above: they write real frames, and rotate the terms
                const { publication, rawLog } = rig();
                const src = new UnsafeBuffer(new Uint8Array(64));
                const start = publication.position();
                let rotations = 0;
                for (let i = 0; i < 2_000; i++) {
                    const position = publication.offer(src, 0, 64);
                    if (ADMIN_ACTION === position) {
                        rotations++;
                    }
                }

                expect(publication.position() - start).toBeGreaterThan(2_000 * 96 - 3 * 4096);
                expect(rotations).toBeGreaterThanOrEqual(2);
                expect(LogBufferDescriptor.activeTermCount(rawLog.metaData())).toBe(termCount + rotations);
            });
        });
    });
});

afterAll(() => {
    expect(Number.isFinite(sink)).toBe(true);
});
