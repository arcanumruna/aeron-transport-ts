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
// Port of io/aeron/driver/ext/CubicCongestionControlTest.java @ 1.53.3
import { beforeEach, describe, expect, it } from 'vitest';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CubicCongestionControl } from '../../../src/driver/ext/CubicCongestionControl.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';

const CONTEXT_RECEIVER_WINDOW_LENGTH = 65536;
const CHANNEL_RECEIVER_WINDOW_LENGTH = 8192;
const MTU_LENGTH = 1024;

describe('CubicCongestionControlTest', () => {
    const tempBuffer = new UnsafeBuffer(new Uint8Array(8192));
    const context = new MediaDriver.Context()
        .initialWindowLength(CONTEXT_RECEIVER_WINDOW_LENGTH)
        .tempBuffer(tempBuffer);
    const channelWithWindow = UdpChannel.parse(
        'aeron:udp?endpoint=127.0.0.1:9999|rcv-wnd=' + CHANNEL_RECEIVER_WINDOW_LENGTH,
    );
    const channelWithoutWindow = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
    const bigTermLength = 1_000_000;
    const nanoClock = new CachedNanoClock();
    let countersManager: CountersManager;

    beforeEach(() => {
        // the Java test mocks the CountersManager and returns an 8192 byte values buffer
        countersManager = new CountersManager(
            new UnsafeBuffer(new Uint8Array((8192 / CountersReader.COUNTER_LENGTH) * CountersReader.METADATA_LENGTH)),
            new UnsafeBuffer(new Uint8Array(8192)),
        );
    });

    it('shouldSetWindowLengthFromChannel', () => {
        const cubicCongestionControl = new CubicCongestionControl(
            0,
            channelWithWindow,
            0,
            0,
            bigTermLength,
            MTU_LENGTH,
            null,
            null,
            nanoClock,
            context,
            countersManager,
        );

        expect(cubicCongestionControl.maxCongestionWindow()).toBe(CHANNEL_RECEIVER_WINDOW_LENGTH / MTU_LENGTH);
    });

    it('shouldSetWindowLengthFromContext', () => {
        const cubicCongestionControl = new CubicCongestionControl(
            0,
            channelWithoutWindow,
            0,
            0,
            bigTermLength,
            MTU_LENGTH,
            null,
            null,
            nanoClock,
            context,
            countersManager,
        );

        expect(cubicCongestionControl.maxCongestionWindow()).toBe(CONTEXT_RECEIVER_WINDOW_LENGTH / MTU_LENGTH);
    });

    it('shouldSetWindowLengthFromTermLength', () => {
        const smallTermLength = 8192;
        const cubicCongestionControl = new CubicCongestionControl(
            0,
            channelWithWindow,
            0,
            0,
            smallTermLength,
            MTU_LENGTH,
            null,
            null,
            nanoClock,
            context,
            countersManager,
        );

        expect(cubicCongestionControl.maxCongestionWindow()).toBe(smallTermLength / 2 / MTU_LENGTH);
    });
});
