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
// Port of io/aeron/driver/media/WildcardPortManagerTest.java @ 1.53.3
import { describe, it } from 'vitest';
import { BindException, InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../../src/driver/media/WildcardPortManager.js';
import { assertIs, assertThrows } from '../../support/Assertions.js';

describe('WildcardPortManagerTest', () => {
    const portRange = [20000, 20003];
    const udpChannelPort0 = UdpChannel.parse('aeron:udp?endpoint=localhost:0');
    const udpChannelPubControl = UdpChannel.parse('aeron:udp?control=localhost:0|endpoint=localhost:9999');

    it('shouldAllocateConsecutivePortsInRange', () => {
        const manager = new WildcardPortManager(portRange, false);
        const bindAddress = new InetSocketAddress('localhost', 0);

        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 20000));
        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 20001));
        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 20002));
    });

    it('shouldPassThrough0WithNullRanges', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false);

        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 0));
    });

    it('shouldPassThrough0WithSenderPubWithoutControlAddress', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, true);

        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 0));
    });

    it('shouldPassThroughWithExplicitBindAddressOutSideRange', () => {
        const bindAddress = new InetSocketAddress('localhost', 1000);
        const manager = new WildcardPortManager(portRange, true);

        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 1000));
    });

    it('shouldPassThroughWithExplicitBindAddressInsideRange', () => {
        const bindAddress = new InetSocketAddress('localhost', 20003);
        const manager = new WildcardPortManager(portRange, true);

        assertIs(manager.getManagedPort(udpChannelPort0, bindAddress), new InetSocketAddress('localhost', 20003));
    });

    it('shouldAllocateForPubWithExplicitControlAddress', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, true);

        assertIs(manager.getManagedPort(udpChannelPubControl, bindAddress), new InetSocketAddress('localhost', 20000));
    });

    it('shouldThrowOnExhaustion', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, false);

        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        assertThrows(BindException, () => manager.getManagedPort(udpChannelPort0, bindAddress));
    });

    it('shouldAllocateOnCyclingThroughRange', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, false);

        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.freeManagedPort(new InetSocketAddress('localhost', 20000));
        assertIs(manager.getManagedPort(udpChannelPubControl, bindAddress), new InetSocketAddress('localhost', 20000));
    });

    it('shouldAllocateSkippingInUsePort', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, false);

        manager.getManagedPort(udpChannelPort0, bindAddress);
        manager.getManagedPort(udpChannelPort0, new InetSocketAddress('localhost', 20001));
        assertIs(manager.getManagedPort(udpChannelPubControl, bindAddress), new InetSocketAddress('localhost', 20002));
    });

    it('shouldAllocateSkippingInUseOnCycle', () => {
        const bindAddress = new InetSocketAddress('localhost', 0);
        const manager = new WildcardPortManager(portRange, false);

        manager.getManagedPort(udpChannelPort0, new InetSocketAddress('localhost', 20000));
        manager.getManagedPort(udpChannelPort0, new InetSocketAddress('localhost', 20001));
        manager.getManagedPort(udpChannelPort0, new InetSocketAddress('localhost', 20002));
        manager.freeManagedPort(new InetSocketAddress('localhost', 20002));
        manager.getManagedPort(udpChannelPort0, new InetSocketAddress('localhost', 20003));
        assertIs(manager.getManagedPort(udpChannelPubControl, bindAddress), new InetSocketAddress('localhost', 20002));
    });
});
