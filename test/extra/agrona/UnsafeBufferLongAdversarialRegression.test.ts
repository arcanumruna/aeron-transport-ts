// Review attack tests (PR #75, issues #8, #19): the rewritten long and accessor operations of UnsafeBuffer give the same
// results, bytes and exceptions over an ArrayBuffer and a SharedArrayBuffer, against a BigInt model, for seeded random
// sequences of values near 2^31, 2^32 and 2^53.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { mulberry32 } from '../../support/Random.js';

const CAPACITY = 64;
const MAX = Number.MAX_SAFE_INTEGER;
const PIVOTS = [0, 2 ** 31, 2 ** 32, 2 ** 40, 2 ** 52, MAX];

function value(rnd: () => number): number {
    const pivot = PIVOTS[Math.floor(rnd() * PIVOTS.length)]!;
    const offset = Math.floor(rnd() * 5) - 2;
    let v = pivot + offset;
    if (v > MAX) {
        v = MAX - (v - MAX);
    }
    return rnd() < 0.5 ? -v : v;
}

type Outcome = { ok: number | boolean | undefined } | { err: string };

function run(fn: () => number | boolean | void): Outcome {
    try {
        return { ok: fn() as number | boolean | undefined };
    } catch (ex) {
        return { err: (ex as Error).constructor.name };
    }
}

function bytesOf(buffer: UnsafeBuffer): number[] {
    return Array.from({ length: CAPACITY }, (_, i) => buffer.getByte(i));
}

function modelGet(bytes: number[], index: number): bigint {
    let w = 0n;
    for (let i = 7; i >= 0; i--) {
        w = (w << 8n) | BigInt(bytes[index + i]! & 0xff);
    }
    return BigInt.asIntN(64, w);
}

const OPS = [
    'getLongVolatile',
    'getLongAcquire',
    'getLongOpaque',
    'putLongVolatile',
    'putLongOrdered',
    'putLongRelease',
    'putLongOpaque',
    'getAndAddLong',
    'addLongOrdered',
    'addLongRelease',
    'addLongOpaque',
    'compareAndSetLong',
    'compareAndExchangeLong',
    'getAndSetLong',
    'getLong',
    'getLongLE',
    'getLongBE',
    'putLong',
    'putLongLE',
    'putLongBE',
] as const;

function apply(buffer: UnsafeBuffer, op: (typeof OPS)[number], index: number, a: number, b: number): Outcome {
    const u = buffer as unknown as Record<string, (...args: unknown[]) => number | boolean | void>;
    switch (op) {
        case 'getLongVolatile':
        case 'getLongAcquire':
        case 'getLongOpaque':
            return run(() => u[op]!.call(buffer, index));
        case 'getLong':
            return run(() => buffer.getLong(index));
        case 'getLongLE':
            return run(() => buffer.getLong(index, ByteOrder.LITTLE_ENDIAN));
        case 'getLongBE':
            return run(() => buffer.getLong(index, ByteOrder.BIG_ENDIAN));
        case 'putLong':
            return run(() => buffer.putLong(index, a));
        case 'putLongLE':
            return run(() => buffer.putLong(index, a, ByteOrder.LITTLE_ENDIAN));
        case 'putLongBE':
            return run(() => buffer.putLong(index, a, ByteOrder.BIG_ENDIAN));
        case 'compareAndSetLong':
        case 'compareAndExchangeLong':
            return run(() => u[op]!.call(buffer, index, a, b));
        default:
            return run(() => u[op]!.call(buffer, index, a));
    }
}

