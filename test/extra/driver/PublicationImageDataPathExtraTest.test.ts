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
// Extra tests of T16 (port-only): the interaction matrix row "Data path", for the receiver. On a real `Receiver`,
// `ReceiveChannelEndpoint`, `DataPacketDispatcher` and `PublicationImage` over an in-memory log and a socket that records
// what is sent (`test/support/ReceiverRig.ts`): `onDataPacket` -> `TermRebuilder.insert` for 0 bytes (a heartbeat), 1
// byte, MTU - 32, fragmented and maximum messages, the padding at the end of the term, term rotation, `init-term-id`
// near INT32_MAX and positions near the cap; and the same stream from a real `Sender` (`SenderRig`) into the receiver.
// Every test asserts the positions, the bytes the subscriber reads and the counters.
import { afterEach, describe, expect, it } from 'vitest';
import { BitUtil } from '../../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder, Integer } from '../../../src/agrona/jdk.js';
import { FrameDescriptor } from '../../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';
import { SenderRig } from '../../support/SenderRig.js';

const { align } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT } = FrameDescriptor;
const { BYTES_RECEIVED, HEARTBEATS_RECEIVED, INVALID_PACKETS, FLOW_CONTROL_OVER_RUNS, FLOW_CONTROL_UNDER_RUNS } =
    SystemCounterDescriptor;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const MTU = 1408;
const MAX_PAYLOAD = MTU - HEADER_LENGTH;

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }

    return out;
}

let rig: ReceiverRig;
let sender: SenderRig | null = null;

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
    sender?.close();
    sender = null;
});

