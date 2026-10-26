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
// Extra tests of T15 (port-only): the interaction matrix rows "Data path" and "Loss and flow" that the sender can
// reach, on a real `Sender`, `NetworkPublication`, `SendChannelEndpoint`, `UnicastFlowControl` and `RetransmitHandler`
// over an in-memory log and a socket that records the datagrams (`test/support/SenderRig.ts`):
// offer / tryClaim -> sender scan for 0 bytes, 1 byte, MTU - 32, fragmented and maximum messages and the padding at the
// end of the term; a socket that short-sends for N cycles (spec 4.2); term rotation during a retransmit; the window of
// a retransmit; `init-term-id` near INT32_MAX; positions near the cap; a NAK in flight when the publication closes;
// status messages and NAKs from the network that cannot be positions (spec D36); the states of the publication.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Integer } from '../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import type { DriverConductor } from '../../../src/driver/DriverConductor.js';

/** The members of the conductor that `NetworkPublication.onTimeEvent` calls. */
type PublicationConductor = Pick<
    DriverConductor,
    'cleanupSpies' | 'cleanupPublication' | 'notifyUnavailableImageLink' | 'notifyAvailableImageLink'
>;
import { NetworkPublication } from '../../../src/driver/NetworkPublication.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { AtomicLongPosition } from '../../support/AtomicLongPosition.js';
import type { Fake } from '../../support/Mockito.js';
import type { SubscriptionLink } from '../../../src/driver/SubscriptionLink.js';
import { SenderRig } from '../../support/SenderRig.js';

const { align } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const MTU = 1408;
const MAX_PAYLOAD = MTU - HEADER_LENGTH;
const MAX_MESSAGE = TERM / 8;
const WINDOW = TERM / 2;

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

interface Frame {
    flags: number;
    type: number;
    termId: number;
    termOffset: number;
    frameLength: number;
    payload: Uint8Array;
}

/** The frames in the data and padding datagrams from index `from`, in the order they were sent. */
function framesOf(rig: SenderRig, from = 0): Frame[] {
    const frames: Frame[] = [];
    for (const datagram of rig.datagrams().slice(from)) {
        const view = new UnsafeBuffer(datagram);
        let offset = 0;
        const type = FrameDescriptor.frameType(view, 0);
        if (HeaderFlyweight.HDR_TYPE_DATA !== type && HeaderFlyweight.HDR_TYPE_PAD !== type) {
            continue;
        }
        while (offset < datagram.length) {
            const frameLength = FrameDescriptor.frameLength(view, offset);
            if (0 === frameLength) {
                break; // a heartbeat
            }
            frames.push({
                flags: FrameDescriptor.frameFlags(view, offset) & 0xff,
                type: FrameDescriptor.frameType(view, offset),
                termId: FrameDescriptor.frameTermId(view, offset),
                termOffset: view.getInt(offset + DataHeaderFlyweight.TERM_OFFSET_FIELD_OFFSET),
                frameLength,
                payload: datagram.slice(
                    offset + HEADER_LENGTH,
                    offset + Math.min(frameLength, datagram.length - offset),
                ),
            });
            offset +=
                HeaderFlyweight.HDR_TYPE_PAD === FrameDescriptor.frameType(view, offset)
                    ? datagram.length
                    : align(frameLength, FRAME_ALIGNMENT);
        }
    }

    return frames;
}

function counter(rig: SenderRig, descriptor: SystemCounterDescriptor): number {
    return (rig.context.systemCounters() as SystemCounters).get(descriptor).get();
}

/** The setup frame is out; the receiver answers with a status message that opens `WINDOW`. Returns the first datagram index of the test. */
function connect(rig: SenderRig, position = rig.senderPosition.get()): number {
    rig.sender.doWork();
    rig.sendStatusMessage(position, WINDOW);
    rig.sender.doWork(); // the first heartbeat is due as soon as the receiver is connected
    return rig.datagrams().length;
}

function newConductor(): Fake<PublicationConductor> & DriverConductor {
    return {
        cleanupSpies: vi.fn<PublicationConductor['cleanupSpies']>(),
        cleanupPublication: vi.fn<PublicationConductor['cleanupPublication']>(),
        notifyUnavailableImageLink: vi.fn<PublicationConductor['notifyUnavailableImageLink']>(),
        notifyAvailableImageLink: vi.fn<PublicationConductor['notifyAvailableImageLink']>(),
    } as unknown as Fake<PublicationConductor> & DriverConductor;
}

/** Offers `count` frames of 1024 bytes, a batch at a time, with the receiver consuming and the conductor cleaning behind. */
function produce(target: SenderRig, count: number): number {
    let position = 0;
    for (let done = 0; done < count; done += 16) {
        for (let i = 0; i < Math.min(16, count - done); i++) {
            position = target.producer.offer(pattern(992, done + i));
        }
        target.driveTo(position, 2000);
        for (let i = 0; i < 4; i++) {
            target.publication.updatePublisherPositionAndLimit();
        }
    }

    return position;
}

/** `mock(SubscriptionLink.class)` as far as the publication calls it. */
function link(isTether: boolean, isRejoin: boolean): SubscriptionLink {
    return { isTether: () => isTether, isRejoin: () => isRejoin } as unknown as SubscriptionLink;
}