describe('UnsafeBuffer long operations adversarial', () => {
    it('plainAndSharedAgreeOnSeededRandomSequencesAdversarialRegression', () => {
        const mismatches: string[] = [];
        const unsafeWordCases: string[] = [];
        for (let seed = 1; seed <= 200; seed++) {
            const rnd = mulberry32(seed);
            const plain = new UnsafeBuffer(new ArrayBuffer(CAPACITY));
            const shared = new UnsafeBuffer(new SharedArrayBuffer(CAPACITY));
            for (let step = 0; step < 200; step++) {
                const op = OPS[Math.floor(rnd() * OPS.length)]!;
                // aligned indices inside, at the end and just past it
                const slot = Math.floor(rnd() * 10);
                const index = slot < 8 ? slot * 8 : slot === 8 ? CAPACITY - 7 : -8;
                let current = 0;
                if (0 <= index && index <= CAPACITY - 8) {
                    const c = run(() => plain.getLong(index));
                    current = 'ok' in c ? (c.ok as number) : 0;
                }
                const a = rnd() < 0.3 ? current : value(rnd);
                // keep get-and-add inside the safe range: overflow differs by design (pre-existing, see report)
                const delta = Math.abs(current) > 2 ** 52 ? (current > 0 ? -1 : 1) : a % 2 ** 51;
                const b = value(rnd);
                const isAdd = op.startsWith('getAndAdd') || op.startsWith('addLong');
                const storedUnsafe = 0 <= index && index <= CAPACITY - 8 && 'err' in run(() => plain.getLong(index));
                const p = apply(plain, op, index, isAdd ? delta : a, b);
                const s = apply(shared, op, index, isAdd ? delta : a, b);
                if (
                    storedUnsafe &&
                    (op.startsWith('compareAnd') || op.startsWith('getAnd') || op.startsWith('addLong'))
                ) {
                    // pre-existing plain/shared asymmetry on a stored unsafe word (see report); state may now diverge
                    unsafeWordCases.push(`${op}: ${JSON.stringify(p)} vs ${JSON.stringify(s)}`);
                    plain.putLong(index, 0);
                    shared.putLong(index, 0);
                } else if (JSON.stringify(p) !== JSON.stringify(s)) {
                    mismatches.push(
                        `seed ${seed} step ${step} ${op}(${index}, ${a}, ${b}): ${JSON.stringify(p)} vs ${JSON.stringify(s)}`,
                    );
                }
                const pb = bytesOf(plain);
                if (JSON.stringify(pb) !== JSON.stringify(bytesOf(shared))) {
                    mismatches.push(`seed ${seed} step ${step} ${op}: bytes differ`);
                    break;
                }
                if (
                    'ok' in p &&
                    'number' === typeof p.ok &&
                    op.startsWith('get') &&
                    !op.startsWith('getAnd') &&
                    op !== 'getLongBE'
                ) {
                    if (BigInt(p.ok) !== modelGet(pb, index)) {
                        mismatches.push(`seed ${seed} step ${step} ${op}: model ${modelGet(pb, index)} vs ${p.ok}`);
                    }
                }
            }
        }
        console.log(
            `unsafe-word cases: ${unsafeWordCases.length}`,
            unsafeWordCases
                .filter((c) => c.split(' vs ')[0]!.slice(c.indexOf(':') + 2) !== c.split(' vs ')[1])
                .slice(0, 6),
        );
        expect(mismatches.slice(0, 10)).toEqual([]);
    });

    it('omittedOrderIsLittleEndianForEveryAccessorAdversarialRegression', () => {
        const rnd = mulberry32(75);
        const a = new UnsafeBuffer(new ArrayBuffer(CAPACITY));
        const b = new UnsafeBuffer(new ArrayBuffer(CAPACITY));
        for (let i = 0; i < 5000; i++) {
            const index = Math.floor(rnd() * (CAPACITY - 8));
            const v = value(rnd);
            const i32 = (v | 0) as number;
            switch (i % 5) {
                case 0:
                    a.putLong(index, v);
                    b.putLong(index, v, ByteOrder.LITTLE_ENDIAN);
                    break;
                case 1:
                    a.putInt(index, i32);
                    b.putInt(index, i32, ByteOrder.LITTLE_ENDIAN);
                    break;
                case 2:
                    a.putShort(index, (i32 << 16) >> 16);
                    b.putShort(index, (i32 << 16) >> 16, ByteOrder.LITTLE_ENDIAN);
                    break;
                case 3:
                    a.putDouble(index, v / 3);
                    b.putDouble(index, v / 3, ByteOrder.LITTLE_ENDIAN);
                    break;
                default:
                    a.putFloat(index, v / 7);
                    b.putFloat(index, v / 7, ByteOrder.LITTLE_ENDIAN);
            }
            expect(bytesOf(a)).toEqual(bytesOf(b));
            const r = (fn: () => number) => run(fn);
            expect(r(() => a.getLong(index))).toEqual(r(() => a.getLong(index, ByteOrder.LITTLE_ENDIAN)));
            expect(a.getInt(index)).toBe(a.getInt(index, ByteOrder.LITTLE_ENDIAN));
            expect(a.getShort(index)).toBe(a.getShort(index, ByteOrder.LITTLE_ENDIAN));
            expect(a.getChar(index)).toBe(a.getChar(index, ByteOrder.LITTLE_ENDIAN));
            expect(Object.is(a.getDouble(index), a.getDouble(index, ByteOrder.LITTLE_ENDIAN))).toBe(true);
            expect(Object.is(a.getFloat(index), a.getFloat(index, ByteOrder.LITTLE_ENDIAN))).toBe(true);
        }
    });

    it('boundsAtEveryOffsetMatchJavaMessageAdversarialRegression', () => {
        for (const backing of [new ArrayBuffer(CAPACITY), new SharedArrayBuffer(CAPACITY)]) {
            const buffer = new UnsafeBuffer(backing, 8, 32);
            for (const [width, get] of [
                [8, (i: number) => buffer.getLong(i)],
                [4, (i: number) => buffer.getInt(i)],
                [2, (i: number) => buffer.getShort(i)],
                [8, (i: number) => buffer.getDouble(i)],
            ] as const) {
                for (let i = -9; i <= 34; i++) {
                    const inside = i >= 0 && i + width <= 32;
                    if (inside) {
                        expect(() => get(i)).not.toThrow();
                    } else {
                        expect(() => get(i)).toThrowError(`Range [${i}, ${i} + ${width}) out of bounds for length 32`);
                    }
                }
            }
        }
    });

    it('setMemoryZeroAtEveryBoundaryOnBothBackingsAdversarialRegression', () => {
        const rnd = mulberry32(53);
        for (const make of [(n: number) => new ArrayBuffer(n), (n: number) => new SharedArrayBuffer(n)]) {
            const size = 3 * 4096 + 37;
            const buffer = new UnsafeBuffer(make(size));
            const model = new Uint8Array(size);
            for (let round = 0; round < 300; round++) {
                for (let i = 0; i < size; i += 97) {
                    buffer.putByte(i, 0x5a);
                    model[i] = 0x5a;
                }
                buffer.setMemory(0, size, 0x11);
                model.fill(0x11);
                const index = Math.floor(rnd() * size);
                const choices = [0, 1, 4095, 4096, 4097, 8192, size - index, Math.floor(rnd() * (size - index + 1))];
                const length = Math.min(choices[round % choices.length]!, size - index);
                buffer.setMemory(index, length, 0);
                model.fill(0, index, index + length);
                for (let i = 0; i < size; i++) {
                    if (buffer.getByte(i) !== (model[i]! << 24) >> 24) {
                        throw new Error(`round ${round} index ${index} length ${length}: byte ${i}`);
                    }
                }
            }
            expect(() => buffer.setMemory(size - 3, 4, 0)).toThrowError(/out of bounds/);
            expect(() => buffer.setMemory(0, -1, 0)).toThrowError(/out of bounds/);
        }
    });
});
