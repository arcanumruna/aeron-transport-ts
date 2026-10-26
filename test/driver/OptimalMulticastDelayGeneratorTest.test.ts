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
// Port of io/aeron/driver/OptimalMulticastDelayGeneratorTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { TimeUnit } from '../../src/agrona/jdk.js';
import { OptimalMulticastDelayGenerator } from '../../src/driver/OptimalMulticastDelayGenerator.js';

const MAX_BACKOFF = TimeUnit.MILLISECONDS.toNanos(60);
const GROUP_SIZE = 10;

describe('OptimalMulticastDelayGeneratorTest', () => {
    it('shouldNotExceedTmaxBackoff', () => {
        const generator = new OptimalMulticastDelayGenerator(MAX_BACKOFF, GROUP_SIZE);

        for (let i = 0; i < 100_000; i++) {
            const delay = generator.generateNewOptimalDelay();
            expect(delay).toBeLessThanOrEqual(MAX_BACKOFF);
        }
    });
});
