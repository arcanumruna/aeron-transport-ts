// Support of the TS <-> TS system tests (T22, spec 8.2, D100): nodes that are a `MediaDriver` and an `Aeron` client of one
// process, on the default configuration (the driver runs itself on the event loop, the client's conductor runs in its
// duty cycle), a message whose bytes are derived from its sequence number, a consumer that checks what it reads, and
// the waits that drive the test: each turn gives the event loop (the runner, the datagrams) a turn, with a hard cap
// in turns and in time that fails the test instead of hanging it.
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import { Aeron } from '../../src/client/Aeron.js';
import { FragmentAssembler } from '../../src/client/FragmentAssembler.js';
import type { Header } from '../../src/client/logbuffer/Header.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';

/** The most turns of the event loop a wait takes before it gives up. */
export const MAX_TURNS = 5_000_000;

/** The longest a wait takes before it gives up, in ms: real UDP needs real time, and a bounded wait. */
export const WAIT_CAP_MS = 20_000;

/** A `MediaDriver` and an `Aeron` client connected to it, as an application of one process makes them. */
export class SystemNode {
    public readonly errors: Error[] = [];
    public readonly driver: MediaDriver;
    public readonly aeron: Aeron;

    /**
     * @param configure to set the options of the driver; the default configuration if omitted.
     */
    public constructor(configure: (ctx: MediaDriver.Context) => void = () => {}) {
        const driverContext = new MediaDriver.Context().errorHandler({ onError: (e) => void this.errors.push(e) });
        configure(driverContext);
        this.driver = MediaDriver.launch(driverContext);
        this.aeron = Aeron.connect(
            new Aeron.Context().mediaDriver(this.driver).errorHandler({ onError: (e) => void this.errors.push(e) }),
        );
    }

    public close(): void {
        this.aeron.close();
        this.driver.close();
    }
}

