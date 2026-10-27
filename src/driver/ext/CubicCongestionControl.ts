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
// Port of io/aeron/driver/ext/CubicCongestionControl.java @ 1.53.3
import { CloseHelper } from '../../agrona/CloseHelper.js';
import { type ErrorHandler } from '../../agrona/ErrorHandler.js';
import { type NanoClock } from '../../agrona/concurrent/NanoClock.js';
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { ArithmeticException, doubleToInt, TimeUnit } from '../../agrona/jdk.js';
import { Configuration } from '../Configuration.js';
import { CongestionControl } from '../CongestionControl.js';
import { type InetSocketAddress } from '../jdkNet.js';
import { type UdpChannel } from '../media/UdpChannel.js';
import type { MediaDriver } from '../MediaDriver.js';
import { PerImageIndicator } from '../status/PerImageIndicator.js';
import { CubicCongestionControlConfiguration } from './CubicCongestionControlConfiguration.js';

const { packOutcome } = CongestionControl;

const SECOND_IN_NS = TimeUnit.SECONDS.toNanos(1);
const INITCWND = 10;
const RTT_TIMEOUT_MULTIPLE = 4;

const C = 0.4;
const B = 0.2;

/**
 * Implementation of the CUBIC congestion control algorithm: https://tools.ietf.org/html/rfc8312
 * <p>
 * This implementation is not the default and must be selected with the {@code cc=cubic} channel URI parameter on the
 * receiving side.
 */
export class CubicCongestionControl implements CongestionControl {
    /**
     * URI param value to identify this {@link CongestionControl} strategy.
     */
    public static readonly CC_PARAM_VALUE: string = 'cubic';

    private readonly mtu: number = 0;
    private readonly maxCwnd: number = 0;
    private readonly _initialWindowLength: number = 0;
    private readonly _maxWindowLength: number = 0;

    private k: number = 0;
    private w_max: number = 0;
    private windowLength: number = 0;
    private cwnd: number = 0;

    private lastUpdateTimestampNs: number = 0;
    private lastLossTimestampNs: number = 0;
    private lastRttTimestampNs: number = 0;
    private rttNs: number = 0;
    private rttTimeoutNs: number = 0;
    private readonly windowUpdateTimeoutNs: number = 0;

    private readonly errorHandler: ErrorHandler | null = null;
    private readonly rttIndicator!: AtomicCounter;
    private readonly windowIndicator!: AtomicCounter;

    /**
     * Construct a new {@link CongestionControl} instance for a received stream image using the Cubic algorithm.
     *
     * @param registrationId  for the publication image.
     * @param udpChannel      for the publication image.
     * @param streamId        for the publication image.
     * @param sessionId       for the publication image.
     * @param termLength      for the publication image.
     * @param senderMtuLength for the publication image.
     * @param controlAddress  for the publication image.
     * @param sourceAddress   for the publication image.
     * @param nanoClock       for the precise timing.
     * @param context         for configuration options applied in the driver.
     * @param countersManager for the driver.
     */
    public constructor(
        registrationId: number,
        udpChannel: UdpChannel,
        streamId: number,
        sessionId: number,
        termLength: number,
        senderMtuLength: number,
        _controlAddress: InetSocketAddress | null,
        _sourceAddress: InetSocketAddress | null,
        nanoClock: NanoClock,
        context: MediaDriver.Context,
        countersManager: CountersManager,
    ) {
        try {
            this.errorHandler = context.countedErrorHandler();
            this.mtu = senderMtuLength;

            const receiverWindowLength =
                0 !== udpChannel.receiverWindowLength()
                    ? udpChannel.receiverWindowLength()
                    : context.initialWindowLength();
            this._maxWindowLength = Configuration.receiverWindowLength(termLength, receiverWindowLength);

            if (0 === this.mtu) {
                throw new ArithmeticException('/ by zero');
            }
            this.maxCwnd = Math.trunc(this._maxWindowLength / this.mtu);
            this.cwnd = Math.min(INITCWND, this.maxCwnd);
            this._initialWindowLength = Math.imul(this.cwnd, this.mtu);
            this.w_max = this.maxCwnd; // initially set w_max to max window and act in the TCP and concave region initially
            this.k = Math.cbrt((this.w_max * B) / C); // Java: StrictMath.cbrt (spec D132)

            // determine interval for adjustment based on heuristic of MTU, max window, and/or RTT estimate
            this.rttNs = CubicCongestionControlConfiguration.INITIAL_RTT_NS;
            this.windowUpdateTimeoutNs = this.rttNs;
            this.rttTimeoutNs = this.rttNs * RTT_TIMEOUT_MULTIPLE;

            this.rttIndicator = PerImageIndicator.allocate(
                context.tempBuffer()!,
                'rcv-cc-cubic-rtt',
                countersManager,
                registrationId,
                sessionId,
                streamId,
                udpChannel.originalUriString(),
            );

            this.windowIndicator = PerImageIndicator.allocate(
                context.tempBuffer()!,
                'rcv-cc-cubic-wnd',
                countersManager,
                registrationId,
                sessionId,
                streamId,
                udpChannel.originalUriString(),
            );

            this.windowLength = this._initialWindowLength;
            this.rttIndicator.setRelease(0);
            this.windowIndicator.setRelease(this._initialWindowLength);

            this.lastLossTimestampNs = nanoClock.nanoTime();
            this.lastUpdateTimestampNs = this.lastLossTimestampNs;
        } catch (ex) {
            this.close();
            throw ex;
        }
    }

