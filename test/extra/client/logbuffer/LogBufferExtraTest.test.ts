// Not in Aeron: the interaction matrix rows for positions (T9, plan "Interaction matrix"): `computePosition`,
// `computeTermIdFromPosition` and the term begin position with `initialTermId` at 0, -1, INT32_MAX and INT32_MIN, term
// lengths of 64 KiB and 1 GiB, positions near 2^53 - 1 and the term id wrap, each checked against a `bigint` model
// of Java's `long` arithmetic; the raw tail pack / unpack at the extremes; every metadata accessor; `FrameDescriptor`;
// `Header`, `HeaderWriter` and `BufferClaim` over every field.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import {
    ArithmeticException,
    IllegalArgumentException,
    IllegalStateException,
    ByteOrder,
} from '../../../../src/agrona/jdk.js';
import { Aeron } from '../../../../src/client/Aeron.js';
import { Action, ControlledFragmentHandler } from '../../../../src/client/logbuffer/ControlledFragmentHandler.js';
import { BufferClaim } from '../../../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../../src/client/logbuffer/Header.js';
import { HeaderWriter } from '../../../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { assertThrows } from '../../../support/Assertions.js';
import { mulberry32 } from '../../../support/Random.js';

const { LITTLE_ENDIAN } = ByteOrder;
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const INITIAL_TERM_IDS = [0, 1, -1, INT32_MAX, INT32_MIN, 12345, -98765];
const TERM_LENGTHS = [64 * 1024, 128 * 1024, 1024 * 1024, 64 * 1024 * 1024, 1024 * 1024 * 1024];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Java's `(int)` of a `bigint`. */
const int = (value: bigint): number => Number(BigInt.asIntN(32, value));

/** The model of `computePosition`: Java's `long` arithmetic on `bigint`s. */
function modelPosition(activeTermId: number, termOffset: number, shift: number, initialTermId: number): bigint {
    const termCount = BigInt(int(BigInt(activeTermId) - BigInt(initialTermId)));
    return BigInt.asIntN(64, (termCount << BigInt(shift)) + BigInt(termOffset));
}

