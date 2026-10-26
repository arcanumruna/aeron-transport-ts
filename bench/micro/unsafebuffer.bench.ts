// Micro benches of the UnsafeBuffer int accessors and of `TermRebuilder.insert` (issue #8): the native-order `getInt` and
// `putInt` that every flyweight and every frame header goes through, and the insert of a 32 byte data frame (a header
// only) into a term, which is eight `getInt` and eight `putInt` of the packet and the term and one `getInt` of the slot.
// Over an ArrayBuffer and a SharedArrayBuffer. None allocates (`HotPathAllocationTest`).
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { TermRebuilder } from '../../src/client/logbuffer/TermRebuilder.js';
import { ARRAY_BACKING, type Backing, SHARED_BACKING } from '../../test/support/Backing.js';
import type { SyncBench } from '../lib/types.js';

const OPS_PER_SAMPLE = 1_000;
const TERM_LENGTH = 64 * 1024;
const FRAME_LENGTH = 32;
const FRAMES = TERM_LENGTH / FRAME_LENGTH;

/** Keeps the values of the loops alive. */
let sink = 0;

/** One operation is 16 `putInt` and 16 `getInt` at distinct indices, native order, the default `byteOrder`. */
function intAccessors(backing: Backing): SyncBench {
    let buffer: UnsafeBuffer;
    return {
        name: `UnsafeBuffer 16 putInt + 16 getInt (${backing.name})`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            buffer = new UnsafeBuffer(backing.bytes(256));
        },
        op: (i) => {
            let sum = 0;
            for (let j = 0; j < 64; j += 4) {
                buffer.putInt(j, i + j);
            }

            for (let j = 0; j < 64; j += 4) {
                sum += buffer.getInt(j);
            }

            sink = (sink + sum) | 0;
        },
    };
}

/** `TermRebuilder.insert` of a 32 byte frame at a term offset that moves on by 32 and starts again, with the term zeroed. */
function termRebuilderInsert(backing: Backing): SyncBench {
    let term: UnsafeBuffer;
    let packet: UnsafeBuffer;
    return {
        name: `TermRebuilder.insert 32 B (${backing.name})`,
        opsPerSample: OPS_PER_SAMPLE,
        setup: () => {
            term = new UnsafeBuffer(backing.bytes(TERM_LENGTH));
            packet = new UnsafeBuffer(backing.bytes(FRAME_LENGTH));
            for (let j = 0; j < FRAME_LENGTH; j += 4) {
                packet.putInt(j, j + 1);
            }
        },
        op: (i) => {
            const frame = i & (FRAMES - 1);
            if (0 === frame) {
                term.setMemory(0, TERM_LENGTH, 0);
            }

            TermRebuilder.insert(term, frame * FRAME_LENGTH, packet, FRAME_LENGTH);
        },
    };
}

export const benches: SyncBench[] = [
    intAccessors(ARRAY_BACKING),
    intAccessors(SHARED_BACKING),
    termRebuilderInsert(ARRAY_BACKING),
    termRebuilderInsert(SHARED_BACKING),
];
