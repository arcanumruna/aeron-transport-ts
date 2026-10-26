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
// Port of io/aeron/driver/ReceiverLivenessTrackerTest.java @ 1.53.3
// A receiver id is the two `int` halves of the `long` (spec D14); the ids of these tests fit in the low half.
import { describe, expect, it } from 'vitest';
import { ReceiverLivenessTracker } from '../../src/driver/ReceiverLivenessTracker.js';

describe('ReceiverLivenessTrackerTest', () => {
    it('shouldNotBeLiveIfNoReceiversAdded', () => {
        const receiverLivenessTracker = new ReceiverLivenessTracker();
        expect(receiverLivenessTracker.hasReceivers()).toBe(false);
    });

    it('shouldLiveIfOneReceiverAdded', () => {
        const receiverLivenessTracker = new ReceiverLivenessTracker();

        const receiverId = 10001;
        const nowNs = 10000000000;

        receiverLivenessTracker.onStatusMessage(0, receiverId, nowNs);

        expect(receiverLivenessTracker.hasReceivers()).toBe(true);
    });

    it('shouldBeLiveIfReceiverNotTimedOut', () => {
        const receiverId = 10001;
        const nowNs = 10000000000;
        const timeoutNs = 5000000;

        const receiverLivenessTracker = new ReceiverLivenessTracker();
        receiverLivenessTracker.onStatusMessage(0, receiverId, nowNs);
        receiverLivenessTracker.onIdle(nowNs + (timeoutNs - 1), timeoutNs);
        expect(receiverLivenessTracker.hasReceivers()).toBe(true);
    });

    it('shouldNotBeLiveIfReceiverTimedOutExactly', () => {
        const receiverId = 10001;
        const nowNs = 10000000000;
        const timeoutNs = 5000000;

        const receiverLivenessTracker = new ReceiverLivenessTracker();
        receiverLivenessTracker.onStatusMessage(0, receiverId, nowNs);
        receiverLivenessTracker.onIdle(nowNs + timeoutNs, timeoutNs);
        expect(receiverLivenessTracker.hasReceivers()).toBe(false);
    });

    it('shouldNotBeLiveIfReceiverTimedOutAfter', () => {
        const receiverId = 10001;
        const nowNs = 10000000000;
        const timeoutNs = 5000000;

        const receiverLivenessTracker = new ReceiverLivenessTracker();
        receiverLivenessTracker.onStatusMessage(0, receiverId, nowNs);
        receiverLivenessTracker.onIdle(nowNs + (timeoutNs + 1), timeoutNs);
        expect(receiverLivenessTracker.hasReceivers()).toBe(false);
    });

    it('shouldNotBeLiveIfReceiverRemoved', () => {
        const receiverId1 = 10001;
        const receiverId2 = 10002;
        const receiverId3 = 10003;
        const nowNs = 10000000000;

        const receiverLivenessTracker = new ReceiverLivenessTracker();
        receiverLivenessTracker.onStatusMessage(0, receiverId1, nowNs);
        receiverLivenessTracker.onStatusMessage(0, receiverId2, nowNs);
        receiverLivenessTracker.onStatusMessage(0, receiverId3, nowNs);

        receiverLivenessTracker.onRemoteClose(0, receiverId1);
        expect(receiverLivenessTracker.hasReceivers()).toBe(true);

        receiverLivenessTracker.onRemoteClose(0, receiverId2);
        expect(receiverLivenessTracker.hasReceivers()).toBe(true);

        receiverLivenessTracker.onRemoteClose(0, receiverId3);
        expect(receiverLivenessTracker.hasReceivers()).toBe(false);
    });

    it('shouldReturnFalseIfAlreadyRemoved', () => {
        const receiverId1 = 10001;
        const receiverId2 = 10002;
        const receiverId3 = 10003;
        const nowNs = 10000000000;

        const receiverLivenessTracker = new ReceiverLivenessTracker();
        receiverLivenessTracker.onStatusMessage(0, receiverId1, nowNs);
        receiverLivenessTracker.onStatusMessage(0, receiverId2, nowNs);
        receiverLivenessTracker.onStatusMessage(0, receiverId3, nowNs);

        expect(receiverLivenessTracker.onRemoteClose(0, receiverId1)).toBe(true);
        expect(receiverLivenessTracker.onRemoteClose(0, receiverId1)).toBe(false);
        expect(receiverLivenessTracker.hasReceivers()).toBe(true);

        expect(receiverLivenessTracker.onRemoteClose(0, receiverId2)).toBe(true);
        expect(receiverLivenessTracker.onRemoteClose(0, receiverId2)).toBe(false);
        expect(receiverLivenessTracker.hasReceivers()).toBe(true);

        expect(receiverLivenessTracker.onRemoteClose(0, receiverId3)).toBe(true);
        expect(receiverLivenessTracker.onRemoteClose(0, receiverId3)).toBe(false);
        expect(receiverLivenessTracker.hasReceivers()).toBe(false);
    });
});
