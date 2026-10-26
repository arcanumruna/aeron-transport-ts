// Extra tests of T20 (not in Aeron, whose tests of these classes mock the log): a `ConcurrentPublication` or an
// `ExclusivePublication`, an `Image` and a `Subscription` against each other over a real log (`ClientRig`), on an
// ArrayBuffer and on a SharedArrayBuffer. Produced = consumed, in order, for every size of message (0, one frame, the
// edges of the fragmentation, the maximum); across the rotation of the terms, with term ids that wrap; at positions above
// 2^31, 2^32, 2^40 and at the end of the position space (`MAX_POSITION_EXCEEDED`, no `RangeError`); the reserved value;
// the exclusive publication's padding, block and revoke; the argument checks; the subscription's images. Each case
// names the mutation that turns it red.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IllegalStateException, Integer, Long } from '../../../src/agrona/jdk.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { DirectBufferVector } from '../../../src/client/DirectBufferVector.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';
import type { ExclusivePublication } from '../../../src/client/ExclusivePublication.js';
import { ImageFragmentAssembler } from '../../../src/client/ImageFragmentAssembler.js';
import { ControlledFragmentHandler } from '../../../src/client/logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from '../../../src/client/logbuffer/FragmentHandler.js';
import { BufferClaim } from '../../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import type { Header } from '../../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { Publication } from '../../../src/client/Publication.js';
import { BACKINGS } from '../../support/Backing.js';
import { ClientRig } from '../../support/ClientRig.js';
import type { ClientRigOptions } from '../../support/ClientRig.js';

const { ADMIN_ACTION, BACK_PRESSURED, CLOSED, MAX_POSITION_EXCEEDED } = Publication;
const { HEADER_LENGTH } = DataHeaderFlyweight;

/** A message of `length` bytes that depends on `seed`. */
function pattern(length: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + 5) & 0xff;
    }
    return bytes;
}

/** The messages that the handler was given, whole, with the position after each. */
class Collector implements FragmentHandler {
    public readonly messages: Uint8Array[] = [];
    public readonly positions: number[] = [];
    public readonly termOffsets: number[] = [];

    public onFragment(buffer: UnsafeBuffer, offset: number, length: number, header: Header): void {
        const copy = new Uint8Array(length);
        buffer.getBytes(offset, copy, 0, length);
        this.messages.push(copy);
        this.positions.push(header.position());
        this.termOffsets.push(header.termOffset());
    }
}

/** Offer, retrying an administrative action (the rotation of the log) as a caller does. */
function offerAll(rig: ClientRig, message: Uint8Array): number {
    const src = new UnsafeBuffer(message);
    for (let attempt = 0; attempt < 8; attempt++) {
        const position = rig.publication.offer(src, 0, message.length);
        if (ADMIN_ACTION !== position) {
            return position;
        }
    }
    throw new Error('the log did not rotate');
}

/** Poll until the image has caught up with the log (a padding frame moves the position and reads no fragment). */
function drain(rig: ClientRig, handler: FragmentHandler): void {
    const assembler = new ImageFragmentAssembler(handler);
    for (let i = 0; i < 1000; i++) {
        const before = rig.image.position();
        rig.subscription.poll(assembler, 100);
        if (before === rig.image.position()) {
            break;
        }
    }
    rig.cleanNextTerm();
}

const VARIANTS: Array<[string, Partial<ClientRigOptions>]> = BACKINGS.flatMap((backing) => [
    [`ConcurrentPublication over ${backing.name}`, { backing, exclusive: false }] as [
        string,
        Partial<ClientRigOptions>,
    ],
    [`ExclusivePublication over ${backing.name}`, { backing, exclusive: true }] as [string, Partial<ClientRigOptions>],
]);