let rig: SenderRig;

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('NetworkPublicationDataPathExtraTest', () => {
    it.each([
        ['0 bytes', 0],
        ['1 byte', 1],
        ['MTU - 32 bytes (one full frame)', MAX_PAYLOAD],
        ['MTU - 31 bytes (two frames)', MAX_PAYLOAD + 1],
        ['three frames and 17 bytes', 3 * MAX_PAYLOAD + 17],
        ['the maximum message length', MAX_MESSAGE],
    ])('offer of %s: the receiver gets the message in the frames of the log, once', (_name, length) => {
        rig = new SenderRig();
        const baseline = connect(rig);
        const message = pattern(length);
        const position = rig.producer.offer(message);

        rig.driveTo(position);

        expect(rig.senderPosition.get()).toBe(position);
        expect(rig.checkWire(baseline, 0)).toBe(position);
        const frames = framesOf(rig, baseline);
        expect(frames.length).toBe(0 === length ? 1 : Math.ceil(length / MAX_PAYLOAD));
        expect(frames[0]?.flags).toBe(
            frames.length > 1 ? FrameDescriptor.BEGIN_FRAG_FLAG & 0xff : DataHeaderFlyweight.BEGIN_AND_END_FLAGS & 0xff,
        );
        if (frames.length > 1) {
            expect(frames.slice(1, -1).every((f) => 0 === f.flags)).toBe(true);
            expect(frames[frames.length - 1]?.flags).toBe(FrameDescriptor.END_FRAG_FLAG);
        }
        const received = new Uint8Array(length);
        let at = 0;
        for (const frame of frames) {
            received.set(frame.payload.subarray(0, frame.frameLength - HEADER_LENGTH), at);
            at += frame.frameLength - HEADER_LENGTH;
        }
        expect(at).toBe(length);
        expect(Buffer.from(received).equals(Buffer.from(message))).toBe(true);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(0);
    });

    it('messages of every size back to back arrive in order, each byte once', () => {
        rig = new SenderRig();
        const baseline = connect(rig);
        let position = 0;
        for (const length of [
            0,
            1,
            31,
            32,
            33,
            MAX_PAYLOAD - 1,
            MAX_PAYLOAD,
            MAX_PAYLOAD + 1,
            2 * MAX_PAYLOAD,
            5000,
            0,
            7,
        ]) {
            position = rig.producer.offer(pattern(length, length));
        }

        rig.driveTo(position);

        expect(rig.checkWire(baseline, 0)).toBe(position);
        expect(rig.senderPosition.get()).toBe(position);
    });

    it('a claim that is not committed is not sent; when it is committed it is, with the bytes written', () => {
        rig = new SenderRig();
        const baseline = connect(rig);
        const { claim, position } = rig.producer.tryClaim(100);

        for (let i = 0; i < 3; i++) {
            rig.clock.advance(1);
            rig.sender.doWork();
        }
        expect(rig.senderPosition.get()).toBe(0);
        expect(framesOf(rig, baseline)).toEqual([]);

        claim.buffer().putBytes(claim.offset(), pattern(100));
        claim.commit();
        rig.driveTo(position);

        expect(rig.checkWire(baseline, 0)).toBe(position);
        const frames = framesOf(rig, baseline);
        expect(frames.length).toBe(1);
        expect(frames[0]?.frameLength).toBe(100 + HEADER_LENGTH);
        expect(Buffer.from(frames[0]?.payload ?? []).equals(Buffer.from(pattern(100)))).toBe(true);
    });

    it('a claim that is aborted becomes a padding frame that the sender passes over, with the data behind it sent', () => {
        rig = new SenderRig();
        const baseline = connect(rig);
        const { claim } = rig.producer.tryClaim(100);
        claim.abort();
        const position = rig.producer.offer(pattern(10));

        rig.driveTo(position);

        expect(rig.checkWire(baseline, 0)).toBe(position);
        const frames = framesOf(rig, baseline);
        expect(frames.map((f) => f.type)).toEqual([HeaderFlyweight.HDR_TYPE_PAD, HeaderFlyweight.HDR_TYPE_DATA]);
        expect(frames[0]?.frameLength).toBe(100 + HEADER_LENGTH);
        expect(frames[1]?.termOffset).toBe(align(100 + HEADER_LENGTH, FRAME_ALIGNMENT));
    });

    it.each([
        ['64 messages that fill the term exactly', 992, 64, 0],
        ['a message that does not fit in the 64 bytes that are left', 1000, 62, 64],
        [
            'a message that does not fit in the 32 bytes that are left (a padding frame of the header only)',
            1000,
            61,
            32,
        ],
    ])('padding at the end of the term: %s', (_name, payload, count, padding) => {
        rig = new SenderRig();
        const baseline = connect(rig);
        let position = 0;
        for (let i = 0; i < count; i++) {
            position = rig.producer.offer(pattern(payload, i));
        }
        if (32 === padding) {
            // 61 messages of 1056 bytes leave 1120: one of 1088 bytes (payload 1056) leaves 32
            position = rig.producer.offer(pattern(1056, 99));
        }
        const before = position;
        const next = rig.producer.offer(pattern(payload, 100));

        // the next message is in the next term, after the padding (if there is any)
        expect(next).toBe(TERM + align(payload + HEADER_LENGTH, FRAME_ALIGNMENT));
        expect(before + padding).toBe(TERM);

        rig.driveTo(next);

        expect(rig.checkWire(baseline, 0)).toBe(next);
        expect(rig.senderPosition.get()).toBe(next);
        const frames = framesOf(rig, baseline);
        const pads = frames.filter((f) => HeaderFlyweight.HDR_TYPE_PAD === f.type);
        expect(pads.length).toBe(padding > 0 ? 1 : 0);
        if (padding > 0) {
            expect(pads[0]?.frameLength).toBe(padding);
            expect(pads[0]?.termOffset).toBe(TERM - padding);
        }
        const last = frames[frames.length - 1];
        expect(last?.termOffset).toBe(0);
        expect(last?.termId).toBe(rig.initialTermId + 1);
    });
});

