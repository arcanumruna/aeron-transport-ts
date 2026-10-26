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
// Extra tests of T16 (port-only): the `Receiver` agent on the receiver rig of `test/support/ReceiverRig.ts`: its work
// count, the duty cycle tracker and the start, the commands of the conductor (the subscriptions with and without a
// session, the control address of a multi-destination-cast subscription, the setup frames that are awaited, a channel
// that is closed, a control address that is resolved again) and the images it holds.
import { afterEach, describe, expect, it } from 'vitest';
import { System } from '../../../src/agrona/jdkLang.js';
import { CommonContext } from '../../../src/client/CommonContext.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { Receiver } from '../../../src/driver/Receiver.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const { SEND_SETUP_FLAG } = StatusMessageFlyweight;
const { RESOLUTION_CHANGES, BYTES_RECEIVED, RECEIVER_MAX_CYCLE_TIME, RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED } =
    SystemCounterDescriptor;
const MDC = 'aeron:udp?endpoint=127.0.0.1:0|control=127.0.0.1:41999|control-mode=dynamic';

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

let rig: ReceiverRig;

function lastSm(): StatusMessageFlyweight {
    return rig.statusMessages().at(-1) as StatusMessageFlyweight;
}

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('ReceiverExtraTest', () => {
    it('the work count: 0 when idle, 1 for a command, the bytes of a datagram, 1 for a status message that is sent', () => {
        rig = new ReceiverRig();
        rig.join();
        expect(rig.cycle(1)).toBe(1); // the first status message of the image
        expect(rig.cycle()).toBe(0);
        expect(rig.cycle(10)).toBe(0);

        rig.receiverProxy.requestSetup(rig.endpoint, rig.streamId, rig.sessionId);
        expect(rig.cycle()).toBe(1);

        const bytes = rig.counter(BYTES_RECEIVED);
        expect(rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(32) }))).toBe(64);
        expect(rig.counter(BYTES_RECEIVED)).toBe(bytes + 64);

        expect(rig.cycle(Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS + 1)).toBe(1);
    });

    it('the role name, the start (the clocks and the tracker) and the duty cycle tracker of the receiver', () => {
        rig = new ReceiverRig();
        expect(rig.receiver.roleName()).toBe('receiver'); // the classic names are the default
        System.setProperty(CommonContext.THREAD_NAMING_PROP_NAME, CommonContext.THREAD_NAMING_NEW);
        try {
            expect(new Receiver(rig.context).roleName()).toBe('aeron-md-rcv');
        } finally {
            System.clearProperty(CommonContext.THREAD_NAMING_PROP_NAME);
        }
        rig.clock.update(1_000_000);
        rig.receiver.onStart();
        expect(rig.clock.nanoTime()).toBe(1_000_000);

        // a cycle is measured from the one before it: the longest, and the ones over the threshold, are counted
        const threshold = rig.context.receiverCycleThresholdNs();
        expect(rig.counter(RECEIVER_MAX_CYCLE_TIME)).toBe(0);
        rig.cycle(threshold + 5);
        expect(rig.counter(RECEIVER_MAX_CYCLE_TIME)).toBe(threshold + 5);
        expect(rig.counter(RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED)).toBe(1);
        rig.cycle(threshold - 1);
        expect(rig.counter(RECEIVER_MAX_CYCLE_TIME)).toBe(threshold + 5);
        expect(rig.counter(RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED)).toBe(1);
    });

    it('an explicit control address: registering the endpoint asks the control address for a setup frame, and again each wait while there is interest', () => {
        rig = new ReceiverRig({ uri: MDC });
        expect(rig.endpoint.hasExplicitControl()).toBe(true);

        rig.receiverProxy.registerReceiveChannelEndpoint(rig.endpoint);
        rig.cycle(1);

        expect(rig.statusMessages().length).toBe(1);
        const first = rig.statusMessages()[0] as StatusMessageFlyweight;
        expect(first.flags() & SEND_SETUP_FLAG).toBe(SEND_SETUP_FLAG);
        expect(first.sessionId()).toBe(0);
        expect(first.streamId()).toBe(0);
        expect(first.receiverWindowLength()).toBe(0);
        expect(rig.socket.destinations).toEqual([{ port: 41999, address: '127.0.0.1' }]);

        // no stream is subscribed to: nothing to elicit a setup frame for
        rig.cycle(Configuration.PENDING_SETUPS_TIMEOUT_NS + 1);
        expect(rig.statusMessages().length).toBe(1);

        // the wait was over while there was no interest, and its time was not renewed: the interest has the setup frame asked
        // for in the cycle after the subscription is added
        rig.receiverProxy.addSubscription(rig.endpoint, rig.streamId);
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(2);
        rig.cycle(Configuration.PENDING_SETUPS_TIMEOUT_NS);
        expect(rig.statusMessages().length).toBe(2);
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(3);
        expect(rig.socket.destinations.every((d) => 41999 === d.port && '127.0.0.1' === d.address)).toBe(true);
    });

    it('a subscription for a session on an explicit control channel elicits that session at once; a request for setup asks again', () => {
        rig = new ReceiverRig({ uri: MDC });
        rig.receiverProxy.registerReceiveChannelEndpoint(rig.endpoint);
        rig.cycle(1);
        const before = rig.statusMessages().length;

        rig.receiverProxy.addSubscription(rig.endpoint, rig.streamId, rig.sessionId);
        rig.processCommands();

        expect(rig.statusMessages().length).toBe(before + 1);
        expect(lastSm().sessionId()).toBe(rig.sessionId);
        expect(lastSm().streamId()).toBe(rig.streamId);
        expect(lastSm().flags() & SEND_SETUP_FLAG).toBe(SEND_SETUP_FLAG);

        rig.receiverProxy.requestSetup(rig.endpoint, rig.streamId, rig.sessionId);
        rig.processCommands();
        expect(rig.statusMessages().length).toBe(before + 2);
        expect(lastSm().sessionId()).toBe(rig.sessionId);

        // a channel without an explicit control address does not ask for a setup frame
        const plain = new ReceiverRig();
        try {
            plain.subscribe();
            plain.receiverProxy.requestSetup(plain.endpoint, plain.streamId, plain.sessionId);
            plain.receiverProxy.addSubscription(plain.endpoint, plain.streamId + 1, plain.sessionId);
            plain.processCommands(1);
            expect(plain.statusMessages().length).toBe(0);
        } finally {
            plain.close();
        }
    });

    it('removing the subscription of a session forgets the setup frame that was awaited: the next data elicits it again', () => {
        rig = new ReceiverRig();
        rig.receiverProxy.registerReceiveChannelEndpoint(rig.endpoint);
        rig.receiverProxy.addSubscription(rig.endpoint, rig.streamId, rig.sessionId);
        rig.processCommands(1);
        const frame = rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(32) });

        rig.deliver(frame);
        const elicited = (): number => rig.statusMessages().filter((sm) => 0 !== (sm.flags() & SEND_SETUP_FLAG)).length;
        expect(elicited()).toBe(1);
        rig.deliver(frame); // awaited: not asked for again
        expect(elicited()).toBe(1);

        rig.receiverProxy.removeSubscription(rig.endpoint, rig.streamId, rig.sessionId);
        rig.receiverProxy.addSubscription(rig.endpoint, rig.streamId, rig.sessionId);
        rig.processCommands();
        rig.deliver(frame);

        expect(elicited()).toBe(2);
        // and the timeout of the pending setup that was removed does not touch the new one
        rig.cycle(Configuration.PENDING_SETUPS_TIMEOUT_NS - 10);
        rig.deliver(frame);
        expect(elicited()).toBe(2);
    });

    it('closing the channel endpoint: its setups are forgotten, the poller lets go of it, the conductor is told', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(32) }));
        expect(rig.hwmPosition.get()).toBe(64);

        rig.receiverProxy.closeReceiveChannelEndpoint(rig.endpoint);
        rig.cycle();
        rig.runConductorCommands();

        expect(rig.closedEndpoints.length).toBe(1);
        expect(rig.closedEndpoints[0] === rig.endpoint).toBe(true);
        // not polled any more: a datagram that is in the ring stays there
        rig.enqueue(rig.frame({ termId: rig.initialTermId, termOffset: 64, payload: pattern(32, 2) }));
        rig.cycle();
        expect(rig.hwmPosition.get()).toBe(64);
    });

    it('a control address that is resolved again: the awaited setups take the new address, once for each, and are counted', () => {
        rig = new ReceiverRig({ uri: MDC });
        rig.receiverProxy.registerReceiveChannelEndpoint(rig.endpoint);
        rig.receiverProxy.addSubscription(rig.endpoint, rig.streamId);
        rig.processCommands(1);
        const changes = rig.counter(RESOLUTION_CHANGES);
        const moved = new InetSocketAddress('127.0.0.1', 42001);

        rig.receiverProxy.onResolutionChange(rig.endpoint, rig.udpChannel, moved);
        rig.processCommands();

        expect(rig.counter(RESOLUTION_CHANGES)).toBe(changes + 1);
        rig.cycle(Configuration.PENDING_SETUPS_TIMEOUT_NS + 1);
        expect(rig.socket.destinations.at(-1)).toEqual({ port: 42001, address: '127.0.0.1' });
        expect(rig.endpoint.explicitControlAddress()?.getPort()).toBe(42001);
    });

    it('an image that is rejected by an unknown id, or a position of a different image, changes nothing', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);

        rig.receiverProxy.rejectImage(ReceiverRig.REGISTRATION_ID + 99, 0, 'not this one');
        rig.cycle(Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS + 1);

        expect(rig.errorFrames().length).toBe(0);
        expect(rig.image.rejectionReason).toBe(null);
        expect(rig.statusMessages().length).toBe(2);
    });

    it("commands for a subscription that is not there: the dispatcher refuses and the error is the conductor's to see, not an exception out of a later cycle", () => {
        rig = new ReceiverRig();
        rig.subscribe();

        rig.receiverProxy.removeSubscription(rig.endpoint, rig.streamId + 1);

        expect(() => rig.receiver.doWork()).toThrow(/no subscription for stream/);
        // the command is gone: the next cycle is clean
        expect(rig.cycle()).toBe(0);
    });
});