describe.each(VARIANTS)('PublicationImageExtraTest %s', (_name, options) => {
    it('a message of every size is consumed as it was produced, in order', () => {
        // mutation: a wrong fragment boundary, flag, or reassembly offset in append(Unfragmented|Fragmented)Message
        const rig = new ClientRig(options);
        const { publication } = rig;
        const max = publication.maxPayloadLength();
        const sizes = [
            0,
            1,
            31,
            32,
            33,
            100,
            max - 1,
            max,
            max + 1,
            2 * max - 1,
            2 * max,
            2 * max + 1,
            publication.maxMessageLength(),
        ];
        const collector = new Collector();

        sizes.forEach((size, i) => {
            expect(offerAll(rig, pattern(size, i))).toBeGreaterThan(0);
            drain(rig, collector);
        });

        expect(collector.messages).toHaveLength(sizes.length);
        sizes.forEach((size, i) => {
            expect(collector.messages[i], 'message ' + i + ' of ' + size).toEqual(pattern(size, i));
        });
        expect(rig.image.position()).toBe(publication.position());
        expect(collector.positions[sizes.length - 1]).toBe(publication.position());
    });

    it('messages offered together are consumed in order across the rotation of the terms with a wrapping term id', () => {
        // mutation: `termId - initialTermId` without `| 0` (ADMIN_ACTION for ever after the wrap), rotateLog on the wrong term
        const rig = new ClientRig({ ...options, initialTermId: Integer.MAX_VALUE - 2 });
        const collector = new Collector();
        const count = 800;
        let consumed = 0;

        for (let i = 0; i < count; i++) {
            expect(offerAll(rig, pattern(1000 + (i % 50), i))).toBeGreaterThan(0);
            if (0 === i % 7) {
                drain(rig, collector);
                consumed = collector.messages.length;
            }
        }
        drain(rig, collector);

        expect(collector.messages.length).toBeGreaterThan(consumed);
        expect(collector.messages).toHaveLength(count);
        for (let i = 0; i < count; i++) {
            expect(collector.messages[i]).toEqual(pattern(1000 + (i % 50), i));
        }
        // 800 messages of about 1.1 KB cross the end of 64 KiB terms 13 times: the term id went past INT32_MAX
        expect(LogBufferDescriptor.activeTermCount(rig.rawLog.metaData())).toBeGreaterThanOrEqual(12);
        expect(rig.image.position()).toBe(rig.publication.position());
    });

    describe.each([
        ['2^31', 2 ** 15],
        ['2^32', 2 ** 16],
        ['2^36', 2 ** 20],
        ['2^40', 2 ** 24],
        ['2^46', 2 ** 30],
        ['2^47 - 3 terms', 2 ** 31 - 3],
    ])('at a position of %s', (_where, termCount) => {
        it('is produced and consumed at the exact positions and term offsets', () => {
            // mutation: a position or a term offset computed with 32-bit arithmetic (`position | 0` in `Image.activeTermBuffer` or in the limit offset)
            const rig = new ClientRig({ ...options, termCount });
            const collector = new Collector();
            const bitsToShift = LogBufferDescriptor.positionBitsToShift(rig.termLength);
            expect(rig.startPosition).toBe(termCount * 2 ** bitsToShift);
            expect(rig.publication.position()).toBe(rig.startPosition);
            expect(rig.image.position()).toBe(rig.startPosition);

            let expected = rig.startPosition;
            for (let i = 0; i < 3; i++) {
                const size = 100 + i;
                const aligned = FrameDescriptor.FRAME_ALIGNMENT * Math.ceil((size + HEADER_LENGTH) / 32);
                expected += aligned;
                expect(offerAll(rig, pattern(size, i))).toBe(expected);
                expect(rig.publication.position()).toBe(expected);
                expect(rig.publication.availableWindow()).toBe(Long.MAX_VALUE - expected);
            }

            drain(rig, collector);

            expect(collector.messages).toHaveLength(3);
            expect(collector.positions).toEqual([
                rig.startPosition + 160,
                rig.startPosition + 160 + 160,
                rig.startPosition + 160 + 160 + 160,
            ]);
            expect(collector.termOffsets).toEqual([0, 160, 320]);
            expect(rig.image.position()).toBe(expected);
        });

        it('crosses the end of the term with a padding frame', () => {
            // mutation: the position of the padding frame, or of the claim after it, computed with 32-bit arithmetic
            const rig = new ClientRig({ ...options, termCount, termOffset: 64 * 1024 - 96 });
            const collector = new Collector();

            expect(offerAll(rig, pattern(100, 1))).toBe(rig.startPosition + 96 + 160);
            drain(rig, collector);

            expect(collector.messages).toEqual([pattern(100, 1)]);
            expect(collector.termOffsets).toEqual([0]);
            expect(rig.image.position()).toBe(rig.publication.position());
            expect(rig.publication.position()).toBe(rig.startPosition + 96 + 160);
        });

        it('a bounded poll stops at the limit position', () => {
            // mutation: `limitOffset` from a 32-bit difference of the positions
            const rig = new ClientRig({ ...options, termCount });
            const collector = new Collector();
            for (let i = 0; i < 4; i++) {
                offerAll(rig, pattern(100, i));
            }

            expect(rig.image.boundedPoll(collector, rig.startPosition + 2 * 160, 10)).toBe(2);
            expect(rig.image.position()).toBe(rig.startPosition + 2 * 160);
            expect(rig.image.boundedPoll(collector, rig.startPosition + 2 * 160, 10)).toBe(0);
            expect(rig.image.boundedPoll(collector, Long.MAX_VALUE, 10)).toBe(2);
            expect(collector.messages.map((m) => m.length)).toEqual([100, 100, 100, 100]);
        });

        it('a block poll takes the frames from the exact offset', () => {
            // mutation: the term offset of the block from `(int)position & mask` of a wrong width
            const rig = new ClientRig({ ...options, termCount });
            for (let i = 0; i < 3; i++) {
                offerAll(rig, pattern(100, i));
            }
            rig.subscriberPosition.setRelease(rig.startPosition + 160);
            const blocks: Array<[number, number, number, number]> = [];

            const bytes = rig.image.blockPoll(
                {
                    onBlock: (_buffer, offset, length, sessionId, termId) =>
                        blocks.push([offset, length, sessionId, termId]),
                },
                1 << 20,
            );

            expect(bytes).toBe(320);
            expect(blocks).toEqual([[160, 320, rig.sessionId, (rig.initialTermId + termCount) | 0]]);
            expect(rig.image.position()).toBe(rig.startPosition + 480);
        });
    });

    it('MAX_POSITION_EXCEEDED at the end of the position space of a term of 64 KiB, with no RangeError', () => {
        // mutation: the cap taken from `termLength * 2^31` without the 2^53 bound, or the check after the rotation
        const termCount = 2 ** 31 - 1;
        const rig = new ClientRig({ ...options, termCount });
        const { publication } = rig;
        const cap = publication.maxPossiblePosition();
        expect(cap).toBe(2 ** 47);

        let position = 0;
        for (let i = 0; i < 2000 && MAX_POSITION_EXCEEDED !== position; i++) {
            position = publication.offer(new UnsafeBuffer(pattern(3000, i)), 0, 3000);
            expect(position === ADMIN_ACTION || position === MAX_POSITION_EXCEEDED || position > 0).toBe(true);
        }

        expect(position).toBe(MAX_POSITION_EXCEEDED);
        // and for ever: the log does not rotate past the last term
        for (let i = 0; i < 5; i++) {
            expect(publication.offer(new UnsafeBuffer(pattern(3000, i)), 0, 3000)).toBe(MAX_POSITION_EXCEEDED);
        }
        expect(publication.position()).toBeLessThanOrEqual(cap + 3200);
        expect(Publication.errorString(MAX_POSITION_EXCEEDED)).toBe('MAX_POSITION_EXCEEDED');
    });

    it('MAX_POSITION_EXCEEDED at the end of the position space of a term of 16 MiB, below 2^53', () => {
        // mutation: `termLength * 2^31` for the cap (2^55): a position past 2^53 throws RangeError in computePosition
        const termLength = 1 << 24;
        const termCount = 2 ** 29 - 2;
        const rig = new ClientRig({ ...options, termLength, termCount, termOffset: termLength - 1024 });
        const { publication } = rig;
        expect(publication.maxPossiblePosition()).toBe(2 ** 53 - termLength);

        const src = new UnsafeBuffer(pattern(1000, 1));
        let position = 0;
        for (let i = 0; i < 100 && MAX_POSITION_EXCEEDED !== position; i++) {
            position = publication.offer(src, 0, 1000);
        }

        expect(position).toBe(MAX_POSITION_EXCEEDED);
        expect(publication.offer(src, 0, 1000)).toBe(MAX_POSITION_EXCEEDED);
        expect(publication.position()).toBeLessThan(Long.MAX_VALUE);
    });

    it('a limit that is reached back pressures, and a larger limit lets the offer through', () => {
        // mutation: the comparison `position < limit` as `<=`
        const rig = new ClientRig(options);
        const src = new UnsafeBuffer(pattern(100, 1));
        rig.limit.value = 160;

        expect(rig.publication.offer(src, 0, 100)).toBe(160);
        expect(rig.publication.availableWindow()).toBe(0);
        expect(rig.publication.offer(src, 0, 100)).toBe(BACK_PRESSURED);
        expect(rig.publication.tryClaim(10, new BufferClaim())).toBe(BACK_PRESSURED);

        rig.limit.value = 161;
        expect(rig.publication.offer(src, 0, 100)).toBe(320);
        expect(rig.publication.positionLimit()).toBe(161);
        expect(rig.publication.positionLimitId()).toBe(0);
    });

    it('the reserved value is written as a number, as a bigint, and nothing is committed for one that does not fit', () => {
        // mutation: the supplier called after the frame length is set, or the value written without the range check
        const rig = new ClientRig(options);
        const src = new UnsafeBuffer(pattern(10, 1));
        const values: Array<bigint | number> = [
            0,
            1,
            -1,
            2 ** 53 - 1,
            -(2 ** 53 - 1),
            2n ** 62n,
            -(2n ** 63n),
            2n ** 63n - 1n,
        ];

        const read: bigint[] = [];
        for (const value of values) {
            const before = rig.publication.position();
            expect(rig.publication.offer(src, 0, 10, { get: () => value })).toBe(before + 64);
            const frameOffset = before % rig.termLength;
            read.push(DataHeaderFlyweight.reservedValue(rig.rawLog.termBuffers()[0]!, frameOffset));
        }
        expect(read).toEqual(values.map((v) => BigInt(v)));

        const before = rig.publication.position();
        expect(() => rig.publication.offer(src, 0, 10, { get: () => 2n ** 63n })).toThrow(RangeError);
        expect(() => rig.publication.offer(src, 0, 10, { get: () => 2 ** 53 })).toThrow(RangeError);
        // the frame was claimed but its length is still negative: the image does not see it
        expect(rig.image.poll({ onFragment: () => {} }, 1000)).toBe(values.length);
        expect(rig.image.poll({ onFragment: () => {} }, 1000)).toBe(0);
        expect(rig.image.position()).toBeGreaterThanOrEqual(before);
    });

    it('the reserved value of every fragment of a fragmented message is supplied with its own frame length', () => {
        // mutation: the supplier called once for a message
        const rig = new ClientRig(options);
        const max = rig.publication.maxPayloadLength();
        const calls: Array<[number, number]> = [];

        rig.publication.offer(new UnsafeBuffer(pattern(2 * max + 5, 1)), 0, 2 * max + 5, {
            get: (_buffer, termOffset, frameLength) => {
                calls.push([termOffset, frameLength]);
                return termOffset + frameLength;
            },
        });

        expect(calls).toEqual([
            [0, max + HEADER_LENGTH],
            [4096, max + HEADER_LENGTH],
            [8192, 5 + HEADER_LENGTH],
        ]);
    });

    it('offer of two buffers and of vectors is consumed as the one buffer is', () => {
        // mutation: a part of the second buffer or of the vectors lost at a fragment boundary
        const rig = new ClientRig(options);
        const collector = new Collector();
        const max = rig.publication.maxPayloadLength();
        for (const total of [10, max, max + 1, 2 * max + 7, 6000]) {
            const whole = pattern(total, total);
            const split = Math.trunc(total / 3);
            const one = new UnsafeBuffer(whole.slice(0, split));
            const two = new UnsafeBuffer(whole.slice(split));
            const all = new UnsafeBuffer(whole);

            expect(rig.publication.offerTwoBuffers(one, 0, split, two, 0, total - split)).toBeGreaterThan(0);
            expect(
                rig.publication.offerVectored([
                    new DirectBufferVector(all, 0, split),
                    new DirectBufferVector(all, split, 0),
                    new DirectBufferVector(all, split, total - split),
                ]),
            ).toBeGreaterThan(0);
            drain(rig, collector);
            expect(collector.messages.splice(0)).toEqual([whole, whole]);
        }
    });

    it('arguments that do not fit are refused, and nothing is claimed', () => {
        // mutation: a length check removed or moved after the claim of the tail
        const rig = new ClientRig(options);
        const { publication } = rig;
        const src = new UnsafeBuffer(new Uint8Array(20_000));
        const start = publication.position();

        expect(() => publication.offer(src, 0, -1)).toThrow(IllegalArgumentException);
        expect(() => publication.offer(src, 0, publication.maxMessageLength() + 1)).toThrow(
            'message exceeds maxMessageLength of ' +
                publication.maxMessageLength() +
                ', length=' +
                (publication.maxMessageLength() + 1),
        );
        expect(() => publication.tryClaim(-1, new BufferClaim())).toThrow('invalid length: -1');
        expect(() => publication.tryClaim(publication.maxPayloadLength() + 1, new BufferClaim())).toThrow(
            'claim exceeds maxPayloadLength of ' +
                publication.maxPayloadLength() +
                ', length=' +
                (publication.maxPayloadLength() + 1),
        );
        expect(() => publication.offerTwoBuffers(src, 0, -1, src, 0, 5)).toThrow('lengthOne < 0: -1');
        expect(() => publication.offerTwoBuffers(src, 0, 5, src, 0, -2)).toThrow('lengthTwo < 0: -2');
        expect(() => publication.offerTwoBuffers(src, 0, 0x7fffffff, src, 0, 2)).toThrow('overflow totalLength=');
        expect(() => publication.offerTwoBuffers(src, 0, 3000, src, 0, 3000)).not.toThrow();
        expect(() => publication.offerVectored([new DirectBufferVector(src, 0, 20_001)])).toThrow(
            IllegalArgumentException,
        );
        expect(() => publication.offerVectored([new DirectBufferVector(src, 20_000, 1)])).toThrow(
            'offset=20000 capacity=20000',
        );

        expect(publication.position()).toBeGreaterThan(start); // only the one that fits was written
        expect(publication.position() - start).toBeLessThan(10_100);
    });

    it('the closed publication answers CLOSED to every call and its position, window, limit and status are the closed ones', () => {
        // mutation: a method that does not test isClosed
        const rig = new ClientRig(options);
        const { publication } = rig;
        const src = new UnsafeBuffer(pattern(10, 1));
        rig.publicationConductor.removePublication.mockImplementation((p) => (p as Publication).internalClose());

        publication.close();
        publication.close(); // idempotent: the conductor is called once

        expect(rig.publicationConductor.removePublication).toHaveBeenCalledTimes(1);
        expect(publication.isClosed()).toBe(true);
        expect(publication.offer(src, 0, 10)).toBe(CLOSED);
        expect(publication.offerTwoBuffers(src, 0, 5, src, 0, 5)).toBe(CLOSED);
        expect(publication.offerVectored([new DirectBufferVector(src, 0, 10)])).toBe(CLOSED);
        expect(publication.tryClaim(10, new BufferClaim())).toBe(CLOSED);
        expect(publication.availableWindow()).toBe(CLOSED);
        expect(publication.positionLimit()).toBe(CLOSED);
        expect(publication.position()).toBe(CLOSED);
        expect(publication.isConnected()).toBe(false);
        expect(publication.channelStatus()).toBe(-1);
        expect(() => publication.addDestination('aeron:udp?endpoint=localhost:1')).toThrow(AeronException);
        expect(() => publication.removeDestination('aeron:udp?endpoint=localhost:1')).toThrow('Publication is closed');
        expect(() => publication.removeDestination(5)).toThrow('Publication is closed');
        expect(() => publication.asyncAddDestination('x')).toThrow('Publication is closed');
        expect(() => publication.asyncRemoveDestination('x')).toThrow('Publication is closed');
        expect(() => publication.asyncRemoveDestination(5)).toThrow('Publication is closed');
    });

    it('the destinations go to the conductor with the original registration id, or the registration id for the async ones', () => {
        // mutation: originalRegistrationId and registrationId swapped
        const rig = new ClientRig(options);
        const { publication, publicationConductor } = rig;

        publication.addDestination('aeron:udp?endpoint=a:1');
        publication.removeDestination('aeron:udp?endpoint=a:1');
        publication.removeDestination(77);
        publicationConductor.asyncAddDestination.mockReturnValue(5);
        publicationConductor.asyncRemoveDestination.mockReturnValue(6);

        expect(publication.asyncAddDestination('aeron:udp?endpoint=b:1')).toBe(5);
        expect(publication.asyncRemoveDestination('aeron:udp?endpoint=b:1')).toBe(6);
        expect(publication.asyncRemoveDestination(78)).toBe(6);

        expect(publicationConductor.addDestination).toHaveBeenCalledWith(
            ClientRig.REGISTRATION_ID,
            'aeron:udp?endpoint=a:1',
        );
        expect(publicationConductor.removeDestination.mock.calls).toEqual([
            [ClientRig.REGISTRATION_ID, 'aeron:udp?endpoint=a:1'],
            [ClientRig.REGISTRATION_ID, 77],
        ]);
        expect(publicationConductor.asyncAddDestination).toHaveBeenCalledWith(
            ClientRig.REGISTRATION_ID,
            'aeron:udp?endpoint=b:1',
        );
        expect(publicationConductor.asyncRemoveDestination.mock.calls).toEqual([
            [ClientRig.REGISTRATION_ID, 'aeron:udp?endpoint=b:1'],
            [ClientRig.REGISTRATION_ID, 78],
        ]);
        expect(publication.isOriginal()).toBe(true);
        expect(publication.toString()).toContain(
            'Publication{originalRegistrationId=1000, registrationId=1000, isClosed=false',
        );
    });

    it('a claim is invisible until it is committed, visible when committed, and skipped when aborted', () => {
        // mutation: the frame length published by the claim, or abort() not setting the padding type
        const rig = new ClientRig(options);
        const collector = new Collector();
        const claim = new BufferClaim();
        const claimed: number[] = [];

        for (let i = 0; i < 3; i++) {
            claimed.push(rig.publication.tryClaim(20, claim));
            claim.buffer().putBytes(claim.offset(), pattern(20, i), 0, 20);
            const visible = collector.messages.length;
            rig.subscription.poll(collector, 10);
            // the frame that is claimed has a negative length: not yet; the one before it is there, if it was committed
            expect(collector.messages.length - visible).toBe(1 === i ? 1 : 0);
            if (1 === i) {
                claim.abort();
            } else {
                claim.commit();
            }
        }
        rig.subscription.poll(collector, 10);

        expect(claimed).toEqual([64, 128, 192]);
        expect(collector.messages).toEqual([pattern(20, 0), pattern(20, 2)]);
        expect(rig.image.position()).toBe(192);
    });
});

