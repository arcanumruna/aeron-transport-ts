// Not in Aeron (issue #6, spec 5.5): the one pair of `long` position helpers in `LogBufferDescriptor`,
// `termCountByPosition` and `termOffsetByPosition`, checked against a `bigint` reference over positions up to 2^53 - 1,
// and the three callers that used to do their own arithmetic (`LogBufferUnblocker`, `ChannelUri.initialPosition`,
// `ChannelUriStringBuilder.initialPosition`).
import { describe, expect, it } from 'vitest';
import { ChannelUri } from '../../../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../../../src/client/ChannelUriStringBuilder.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import type { ControlledFragmentHandler } from '../../../../src/client/logbuffer/ControlledFragmentHandler.js';
import { ControlledFragmentHandler as CFH } from '../../../../src/client/logbuffer/ControlledFragmentHandler.js';
import { ControlledMessageHandler as CMH } from '../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import type { ControlledMessageHandler } from '../../../../src/agrona/concurrent/ControlledMessageHandler.js';
import type { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';

const TERM_LENGTHS = [64 * 1024, 128 * 1024, 1 << 20, 16 << 20, 1 << 30];
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// A xorshift32 stream, seeded, so a failure replays.
function positions(seed: number, count: number): number[] {
    let s = seed >>> 0 || 1;
    const out: number[] = [0, 32, 64, 2 ** 31, 2 ** 32 - 32, 2 ** 32, 2 ** 32 + 32, 2 ** 40, MAX_SAFE - 31, MAX_SAFE];
    for (let i = 0; i < count; i++) {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        const hi = s & 0x1fffff;
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        out.push(hi * 2 ** 32 + s);
    }
    return out;
}

describe('PositionArithmeticRegression', () => {
    it('termCountByPositionMatchesBigIntReference', () => {
        for (const termLength of TERM_LENGTHS) {
            const bits = LogBufferDescriptor.positionBitsToShift(termLength);
            for (const position of positions(7, 2000)) {
                const expected = Number(BigInt.asIntN(32, BigInt(position) >> BigInt(bits)));
                expect(LogBufferDescriptor.termCountByPosition(position, bits)).toBe(expected);
            }
        }
    });

    it('termOffsetByPositionMatchesBigIntReference', () => {
        for (const termLength of TERM_LENGTHS) {
            for (const position of positions(11, 2000)) {
                const expected = Number(BigInt(position) & BigInt(termLength - 1));
                expect(LogBufferDescriptor.termOffsetByPosition(position, termLength)).toBe(expected);
            }
        }
    });

    it('channelUriInitialPositionUsesTheHelperResultsAboveTwoToThe32', () => {
        const termLength = 64 * 1024;
        const initialTermId = 1234;
        const position = 2 ** 40 + 4096 + 64;
        const bits = LogBufferDescriptor.positionBitsToShift(termLength);
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:4000');
        uri.initialPosition(position, initialTermId, termLength);
        expect(uri.get('term-offset')).toBe(String(LogBufferDescriptor.termOffsetByPosition(position, termLength)));
        expect(uri.get('term-id')).toBe(
            String(LogBufferDescriptor.computeTermIdFromPosition(position, bits, initialTermId)),
        );

        const builder = new ChannelUriStringBuilder().media('udp').endpoint('localhost:4000');
        builder.initialPosition(position, initialTermId, termLength);
        expect(builder.termOffset()).toBe(LogBufferDescriptor.termOffsetByPosition(position, termLength));
    });

    it('nestedEnumsAreTypesAsWellAsValues', () => {
        const fragmentAction: ControlledFragmentHandler.Action = CFH.Action.COMMIT;
        const messageAction: ControlledMessageHandler.Action = CMH.Action.BREAK;
        const metaData: CountersReader.MetaData = () => {};
        expect(fragmentAction.name()).toBe('COMMIT');
        expect(messageAction.name()).toBe('BREAK');
        expect(typeof metaData).toBe('function');
    });
});
