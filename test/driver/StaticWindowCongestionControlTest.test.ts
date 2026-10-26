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
// Port of io/aeron/driver/StaticWindowCongestionControlTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { StaticWindowCongestionControl } from '../../src/driver/StaticWindowCongestionControl.js';

describe('StaticWindowCongestionControlTest', () => {
    it('shouldSetWindowLengthFromChannel', () => {
        const channelWithWindow = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|rcv-wnd=8192');
        const context = new MediaDriver.Context().initialWindowLength(16536);
        const termLength = 1_000_000;

        const staticWindowCongestionControl = new StaticWindowCongestionControl(
            0,
            channelWithWindow,
            0,
            0,
            termLength,
            0,
            null,
            null,
            null,
            context,
            null,
        );

        expect(staticWindowCongestionControl.initialWindowLength()).toBe(8192);
    });

    it('shouldSetWindowLengthFromContext', () => {
        const channelWithoutWindow = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
        const context = new MediaDriver.Context().initialWindowLength(16536);
        const termLength = 1_000_000;

        const staticWindowCongestionControl = new StaticWindowCongestionControl(
            0,
            channelWithoutWindow,
            0,
            0,
            termLength,
            0,
            null,
            null,
            null,
            context,
            null,
        );

        expect(staticWindowCongestionControl.initialWindowLength()).toBe(16536);
    });

    it('shouldSetWindowLengthFromTermLength', () => {
        const channelWithWindow = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|rcv-wnd=8192');
        const context = new MediaDriver.Context().initialWindowLength(16536);
        const termLength = 8192;

        const staticWindowCongestionControl = new StaticWindowCongestionControl(
            0,
            channelWithWindow,
            0,
            0,
            termLength,
            0,
            null,
            null,
            null,
            context,
            null,
        );

        expect(staticWindowCongestionControl.initialWindowLength()).toBe(termLength / 2);
    });
});