describe('ExclusivePublication extra', () => {
    const exclusive = (
        options: Partial<ClientRigOptions> = {},
    ): { rig: ClientRig; publication: ExclusivePublication } => {
        const rig = new ClientRig({ ...options, exclusive: true });
        return { rig, publication: rig.publication as ExclusivePublication };
    };

    it('termId() and termOffset() follow the appends and the rotation, and the position is the begin of the term plus the offset', () => {
        // mutation: the term id not incremented, or termBeginPosition not advanced, in rotateTerm
        const { rig, publication } = exclusive({ initialTermId: Integer.MAX_VALUE });
        expect(publication.termId()).toBe(Integer.MAX_VALUE);
        expect(publication.termOffset()).toBe(0);

        expect(publication.offer(new UnsafeBuffer(pattern(100, 1)), 0, 100)).toBe(160);
        expect(publication.termOffset()).toBe(160);

        // fill the term: the claim that does not fit pads the rest and answers ADMIN_ACTION, and the term rotates
        let rotated = false;
        for (let i = 0; i < 100 && !rotated; i++) {
            rotated = ADMIN_ACTION === publication.offer(new UnsafeBuffer(pattern(3000, i)), 0, 3000);
        }

        expect(rotated).toBe(true);
        expect(publication.termId()).toBe(Integer.MIN_VALUE); // wrapped
        expect(publication.termOffset()).toBe(0);
        expect(publication.position()).toBe(64 * 1024);
        expect(LogBufferDescriptor.activeTermCount(rig.rawLog.metaData())).toBe(1);
        expect(publication.offer(new UnsafeBuffer(pattern(100, 1)), 0, 100)).toBe(64 * 1024 + 160);
    });

    it('a publication made over a log that is not at its start continues from the tail of the log', () => {
        // mutation: termId or termOffset read from the wrong partition in the constructor
        const { rig, publication } = exclusive({ termCount: 5, termOffset: 4096 });

        expect(publication.termId()).toBe((rig.initialTermId + 5) | 0);
        expect(publication.termOffset()).toBe(4096);
        expect(publication.position()).toBe(rig.startPosition);
        expect(publication.offer(new UnsafeBuffer(pattern(10, 1)), 0, 10)).toBe(rig.startPosition + 64);
    });

    it('appendPadding writes a padding frame that the image skips and that moves the position', () => {
        // mutation: the type left as data (the image would hand the padding to the handler)
        const { rig, publication } = exclusive();
        const collector = new Collector();

        expect(publication.appendPadding(96)).toBe(128);
        expect(publication.offer(new UnsafeBuffer(pattern(10, 1)), 0, 10)).toBe(192);
        expect(rig.subscription.poll(collector, 10)).toBe(1);

        expect(collector.messages).toEqual([pattern(10, 1)]);
        expect(rig.image.position()).toBe(192);
        expect(FrameDescriptor.frameType(rig.rawLog.termBuffers()[0]!, 0)).toBe(FrameDescriptor.PADDING_FRAME_TYPE);
        expect(FrameDescriptor.frameLength(rig.rawLog.termBuffers()[0]!, 0)).toBe(128);
        expect(() => publication.appendPadding(publication.maxFramedLength + 1)).toThrow(
            'padding exceeds maxFramedLength of ' + publication.maxFramedLength,
        );
        expect(() => publication.appendPadding(-1)).toThrow('invalid length: -1');
    });

    it('offerBlock takes a block of frames from another log, rotates a full term, and refuses a bad block', () => {
        // mutation: the first frame not checked, the block not copied after the first word, or the length not bounded
        const source = exclusive();
        for (let i = 0; i < 3; i++) {
            source.publication.offer(new UnsafeBuffer(pattern(100, i)), 0, 100);
        }
        const block = new UnsafeBuffer(new Uint8Array(480));
        source.rig.rawLog.termBuffers()[0]!.getBytes(0, block, 0, 480);

        const { rig, publication } = exclusive({ initialTermId: source.rig.initialTermId });
        const collector = new Collector();
        expect(publication.offerBlock(block, 0, 480)).toBe(480);
        expect(rig.subscription.poll(collector, 10)).toBe(3);
        expect(collector.messages).toEqual([pattern(100, 0), pattern(100, 1), pattern(100, 2)]);
        expect(publication.termOffset()).toBe(480);

        // the same block again: its first frame says term offset 0, the publication is at 480
        expect(() => publication.offerBlock(block, 0, 480)).toThrow(
            'improperly formatted block: termOffset=0 (expected=480)',
        );
        expect(() => publication.offerBlock(block, 0, 64 * 1024)).toThrow(IllegalArgumentException);
        expect(rig.image.position()).toBe(480);

        rig.publicationConductor.removePublication.mockImplementation((p) => (p as Publication).internalClose());
        publication.close();
        expect(publication.offerBlock(block, 0, 480)).toBe(CLOSED);
    });

    it('offerBlock of a full term rotates to the next, and a limit back pressures it', () => {
        // mutation: `termOffset >= termBufferLength` tested as `>`
        const { rig, publication } = exclusive({ termOffset: 64 * 1024 - 160 });
        const source = exclusive({ termOffset: 64 * 1024 - 160, initialTermId: rig.initialTermId });
        source.publication.offer(new UnsafeBuffer(pattern(100, 1)), 0, 100);
        const block = new UnsafeBuffer(new Uint8Array(160));
        source.rig.rawLog.termBuffers()[0]!.getBytes(64 * 1024 - 160, block, 0, 160);
        const next = exclusive({ initialTermId: rig.initialTermId, termCount: 1 });
        next.publication.offer(new UnsafeBuffer(pattern(100, 2)), 0, 100);
        const nextBlock = new UnsafeBuffer(new Uint8Array(160));
        next.rig.rawLog.termBuffers()[1]!.getBytes(0, nextBlock, 0, 160);

        expect(publication.offerBlock(block, 0, 160)).toBe(64 * 1024);
        expect(publication.termOffset()).toBe(64 * 1024);
        expect(publication.offerBlock(nextBlock, 0, 160)).toBe(64 * 1024 + 160); // rotates first
        expect(publication.termId()).toBe((rig.initialTermId + 1) | 0);
        expect(LogBufferDescriptor.activeTermCount(rig.rawLog.metaData())).toBe(1);

        rig.limit.value = 0;
        expect(publication.offerBlock(nextBlock, 0, 160)).toBe(BACK_PRESSURED);
    });

    it('revoke() marks the publication revoked on close and closes it, once', () => {
        // mutation: the flag set after close(), or set on a closed publication
        const { rig, publication } = exclusive();
        rig.publicationConductor.removePublication.mockImplementation((p) => (p as Publication).internalClose());
        publication.revokeOnClose();
        expect(publication._revokeOnClose).toBe(true);

        const other = exclusive();
        other.rig.publicationConductor.removePublication.mockImplementation((p) => (p as Publication).internalClose());
        other.publication.revoke();
        other.publication.revoke();

        expect(other.publication._revokeOnClose).toBe(true);
        expect(other.publication.isClosed()).toBe(true);
        expect(other.rig.publicationConductor.removePublication).toHaveBeenCalledTimes(1);
        expect(new ClientRig({ exclusive: true }).publication._revokeOnClose).toBe(false);
    });
});