describe('NetworkPublicationShortSendExtraTest', () => {
    it.each([1, 2, 5, 25])(
        'a socket that short-sends for %d cycles: senderPosition holds, SHORT_SENDS counts them, the receiver gets every byte once',
        (cycles) => {
            rig = new SenderRig();
            const baseline = connect(rig);
            let position = 0;
            for (let i = 0; i < 10; i++) {
                position = rig.producer.offer(pattern(1000, i));
            }
            const shortSendsBefore = counter(rig, SystemCounterDescriptor.SHORT_SENDS);
            rig.socket.block = cycles;

            for (let i = 1; i <= cycles; i++) {
                rig.clock.advance(1);
                rig.sender.doWork();

                expect(rig.senderPosition.get()).toBe(0);
                expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS) - shortSendsBefore).toBe(i);
                expect(rig.datagrams().length).toBe(baseline);
            }

            rig.driveTo(position);

            expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS) - shortSendsBefore).toBe(cycles);
            expect(rig.senderPosition.get()).toBe(position);
            expect(rig.checkWire(baseline, 0)).toBe(position);
            // every byte of the log once: the data datagrams are the frames of the log, one after the other
            const sent = rig
                .datagrams()
                .slice(baseline)
                .reduce((total, datagram) => total + datagram.length, 0);
            expect(sent).toBe(position);
        },
    );

    it('a setup frame that is short-sent is sent again when the setup timeout is over', () => {
        rig = new SenderRig();
        rig.socket.block = 1;

        rig.sender.doWork();
        expect(rig.datagrams().length).toBe(0);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(1);

        rig.clock.advance(Configuration.PUBLICATION_SETUP_TIMEOUT_NS - 1);
        rig.sender.doWork();
        expect(rig.datagrams().length).toBe(0);

        rig.clock.advance(2);
        rig.sender.doWork();
        expect(rig.datagrams().length).toBe(1);
        const setup = new SetupFlyweight(new UnsafeBuffer(rig.datagrams()[0] as Uint8Array));
        expect(setup.headerType()).toBe(HeaderFlyweight.HDR_TYPE_SETUP);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(1);
    });

    it('a heartbeat that is short-sent is counted and the next one is sent when the heartbeat timeout is over', () => {
        rig = new SenderRig();
        const baseline = connect(rig);
        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.socket.block = 1;

        rig.sender.doWork();
        expect(rig.datagrams().length).toBe(baseline);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(1);

        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.sender.doWork();
        expect(rig.datagrams().length).toBe(baseline + 1);
        expect(
            new UnsafeBuffer(rig.datagrams()[baseline] as Uint8Array).getInt(HeaderFlyweight.FRAME_LENGTH_FIELD_OFFSET),
        ).toBe(0);
    });

    it('a retransmit that is short-sent stops, counts, and the NAK can be answered again after the linger', () => {
        rig = new SenderRig({ retransmitLingerNs: 1_000_000 });
        const baseline = connect(rig);
        const position = rig.producer.offer(pattern(1000));
        rig.driveTo(position);
        const sent = rig.datagrams().length;
        rig.socket.block = 1;

        rig.sendNak(rig.initialTermId, 0, 1056);

        expect(rig.datagrams().length).toBe(sent);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(1);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);

        rig.clock.advance(2_000_000);
        rig.sender.doWork(); // the linger of the first NAK is over
        rig.sendNak(rig.initialTermId, 0, 1056);

        expect(rig.datagrams().length).toBe(sent + 1);
        expect(
            Buffer.from(rig.datagrams()[sent] as Uint8Array).equals(
                Buffer.from(rig.datagrams()[baseline] as Uint8Array),
            ),
        ).toBe(true);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITTED_BYTES)).toBe(1056);
    });
});

