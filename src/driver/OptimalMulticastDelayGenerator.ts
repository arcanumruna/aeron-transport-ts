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
// Port of io/aeron/driver/OptimalMulticastDelayGenerator.java @ 1.53.3
import { ThreadLocalRandom } from '../agrona/jdk.js';
import { type FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';

/**
 * Generates a delay value as described by the paper "Optimal Multicast Feedback".
 */
export class OptimalMulticastDelayGenerator implements FeedbackDelayGenerator {
    private readonly randMax: number;
    private readonly baseX: number;
    private readonly constantT: number;
    private readonly factorT: number;

    /**
     * Create new feedback delay generator based on estimates. Pre-calculating some parameters upfront.
     *
     * @param maxBackoffT of the delay interval
     * @param groupSize   estimate
     */
    public constructor(maxBackoffT: number, groupSize: number) {
        const lambda = Math.log(groupSize) + 1;

        this.randMax = lambda / maxBackoffT;
        this.baseX = lambda / (maxBackoffT * (Math.exp(lambda) - 1));
        this.constantT = maxBackoffT / lambda;
        this.factorT = (Math.exp(lambda) - 1) * (maxBackoffT / lambda);
    }

    /**
     * {@inheritDoc}
     */
    public generateDelayNs(): number {
        return Math.trunc(this.generateNewOptimalDelay());
    }

    /**
     * {@inheritDoc}
     */
    public retryDelayNs(): number {
        return this.generateDelayNs();
    }

    /**
     * Generate a new randomized delay value in the units of {@code maxBackoffT}}.
     *
     * @return delay in units of {@code maxBackoffT}.
     */
    public generateNewOptimalDelay(): number {
        const x = OptimalMulticastDelayGenerator.uniformRandom(this.randMax) + this.baseX;

        return this.constantT * Math.log(x * this.factorT);
    }

    /**
     * Return uniform random value in the range 0 to max.
     *
     * @param max of the random range
     * @return random value
     */
    public static uniformRandom(max: number): number {
        return ThreadLocalRandom.current().nextDouble() * max;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return (
            'OptimalMulticastDelayGenerator{randMax=' +
            this.randMax +
            ', baseX=' +
            this.baseX +
            ', constantT=' +
            this.constantT +
            ', factorT=' +
            this.factorT +
            '}'
        );
    }
}
