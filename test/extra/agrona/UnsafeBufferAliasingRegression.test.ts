// Not in Agrona: putBytes / getBytes between two views of one ArrayBuffer must copy as memmove does.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';

function pattern(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = (i * 7 + 3) & 0xff;
    }
    return bytes;
}

/** `bytes` after copying `length` bytes from `src` to `dst` as memmove does. */
function expectedAfterMove(bytes: Uint8Array, dst: number, src: number, length: number): Uint8Array {
    const copy = bytes.slice();
    const from = bytes.slice(src, src + length);
    copy.set(from, dst);
    return copy;
}

describe('UnsafeBufferAliasingRegression', () => {
    for (const length of [16, 100]) {
        it(`putBytesFromAnotherBufferOverOneArrayBufferMovesForward length=${length}`, () => {
            const arrayBuffer = new ArrayBuffer(300);
            new Uint8Array(arrayBuffer).set(pattern(300));
            const original = new Uint8Array(arrayBuffer).slice();
            const dst = new UnsafeBuffer(new Uint8Array(arrayBuffer));
            const src = new UnsafeBuffer(arrayBuffer, 4, 200);

            dst.putBytes(8, src, 0, length);

            expect(new Uint8Array(arrayBuffer)).toEqual(expectedAfterMove(original, 8, 4, length));
        });

        it(`putBytesFromAnotherBufferOverOneArrayBufferMovesBackward length=${length}`, () => {
            const arrayBuffer = new ArrayBuffer(300);
            new Uint8Array(arrayBuffer).set(pattern(300));
            const original = new Uint8Array(arrayBuffer).slice();
            const dst = new UnsafeBuffer(new Uint8Array(arrayBuffer));
            const src = new UnsafeBuffer(arrayBuffer, 10, 200);

            dst.putBytes(6, src, 0, length);

            expect(new Uint8Array(arrayBuffer)).toEqual(expectedAfterMove(original, 6, 10, length));
        });

        it(`putBytesWithinOneBufferMovesBothWays length=${length}`, () => {
            for (const [dst, src] of [
                [8, 0],
                [0, 8],
            ] as const) {
                const bytes = pattern(300);
                const original = bytes.slice();
                const buffer = new UnsafeBuffer(bytes);

                buffer.putBytes(dst, buffer, src, length);

                expect(bytes).toEqual(expectedAfterMove(original, dst, src, length));
            }
        });

        it(`putBytesFromAViewOfTheSameArrayBufferMovesBothWays length=${length}`, () => {
            for (const [dst, src] of [
                [8, 4],
                [4, 8],
            ] as const) {
                const arrayBuffer = new ArrayBuffer(300);
                new Uint8Array(arrayBuffer).set(pattern(300));
                const original = new Uint8Array(arrayBuffer).slice();
                const buffer = new UnsafeBuffer(new Uint8Array(arrayBuffer, 16, 200));

                // the view starts at 16, so index i of the buffer is byte 16 + i of the ArrayBuffer
                buffer.putBytes(dst, new Uint8Array(arrayBuffer, 16 + src, 100), 0, length);

                expect(new Uint8Array(arrayBuffer)).toEqual(expectedAfterMove(original, 16 + dst, 16 + src, length));
            }
        });

        it(`getBytesIntoAnotherBufferOverOneArrayBufferMovesBothWays length=${length}`, () => {
            for (const [dstIndex, srcIndex] of [
                [8, 0],
                [0, 8],
            ] as const) {
                const arrayBuffer = new ArrayBuffer(300);
                new Uint8Array(arrayBuffer).set(pattern(300));
                const original = new Uint8Array(arrayBuffer).slice();
                const source = new UnsafeBuffer(arrayBuffer, 4, 200);
                const dest = new UnsafeBuffer(new Uint8Array(arrayBuffer, 4 + 2, 200));

                source.getBytes(srcIndex, dest, dstIndex, length);

                expect(new Uint8Array(arrayBuffer)).toEqual(
                    expectedAfterMove(original, 4 + 2 + dstIndex, 4 + srcIndex, length),
                );
            }
        });
    }
});