describe('NetworkPublicationRetransmitExtraTest', () => {
    const FRAME = 1024;
    const PAYLOAD = FRAME - HEADER_LENGTH;

    /** A rig whose sender has sent `count` frames of 1024 bytes (64 to a term). */
    function sentFrames(count: number, options = {}): number {
        rig = new SenderRig(options);
        connect(rig);
        let position = 0;
        for (let i = 0; i < count; i++) {
            position = rig.producer.offer(pattern(PAYLOAD, i));
        }
        rig.driveTo(position, 2000);

        return position;
    }

    function nakAt(position: number, length = FRAME): void {
        const termCount = Math.floor(position / TERM);
        rig.sendNak((rig.initialTermId + termCount) | 0, position - termCount * TERM, length);
    }

    it('term rotation: a NAK for the frames of the term behind is answered from that term while the sender is in the next', () => {
        const position = sentFrames(64 + 3); // the sender is 3 frames into the second term
        expect(position).toBe(TERM + 3 * FRAME);
        const baseline = rig.datagrams().length;

        nakAt(TERM - 2 * FRAME, 2 * FRAME);

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITTED_BYTES)).toBe(2 * FRAME);
        expect(rig.checkWire(baseline, TERM - 2 * FRAME)).toBe(TERM);
        expect(framesOf(rig, baseline).map((f) => f.termId)).toEqual([rig.initialTermId, rig.initialTermId]);
    });

    it('a NAK for the frames before the padding at the end of the term is answered with the frames and the padding header', () => {
        rig = new SenderRig();
        connect(rig);
        for (let i = 0; i < 62; i++) {
            rig.producer.offer(pattern(1000, i)); // frames of 1056: 64 bytes are left
        }
        const position = rig.producer.offer(pattern(1000, 99)); // padding of 64, then the frame in the next term
        rig.driveTo(position, 2000);
        const baseline = rig.datagrams().length;

        rig.sendNak(rig.initialTermId, TERM - 64 - 1056, 1056 + 64);

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITTED_BYTES)).toBe(1056 + 64);
        expect(rig.checkWire(baseline, TERM - 64 - 1056)).toBe(TERM);
        expect(framesOf(rig, baseline).map((f) => f.type)).toEqual([
            HeaderFlyweight.HDR_TYPE_DATA,
            HeaderFlyweight.HDR_TYPE_PAD,
        ]);
    });

    it('the window of a retransmit: the bottom is half a term and a maximum message behind the sender, the top is the sender position', () => {
        const position = sentFrames(64 * 3); // three whole terms
        const bottom = position - TERM / 2 - MAX_MESSAGE;
        expect(bottom % FRAME).toBe(0);

        const sentBefore = rig.datagrams().length;
        nakAt(bottom - FRAME);
        expect(rig.datagrams().length).toBe(sentBefore); // below the window
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);

        nakAt(bottom);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(rig.checkWire(sentBefore, bottom)).toBe(bottom + FRAME);

        rig.clock.advance(Configuration.retransmitUnicastLingerNs() + 1);
        rig.sender.doWork();
        const afterBottom = rig.datagrams().length;
        nakAt(position); // at the sender position: nothing sent there yet
        expect(rig.datagrams().length).toBe(afterBottom);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);

        nakAt(position - FRAME);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(2);
        expect(rig.checkWire(afterBottom, position - FRAME)).toBe(position);
    });

    it('the conductor cleans one term behind the sender, which is behind the window of a retransmit', () => {
        const position = sentFrames(64 * 2 + 4);
        expect(position).toBe(2 * TERM + 4 * FRAME);

        rig.publication.updatePublisherPositionAndLimit();

        const cleaned = rig.publication.cleanPosition;
        expect(cleaned).toBe(TERM);
        expect((rig.rawLog.termBuffers()[0] as UnsafeBuffer).getLongVolatile(0)).toBe(0);
        expect(cleaned).toBeLessThan(position - TERM / 2 - MAX_MESSAGE);
    });

    it('a NAK for frames in the window that hold no data (a term that is zero) finds nothing to send', () => {
        const position = sentFrames(64 * 2 + 4);
        (rig.rawLog.termBuffers()[2] as UnsafeBuffer).setMemory(0, 4 * FRAME, 0);
        const baseline = rig.datagrams().length;

        rig.publication.resend((rig.initialTermId + 2) | 0, 0, FRAME);

        expect(rig.datagrams().length).toBe(baseline);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(0);
        expect(position).toBe(2 * TERM + 4 * FRAME);
    });

    it('a NAK of a length above the MTU is sent in datagrams of at most the MTU, in order, each byte once', () => {
        sentFrames(30);
        const baseline = rig.datagrams().length;

        nakAt(0, 30 * FRAME);

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        const datagrams = rig.datagrams().slice(baseline);
        expect(datagrams.every((d) => d.length <= MTU)).toBe(true);
        expect(rig.checkWire(baseline, 0)).toBe(counter(rig, SystemCounterDescriptor.RETRANSMITTED_BYTES));
    });
});

describe('NetworkPublicationTermIdWrapExtraTest', () => {
    const INITIAL = Integer.MAX_VALUE - 1;

    it('init-term-id near INT32_MAX: the term ids on the wire wrap, the positions do not', () => {
        rig = new SenderRig({ initialTermId: INITIAL });
        const baseline = connect(rig);
        const position = produce(rig, 64 * 4 + 5);

        // the conductor cleaned the log behind the sender, so the bytes are not compared
        expect(rig.checkWire(baseline, 0, false)).toBe(position);
        const termIds = [...new Set(framesOf(rig, baseline).map((f) => f.termId))];
        expect(termIds).toEqual([
            INITIAL,
            Integer.MAX_VALUE,
            Integer.MIN_VALUE,
            Integer.MIN_VALUE + 1,
            Integer.MIN_VALUE + 2,
        ]);
        expect(rig.publication.producerPosition()).toBe(position);
        // the conductor cleans a term at a time behind the sender before it lets the limit move
        for (let i = 0; i < 10 && rig.publisherLimit.get() < position + WINDOW; i++) {
            rig.publication.updatePublisherPositionAndLimit();
        }
        expect(rig.publisherLimit.get()).toBe(position + WINDOW);
        expect(rig.publisherPos.get()).toBe(position);
    });

    it('a stream that starts at the wrapped term: setup and heartbeat carry the wrapped term id', () => {
        rig = new SenderRig({ initialTermId: INITIAL, startTermCount: 2, startTermOffset: 512 });
        rig.sender.doWork();
        const setup = new SetupFlyweight(new UnsafeBuffer(rig.datagrams()[0] as Uint8Array));
        expect(setup.initialTermId()).toBe(INITIAL);
        expect(setup.activeTermId()).toBe(Integer.MIN_VALUE);
        expect(setup.termOffset()).toBe(512);

        rig.sendStatusMessage(2 * TERM + 512, WINDOW);
        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.sender.doWork();
        const heartbeat = new DataHeaderFlyweight(new UnsafeBuffer(rig.datagrams()[1] as Uint8Array));
        expect(heartbeat.frameLength()).toBe(0);
        expect(heartbeat.termId()).toBe(Integer.MIN_VALUE);
        expect(heartbeat.termOffset()).toBe(512);
    });

    it('a NAK for the term before the wrap is answered from that term while the sender is in the wrapped one', () => {
        rig = new SenderRig({ initialTermId: INITIAL, startTermCount: 1, startTermOffset: 512 });
        const baseline = connect(rig, TERM + 512);
        let position = 0;
        for (let i = 0; i < 64; i++) {
            position = rig.producer.offer(pattern(992, i)); // 63 frames to the end of the term (512 bytes of padding), one in the next
        }
        expect(position).toBe(2 * TERM + 1024);
        rig.driveTo(position, 2000);
        const afterData = rig.datagrams().length;

        rig.sendNak(Integer.MAX_VALUE, 64000, 1024);

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(rig.checkWire(afterData, TERM + 64000)).toBe(TERM + 64000 + 1024);
        expect(framesOf(rig, afterData)[0]?.termId).toBe(Integer.MAX_VALUE);
        expect(framesOf(rig, baseline).some((f) => f.termId === Integer.MIN_VALUE)).toBe(true);
    });

    it('a status message that carries a wrapped consumption term id is accepted', () => {
        rig = new SenderRig({ initialTermId: INITIAL, startTermCount: 2, startTermOffset: 0 });
        rig.sender.doWork();
        const accepted = counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED);

        rig.sendStatusMessageAt(Integer.MIN_VALUE, 0, WINDOW);

        expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED)).toBe(accepted + 1);
        expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_REJECTED)).toBe(0);
        expect(rig.senderLimit.get()).toBe(2 * TERM + WINDOW);
    });
});

