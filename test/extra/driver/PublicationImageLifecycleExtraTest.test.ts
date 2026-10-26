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
// Extra tests of T16 (port-only): the interaction matrix row "Lifecycle", for the image, on the receiver rig of
// `test/support/ReceiverRig.ts`: `INIT -> ACTIVE -> DRAINING -> LINGER -> DONE` with the end of stream and with the
// removal of the subscription, a revoked publication, a rejected image, the liveness timeout and the cool down, a
// receiver that restarts mid-term (a new image of the same session), two images on one subscription, the untethered
// subscriber (linger, rest and rejoin, and the one that does not rejoin) and the closing of the counters.
import { afterEach, describe, expect, it } from 'vitest';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { PublicationImage } from '../../../src/driver/PublicationImage.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { ReceiverRig } from '../../support/ReceiverRig.js';

const { PUBLICATION_IMAGES_REVOKED, INVALID_PACKETS } = SystemCounterDescriptor;
const { END_OF_STREAM_FLAG } = StatusMessageFlyweight;
const { BEGIN_END_AND_EOS_FLAGS, BEGIN_END_EOS_AND_REVOKED_FLAGS } = DataHeaderFlyweight;
const TERM = LogBufferDescriptor.TERM_MIN_LENGTH;
const SM_TIMEOUT_NS = Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS;

function pattern(length: number, seed = 1): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = (i * 31 + seed * 7 + (i >> 8)) & 0xff;
    }

    return bytes;
}

let rig: ReceiverRig;

function frameAt(i: number, termOffsetBase = 0, termId = rig.initialTermId): Uint8Array {
    return rig.frame({ termId, termOffset: termOffsetBase + 64 * i, payload: pattern(32, i) });
}

function state(image: PublicationImage = rig.image): string {
    return /state=(\w+)/.exec(image.toString())?.[1] as string;
}

function lastSm(): StatusMessageFlyweight {
    return rig.statusMessages().at(-1) as StatusMessageFlyweight;
}

afterEach(() => {
    expect(rig.errors).toEqual([]);
    rig.close();
});

