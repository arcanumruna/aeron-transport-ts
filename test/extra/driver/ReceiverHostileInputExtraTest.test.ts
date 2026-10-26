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
// Extra tests of T16 (port-only): what the network can send. Nothing a datagram holds may throw out of
// `Receiver.doWork` (spec D36, as for the sender), stop the agent or move a position wrongly. On the receiver rig of
// `test/support/ReceiverRig.ts`: term ids and offsets that are not positions (every term length, both directions, with a
// BigInt oracle for the outcome), a grid of frame lengths and offsets against the validity rule, every prefix of a
// frame, seeded random datagrams and mutated frames (the positions only move forward and stay ordered; the same seed
// gives the same outcome), and a seeded model of a lossy network (loss, duplicates and reordering of data, heartbeats
// and status messages, NAK driven retransmits) where what the subscriber reads is what the source produced: once, in
// order.
import { afterEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { ByteOrder } from '../../../src/agrona/jdk.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { mulberry32 } from '../../support/Random.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const { INVALID_PACKETS, FLOW_CONTROL_OVER_RUNS, FLOW_CONTROL_UNDER_RUNS } = SystemCounterDescriptor;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const INT_MAX = 0x7fffffff;
const INT_MIN = -0x80000000;

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

let rig: ReceiverRig;

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

type Outcome = 'accepted' | 'over-run' | 'under-run';

/**
 * What Java's `long` arithmetic makes of a frame at `termCount` terms from the initial term and `offset`, with the last
 * status message at 0 and a half term of window: the oracle, exact in `bigint`.
 */
function oracle(termLength: number, termCount: number, offset: number, payload: number, heartbeat: boolean): Outcome {
    const position = BigInt(termCount) * BigInt(termLength) + BigInt(offset);
    const proposed = position + BigInt(payload);
    if (proposed > BigInt(termLength / 2)) {
        return 'over-run';
    }
    if (heartbeat) {
        return position >= 0n ? 'accepted' : 'under-run';
    }

    return position < 0n ? 'under-run' : 'accepted';
}

describe('ReceiverHostileTermIdExtraTest', () => {
    const TERM_COUNTS = [
        1,
        2,
        3,
        2 ** 20,
        2 ** 28 - 1,
        2 ** 28,
        2 ** 29 - 1,
        2 ** 29,
        2 ** 30,
        INT_MAX,
        -1,
        -2,
        -3,
        -(2 ** 28),
        -(2 ** 29),
        -(2 ** 30),
        INT_MIN + 1,
        INT_MIN,
    ];

    it.each([TERM, 4 * 1024 * 1024, 16 * 1024 * 1024])(
        'term ids from the network that are not positions, for a term length of %d: counted as an over run or an under run, nothing is stored, nothing throws',
        (termLength) => {
            rig = new ReceiverRig({ termLength, initialTermId: 12345 });
            rig.join();
            rig.cycle(1);
            let hwm = 0;
            let cases = 0;
            for (const termCount of [0, ...TERM_COUNTS]) {
                const termId = (12345 + termCount) | 0;
                for (const offset of [0, 32, termLength / 2, termLength - 64]) {
                    for (const kind of ['data', 'heartbeat', 'padding'] as const) {
                        const datagram =
                            'data' === kind
                                ? rig.frame({ termId, termOffset: offset, payload: pattern(32) })
                                : 'heartbeat' === kind
                                  ? rig.heartbeat(termId, offset)
                                  : rig.padding(termId, offset, 64);
                        const payload = 'heartbeat' === kind ? 0 : 64;
                        const expected = oracle(termLength, termCount, offset, payload, 'heartbeat' === kind);
                        const over = rig.counter(FLOW_CONTROL_OVER_RUNS);
                        const under = rig.counter(FLOW_CONTROL_UNDER_RUNS);
                        const invalid = rig.counter(INVALID_PACKETS);

                        rig.deliver(datagram);

                        const where = `${kind} at term count ${termCount} offset ${offset}`;
                        expect(rig.counter(INVALID_PACKETS), where).toBe(invalid);
                        expect(rig.counter(FLOW_CONTROL_OVER_RUNS) - over, where).toBe('over-run' === expected ? 1 : 0);
                        expect(rig.counter(FLOW_CONTROL_UNDER_RUNS) - under, where).toBe(
                            'under-run' === expected ? 1 : 0,
                        );
                        if ('accepted' === expected) {
                            hwm = Math.max(hwm, offset + payload);
                        }
                        expect(rig.hwmPosition.get(), where).toBe(hwm);
                        cases++;
                    }
                }
            }

            expect(cases).toBe(19 * 4 * 3);
            expect(rig.errors).toEqual([]);
            // the image is whole: a frame where it belongs is taken, and the subscriber gets what is stored
            rig.deliver(rig.frame({ termId: 12345, termOffset: 64, payload: pattern(32, 4) }));
            expect(rig.hwmPosition.get()).toBe(Math.max(hwm, 128));
        },
    );

    it('a frame many terms ahead of the join position is not stored, and the terms of the log are untouched', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);

        rig.deliver(rig.frame({ termId: (rig.initialTermId + 3) | 0, termOffset: 0, payload: pattern(32) }));
        rig.deliver(rig.frame({ termId: (rig.initialTermId - 1) | 0, termOffset: 0, payload: pattern(32) }));

        for (const termBuffer of rig.rawLog.termBuffers()) {
            for (let offset = 0; offset < 128; offset += 4) {
                expect(termBuffer.getInt(offset)).toBe(0);
            }
        }
        expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(1);
        expect(rig.counter(FLOW_CONTROL_UNDER_RUNS)).toBe(1);
    });
});

