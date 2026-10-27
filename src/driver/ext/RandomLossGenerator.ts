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
// Port of io/aeron/driver/ext/RandomLossGenerator.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { Random } from '../../agrona/jdkRandom.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { LossGenerator } from './LossGenerator.js';

/**
 * Random loss generator for testing loss of data frames.
 */
export class RandomLossGenerator implements LossGenerator {
    private readonly lossRate: number = 0;
    private readonly random: Random;

    /**
     * Construct loss generator with given loss rate as percentage, and random seed. The two Java constructors are one
     * with a default seed of -1.
     *
     * @param lossRate for generating loss.
     * @param lossSeed for random seeding; -1, the default, seeds from the clock.
     */
    public constructor(lossRate: number, lossSeed = -1) {
        this.random = -1 === lossSeed ? new Random() : new Random(lossSeed);
        this.lossRate = lossRate;
    }

    /**
     * {@inheritDoc}
     */
    public shouldDropFrame(address: InetSocketAddress | null, buffer: UnsafeBuffer | null, length: number): boolean;
    public shouldDropFrame(
        address: InetSocketAddress | null,
        buffer: UnsafeBuffer | null,
        streamId: number,
        sessionId: number,
        termId: number,
        termOffset: number,
        length: number,
    ): boolean;
    public shouldDropFrame(
        _address: InetSocketAddress | null,
        _buffer: UnsafeBuffer | null,
        _length: number,
        _sessionId?: number,
        _termId?: number,
        _termOffset?: number,
        _frameLength?: number,
    ): boolean {
        // the long form is Java's default method, which delegates to the short one (spec D62)
        return this.random.nextDouble() <= this.lossRate;
    }
}