describe('LogBufferDescriptor extra: positions', () => {
    it('constants and the layout of the metadata', () => {
        expect(LogBufferDescriptor.PARTITION_COUNT).toBe(3);
        expect(LogBufferDescriptor.LOG_META_DATA_SECTION_INDEX).toBe(3);
        expect(LogBufferDescriptor.TERM_MIN_LENGTH).toBe(65536);
        expect(LogBufferDescriptor.TERM_MAX_LENGTH).toBe(1073741824);
        expect(LogBufferDescriptor.PAGE_MIN_SIZE).toBe(4096);
        expect(LogBufferDescriptor.PAGE_MAX_SIZE).toBe(1073741824);
        expect(LogBufferDescriptor.LOG_BUFFER_TYPE_CONCURRENT_PUBLICATION).toBe(0);
        expect(LogBufferDescriptor.LOG_BUFFER_TYPE_EXCLUSIVE_PUBLICATION).toBe(1);
        expect(LogBufferDescriptor.LOG_BUFFER_TYPE_PUBLICATION_IMAGE).toBe(2);
        expect(LogBufferDescriptor.TERM_TAIL_COUNTERS_OFFSET).toBe(0);
        expect(LogBufferDescriptor.LOG_ACTIVE_TERM_COUNT_OFFSET).toBe(24);
        expect(LogBufferDescriptor.LOG_END_OF_STREAM_POSITION_OFFSET).toBe(128);
        expect(LogBufferDescriptor.LOG_IS_CONNECTED_OFFSET).toBe(136);
        expect(LogBufferDescriptor.LOG_ACTIVE_TRANSPORT_COUNT).toBe(140);
        expect(LogBufferDescriptor.LOG_CORRELATION_ID_OFFSET).toBe(256);
        expect(LogBufferDescriptor.LOG_INITIAL_TERM_ID_OFFSET).toBe(264);
        expect(LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_LENGTH_OFFSET).toBe(268);
        expect(LogBufferDescriptor.LOG_MTU_LENGTH_OFFSET).toBe(272);
        expect(LogBufferDescriptor.LOG_TERM_LENGTH_OFFSET).toBe(276);
        expect(LogBufferDescriptor.LOG_PAGE_SIZE_OFFSET).toBe(280);
        expect(LogBufferDescriptor.LOG_PUBLICATION_WINDOW_LENGTH_OFFSET).toBe(284);
        expect(LogBufferDescriptor.LOG_RECEIVER_WINDOW_LENGTH_OFFSET).toBe(288);
        expect(LogBufferDescriptor.LOG_SOCKET_SNDBUF_LENGTH_OFFSET).toBe(292);
        expect(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_SNDBUF_LENGTH_OFFSET).toBe(296);
        expect(LogBufferDescriptor.LOG_OS_MAX_SOCKET_SNDBUF_LENGTH_OFFSET).toBe(300);
        expect(LogBufferDescriptor.LOG_SOCKET_RCVBUF_LENGTH_OFFSET).toBe(304);
        expect(LogBufferDescriptor.LOG_OS_DEFAULT_SOCKET_RCVBUF_LENGTH_OFFSET).toBe(308);
        expect(LogBufferDescriptor.LOG_OS_MAX_SOCKET_RCVBUF_LENGTH_OFFSET).toBe(312);
        expect(LogBufferDescriptor.LOG_MAX_RESEND_OFFSET).toBe(316);
        expect(LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_OFFSET).toBe(320);
        expect(LogBufferDescriptor.LOG_DEFAULT_FRAME_HEADER_MAX_LENGTH).toBe(128);
        expect(LogBufferDescriptor.LOG_ENTITY_TAG_OFFSET).toBe(448);
        expect(LogBufferDescriptor.LOG_RESPONSE_CORRELATION_ID_OFFSET).toBe(456);
        expect(LogBufferDescriptor.LOG_LINGER_TIMEOUT_NS_OFFSET).toBe(464);
        expect(LogBufferDescriptor.LOG_UNTETHERED_WINDOW_LIMIT_TIMEOUT_NS_OFFSET).toBe(472);
        expect(LogBufferDescriptor.LOG_UNTETHERED_RESTING_TIMEOUT_NS_OFFSET).toBe(480);
        expect(LogBufferDescriptor.LOG_GROUP_OFFSET).toBe(488);
        expect(LogBufferDescriptor.LOG_IS_RESPONSE_OFFSET).toBe(489);
        expect(LogBufferDescriptor.LOG_REJOIN_OFFSET).toBe(490);
        expect(LogBufferDescriptor.LOG_RELIABLE_OFFSET).toBe(491);
        expect(LogBufferDescriptor.LOG_SPARSE_OFFSET).toBe(492);
        expect(LogBufferDescriptor.LOG_SIGNAL_EOS_OFFSET).toBe(493);
        expect(LogBufferDescriptor.LOG_SPIES_SIMULATE_CONNECTION_OFFSET).toBe(494);
        expect(LogBufferDescriptor.LOG_TETHER_OFFSET).toBe(495);
        expect(LogBufferDescriptor.LOG_IS_PUBLICATION_REVOKED_OFFSET).toBe(496);
        expect(LogBufferDescriptor.LOG_TYPE_OFFSET).toBe(497);
        expect(LogBufferDescriptor.LOG_UNTETHERED_LINGER_TIMEOUT_NS_OFFSET).toBe(500);
        expect(LogBufferDescriptor.LOG_META_DATA_LENGTH).toBe(4096);
    });

    it.each(INITIAL_TERM_IDS)('computePosition against the model, initialTermId %d', (initialTermId) => {
        const next = mulberry32(0x9051 + initialTermId);
        for (const termLength of TERM_LENGTHS) {
            const shift = LogBufferDescriptor.positionBitsToShift(termLength);
            for (let i = 0; i < 100; i++) {
                const termCount = Math.floor(next() * 2 ** (53 - shift));
                const activeTermId = (initialTermId + termCount) | 0;
                const termOffset = Math.floor(next() * termLength);
                const expected = modelPosition(activeTermId, termOffset, shift, initialTermId);

                if (expected <= MAX_SAFE && expected >= -MAX_SAFE) {
                    expect(
                        BigInt(LogBufferDescriptor.computePosition(activeTermId, termOffset, shift, initialTermId)),
                    ).toBe(expected);
                } else {
                    assertThrows(RangeError, () =>
                        LogBufferDescriptor.computePosition(activeTermId, termOffset, shift, initialTermId),
                    );
                }
            }
        }
    });

    it.each(INITIAL_TERM_IDS)(
        'computePosition, term begin and term id round trip, initialTermId %d',
        (initialTermId) => {
            const next = mulberry32(0x7e11 ^ initialTermId);
            for (const termLength of TERM_LENGTHS) {
                const shift = LogBufferDescriptor.positionBitsToShift(termLength);
                const maxTermCount = Math.min(2 ** 31, 2 ** (53 - shift));
                for (let i = 0; i < 100; i++) {
                    const termCount = Math.floor(next() * maxTermCount);
                    const activeTermId = (initialTermId + termCount) | 0;
                    const termOffset = Math.floor(next() * termLength);
                    const position = LogBufferDescriptor.computePosition(
                        activeTermId,
                        termOffset,
                        shift,
                        initialTermId,
                    );

                    expect(LogBufferDescriptor.computeTermIdFromPosition(position, shift, initialTermId)).toBe(
                        activeTermId,
                    );
                    expect(LogBufferDescriptor.computeTermBeginPosition(activeTermId, shift, initialTermId)).toBe(
                        position - termOffset,
                    );
                    expect(position % termLength).toBe(termOffset);
                    expect(LogBufferDescriptor.indexByPosition(position, shift)).toBe(termCount % 3);
                    expect(LogBufferDescriptor.indexByTerm(initialTermId, activeTermId)).toBe(termCount % 3);
                }
            }
        },
    );

    it('the term id wraps at INT32_MAX and the position keeps counting', () => {
        const shift = 16;
        const begin = LogBufferDescriptor.computeTermBeginPosition(INT32_MAX, shift, INT32_MAX - 1);
        expect(begin).toBe(65536);
        expect(LogBufferDescriptor.computeTermBeginPosition(INT32_MIN, shift, INT32_MAX - 1)).toBe(2 * 65536);
        expect(LogBufferDescriptor.computeTermBeginPosition(INT32_MIN + 1, shift, INT32_MAX - 1)).toBe(3 * 65536);
        expect(LogBufferDescriptor.computeTermIdFromPosition(3 * 65536, shift, INT32_MAX - 1)).toBe(INT32_MIN + 1);
        expect(LogBufferDescriptor.computeTermIdFromPosition(2 * 65536 + 100, shift, INT32_MAX - 1)).toBe(INT32_MIN);
    });

    it('a position near 2^53 - 1 is exact and one past it is a RangeError', () => {
        const shift = 30;
        const termCount = 2 ** 23 - 1; // 2^53 - 2^30 is the first term begin below the limit
        const limit = (termCount + 1) * 2 ** 30 - 1;

        expect(LogBufferDescriptor.computePosition(termCount, 2 ** 30 - 1, shift, 0)).toBe(limit);
        expect(limit).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        expect(LogBufferDescriptor.computeTermIdFromPosition(limit, shift, 0)).toBe(termCount);
        assertThrows(RangeError, () => LogBufferDescriptor.computePosition(termCount + 1, 2 ** 30 - 1, shift, 0));
        assertThrows(RangeError, () => LogBufferDescriptor.computeTermBeginPosition(INT32_MAX, shift, 0));
        expect(LogBufferDescriptor.computeTermBeginPosition(-1, shift, 0)).toBe(-(2 ** 30));
    });

    it('computeTermIdFromPosition and indexByPosition read a negative position as the unsigned 64-bit value', () => {
        for (const position of [-1, -65536, -(2 ** 40), -(2 ** 53 - 1)]) {
            for (const shift of [0, 16, 30]) {
                const unsigned = BigInt.asUintN(64, BigInt(position)) >> BigInt(shift);
                expect(LogBufferDescriptor.computeTermIdFromPosition(position, shift, 7)).toBe(int(unsigned + 7n));
                expect(LogBufferDescriptor.indexByPosition(position, shift)).toBe(Number(unsigned % 3n));
            }
        }
    });

    it('indexByTermCount, nextPartitionIndex and indexByTerm', () => {
        for (let termCount = 0; termCount < 30; termCount++) {
            expect(LogBufferDescriptor.indexByTermCount(termCount)).toBe(termCount % 3);
        }
        expect(LogBufferDescriptor.nextPartitionIndex(0)).toBe(1);
        expect(LogBufferDescriptor.nextPartitionIndex(1)).toBe(2);
        expect(LogBufferDescriptor.nextPartitionIndex(2)).toBe(0);
        // Java's `%` keeps the sign of the dividend: a term id behind the initial one gives a negative index
        expect(LogBufferDescriptor.indexByTerm(10, 7)).toBe(0);
        expect(LogBufferDescriptor.indexByTerm(10, 8)).toBe(-2);
        expect(LogBufferDescriptor.indexByTerm(INT32_MAX, INT32_MIN)).toBe(1);
    });

    it('positionBitsToShift for every term length, and a RangeError-free throw for any other', () => {
        for (let shift = 16; shift <= 30; shift++) {
            expect(LogBufferDescriptor.positionBitsToShift(2 ** shift)).toBe(shift);
        }
        for (const bad of [0, 1, 65535, 65537, 3 * 65536, 2 ** 31, -65536]) {
            const error = assertThrows(IllegalArgumentException, () => LogBufferDescriptor.positionBitsToShift(bad));
            expect(error.message).toBe('invalid term buffer length: ' + bad);
        }
    });

    it('computeLogLength', () => {
        expect(LogBufferDescriptor.computeLogLength(65536, 4096)).toBe(3 * 65536 + 4096);
        expect(LogBufferDescriptor.computeLogLength(65536, 2 * 1024 * 1024)).toBe(2 * 1024 * 1024);
        expect(LogBufferDescriptor.computeLogLength(1024 * 1024 * 1024, 4096)).toBe(3 * 1024 * 1024 * 1024 + 4096);
        expect(LogBufferDescriptor.computeLogLength(1024 * 1024 * 1024, 1024 * 1024 * 1024)).toBe(
            4 * 1024 * 1024 * 1024,
        );
    });

    it('checkTermLength at 0, 1, the bounds and one beyond', () => {
        for (const ok of [65536, 131072, 1024 * 1024 * 1024]) {
            LogBufferDescriptor.checkTermLength(ok);
        }
        for (const bad of [0, 1, 65535, 32768, 1024 * 1024 * 1024 + 1, 2 * 1024 * 1024 * 1024 - 1, 65537, 100000]) {
            assertThrows(IllegalStateException, () => LogBufferDescriptor.checkTermLength(bad));
        }
        expect(assertThrows(IllegalStateException, () => LogBufferDescriptor.checkTermLength(65535)).message).toBe(
            'Term length less than min length of 65536: length=65535',
        );
        expect(
            assertThrows(IllegalStateException, () => LogBufferDescriptor.checkTermLength(2 ** 31 - 1)).message,
        ).toBe('Term length more than max length of 1073741824: length=2147483647');
        expect(assertThrows(IllegalStateException, () => LogBufferDescriptor.checkTermLength(65537)).message).toBe(
            'Term length not a power of 2: length=65537',
        );
    });

    it('checkPageSize at 0, 1, the bounds and one beyond', () => {
        for (const ok of [4096, 8192, 1024 * 1024 * 1024]) {
            LogBufferDescriptor.checkPageSize(ok);
        }
        for (const bad of [0, 1, 4095, 2048, 1024 * 1024 * 1024 + 1, 4097, 5000]) {
            assertThrows(IllegalStateException, () => LogBufferDescriptor.checkPageSize(bad));
        }
        expect(assertThrows(IllegalStateException, () => LogBufferDescriptor.checkPageSize(4095)).message).toBe(
            'Page size less than min size of 4096: page size=4095',
        );
        expect(assertThrows(IllegalStateException, () => LogBufferDescriptor.checkPageSize(2 ** 31 - 1)).message).toBe(
            'Page size more than max size of 1073741824: page size=2147483647',
        );
        expect(assertThrows(IllegalStateException, () => LogBufferDescriptor.checkPageSize(4097)).message).toBe(
            'Page size not a power of 2: page size=4097',
        );
    });

    it('computeFragmentedFrameLength and computeAssembledFrameLength against a model', () => {
        const next = mulberry32(0xf2a9);
        for (let i = 0; i < 2000; i++) {
            const maxPayload = 32 * (1 + Math.floor(next() * 2047)) - 32; // 0 .. 65504 in frame steps
            const length = Math.floor(next() * 16 * 1024 * 1024);
            if (0 === maxPayload) {
                assertThrows(ArithmeticException, () => LogBufferDescriptor.computeFragmentedFrameLength(length, 0));
                assertThrows(ArithmeticException, () => LogBufferDescriptor.computeAssembledFrameLength(length, 0));
                continue;
            }
            const full = Math.trunc(length / maxPayload);
            const rest = length % maxPayload;
            const last = rest > 0 ? Math.ceil((rest + 32) / 32) * 32 : 0;
            expect(LogBufferDescriptor.computeFragmentedFrameLength(length, maxPayload)).toBe(
                full * (maxPayload + 32) + last,
            );
            expect(LogBufferDescriptor.computeAssembledFrameLength(length, maxPayload)).toBe(
                32 + full * maxPayload + rest,
            );
        }
    });

    it('computeFragmentedFrameLength wraps like a Java int', () => {
        // 2^31 - 1 bytes in frames of 1 byte payload: the product wraps in Java
        const expected = Number(BigInt.asIntN(32, BigInt(2 ** 31 - 1) * 33n));
        expect(LogBufferDescriptor.computeFragmentedFrameLength(2 ** 31 - 1, 1)).toBe(expected);
    });
});

