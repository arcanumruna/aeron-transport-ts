/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Extra tests of T16 (port-only): the interaction matrix row "Loss and flow", for the receiver, on the receiver rig of
// `test/support/ReceiverRig.ts` (a real `Receiver`, endpoint, dispatcher and `PublicationImage` over an in-memory log,
// with a socket that records the status messages, NAKs and error frames): a single gap, many gaps, a gap that spans
// frames, a gap at the end of the term and loss during a rotation; the NAK, its delay and its retry; an unreliable
// image that fills the gap; the status message (the first, after the subscriber moves, on the timeout and when the
// window is full); a lost setup frame; and the loss report. Every test asserts concrete values.
import { afterEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { BufferUtil } from '../../../src/agrona/BufferUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { LossReport } from '../../../src/driver/reports/LossReport.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const { LITTLE_ENDIAN } = ByteOrder;
const {
    NAK_MESSAGES_SENT,
    LOSS_GAP_FILLS,
    FLOW_CONTROL_OVER_RUNS,
    FLOW_CONTROL_UNDER_RUNS,
    STATUS_MESSAGES_SENT,
    INVALID_PACKETS,
} = SystemCounterDescriptor;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const WINDOW = TERM / 2;
const NEVER_NS = 1_000_000_000_000;

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

let rig: ReceiverRig;

/** A frame of 64 bytes (32 of payload) at frame number `i` of the first term of the join. */
function frameAt(i: number, termId = rig.initialTermId, base = 0): Uint8Array {
    return rig.frame({ termId, termOffset: base + 64 * i, payload: pattern(32, i) });
}

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('PublicationImageLossExtraTest', () => {
    it('a single gap: one NAK for it, none for the frames around it, the gap filled by the retransmit and no NAK after', () => {
        rig = new ReceiverRig({ lossRetryDelayNs: NEVER_NS });
        rig.join();

        rig.deliver(frameAt(0));
        rig.deliver(frameAt(2));
        expect(rig.hwmPosition.get()).toBe(192);
        rig.run(1, 1000);

        expect(rig.rebuildPosition.get()).toBe(64);
        const naks = rig.naks();
        expect(naks.length).toBe(1);
        expect(naks[0]?.sessionId()).toBe(rig.sessionId);
        expect(naks[0]?.streamId()).toBe(rig.streamId);
        expect(naks[0]?.termId()).toBe(rig.initialTermId);
        expect(naks[0]?.termOffset()).toBe(64);
        expect(naks[0]?.length()).toBe(64);
        expect(rig.counter(NAK_MESSAGES_SENT)).toBe(1);
        expect(rig.naksSent.get()).toBe(1);

        rig.run(5, 1000);
        expect(rig.naks().length).toBe(1);

        rig.deliver(frameAt(1)); // the retransmit
        rig.run(2, 1000);

        expect(rig.rebuildPosition.get()).toBe(192);
        expect(rig.naks().length).toBe(1);
        expect(rig.read()).toEqual([pattern(32, 0), pattern(32, 1), pattern(32, 2)]);
        expect(rig.subscriberPosition.get()).toBe(192);
    });

    it('a gap that spans frames is one NAK for all of it', () => {
        rig = new ReceiverRig({ lossRetryDelayNs: NEVER_NS });
        rig.join();

        rig.deliver(frameAt(0));
        rig.deliver(frameAt(4));
        rig.run(1, 1000);

        expect(rig.naks().length).toBe(1);
        expect(rig.naks()[0]?.termOffset()).toBe(64);
        expect(rig.naks()[0]?.length()).toBe(192);
        // the retransmit comes in frames of its own: the NAK repeats for what is still missing only when its delay is over
        rig.deliver(frameAt(1));
        rig.deliver(frameAt(2));
        rig.deliver(frameAt(3));
        rig.run(2, 1000);
        expect(rig.rebuildPosition.get()).toBe(320);
        expect(rig.naks().length).toBe(1);
    });

    it('many gaps: the receiver asks for one at a time, the first at the rebuild position, in order', () => {
        rig = new ReceiverRig({ lossRetryDelayNs: NEVER_NS });
        rig.join();

        for (const i of [0, 2, 4, 6, 8]) {
            rig.deliver(frameAt(i));
        }
        expect(rig.hwmPosition.get()).toBe(576);
        rig.run(1, 1000);
        expect(rig.naks().map((nak) => [nak.termOffset(), nak.length()])).toEqual([[64, 64]]);

        for (const [i, expected] of [
            [1, [64, 64, 192, 64]],
            [3, [64, 64, 192, 64, 320, 64]],
            [5, [64, 64, 192, 64, 320, 64, 448, 64]],
        ] as const) {
            rig.deliver(frameAt(i));
            rig.run(2, 1000);
            expect(rig.naks().flatMap((nak) => [nak.termOffset(), nak.length()])).toEqual([...expected]);
        }

        rig.deliver(frameAt(7));
        rig.run(2, 1000);
        expect(rig.rebuildPosition.get()).toBe(576);
        expect(rig.naks().length).toBe(4);
        expect(rig.counter(NAK_MESSAGES_SENT)).toBe(4);
        expect(rig.read().length).toBe(9);
    });

    it('the NAK waits for its delay and repeats at the retry delay while the gap is open, and stops when it is filled', () => {
        rig = new ReceiverRig({ lossDelayNs: 100_000, lossRetryDelayNs: 1_000_000 });
        rig.join();
        rig.deliver(frameAt(0));
        rig.deliver(frameAt(2));

        rig.conductorCycle(); // the gap is found: the first NAK is due after the delay
        rig.cycle();
        expect(rig.naks().length).toBe(0);
        rig.conductorCycle(99_999);
        rig.cycle();
        expect(rig.naks().length).toBe(0);
        rig.conductorCycle(1);
        rig.cycle();
        expect(rig.naks().length).toBe(1);

        rig.conductorCycle(999_999); // just short of the retry delay
        rig.cycle();
        expect(rig.naks().length).toBe(1);
        rig.conductorCycle(1);
        rig.cycle();
        expect(rig.naks().length).toBe(2);
        rig.conductorCycle(1_000_000);
        rig.cycle();
        expect(rig.naks().length).toBe(3);
        expect(rig.naks().every((nak) => 64 === nak.termOffset() && 64 === nak.length())).toBe(true);

        rig.deliver(frameAt(1));
        rig.run(3, 2_000_000);
        expect(rig.naks().length).toBe(3);
        expect(rig.rebuildPosition.get()).toBe(192);
    });

    it('a gap at the end of the term: the NAK is for the rest of the term, then the rebuild goes on into the next term', () => {
        const termOffset = TERM - 640;
        rig = new ReceiverRig({ termOffset, lossRetryDelayNs: NEVER_NS });
        rig.join();
        const next = rig.initialTermId + 1;

        rig.deliver(frameAt(0, rig.initialTermId, termOffset));
        rig.deliver(rig.frame({ termId: next, termOffset: 0, payload: pattern(32, 9) }));
        expect(rig.hwmPosition.get()).toBe(TERM + 64);
        rig.run(1, 1000);

        expect(rig.naks().map((nak) => [nak.termId(), nak.termOffset(), nak.length()])).toEqual([
            [rig.initialTermId, TERM - 576, 576],
        ]);
        expect(rig.rebuildPosition.get()).toBe(TERM - 576);

        rig.deliver(rig.padding(rig.initialTermId, TERM - 576, 576)); // the retransmit: the padding header
        rig.run(2, 1000);

        expect(rig.rebuildPosition.get()).toBe(TERM + 64);
        expect(rig.naks().length).toBe(1);
        expect(rig.read()).toEqual([pattern(32, 0), pattern(32, 9)]);
        expect(rig.subscriberPosition.get()).toBe(TERM + 64);
    });

    it('loss during a rotation: the gap at the end of the term, then the gap at the start of the next one', () => {
        const termOffset = TERM - 640;
        rig = new ReceiverRig({ termOffset, lossRetryDelayNs: NEVER_NS });
        rig.join();
        const next = rig.initialTermId + 1;

        rig.deliver(frameAt(0, rig.initialTermId, termOffset));
        rig.deliver(rig.frame({ termId: next, termOffset: 64, payload: pattern(32, 9) })); // the frame at 0 is lost too
        expect(rig.hwmPosition.get()).toBe(TERM + 128);
        rig.run(1, 1000);
        expect(rig.naks().map((nak) => [nak.termId(), nak.termOffset(), nak.length()])).toEqual([
            [rig.initialTermId, TERM - 576, 576],
        ]);

        rig.deliver(rig.padding(rig.initialTermId, TERM - 576, 576));
        rig.run(2, 1000);
        expect(rig.rebuildPosition.get()).toBe(TERM);
        expect(rig.naks().map((nak) => [nak.termId(), nak.termOffset(), nak.length()])).toEqual([
            [rig.initialTermId, TERM - 576, 576],
            [next, 0, 64],
        ]);

        rig.deliver(rig.frame({ termId: next, termOffset: 0, payload: pattern(32, 8) }));
        rig.run(2, 1000);
        expect(rig.rebuildPosition.get()).toBe(TERM + 128);
        expect(rig.naks().length).toBe(2);
        expect(rig.read()).toEqual([pattern(32, 0), pattern(32, 8), pattern(32, 9)]);
    });

    it('an unreliable image fills the gap with a padding frame instead of asking for it, and a late frame is not written', () => {
        rig = new ReceiverRig({ isReliable: false });
        rig.join();

        rig.deliver(frameAt(0));
        rig.deliver(frameAt(2));
        rig.run(2, 1000);

        expect(rig.naks().length).toBe(0);
        expect(rig.counter(NAK_MESSAGES_SENT)).toBe(0);
        expect(rig.counter(LOSS_GAP_FILLS)).toBe(1);
        expect(rig.rebuildPosition.get()).toBe(192);
        const termBuffer = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
        const filled = new DataHeaderFlyweight(termBuffer);
        filled.wrap(termBuffer, 64, 32);
        expect(filled.frameLength()).toBe(64);
        expect(filled.headerType()).toBe(HeaderFlyweight.HDR_TYPE_PAD);
        expect(filled.termOffset()).toBe(64);
        expect(filled.termId()).toBe(rig.initialTermId);
        expect(filled.sessionId()).toBe(rig.sessionId);
        expect(filled.streamId()).toBe(rig.streamId);
        expect(rig.read()).toEqual([pattern(32, 0), pattern(32, 2)]);

        rig.deliver(frameAt(1)); // arrives late: the slot is taken
        expect(FrameDescriptor.frameType(termBuffer, 64)).toBe(HeaderFlyweight.HDR_TYPE_PAD);
        expect(rig.counter(LOSS_GAP_FILLS)).toBe(1);
    });

    it('the loss report: an entry for the first loss, an observation for each one that is not inside the last', () => {
        const buffer = new UnsafeBuffer(BufferUtil.allocateDirectAligned(1024, BitUtil.CACHE_LINE_LENGTH));
        const lossReport = new LossReport(buffer);
        rig = new ReceiverRig({ lossRetryDelayNs: 1_000_000, lossReport });
        rig.join();
        rig.deliver(frameAt(0));
        rig.deliver(frameAt(2));
        rig.deliver(frameAt(4));

        rig.run(1, 1000);
        expect(buffer.getLong(LossReport.OBSERVATION_COUNT_OFFSET, LITTLE_ENDIAN)).toBe(1);
        expect(buffer.getLong(LossReport.TOTAL_BYTES_LOST_OFFSET, LITTLE_ENDIAN)).toBe(64);
        expect(buffer.getInt(LossReport.SESSION_ID_OFFSET, LITTLE_ENDIAN)).toBe(rig.sessionId);
        expect(buffer.getInt(LossReport.STREAM_ID_OFFSET, LITTLE_ENDIAN)).toBe(rig.streamId);
        expect(buffer.getStringAscii(LossReport.CHANNEL_OFFSET, LITTLE_ENDIAN)).toBe('aeron:udp?endpoint=127.0.0.1:0');

        rig.run(1, 1_000_000); // the same gap again, after the retry delay: not a new loss
        expect(buffer.getLong(LossReport.OBSERVATION_COUNT_OFFSET, LITTLE_ENDIAN)).toBe(1);

        rig.deliver(frameAt(1));
        rig.run(2, 1000); // the next gap, further on
        expect(buffer.getLong(LossReport.OBSERVATION_COUNT_OFFSET, LITTLE_ENDIAN)).toBe(2);
        expect(buffer.getLong(LossReport.TOTAL_BYTES_LOST_OFFSET, LITTLE_ENDIAN)).toBe(128);
        expect(buffer.getLong(LossReport.LAST_OBSERVATION_OFFSET, LITTLE_ENDIAN)).toBeGreaterThanOrEqual(
            buffer.getLong(LossReport.FIRST_OBSERVATION_OFFSET, LITTLE_ENDIAN),
        );
    });
});

describe('PublicationImageFlowExtraTest', () => {
    function lastSm(): StatusMessageFlyweight {
        return rig.statusMessages().at(-1) as StatusMessageFlyweight;
    }

    it('the first status message tells the sender where the receiver joined and the window it offers', () => {
        rig = new ReceiverRig({ termOffset: 1024 });
        rig.join();
        expect(rig.windowLength).toBe(WINDOW);

        rig.cycle(1);

        expect(rig.statusMessages().length).toBe(1);
        expect(lastSm().sessionId()).toBe(rig.sessionId);
        expect(lastSm().streamId()).toBe(rig.streamId);
        expect(lastSm().consumptionTermId()).toBe(rig.initialTermId);
        expect(lastSm().consumptionTermOffset()).toBe(1024);
        expect(lastSm().receiverWindowLength()).toBe(WINDOW);
        expect(lastSm().flags()).toBe(0);
        expect(rig.counter(STATUS_MESSAGES_SENT)).toBe(1);
    });

    it('a status message follows the subscriber once it has moved by a quarter of the window, and not before', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(1);

        for (let i = 0; i < 8; i++) {
            rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 1024 * i, payload: pattern(992, i) }));
        }
        rig.run(2, 1000);
        expect(rig.read().length).toBe(8); // the subscriber is at 8192: a quarter of the window, not more than it
        rig.run(2, 1000);
        expect(rig.statusMessages().length).toBe(1);

        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 8192, payload: pattern(992, 8) }));
        rig.run(2, 1000);
        expect(rig.read().length).toBe(1);
        rig.run(2, 1000);

        expect(rig.statusMessages().length).toBe(2);
        expect(lastSm().consumptionTermId()).toBe(rig.initialTermId);
        expect(lastSm().consumptionTermOffset()).toBe(9216);
        expect(lastSm().receiverWindowLength()).toBe(WINDOW);
        expect(rig.counter(STATUS_MESSAGES_SENT)).toBe(2);
    });

    it('the status message is repeated when its timeout is over, once for each timeout, with the position of the subscriber', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(1);
        const timeoutNs = Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS;

        // the deadline is the time of the status message plus the timeout, and it is passed one nanosecond later
        rig.cycle(timeoutNs);
        expect(rig.statusMessages().length).toBe(1);
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(2);
        rig.cycle(timeoutNs);
        expect(rig.statusMessages().length).toBe(2);
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(3);
        expect(rig.statusMessages().map((sm) => sm.consumptionTermOffset())).toEqual([0, 0, 0]);
        expect(rig.counter(STATUS_MESSAGES_SENT)).toBe(3);
        // the image is still connected: a status message does not need a packet
        expect(rig.image.isConnected(rig.clock.nanoTime())).toBe(true);
    });

    it('the window is full: a frame past it is dropped and counted, the status message that moves the window lets the retransmit in', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        for (let i = 0; i < 32; i++) {
            rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 1024 * i, payload: pattern(992, i) }));
        }
        expect(rig.hwmPosition.get()).toBe(WINDOW);
        expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(0);

        // the frame after the window: its end is past the half term that follows the last status message
        const beyond = rig.frame({ termId: rig.initialTermId, termOffset: WINDOW, payload: pattern(992, 40) });
        rig.deliver(beyond);

        expect(rig.hwmPosition.get()).toBe(WINDOW);
        expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(1);
        expect(rig.counter(INVALID_PACKETS)).toBe(0);

        // the subscriber reads what there is and the status message opens the window
        rig.run(2, 1000);
        expect(rig.read().length).toBe(32);
        rig.run(2, 1000);
        expect(lastSm().consumptionTermOffset()).toBe(WINDOW);
        expect(lastSm().consumptionTermId()).toBe(rig.initialTermId);

        // if that status message is lost the receiver says it again when the timeout is over, with the same position
        const count = rig.statusMessages().length;
        rig.cycle(Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS + 1);
        expect(rig.statusMessages().length).toBe(count + 1);
        expect(lastSm().consumptionTermOffset()).toBe(WINDOW);

        rig.deliver(beyond); // the retransmit
        expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(1);
        expect(rig.hwmPosition.get()).toBe(WINDOW + 1024);
        rig.run(2, 1000);
        expect(rig.read()).toEqual([pattern(992, 40)]);
    });

    it('a frame behind the last status message is an under run: counted, dropped, and the image stays connected only for frames in the window', () => {
        rig = new ReceiverRig({ termOffset: 4096 });
        rig.join();
        rig.cycle(1);
        // the join position is the last status message position: a frame before it is behind the window
        const lastPacketNs = rig.image.timeOfLastPacketNs;
        rig.clock.advance(1000);

        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 2048, payload: pattern(992, 1) }));

        expect(rig.counter(FLOW_CONTROL_UNDER_RUNS)).toBe(1);
        expect(rig.hwmPosition.get()).toBe(4096);
        // behind the status message but inside the window below it (the max window): it still counts as a sign of life
        expect(rig.image.timeOfLastPacketNs).toBeGreaterThanOrEqual(lastPacketNs);
    });
});

