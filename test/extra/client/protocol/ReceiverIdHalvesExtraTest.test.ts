// Not in Aeron: receiverIdHigh / receiverIdLow of StatusMessageFlyweight, RttMeasurementFlyweight and ErrorFlyweight
// (spec D14), the int halves of the 8 byte little endian receiver id field, so that no `bigint` is on the status
// message path. Round trips against the bigint receiverId.
import { describe, expect, it } from 'vitest';
import { ErrorFlyweight } from '../../../../src/client/protocol/ErrorFlyweight.js';
import { RttMeasurementFlyweight } from '../../../../src/client/protocol/RttMeasurementFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { mulberry32 } from '../../../support/Random.js';

const INT32_MIN = -2147483648;

interface WithReceiverId {
    receiverId(): bigint;
    receiverId(id: bigint): unknown;
    receiverIdHigh(): number;
    receiverIdHigh(high: number): unknown;
    receiverIdLow(): number;
    receiverIdLow(low: number): unknown;
}

const random = mulberry32(21);
const randomValue = BigInt.asIntN(
    64,
    (BigInt((random() * 4294967296) >>> 0) << 32n) | BigInt((random() * 4294967296) >>> 0),
);
const VALUES = [0n, -1n, 2n ** 63n - 1n, -(2n ** 63n), 1n, 0x1_0000_0000n, 0xffff_ffffn, randomValue];

const FLYWEIGHTS: [string, () => WithReceiverId][] = [
    ['StatusMessageFlyweight', () => new StatusMessageFlyweight(new Uint8Array(64)) as unknown as WithReceiverId],
    ['RttMeasurementFlyweight', () => new RttMeasurementFlyweight(new Uint8Array(64)) as unknown as WithReceiverId],
    ['ErrorFlyweight', () => new ErrorFlyweight(new Uint8Array(64)) as unknown as WithReceiverId],
];

describe.each(FLYWEIGHTS)('%s receiverId halves', (_name, create) => {
    it.each(VALUES)('bigint set -> halves read: %s', (value) => {
        const flyweight = create();
        flyweight.receiverId(value);

        expect(flyweight.receiverIdHigh()).toBe(Number(BigInt.asIntN(32, value >> 32n)));
        expect(flyweight.receiverIdLow()).toBe(Number(BigInt.asIntN(32, value)));
    });

    it.each(VALUES)('halves set -> bigint read: %s', (value) => {
        const flyweight = create();
        const high = Number(BigInt.asIntN(32, value >> 32n));
        const low = Number(BigInt.asIntN(32, value));

        expect(flyweight.receiverIdHigh(high)).toBe(flyweight);
        expect(flyweight.receiverIdLow(low)).toBe(flyweight);

        expect(flyweight.receiverId()).toBe(value);
        expect(flyweight.receiverIdHigh()).toBe(high);
        expect(flyweight.receiverIdLow()).toBe(low);
    });

    it('each setter changes only its half', () => {
        const flyweight = create();
        flyweight.receiverId(0x1234_5678_9abc_def0n);

        flyweight.receiverIdLow(-1);
        expect(flyweight.receiverId()).toBe(0x1234_5678_ffff_ffffn);

        flyweight.receiverIdHigh(INT32_MIN);
        expect(flyweight.receiverId()).toBe(BigInt.asIntN(64, 0x8000_0000_ffff_ffffn));
    });
});

describe('receiverId halves layout', () => {
    it('low half at the field offset, high half at +4, little endian', () => {
        const bytes = new Uint8Array(64);
        const flyweight = new ErrorFlyweight(bytes);
        flyweight.receiverIdLow(0x04030201).receiverIdHigh(0x08070605);

        const offset = ErrorFlyweight.RECEIVER_ID_FIELD_OFFSET;
        expect(Array.from(bytes.subarray(offset, offset + 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
});