describe('LogBufferDescriptor extra: raw tail', () => {
    const TERM_IDS = [0, 1, -1, INT32_MAX, INT32_MIN, 5, -5, 123456789];
    const OFFSETS = [0, 1, 32, 65536, 1024 * 1024 * 1024, INT32_MAX];

    it.each(TERM_IDS)('packTail, termId and termOffset of term id %d', (termId) => {
        for (const termOffset of OFFSETS) {
            const packed = LogBufferDescriptor.packTail(termId, termOffset);

            expect(packed).toBe(BigInt.asIntN(64, (BigInt(termId) << 32n) | BigInt(termOffset)));
            expect(packed >= -(2n ** 63n) && packed < 2n ** 63n).toBe(true);
            expect(LogBufferDescriptor.termId(packed)).toBe(termId);
            expect(LogBufferDescriptor.termOffset(packed)).toBe(termOffset);
            expect(LogBufferDescriptor.termOffset(packed, 2 ** 30)).toBe(Math.min(termOffset, 2 ** 30));
            expect(LogBufferDescriptor.termOffset(packed, 64)).toBe(Math.min(termOffset, 64));
        }
    });

    it('a tail beyond the term length is limited to it; an offset above INT32_MAX reads as unsigned', () => {
        // a message that overran the end of the term leaves a low half above termLength, up to 2^32 - 1
        const overrun = (5n << 32n) | 0xfffffff0n;

        expect(LogBufferDescriptor.termId(overrun)).toBe(5);
        expect(LogBufferDescriptor.termOffset(overrun, 65536)).toBe(65536);
        expect(LogBufferDescriptor.termOffset(overrun, 2 ** 30)).toBe(2 ** 30);
        expect(LogBufferDescriptor.termOffset(overrun)).toBe(-16);
    });

    it('packTail with a negative term offset sign-extends as Java does', () => {
        expect(LogBufferDescriptor.packTail(5, -1)).toBe(-1n);
        expect(LogBufferDescriptor.termId(LogBufferDescriptor.packTail(5, -1))).toBe(-1);
    });

    it('the metadata buffer holds a raw tail as two little-endian halves, offset low, term id high', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        for (const termId of TERM_IDS) {
            for (const termOffset of [0, 1024, 65536]) {
                LogBufferDescriptor.rawTail(buffer, 1, LogBufferDescriptor.packTail(termId, termOffset));

                expect(buffer.getInt(8, LITTLE_ENDIAN)).toBe(termOffset);
                expect(buffer.getInt(12, LITTLE_ENDIAN)).toBe(termId);
                expect(LogBufferDescriptor.rawTailTermId(buffer, 1)).toBe(termId);
                expect(LogBufferDescriptor.rawTailTermOffset(buffer, 1, 65536)).toBe(Math.min(termOffset, 65536));
                expect(LogBufferDescriptor.rawTailVolatile(buffer, 1)).toBe(LogBufferDescriptor.rawTail(buffer, 1));
            }
        }
    });

    it('rawTailTermOffset reads the low half as unsigned and limits it to the term length', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        buffer.putInt(16, -16); // 0xfffffff0
        buffer.putInt(20, 9);

        expect(LogBufferDescriptor.rawTailTermOffset(buffer, 2, 65536)).toBe(65536);
        expect(LogBufferDescriptor.rawTailTermOffset(buffer, 2, 2 ** 30)).toBe(2 ** 30);
        expect(LogBufferDescriptor.rawTailTermId(buffer, 2)).toBe(9);
    });

    it('initialiseTailWithTermId writes offset 0 and the term id, and no other slot', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        buffer.byteArray().fill(0xff);

        LogBufferDescriptor.initialiseTailWithTermId(buffer, 1, INT32_MIN);

        expect(LogBufferDescriptor.rawTail(buffer, 1)).toBe(LogBufferDescriptor.packTail(INT32_MIN, 0));
        expect(LogBufferDescriptor.rawTail(buffer, 0)).toBe(-1n);
        expect(LogBufferDescriptor.rawTail(buffer, 2)).toBe(-1n);
    });

    it('casRawTail succeeds only for the expected value and leaves the slot otherwise', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        const a = LogBufferDescriptor.packTail(INT32_MIN, 7);
        const b = LogBufferDescriptor.packTail(INT32_MAX, INT32_MAX);
        LogBufferDescriptor.rawTail(buffer, 2, a);

        expect(LogBufferDescriptor.casRawTail(buffer, 2, b, a)).toBe(false);
        expect(LogBufferDescriptor.rawTail(buffer, 2)).toBe(a);
        expect(LogBufferDescriptor.casRawTail(buffer, 2, a, b)).toBe(true);
        expect(LogBufferDescriptor.rawTail(buffer, 2)).toBe(b);
        expect(LogBufferDescriptor.casRawTail(buffer, 2, a, b)).toBe(false);
    });

    it('rawTailVolatile of the active partition follows the active term count', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        for (let index = 0; index < 3; index++) {
            LogBufferDescriptor.rawTailVolatile(buffer, index, LogBufferDescriptor.packTail(100 + index, index));
        }

        for (let termCount = 0; termCount < 9; termCount++) {
            LogBufferDescriptor.activeTermCount(buffer, termCount);
            expect(LogBufferDescriptor.rawTailVolatile(buffer)).toBe(
                LogBufferDescriptor.packTail(100 + (termCount % 3), termCount % 3),
            );
        }
    });

    it('rotateLog over many terms, with term ids that wrap, keeps the three tails consistent', () => {
        for (const initialTermId of [0, INT32_MAX - 4, INT32_MIN, -7]) {
            const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            for (let i = 0; i < 3; i++) {
                LogBufferDescriptor.initialiseTailWithTermId(buffer, i, (initialTermId + i - 3) | 0);
            }
            LogBufferDescriptor.initialiseTailWithTermId(buffer, 0, initialTermId);
            LogBufferDescriptor.activeTermCount(buffer, 0);

            for (let termCount = 0; termCount < 50; termCount++) {
                const termId = (initialTermId + termCount) | 0;
                expect(LogBufferDescriptor.rawTailTermId(buffer, termCount % 3)).toBe(termId);

                expect(LogBufferDescriptor.rotateLog(buffer, termCount, termId)).toBe(true);

                expect(LogBufferDescriptor.activeTermCount(buffer)).toBe(termCount + 1);
                expect(LogBufferDescriptor.rawTailVolatile(buffer)).toBe(
                    LogBufferDescriptor.packTail((termId + 1) | 0, 0),
                );
                // the same rotation a second time finds the active term count moved on
                expect(LogBufferDescriptor.rotateLog(buffer, termCount, termId)).toBe(false);
                expect(LogBufferDescriptor.activeTermCount(buffer)).toBe(termCount + 1);
            }
        }
    });

    it('casActiveTermCount and activeTermCountOrdered', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        LogBufferDescriptor.activeTermCount(buffer, INT32_MAX);

        expect(LogBufferDescriptor.casActiveTermCount(buffer, 5, 6)).toBe(false);
        expect(LogBufferDescriptor.casActiveTermCount(buffer, INT32_MAX, INT32_MIN)).toBe(true);
        expect(LogBufferDescriptor.activeTermCount(buffer)).toBe(INT32_MIN);
        LogBufferDescriptor.activeTermCountOrdered(buffer, -1);
        expect(LogBufferDescriptor.activeTermCount(buffer)).toBe(-1);
        expect(buffer.getInt(24, LITTLE_ENDIAN)).toBe(-1);
    });
});

