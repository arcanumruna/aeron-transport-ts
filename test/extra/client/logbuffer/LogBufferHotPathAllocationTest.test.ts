// Not in Aeron: the frame header accessors of `FrameDescriptor`, the getters of `Header`, `HeaderWriter.write` and
// `BufferClaim` allocate nothing per call (spec 5.3), except what a JS `number` forces: V8 boxes a number outside the
// 32-bit small integers when it is passed to or returned from a call that is not inlined, so the loops use ints. The
// raw tail halves are read without a `bigint`. A minor garbage collection happens only after something is allocated,
// so the test counts the collections over a long loop.
import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BufferClaim } from '../../../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../../../src/client/logbuffer/Header.js';
import { HeaderWriter } from '../../../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const ITERATIONS = 2_000_000;
const WARM_UP = 100_000;

type Collection = { detail?: { kind: number } };

/** The minor collections while `run(iterations)` runs, after a warm up. */
async function minorCollections(run: (iterations: number) => void): Promise<number> {
    run(WARM_UP);
    run(WARM_UP);

    const observer = new PerformanceObserver(() => {});
    observer.observe({ entryTypes: ['gc'] });
    gc();
    await new Promise((resolve) => setImmediate(resolve));
    observer.takeRecords();

    run(ITERATIONS);

    await new Promise((resolve) => setImmediate(resolve));
    const collections = observer
        .takeRecords()
        .filter((e) => (e as unknown as Collection).detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR).length;
    observer.disconnect();
    return collections;
}

/** A sink so that the loops are not optimised away. */
let sink = 0;

describe('log buffer hot paths allocate nothing', () => {
    it('FrameDescriptor accessors', async () => {
        const buffer = new UnsafeBuffer(new Uint8Array(4096));

        const collections = await minorCollections((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                const termOffset = (i & 63) << 5;
                FrameDescriptor.frameTermOffset(buffer, termOffset);
                FrameDescriptor.frameTermId(buffer, termOffset, i);
                FrameDescriptor.frameSessionId(buffer, termOffset, -i);
                FrameDescriptor.frameType(buffer, termOffset, i & 0xffff);
                FrameDescriptor.frameFlags(buffer, termOffset, FrameDescriptor.UNFRAGMENTED);
                FrameDescriptor.frameLengthOrdered(buffer, termOffset, 96);
                sum +=
                    FrameDescriptor.frameLength(buffer, termOffset) +
                    FrameDescriptor.frameLengthVolatile(buffer, termOffset) +
                    FrameDescriptor.frameTermId(buffer, termOffset) +
                    FrameDescriptor.frameSessionId(buffer, termOffset) +
                    FrameDescriptor.frameType(buffer, termOffset) +
                    FrameDescriptor.frameFlags(buffer, termOffset) +
                    FrameDescriptor.frameVersion(buffer, termOffset) +
                    (FrameDescriptor.isPaddingFrame(buffer, termOffset) ? 1 : 0) +
                    (FrameDescriptor.isFrameAligned(termOffset) ? 1 : 0);
                sum |= 0;
            }
            sink = sum;
        });

        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    });

    it('Header getters and position', async () => {
        const buffer = new UnsafeBuffer(new Uint8Array(4096));
        const flyweight = new DataHeaderFlyweight();
        flyweight.wrap(buffer, 128, 32);
        flyweight.frameLength(96);
        flyweight.termOffset(1024).termId(7).sessionId(3).streamId(5);
        const header = new Header(5, 16);
        header.buffer(buffer).offset(128);

        const collections = await minorCollections((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                sum +=
                    header.frameLength() +
                    header.sessionId() +
                    header.streamId() +
                    header.termId() +
                    header.termOffset() +
                    header.nextTermOffset() +
                    header.type() +
                    header.flags() +
                    header.position();
                sum |= 0;
            }
            sink = sum;
        });

        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    });

    it('HeaderWriter.write', async () => {
        const defaultHeader = new UnsafeBuffer(new Uint8Array(32));
        defaultHeader.putInt(4, 0x01c00000);
        defaultHeader.putInt(12, -3);
        defaultHeader.putInt(16, 99);
        const writer = HeaderWriter.newInstance(defaultHeader);
        const term = new UnsafeBuffer(new Uint8Array(65536));

        const collections = await minorCollections((n) => {
            for (let i = 0; i < n; i++) {
                writer.write(term, (i & 1023) << 6, 64 + (i & 31), i);
            }
        });

        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    });

    it('BufferClaim wrap, accessors, commit and abort', async () => {
        const term = new UnsafeBuffer(new Uint8Array(65536));
        const claim = new BufferClaim();
        const source = new UnsafeBuffer(new Uint8Array(64));

        const collections = await minorCollections((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                claim.wrap(term, (i & 511) << 7, 128);
                claim.headerType(1).flags(-64).putBytes(source, 0, 64);
                sum += claim.offset() + claim.length() + claim.headerType() + claim.flags();
                if ((i & 1) === 0) {
                    claim.commit();
                } else {
                    claim.abort();
                }
                sum |= 0;
            }
            sink = sum;
        });

        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    });

    it('the raw tail halves, the active term count and the positions', async () => {
        const metadata = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        LogBufferDescriptor.initialiseTailWithTermId(metadata, 0, 5);
        LogBufferDescriptor.initialiseTailWithTermId(metadata, 1, 6);
        LogBufferDescriptor.initialiseTailWithTermId(metadata, 2, 7);

        const collections = await minorCollections((n) => {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                const index = LogBufferDescriptor.indexByTermCount(i & 1023);
                LogBufferDescriptor.initialiseTailWithTermId(metadata, index, i);
                LogBufferDescriptor.activeTermCountOrdered(metadata, i & 1023);
                sum +=
                    LogBufferDescriptor.rawTailTermId(metadata, index) +
                    LogBufferDescriptor.rawTailTermOffset(metadata, index, 65536) +
                    LogBufferDescriptor.activeTermCount(metadata) +
                    LogBufferDescriptor.computePosition(i & 0xff, i & 0xfff, 16, 0) +
                    LogBufferDescriptor.computeTermIdFromPosition((i & 0xffff) << 8, 16, 7) +
                    LogBufferDescriptor.indexByPosition((i & 0xffff) << 8, 16) +
                    LogBufferDescriptor.termLength(metadata) +
                    LogBufferDescriptor.mtuLength(metadata) +
                    (LogBufferDescriptor.isConnected(metadata) ? 1 : 0);
                sum |= 0;
            }
            sink = sum;
        });

        expect(collections, 'minor collections').toBeLessThanOrEqual(1);
    });

    it('keeps the sink alive', () => {
        expect(typeof sink).toBe('number');
    });
});
