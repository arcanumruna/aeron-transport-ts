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
// Port of io/aeron/driver/status/DutyCycleStallTrackerTest.java @ 1.53.3
import { describe, expect, it, type Mock } from 'vitest';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { NullPointerException } from '../../../src/agrona/jdk.js';
import { DutyCycleStallTracker } from '../../../src/driver/status/DutyCycleStallTracker.js';
import { assertThrowsExactly } from '../../support/Assertions.js';
import { mock } from '../../support/Mockito.js';

/** `verifyNoMoreInteractions(mock)` after the verified calls: no spy of the mock has a call other than `allowed`. */
function verifyNoOtherCalls(counter: AtomicCounter, allowed: readonly string[]): void {
    for (const [name, member] of Object.entries(counter)) {
        if (typeof member === 'function' && !allowed.includes(name)) {
            expect(member as Mock, name).not.toHaveBeenCalled();
        }
    }
}

describe('DutyCycleStallTrackerTest', () => {
    it('throwsNullPointerExceptionIfMaxTimeCounterIsNull', () => {
        assertThrowsExactly(
            NullPointerException,
            () => new DutyCycleStallTracker(null as unknown as AtomicCounter, mock(AtomicCounter).mock, 1),
        );
    });

    it('throwsNullPointerExceptionIfThresholdCounterIsNull', () => {
        assertThrowsExactly(
            NullPointerException,
            () => new DutyCycleStallTracker(mock(AtomicCounter).mock, null as unknown as AtomicCounter, 1),
        );
    });

    it('reportMeasurementIsANoOpIfMaxCounterIsClosed', () => {
        const maxCycleTime = mock(AtomicCounter);
        (maxCycleTime.mock.isClosed as Mock).mockReturnValue(true);
        const cycleTimeThresholdExceededCount = mock(AtomicCounter);
        const dutyCycleStallTracker = new DutyCycleStallTracker(
            maxCycleTime.mock,
            cycleTimeThresholdExceededCount.mock,
            1,
        );

        dutyCycleStallTracker.reportMeasurement(555);

        expect(maxCycleTime.mock.isClosed).toHaveBeenCalledTimes(1);
        verifyNoOtherCalls(maxCycleTime.mock, ['isClosed']);
        cycleTimeThresholdExceededCount.verifyNoInteractions();
    });

    it('reportMeasurementOnlyUpdatesThresholdCounterWhenExceeded', () => {
        const maxCycleTime = mock(AtomicCounter);
        (maxCycleTime.mock.isClosed as Mock).mockReturnValue(false);
        const cycleTimeThresholdExceededCount = mock(AtomicCounter);
        const cycleTimeThresholdNs = 1000;
        const dutyCycleStallTracker = new DutyCycleStallTracker(
            maxCycleTime.mock,
            cycleTimeThresholdExceededCount.mock,
            cycleTimeThresholdNs,
        );

        dutyCycleStallTracker.reportMeasurement(555);
        dutyCycleStallTracker.reportMeasurement(1000);
        dutyCycleStallTracker.reportMeasurement(1001);

        expect(maxCycleTime.mock.isClosed).toHaveBeenCalledTimes(3);
        expect(maxCycleTime.mock.proposeMaxRelease).toHaveBeenCalledTimes(3);
        expect(maxCycleTime.mock.proposeMaxRelease).toHaveBeenNthCalledWith(1, 555);
        expect(maxCycleTime.mock.proposeMaxRelease).toHaveBeenNthCalledWith(2, 1000);
        expect(maxCycleTime.mock.proposeMaxRelease).toHaveBeenNthCalledWith(3, 1001);
        expect(cycleTimeThresholdExceededCount.mock.incrementRelease).toHaveBeenCalledTimes(1);
        verifyNoOtherCalls(maxCycleTime.mock, ['isClosed', 'proposeMaxRelease']);
        verifyNoOtherCalls(cycleTimeThresholdExceededCount.mock, ['incrementRelease']);
    });
});