describe('Image and Subscription extra', () => {
    it('a closed image keeps the final position, the end of stream and the revocation it had', () => {
        // mutation: close() not capturing a field, or an accessor reading the live value after close
        const rig = new ClientRig();
        const meta = rig.rawLog.metaData();
        rig.publication.offer(new UnsafeBuffer(pattern(10, 1)), 0, 10);
        rig.image.poll({ onFragment: () => {} }, 10);
        expect(rig.image.endOfStreamPosition()).toBe(Long.MAX_VALUE);
        expect(rig.image.isEndOfStream()).toBe(false);
        LogBufferDescriptor.endOfStreamPosition(meta, 64);
        LogBufferDescriptor.isPublicationRevoked(meta, true);
        LogBufferDescriptor.activeTransportCount(meta, 2);
        expect(rig.image.isEndOfStream()).toBe(true);
        expect(rig.image.isPublicationRevoked()).toBe(true);
        expect(rig.image.activeTransportCount()).toBe(2);

        rig.image.close();
        LogBufferDescriptor.endOfStreamPosition(meta, 1 << 20);
        LogBufferDescriptor.isPublicationRevoked(meta, false);

        expect(rig.image.isClosed()).toBe(true);
        expect(rig.image.position()).toBe(64);
        expect(rig.image.endOfStreamPosition()).toBe(64);
        expect(rig.image.isEndOfStream()).toBe(true);
        expect(rig.image.isPublicationRevoked()).toBe(true);
        expect(rig.image.activeTransportCount()).toBe(0);
        expect(rig.image.controlledPoll({ onFragment: () => null as never }, 1)).toBe(0);
        expect(rig.image.blockPoll({ onBlock: () => {} }, 100)).toBe(0);
        expect(rig.image.rawPoll({ onBlock: () => {} }, 100)).toBe(0);
        expect(rig.image.boundedPoll({ onFragment: () => {} }, Long.MAX_VALUE, 1)).toBe(0);
        expect(rig.image.toString()).toContain('Image{correlationId=2000, sessionId=42, isClosed=true, isEos=true');
        expect(rig.image.fileChannel()).toBeNull();
        expect(rig.image.mtuLength()).toBe(4096);
        expect(rig.image.termBufferLength()).toBe(64 * 1024);
        expect(rig.image.positionBitsToShift()).toBe(16);
        expect(rig.image.initialTermId()).toBe(rig.initialTermId);
        expect(rig.image.sourceIdentity()).toBe('test');
        expect(rig.image.subscription()).toBe(rig.subscription);
        expect(rig.image.joinPosition()).toBe(0);
        expect(rig.image.subscriberPositionId()).toBe(0);
    });

    it('the raw poll takes the padding frame at the end of the term as a block of its own, after the frames before it', () => {
        // mutation: the scan stopping at the padding frame or the limit offset past the capacity
        const rig = new ClientRig({ termOffset: 64 * 1024 - 224 });
        rig.subscriberPosition.setRelease(rig.startPosition);
        rig.publication.offer(new UnsafeBuffer(pattern(100, 1)), 0, 100); // 160 bytes
        const padding = rig.publication.offer(new UnsafeBuffer(pattern(100, 2)), 0, 100); // pads 64 bytes, rotates
        expect(padding).toBe(ADMIN_ACTION);
        const blocks: Array<[number, number, number]> = [];

        const handler = {
            onBlock: (
                fileChannel: unknown,
                fileOffset: number,
                _buffer: unknown,
                offset: number,
                length: number,
            ): void => {
                blocks.push([null === fileChannel ? fileOffset : -1, offset, length]);
            },
        };

        // a padding frame is a block of its own, as in Java: the frames before it, then the padding
        expect(rig.image.rawPoll(handler, 1 << 30)).toBe(160);
        expect(rig.image.rawPoll(handler, 1 << 30)).toBe(64);
        expect(rig.image.rawPoll(handler, 1 << 30)).toBe(0); // the next term holds nothing yet
        expect(blocks).toEqual([
            [64 * 1024 - 224, 64 * 1024 - 224, 160],
            [64 * 1024 - 64, 64 * 1024 - 64, 64],
        ]);
        expect(rig.image.position()).toBe(64 * 1024);
    });

    it('the controlled poll stops at ABORT, BREAK, and commits at COMMIT, at a large position', () => {
        // mutation: the position set to the end of an aborted fragment
        const rig = new ClientRig({ termCount: 2 ** 24 });
        for (let i = 0; i < 4; i++) {
            rig.publication.offer(new UnsafeBuffer(pattern(100, i)), 0, 100);
        }
        const { ABORT, COMMIT, CONTINUE } = ControlledFragmentHandler.Action;
        const actions = [CONTINUE, COMMIT, CONTINUE, ABORT];
        let call = 0;
        const handler = { onFragment: () => actions[call++]! };

        const read = rig.image.controlledPoll(handler, 10);

        expect(read).toBe(3);
        expect(rig.image.position()).toBe(rig.startPosition + 3 * 160);
    });

    it('the subscription polls its images in turn, keeps a snapshot of the images it had, and closes them', () => {
        // mutation: images mutated in place, or the starting index not rotated
        const rig = new ClientRig();
        const { subscription } = rig;
        const second = new (rig.image.constructor as new (...args: unknown[]) => typeof rig.image)(
            subscription,
            43,
            rig.subscriberPosition,
            rig.logBuffers,
            rig.errorHandler,
            'second',
            2001,
        );
        const before = subscription.images();
        subscription.addImage(second);

        expect(before).toHaveLength(1);
        expect(subscription.images()).toHaveLength(2);
        expect(subscription.imageCount()).toBe(2);
        expect(subscription.hasNoImages()).toBe(false);
        expect(subscription.isConnected()).toBe(true);
        expect(subscription.imageBySessionId(43)).toBe(second);
        expect(subscription.imageBySessionId(99)).toBeNull();
        expect(subscription.imageAtIndex(1)).toBe(second);
        expect(() => subscription.imageAtIndex(2)).toThrow('Index 2 out of bounds for length 2');
        const seen: number[] = [];
        subscription.forEachImage((image) => seen.push(image.sessionId()));
        expect(seen).toEqual([42, 43]);

        expect(subscription.removeImage(12345)).toBeNull();
        expect(subscription.removeImage(2001)).toBe(second);
        expect(second.isClosed()).toBe(true);
        expect(rig.subscriptionConductor.releaseLogBuffers).toHaveBeenCalledWith(
            rig.logBuffers,
            2001,
            Aeron.NULL_VALUE,
        );
        expect(subscription.imageCount()).toBe(1);
        expect(subscription.removeImage(ClientRig.CORRELATION_ID)).toBe(rig.image);
        expect(subscription.images()).toHaveLength(0);
        expect(subscription.isConnected()).toBe(false);
        expect(subscription.hasNoImages()).toBe(true);
        expect(subscription.poll({ onFragment: () => {} }, 10)).toBe(0);
        expect(subscription.blockPoll({ onBlock: () => {} }, 10)).toBe(0);
        expect(subscription.rawPoll({ onBlock: () => {} }, 10)).toBe(0);
    });

    it('internalClose hands the images to the conductor with the linger, and the closed subscription refuses its destinations', () => {
        // mutation: images not emptied before closeImages, or the closed flag not set
        const rig = new ClientRig();
        const { subscription, subscriptionConductor } = rig;
        subscriptionConductor.asyncAddRcvDestination.mockReturnValue(9);
        subscriptionConductor.asyncRemoveRcvDestination.mockReturnValue(10);

        subscription.addDestination('aeron:udp?endpoint=a:1');
        subscription.removeDestination('aeron:udp?endpoint=a:1');
        expect(subscription.asyncAddDestination('aeron:udp?endpoint=b:1')).toBe(9);
        expect(subscription.asyncRemoveDestination('aeron:udp?endpoint=b:1')).toBe(10);
        expect(subscriptionConductor.addRcvDestination).toHaveBeenCalledWith(
            ClientRig.REGISTRATION_ID,
            'aeron:udp?endpoint=a:1',
        );
        expect(subscriptionConductor.removeRcvDestination).toHaveBeenCalledWith(
            ClientRig.REGISTRATION_ID,
            'aeron:udp?endpoint=a:1',
        );

        const handler = subscription.unavailableImageHandler();
        subscription.internalClose(123);

        expect(subscription.isClosed()).toBe(true);
        expect(subscription.images()).toHaveLength(0);
        expect(subscriptionConductor.closeImages).toHaveBeenCalledTimes(1);
        expect(subscriptionConductor.closeImages).toHaveBeenCalledWith([rig.image], handler, 123);
        expect(subscription.channelStatus()).toBe(-1);
        expect(() => subscription.addDestination('x')).toThrow('Subscription is closed');
        expect(() => subscription.removeDestination('x')).toThrow('Subscription is closed');
        expect(() => subscription.asyncAddDestination('x')).toThrow('Subscription is closed');
        expect(() => subscription.asyncRemoveDestination('x')).toThrow('Subscription is closed');
        expect(subscription.toString()).toContain('Subscription{registrationId=1000, isClosed=true, isConnected=false');
        subscriptionConductor.removeSubscription.mockClear();
        subscription.close(); // a closed subscription does not call the conductor again
        expect(subscriptionConductor.removeSubscription).not.toHaveBeenCalled();
    });

    it('rejecting an image of a spy subscription is refused, and of a normal one goes to the conductor', () => {
        // mutation: the SPY_PREFIX test removed
        const rig = new ClientRig();
        rig.image.reject('no good');
        expect(rig.subscriptionConductor.rejectImage).toHaveBeenCalledWith(ClientRig.CORRELATION_ID, 0, 'no good');

        const spy = new (rig.subscription.constructor as new (...args: unknown[]) => typeof rig.subscription)(
            rig.subscriptionConductor,
            'aeron-spy:aeron:udp?endpoint=localhost:1',
            1,
            5,
            { onAvailableImage: () => {} },
            { onUnavailableImage: () => {} },
        );
        expect(() => spy.rejectImage(1, 0, 'x')).toThrow('spies can not reject images');
    });

    it('the channel status and the socket addresses are asked of the conductor with the channel status id', () => {
        // mutation: the id passed as the registration id
        const rig = new ClientRig();
        rig.subscription.channelStatusId(77);
        rig.subscriptionConductor.channelStatus.mockReturnValue(1);

        expect(rig.subscription.channelStatusId()).toBe(77);
        expect(rig.subscription.channelStatus()).toBe(1);
        expect(rig.subscriptionConductor.channelStatus).toHaveBeenCalledWith(77);
        expect(rig.publication.channelStatusId()).toBe(-1);
    });
});

