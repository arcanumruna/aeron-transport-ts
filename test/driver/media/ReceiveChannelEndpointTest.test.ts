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
// Port of io/aeron/driver/media/ReceiveChannelEndpointTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedNanoClock } from '../../../src/agrona/concurrent/CachedNanoClock.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { DataPacketDispatcher } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../../src/driver/media/WildcardPortManager.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { type Fake, calledMembers, mock } from '../../support/Mockito.js';

describe('ReceiveChannelEndpointTest', () => {
    const systemCounters = mock(SystemCounters).mock;
    const statusIndicator = mock(AtomicCounter).mock;
    const udpChannel = mock(UdpChannel).mock;
    const nanoClock = new CachedNanoClock();
    // mock(DataPacketDispatcher.class): the placeholder type of ReceiveChannelEndpoint.ts (T14 ports the class)
    const dataPacketDispatcher: Fake<DataPacketDispatcher> = {
        onDataPacket: vi.fn<DataPacketDispatcher['onDataPacket']>(),
        onSetupMessage: vi.fn<DataPacketDispatcher['onSetupMessage']>(),
        onRttMeasurement: vi.fn<DataPacketDispatcher['onRttMeasurement']>(),
    };
    const context = new MediaDriver.Context()
        .systemCounters(systemCounters)
        .cachedNanoClock(nanoClock)
        .senderCachedNanoClock(nanoClock)
        .receiverCachedNanoClock(nanoClock)
        .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
        .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
        .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));
    let endpoint: ReceiveChannelEndpoint;
    const counters: AtomicCounter[] = [];

    beforeEach(() => {
        for (const spy of Object.values(dataPacketDispatcher)) {
            spy.mockClear();
        }
        for (const descriptor of SystemCounterDescriptor.values()) {
            counters[descriptor.id()] = mock(AtomicCounter).mock;
        }
        vi.mocked(systemCounters.get).mockReset();
        vi.mocked(systemCounters.get).mockImplementation(
            (descriptor: SystemCounterDescriptor) => counters[descriptor.id()] as AtomicCounter,
        );

        // a Mockito mock answers null for a method that returns a `Long`, and false and null for the others
        vi.mocked(udpChannel.groupTag).mockReturnValue(null);
        vi.mocked(udpChannel.isManualControlMode).mockReturnValue(false);
        vi.mocked(udpChannel.isChannelReceiveTimestampEnabled).mockReturnValue(false);
        vi.mocked(udpChannel.remoteData).mockReturnValue(null as unknown as InetSocketAddress);
        vi.mocked(udpChannel.localControl).mockReturnValue(null as unknown as InetSocketAddress);

        endpoint = new ReceiveChannelEndpoint(udpChannel, dataPacketDispatcher, statusIndicator, context);
    });

    it('shouldRejectInvalidSetupMessage', () => {
        const setupFlyweight = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH)));
        setupFlyweight.mtuLength(111).termOffset(-5);

        endpoint.onSetupMessage(
            setupFlyweight,
            setupFlyweight,
            SetupFlyweight.HEADER_LENGTH,
            mock(InetSocketAddress).mock,
            0,
        );

        const invalidPackets = systemCounters.get(SystemCounterDescriptor.INVALID_PACKETS);
        expect(invalidPackets.increment).toHaveBeenCalledTimes(1);
        // verifyNoMoreInteractions(invalidPackets)
        expect(calledMembers(invalidPackets)).toEqual(['increment']);
        // verifyNoInteractions(dataPacketDispatcher)
        for (const spy of Object.values(dataPacketDispatcher)) {
            expect(spy).not.toHaveBeenCalled();
        }
    });

    it('shouldAcceptValidSetupMessage', () => {
        const srcAddress = mock(InetSocketAddress).mock;
        const transportIndex = 7;
        const setupFlyweight = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(SetupFlyweight.HEADER_LENGTH)));
        setupFlyweight
            .termOffset(0)
            .mtuLength(2048)
            .termLength(64 * 1024);

        endpoint.onSetupMessage(
            setupFlyweight,
            setupFlyweight,
            SetupFlyweight.HEADER_LENGTH,
            srcAddress,
            transportIndex,
        );

        const invalidPackets = systemCounters.get(SystemCounterDescriptor.INVALID_PACKETS);
        expect(dataPacketDispatcher.onSetupMessage).toHaveBeenCalledTimes(1);
        expect(dataPacketDispatcher.onSetupMessage).toHaveBeenCalledWith(
            endpoint,
            setupFlyweight,
            srcAddress,
            transportIndex,
        );
        // verifyNoMoreInteractions(invalidPackets); verifyNoInteractions(invalidPackets)
        expect(calledMembers(invalidPackets)).toEqual([]);
    });
});