describe('ReceiverHostileFrameExtraTest', () => {
    /** A datagram of 64 bytes with a data header whose frame length, term offset and type are given. */
    function crafted(frameLength: number, termOffset: number, type = HeaderFlyweight.HDR_TYPE_DATA): Uint8Array {
        const bytes = new Uint8Array(64);
        const buffer = new UnsafeBuffer(bytes);
        const header = new DataHeaderFlyweight(buffer);
        header
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(type)
            .frameLength(frameLength);
        header.termOffset(termOffset).sessionId(rig.sessionId).streamId(rig.streamId).termId(rig.initialTermId);
        return bytes;
    }

    it('frame lengths and term offsets: a packet is invalid exactly when its offset is bad or its frame does not make the packet', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        const lengths = [0, 1, 31, 32, 33, 63, 64, 65, 96, 1_000, TERM, INT_MAX, -1, -2, INT_MIN];
        const offsets = [
            0,
            32,
            33,
            64,
            96,
            TERM / 2 - 64,
            TERM / 2 - 32,
            TERM / 2,
            TERM - 64,
            TERM - 32,
            TERM,
            TERM + 32,
            INT_MAX,
            -32,
            INT_MIN,
        ];
        let hwm = 0;
        let invalidTotal = 0;
        let overTotal = 0;
        for (const length of lengths) {
            for (const offset of offsets) {
                const where = `frame length ${length} at offset ${offset}`;
                const validOffset = 0 === offset % 32 && offset >= 0 && offset < TERM;
                const validFrame = length >= 33 && length <= 64 && offset + 64 <= TERM; // the one frame of 64 bytes that makes the packet and fits the term
                const isValid = validOffset && validFrame;
                const invalid = rig.counter(INVALID_PACKETS);
                const over = rig.counter(FLOW_CONTROL_OVER_RUNS);

                rig.deliver(crafted(length, offset));

                if (!isValid) {
                    expect(rig.counter(INVALID_PACKETS) - invalid, where).toBe(1);
                    invalidTotal++;
                } else if (offset + 64 > TERM / 2) {
                    expect(rig.counter(INVALID_PACKETS) - invalid, where).toBe(0);
                    expect(rig.counter(FLOW_CONTROL_OVER_RUNS) - over, where).toBe(1);
                    overTotal++;
                } else {
                    expect(rig.counter(INVALID_PACKETS) - invalid, where).toBe(0);
                    hwm = Math.max(hwm, offset + 64);
                }
                expect(rig.hwmPosition.get(), where).toBe(hwm);
            }
        }

        expect(rig.counter(INVALID_PACKETS)).toBe(invalidTotal);
        expect(rig.counter(FLOW_CONTROL_OVER_RUNS)).toBe(overTotal);
        expect(invalidTotal).toBeGreaterThan(150);
        expect(overTotal).toBeGreaterThan(0);
    });

    it('every prefix of a valid frame, and the frame followed by bytes that are not one: only the whole frame is stored', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        const frame = rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(32) });

        for (let length = 0; length <= 64; length++) {
            rig.deliver(frame.slice(0, length));
            expect(rig.hwmPosition.get(), 'prefix of ' + length).toBe(64 === length ? 64 : 0);
        }
        // a frame with bytes after it that are not a frame (the zeros are a frame length of 0 and a heartbeat can
        // be only the header)
        const before = rig.counter(INVALID_PACKETS);
        for (let extra = 1; extra <= 40; extra++) {
            const padded = new Uint8Array(64 + extra);
            padded.set(rig.frame({ termId: rig.initialTermId, termOffset: 128, payload: pattern(32, 2) }), 0);
            rig.deliver(padded);
        }
        expect(rig.counter(INVALID_PACKETS)).toBeGreaterThan(before);
        expect(rig.hwmPosition.get()).toBe(64);
    });
});