describe('LogBufferDescriptor extra: metadata accessors', () => {
    const newBuffer = (): UnsafeBuffer => new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));

    type IntAccessor = [string, number, (b: UnsafeBuffer) => number, (b: UnsafeBuffer, v: number) => void];
    const INT_FIELDS: IntAccessor[] = [
        [
            'initialTermId',
            264,
            (b) => LogBufferDescriptor.initialTermId(b),
            (b, v) => LogBufferDescriptor.initialTermId(b, v),
        ],
        ['mtuLength', 272, (b) => LogBufferDescriptor.mtuLength(b), (b, v) => LogBufferDescriptor.mtuLength(b, v)],
        ['termLength', 276, (b) => LogBufferDescriptor.termLength(b), (b, v) => LogBufferDescriptor.termLength(b, v)],
        ['pageSize', 280, (b) => LogBufferDescriptor.pageSize(b), (b, v) => LogBufferDescriptor.pageSize(b, v)],
        [
            'publicationWindowLength',
            284,
            (b) => LogBufferDescriptor.publicationWindowLength(b),
            (b, v) => LogBufferDescriptor.publicationWindowLength(b, v),
        ],
        [
            'receiverWindowLength',
            288,
            (b) => LogBufferDescriptor.receiverWindowLength(b),
            (b, v) => LogBufferDescriptor.receiverWindowLength(b, v),
        ],
        [
            'socketSndbufLength',
            292,
            (b) => LogBufferDescriptor.socketSndbufLength(b),
            (b, v) => LogBufferDescriptor.socketSndbufLength(b, v),
        ],
        [
            'osDefaultSocketSndbufLength',
            296,
            (b) => LogBufferDescriptor.osDefaultSocketSndbufLength(b),
            (b, v) => LogBufferDescriptor.osDefaultSocketSndbufLength(b, v),
        ],
        [
            'osMaxSocketSndbufLength',
            300,
            (b) => LogBufferDescriptor.osMaxSocketSndbufLength(b),
            (b, v) => LogBufferDescriptor.osMaxSocketSndbufLength(b, v),
        ],
        [
            'socketRcvbufLength',
            304,
            (b) => LogBufferDescriptor.socketRcvbufLength(b),
            (b, v) => LogBufferDescriptor.socketRcvbufLength(b, v),
        ],
        [
            'osDefaultSocketRcvbufLength',
            308,
            (b) => LogBufferDescriptor.osDefaultSocketRcvbufLength(b),
            (b, v) => LogBufferDescriptor.osDefaultSocketRcvbufLength(b, v),
        ],
        [
            'osMaxSocketRcvbufLength',
            312,
            (b) => LogBufferDescriptor.osMaxSocketRcvbufLength(b),
            (b, v) => LogBufferDescriptor.osMaxSocketRcvbufLength(b, v),
        ],
        ['maxResend', 316, (b) => LogBufferDescriptor.maxResend(b), (b, v) => LogBufferDescriptor.maxResend(b, v)],
        [
            'activeTransportCount',
            140,
            (b) => LogBufferDescriptor.activeTransportCount(b),
            (b, v) => LogBufferDescriptor.activeTransportCount(b, v),
        ],
        [
            'activeTermCount',
            24,
            (b) => LogBufferDescriptor.activeTermCount(b),
            (b, v) => LogBufferDescriptor.activeTermCount(b, v),
        ],
    ];

    for (const [name, offset, get, set] of INT_FIELDS) {
        it.each([0, 1, -1, INT32_MAX, INT32_MIN])(`${name} %d is a little-endian int at ${offset}`, (value) => {
            const buffer = newBuffer();

            set(buffer, value);

            expect(get(buffer)).toBe(value);
            expect(buffer.getInt(offset, LITTLE_ENDIAN)).toBe(value);
            let others = 0;
            for (let i = 0; i < buffer.capacity(); i++) {
                if (i < offset || i >= offset + 4) {
                    others |= buffer.getByte(i);
                }
            }
            expect(others).toBe(0);
        });
    }

    type BoolAccessor = [string, number, (b: UnsafeBuffer) => boolean, (b: UnsafeBuffer, v: boolean) => void];
    const BOOL_FIELDS: BoolAccessor[] = [
        ['sparse', 492, (b) => LogBufferDescriptor.sparse(b), (b, v) => LogBufferDescriptor.sparse(b, v)],
        ['tether', 495, (b) => LogBufferDescriptor.tether(b), (b, v) => LogBufferDescriptor.tether(b, v)],
        [
            'isPublicationRevoked',
            496,
            (b) => LogBufferDescriptor.isPublicationRevoked(b),
            (b, v) => LogBufferDescriptor.isPublicationRevoked(b, v),
        ],
        ['group', 488, (b) => LogBufferDescriptor.group(b), (b, v) => LogBufferDescriptor.group(b, v)],
        ['isResponse', 489, (b) => LogBufferDescriptor.isResponse(b), (b, v) => LogBufferDescriptor.isResponse(b, v)],
        ['rejoin', 490, (b) => LogBufferDescriptor.rejoin(b), (b, v) => LogBufferDescriptor.rejoin(b, v)],
        ['reliable', 491, (b) => LogBufferDescriptor.reliable(b), (b, v) => LogBufferDescriptor.reliable(b, v)],
        ['signalEos', 493, (b) => LogBufferDescriptor.signalEos(b), (b, v) => LogBufferDescriptor.signalEos(b, v)],
        [
            'spiesSimulateConnection',
            494,
            (b) => LogBufferDescriptor.spiesSimulateConnection(b),
            (b, v) => LogBufferDescriptor.spiesSimulateConnection(b, v),
        ],
    ];
    for (const [name, offset, get, set] of BOOL_FIELDS) {
        it(`${name} is one byte, 1 or 0, at ${offset}`, () => {
            const buffer = newBuffer();
            expect(get(buffer)).toBe(false);

            set(buffer, true);
            expect(get(buffer)).toBe(true);
            expect(buffer.getByte(offset)).toBe(1);

            set(buffer, false);
            expect(get(buffer)).toBe(false);
            expect(buffer.getByte(offset)).toBe(0);

            buffer.putByte(offset, 2); // only 1 is true
            expect(get(buffer)).toBe(false);
        });
    }

    it('isConnected is an int, 1 or 0, at 136', () => {
        const buffer = newBuffer();

        LogBufferDescriptor.isConnected(buffer, true);
        expect(LogBufferDescriptor.isConnected(buffer)).toBe(true);
        expect(buffer.getInt(136, LITTLE_ENDIAN)).toBe(1);
        LogBufferDescriptor.isConnected(buffer, false);
        expect(LogBufferDescriptor.isConnected(buffer)).toBe(false);
        buffer.putInt(136, 2);
        expect(LogBufferDescriptor.isConnected(buffer)).toBe(false);
    });

    it.each([0, 1, -1, 127, -128])('type %d is a signed byte at 497', (value) => {
        const buffer = newBuffer();

        LogBufferDescriptor.type(buffer, value);

        expect(LogBufferDescriptor.type(buffer)).toBe(value);
        expect(buffer.getByte(497)).toBe(value);
    });

    type LongAccessor = [string, number, (b: UnsafeBuffer) => number, (b: UnsafeBuffer, v: number) => void];
    const LONG_FIELDS: LongAccessor[] = [
        [
            'endOfStreamPosition',
            128,
            (b) => LogBufferDescriptor.endOfStreamPosition(b),
            (b, v) => LogBufferDescriptor.endOfStreamPosition(b, v),
        ],
        [
            'untetheredWindowLimitTimeoutNs',
            472,
            (b) => LogBufferDescriptor.untetheredWindowLimitTimeoutNs(b),
            (b, v) => LogBufferDescriptor.untetheredWindowLimitTimeoutNs(b, v),
        ],
        [
            'untetheredLingerTimeoutNs',
            500,
            (b) => LogBufferDescriptor.untetheredLingerTimeoutNs(b),
            (b, v) => LogBufferDescriptor.untetheredLingerTimeoutNs(b, v),
        ],
        [
            'untetheredRestingTimeoutNs',
            480,
            (b) => LogBufferDescriptor.untetheredRestingTimeoutNs(b),
            (b, v) => LogBufferDescriptor.untetheredRestingTimeoutNs(b, v),
        ],
        [
            'lingerTimeoutNs',
            464,
            (b) => LogBufferDescriptor.lingerTimeoutNs(b),
            (b, v) => LogBufferDescriptor.lingerTimeoutNs(b, v),
        ],
    ];
    for (const [name, offset, get, set] of LONG_FIELDS) {
        it.each([0, 1, -1, 2 ** 31, 2 ** 53 - 1, -(2 ** 53 - 1)])(
            `${name} %d is a little-endian long at ${offset}`,
            (value) => {
                const buffer = newBuffer();

                set(buffer, value);

                expect(get(buffer)).toBe(value);
                expect(buffer.getLongBigInt(offset, LITTLE_ENDIAN)).toBe(BigInt(value));
            },
        );
        it(`${name} throws RangeError for a long a number cannot hold (spec D5) and writes nothing`, () => {
            const buffer = newBuffer();

            assertThrows(RangeError, () => set(buffer, 2 ** 53));
            expect(buffer.getLongBigInt(offset, LITTLE_ENDIAN)).toBe(0n);
        });
    }

    type BigAccessor = [string, number, (b: UnsafeBuffer) => bigint, (b: UnsafeBuffer, v: bigint) => void];
    const BIG_FIELDS: BigAccessor[] = [
        [
            'correlationId',
            256,
            (b) => LogBufferDescriptor.correlationId(b),
            (b, v) => LogBufferDescriptor.correlationId(b, v),
        ],
        ['entityTag', 448, (b) => LogBufferDescriptor.entityTag(b), (b, v) => LogBufferDescriptor.entityTag(b, v)],
        [
            'responseCorrelationId',
            456,
            (b) => LogBufferDescriptor.responseCorrelationId(b),
            (b, v) => LogBufferDescriptor.responseCorrelationId(b, v),
        ],
    ];
    for (const [name, offset, get, set] of BIG_FIELDS) {
        it.each([0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)])(
            `${name} %d is a little-endian bigint at ${offset}`,
            (value) => {
                const buffer = newBuffer();

                set(buffer, value);

                expect(get(buffer)).toBe(value);
                expect(buffer.getLongBigInt(offset, LITTLE_ENDIAN)).toBe(value);
            },
        );
    }

    it('the default frame header is stored, wrapped and applied', () => {
        const metadata = newBuffer();
        const defaultHeader = new UnsafeBuffer(new Uint8Array(DataHeaderFlyweight.HEADER_LENGTH));
        for (let i = 0; i < defaultHeader.capacity(); i++) {
            defaultHeader.putByte(i, i + 1);
        }

        LogBufferDescriptor.storeDefaultFrameHeader(metadata, defaultHeader);

        expect(metadata.getInt(268, LITTLE_ENDIAN)).toBe(DataHeaderFlyweight.HEADER_LENGTH);
        const wrapped = LogBufferDescriptor.defaultFrameHeader(metadata);
        expect(wrapped.capacity()).toBe(DataHeaderFlyweight.HEADER_LENGTH);
        for (let i = 0; i < wrapped.capacity(); i++) {
            expect(wrapped.getByte(i)).toBe(i + 1);
        }
        const term = new UnsafeBuffer(new Uint8Array(256));
        LogBufferDescriptor.applyDefaultHeader(metadata, term, 64);
        for (let i = 0; i < 256; i++) {
            expect(term.getByte(i)).toBe(i >= 64 && i < 96 ? i - 64 + 1 : 0);
        }
    });

    it('storeDefaultFrameHeader rejects a header that is not HEADER_LENGTH long', () => {
        for (const length of [0, 1, 31, 33, 64]) {
            const error = assertThrows(IllegalArgumentException, () =>
                LogBufferDescriptor.storeDefaultFrameHeader(newBuffer(), new UnsafeBuffer(new Uint8Array(length))),
            );
            expect(error.message).toBe('Default header length not equal to HEADER_LENGTH: length=' + length);
        }
    });
});

