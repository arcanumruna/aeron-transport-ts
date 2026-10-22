// Not in Aeron: the four protocol flyweights are on the hot path (the receiver and sender build and read frames with
// them), so every int getter and setter and the predicates allocate nothing per call (spec 5.3). Each loop is one
// flyweight, so that the calls fit the inlining budget of the optimizing compiler. The values stay below 2^30 so
// that no int is boxed. The `bigint` fields allocate a BigInt by nature and are not covered.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { expectNoAllocation } from '../../../support/Allocation.js';

const ITERATIONS = 1_000_000;
const sum = new Int32Array(1);

describe('FlyweightsHotPathAllocationTest', () => {
    it('headerFlyweightFieldsAllocateNothing', async () => {
        const flyweight = new HeaderFlyweight(new Uint8Array(32));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight
                    .version(i & 0xff)
                    .flags(i & 0x7f)
                    .headerType(i & 0x7fff)
                    .frameLength(i);
                sum[0] = (sum[0]! + flyweight.version() + flyweight.flags() + flyweight.headerType()) | 0;
                sum[0] = (sum[0]! + flyweight.frameLength()) | 0;
            }
        }, ITERATIONS);
    });

    it('dataHeaderFlyweightFieldsAllocateNothing', async () => {
        const flyweight = new DataHeaderFlyweight(new Uint8Array(32));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight
                    .sessionId(i)
                    .streamId(i + 1)
                    .termId(i + 2)
                    .termOffset(i + 3);
                sum[0] = (sum[0]! + flyweight.sessionId() + flyweight.streamId()) | 0;
                sum[0] = (sum[0]! + flyweight.termId() + flyweight.termOffset() + flyweight.dataOffset()) | 0;
            }
        }, ITERATIONS);
    });

    it('dataHeaderFlyweightStaticReadersAllocateNothing', async () => {
        const term = new UnsafeBuffer(new Uint8Array(64));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                term.putInt(0, 32 + (i & 0xff));
                term.putInt(8, i);
                term.putInt(12, i + 1);
                sum[0] = (sum[0]! + DataHeaderFlyweight.fragmentLength(term, 0)) | 0;
                sum[0] = (sum[0]! + DataHeaderFlyweight.sessionId(term, 0) + DataHeaderFlyweight.streamId(term, 0)) | 0;
                sum[0] = (sum[0]! + DataHeaderFlyweight.termId(term, 0) + DataHeaderFlyweight.termOffset(term, 0)) | 0;
            }
        }, ITERATIONS);
    });

    it('dataHeaderFlyweightPredicatesAllocateNothing', async () => {
        const packet = new UnsafeBuffer(new Uint8Array(64));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                packet.putByte(HeaderFlyweight.FLAGS_FIELD_OFFSET, i & 0xff);
                packet.putInt(0, i & 1 ? 0 : 32);
                sum[0] = (sum[0]! + (DataHeaderFlyweight.isHeartbeat(packet, i & 1 ? 32 : 0) ? 1 : 0)) | 0;
                sum[0] = (sum[0]! + (DataHeaderFlyweight.isEndOfStream(packet) ? 1 : 0)) | 0;
                sum[0] = (sum[0]! + (DataHeaderFlyweight.isRevoked(packet) ? 1 : 0)) | 0;
            }
        }, ITERATIONS);
    });

    it('nakFlyweightFieldsAndIsValidAllocateNothing', async () => {
        const flyweight = new NakFlyweight(new Uint8Array(32));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight
                    .sessionId(i)
                    .streamId(i + 1)
                    .termId(i + 2)
                    .termOffset((i & 0xff) << 5)
                    .length(i & 0xff);
                sum[0] = (sum[0]! + flyweight.sessionId() + flyweight.streamId() + flyweight.termId()) | 0;
                sum[0] = (sum[0]! + flyweight.termOffset() + flyweight.length()) | 0;
                sum[0] = (sum[0]! + (flyweight.isValid(65536) ? 1 : 0)) | 0;
            }
        }, ITERATIONS);
    });

    it('statusMessageFlyweightFieldsAndIsValidAllocateNothing', async () => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(48));

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight
                    .sessionId(i)
                    .streamId(i + 1)
                    .consumptionTermId(i + 2)
                    .consumptionTermOffset((i & 0xff) << 5)
                    .receiverWindowLength(i & 0xffff);
                sum[0] = (sum[0]! + flyweight.sessionId() + flyweight.streamId() + flyweight.consumptionTermId()) | 0;
                sum[0] = (sum[0]! + flyweight.consumptionTermOffset() + flyweight.receiverWindowLength()) | 0;
                sum[0] = (sum[0]! + flyweight.asfLength() + (flyweight.isValid(65536) ? 1 : 0)) | 0;
            }
        }, ITERATIONS);
    });

    it('theLoopsExerciseWhatTheyClaimTo', () => {
        const nak = new NakFlyweight(new Uint8Array(32));
        nak.sessionId(5).termOffset(64).length(8);
        expect(nak.sessionId()).toBe(5);
        expect(nak.isValid(65536)).toBe(true);
    });
});
