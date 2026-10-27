// Not in Agrona: transmit, receiveNext with its getters and validate, and CopyBroadcastReceiver.receive allocate nothing
// per message over a SharedArrayBuffer (spec 5.3, D16); the handler of the copy receiver only sums. A minor garbage
// collection happens only after something is allocated, so the test counts the collections over a long loop (see
// test/support/Allocation.ts). Each case runs over an ArrayBuffer and a SharedArrayBuffer, from position 0, where it
// allocates nothing, and from 2^40 (the `LargePosition` cases), where the positions are outside V8's 31-bit small
// integers and are boxed into heap numbers across calls that are not inlined (issue #19).
import { describe, it } from 'vitest';
import { BroadcastBufferDescriptor } from '../../../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastReceiver } from '../../../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { BroadcastTransmitter } from '../../../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { CopyBroadcastReceiver } from '../../../../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { MessageHandler } from '../../../../../src/agrona/concurrent/MessageHandler.js';
import { UnsafeBuffer } from '../../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { expectNoAllocation } from '../../../../support/Allocation.js';
import { ARRAY_BACKING, SHARED_BACKING } from '../../../../support/Backing.js';

const CAPACITY = 64 * 1024;
const LENGTH = 64;
const TYPE = 7;

/** The positions of the `LargePosition` cases start here: a safe integer far outside the 31-bit small integers. */
const LARGE_POSITION = 2 ** 40;

type Case = 'transmitAndReceiveNext' | 'transmitAndCopyReceive';

/**
 * Upper bounds of the `LargePosition` cases (spec D127): the heap numbers per iteration (transmit + receive) that a case
 * may allocate. Measured, in the order of this file: 4 and 5 times the control loop over an ArrayBuffer and 5 over a
 * SharedArrayBuffer (alone, the same loops measure 2 and 4, and 1 and 2: V8's inlining depends on what ran before), so
 * the allowance is 6. `transmit` and `receive` call several `long` operations of `UnsafeBuffer` of 370 to 600 bytecode
 * bytes each, and V8 inlines 920 in all, so the ones that are not inlined box the position they take or return (issue
 * #19).
 */
const LARGE_POSITION_HEAP_NUMBERS: Readonly<Record<Case, number>> = {
    transmitAndReceiveNext: 6,
    transmitAndCopyReceive: 6,
};

/** Keeps the values of the loops alive. */
let sink = 0;

class Sum implements MessageHandler {
    public total = 0;

    public onMessage(msgTypeId: number, _buffer: unknown, index: number, length: number): void {
        this.total = (this.total + msgTypeId + index + length) | 0;
        sink = this.total;
    }
}

describe.each([
    ['ArrayBuffer', ARRAY_BACKING],
    ['SharedArrayBuffer', SHARED_BACKING],
] as const)('BroadcastHotPathAllocation %s', (_name, backing) => {
    const suffix = backing.shared ? 'SharedNoAllocation' : '';

    describe.each([
        ['', 0],
        ['LargePosition', LARGE_POSITION],
    ] as const)('%s', (where, start) => {
        const setUp = (): { transmitter: BroadcastTransmitter; receiver: BroadcastReceiver; src: UnsafeBuffer } => {
            const buffer = new UnsafeBuffer(backing.aligned(CAPACITY + BroadcastBufferDescriptor.TRAILER_LENGTH, 64));
            if (0 !== start) {
                // the tail intent, the tail and the latest counter, on a capacity boundary
                buffer.putLong(CAPACITY + BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET, start);
                buffer.putLong(CAPACITY + BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET, start);
                buffer.putLong(CAPACITY + BroadcastBufferDescriptor.LATEST_COUNTER_OFFSET, start);
            }
            const src = new UnsafeBuffer(new Uint8Array(LENGTH));
            src.putInt(0, 42);
            return { transmitter: new BroadcastTransmitter(buffer), receiver: new BroadcastReceiver(buffer), src };
        };
        const bound = (name: Case): number => (0 === start ? 0 : LARGE_POSITION_HEAP_NUMBERS[name]);
        const title = (name: string): string => name + where + suffix;

        it(title('transmitAndReceiveNextAllocateNothing'), async () => {
            const { transmitter, receiver, src } = setUp();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        transmitter.transmit(TYPE, src, 0, LENGTH);
                        if (!receiver.receiveNext()) {
                            throw new Error('nothing to receive');
                        }
                        sink = (sink + receiver.typeId() + receiver.offset() + receiver.length()) | 0;
                        if (!receiver.validate()) {
                            throw new Error('lapped');
                        }
                    }
                },
                undefined,
                bound('transmitAndReceiveNext'),
            );
        });

        it(title('transmitAndCopyReceiveAllocateNothing'), async () => {
            const { transmitter, receiver, src } = setUp();
            const copyReceiver = new CopyBroadcastReceiver(receiver);
            const sum = new Sum();

            await expectNoAllocation(
                (n) => {
                    for (let i = 0; i < n; i++) {
                        transmitter.transmit(TYPE, src, 0, LENGTH);
                        if (1 !== copyReceiver.receive(sum)) {
                            throw new Error('nothing to receive');
                        }
                    }
                },
                undefined,
                bound('transmitAndCopyReceive'),
            );
        });
    });
});