/**
 * A random datagram: bytes, a mutated frame, a frame, a heartbeat, a padding frame or an end of stream. The frames
 * are in slots of 256 bytes of the term and are at most 224 bytes long, and the mutations leave the term id and the
 * term offset alone, so that no two frames overlap: a stream whose frames overlap has garbage frame lengths in its log,
 * which is the sender's to answer for (the loss detector reads them, as Java's does), and what is fuzzed here is the
 * network.
 */
function randomDatagram(random: () => number, r: ReceiverRig): Uint8Array {
    const kind = Math.floor(random() * 8);
    const randomTermId = (): number => (r.initialTermId + Math.floor(random() * 6) - 1) | 0;
    const randomSlot = (): number => Math.floor(random() * (TERM / 256)) * 256;
    const randomPayload = (): Uint8Array => pattern(Math.floor(random() * 190), Math.floor(random() * 100));
    switch (kind) {
        case 0: {
            const bytes = new Uint8Array(Math.floor(random() * 1500));
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = Math.floor(random() * 256);
            }
            return bytes;
        }
        case 1:
        case 2: {
            const bytes = r.frame({ termId: randomTermId(), termOffset: randomSlot(), payload: randomPayload() });
            const flips = 1 + Math.floor(random() * 4);
            for (let i = 0; i < flips; i++) {
                const index = Math.floor(random() * Math.min(bytes.length, 40));
                if (!((index >= 8 && index < 12) || (index >= 20 && index < 24))) {
                    bytes[index] = Math.floor(random() * 256);
                }
            }
            return bytes;
        }
        case 3:
        case 4:
            return r.frame({ termId: randomTermId(), termOffset: randomSlot(), payload: randomPayload() });
        case 5:
            return r.heartbeat(randomTermId(), randomSlot());
        case 6:
            return r.heartbeat(
                randomTermId(),
                randomSlot(),
                random() < 0.5
                    ? DataHeaderFlyweight.BEGIN_END_AND_EOS_FLAGS
                    : DataHeaderFlyweight.BEGIN_END_EOS_AND_REVOKED_FLAGS,
            );
        default:
            return r.padding(randomTermId(), randomSlot(), 32 + Math.floor(random() * 7) * 32);
    }
}

