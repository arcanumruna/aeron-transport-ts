// What BroadcastCrossWorkerExtraTest and its worker script (Broadcast.worker.ts) share. Plain numbers and functions only,
// so that a worker can import it.
//
// Message `s` of the one transmitter has type id `s + 1`, a seeded random length in [0, maxMsgLength] and payload bytes
// that are a pure function of (seed, s). A receiver recomputes what the record with type `t` must hold and so tells a
// torn record from an intact one, and sees that the sequence only goes up.
//
// Every payload byte is in 0x80..0xFE and the buffer starts filled with 0xA5, so every 32-bit word of a payload, of its
// padding bytes and of an unused part of the buffer is a negative int other than -1. Why: BroadcastReceiver.receiveNext
// reads the length of a record after it has validated its position (as Java does), so a receiver that is lapped in
// between reads whatever is at that offset as a length. A header word is a record length (small and positive) and a
// payload word could be anything, among them a small positive length that makes the next position look like a record
// start in the middle of another record (and a word of -1 reads as a padding type id). With negative payload words the
// position computed from a garbage length is behind the receiver, where validate() is false, so the receiver reports a
// lap and goes on; the tests then check that what a receiver accepts is intact.
//
// The lengths are multiples of 4 for the same reason: a payload that ends inside an 8-aligned word leaves the other
// bytes of the word as they were, and they could be those of an old header.
import { mix } from '../ringbuffer/RingBufferLayout.js';

/** The seeded random length of message `sequence`: a multiple of 4 in [0, maxMsgLength]. */
export function lengthOfMessage(seed: number, sequence: number, maxMsgLength: number): number {
    return (mix(seed, 0, sequence) % ((maxMsgLength >> 2) + 1)) << 2;
}

/** The byte that the buffer is filled with before the run (a negative word that is not -1). */
export const FILL_BYTE = 0xa5;

/** Byte `i` of the payload of message `sequence`: in 0x80..0xFE. */
export function payloadByte(seed: number, sequence: number, i: number): number {
    return 0x80 + (((mix(seed, sequence, i >> 2) >>> ((i & 3) << 3)) & 0xff) % 127);
}

/** Writes the `length` bytes of message `sequence` at `offset` of `dst`. */
export function fillPayload(dst: Uint8Array, offset: number, seed: number, sequence: number, length: number): void {
    for (let i = 0; i < length; i++) {
        dst[offset + i] = payloadByte(seed, sequence, i);
    }
}

/** `null` when the `length` bytes at `offset` of `src` are message `sequence`, else what differs. */
export function checkPayload(
    src: Uint8Array,
    offset: number,
    seed: number,
    sequence: number,
    length: number,
): string | null {
    for (let i = 0; i < length; i++) {
        const expected = payloadByte(seed, sequence, i);
        if (src[offset + i] !== expected) {
            return 'byte ' + i + ' of message ' + sequence + ' is ' + src[offset + i] + ', expected ' + expected;
        }
    }
    return null;
}

/** Size of the broadcast buffer (without the trailer): small, so that the receivers are lapped. */
export const BROADCAST_CAPACITY = 1024;

/** Indices of the Int32Array over the shared control block. */
export const CONTROL_STARTED = 0;
export const CONTROL_BACKOFF = 1;
/** Set to 1 by the transmitter after its last message. */
export const CONTROL_DONE = 2;
/** The messages the transmitter has sent, updated every 64 messages. */
export const CONTROL_PROGRESS = 3;

export type ReceiverStyle = 'fast' | 'stall-until-done' | 'copy-stalling';

export interface BroadcastWorkerData {
    kind: 'transmitter' | 'receiver';
    style: ReceiverStyle;
    buffer: SharedArrayBuffer;
    control: SharedArrayBuffer;
    /** The workers that wait for each other at the start. */
    workers: number;
    seed: number;
    messages: number;
}

export interface TransmitterResult {
    sent: number;
}

export interface ReceiverResult {
    /** The records that passed `validate()` and were checked. */
    accepted: number;
    /** `BroadcastReceiver.lappedCount()` at the end. */
    lapped: number;
    /** The records dropped because `validate()` was false after the copy (or the copy receiver threw). */
    discarded: number;
    /** The sequence of the last record accepted, -1 if none. */
    lastSequence: number;
    /** The first thing wrong with a record that was accepted, or null. */
    error: string | null;
}