describe('DirectBufferVector extra', () => {
    it('validates the offset and the length against the capacity, and the sum of the lengths against an int', () => {
        // mutation: `>=` for `>` in the offset check, or the sum not wrapped to an int
        const capacity = (n: number): UnsafeBuffer => ({ capacity: () => n }) as unknown as UnsafeBuffer;
        const buffer = new UnsafeBuffer(new Uint8Array(100));

        expect(new DirectBufferVector(buffer, 0, 100).validate().length()).toBe(100);
        expect(new DirectBufferVector(buffer, 99, 1).validate().offset()).toBe(99);
        expect(() => new DirectBufferVector(buffer, 100, 0).validate()).toThrow('offset=100 capacity=100');
        expect(() => new DirectBufferVector(buffer, -1, 0).validate()).toThrow('offset=-1 capacity=100');
        expect(() => new DirectBufferVector(buffer, 0, 101).validate()).toThrow('offset=0 capacity=100 length=101');
        expect(() => new DirectBufferVector(buffer, 0, -1).validate()).toThrow('offset=0 capacity=100 length=-1');

        const big = new DirectBufferVector(capacity(0x7fffffff), 0, 0x7fffffff);
        expect(DirectBufferVector.validateAndComputeLength([big])).toBe(0x7fffffff);
        expect(() => DirectBufferVector.validateAndComputeLength([big, big])).toThrow(IllegalStateException);
        expect(() => DirectBufferVector.validateAndComputeLength([big, big])).toThrow(
            'length overflow: [DirectBufferVector{',
        );
        expect(DirectBufferVector.validateAndComputeLength([])).toBe(0);

        const vector = new DirectBufferVector();
        expect(vector.reset(buffer, 5, 6)).toBe(vector);
        expect(vector.buffer(buffer).offset(7).length(8)).toBe(vector);
        expect([vector.offset(), vector.length(), vector.buffer()]).toEqual([7, 8, buffer]);
        expect(vector.toString()).toContain('offset=7, length=8}');
    });
});
