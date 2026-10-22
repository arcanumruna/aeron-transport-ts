// The two backing stores that the buffer suites run over (spec D16): an ArrayBuffer (one thread, plain accesses) and a
// SharedArrayBuffer (Atomics). A suite takes a Backing as its factory parameter, so there is no copy of the tests.
import { BufferUtil } from '../../src/agrona/BufferUtil.js';

export interface Backing {
    readonly name: string;
    readonly shared: boolean;
    /** A new zeroed buffer of `length` bytes. */
    arrayBuffer(length: number): ArrayBufferLike;
    /** A new zeroed byte array that is a view of all of a new buffer of this backing. */
    bytes(length: number): Uint8Array;
    /** As `BufferUtil.allocateDirectAligned` / `allocateShared`. */
    aligned(length: number, alignment: number): ArrayBufferLike;
}

export const ARRAY_BACKING: Backing = {
    name: 'ArrayBuffer',
    shared: false,
    arrayBuffer: (length) => new ArrayBuffer(length),
    bytes: (length) => new Uint8Array(length),
    aligned: (length, alignment) => BufferUtil.allocateDirectAligned(length, alignment),
};

export const SHARED_BACKING: Backing = {
    name: 'SharedArrayBuffer',
    shared: true,
    arrayBuffer: (length) => new SharedArrayBuffer(length),
    bytes: (length) => new Uint8Array(new SharedArrayBuffer(length)),
    aligned: (length, alignment) => BufferUtil.allocateShared(length, alignment),
};

export const BACKINGS: readonly Backing[] = [ARRAY_BACKING, SHARED_BACKING];