describe('FrameDescriptor extra', () => {
    it('constants', () => {
        expect(FrameDescriptor.MAX_MESSAGE_LENGTH).toBe(16777216);
        expect(FrameDescriptor.FRAME_ALIGNMENT).toBe(32);
        expect(FrameDescriptor.BEGIN_FRAG_FLAG).toBe(-128);
        expect(FrameDescriptor.END_FRAG_FLAG).toBe(64);
        expect(FrameDescriptor.UNFRAGMENTED).toBe(-64);
        expect(FrameDescriptor.UNFRAGMENTED & 0xff).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
        expect(FrameDescriptor.VERSION_OFFSET).toBe(4);
        expect(FrameDescriptor.FLAGS_OFFSET).toBe(5);
        expect(FrameDescriptor.TYPE_OFFSET).toBe(6);
        expect(FrameDescriptor.TERM_OFFSET).toBe(8);
        expect(FrameDescriptor.SESSION_ID_OFFSET).toBe(12);
        expect(FrameDescriptor.TERM_ID_OFFSET).toBe(20);
        expect(FrameDescriptor.PADDING_FRAME_TYPE).toBe(0);
    });

    it('computeMaxMessageLength is an eighth of the term, capped', () => {
        expect(FrameDescriptor.computeMaxMessageLength(64 * 1024)).toBe(8192);
        expect(FrameDescriptor.computeMaxMessageLength(128 * 1024 * 1024)).toBe(16 * 1024 * 1024);
        expect(FrameDescriptor.computeMaxMessageLength(1024 * 1024 * 1024)).toBe(16 * 1024 * 1024);
        expect(FrameDescriptor.computeMaxMessageLength(0)).toBe(0);
    });

    it('the offset functions add the field offsets to the frame offset', () => {
        for (const termOffset of [0, 32, 1024, 65504]) {
            expect(FrameDescriptor.lengthOffset(termOffset)).toBe(termOffset);
            expect(FrameDescriptor.versionOffset(termOffset)).toBe(termOffset + 4);
            expect(FrameDescriptor.flagsOffset(termOffset)).toBe(termOffset + 5);
            expect(FrameDescriptor.typeOffset(termOffset)).toBe(termOffset + 6);
            expect(FrameDescriptor.termOffsetOffset(termOffset)).toBe(termOffset + 8);
            expect(FrameDescriptor.sessionIdOffset(termOffset)).toBe(termOffset + 12);
            expect(FrameDescriptor.termIdOffset(termOffset)).toBe(termOffset + 20);
        }
    });

    it('isFrameAligned at every residue and at the extremes', () => {
        for (let length = -64; length <= 128; length++) {
            expect(FrameDescriptor.isFrameAligned(length)).toBe(length % 32 === 0);
        }
        expect(FrameDescriptor.isFrameAligned(INT32_MIN)).toBe(true);
        expect(FrameDescriptor.isFrameAligned(INT32_MAX)).toBe(false);
        expect(FrameDescriptor.isFrameAligned(INT32_MAX - 31)).toBe(true);
    });

    it('every field is written and read at its own offset, with the signedness of Java', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(256));
        const termOffset = 64;

        FrameDescriptor.frameFlags(buffer, termOffset, FrameDescriptor.UNFRAGMENTED);
        FrameDescriptor.frameType(buffer, termOffset, 0xffff);
        FrameDescriptor.frameTermOffset(buffer, termOffset);
        FrameDescriptor.frameTermId(buffer, termOffset, INT32_MIN);
        FrameDescriptor.frameSessionId(buffer, termOffset, -2);
        FrameDescriptor.frameLengthOrdered(buffer, termOffset, -96);

        expect(FrameDescriptor.frameVersion(buffer, termOffset)).toBe(0);
        expect(FrameDescriptor.frameFlags(buffer, termOffset)).toBe(-64);
        expect(buffer.getByte(termOffset + 5) & 0xff).toBe(0xc0);
        expect(FrameDescriptor.frameType(buffer, termOffset)).toBe(0xffff);
        expect(FrameDescriptor.isPaddingFrame(buffer, termOffset)).toBe(false);
        expect(buffer.getInt(termOffset + 8, LITTLE_ENDIAN)).toBe(termOffset);
        expect(FrameDescriptor.frameTermId(buffer, termOffset)).toBe(INT32_MIN);
        expect(FrameDescriptor.frameSessionId(buffer, termOffset)).toBe(-2);
        expect(FrameDescriptor.frameLength(buffer, termOffset)).toBe(-96);
        expect(FrameDescriptor.frameLengthVolatile(buffer, termOffset)).toBe(-96);

        FrameDescriptor.frameType(buffer, termOffset, HeaderFlyweight.HDR_TYPE_PAD);
        expect(FrameDescriptor.isPaddingFrame(buffer, termOffset)).toBe(true);
        FrameDescriptor.frameType(buffer, termOffset, HeaderFlyweight.HDR_TYPE_DATA);
        expect(FrameDescriptor.isPaddingFrame(buffer, termOffset)).toBe(false);
    });

    it('the flags constants agree with the flyweight flags', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(64));
        for (const [frag, flyweight] of [
            [FrameDescriptor.BEGIN_FRAG_FLAG, DataHeaderFlyweight.BEGIN_FLAG],
            [FrameDescriptor.END_FRAG_FLAG, DataHeaderFlyweight.END_FLAG],
            [FrameDescriptor.UNFRAGMENTED, DataHeaderFlyweight.BEGIN_AND_END_FLAGS],
        ] as const) {
            FrameDescriptor.frameFlags(buffer, 0, frag);
            expect(buffer.getByte(5) & 0xff).toBe(flyweight);
            expect(new DataHeaderFlyweight(buffer).flags()).toBe(flyweight);
        }
    });
});