describe('NetworkPublicationPositionCapExtraTest', () => {
    const TERM_LENGTHS = [TERM, 4 * 1024 * 1024];

    it.each(TERM_LENGTHS)(
        'positions up to the cap of a term length of %d: exact, no overflow, no throw',
        (termLength) => {
            const cap = LogBufferDescriptor.maxPossiblePosition(termLength);
            const capTerms = cap / termLength;
            rig = new SenderRig({
                termLength,
                initialTermId: 12345,
                startTermCount: capTerms - 1,
                startTermOffset: termLength - 8192,
            });
            const baseline = connect(rig, cap - 8192);
            let position = 0;
            for (let i = 0; i < 8; i++) {
                position = rig.producer.offer(pattern(992, i)); // 8 frames of 1024 fill the last term
            }
            expect(position).toBe(cap);

            rig.driveTo(position, 200);

            expect(rig.senderPosition.get()).toBe(cap);
            expect(rig.publication.producerPosition()).toBe(cap);
            expect(rig.checkWire(baseline, cap - 8192)).toBe(cap);
            rig.publication.updatePublisherPositionAndLimit();
            expect(rig.publisherPos.get()).toBe(cap);
            expect(rig.publisherLimit.get()).toBe(cap + rig.windowLength);

            // at the cap there is nothing more: heartbeats, with the term id and offset of the position (a status message
            // from there is not a position the receiver can send: past 2^31 terms the term count of the id wraps, as in Java)
            rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
            const sent = rig.datagrams().length;
            rig.sender.doWork();
            expect(rig.datagrams().length).toBe(sent + 1);
            const heartbeat = new DataHeaderFlyweight(new UnsafeBuffer(rig.datagrams()[sent] as Uint8Array));
            expect(heartbeat.frameLength()).toBe(0);
            expect(heartbeat.termOffset()).toBe(0);
            expect(heartbeat.termId()).toBe((12345 + capTerms) | 0);
        },
    );

    it.each(TERM_LENGTHS)('rotation into the last term before the cap of a term length of %d', (termLength) => {
        const cap = LogBufferDescriptor.maxPossiblePosition(termLength);
        const capTerms = cap / termLength;
        rig = new SenderRig({
            termLength,
            startTermCount: capTerms - 2,
            startTermOffset: termLength - 2048,
        });
        const start = cap - termLength - 2048;
        const baseline = connect(rig, start);
        let position = 0;
        for (let i = 0; i < 6; i++) {
            position = rig.producer.offer(pattern(992, i)); // two fill the term, four are in the last one
        }
        expect(position).toBe(cap - termLength + 4096);

        rig.driveTo(position, 200);

        expect(rig.checkWire(baseline, start)).toBe(position);
        expect(framesOf(rig, baseline).map((f) => f.termOffset)).toEqual([
            termLength - 2048,
            termLength - 1024,
            0,
            1024,
            2048,
            3072,
        ]);
    });
});

