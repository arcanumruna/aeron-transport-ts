// What RingBufferCrossWorkerExtraTest and its worker script (RingBuffer.worker.ts) share: the messages the producers
// write and the consumer checks. Plain numbers and functions only, so that a worker can import it.
//
// A message is a pure function of (seed, producer, sequence): its length (seeded random in [0, maxMsgLength]), its bytes
// and whether the producer aborts it (one claim in 16, in the claim variants). So the consumer recomputes what it should
// get next from each producer: exactly once, in the producer's order, with its bytes intact. A message of 12 bytes or
// more starts with the producer id, the sequence and a checksum over the rest, which is seeded pseudo random bytes.

/** Size of the ring (without the trailer) of the stress tests: small, so that it wraps and fills up all the time. */
export const RING_CAPACITY = 1024;

export const HEADER = 12;

/** A 32-bit mix of (seed, producer, sequence). */
export function mix(seed: number, producer: number, sequence: number): number {
    let h =
        Math.imul(seed ^ 0x9e3779b1, 0x85ebca6b) ^
        Math.imul(producer + 1, 0xc2b2ae35) ^
        Math.imul(sequence + 1, 0x27d4eb2f);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return h >>> 0;
}

/** The seeded random length of message `sequence` of `producer`, in [0, maxMsgLength]. */
export function lengthOf(seed: number, producer: number, sequence: number, maxMsgLength: number): number {
    return mix(seed, producer, sequence) % (maxMsgLength + 1);
}

/** Whether the producer aborts its claim of message `sequence`: one in 16. */
export function isAborted(seed: number, producer: number, sequence: number): boolean {
    return 0 === (mix(seed ^ 0x5bd1e995, producer, sequence) & 15);
}

/** How many of the `count` messages of `producer` are aborted (and so never delivered) in a claim variant. */
export function abortedCount(seed: number, producer: number, count: number): number {
    let aborted = 0;
    for (let s = 0; s < count; s++) {
        if (isAborted(seed, producer, s)) {
            aborted++;
        }
    }
    return aborted;
}

function writeInt(dst: Uint8Array, offset: number, value: number): void {
    dst[offset] = value & 0xff;
    dst[offset + 1] = (value >>> 8) & 0xff;
    dst[offset + 2] = (value >>> 16) & 0xff;
    dst[offset + 3] = (value >>> 24) & 0xff;
}

function readInt(src: Uint8Array, offset: number): number {
    return (
        (src[offset] as number) |
        ((src[offset + 1] as number) << 8) |
        ((src[offset + 2] as number) << 16) |
        ((src[offset + 3] as number) << 24) |
        0
    );
}

/** Writes the `length` bytes of message (producer, sequence) at `offset` of `dst`. */
export function fillMessage(
    dst: Uint8Array,
    offset: number,
    seed: number,
    producer: number,
    sequence: number,
    length: number,
): void {
    let x = mix(seed, producer, sequence);
    const start = length >= HEADER ? offset + HEADER : offset;
    let checksum = 0;
    for (let i = start; i < offset + length; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) | 0;
        const byte = x >>> 24;
        dst[i] = byte;
        checksum = (Math.imul(checksum, 31) + byte) | 0;
    }
    if (length >= HEADER) {
        writeInt(dst, offset, producer);
        writeInt(dst, offset + 4, sequence);
        writeInt(dst, offset + 8, checksum);
    }
}

/** `null` when the `length` bytes at `offset` of `src` are message (producer, sequence), else what differs. */
export function checkMessage(
    src: Uint8Array,
    offset: number,
    seed: number,
    producer: number,
    sequence: number,
    length: number,
): string | null {
    let x = mix(seed, producer, sequence);
    const start = length >= HEADER ? offset + HEADER : offset;
    let checksum = 0;
    for (let i = start; i < offset + length; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) | 0;
        const byte = x >>> 24;
        if (src[i] !== byte) {
            return (
                'byte ' +
                (i - offset) +
                ' of producer ' +
                producer +
                ' message ' +
                sequence +
                ' is ' +
                src[i] +
                ', expected ' +
                byte
            );
        }
        checksum = (Math.imul(checksum, 31) + byte) | 0;
    }
    if (length >= HEADER) {
        if (readInt(src, offset) !== producer || readInt(src, offset + 4) !== sequence) {
            return (
                'header of producer ' +
                producer +
                ' message ' +
                sequence +
                ' reads ' +
                readInt(src, offset) +
                '/' +
                readInt(src, offset + 4)
            );
        }
        if (readInt(src, offset + 8) !== checksum) {
            return 'checksum of producer ' + producer + ' message ' + sequence + ' differs';
        }
    }
    return null;
}

/** The kinds of worker of RingBuffer.worker.ts and what it is given. */
export interface RingBufferWorkerData {
    kind: 'producer' | 'consumer' | 'claim-and-exit' | 'correlation' | 'heartbeat-writer';
    ring: 'many-to-one' | 'one-to-one';
    /** The ring buffer (capacity + trailer) shared by the workers. */
    buffer: SharedArrayBuffer;
    /** Four ints: the start barrier (0). */
    control: SharedArrayBuffer;
    /** Producers and the consumer, for the barrier. */
    workers: number;
    seed: number;
    /** `producer`: its id. */
    id: number;
    producers: number;
    perProducer: number;
    /** Producers use `tryClaim` / `commit` / `abort` (one claim in 16 aborted) instead of `write`. */
    claim: boolean;
    iterations: number;
}

export interface ProducerResult {
    /** Writes or claims that found the ring full and were retried. */
    retries: number;
}

export interface ConsumerResult {
    delivered: number;
    error: string | null;
}

/** The control words of the heartbeat test, in the data area of the ring (there are no messages in that test). */
export const HEARTBEAT_PROGRESS = 0;
export const HEARTBEAT_DONE = 4;
