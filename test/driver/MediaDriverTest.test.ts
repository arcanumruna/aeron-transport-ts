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
// Port of io/aeron/driver/MediaDriverTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import type { AgentInvoker } from '../../src/agrona/concurrent/AgentInvoker.js';
import { Aeron } from '../../src/client/Aeron.js';
import { DutyCycleTracker } from '../../src/driver/DutyCycleTracker.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { DutyCycleStallTracker } from '../../src/driver/status/DutyCycleStallTracker.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import { freeUdpPort } from '../support/Udp.js';

const MAX_INVOKES = 10_000;

const {
    CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED,
    CONDUCTOR_MAX_CYCLE_TIME,
    NAME_RESOLVER_MAX_TIME,
    NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED,
    RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED,
    RECEIVER_MAX_CYCLE_TIME,
    SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED,
    SENDER_MAX_CYCLE_TIME,
} = SystemCounterDescriptor;

const SECONDS = (s: number): number => s * 1_000_000_000;
const MILLISECONDS = (ms: number): number => ms * 1_000_000;
const MICROSECONDS = (us: number): number => us * 1_000;

function verifyStallTracker(
    dutyCycleTracker: DutyCycleTracker | null,
    maxCycleTimeCounter: SystemCounterDescriptor,
    cycleTimeThresholdExceededCounter: SystemCounterDescriptor,
    cycleTimeThresholdNs: number,
    maxCycleLabelSuffix: string,
    thresholdLabelSuffix: string,
): void {
    expect(dutyCycleTracker).toBeInstanceOf(DutyCycleStallTracker);
    const stallTracker = dutyCycleTracker as DutyCycleStallTracker;
    expect(stallTracker.maxCycleTime().id()).toBe(maxCycleTimeCounter.id());
    expect(stallTracker.cycleTimeThresholdExceededCount().id()).toBe(cycleTimeThresholdExceededCounter.id());
    expect(stallTracker.cycleTimeThresholdNs()).toBe(cycleTimeThresholdNs);
    expect((stallTracker.maxCycleTime().label() as string).endsWith(maxCycleLabelSuffix)).toBe(true);
    expect((stallTracker.cycleTimeThresholdExceededCount().label() as string).endsWith(thresholdLabelSuffix)).toBe(
        true,
    );
}

