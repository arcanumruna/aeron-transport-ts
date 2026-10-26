// Extra test of issue #52 (port-only, spec 5.3): the whole path of a message through the code of `src/`, from
// `Publication.offer` through the client, the sender, the receiver and the image to `Subscription.poll`, on two real
// `MediaDriver`s and two real `Aeron` clients that talk through `LoopbackDgram` instead of `dgram`, so that what node
// allocates for each datagram (its Buffer, its send request) is not in the figures. The clock is manual, below 2^30 for
// the whole run, as in the other allocation tests: V8 boxes a number above 2^31 in a heap number whenever a call that it
// does not inline takes it, and each duty cycle passes its `nowNs` to such calls (spec D112), a cost of the cycle and not
// of a message, which this test is not about.
//
// The figure is bytes per duty cycle step (both nodes' driver and client conductor) from `heapUsed` (`HeapBytes`), which
// resolves a few bytes where a count of collections needs millions of iterations. A step moves one datagram: 14 messages of
// 64 bytes, or 1 of 1,376. The budget is small against a per message allocation (a 24 byte object for each of 14 messages
// is 336 bytes a step) and large against the allocation that the optimizing compiler's state adds or takes (0 to 16 bytes
// a step, depending on what ran before: issue #43).
import { afterEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ConcurrentPublication } from '../../../src/client/ConcurrentPublication.js';
import type { FragmentHandler } from '../../../src/client/logbuffer/FragmentHandler.js';
import type { Subscription } from '../../../src/client/Subscription.js';
import { ManualClock } from '../../support/EmbeddedRig.js';
import { medianBytesPerUnit } from '../../support/HeapBytes.js';
import { installLoopbackDgram } from '../../support/LoopbackDgram.js';
import type { LoopbackNetwork } from '../../support/LoopbackDgram.js';
import { SimNode } from '../../support/SimWorld.js';

/** The time of one step on the clock. */
const STEP_NS = 1000;
/** The start of the clock. */
const START_NS = 10_000_000;
/** What a step that moves a datagram may allocate: the 16 bytes of one heap number that the compiler's state may add, three times. */
const MAX_BYTES_PER_STEP = 48;
const MAX_STEPS = 10_000_000;

let restore: () => void = () => {};
let nodes: SimNode[] = [];

afterEach(() => {
    for (const node of nodes) {
        node.close();
    }
    nodes = [];
    restore();
});

interface Stream {
    readonly network: LoopbackNetwork;
    readonly publication: ConcurrentPublication;
    readonly subscription: Subscription;
    readonly step: () => void;
    readonly errors: () => Error[];
}

function connect(): Stream {
    const loopback = installLoopbackDgram();
    restore = loopback.restore;
    const network = loopback.network;
    const clock = new ManualClock();
    clock.ns = START_NS;
    const publisher = new SimNode(clock, () => {});
    const subscriber = new SimNode(clock, () => {});
    nodes = [publisher, subscriber];
    const step = (): void => {
        clock.ns += STEP_NS;
        network.deliverDue();
        publisher.cycle();
        subscriber.cycle();
    };
    const subscriptionId = subscriber.aeron.asyncAddSubscription('aeron:udp?endpoint=127.0.0.1:40500', 1001);
    const publicationId = publisher.aeron.asyncAddPublication(
        'aeron:udp?endpoint=127.0.0.1:40500|term-length=1048576',
        1001,
    );
    for (let i = 0; i < 100_000; i++) {
        const publication = publisher.aeron.getPublication(publicationId);
        const subscription = subscriber.aeron.getSubscription(subscriptionId);
        if (
            null !== publication &&
            null !== subscription &&
            publication.isConnected() &&
            subscription.imageCount() > 0
        ) {
            return {
                network,
                publication: publication as ConcurrentPublication,
                subscription: subscription as Subscription,
                step,
                errors: () => [...publisher.errors, ...subscriber.errors],
            };
        }
        step();
    }
    throw new Error('the stream did not connect');
}

describe('EndToEndAllocationTest', () => {
    for (const length of [64, 1376]) {
        it(
            'a step that moves ' + length + ' byte messages from offer to poll allocates a few bytes at most',
            () => {
                const { network, publication, subscription, step, errors } = connect();
                let received = 0;
                const handler: FragmentHandler = {
                    onFragment: (_buffer, _offset, fragmentLength): void => {
                        received += fragmentLength > 0 ? 1 : 0;
                    },
                };
                const message = new UnsafeBuffer(new Uint8Array(length));

                const idle = (steps: number): number => {
                    for (let i = 0; i < steps; i++) {
                        step();
                    }
                    return steps;
                };
                const stream = (messages: number): number => {
                    const target = received + messages;
                    let sent = 0;
                    let steps = 0;
                    while (received < target) {
                        if (++steps > MAX_STEPS) {
                            throw new Error('stuck: received ' + received + ' of ' + target);
                        }
                        while (sent < messages && publication.offer(message, 0, length) > 0) {
                            sent++;
                        }
                        step();
                        subscription.poll(handler, 64);
                    }
                    return steps;
                };

                const idleBytes = medianBytesPerUnit(idle, 2000, 41, 60);
                const before = received;
                const streamBytes = medianBytesPerUnit(stream, 4000, 41, 100);

                expect(received - before).toBeGreaterThan(41 * 4000);
                expect(network.dropped).toBe(0);
                expect(errors()).toEqual([]);
                expect(
                    streamBytes,
                    'bytes per step: idle ' + idleBytes.toFixed(1) + ', moving messages ' + streamBytes.toFixed(1),
                ).toBeLessThanOrEqual(MAX_BYTES_PER_STEP);
                expect(idleBytes, 'bytes per idle step').toBeLessThanOrEqual(MAX_BYTES_PER_STEP);
            },
            120_000,
        );
    }
});