    /**
     * {@inheritDoc}
     */
    public close(): void {
        CloseHelper.close(this.errorHandler, this.rttIndicator);
        CloseHelper.close(this.errorHandler, this.windowIndicator);
    }

    /**
     * {@inheritDoc}
     */
    public shouldMeasureRtt(nowNs: number): boolean {
        return (
            CubicCongestionControlConfiguration.MEASURE_RTT && this.lastRttTimestampNs + this.rttTimeoutNs - nowNs < 0
        );
    }

    /**
     * {@inheritDoc}
     */
    public onRttMeasurementSent(nowNs: number): void {
        this.lastRttTimestampNs = nowNs;
    }

    /**
     * {@inheritDoc}
     */
    public onRttMeasurement(nowNs: number, rttNs: number, _srcAddress: InetSocketAddress): void {
        this.lastRttTimestampNs = nowNs;
        this.rttNs = rttNs;
        this.rttIndicator.setRelease(rttNs);
        this.rttTimeoutNs = Math.max(rttNs, CubicCongestionControlConfiguration.INITIAL_RTT_NS) * RTT_TIMEOUT_MULTIPLE;
    }

    /**
     * {@inheritDoc}
     */
    public onTrackRebuild(
        nowNs: number,
        newConsumptionPosition: number,
        lastSmPosition: number,
        _hwmPosition: number,
        _startingRebuildPosition: number,
        _endingRebuildPosition: number,
        lossOccurred: boolean,
    ): number {
        let forceStatusMessage = false;

        if (lossOccurred) {
            forceStatusMessage = true;
            this.w_max = this.cwnd;
            this.k = Math.cbrt((this.w_max * B) / C); // Java: StrictMath.cbrt (spec D132)
            this.cwnd = Math.max(1, doubleToInt(this.cwnd * (1.0 - B)));
            this.windowLength = Math.imul(this.cwnd, this.mtu);
            this.windowIndicator.setRelease(this.windowLength);

            this.lastLossTimestampNs = nowNs;
        } else if (this.cwnd < this.maxCwnd && this.lastUpdateTimestampNs + this.windowUpdateTimeoutNs - nowNs < 0) {
            // W_cubic = C(T - K)^3 + w_max
            const durationSinceDecr = (nowNs - this.lastLossTimestampNs) / SECOND_IN_NS;
            const diffToK = durationSinceDecr - this.k;
            const incr = C * diffToK * diffToK * diffToK;

            this.cwnd = Math.min(this.maxCwnd, (this.w_max + doubleToInt(incr)) | 0);

            // if using TCP mode, then check to see if we are in the TCP region
            if (CubicCongestionControlConfiguration.TCP_MODE && this.cwnd < this.w_max) {
                // W_tcp(t) = w_max * (1 - B) + 3 * B / (2 - B) * t / RTT
                const rttInSeconds = this.rttNs / SECOND_IN_NS;
                const wTcp = this.w_max * (1.0 - B) + ((3.0 * B) / (2.0 - B)) * (durationSinceDecr / rttInSeconds);

                this.cwnd = Math.max(this.cwnd, doubleToInt(wTcp));
            }

            const windowLength = Math.imul(this.cwnd, this.mtu);
            if (windowLength !== this.windowLength) {
                this.windowLength = windowLength;
                this.windowIndicator.setRelease(windowLength);
            }

            this.lastUpdateTimestampNs = nowNs;
        } else if (1 === this.cwnd && newConsumptionPosition > lastSmPosition) {
            // force out an SM (and update of nextSmPosition) whenever the consumption position moves when
            // window is at minimum.
            forceStatusMessage = true;
        }

        return packOutcome(this.windowLength, forceStatusMessage);
    }

    /**
     * {@inheritDoc}
     */
    public initialWindowLength(): number {
        return this._initialWindowLength;
    }

    /**
     * {@inheritDoc}
     */
    public maxWindowLength(): number {
        return this._maxWindowLength;
    }

    /**
     * The maximum congestion window, in MTUs. Package private in Java; for tests.
     */
    public maxCongestionWindow(): number {
        return this.maxCwnd;
    }
}