describe('MediaDriverTest', () => {
    // Java redirects System.out and launches a SHARED driver on an Aeron directory (spec D4); the configuration that
    // conclude prints is `MediaDriverContext.toString`, covered by MediaDriverContextTest.
    it.skip('shouldPrintConfigOnStart', () => {});

    it.each(ThreadingMode.values())('shouldInitializeDutyCycleTrackersWhenNotSet %s', (threadingMode) => {
        // Java makes the Aeron directory in a temporary directory: there is none here (spec D4)
        const context = new MediaDriver.Context()
            .threadingMode(threadingMode)
            .conductorCycleThresholdNs(SECONDS(1))
            .senderCycleThresholdNs(MILLISECONDS(50))
            .receiverCycleThresholdNs(MICROSECONDS(3))
            .nameResolverThresholdNs(101010);

        expect(context.countersManager()).toBeNull();
        expect(context.systemCounters()).toBeNull();
        expect(context.conductorDutyCycleTracker()).toBeNull();
        expect(context.senderDutyCycleTracker()).toBeNull();
        expect(context.receiverDutyCycleTracker()).toBeNull();
        expect(context.nameResolverTimeTracker()).toBeNull();

        try {
            context.conclude();

            verifyStallTracker(
                context.conductorDutyCycleTracker(),
                CONDUCTOR_MAX_CYCLE_TIME,
                CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED,
                context.conductorCycleThresholdNs(),
                ': ' + threadingMode.name(),
                ': threshold=1s ' + threadingMode.name(),
            );
            verifyStallTracker(
                context.senderDutyCycleTracker(),
                SENDER_MAX_CYCLE_TIME,
                SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED,
                context.senderCycleThresholdNs(),
                ': ' + threadingMode.name(),
                ': threshold=50ms ' + threadingMode.name(),
            );
            verifyStallTracker(
                context.receiverDutyCycleTracker(),
                RECEIVER_MAX_CYCLE_TIME,
                RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED,
                context.receiverCycleThresholdNs(),
                ': ' + threadingMode.name(),
                ': threshold=3us ' + threadingMode.name(),
            );
            verifyStallTracker(
                context.nameResolverTimeTracker(),
                NAME_RESOLVER_MAX_TIME,
                NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED,
                context.nameResolverThresholdNs(),
                NAME_RESOLVER_MAX_TIME.label(),
                ': threshold=101010ns',
            );
        } finally {
            context.close();
        }
    });

    it('shouldUseProvidedDutyCycleTrackers', () => {
        const conductorDutyCycleTracker = new DutyCycleTracker();
        const senderDutyCycleTracker = new DutyCycleTracker();
        const receiverDutyCycleTracker = new DutyCycleTracker();
        const nameResolverTimeTracker = new DutyCycleTracker();
        const context = new MediaDriver.Context()
            .threadingMode(ThreadingMode.SHARED)
            .conductorDutyCycleTracker(conductorDutyCycleTracker)
            .senderDutyCycleTracker(senderDutyCycleTracker)
            .receiverDutyCycleTracker(receiverDutyCycleTracker)
            .nameResolverTimeTracker(nameResolverTimeTracker);

        expect(context.conductorDutyCycleTracker()).toBe(conductorDutyCycleTracker);
        expect(context.senderDutyCycleTracker()).toBe(senderDutyCycleTracker);
        expect(context.receiverDutyCycleTracker()).toBe(receiverDutyCycleTracker);
        expect(context.nameResolverTimeTracker()).toBe(nameResolverTimeTracker);

        try {
            context.conclude();

            expect(context.conductorDutyCycleTracker()).toBe(conductorDutyCycleTracker);
            expect(context.senderDutyCycleTracker()).toBe(senderDutyCycleTracker);
            expect(context.receiverDutyCycleTracker()).toBe(receiverDutyCycleTracker);
            expect(context.nameResolverTimeTracker()).toBe(nameResolverTimeTracker);
        } finally {
            context.close();
        }
    });

    it('shouldExecuteAsyncCommandsInOrder', () => {
        // Java launches a DEDICATED driver on an Aeron directory (spec D4, D54: the driver runs as INVOKER whatever the
        // mode says) and connects by the directory; here the client takes the CnC from the driver and runs its duty
        // cycle (Tests.await), and the driver's, by hand. The port is free, where Java's is 5050.
        const context = new MediaDriver.Context().threadingMode(ThreadingMode.DEDICATED);
        const mediaDriver = MediaDriver.launch(context);
        try {
            const aeron = Aeron.connect(new Aeron.Context().mediaDriver(mediaDriver).useConductorAgentInvoker(true));
            try {
                const channel = 'aeron:udp?endpoint=localhost:' + freeUdpPort();
                const streamId = 1111;
                const pubId1 = aeron.asyncAddExclusivePublication(channel, streamId);
                aeron.asyncRemovePublication(pubId1);

                const pubId2 = aeron.asyncAddExclusivePublication(channel, streamId);

                let isAvailable = false;
                for (let i = 0; i < MAX_INVOKES && !isAvailable; i++) {
                    mediaDriver.sharedAgentInvoker().invoke();
                    (aeron.conductorAgentInvoker() as AgentInvoker).invoke();
                    isAvailable = null !== aeron.getExclusivePublication(pubId2);
                }
                expect(isAvailable).toBe(true);

                expect(aeron.getExclusivePublication(pubId1)).toBeNull();
                expect(aeron.getExclusivePublication(pubId2)).not.toBeNull();
            } finally {
                aeron.close();
            }
        } finally {
            mediaDriver.close();
        }
    });
});
