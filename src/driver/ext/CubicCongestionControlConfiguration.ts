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
// Port of io/aeron/driver/ext/CubicCongestionControlConfiguration.java @ 1.53.3
import { TimeUnit } from '../../agrona/jdk.js';
import { System } from '../../agrona/jdkLang.js';
import { SystemUtil } from '../../agrona/SystemUtil.js';

/**
 * Configuration options for {@link CubicCongestionControl}.
 */
export class CubicCongestionControlConfiguration {
    private constructor() {}

    /**
     * Property name for measuring RTT or using static constant based on initial value.
     *
     * @see CubicCongestionControlConfiguration#INITIAL_RTT_NS_PROP_NAME
     */
    public static readonly MEASURE_RTT_PROP_NAME = 'aeron.CubicCongestionControl.measureRtt';

    /**
     * Property name for initial RTT measurement in nanoseconds.
     */
    public static readonly INITIAL_RTT_NS_PROP_NAME = 'aeron.CubicCongestionControl.initialRtt';

    /**
     * Default initial RTT measurement in nanoseconds.
     */
    public static readonly INITIAL_RTT_NS_DEFAULT: number = TimeUnit.MICROSECONDS.toNanos(100);

    /**
     * Property name for accounting for TCP behavior in low RTT values after a loss.
     * <p>
     * <b>WARNING:</b> Be aware that throughput utilization becomes important. Turning this on can result in being
     * drastically be off the necessary throughput if utilization is low.
     */
    public static readonly TCP_MODE_PROP_NAME = 'aeron.CubicCongestionControl.tcpMode';

    /**
     * Should RTT be measured. Default is false.
     * @see #MEASURE_RTT_PROP_NAME
     */
    public static readonly MEASURE_RTT: boolean =
        'true' === System.getProperty(CubicCongestionControlConfiguration.MEASURE_RTT_PROP_NAME);

    /**
     * Setting to be used for the initial RTT time when not measuring.
     * @see #INITIAL_RTT_NS_PROP_NAME
     */
    public static readonly INITIAL_RTT_NS: number = SystemUtil.getDurationInNanos(
        CubicCongestionControlConfiguration.INITIAL_RTT_NS_PROP_NAME,
        CubicCongestionControlConfiguration.INITIAL_RTT_NS_DEFAULT,
    );

    /**
     * Should TCP behaviour mode be on or off. Default is false (off).
     * @see #TCP_MODE_PROP_NAME
     */
    public static readonly TCP_MODE: boolean =
        'true' === System.getProperty(CubicCongestionControlConfiguration.TCP_MODE_PROP_NAME);
}