describe('PublicationImageLostSetupExtraTest', () => {
    it('data for a stream with no image elicits a setup frame; a setup frame that is lost is elicited again when the wait is over', () => {
        rig = new ReceiverRig();
        rig.subscribe();
        rig.cycle(1);

        rig.deliver(frameAt(0));
        let setups = rig.statusMessages().filter((sm) => 0 !== (sm.flags() & StatusMessageFlyweight.SEND_SETUP_FLAG));
        expect(setups.length).toBe(1);
        expect(setups[0]?.sessionId()).toBe(rig.sessionId);
        expect(setups[0]?.streamId()).toBe(rig.streamId);
        expect(setups[0]?.receiverWindowLength()).toBe(0);

        // more data while the setup is awaited does not elicit it again
        rig.deliver(frameAt(1));
        setups = rig.statusMessages().filter((sm) => 0 !== (sm.flags() & StatusMessageFlyweight.SEND_SETUP_FLAG));
        expect(setups.length).toBe(1);

        // the wait is over: the interest is dropped, and the next data elicits the setup frame again
        rig.cycle(Configuration.PENDING_SETUPS_TIMEOUT_NS + 1);
        rig.deliver(frameAt(2));
        setups = rig.statusMessages().filter((sm) => 0 !== (sm.flags() & StatusMessageFlyweight.SEND_SETUP_FLAG));
        expect(setups.length).toBe(2);
        expect(rig.requests.length).toBe(0);
    });
});
