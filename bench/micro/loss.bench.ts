// Micro benches of the loss path (phase 2, batch 1 fix): LossDetector.scan over a 64 KiB term (no gap, one gap) and the
// RetransmitHandler cycle onNak -> processTimeouts (resend) -> processTimeouts (linger expired) for a unicast and a
// group(16) handler, at small times and at times and term ids near 2^40 (a heap number, not a Smi, spec 5.3).
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { FlowControl } from '../../src/driver/FlowControl.js';
import { LossDetector } from '../../src/driver/LossDetector.js';
import { RetransmitHandler } from '../../src/driver/RetransmitHandler.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';
import type { SyncBench } from '../lib/types.js';

const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const MASK = TERM_LENGTH - 1;
const SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_LENGTH);
const FRAME = 64;
const MTU = 1024;
const TERM_ID = 0x1234;
const SCAN_OPS_PER_SAMPLE = 100;
const CYCLE_OPS_PER_SAMPLE = 1_000;
const NEAR_2_40 = 2 ** 40;

/** Frames of `FRAME` bytes at every offset in [from, to) of the term. */
function fill(term: UnsafeBuffer, from: number, to: number): void {
    for (let offset = from; offset < to; offset += FRAME) {
        FrameDescriptor.frameLengthOrdered(term, offset, FRAME);
    }
}

function scanBench(name: string, gap: boolean): SyncBench {
    let detector: LossDetector;
    let term: UnsafeBuffer;
    let sink = 0;
    return {
        name,
        opsPerSample: SCAN_OPS_PER_SAMPLE,
        setup: () => {
            detector = new LossDetector(new StaticDelayGenerator(20, 20), { onGapDetected: () => {} });
            term = new UnsafeBuffer(new ArrayBuffer(TERM_LENGTH));
            fill(term, 0, TERM_LENGTH);
            if (gap) {
                // one missing frame in the middle of the term
                FrameDescriptor.frameLengthOrdered(term, TERM_LENGTH / 2, 0);
            }
        },
        op: (i) => {
            const outcome = detector.scan(term, 0, TERM_LENGTH, i, MASK, SHIFT, TERM_ID);
            sink = (sink + outcome) & 0xffff;
            if (sink < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

function cycleBench(name: string, group: boolean, baseNs: number, termId: number): SyncBench {
    let handler: RetransmitHandler;
    let now = baseNs;
    let resends = 0;
    const sender = {
        resend: (_termId: number, _termOffset: number, _length: number): void => {
            resends++;
        },
    };
    const flowControl = {
        maxRetransmissionLength: (termOffset: number, resendLength: number, termLength: number): number =>
            Math.min(resendLength, termLength - termOffset),
    } as unknown as FlowControl;
    return {
        name,
        opsPerSample: CYCLE_OPS_PER_SAMPLE,
        setup: () => {
            const counters = new CountersManager(
                new UnsafeBuffer(new ArrayBuffer(8 * CountersReader.METADATA_LENGTH)),
                new UnsafeBuffer(new ArrayBuffer(8 * CountersReader.COUNTER_LENGTH)),
            );
            handler = new RetransmitHandler(
                { nanoTime: () => now },
                new StaticDelayGenerator(1),
                new StaticDelayGenerator(1),
                group,
                16,
                counters.newCounter('overflow'),
            );
        },
        op: (i) => {
            now = baseNs + i * 4;
            handler.onNak(termId, (i & 255) * FRAME, FRAME, TERM_LENGTH, MTU, flowControl, sender);
            handler.processTimeouts(now + 2, sender); // delay expired: resend, the action lingers
            handler.processTimeouts(now + 4, sender); // linger expired: the action is free again
            if (resends < 0) {
                throw new Error('unreachable');
            }
        },
    };
}

export const benches: SyncBench[] = [
    scanBench('LossDetector scan 64KiB term, no gap', false),
    scanBench('LossDetector scan 64KiB term, one gap', true),
    cycleBench('RetransmitHandler onNak+processTimeouts+linger, unicast', false, 0, TERM_ID),
    cycleBench('RetransmitHandler onNak+processTimeouts+linger, group(16)', true, 0, TERM_ID),
    cycleBench('RetransmitHandler onNak+processTimeouts+linger, unicast, near 2^40', false, NEAR_2_40, 2 ** 24),
    cycleBench('RetransmitHandler onNak+processTimeouts+linger, group(16), near 2^40', true, NEAR_2_40, 2 ** 24),
];