describe('PublicationImageStateExtraTest', () => {
    it('INIT before the receiver takes it, ACTIVE once the dispatcher has it: the image sends nothing and takes nothing in INIT', () => {
        rig = new ReceiverRig();
        rig.subscribe();
        rig.sendSetup();
        rig.runConductorCommands();
        expect(rig.requests.length).toBe(1);
        expect(rig.requests[0]).toMatchObject({
            sessionId: rig.sessionId,
            streamId: rig.streamId,
            initialTermId: rig.initialTermId,
            activeTermId: rig.initialTermId,
            termOffset: 0,
            termLength: TERM,
            mtuLength: 1408,
            transportIndex: 0,
            flags: 0,
        });

        const image = rig.createImage();

        expect(state(image)).toBe('ACTIVE');
        expect(image.isEndOfStream()).toBe(false);
        expect(image.isAcceptingSubscriptions()).toBe(true);
        expect(image.hasReachedEndOfLife()).toBe(false);
        expect(image.correlationId()).toBe(ReceiverRig.REGISTRATION_ID);
        expect(image.sessionId()).toBe(rig.sessionId);
        expect(image.streamId()).toBe(rig.streamId);
        expect(image.channelEndpoint() === rig.endpoint).toBe(true);
        expect(image.subscribableRegistrationId()).toBe(ReceiverRig.REGISTRATION_ID);
        expect(image.joinPosition()).toBe(0);
    });

    /** The stream ends at 64 bytes and the rebuild has caught up: the receiver cycle that drains the image is the last. */
    function endOfStreamAndDraining(): number {
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        rig.deliver(rig.heartbeat(rig.initialTermId, 64, BEGIN_END_AND_EOS_FLAGS));

        expect(rig.image.isEndOfStream()).toBe(true);
        expect(LogBufferDescriptor.endOfStreamPosition(rig.rawLog.metaData())).toBe(64);
        expect(rig.hwmPosition.get()).toBe(64);
        // the rebuild has not caught up with the data: the stream goes on being active
        rig.cycle(1);
        expect(state()).toBe('ACTIVE');
        const smBefore = rig.statusMessages().length;

        rig.conductorCycle(1); // trackRebuild: the rebuild position is 64, the high water mark
        expect(rig.rebuildPosition.get()).toBe(64);
        rig.cycle(1); // checkEosForDrainTransition
        expect(state()).toBe('DRAINING');
        expect(rig.statusMessages().length).toBe(smBefore + 1);
        expect(lastSm().flags() & END_OF_STREAM_FLAG).toBe(END_OF_STREAM_FLAG);

        return rig.clock.nanoTime(); // the time of the change of state
    }

    it('the end of stream: ACTIVE -> DRAINING when the rebuild has caught up, an SM with the EOS flag, and it stays DRAINING while the subscriber has not read', () => {
        rig = new ReceiverRig();
        endOfStreamAndDraining();

        // the subscriber has not read: not drained, so it stays DRAINING however long it takes
        rig.conductorCycle(10_000_000_000);
        expect(state()).toBe('DRAINING');
        expect(rig.conductorCalls.transitionToLinger.length).toBe(0);
        expect(rig.image.isAcceptingSubscriptions()).toBe(true); // DRAINING, but not drained: a subscriber can still join

        expect(rig.read()).toEqual([pattern(32, 0)]);
        expect(rig.image.isAcceptingSubscriptions()).toBe(false);
        rig.conductorCycle(); // drained, and the time is long past: LINGER
        expect(state()).toBe('LINGER');
    });

    it('DRAINING -> LINGER -> DONE: drained and 5 status message timeouts after the change; then the liveness timeout; the receiver lets go in between', () => {
        rig = new ReceiverRig();
        const drainingNs = endOfStreamAndDraining();
        expect(rig.read()).toEqual([pattern(32, 0)]);

        rig.conductorCycle(5 * SM_TIMEOUT_NS - (rig.clock.nanoTime() - drainingNs));
        expect(rig.clock.nanoTime()).toBe(drainingNs + 5 * SM_TIMEOUT_NS);
        expect(state()).toBe('DRAINING'); // at the deadline: not yet
        rig.conductorCycle(1);

        expect(state()).toBe('LINGER');
        expect(rig.conductorCalls.transitionToLinger.length).toBe(1);
        expect(rig.conductorCalls.transitionToLinger[0] === rig.image).toBe(true);
        expect(rig.conductorCalls.tryCloseReceiveChannelEndpoint.length).toBe(1);
        expect(rig.conductorCalls.tryCloseReceiveChannelEndpoint[0] === rig.endpoint).toBe(true);
        expect(rig.image.hasReachedEndOfLife()).toBe(false);

        // the receiver lets go of the image in its next cycle: no more packets are taken for it
        rig.cycle();
        const hwm = rig.hwmPosition.get();
        rig.deliver(frameAt(5));
        expect(rig.hwmPosition.get()).toBe(hwm);
        expect(rig.image.hasReachedEndOfLife()).toBe(false); // released by the receiver, but not DONE

        rig.conductorCycle(Configuration.imageLivenessTimeoutNs());
        expect(state()).toBe('LINGER'); // at the deadline: not yet
        rig.conductorCycle(1);

        expect(state()).toBe('DONE');
        expect(rig.conductorCalls.cleanupImage.length).toBe(1);
        expect(rig.conductorCalls.cleanupImage[0] === rig.image).toBe(true);
        expect(rig.image.hasReachedEndOfLife()).toBe(true);
        rig.conductorCycle(1);
        expect(rig.conductorCalls.cleanupImage.length).toBe(1);
    });

    it('LINGER -> DONE as soon as the last subscriber is removed, and the image stops rebuilding', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        rig.deliver(rig.heartbeat(rig.initialTermId, 64, BEGIN_END_AND_EOS_FLAGS));
        rig.run(1, 1);
        rig.read();
        rig.conductorCycle(6 * SM_TIMEOUT_NS);
        expect(state()).toBe('LINGER');
        rig.cycle();

        rig.image.removeSubscriber(rig.subscriptionLink, rig.subscriberPosition);
        expect(rig.subscriberPosition.isClosed()).toBe(true);
        expect(rig.image.isAcceptingSubscriptions()).toBe(false);
        rig.conductorCycle(1);

        expect(state()).toBe('DONE');
        expect(rig.conductorCalls.cleanupImage.length).toBe(1);
        expect(rig.image.hasReachedEndOfLife()).toBe(true);
        expect(rig.trackRebuild(1)).toBe(0);
    });

    it('removing the subscription: the dispatcher deactivates the image, which says the end of stream and drains', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        const smBefore = rig.statusMessages().length;

        rig.receiverProxy.removeSubscription(rig.endpoint, rig.streamId);
        rig.cycle(1);

        expect(state()).toBe('DRAINING');
        expect(rig.image.isSendingEosSm).toBe(true);
        expect(rig.statusMessages().length).toBe(smBefore + 1);
        expect(lastSm().flags() & END_OF_STREAM_FLAG).toBe(END_OF_STREAM_FLAG);
        // the image no longer rebuilds
        expect(rig.trackRebuild(1)).toBe(0);
        expect(rig.rebuildPosition.get()).toBe(0);
    });

    it('a revoked publication: the flag and the counter, DRAINING at once, LINGER without waiting, an SM with the EOS flag, no NAKs', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        rig.deliver(frameAt(2)); // a gap that must not be asked for once the publication is revoked

        rig.deliver(rig.heartbeat(rig.initialTermId, 192, BEGIN_END_EOS_AND_REVOKED_FLAGS));

        expect(LogBufferDescriptor.isPublicationRevoked(rig.rawLog.metaData())).toBe(true);
        expect(rig.counter(PUBLICATION_IMAGES_REVOKED)).toBe(1);
        expect(LogBufferDescriptor.endOfStreamPosition(rig.rawLog.metaData())).toBe(192);
        rig.cycle(1);
        rig.cycle(1);
        expect(rig.naks().length).toBe(0); // the receiver does not ask for what the revoked publication will not send

        rig.conductorCycle(1); // ACTIVE and revoked: DRAINING
        expect(state()).toBe('DRAINING');
        const smBefore = rig.statusMessages().length;
        rig.conductorCycle(1); // DRAINING and revoked: LINGER with no wait, and the receiver is to let go of the image
        expect(state()).toBe('LINGER');
        expect(rig.conductorCalls.transitionToLinger.length).toBe(1);
        expect(rig.image.isSendingEosSm).toBe(true);
        expect(rig.image.isConnected(rig.clock.nanoTime())).toBe(false);

        // as in Java, the receiver releases the image before it sends the status message that was asked for
        rig.cycle(1);
        expect(rig.statusMessages().length).toBe(smBefore);
        const hwm = rig.hwmPosition.get();
        rig.deliver(frameAt(3));
        expect(rig.hwmPosition.get()).toBe(hwm);
    });

    it('a rejected image: an error frame with the reason and IMAGE_REJECTED, repeated on the SM timeout; nothing is taken, nothing else is sent', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        const smBefore = rig.statusMessages().length;
        const bytesBefore = rig.hwmPosition.get();

        rig.receiverProxy.rejectImage(ReceiverRig.REGISTRATION_ID, 0, 'not for you');
        rig.cycle(SM_TIMEOUT_NS + 1);

        expect(rig.errorFrames().length).toBe(1);
        expect(rig.errorFrames()[0]?.errorCode()).toBe(ErrorCode.IMAGE_REJECTED.value());
        expect(rig.errorFrames()[0]?.errorMessage()).toBe('not for you');
        expect(rig.errorFrames()[0]?.sessionId()).toBe(rig.sessionId);
        expect(rig.errorFrames()[0]?.streamId()).toBe(rig.streamId);
        expect(rig.statusMessages().length).toBe(smBefore);

        rig.deliver(frameAt(0));
        expect(rig.hwmPosition.get()).toBe(bytesBefore);
        expect(rig.counter(INVALID_PACKETS)).toBe(0);
        rig.cycle(SM_TIMEOUT_NS);
        expect(rig.errorFrames().length).toBe(1);
        rig.cycle(1);
        expect(rig.errorFrames().length).toBe(2);
        expect(rig.statusMessages().length).toBe(smBefore);
        expect(rig.counter(SystemCounterDescriptor.ERROR_FRAMES_SENT)).toBe(2);

        // another image id is not rejected
        rig.receiverProxy.rejectImage(ReceiverRig.REGISTRATION_ID + 1, 0, 'nobody');
        rig.cycle(SM_TIMEOUT_NS + 1);
        expect(rig.errorFrames().length).toBe(3); // the same image goes on being rejected, none other started
    });
});