describe('PublicationImageDataPathExtraTest', () => {
    it.each([1, 31, 32, 33, MAX_PAYLOAD - 32, MAX_PAYLOAD])(
        'a message of %d bytes in one frame: the position, the log and the counters',
        (length) => {
            rig = new ReceiverRig();
            rig.join();
            const frameLength = align(HEADER_LENGTH + length, FRAME_ALIGNMENT);
            const { datagrams, position } = rig.frames(0, pattern(length));
            expect(datagrams.length).toBe(1);
            expect((datagrams[0] as Uint8Array).length).toBe(frameLength);
            expect(position).toBe(frameLength);
            const bytesBefore = rig.counter(BYTES_RECEIVED);

            rig.deliver(datagrams[0] as Uint8Array);

            expect(rig.hwmPosition.get()).toBe(frameLength);
            expect(rig.counter(BYTES_RECEIVED) - bytesBefore).toBe(frameLength);
            expect(rig.counter(INVALID_PACKETS)).toBe(0);
            rig.run(2, 1000);
            expect(rig.rebuildPosition.get()).toBe(frameLength);
            expect(rig.read()).toEqual([pattern(length)]);
            expect(rig.subscriberPosition.get()).toBe(frameLength);
        },
    );

    it('a message of 0 bytes is a heartbeat: the high water mark moves to its position, nothing is written to the log', () => {
        rig = new ReceiverRig();
        rig.join();
        const heartbeats = rig.counter(HEARTBEATS_RECEIVED);
        const lastPacketNs = rig.image.timeOfLastPacketNs;
        rig.clock.advance(5000);

        rig.deliver(rig.heartbeat(rig.initialTermId, 0));

        expect(rig.counter(HEARTBEATS_RECEIVED)).toBe(heartbeats + 1);
        expect(rig.hwmPosition.get()).toBe(0);
        expect(rig.rebuildPosition.get()).toBe(0);
        expect(rig.image.timeOfLastPacketNs).toBe(lastPacketNs + 5000);
        expect(rig.image.isConnected(rig.clock.nanoTime())).toBe(true);
        expect(rig.read()).toEqual([]);
        const termBuffer = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
        for (let offset = 0; offset < 256; offset += 4) {
            expect(termBuffer.getInt(offset)).toBe(0);
        }
    });

    it('a heartbeat ahead of the high water mark moves it: the sender is at that position with nothing to send', () => {
        rig = new ReceiverRig();
        rig.join();
        const frame = (rig.frames(0, pattern(100)).datagrams[0] as Uint8Array).length;
        rig.deliver(rig.frames(0, pattern(100)).datagrams[0] as Uint8Array);
        expect(rig.hwmPosition.get()).toBe(frame);

        rig.deliver(rig.heartbeat(rig.initialTermId, frame + 640));

        expect(rig.hwmPosition.get()).toBe(frame + 640);
        // the receiver sees a gap from the rebuild position to the heartbeat: it asks for it
        rig.run(1, 1);
        expect(rig.naks().length).toBe(1);
        expect(rig.naks()[0]?.termOffset()).toBe(frame);
        expect(rig.naks()[0]?.length()).toBe(640);
    });

    it.each([
        [3000, 3],
        [MAX_PAYLOAD * 2, 2],
        [MAX_PAYLOAD * 2 + 1, 3],
        [TERM / 8, 6],
    ])('a message of %d bytes in %d fragments: the flags, the bytes and the positions', (length, fragments) => {
        rig = new ReceiverRig();
        rig.join();
        const message = pattern(length, 3);
        const { datagrams, position } = rig.frames(0, message);
        expect(datagrams.length).toBe(fragments);

        for (const datagram of datagrams) {
            rig.deliver(datagram);
        }

        expect(rig.hwmPosition.get()).toBe(position);
        rig.run(2, 1000);
        expect(rig.rebuildPosition.get()).toBe(position);
        const termBuffer = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
        const flags: number[] = [];
        let offset = 0;
        for (let i = 0; i < fragments; i++) {
            flags.push(FrameDescriptor.frameFlags(termBuffer, offset) & 0xff);
            offset += align(FrameDescriptor.frameLength(termBuffer, offset), FRAME_ALIGNMENT);
        }
        expect(flags).toEqual([
            FrameDescriptor.BEGIN_FRAG_FLAG & 0xff,
            ...new Array<number>(fragments - 2).fill(0),
            FrameDescriptor.END_FRAG_FLAG & 0xff,
        ]);
        expect(offset).toBe(position);
        expect(concat(rig.read())).toEqual(message);
    });

    it('the padding at the end of the term: the frame is written, the high water mark moves to the next term', () => {
        const termOffset = TERM - 2048;
        rig = new ReceiverRig({ termOffset });
        rig.join();
        const first = rig.frames(termOffset, pattern(MAX_PAYLOAD, 1));
        expect(first.position).toBe(TERM - 640);
        rig.deliver(first.datagrams[0] as Uint8Array);

        // the sender pads the 640 bytes that are left: the datagram is the header of the padding frame, which says 640
        rig.deliver(rig.padding(rig.initialTermId, TERM - 640, 640));

        expect(rig.hwmPosition.get()).toBe(TERM);
        expect(rig.counter(INVALID_PACKETS)).toBe(0);
        const next = rig.frames(TERM, pattern(500, 2));
        rig.deliver(next.datagrams[0] as Uint8Array);
        expect(rig.hwmPosition.get()).toBe(TERM + 544);
        rig.run(2, 1000);

        expect(rig.rebuildPosition.get()).toBe(TERM + 544);
        // the subscriber gets the two messages; the padding frame is not a message and is passed over
        expect(rig.read()).toEqual([pattern(MAX_PAYLOAD, 1), pattern(500, 2)]);
        expect(rig.subscriberPosition.get()).toBe(TERM + 544);
        const termBuffer = rig.rawLog.termBuffers()[0] as UnsafeBuffer;
        expect(FrameDescriptor.frameLength(termBuffer, TERM - 640)).toBe(640);
        expect(FrameDescriptor.frameType(termBuffer, TERM - 640)).toBe(HeaderFlyweight.HDR_TYPE_PAD);
    });

    it.each([1000, Integer.MAX_VALUE - 1, Integer.MAX_VALUE, Integer.MIN_VALUE, -2, -1, 0])(
        'term rotation over four terms from an initial term id of %d: positions are exact, every message arrives once in order',
        (initialTermId) => {
            rig = new ReceiverRig({ initialTermId });
            rig.join();
            let position = 0;
            const expected: Uint8Array[] = [];
            const received: Uint8Array[] = [];
            for (let i = 0; i < 260; i++) {
                const message = pattern(900 + (i % 7) * 40, i);
                expected.push(message);
                // the publication pads what is left of the term when the frame does not fit, and the frame is in the next
                const frameLength = align(HEADER_LENGTH + message.length, FRAME_ALIGNMENT);
                const left = TERM - (position & (TERM - 1));
                if (frameLength > left) {
                    const { termId, termOffset } = rig.at(position);
                    rig.deliver(rig.padding(termId, termOffset, left));
                    position += left;
                }
                const { datagrams } = rig.frames(position, message);
                expect(datagrams.length).toBe(1);
                rig.deliver(datagrams[0] as Uint8Array);
                position += frameLength;
                rig.run(1, 1000);
                received.push(...rig.read());
            }

            expect(position).toBeGreaterThan(3 * TERM);
            expect(rig.hwmPosition.get()).toBe(position);
            expect(rig.rebuildPosition.get()).toBe(position);
            expect(rig.subscriberPosition.get()).toBe(position);
            expect(received).toEqual(expected);
            // the term id of the last status message is the wrapped id of the position that the receiver reports
            const last = rig.statusMessages().at(-1);
            expect(last).toBeDefined();
            const reported = rig.positionOf(
                last?.consumptionTermId() as number,
                last?.consumptionTermOffset() as number,
            );
            expect(reported).toBeLessThanOrEqual(position);
            expect(position - reported).toBeLessThan(8192 + 4 * 1200);
            expect(reported % FRAME_ALIGNMENT).toBe(0);
            expect(rig.counter(INVALID_PACKETS)).toBe(0);
            expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(0);
            expect(rig.counter(FLOW_CONTROL_UNDER_RUNS)).toBe(0);
        },
    );

    it.each([
        [TERM, 'under-run'],
        [4 * 1024 * 1024, 'taken'],
    ])(
        'positions up to the cap of a term length of %d: exact, no overflow, a frame past the cap is %s, no throw',
        (termLength, pastTheCap) => {
            const cap = LogBufferDescriptor.maxPossiblePosition(termLength);
            const capTerms = cap / termLength;
            rig = new ReceiverRig({
                termLength,
                initialTermId: 12345,
                activeTermCount: capTerms - 1,
                termOffset: termLength - 8192,
            });
            rig.join();
            expect(rig.hwmPosition.get()).toBe(cap - 8192);
            expect(rig.rebuildPosition.get()).toBe(cap - 8192);
            let position = cap - 8192;
            for (let i = 0; i < 8; i++) {
                const { datagrams } = rig.frames(position, pattern(992, i));
                rig.deliver(datagrams[0] as Uint8Array);
                position += 1024;
                rig.run(1, 1000);
                expect(rig.read()).toEqual([pattern(992, i)]);
            }

            expect(position).toBe(cap);
            expect(rig.hwmPosition.get()).toBe(cap);
            expect(rig.rebuildPosition.get()).toBe(cap);
            expect(rig.subscriberPosition.get()).toBe(cap);

            // past the cap there is no term for a publication: a term count of 2^31 wraps to -2^31 (a position far
            // behind the window, an under run), while a count below it is a position that a number holds exactly
            const underRuns = rig.counter(FLOW_CONTROL_UNDER_RUNS);
            const pastTheCapTermId = (12345 + capTerms) | 0;
            rig.deliver(rig.heartbeat(pastTheCapTermId, 0));
            rig.deliver(rig.frame({ termId: pastTheCapTermId, termOffset: 0, payload: pattern(100) }));

            expect(rig.errors).toEqual([]);
            if ('under-run' === pastTheCap) {
                expect(rig.hwmPosition.get()).toBe(cap);
                expect(rig.counter(FLOW_CONTROL_UNDER_RUNS)).toBe(underRuns + 2);
            } else {
                // the heartbeat is a position: the high water mark is the cap, then the frame of 160 bytes
                expect(rig.hwmPosition.get()).toBe(cap + 160);
                expect(rig.counter(FLOW_CONTROL_UNDER_RUNS)).toBe(underRuns);
            }
        },
    );

    it('the stream of a real sender: every size, back to back, with padding and a term rotation', () => {
        const initialTermId = 54321;
        const options = { termLength: TERM, initialTermId, mtuLength: MTU, sessionId: 77, streamId: 88 };
        sender = new SenderRig(options);
        rig = new ReceiverRig(options);
        rig.subscribe();

        // the setup frame of the sender makes the receiver ask for an image
        sender.sender.doWork();
        const setup = sender.datagrams()[0] as Uint8Array;
        expect(new UnsafeBuffer(setup).getShort(HeaderFlyweight.TYPE_FIELD_OFFSET, ByteOrder.LITTLE_ENDIAN)).toBe(
            HeaderFlyweight.HDR_TYPE_SETUP,
        );
        rig.deliver(setup);
        rig.runConductorCommands();
        expect(rig.requests.length).toBe(1);
        expect(rig.requests[0]?.initialTermId).toBe(initialTermId);
        expect(rig.requests[0]?.termLength).toBe(TERM);
        expect(rig.requests[0]?.mtuLength).toBe(MTU);
        rig.createImage();

        const sizes = [1, 100, MAX_PAYLOAD - 32, MAX_PAYLOAD, MAX_PAYLOAD + 1, 3000, 8192, 0, 1, 5000];
        const expected: Uint8Array[] = [];
        const received: Uint8Array[] = [];
        let delivered = sender.datagrams().length;
        let position = 0;
        for (let round = 0; round < 12; round++) {
            for (const size of sizes) {
                const message = pattern(size, round * 31 + size);
                // the real sender is told how far the receiver has consumed, as the receiver tells it in its status messages
                position = sender.producer.offer(message);
                if (size > 0) {
                    expected.push(message);
                }
                sender.driveTo(position, 5000);
                for (let i = 0; i < 4; i++) {
                    sender.publication.updatePublisherPositionAndLimit(); // the conductor cleans the terms behind
                }
                for (; delivered < sender.datagrams().length; delivered++) {
                    rig.deliver(sender.datagrams()[delivered] as Uint8Array);
                }
                rig.run(1, 1000);
                received.push(...rig.read());
            }
        }

        // a zero length message is a frame with no payload, a message for the subscriber
        expect(position).toBeGreaterThan(2 * TERM);
        expect(rig.hwmPosition.get()).toBe(position);
        expect(rig.rebuildPosition.get()).toBe(position);
        expect(rig.counter(INVALID_PACKETS)).toBe(0);
        expect(rig.naks().length).toBe(0);
        const nonEmpty = received.filter((bytes) => bytes.length > 0);
        // fragments of one message are separate frames: join the fragments by the sizes
        const joined: Uint8Array[] = [];
        let cursor = 0;
        for (const message of expected) {
            const parts: Uint8Array[] = [];
            let length = 0;
            while (length < message.length) {
                const part = nonEmpty[cursor++] as Uint8Array;
                parts.push(part);
                length += part.length;
            }
            joined.push(concat(parts));
        }
        expect(joined).toEqual(expected);
        expect(cursor).toBe(nonEmpty.length);
    });
});