describe('NetworkPublicationCloseExtraTest', () => {
    function drained(options = {}): { position: number; baseline: number } {
        rig = new SenderRig({ retransmitDelayNs: 1_000_000, ...options });
        connect(rig);
        let position = 0;
        for (let i = 0; i < 3; i++) {
            position = rig.producer.offer(pattern(1000, i));
        }
        rig.driveTo(position);
        return { position, baseline: rig.datagrams().length };
    }

    /** DRAINING -> LINGER -> DONE as the conductor drives them. */
    function closeToDone(conductor: DriverConductor): void {
        rig.publication.decRef();
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        rig.clock.advance(Configuration.publicationLingerTimeoutNs() + 1);
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
    }

    it('a NAK that is waiting for its delay when the publication is removed is never answered, and nothing throws', () => {
        const { baseline } = drained();
        rig.sendNak(rig.initialTermId, 0, 1056);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);
        const conductor = newConductor();

        closeToDone(conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.DONE);
        expect(conductor.cleanupPublication).toHaveBeenCalledTimes(1);
        rig.sender.onRemoveNetworkPublication(rig.publication);
        expect(rig.publication.hasReachedEndOfLife()).toBe(true);
        rig.publication.close();
        rig.rawLog.free();

        for (let i = 0; i < 5; i++) {
            rig.clock.advance(10_000_000);
            rig.sender.doWork();
        }

        expect(rig.datagrams().length).toBe(baseline);
        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);
    });

    it('a NAK that arrives after the publication is removed from the endpoint is ignored', () => {
        const { baseline } = drained({ retransmitDelayNs: 0 });
        closeToDone(newConductor());
        rig.sender.onRemoveNetworkPublication(rig.publication);
        const naks = counter(rig, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED);

        rig.sendNak(rig.initialTermId, 0, 1056);
        rig.sender.doWork();

        expect(counter(rig, SystemCounterDescriptor.NAK_MESSAGES_RECEIVED)).toBe(naks);
        expect(rig.datagrams().length).toBe(baseline);
    });

    it('a NAK that is waiting while the publication drains and lingers is answered from the log, which is still there', () => {
        const { baseline } = drained();
        rig.sendNak(rig.initialTermId, 0, 1056);
        const conductor = newConductor();

        rig.publication.decRef();
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.LINGER);
        rig.clock.advance(2_000_000);
        rig.sender.doWork();

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(rig.checkWire(baseline, 0)).toBe(1056);
    });

    it('a NAK that arrives after the counters of the publication are closed does not throw', () => {
        drained({ retransmitDelayNs: 0 });
        const baseline = rig.datagrams().length;
        rig.publication.close();

        rig.sendNak(rig.initialTermId, 0, 1056);

        expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(1);
        expect(rig.checkWire(baseline, 0)).toBe(1056);
    });

    it('the end of stream: the heartbeat of a drained publication carries the EOS flag, when the publication signals it', () => {
        rig = new SenderRig({ signalEos: true });
        const baseline = connect(rig);
        const position = rig.producer.offer(pattern(10));
        rig.driveTo(position);

        rig.publication.decRef();
        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.sender.doWork();

        const heartbeat = new DataHeaderFlyweight(
            new UnsafeBuffer(rig.datagrams()[rig.datagrams().length - 1] as Uint8Array),
        );
        expect(heartbeat.frameLength()).toBe(0);
        expect(heartbeat.flags()).toBe(DataHeaderFlyweight.BEGIN_END_AND_EOS_FLAGS);
        expect(rig.datagrams().length).toBeGreaterThan(baseline);
    });

    it('without signalEos the heartbeat of a drained publication has no EOS flag', () => {
        rig = new SenderRig({ signalEos: false });
        connect(rig);
        const position = rig.producer.offer(pattern(10));
        rig.driveTo(position);

        rig.publication.decRef();
        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.sender.doWork();

        const heartbeat = new DataHeaderFlyweight(
            new UnsafeBuffer(rig.datagrams()[rig.datagrams().length - 1] as Uint8Array),
        );
        expect(heartbeat.flags()).toBe(DataHeaderFlyweight.BEGIN_AND_END_FLAGS);
    });

    it('a revoked publication lingers at once and its heartbeat says so', () => {
        rig = new SenderRig();
        connect(rig);
        const conductor = newConductor();
        const revoked = counter(rig, SystemCounterDescriptor.PUBLICATIONS_REVOKED);

        rig.publication.revoke();
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.LINGER);
        expect(counter(rig, SystemCounterDescriptor.PUBLICATIONS_REVOKED)).toBe(revoked + 1);
        expect(conductor.cleanupSpies).toHaveBeenCalledTimes(1);

        rig.clock.advance(Configuration.PUBLICATION_HEARTBEAT_TIMEOUT_NS + 1);
        rig.sender.doWork();
        const heartbeat = new DataHeaderFlyweight(
            new UnsafeBuffer(rig.datagrams()[rig.datagrams().length - 1] as Uint8Array),
        );
        expect(heartbeat.flags()).toBe(DataHeaderFlyweight.BEGIN_END_EOS_AND_REVOKED_FLAGS);
    });
});