describe('PublicationImageLivenessExtraTest', () => {
    it('no packet for the liveness timeout: the receiver lets the image go, the stream is in cool down, and a new image can join mid-term', () => {
        const livenessNs = 1_000_000;
        rig = new ReceiverRig({ imageLivenessTimeoutNs: livenessNs });
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        const lastPacketNs = rig.image.timeOfLastPacketNs;

        rig.clock.advance(lastPacketNs + livenessNs - rig.clock.nanoTime());
        expect(rig.image.isConnected(rig.clock.nanoTime())).toBe(true); // at the deadline: still there
        rig.cycle();
        rig.deliver(frameAt(1)); // still taken
        expect(rig.hwmPosition.get()).toBe(128);

        const last2 = rig.image.timeOfLastPacketNs;
        rig.cycle(livenessNs + 1);
        expect(rig.image.isConnected(rig.clock.nanoTime())).toBe(false);
        expect(rig.image.timeOfLastPacketNs).toBe(last2);
        expect(rig.image.hasReachedEndOfLife()).toBe(false); // the conductor has not made it DONE

        // in cool down: the data of the dead session is not an image to create and not taken
        const requests = rig.requests.length;
        rig.deliver(frameAt(2));
        expect(rig.hwmPosition.get()).toBe(128);
        expect(rig.requests.length).toBe(requests);

        // the conductor takes the stream out of cool down; the source's setup frame is for a new image, mid-term
        rig.receiverProxy.removeCoolDown(rig.endpoint, rig.sessionId, rig.streamId);
        rig.cycle(1);
        rig.restartAt(2 * TERM + 4096);
        rig.sendSetup();
        rig.runConductorCommands();
        expect(rig.requests.length).toBe(requests + 1);
        expect(rig.requests[requests]).toMatchObject({
            initialTermId: rig.initialTermId,
            activeTermId: (rig.initialTermId + 2) | 0,
            termOffset: 4096,
        });

        const second = rig.createImage();
        expect(second === rig.images[0]?.image).toBe(false);
        expect(rig.hwmPosition.get()).toBe(2 * TERM + 4096);
        expect(rig.rebuildPosition.get()).toBe(2 * TERM + 4096);
        const { termId, termOffset } = rig.at(2 * TERM + 4096);
        rig.deliver(rig.frame({ termId, termOffset, payload: pattern(100, 5) }));
        expect(rig.hwmPosition.get()).toBe(2 * TERM + 4096 + 160);
        rig.run(2, 1000);
        expect(rig.read()).toEqual([pattern(100, 5)]);
        // the first image is still in the log of the conductor, with its data
        expect(rig.images[0]?.hwmPosition.get()).toBe(128);
    });

    it('a new image of a session whose old image is not ACTIVE: the old one stops sending status messages, the new one sends them', () => {
        rig = new ReceiverRig();
        rig.join();
        rig.cycle(1);
        rig.deliver(frameAt(0));
        rig.deliver(rig.heartbeat(rig.initialTermId, 64, BEGIN_END_AND_EOS_FLAGS));
        rig.run(1, 1); // DRAINING
        expect(state()).toBe('DRAINING');
        const old = rig.image;
        const smBefore = rig.statusMessages().length;

        rig.restartAt(TERM + 1024);
        rig.sendSetup();
        rig.runConductorCommands();
        const next = rig.createImage();
        rig.cycle(1);

        expect(next === old).toBe(false);
        expect(state(next)).toBe('ACTIVE');
        // only the new image sent: its position is the one in the status message
        expect(rig.statusMessages().length).toBe(smBefore + 1);
        expect(lastSm().consumptionTermId()).toBe((rig.initialTermId + 1) | 0);
        expect(lastSm().consumptionTermOffset()).toBe(1024);
        expect(lastSm().flags() & END_OF_STREAM_FLAG).toBe(0);
        rig.cycle(SM_TIMEOUT_NS + 1);
        expect(rig.statusMessages().length).toBe(smBefore + 2);
        expect(lastSm().consumptionTermOffset()).toBe(1024);
        expect(
            rig
                .statusMessages()
                .slice(smBefore)
                .every((sm) => 0 === (sm.flags() & END_OF_STREAM_FLAG)),
        ).toBe(true);
    });

    it('two images on one subscription: each has its own log, position and status messages; the end of one does not touch the other', () => {
        rig = new ReceiverRig();
        rig.join();
        const first = rig.images[0];
        rig.cycle(1);
        const firstSession = rig.sessionId;
        const secondSession = firstSession + 1;

        rig.sessionId = secondSession;
        rig.sendSetup();
        rig.runConductorCommands();
        rig.createImage();
        const second = rig.images[1];
        rig.cycle(1);
        expect(rig.images.length).toBe(2);
        expect(rig.statusMessages().map((sm) => sm.sessionId())).toEqual([firstSession, secondSession]);

        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(10, 1) }));
        rig.sessionId = firstSession;
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 0, payload: pattern(20, 2) }));
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 64, payload: pattern(30, 3) }));
        expect(second?.hwmPosition.get()).toBe(64);
        expect(first?.hwmPosition.get()).toBe(128);

        // the first session ends
        rig.deliver(rig.heartbeat(rig.initialTermId, 128, BEGIN_END_AND_EOS_FLAGS));
        rig.images.forEach((parts) => {
            rig.image = parts.image;
            rig.rebuildPosition = parts.rebuildPosition;
            rig.trackRebuild(1);
        });
        rig.cycle(1);
        expect(state(first?.image)).toBe('DRAINING');
        expect(state(second?.image)).toBe('ACTIVE');
        const sms = rig.statusMessages();
        expect(sms.at(-1)?.sessionId()).toBe(firstSession);
        expect(lastSm().flags() & END_OF_STREAM_FLAG).toBe(END_OF_STREAM_FLAG);

        rig.sessionId = secondSession;
        rig.deliver(rig.frame({ termId: rig.initialTermId, termOffset: 64, payload: pattern(11, 4) }));
        expect(second?.hwmPosition.get()).toBe(128);
        expect(first?.hwmPosition.get()).toBe(128);
    });
});

