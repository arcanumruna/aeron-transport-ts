// Not in Agrona: the buffer accessors, wrap, copies and the ASCII number parsers allocate nothing per call, except
// what a JS `number` forces. A minor garbage collection happens only after something is allocated, so the test counts
// the collections over a long loop (the heap growth is not usable: a collection gives the garbage back).
//
// V8 boxes a number outside the 32-bit small integers (a long above 2^31, a double) in a heap number whenever it is
// passed to or returned from a call that is not inlined; no JS code can avoid that. The loops over such values may
// therefore allocate that many heap numbers per iteration, which is measured against a control loop that allocates
// exactly one per iteration. The loops over int-sized values must not allocate.
import { describe, expect, it } from 'vitest';
import { AsciiEncoding } from '../../../src/agrona/AsciiEncoding.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { ITERATIONS, expectNoAllocation, measure } from '../../support/Allocation.js';

describe('HotPathAllocationTest', () => {
    it('theHarnessSeesAnAllocatingLoop', async () => {
        const sink: object[] = [];
        const { collections } = await measure((n) => {
            for (let i = 0; i < n; i++) {
                sink[i & 7] = { i, a: new Array(8).fill(i) };
            }
        }, ITERATIONS);
        // the heap growth is not asserted: a scavenge can leave it at or below 0
        expect(collections).toBeGreaterThan(0);
    });

    // One call or pair per loop, so that the calls fit the inlining budget of the optimizing compiler.
    const buffer = new UnsafeBuffer(new Uint8Array(256));
    const sum = new Float64Array(1);
    /** The heap numbers per iteration that a loop may allocate: the long and double values it passes or returns. */
    const HEAP_NUMBERS: Record<string, number> = {
        'long above 2^31': 0,
        'long big endian': 0,
        double: 0,
        float: 0,
        'putLongOrdered, getLongVolatile': 0,
        getAndAddLong: 0,
        'compareAndSetLong, getAndSetLong': 2,
        'putLongAscii of 16 digits': 3,
        'putLongAscii of 9 digits': 0,
        'putNaturalLongAscii of 16 digits': 3,
        'parseLongAscii of 16 digits': 1,
        'parseLongAscii of 12 digits and of 9': 3,
        'AsciiEncoding.parseLongAscii of a string': 1,
        'AsciiEncoding.digitCountLong': 1,
    };
    const loops: [string, (n: number) => void][] = [
        [
            'int',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putInt(8, i);
                    sum[0] = sum[0]! + buffer.getInt(8);
                    buffer.putInt(8, i, ByteOrder.BIG_ENDIAN);
                    sum[0] = sum[0]! + buffer.getInt(8, ByteOrder.BIG_ENDIAN);
                }
            },
        ],
        [
            'short, char, byte',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putShort(8, i);
                    buffer.putChar(10, i);
                    buffer.putByte(12, i);
                    sum[0] = sum[0]! + buffer.getShort(8) + buffer.getChar(10) + buffer.getByte(12);
                }
            },
        ],
        [
            'long above 2^31',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLong(8, i * 4096);
                    sum[0] = sum[0]! + buffer.getLong(8);
                }
            },
        ],
        [
            'long big endian',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLong(8, -i * 4096, ByteOrder.BIG_ENDIAN);
                    sum[0] = sum[0]! + buffer.getLong(8, ByteOrder.BIG_ENDIAN);
                }
            },
        ],
        [
            'double',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putDouble(8, i * 0.5);
                    sum[0] = sum[0]! + buffer.getDouble(8);
                }
            },
        ],
        [
            'float',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putFloat(8, i * 0.5);
                    sum[0] = sum[0]! + buffer.getFloat(8);
                }
            },
        ],
        [
            'putLongOrdered, getLongVolatile',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putLongOrdered(8, i * 4096);
                    sum[0] = sum[0]! + buffer.getLongVolatile(8);
                }
            },
        ],
        [
            'getAndAddLong',
            (n) => {
                buffer.putLong(8, 0);
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.getAndAddLong(8, 4096);
                }
            },
        ],
        [
            'compareAndSetLong, getAndSetLong',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + buffer.getAndSetLong(8, i * 4096);
                    if (buffer.compareAndSetLong(8, i * 4096, 7)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
        [
            'int atomics',
            (n) => {
                for (let i = 0; i < n; i++) {
                    buffer.putIntOrdered(8, i);
                    sum[0] =
                        sum[0]! + buffer.getIntVolatile(8) + buffer.getAndAddInt(8, 1) + buffer.addIntOrdered(8, 1);
                    if (buffer.compareAndSetInt(8, 7, 9)) {
                        sum[0] = sum[0]! + 1;
                    }
                }
            },
        ],
    ];
    for (const [name, loop] of loops) {
        it(`getAndPut ${name}`, async () => {
            buffer.setMemory(0, 64, 0);
            await expectNoAllocation(loop, ITERATIONS, HEAP_NUMBERS[name] ?? 0);
            expect(sum[0]).not.toBeNaN();
        });
    }

    it('wrapOfTheSameBuffers', async () => {
        const arrayBuffer = new ArrayBuffer(256);
        const array = new Uint8Array(arrayBuffer);
        const backing = new UnsafeBuffer(array);
        const window = new UnsafeBuffer();
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                window.wrap(backing, i & 63, 64);
                window.wrap(backing);
                window.wrap(array, 8, 16);
                window.wrap(array);
                window.wrap(arrayBuffer, 8, 16);
                window.wrap(arrayBuffer);
            }
        });
    });

    it('putBytesAndGetBytes', async () => {
        const arrayBuffer = new ArrayBuffer(1024);
        const a = new UnsafeBuffer(new Uint8Array(arrayBuffer));
        const sameMemory = new UnsafeBuffer(arrayBuffer, 16, 512);
        const b = new UnsafeBuffer(new Uint8Array(1024));
        const source = new Uint8Array(300);
        const dest = new Uint8Array(300);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                a.putBytes(0, source, 0, 16);
                a.putBytes(0, source, 0, 100);
                a.putBytes(0, source);
                a.putBytes(0, source, 4, 250);
                a.putBytes(8, a, 0, 16);
                a.putBytes(8, a, 0, 200);
                a.putBytes(8, sameMemory, 0, 200);
                a.putBytes(0, b, 4, 200);
                b.putBytes(0, a, 4, 40);
                a.getBytes(0, dest, 0, 200);
                a.getBytes(0, dest);
                a.getBytes(0, b, 8, 128);
                a.setMemory(0, 100 + (i & 7), i);
            }
        }, 200_000);
    });

    const ascii = new UnsafeBuffer(new Uint8Array(64));
    const asciiLoops: [string, (n: number) => void][] = [
        [
            'putIntAscii, parseIntAscii',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.parseIntAscii(8, ascii.putIntAscii(8, 2147483647 - i));
                    sum[0] = sum[0]! + ascii.parseIntAscii(8, ascii.putIntAscii(8, -2147483648 + i));
                    sum[0] = sum[0]! + ascii.parseIntAscii(8, ascii.putIntAscii(8, 12345 + i));
                }
            },
        ],
        [
            'putNaturalIntAscii, parseNaturalIntAscii',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.parseNaturalIntAscii(8, ascii.putNaturalIntAscii(8, 1999999999 - i));
                }
            },
        ],
        [
            'putLongAscii of 16 digits',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.putLongAscii(8, 9007199254740991 - i);
                }
            },
        ],
        [
            'putLongAscii of 9 digits',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] =
                        sum[0]! + ascii.putLongAscii(8, 123456789 + (i & 1023)) + ascii.putLongAscii(8, -(i & 1023));
                }
            },
        ],
        [
            'putNaturalLongAscii of 16 digits',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.putNaturalLongAscii(8, 4503599627370496 + i);
                }
            },
        ],
        [
            'parseLongAscii of 16 digits',
            (n) => {
                ascii.putStringWithoutLengthAscii(8, '9007199254740991');
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.parseLongAscii(8, 16);
                }
            },
        ],
        [
            'parseLongAscii of 12 digits and of 9',
            (n) => {
                ascii.putStringWithoutLengthAscii(8, '-123456789012');
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.parseLongAscii(8, 13);
                    sum[0] = sum[0]! + ascii.parseNaturalLongAscii(9, 12);
                }
            },
        ],
        [
            'parseLongAscii of 19 digits with leading zeros',
            (n) => {
                ascii.putStringWithoutLengthAscii(8, '0000000000000000007');
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + ascii.parseLongAscii(8, 19);
                }
            },
        ],
        [
            'AsciiEncoding.parseLongAscii of a string',
            (n) => {
                const text = 'long to test9007199254740991';
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + AsciiEncoding.parseLongAscii(text, 12, text.length - 12);
                }
            },
        ],
        [
            'AsciiEncoding.parseIntAscii of a string',
            (n) => {
                const text = 'testInt-1234567890';
                for (let i = 0; i < n; i++) {
                    sum[0] = sum[0]! + AsciiEncoding.parseIntAscii(text, 7, text.length - 7);
                }
            },
        ],
        [
            'AsciiEncoding.digitCountLong',
            (n) => {
                for (let i = 0; i < n; i++) {
                    sum[0] =
                        sum[0]! +
                        AsciiEncoding.digitCountLong(9007199254740991 - i) +
                        AsciiEncoding.digitCount(2147483647);
                }
            },
        ],
    ];
    for (const [name, loop] of asciiLoops) {
        it(`ascii numbers ${name}`, async () => {
            await expectNoAllocation(loop, 2_000_000, HEAP_NUMBERS[name] ?? 0);
            expect(sum[0]).not.toBeNaN();
        });
    }

    it('compareEqualsAndHashCode', async () => {
        const a = new UnsafeBuffer(new Uint8Array(100));
        const b = new UnsafeBuffer(new Uint8Array(100));
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                sum[0] = sum[0]! + a.compareTo(b) + a.hashCode();
                if (a.equals(b)) {
                    sum[0] = sum[0]! + 1;
                }
            }
        }, 2_000_000);
        expect(sum[0]).not.toBeNaN();
    });
});