describe('NetworkPublicationLifecycleExtraTest', () => {
    it('ACTIVE -> DRAINING -> LINGER -> DONE: the linger timeout, then the endpoint is released and the conductor cleans up once', () => {
        rig = new SenderRig();
        connect(rig);
        const conductor = newConductor();
        const decRef = vi.spyOn(rig.endpoint, 'decRef');
        expect(rig.publication.state()).toBe(NetworkPublication.State.ACTIVE);

        rig.publication.decRef();
        expect(rig.publication.state()).toBe(NetworkPublication.State.DRAINING);
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.LINGER);

        rig.clock.advance(Configuration.publicationLingerTimeoutNs());
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.LINGER); // not yet: the timeout is over after it

        rig.clock.advance(1);
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.DONE);
        expect(decRef).toHaveBeenCalledTimes(1);
        expect(conductor.cleanupPublication).toHaveBeenCalledTimes(1);

        rig.publication.onTimeEvent(rig.clock.nanoTime() + 1_000_000_000, 0, conductor);
        expect(conductor.cleanupPublication).toHaveBeenCalledTimes(1);
    });

    it('the end of stream of the receiver ends the linger of a unicast publication at once', () => {
        rig = new SenderRig();
        connect(rig);
        const conductor = newConductor();
        rig.sendStatusMessage(0, WINDOW, StatusMessageFlyweight.END_OF_STREAM_FLAG);

        rig.publication.decRef();
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);

        expect(rig.publication.state()).toBe(NetworkPublication.State.DONE);
    });

    it('a publication with unsent data stays DRAINING while a receiver is live, and moves on when it times out', () => {
        rig = new SenderRig();
        connect(rig);
        rig.producer.offer(pattern(100));
        const conductor = newConductor();

        rig.publication.decRef();
        rig.sendStatusMessage(0, 0); // the receiver is live and its window is closed
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.DRAINING);

        rig.clock.advance(Configuration.publicationConnectionTimeoutNs() + 1);
        rig.sender.doWork(); // updateHasReceivers: the receiver timed out
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(rig.publication.state()).toBe(NetworkPublication.State.LINGER);
    });

    it('the accessors that the conductor reads', () => {
        rig = new SenderRig({ initialTermId: 77, startTermCount: 1, startTermOffset: 256 });
        const publication = rig.publication;

        expect(publication.registrationId()).toBe(SenderRig.REGISTRATION_ID);
        expect(publication.subscribableRegistrationId()).toBe(SenderRig.REGISTRATION_ID);
        expect(publication.sessionId()).toBe(rig.sessionId);
        expect(publication.streamId()).toBe(rig.streamId);
        expect(publication.initialTermId()).toBe(77);
        expect(publication.startingTermId()).toBe(78);
        expect(publication.startingTermOffset()).toBe(256);
        expect(publication.termBufferLength()).toBe(TERM);
        expect(publication.mtuLength()).toBe(MTU);
        expect(publication.isExclusive()).toBe(true);
        expect(publication.tag()).toBe(0);
        expect(publication.channel()).toBe(rig.endpoint.originalUriString());
        expect(publication.channelEndpoint()).toBe(rig.endpoint);
        expect(publication.rawLog()).toBe(rig.rawLog);
        expect(publication.publisherLimitId()).toBe(rig.publisherLimit.id());
        expect(publication.isAcceptingSubscriptions()).toBe(true);
        expect(publication.hasSpies()).toBe(false);
        expect(publication.spiesSimulateConnection()).toBe(false);
        expect(publication.producerPosition()).toBe(TERM + 256);
        expect(publication.consumerPosition()).toBe(TERM + 256);
        expect(publication.responseCorrelationId()).toBe(-1);
        expect(publication.timeOfLastStatusMessageNs()).toBe(0);
        expect(publication.hasReachedEndOfLife()).toBe(false);
    });

    it('a spy position simulates a connection: the limit follows the slowest consumer and the sender moves with the spy', () => {
        rig = new SenderRig({ spiesSimulateConnection: true });
        const spy = new AtomicLongPosition();
        const spyLink = link(true, false);
        rig.publication.addSubscriber(spyLink, spy, 0);
        expect(rig.publication.hasSpies()).toBe(true);

        rig.publication.updatePublisherPositionAndLimit();
        expect(rig.publisherLimit.get()).toBe(rig.windowLength);

        spy.set(4096);
        rig.publication.updatePublisherPositionAndLimit();
        expect(rig.publication.maxSpyPosition).toBe(4096);
        expect(rig.publisherLimit.get()).toBe(rig.windowLength); // the sender is behind the spy: the minimum is the sender

        rig.clock.advance(1);
        rig.sender.doWork(); // no receiver: the sender position moves to the spy position
        expect(rig.senderPosition.get()).toBe(4096);

        rig.publication.removeSubscriber(spyLink, spy);
        expect(rig.publication.hasSpies()).toBe(false);
    });

    it.each([false, true])(
        'an untethered subscriber that falls behind is moved on: unavailable, then removed or resting, then available again (rejoin %s)',
        (rejoin) => {
            rig = new SenderRig({ spiesSimulateConnection: true });
            const conductor = newConductor();
            const context = rig.context;
            const untethered = link(false, rejoin);
            const position = new AtomicLongPosition(31);
            rig.publication.addSubscriber(untethered, position, 0);
            rig.senderPosition.set(40000); // the window limit for the subscriber is 40000 - 32768 + 8192 = 15424

            rig.clock.advance(context.untetheredWindowLimitTimeoutNs() - 1);
            rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
            expect(conductor.notifyUnavailableImageLink).not.toHaveBeenCalled();

            rig.clock.advance(1);
            rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
            expect(conductor.notifyUnavailableImageLink).toHaveBeenCalledWith(SenderRig.REGISTRATION_ID, untethered);
            expect(rig.publication.hasSpies()).toBe(true);

            rig.clock.advance(context.untetheredLingerTimeoutNs());
            rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
            expect(rig.publication.hasSpies()).toBe(false);
            if (!rejoin) {
                expect(position.isClosed()).toBe(true);
                expect(conductor.notifyAvailableImageLink).not.toHaveBeenCalled();
                return;
            }

            expect(position.isClosed()).toBe(false);
            rig.clock.advance(context.untetheredRestingTimeoutNs());
            rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
            expect(rig.publication.hasSpies()).toBe(true);
            expect(conductor.notifyAvailableImageLink).toHaveBeenCalledWith(
                SenderRig.REGISTRATION_ID,
                rig.sessionId,
                untethered,
                31,
                40000,
                rig.rawLog.fileName(),
                'aeron:ipc',
            );
            // a subscriber that is closed while resting has its position closed by the publication
            rig.publication.removeSubscriber(untethered, position);
            expect(position.isClosed()).toBe(true);
        },
    );

    it('closing the publication closes the positions of the resting untethered subscribers', () => {
        rig = new SenderRig({ spiesSimulateConnection: true });
        const conductor = newConductor();
        const position = new AtomicLongPosition(5);
        rig.publication.addSubscriber(link(false, true), position, 0);
        rig.senderPosition.set(40000);
        rig.clock.advance(rig.context.untetheredWindowLimitTimeoutNs());
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        rig.clock.advance(rig.context.untetheredLingerTimeoutNs());
        rig.publication.onTimeEvent(rig.clock.nanoTime(), 0, conductor);
        expect(position.isClosed()).toBe(false);

        rig.publication.close();

        expect(position.isClosed()).toBe(true);
    });

    it('an RTT measurement with the reply flag is answered with the same receiver id and timestamp, one without is not', () => {
        rig = new SenderRig();
        const baseline = connect(rig);
        const frame = new UnsafeBuffer(new Uint8Array(RttMeasurementFlyweight.HEADER_LENGTH));
        const msg = new RttMeasurementFlyweight(frame);
        msg.version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
            .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
        msg.sessionId(rig.sessionId).streamId(rig.streamId).receiverIdHigh(0x01020304).receiverIdLow(-5);
        msg.echoTimestampNs(123456789012345n).receptionDelta(7n).flags(0);

        rig.endpoint.onRttMeasurement(msg, frame, RttMeasurementFlyweight.HEADER_LENGTH, rig.rcvAddress);
        expect(rig.datagrams().length).toBe(baseline);

        msg.flags(RttMeasurementFlyweight.REPLY_FLAG);
        rig.endpoint.onRttMeasurement(msg, frame, RttMeasurementFlyweight.HEADER_LENGTH, rig.rcvAddress);

        expect(rig.datagrams().length).toBe(baseline + 1);
        const reply = new RttMeasurementFlyweight(new UnsafeBuffer(rig.datagrams()[baseline] as Uint8Array));
        expect(reply.headerType()).toBe(HeaderFlyweight.HDR_TYPE_RTTM);
        expect(reply.flags()).toBe(0);
        expect(reply.sessionId()).toBe(rig.sessionId);
        expect(reply.streamId()).toBe(rig.streamId);
        expect(reply.receiverIdHigh()).toBe(0x01020304);
        expect(reply.receiverIdLow()).toBe(-5);
        expect(reply.echoTimestampNs()).toBe(123456789012345n);
        expect(reply.receptionDelta()).toBe(0n);

        rig.socket.block = 1;
        rig.endpoint.onRttMeasurement(msg, frame, RttMeasurementFlyweight.HEADER_LENGTH, rig.rcvAddress);
        expect(counter(rig, SystemCounterDescriptor.SHORT_SENDS)).toBe(1);
    });
});