describe('Header extra', () => {
    function frame(termOffset: number, frameLength: number, termId: number): { buffer: UnsafeBuffer; offset: number } {
        const buffer = new UnsafeBuffer(new Uint8Array(512));
        const offset = 64;
        const flyweight = new DataHeaderFlyweight();
        flyweight.wrap(buffer, offset, 64);
        flyweight.frameLength(frameLength);
        flyweight.termOffset(termOffset).termId(termId);
        return { buffer, offset };
    }

    it('new Header has no context, offset 0 and no fragmented frame length', () => {
        const header = new Header(1, 2);

        expect(header.context()).toBe(null);
        expect(header.offset()).toBe(0);
        expect(header.fragmentedFrameLength()).toBe(Aeron.NULL_VALUE);
    });

    it('the setters return the header', () => {
        const header = new Header(1, 2);
        const buffer = new UnsafeBuffer(new Uint8Array(64));

        expect(header.context('a')).toBe(header);
        expect(header.context()).toBe('a');
        expect(header.context(null).context()).toBe(null);
        expect(header.initialTermId(5)).toBe(header);
        expect(header.positionBitsToShift(6)).toBe(header);
        expect(header.offset(7)).toBe(header);
        expect(header.buffer(buffer)).toBe(header);
        expect(header.buffer()).toBe(buffer);
        header.fragmentedFrameLength(96);
        expect(header.fragmentedFrameLength()).toBe(96);
    });

    it.each([0, 1, 31, 32, 33, 1000, 65536 - 32])(
        'nextTermOffset aligns termOffset + frameLength, frame length %d',
        (frameLength) => {
            const { buffer, offset } = frame(1024, frameLength, 3);
            const header = new Header(0, 16);
            header.buffer(buffer).offset(offset);

            expect(header.nextTermOffset()).toBe(Math.ceil((1024 + frameLength) / 32) * 32);
        },
    );

    it('a fragmented frame length replaces the frame length in the position', () => {
        const { buffer, offset } = frame(1024, 100, 3);
        const header = new Header(0, 16);
        header.buffer(buffer).offset(offset);
        const single = header.position();

        header.fragmentedFrameLength(2080);

        expect(header.position()).toBe(3 * 65536 + 1024 + 2080);
        expect(header.position()).toBeGreaterThan(single);
        header.fragmentedFrameLength(Aeron.NULL_VALUE);
        expect(header.position()).toBe(single);
    });

    it.each(INITIAL_TERM_IDS)(
        'position at initialTermId %d is the model position of the next frame',
        (initialTermId) => {
            for (const termLength of [64 * 1024, 1024 * 1024 * 1024]) {
                const shift = LogBufferDescriptor.positionBitsToShift(termLength);
                for (const termCount of [0, 1, 2, 3, 100]) {
                    const termId = (initialTermId + termCount) | 0;
                    const { buffer, offset } = frame(32, 100, termId);
                    const header = new Header(initialTermId, shift);
                    header.buffer(buffer).offset(offset);

                    expect(BigInt(header.position())).toBe(modelPosition(termId, 160, shift, initialTermId));
                }
            }
        },
    );

    it('the fields are read from the offset in the buffer, and the flags are a signed byte', () => {
        const buffer = new UnsafeBuffer(new Uint8Array(256));
        const writer = new DataHeaderFlyweight();
        writer.wrap(buffer, 100, 32);
        writer.frameLength(INT32_MAX).version(0).flags(0xc0).headerType(0xfffe);
        writer
            .termOffset(-1)
            .sessionId(INT32_MIN)
            .streamId(INT32_MAX)
            .termId(-5)
            .reservedValue(-(2n ** 63n));
        const header = new Header(0, 16);
        header.buffer(buffer).offset(100);

        expect(header.frameLength()).toBe(INT32_MAX);
        expect(header.flags()).toBe(-64);
        expect(header.type()).toBe(0xfffe);
        expect(header.termOffset()).toBe(-1);
        expect(header.sessionId()).toBe(INT32_MIN);
        expect(header.streamId()).toBe(INT32_MAX);
        expect(header.termId()).toBe(-5);
        expect(header.reservedValue()).toBe(-(2n ** 63n));
    });
});