describe('PublicationImageUntetheredExtraTest', () => {
    const OPTIONS = {
        isTether: false,
        untetheredWindowLimitTimeoutNs: 1_000_000_000,
        untetheredLingerTimeoutNs: 150_000_000,
        untetheredRestingTimeoutNs: 800_000_000,
    };

    function slowSubscriber(isRejoin: boolean): {
        link: ReturnType<ReceiverRig['addSubscriber']>['link'];
        position: ReturnType<ReceiverRig['addSubscriber']>['position'];
    } {
        rig.rebuildPosition.set(0);
        const slow = rig.addSubscriber(false, isRejoin);
        // the tethered subscriber of the rig is a window ahead of the slow one
        rig.subscriberPosition.setRelease(2 * rig.windowLength);
        return slow;
    }

    it('a subscriber that falls a window behind: unavailable after the window limit timeout, lingers, rests, then rejoins at the join position', () => {
        rig = new ReceiverRig({
            untetheredWindowLimitTimeoutNs: 1_000_000_000,
            untetheredLingerTimeoutNs: 150_000_000,
            untetheredRestingTimeoutNs: 800_000_000,
        });
        rig.join();
        rig.cycle(1);
        const { link, position } = slowSubscriber(true);
        const startNs = rig.clock.nanoTime();

        rig.conductorCycle(OPTIONS.untetheredWindowLimitTimeoutNs - 1);
        expect(rig.conductorCalls.unavailable.length).toBe(0);
        // the tethered subscriber is not untethered: it is never moved on
        expect(rig.image.untetheredSubscriptions.length).toBe(1);

        rig.conductorCycle(1);
        expect(rig.clock.nanoTime()).toBe(startNs + OPTIONS.untetheredWindowLimitTimeoutNs);
        expect(rig.conductorCalls.unavailable.length).toBe(1);
        expect(rig.conductorCalls.unavailable[0]?.resourceId).toBe(ReceiverRig.REGISTRATION_ID);
        expect(rig.conductorCalls.unavailable[0]?.link === link).toBe(true);

        rig.conductorCycle(OPTIONS.untetheredLingerTimeoutNs - 1);
        expect(rig.image.subscriberPositions.includes(position)).toBe(true);
        rig.conductorCycle(1); // LINGER over: the position is out of the set, the subscription rests
        expect(rig.image.subscriberPositions.includes(position)).toBe(false);
        expect(position.isClosed()).toBe(false);
        expect(rig.conductorCalls.available.length).toBe(0);

        rig.conductorCycle(OPTIONS.untetheredRestingTimeoutNs - 1);
        expect(rig.conductorCalls.available.length).toBe(0);
        rig.conductorCycle(1); // RESTING over: back in the set, and the client is told
        expect(rig.image.subscriberPositions.includes(position)).toBe(true);
        expect(rig.conductorCalls.available.length).toBe(1);
        const available = rig.conductorCalls.available[0];
        expect(available?.link === link).toBe(true);
        expect({ ...available, link: null }).toEqual({
            resourceId: ReceiverRig.REGISTRATION_ID,
            sessionId: rig.sessionId,
            link: null,
            positionCounterId: position.id(),
            joinPosition: 2 * rig.windowLength, // the rebuild and the tethered subscriber are there, the resting one is not counted
            logFileName: rig.rawLog.fileName(),
            sourceIdentity: 'aeron:udp?endpoint=127.0.0.1:41000',
        });
        expect(rig.conductorCalls.unavailable.length).toBe(1);
    });

    it('a subscriber that does not rejoin: its position is closed and it is gone after the linger', () => {
        rig = new ReceiverRig({
            untetheredWindowLimitTimeoutNs: 1_000_000_000,
            untetheredLingerTimeoutNs: 150_000_000,
            untetheredRestingTimeoutNs: 800_000_000,
        });
        rig.join();
        rig.cycle(1);
        const { position } = slowSubscriber(false);

        rig.conductorCycle(OPTIONS.untetheredWindowLimitTimeoutNs);
        expect(rig.conductorCalls.unavailable.length).toBe(1);
        rig.conductorCycle(OPTIONS.untetheredLingerTimeoutNs);

        expect(rig.image.subscriberPositions.includes(position)).toBe(false);
        expect(position.isClosed()).toBe(true);
        expect(rig.image.untetheredSubscriptions.length).toBe(0);
        rig.conductorCycle(OPTIONS.untetheredRestingTimeoutNs * 2);
        expect(rig.conductorCalls.available.length).toBe(0);
    });

    it('a subscriber that keeps up is never moved on', () => {
        rig = new ReceiverRig({ untetheredWindowLimitTimeoutNs: 1_000_000_000 });
        rig.join();
        rig.cycle(1);
        const { position } = rig.addSubscriber(false);
        for (let i = 0; i < 10; i++) {
            rig.subscriberPosition.setRelease((i + 1) * 4096);
            position.setRelease((i + 1) * 4096);
            rig.conductorCycle(400_000_000);
        }

        expect(rig.conductorCalls.unavailable.length).toBe(0);
        expect(rig.image.subscriberPositions.includes(position)).toBe(true);
    });

    it('closing the image closes its counters and the positions that rest', () => {
        rig = new ReceiverRig({
            untetheredWindowLimitTimeoutNs: 1_000_000_000,
            untetheredLingerTimeoutNs: 150_000_000,
            untetheredRestingTimeoutNs: 800_000_000,
        });
        rig.join();
        rig.cycle(1);
        const { position } = slowSubscriber(true);
        rig.conductorCycle(OPTIONS.untetheredWindowLimitTimeoutNs);
        rig.conductorCycle(OPTIONS.untetheredLingerTimeoutNs); // resting
        expect(position.isClosed()).toBe(false);

        rig.image.close();

        expect(rig.hwmPosition.isClosed()).toBe(true);
        expect(rig.rebuildPosition.isClosed()).toBe(true);
        expect(rig.naksSent.isClosed()).toBe(true);
        expect(position.isClosed()).toBe(true); // it rests, so the image owns it
        expect(rig.subscriberPosition.isClosed()).toBe(true);
    });
});
