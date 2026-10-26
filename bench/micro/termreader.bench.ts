// Micro bench of `TermReader.read` (T16, the gate test of T24 injects its delay here): the six argument form over a term
// of 600 frames of 64 B payload (96 B frames) that the setup wrote through a publication; the reader moves on by the
// bytes it consumed and starts again at the beginning of the term after the 600th frame. A no-op handler. The
// positions stay below 2^20, so they are small integers. None allocates (`TermReadersHotPathAllocationTest`).
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermReader } from '../../src/client/logbuffer/TermReader.js';
import { SHARED_BACKING } from '../../test/support/Backing.js';
import { ClientRig } from '../../test/support/ClientRig.js';
import type { SyncBench } from '../lib/types.js';

const FRAMES = 600;
const FRAME_LENGTH = 96;
const OPS_PER_SAMPLE = 1_000;

/** Keeps the work of the handler alive. */
let sink = 0;

const handler = {
    onFragment: (_buffer: unknown, offset: number, length: number): void => {
        sink = (sink + offset + length) | 0;
    },
};
const errorHandler = {
    onError: (e: Error): void => {
        throw e;
    },
};

/** `limit` fragments per `read`, until the 600 frames of the term are read, then back to the start. */
export function termReaderBench(name: string, limit: number): SyncBench {
    let term: UnsafeBuffer;
    let header: Header;
    let offset = 0;
    return {
        name,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            const rig = new ClientRig({ backing: SHARED_BACKING });
            const src = new UnsafeBuffer(new Uint8Array(64));
            for (let i = 0; i < FRAMES; i++) {
                rig.publication.offer(src, 0, 64);
            }
            term = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
            header = new Header(rig.initialTermId, LogBufferDescriptor.positionBitsToShift(rig.termLength));
            offset = 0;
        },
        op: () => {
            const outcome = TermReader.read(term, offset, handler, limit, header, errorHandler);
            offset = TermReader.offset(outcome);
            if (offset >= FRAMES * FRAME_LENGTH) {
                offset = 0;
            }
        },
    };
}

export const benches: SyncBench[] = [
    termReaderBench('TermReader read: 1 fragment of 64 B', 1),
    termReaderBench('TermReader read: 16 fragments of 64 B', 16),
];