describe('NetworkPublicationNetworkInputExtraTest', () => {
    const HOSTILE_TERM_IDS = [Integer.MAX_VALUE, Integer.MIN_VALUE, 0x40000000, -0x40000000, 0x7ffffff0];

    it.each([TERM, 16 * 1024 * 1024])(
        'a status message with a consumption position that is no position is rejected, not thrown (term length %d)',
        (termLength) => {
            rig = new SenderRig({ termLength, initialTermId: 5 });
            connect(rig);
            const limit = rig.senderLimit.get();

            for (const termId of HOSTILE_TERM_IDS) {
                rig.sendStatusMessageAt(termId, 0, WINDOW);
            }

            expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_REJECTED)).toBe(HOSTILE_TERM_IDS.length);
            expect(rig.senderLimit.get()).toBe(limit);
            expect(rig.errors).toEqual([]);
        },
    );

    it.each([TERM, 16 * 1024 * 1024])(
        'a NAK for a position that is no position sends nothing and does not throw (term length %d)',
        (termLength) => {
            rig = new SenderRig({ termLength, initialTermId: 5 });
            connect(rig);
            const position = rig.producer.offer(pattern(500));
            rig.driveTo(position);
            const baseline = rig.datagrams().length;

            for (const termId of HOSTILE_TERM_IDS) {
                rig.sendNak(termId, 0, 1024);
                rig.clock.advance(Configuration.retransmitUnicastLingerNs() + 1);
                rig.sender.doWork();
            }

            expect(counter(rig, SystemCounterDescriptor.RETRANSMITS_SENT)).toBe(0);
            expect(rig.datagrams().length).toBe(baseline);
            expect(rig.errors).toEqual([]);
        },
    );

    it('a status message for a position inside the window is accepted at its edges and rejected one frame outside', () => {
        rig = new SenderRig();
        connect(rig);
        const accepted = counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED);
        const sender = rig.senderPosition.get();

        rig.sendStatusMessage(sender, 1);
        rig.sendStatusMessageAt((rig.initialTermId + 1) | 0, TERM / 2, 1); // sender + 1.5 terms
        expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_REJECTED)).toBe(0);

        rig.sendStatusMessageAt((rig.initialTermId + 1) | 0, TERM / 2 + FRAME_ALIGNMENT, 1);
        expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_REJECTED)).toBe(1);
        expect(counter(rig, SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED)).toBe(accepted + 3);
    });

    it('the conductor proxy hears of the first status message of a live receiver, once', () => {
        rig = new SenderRig();
        rig.sender.doWork();

        rig.sendStatusMessage(0, WINDOW);
        rig.sendStatusMessage(0, WINDOW);

        expect(rig.conductorProxy.responseConnected).toHaveBeenCalledTimes(1);
        expect(rig.conductorProxy.responseConnected).toHaveBeenCalledWith(-1);
    });

    it('an error frame from the only receiver reports the publication error to the conductor, once', () => {
        rig = new SenderRig();
        connect(rig);
        const address = new InetSocketAddress('127.0.0.1', 40123);
        const proxy = rig.conductorProxy as unknown as DriverConductorProxy;
        const error = {
            receiverIdHigh: () => 0,
            receiverIdLow: () => 42,
            receiverId: () => 42n,
            groupTag: () => 9n,
            sessionId: () => rig.sessionId,
            streamId: () => rig.streamId,
            errorCode: () => 3,
            errorMessage: () => 'no good',
        };

        rig.publication.onError(error as never, address, -1, proxy);
        rig.publication.onError(error as never, address, -1, proxy);

        expect(rig.conductorProxy.onPublicationError).toHaveBeenCalledTimes(1);
        expect(rig.conductorProxy.onPublicationError).toHaveBeenCalledWith(
            SenderRig.REGISTRATION_ID,
            -1,
            rig.sessionId,
            rig.streamId,
            42n,
            9n,
            address,
            3,
            'no good',
        );
    });
});
