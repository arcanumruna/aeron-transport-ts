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
// Port of io/aeron/driver/StaticDelayGenerator.java @ 1.53.3
import { type FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';

/**
 * Delay generator that uses a static delay.
 */
export class StaticDelayGenerator implements FeedbackDelayGenerator {
    /**
     * {@link StaticDelayGenerator} instance with zero delay.
     */
    public static readonly ZERO_DELAY_GENERATOR: StaticDelayGenerator = new StaticDelayGenerator(0);

    private readonly delayInNs: number = 0;
    private readonly _retryDelayNs: number = 0;

    /**
     * Create a delayInNs generator that uses the specified delayNs. The three Java constructors are one:
     * `(delayNs, retryDelayNs)`, `(delayNs)` for both the initial and the retry delay, and the deprecated
     * `(delayNs, immediateFeedback)` whose `boolean` is ignored.
     *
     * @param delayNs                         initial delay (nanoseconds)
     * @param retryDelayNsOrImmediateFeedback delay for retry (nanoseconds); a `boolean` (unused) or omitted means the
     *                                        same as `delayNs`.
     */
    public constructor(delayNs: number, retryDelayNsOrImmediateFeedback?: number | boolean) {
        this.delayInNs = delayNs;
        this._retryDelayNs =
            'number' === typeof retryDelayNsOrImmediateFeedback ? retryDelayNsOrImmediateFeedback : delayNs;
    }

    /**
     * {@inheritDoc}
     */
    public generateDelayNs(): number {
        return this.delayInNs;
    }

    /**
     * {@inheritDoc}
     */
    public retryDelayNs(): number {
        return this._retryDelayNs;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return 'StaticDelayGenerator{delayInNs=' + this.delayInNs + ', retryDelayNs=' + this._retryDelayNs + '}';
    }
}
