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
// Port of io/aeron/driver/CongestionControl.java @ 1.53.3
import { type AutoCloseable } from '../agrona/jdkLang.js';
import { type InetSocketAddress } from './jdkNet.js';

/**
 * Congestion control algorithm used by a receiver for an image.
 */
export interface CongestionControl extends AutoCloseable {
    /**
     * Polled by {@link Receiver} to determine when to initiate an RTT measurement to a Sender.
     *
     * @param nowNs in nanoseconds
     * @return true for should measure RTT now or false for no measurement
     */
    shouldMeasureRtt(nowNs: number): boolean;

    /**
     * Called by {@link Receiver} to record that a measurement request has been sent.
     *
     * @param nowNs in nanoseconds.
     */
    onRttMeasurementSent(nowNs: number): void;

    /**
     * Called by {@link Receiver} on reception of an RTT Measurement.
     *
     * @param nowNs      in nanoseconds
     * @param rttNs      to the Sender in nanoseconds
     * @param srcAddress of the Sender
     */
    onRttMeasurement(nowNs: number, rttNs: number, srcAddress: InetSocketAddress): void;

    /**
     * Called by {@link DriverConductor} upon execution of {@link PublicationImage#trackRebuild(long)} to
     * pass on current status.
     * <p>
     * The return value must be packed using {@link CongestionControl#packOutcome(int, boolean)}.
     *
     * @param nowNs                   current time
     * @param newConsumptionPosition  of the subscribers
     * @param lastSmPosition          of the image
     * @param hwmPosition             of the image
     * @param startingRebuildPosition of the rebuild
     * @param endingRebuildPosition   of the rebuild
     * @param lossOccurred            during rebuild
     * @return outcome of congestion control calculation containing window length and whether to force sending an SM.
     */
    onTrackRebuild(
        nowNs: number,
        newConsumptionPosition: number,
        lastSmPosition: number,
        hwmPosition: number,
        startingRebuildPosition: number,
        endingRebuildPosition: number,
        lossOccurred: boolean,
    ): number;

    /**
     * Called by {@link DriverConductor} to initialise window length for a new {@link PublicationImage}.
     *
     * @return initial window length for flow and congestion control.
     */
    initialWindowLength(): number;

    /**
     * Called by {@link DriverConductor} limit the window length for a new {@link PublicationImage}.
     *
     * @return maximum window length for flow and congestion control.
     */
    maxWindowLength(): number;

    /**
     * {@inheritDoc}
     */
    close(): void;
}

const FORCE_STATUS_MESSAGE_BIT = 0x1;

/**
 * The static members of Java's `CongestionControl` interface.
 *
 * The outcome is a `number` (spec D26): `receiverWindowLength * 2 + flags`, where Java packs
 * `(flags << 32) | receiverWindowLength` into a `long`. It is exact for any `int` window length, and a window length of
 * up to 2^29 (half of the largest term, 1 GiB) keeps it a small integer that V8 does not box.
 */
export const CongestionControl = {
    /**
     * Bit flag for if a status message should be forced out.
     */
    FORCE_STATUS_MESSAGE_BIT,

    /**
     * Pack values into a number, so they can be returned on the stack without allocation.
     *
     * @param receiverWindowLength to go in the higher bits; an `int`, or a `RangeError` is thrown.
     * @param forceStatusMessage   to go in the lowest bit.
     * @return the packed value.
     */
    packOutcome(receiverWindowLength: number, forceStatusMessage: boolean): number {
        if ((receiverWindowLength | 0) !== receiverWindowLength) {
            throw new RangeError('receiverWindowLength is not an int: ' + receiverWindowLength);
        }

        return receiverWindowLength * 2 + (forceStatusMessage ? FORCE_STATUS_MESSAGE_BIT : 0);
    },

    /**
     * Extract the receiver window length from the packed value.
     *
     * @param outcome as the packed value.
     * @return the receiver window length.
     */
    receiverWindowLength(outcome: number): number {
        return Math.floor(outcome / 2);
    },

    /**
     * Extract the boolean value for if a status message should be forced from the packed value.
     *
     * @param outcome which is packed containing the force status message flag.
     * @return true if the force status message bit has been set.
     */
    shouldForceStatusMessage(outcome: number): boolean {
        return outcome - Math.floor(outcome / 2) * 2 === FORCE_STATUS_MESSAGE_BIT;
    },

    /**
     * Threshold increment in a window after which a status message should be scheduled.
     *
     * @param windowLength to calculate the threshold from.
     * @return the threshold in the window after which a status message should be scheduled.
     */
    threshold(windowLength: number): number {
        return windowLength >> 2;
    },
};