function fuzz(seed: number): { hwm: number; rebuild: number; counters: number[] } {
    rig = new ReceiverRig();
    rig.join();
    rig.cycle(1);
    const random = mulberry32(seed);
    let hwm = rig.hwmPosition.get();
    let rebuild = rig.rebuildPosition.get();
    for (let i = 0; i < 1500; i++) {
        rig.deliver(randomDatagram(random, rig));
        if (random() < 0.3) {
            rig.run(1, Math.floor(random() * 2_000_000));
        }
        if (random() < 0.2) {
            rig.read();
        }
        const nextHwm = rig.hwmPosition.get();
        const nextRebuild = rig.rebuildPosition.get();
        // the positions only move forward and stay ordered: join <= subscriber <= rebuild <= hwm
        expect(nextHwm).toBeGreaterThanOrEqual(hwm);
        expect(nextRebuild).toBeGreaterThanOrEqual(rebuild);
        expect(nextRebuild).toBeLessThanOrEqual(nextHwm);
        expect(rig.subscriberPosition.get()).toBeLessThanOrEqual(nextRebuild);
        hwm = nextHwm;
        rebuild = nextRebuild;
    }
    const counters = [
        INVALID_PACKETS,
        FLOW_CONTROL_OVER_RUNS,
        FLOW_CONTROL_UNDER_RUNS,
        SystemCounterDescriptor.HEARTBEATS_RECEIVED,
        SystemCounterDescriptor.BYTES_RECEIVED,
        SystemCounterDescriptor.NAK_MESSAGES_SENT,
        SystemCounterDescriptor.STATUS_MESSAGES_SENT,
    ].map((descriptor) => rig.counter(descriptor));
    const result = { hwm, rebuild, counters };
    expect(rig.errors).toEqual([]);
    rig.close();
    return result;
}

describe('ReceiverFuzzExtraTest', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
        'seed %d: random datagrams and mutated frames: nothing throws, the positions stay ordered, and the same seed gives the same outcome',
        (seed) => {
            const first = fuzz(seed);
            const second = fuzz(seed);

            expect(second).toEqual(first);
            expect(first.counters[0]).toBeGreaterThan(0); // some of it was not a packet
        },
    );
});

interface SourceFrame {
    readonly start: number;
    readonly end: number;
    readonly bytes: Uint8Array;
    readonly isPadding: boolean;
}

/**
 * A lossy network between a model of the source and the receiver: the source sends frames within the window of the
 * last status message that it saw, the network drops, duplicates and reorders, the source answers NAKs and sends a
 * heartbeat while it waits. The subscriber must read what was produced, once, in order.
 */