/** Turns of the event loop until the condition holds; fails at the cap of turns or of time. */
export async function driveUntil(
    condition: () => boolean,
    what: string,
    capMs = WAIT_CAP_MS,
    maxTurns = MAX_TURNS,
): Promise<void> {
    const deadline = performance.now() + capMs;
    for (let turn = 0; turn < maxTurns; turn++) {
        if (condition()) {
            return;
        }

        if (performance.now() > deadline) {
            throw new Error('no ' + what + ' after ' + capMs + ' ms (' + turn + ' turns)');
        }

        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    throw new Error('no ' + what + ' after ' + maxTurns + ' turns');
}

const SEQUENCE_LENGTH = 4;

/**
 * The bytes of message `sequence`: the sequence number as 4 little endian bytes, then a pattern of it, so that a byte
 * that is wrong, missing or from another message is found. A 1..3 byte message holds the low bytes of the sequence only.
 */
export function fillMessage(buffer: UnsafeBuffer, sequence: number, length: number): void {
    for (let i = 0; i < length; i++) {
        buffer.putByte(i, i < SEQUENCE_LENGTH ? (sequence >>> (8 * i)) & 0xff : (sequence * 31 + i * 7) & 0xff);
    }
}

/** The sequence number of a message read from a buffer, or an Error that tells what is wrong with the message. */
export function checkMessage(buffer: DirectBuffer, offset: number, length: number): number | Error {
    let sequence = 0;
    for (let i = 0; i < Math.min(length, SEQUENCE_LENGTH); i++) {
        sequence |= (buffer.getByte(offset + i) & 0xff) << (8 * i);
    }

    for (let i = SEQUENCE_LENGTH; i < length; i++) {
        const expected = (sequence * 31 + i * 7) & 0xff;
        const actual = buffer.getByte(offset + i) & 0xff;
        if (actual !== expected) {
            return new Error(
                'message ' + sequence + ' of ' + length + ' bytes: byte ' + i + ' is ' + actual + ', not ' + expected,
            );
        }
    }

    return sequence;
}

/** What a consumer read: the sequence number and the length of each whole message, in the order it read them. */
export class Consumed {
    public readonly sequences: number[] = [];
    public readonly lengths: number[] = [];
    public readonly sessionIds: number[] = [];
    public readonly problems: Error[] = [];
    public readonly assembler: FragmentAssembler;

    /**
     * @param modulo when it is not 0, the sequence numbers are taken modulo it: for the messages of 1 byte.
     */
    private readonly modulo;
    public constructor(modulo = 0) {
        this.modulo = modulo;
        this.assembler = new FragmentAssembler({
            onFragment: (buffer: DirectBuffer, offset: number, length: number, header: Header): void => {
                const result = checkMessage(buffer, offset, length);
                if (result instanceof Error) {
                    this.problems.push(result);
                } else {
                    this.sequences.push(this.modulo > 0 ? result % this.modulo : result);
                    this.lengths.push(length);
                    this.sessionIds.push(header.sessionId());
                }
            },
        });
    }

    public poll(subscription: Subscription, fragmentLimit = 16): number {
        return subscription.poll(this.assembler, fragmentLimit);
    }
}

/** What the producer is to send: `count` messages from sequence `first`, of the lengths `lengthOf(sequence)`. */
export interface Plan {
    readonly first: number;
    readonly count: number;
    lengthOf(sequence: number): number;
}

export function plan(first: number, count: number, lengthOf: (sequence: number) => number): Plan {
    return { first, count, lengthOf };
}

/** What a producer needs of a publication: both kinds have it. */
export interface Offering {
    offer(buffer: DirectBuffer, offset: number, length: number): number;
}

/** The offers of a plan, one message at a time, as far as the publication takes them. */
export class Producer {
    private next: number;
    private readonly buffer: UnsafeBuffer;
    public backPressured = 0;
    public notConnected = 0;
    public adminActions = 0;

    private readonly publication: Offering;
    private readonly work: Plan;
    public constructor(publication: Offering, work: Plan, maxLength: number) {
        this.publication = publication;
        this.work = work;
        this.next = work.first;
        this.buffer = new UnsafeBuffer(new Uint8Array(maxLength));
    }

    public isDone(): boolean {
        return this.next >= this.work.first + this.work.count;
    }

    public sent(): number {
        return this.next - this.work.first;
    }

    /** Offer messages until the publication does not take one. Throws for a result that ends the stream. */
    public offerSome(maxMessages = 64): void {
        for (let i = 0; i < maxMessages && !this.isDone(); i++) {
            const length = this.work.lengthOf(this.next);
            fillMessage(this.buffer, this.next, length);
            const result = this.publication.offer(this.buffer, 0, length);
            if (result > 0) {
                this.next++;
            } else if (Publication.BACK_PRESSURED === result) {
                this.backPressured++;
                return;
            } else if (Publication.NOT_CONNECTED === result) {
                this.notConnected++;
                return;
            } else if (Publication.ADMIN_ACTION === result) {
                this.adminActions++;
            } else {
                throw new Error('offer of message ' + this.next + ' (' + length + ' bytes) answered ' + result);
            }
        }
    }
}

/** Produce the plan and consume it, until the consumer has read all of it: what was produced equals what was consumed. */
export async function transfer(
    publication: Offering,
    subscription: Subscription,
    work: Plan,
    consumed: Consumed,
    maxLength: number,
    what: string,
    capMs = WAIT_CAP_MS,
): Promise<Producer> {
    const producer = new Producer(publication, work, maxLength);
    await driveUntil(
        () => {
            producer.offerSome();
            consumed.poll(subscription);
            return consumed.sequences.length >= work.count;
        },
        what + ' (sent ' + producer.sent() + ' of ' + work.count + ')',
        capMs,
    );
    return producer;
}

/** The sequence numbers `first` .. `first + count - 1`. */
export function sequences(first: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => first + i);
}

/** The lengths that a plan gives its messages. */
export function lengths(work: Plan): number[] {
    return Array.from({ length: work.count }, (_, i) => work.lengthOf(work.first + i));
}