describe('HeaderWriter extra', () => {
    it('newInstance returns a HeaderWriter holding the three default header words', () => {
        const defaultHeader = new UnsafeBuffer(new Uint8Array(32));
        defaultHeader.putInt(4, 0x12345678);
        defaultHeader.putInt(12, -3);
        defaultHeader.putInt(16, INT32_MIN);

        const writer = HeaderWriter.newInstance(defaultHeader);

        expect(writer).toBeInstanceOf(HeaderWriter);
        expect(writer.versionFlagsType).toBe(0x12345678);
        expect(writer.sessionId).toBe(-3);
        expect(writer.streamId).toBe(INT32_MIN);
    });

    it('write fills the first 24 bytes of the frame, leaves every other byte alone and fills the same as the flyweight', () => {
        const next = mulberry32(0x4e11);
        for (let i = 0; i < 300; i++) {
            const defaultHeader = new UnsafeBuffer(new Uint8Array(32));
            const dh = new DataHeaderFlyweight(defaultHeader);
            dh.version(next() * 256)
                .flags(next() * 256)
                .headerType(next() * 65536);
            dh.sessionId((next() * 2 ** 32) | 0).streamId((next() * 2 ** 32) | 0);
            const offset = 32 * Math.floor(next() * 30);
            const length = 32 + 32 * Math.floor(next() * 1000);
            const termId = (next() * 2 ** 32) | 0;
            const term = new UnsafeBuffer(new Uint8Array(1024).fill(0xa5));

            HeaderWriter.newInstance(defaultHeader).write(term, offset, length, termId);

            const expected = new UnsafeBuffer(new Uint8Array(1024).fill(0xa5));
            const flyweight = new DataHeaderFlyweight();
            flyweight.wrap(expected, offset, 24);
            flyweight.frameLength(-length).version(dh.version()).flags(dh.flags()).headerType(dh.headerType());
            flyweight.termOffset(offset).sessionId(dh.sessionId()).streamId(dh.streamId()).termId(termId);
            for (let b = 0; b < 1024; b++) {
                expect(term.getByte(b)).toBe(expected.getByte(b));
            }
            // bytes 24..31 of the frame (the reserved value) are not written
            for (let b = offset + 24; b < offset + 32 && b < 1024; b++) {
                expect(term.getByte(b) & 0xff).toBe(0xa5);
            }
        }
    });

    it('write stores the negative length, as an uncommitted frame, and INT32_MIN length stays INT32_MIN', () => {
        const writer = HeaderWriter.newInstance(new UnsafeBuffer(new Uint8Array(32)));
        const term = new UnsafeBuffer(new Uint8Array(128));

        writer.write(term, 32, 64, 7);
        expect(FrameDescriptor.frameLength(term, 32)).toBe(-64);
        writer.write(term, 32, INT32_MIN, 7);
        expect(FrameDescriptor.frameLength(term, 32)).toBe(INT32_MIN);
        writer.write(term, 32, 0, 7);
        expect(FrameDescriptor.frameLength(term, 32)).toBe(0);
    });

    it('write at the end of the buffer throws and writes nothing past it', () => {
        const writer = HeaderWriter.newInstance(new UnsafeBuffer(new Uint8Array(32)));
        const term = new UnsafeBuffer(new Uint8Array(64));

        expect(() => writer.write(term, 48, 32, 1)).toThrow();
        expect(() => writer.write(term, 41, 32, 1)).toThrow();
    });
});

