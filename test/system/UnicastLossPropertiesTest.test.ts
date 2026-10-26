// System test of T22 (port-only, spec D22, D63, D100): the way a driver is told to lose frames, with the system properties of
// Aeron (`aeron.SendChannelEndpoint.supplier`, `aeron.debug.send.data.loss.rate`, and the others), on real UDP on the
// loopback, with seeded random loss. The properties are read once when the module of the debug endpoints loads, so they are
// set before this file's imports run; this file does nothing else, so no other test sees them.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
    const { System } = await import('../../src/agrona/jdkLang.js');
    System.setProperty('aeron.SendChannelEndpoint.supplier', 'io.aeron.driver.ext.DebugSendChannelEndpointSupplier');
    System.setProperty(
        'aeron.ReceiveChannelEndpoint.supplier',
        'io.aeron.driver.ext.DebugReceiveChannelEndpointSupplier',
    );
    System.setProperty('aeron.debug.send.data.loss.rate', '0.1');
    System.setProperty('aeron.debug.send.data.loss.seed', '4711');
    System.setProperty('aeron.debug.receive.data.loss.rate', '0.1');
    System.setProperty('aeron.debug.receive.data.loss.seed', '4712');
    System.setProperty('aeron.debug.send.control.loss.rate', '0.1');
    System.setProperty('aeron.debug.send.control.loss.seed', '4713');
    System.setProperty('aeron.debug.receive.control.loss.rate', '0.1');
    System.setProperty('aeron.debug.receive.control.loss.seed', '4714');
});

import { DebugReceiveChannelEndpointSupplier } from '../../src/driver/ext/DebugReceiveChannelEndpointSupplier.js';
import { DebugSendChannelEndpointSupplier } from '../../src/driver/ext/DebugSendChannelEndpointSupplier.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import type { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { Consumed, SystemNode, driveUntil, plan, sequences, transfer } from '../support/SystemRig.js';
import { freeUdpPort } from '../support/Udp.js';

describe('Unicast loss by system properties', () => {
    const nodes: SystemNode[] = [];

    afterEach(() => {
        for (const node of nodes.splice(0)) {
            node.close();
        }
    });

    it('theDriversLoseFramesAsThePropertiesSayAndTheStreamIsComplete', async () => {
        const publisher = new SystemNode();
        const subscriber = new SystemNode();
        nodes.push(publisher, subscriber);
        expect(publisher.driver.context().sendChannelEndpointSupplier()).toBeInstanceOf(
            DebugSendChannelEndpointSupplier,
        );
        expect(subscriber.driver.context().receiveChannelEndpointSupplier()).toBeInstanceOf(
            DebugReceiveChannelEndpointSupplier,
        );

        const port = freeUdpPort();
        const subscription = subscriber.aeron.addSubscription('aeron:udp?endpoint=127.0.0.1:' + port, 1001);
        const publication = publisher.aeron.addPublication(
            'aeron:udp?endpoint=127.0.0.1:' + port + '|term-length=65536',
            1001,
        ) as ConcurrentPublication;
        await driveUntil(
            () => publication.isConnected() && subscription.imageCount() === 1,
            'connected stream',
            60_000,
        );

        const consumed = new Consumed();
        await transfer(
            publication,
            subscription,
            plan(0, 1500, (s) => 4 + ((s * 97) % 1500)),
            consumed,
            1600,
            'all',
            60_000,
        );

        expect(consumed.problems).toEqual([]);
        expect(consumed.sequences).toEqual(sequences(0, 1500));
        const counters = (node: SystemNode, descriptor: SystemCounterDescriptor): number =>
            (node.driver.context().systemCounters() as SystemCounters).get(descriptor).get();
        // frames were lost, and asked for again
        expect(counters(publisher, SystemCounterDescriptor.RETRANSMITS_SENT)).toBeGreaterThan(0);
        expect(counters(subscriber, SystemCounterDescriptor.NAK_MESSAGES_SENT)).toBeGreaterThan(0);
        expect(publisher.errors.map(String)).toEqual([]);
        expect(subscriber.errors.map(String)).toEqual([]);
    });
});
