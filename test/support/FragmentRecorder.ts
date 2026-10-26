// The Mockito `mock(FragmentHandler.class)` of the ported system tests (phase 3, D115): it records the offset and length of
// each fragment it gets, in order, so that `verify(h, times(n)).onFragment(any, anyInt, eq(length), any)` is
// `recorder.count(length) === n` and an `InOrder` over such calls is a comparison of `recorder.lengths`.
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import type { Header } from '../../src/client/logbuffer/Header.js';

export class FragmentRecorder implements FragmentHandler {
    public readonly offsets: number[] = [];
    public readonly lengths: number[] = [];

    public onFragment(_buffer: DirectBuffer, offset: number, length: number, _header: Header): void {
        this.offsets.push(offset);
        this.lengths.push(length);
    }

    /** The number of fragments of exactly this length. */
    public count(length: number): number {
        return this.lengths.filter((l) => l === length).length;
    }

    public get fragments(): number {
        return this.lengths.length;
    }
}