describe('BufferClaim extra', () => {
    function claim(capacity = 128): { claim: BufferClaim; term: UnsafeBuffer } {
        const term = new UnsafeBuffer(new Uint8Array(256).fill(0xa5));
        const bufferClaim = new BufferClaim();
        bufferClaim.wrap(term, 64, capacity);
        return { claim: bufferClaim, term };
    }

    it('an empty claim has no length', () => {
        expect(new BufferClaim().buffer().capacity()).toBe(0);
    });

    it('offset is the header length and length the rest of the claimed region', () => {
        for (const capacity of [32, 33, 64, 128, 192]) {
            const { claim: c } = claim(capacity);

            expect(c.offset()).toBe(DataHeaderFlyweight.HEADER_LENGTH);
            expect(c.length()).toBe(capacity - 32);
            expect(c.buffer().capacity()).toBe(capacity);
        }
    });

    it('buffer is a window over the term buffer', () => {
        const { claim: c, term } = claim();

        c.buffer().putByte(c.offset(), 0x11);
        c.buffer().putInt(c.offset() + 4, 0x22334455);

        expect(term.getByte(64 + 32)).toBe(0x11);
        expect(term.getInt(64 + 32 + 4)).toBe(0x22334455);
    });

    it.each([0, 1, 0x7fff, 0x8000, 0xffff])('headerType %d is two bytes at offset 6 of the claim', (type) => {
        const { claim: c, term } = claim();

        expect(c.headerType(type)).toBe(c);

        expect(c.headerType()).toBe(type);
        expect(term.getShort(64 + 6, LITTLE_ENDIAN) & 0xffff).toBe(type);
    });

    it.each([0, 1, 0x3f, 0x40, 0x7f, -128, -64, -1])('flags %d is a signed byte at offset 5 of the claim', (flags) => {
        const { claim: c, term } = claim();

        expect(c.flags(flags)).toBe(c);

        expect(c.flags()).toBe(flags);
        expect(term.getByte(64 + 5)).toBe(flags);
    });

    it.each([0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)])(
        'reservedValue %d is a bigint at offset 24 of the claim',
        (value) => {
            const { claim: c, term } = claim();

            expect(c.reservedValue(value)).toBe(c);

            expect(c.reservedValue()).toBe(value);
            expect(term.getLongBigInt(64 + 24, LITTLE_ENDIAN)).toBe(value);
        },
    );

    it('putBytes copies after the header and returns the claim', () => {
        const { claim: c, term } = claim();
        const source = new UnsafeBuffer(Uint8Array.of(9, 8, 7, 6, 5));

        expect(c.putBytes(source, 1, 3)).toBe(c);

        expect([8, 7, 6].map((_, i) => term.getByte(64 + 32 + i))).toEqual([8, 7, 6]);
        expect(term.getByte(64 + 32 + 3) & 0xff).toBe(0xa5);
    });

    it('commit publishes the capacity as the frame length and nothing else', () => {
        const { claim: c, term } = claim(96);
        const before = Array.from({ length: 256 }, (_, i) => term.getByte(i));

        c.commit();

        expect(term.getInt(64, LITTLE_ENDIAN)).toBe(96);
        for (let i = 0; i < 256; i++) {
            if (i < 64 || i >= 68) {
                expect(term.getByte(i)).toBe(before[i]);
            }
        }
    });

    it('abort turns the frame into padding of the capacity length', () => {
        const { claim: c, term } = claim(96);
        c.headerType(HeaderFlyweight.HDR_TYPE_DATA).flags(FrameDescriptor.UNFRAGMENTED);

        c.abort();

        expect(term.getInt(64, LITTLE_ENDIAN)).toBe(96);
        expect(FrameDescriptor.isPaddingFrame(term, 64)).toBe(true);
        expect(c.headerType()).toBe(HeaderFlyweight.HDR_TYPE_PAD);
        expect(c.flags()).toBe(FrameDescriptor.UNFRAGMENTED);
    });

    it('wrap again moves the claim', () => {
        const { claim: c, term } = claim(64);

        c.wrap(term, 128, 96);
        c.commit();

        expect(term.getInt(128, LITTLE_ENDIAN)).toBe(96);
        expect(c.length()).toBe(64);
    });

    it('wrap beyond the buffer throws', () => {
        const term = new UnsafeBuffer(new Uint8Array(64));
        const bufferClaim = new BufferClaim();

        expect(() => bufferClaim.wrap(term, 32, 64)).toThrow();
        expect(() => bufferClaim.wrap(term, -1, 8)).toThrow();
    });
});

describe('ControlledFragmentHandler.Action', () => {
    it('keeps the ordinal order of Java', () => {
        expect(Action.values().map((a) => a.name())).toEqual(['ABORT', 'BREAK', 'COMMIT', 'CONTINUE']);
        expect(Action.values().map((a) => a.ordinal())).toEqual([0, 1, 2, 3]);
        expect(String(Action.COMMIT)).toBe('COMMIT');
        expect(ControlledFragmentHandler.Action).toBe(Action);
    });
});
