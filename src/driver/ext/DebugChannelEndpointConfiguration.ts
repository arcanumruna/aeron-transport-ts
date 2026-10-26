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
// Port of io/aeron/driver/ext/DebugChannelEndpointConfiguration.java @ 1.53.3
import { Long, NumberFormatException } from '../../agrona/jdk.js';
import { System } from '../../agrona/jdkLang.js';
import type { LossGenerator } from './LossGenerator.js';
import { RandomLossGenerator } from './RandomLossGenerator.js';

/** `Double.parseDouble(String)` for the decimal and exponent forms that a loss rate is written in. */
function parseDouble(value: string): number {
    const trimmed = value.trim();
    const result = Number(trimmed);
    if ('' === trimmed || Number.isNaN(result)) {
        throw new NumberFormatException('' === trimmed ? 'empty String' : 'For input string: "' + value + '"');
    }

    return result;
}

/** The generator of a rate of 0, Java's lambda `(address, buffer, length) -> false`. */
const NO_LOSS: LossGenerator = {
    shouldDropFrame(): boolean {
        return false;
    },
};

/**
 * Configuration options for the debug channel endpoints.
 */
export class DebugChannelEndpointConfiguration {
    private constructor() {}

    /**
     * Property name for receiver inbound data loss rate.
     */
    public static readonly RECEIVE_DATA_LOSS_RATE_PROP_NAME = 'aeron.debug.receive.data.loss.rate';

    /**
     * Property name for receiver inbound data loss seed.
     */
    public static readonly RECEIVE_DATA_LOSS_SEED_PROP_NAME = 'aeron.debug.receive.data.loss.seed';

    /**
     * Property name for receiver outbound control loss rate.
     */
    public static readonly RECEIVE_CONTROL_LOSS_RATE_PROP_NAME = 'aeron.debug.receive.control.loss.rate';

    /**
     * Property name for receiver outbound control loss seed.
     */
    public static readonly RECEIVE_CONTROL_LOSS_SEED_PROP_NAME = 'aeron.debug.receive.control.loss.seed';

    /**
     * Property name for sender outbound data loss rate.
     */
    public static readonly SEND_DATA_LOSS_RATE_PROP_NAME = 'aeron.debug.send.data.loss.rate';

    /**
     * Property name for sender outbound data loss seed.
     */
    public static readonly SEND_DATA_LOSS_SEED_PROP_NAME = 'aeron.debug.send.data.loss.seed';

    /**
     * Property name for sender inbound control loss rate.
     */
    public static readonly SEND_CONTROL_LOSS_RATE_PROP_NAME = 'aeron.debug.send.control.loss.rate';

    /**
     * Property name for sender inbound control loss seed.
     */
    public static readonly SEND_CONTROL_LOSS_SEED_PROP_NAME = 'aeron.debug.send.control.loss.seed';

    // Read once, when the module loads, as Java's static finals are (spec D22).
    private static readonly RECEIVE_DATA_LOSS_SEED: number = Long.getLong(
        DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_SEED_PROP_NAME,
        -1,
    );
    private static readonly RECEIVE_DATA_LOSS_RATE: number = parseDouble(
        System.getProperty(DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_RATE_PROP_NAME, '0.0'),
    );
    private static readonly RECEIVE_CONTROL_LOSS_SEED: number = Long.getLong(
        DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_SEED_PROP_NAME,
        -1,
    );
    private static readonly RECEIVE_CONTROL_LOSS_RATE: number = parseDouble(
        System.getProperty(DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_RATE_PROP_NAME, '0.0'),
    );
    private static readonly SEND_DATA_LOSS_SEED: number = Long.getLong(
        DebugChannelEndpointConfiguration.SEND_DATA_LOSS_SEED_PROP_NAME,
        -1,
    );
    private static readonly SEND_DATA_LOSS_RATE: number = parseDouble(
        System.getProperty(DebugChannelEndpointConfiguration.SEND_DATA_LOSS_RATE_PROP_NAME, '0.0'),
    );
    private static readonly SEND_CONTROL_LOSS_SEED: number = Long.getLong(
        DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_SEED_PROP_NAME,
        -1,
    );
    private static readonly SEND_CONTROL_LOSS_RATE: number = parseDouble(
        System.getProperty(DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_RATE_PROP_NAME, '0.0'),
    );

    /**
     * Supplier of {@link LossGenerator}s with provided loss rate and seed for randomisation.
     *
     * @param lossRate to generate at.
     * @param lossSeed to initialise.
     * @return a {@link LossGenerator}s with provided loss rate and seed.
     */
    public static lossGeneratorSupplier(lossRate: number, lossSeed: number): LossGenerator {
        if (0 === lossRate) {
            return NO_LOSS;
        }

        return new RandomLossGenerator(lossRate, lossSeed);
    }

    /**
     * The supplier of {@link LossGenerator}s for the receiving end of a data stream.
     *
     * @return the supplier of {@link LossGenerator}s for the receiving end of a data stream.
     */
    public static receiveDataLossGeneratorSupplier(): LossGenerator {
        return DebugChannelEndpointConfiguration.lossGeneratorSupplier(
            DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_RATE,
            DebugChannelEndpointConfiguration.RECEIVE_DATA_LOSS_SEED,
        );
    }

    /**
     * The supplier of {@link LossGenerator}s for the receiving end of a control stream.
     *
     * @return the supplier of {@link LossGenerator}s for the receiving end of a control stream.
     */
    public static receiveControlLossGeneratorSupplier(): LossGenerator {
        return DebugChannelEndpointConfiguration.lossGeneratorSupplier(
            DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_RATE,
            DebugChannelEndpointConfiguration.RECEIVE_CONTROL_LOSS_SEED,
        );
    }

    /**
     * The supplier of {@link LossGenerator}s for the send end of a data stream.
     *
     * @return the supplier of {@link LossGenerator}s for the send end of a data stream.
     */
    public static sendDataLossGeneratorSupplier(): LossGenerator {
        return DebugChannelEndpointConfiguration.lossGeneratorSupplier(
            DebugChannelEndpointConfiguration.SEND_DATA_LOSS_RATE,
            DebugChannelEndpointConfiguration.SEND_DATA_LOSS_SEED,
        );
    }

    /**
     * The supplier of {@link LossGenerator}s for the send end of a control stream.
     *
     * @return the supplier of {@link LossGenerator}s for the send end of a control stream.
     */
    public static sendControlLossGeneratorSupplier(): LossGenerator {
        return DebugChannelEndpointConfiguration.lossGeneratorSupplier(
            DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_RATE,
            DebugChannelEndpointConfiguration.SEND_CONTROL_LOSS_SEED,
        );
    }
}