function lossyStream(
    seed: number,
    termLength: number,
    initialTermId: number,
    messages: number,
    lossRate: number,
): number {
    rig = new ReceiverRig({ termLength, initialTermId, lossRetryDelayNs: 1_000_000 });
    rig.join();
    const random = mulberry32(seed);

    // what the source produces: the frames of each message, and the padding when the message does not fit in the term
    const frames: SourceFrame[] = [];
    let position = 0;
    for (let m = 0; m < messages; m++) {
        const message = pattern(Math.floor(random() * random() * 3000), m + seed);
        const left = termLength - (position & (termLength - 1));
        if (rig.frames(position, message).position - position > left) {
            const { termId, termOffset } = rig.at(position);
            frames.push({
                start: position,
                end: position + left,
                bytes: rig.padding(termId, termOffset, left),
                isPadding: true,
            });
            position += left;
        }
        const placed = rig.frames(position, message);
        let at = position;
        for (const datagram of placed.datagrams) {
            frames.push({ start: at, end: at + datagram.length, bytes: datagram, isPadding: false });
            at += datagram.length;
        }
        position = placed.position;
    }
    // the payload of each frame is what the subscriber reads: the frame length says how long it is
    const expectedPayloads = frames
        .filter((frame) => !frame.isPadding)
        .map((frame) => frame.bytes.slice(32, new UnsafeBuffer(frame.bytes).getInt(0, ByteOrder.LITTLE_ENDIAN)));

    const final = frames[frames.length - 1]?.end ?? 0;
    const received: Uint8Array[] = [];
    let nextNew = 0;
    let smPosition = 0;
    let smWindow = rig.windowLength;
    let nakIndex = 0;
    let smIndex = 0;
    let iterations = 0;

    const transmit = (queue: Uint8Array[], bytes: Uint8Array): void => {
        if (random() >= lossRate) {
            queue.push(bytes);
            if (random() < 0.1) {
                queue.push(bytes); // duplicated
            }
        }
    };

    while ((received.length < expectedPayloads.length || rig.rebuildPosition.get() < final) && iterations < 30_000) {
        iterations++;
        const queue: Uint8Array[] = [];

        // the source reads the last status message that reaches it
        const sms = rig.statusMessages();
        for (; smIndex < sms.length; smIndex++) {
            if (random() >= lossRate / 2) {
                const sm = sms[smIndex] as (typeof sms)[number];
                smPosition = rig.positionOf(sm.consumptionTermId(), sm.consumptionTermOffset());
                smWindow = sm.receiverWindowLength();
            }
        }

        // new frames, as far as the window lets it, in small bursts
        for (let burst = 0; burst < 6 && nextNew < frames.length; burst++) {
            const frame = frames[nextNew] as SourceFrame;
            if (frame.end > smPosition + smWindow) {
                break;
            }
            transmit(queue, frame.bytes);
            nextNew++;
        }

        // the answers to the NAKs that reach it
        const naks = rig.naks();
        for (; nakIndex < naks.length; nakIndex++) {
            if (random() >= lossRate / 2) {
                const nak = naks[nakIndex] as (typeof naks)[number];
                const from = rig.positionOf(nak.termId(), nak.termOffset());
                const to = from + nak.length();
                for (const frame of frames) {
                    if (frame.end > from && frame.start < to && frame.end <= smPosition + smWindow) {
                        transmit(queue, frame.bytes);
                    }
                }
            }
        }

        // while it waits it says where it is
        if (0 === iterations % 7 || nextNew >= frames.length) {
            const sent = nextNew > 0 ? (frames[nextNew - 1] as SourceFrame).end : 0;
            const { termId, termOffset } = rig.at(sent);
            transmit(queue, rig.heartbeat(termId, termOffset));
        }

        // reordering
        for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            const swap = queue[i] as Uint8Array;
            queue[i] = queue[j] as Uint8Array;
            queue[j] = swap;
        }
        for (const datagram of queue) {
            rig.deliver(datagram);
        }

        rig.run(1, 100_000);
        received.push(...rig.read());
    }

    expect(iterations).toBeLessThan(30_000);
    expect(received.length).toBe(expectedPayloads.length);
    expect(received).toEqual(expectedPayloads);
    expect(rig.hwmPosition.get()).toBe(final);
    expect(rig.rebuildPosition.get()).toBe(final);
    expect(rig.subscriberPosition.get()).toBe(final);
    expect(rig.counter(INVALID_PACKETS)).toBe(0);
    const naksSent = rig.naks().length;
    expect(rig.errors).toEqual([]);
    rig.close();

    return naksSent;
}

describe('ReceiverLossyNetworkExtraTest', () => {
    it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
        'seed %d: produced = consumed through loss, duplicates and reordering, with the NAKs answered',
        (seed) => {
            const naks = lossyStream(seed, TERM, [1000, INT_MAX - 1, INT_MIN, -2][seed % 4] as number, 160, 0.15);

            expect(naks).toBeGreaterThan(0); // the network lost something, and the receiver asked for it
        },
    );

    it.each([21, 22, 23, 24])('seed %d: heavy loss (40%) with large terms in the log', (seed) => {
        lossyStream(seed, 256 * 1024, 7, 100, 0.4);
    });

    it('no loss: no NAK at all, and the same bytes', () => {
        expect(lossyStream(99, TERM, 5, 120, 0)).toBe(0);
    });
});
