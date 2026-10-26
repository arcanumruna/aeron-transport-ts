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
// Port of io/aeron/SubscriptionTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { ControlledFragmentHandler } from '../../src/client/logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { Aeron } from '../../src/client/Aeron.js';
import type { AvailableImageHandler } from '../../src/client/AvailableImageHandler.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { Image } from '../../src/client/Image.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { ChannelEndpointStatus } from '../../src/client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../src/client/status/LocalSocketAddressStatus.js';
import { Subscription } from '../../src/client/Subscription.js';
import type { UnavailableImageHandler } from '../../src/client/UnavailableImageHandler.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { asConductor, newFakeSubscriptionConductor } from '../support/ClientFakes.js';
import type { FakeSubscriptionConductor } from '../support/ClientFakes.js';
import { expectInOrder } from '../support/InOrder.js';
import { mock } from '../support/Mockito.js';

const { NULL_VALUE } = Aeron;
const { ACTIVE, CLOSING, ERRORED, INITIALIZING } = ChannelEndpointStatus;

const CHANNEL = 'aeron:udp?endpoint=localhost:40124';
const STREAM_ID_1 = 1002;
const INITIAL_TERM_ID = 7;
const SUBSCRIPTION_CORRELATION_ID = 100;
const REGISTRATION_ID = 10;
const READ_BUFFER_CAPACITY = 1024;
const FRAGMENT_COUNT_LIMIT = 0x7fffffff;
const HEADER_LENGTH = DataHeaderFlyweight.HEADER_LENGTH;

/** `Tests.newCountersManager(dataLength)` of aeron-test-support. */
function newCountersManager(dataLength: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(Configuration.countersMetadataBufferLength(dataLength))),
        new UnsafeBuffer(new ArrayBuffer(dataLength)),
    );
}

describe('SubscriptionTest', () => {
    let atomicReadBuffer: UnsafeBuffer;
    let conductor: FakeSubscriptionConductor;
    let fragmentHandler: { onFragment: Mock<FragmentHandler['onFragment']> };
    let imageOneMock: Image;
    let imageTwoMock: Image;
    let header: Header;
    let availableImageHandlerMock: { onAvailableImage: Mock<AvailableImageHandler['onAvailableImage']> };
    let unavailableImageHandlerMock: { onUnavailableImage: Mock<UnavailableImageHandler['onUnavailableImage']> };
    let tempBuffer: UnsafeBuffer;
    let countersManager: CountersManager;
    let subscription: Subscription;

    /** `when(imageMock.poll(any(), anyInt())).then(invocation -> 1)` and the rest of the mocks of `Image`. */
    const spy = <K extends keyof Image>(image: Image, name: K): Mock<(...args: never[]) => unknown> =>
        image[name] as unknown as Mock<(...args: never[]) => unknown>;

    beforeEach(() => {
        atomicReadBuffer = new UnsafeBuffer(new ArrayBuffer(READ_BUFFER_CAPACITY));
        conductor = newFakeSubscriptionConductor();
        fragmentHandler = { onFragment: vi.fn() };
        imageOneMock = mock(Image).mock;
        imageTwoMock = mock(Image).mock;
        header = new Header(
            INITIAL_TERM_ID,
            LogBufferDescriptor.positionBitsToShift(LogBufferDescriptor.TERM_MIN_LENGTH),
        );
        availableImageHandlerMock = { onAvailableImage: vi.fn() };
        unavailableImageHandlerMock = { onUnavailableImage: vi.fn() };
        tempBuffer = new UnsafeBuffer(new ArrayBuffer(1024));
        countersManager = newCountersManager(16 * 1024);

        spy(imageOneMock, 'correlationId').mockReturnValue(1);
        spy(imageTwoMock, 'correlationId').mockReturnValue(2);

        conductor.countersReader.mockReturnValue(countersManager);

        subscription = new Subscription(
            asConductor(conductor),
            CHANNEL,
            STREAM_ID_1,
            SUBSCRIPTION_CORRELATION_ID,
            availableImageHandlerMock,
            unavailableImageHandlerMock,
        );

        conductor.removeSubscription.mockImplementation((s) => {
            if (s === subscription) {
                subscription.internalClose(NULL_VALUE);
            }
        });
    });

    function newSubscription(channel: string): Subscription {
        return new Subscription(
            asConductor(conductor),
            channel,
            STREAM_ID_1,
            SUBSCRIPTION_CORRELATION_ID,
            availableImageHandlerMock,
            unavailableImageHandlerMock,
        );
    }

    function allocateAddressCounter(address: string, channelStatusId: number, status: number): void {
        const counter = LocalSocketAddressStatus.allocate(
            tempBuffer,
            countersManager,
            REGISTRATION_ID,
            channelStatusId,
            'test',
            LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID,
        );

        LocalSocketAddressStatus.updateBindAddress(counter, address, countersManager.metaDataBuffer() as UnsafeBuffer);
        counter.setRelease(status);
    }

    it('shouldEnsureTheSubscriptionIsOpenWhenPolling', () => {
        subscription.close();
        expect(subscription.isClosed()).toBe(true);

        expect(conductor.removeSubscription).toHaveBeenCalledTimes(1);
        expect(conductor.removeSubscription).toHaveBeenCalledWith(subscription);
    });

    it('shouldReadNothingWhenNoImages', () => {
        expect(subscription.poll(fragmentHandler, 1)).toBe(0);
    });

    it('shouldReadNothingWhenThereIsNoData', () => {
        subscription.addImage(imageOneMock);
        // a Mockito mock answers 0 for an `int` method it was not told about
        vi.mocked(imageOneMock.poll).mockReturnValue(0);

        expect(subscription.poll(fragmentHandler, 1)).toBe(0);
    });

    it('shouldReadData', () => {
        subscription.addImage(imageOneMock);

        vi.mocked(imageOneMock.poll).mockImplementation((handler) => {
            handler.onFragment(atomicReadBuffer, HEADER_LENGTH, READ_BUFFER_CAPACITY - HEADER_LENGTH, header);

            return 1;
        });

        expect(subscription.poll(fragmentHandler, FRAGMENT_COUNT_LIMIT)).toBe(1);
        expect(fragmentHandler.onFragment).toHaveBeenCalledTimes(1);
        expect(fragmentHandler.onFragment).toHaveBeenCalledWith(
            atomicReadBuffer,
            HEADER_LENGTH,
            READ_BUFFER_CAPACITY - HEADER_LENGTH,
            expect.any(Header),
        );
    });

    it('shouldReadDataFromMultipleSources', () => {
        subscription.addImage(imageOneMock);
        subscription.addImage(imageTwoMock);

        vi.mocked(imageOneMock.poll).mockImplementation((handler) => {
            handler.onFragment(atomicReadBuffer, HEADER_LENGTH, READ_BUFFER_CAPACITY - HEADER_LENGTH, header);

            return 1;
        });

        vi.mocked(imageTwoMock.poll).mockImplementation((handler) => {
            handler.onFragment(atomicReadBuffer, HEADER_LENGTH, READ_BUFFER_CAPACITY - HEADER_LENGTH, header);

            return 1;
        });

        expect(subscription.poll(fragmentHandler, FRAGMENT_COUNT_LIMIT)).toBe(2);
    });

    it('shouldRoundRobinStartingImageWhenPollingWithExhaustedFragmentLimit', () => {
        subscription.addImage(imageOneMock);
        subscription.addImage(imageTwoMock);

        vi.mocked(imageOneMock.poll).mockImplementation(() => 1);
        vi.mocked(imageTwoMock.poll).mockImplementation(() => 1);

        for (let i = 0; i < 6; i++) {
            expect(subscription.poll(fragmentHandler, 1)).toBe(1);
        }

        // InOrder.verify(imageOneMock).poll(), (imageTwoMock).poll(), ... each verified once, in this order
        const one = vi.mocked(imageOneMock.poll).mock;
        const two = vi.mocked(imageTwoMock.poll).mock;
        expect(one.calls).toHaveLength(3);
        expect(two.calls).toHaveLength(3);
        expectInOrder(
            [vi.mocked(imageOneMock.poll), 0],
            [vi.mocked(imageTwoMock.poll), 0],
            [vi.mocked(imageOneMock.poll), 1],
            [vi.mocked(imageTwoMock.poll), 1],
            [vi.mocked(imageOneMock.poll), 2],
            [vi.mocked(imageTwoMock.poll), 2],
        );
    });

    it('shouldRoundRobinStartingImageWhenControlledPollingWithExhaustedFragmentLimit', () => {
        const controlledFragmentHandler: ControlledFragmentHandler = { onFragment: vi.fn() };
        subscription.addImage(imageOneMock);
        subscription.addImage(imageTwoMock);

        vi.mocked(imageOneMock.controlledPoll).mockImplementation(() => 1);
        vi.mocked(imageTwoMock.controlledPoll).mockImplementation(() => 1);

        for (let i = 0; i < 6; i++) {
            expect(subscription.controlledPoll(controlledFragmentHandler, 1)).toBe(1);
        }

        const one = vi.mocked(imageOneMock.controlledPoll);
        const two = vi.mocked(imageTwoMock.controlledPoll);
        expect(one.mock.calls).toHaveLength(3);
        expect(two.mock.calls).toHaveLength(3);
        expectInOrder([one, 0], [two, 0], [one, 1], [two, 1], [one, 2], [two, 2]);
    });

    it.each([INITIALIZING, ERRORED, CLOSING])(
        'tryResolveChannelEndpointPortReturnsNullIfChannelStatusIsNotActive %s',
        (channelStatus) => {
            const channelStatusId = 555;
            const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
            subscription = newSubscription(channel);
            subscription.channelStatusId(channelStatusId);
            conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? channelStatus : 0));

            expect(subscription.tryResolveChannelEndpointPort()).toBeNull();
        },
    );

    it('tryResolveChannelEndpointPortReturnsOriginalChannelIfNoAddressesFound', () => {
        const channelStatusId = 123;
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ACTIVE : 0));

        expect(subscription.tryResolveChannelEndpointPort()).toBe(CHANNEL);
    });

    it('tryResolveChannelEndpointPortReturnsChannelWithResolvedPort', () => {
        const channelStatusId = 444;
        const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
        subscription = newSubscription(channel);
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ACTIVE : 0));

        allocateAddressCounter('localhost:21212', channelStatusId, ERRORED);
        allocateAddressCounter('127.0.0.1:19091', channelStatusId, ACTIVE);

        const channelWithResolvedEndpoint = subscription.tryResolveChannelEndpointPort() as string;

        expect(
            ChannelUri.parse('aeron:udp?endpoint=localhost:19091|interface=192.168.5.0/24|reliable=false').equals(
                ChannelUri.parse(channelWithResolvedEndpoint),
            ),
        ).toBe(true);

        expect(subscription.tryResolveChannelEndpointPort()).toBe(channelWithResolvedEndpoint);
    });

    it('tryResolveChannelEndpointPortReturnsNullIfChannelStatusIsActiveButThereAreNoActiveBindAddresses', () => {
        const channelStatusId = 444;
        const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
        subscription = newSubscription(channel);
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ACTIVE : 0));

        allocateAddressCounter('localhost:21212', channelStatusId, ERRORED);

        expect(subscription.tryResolveChannelEndpointPort()).toBeNull();
    });

    it.each([
        'aeron:ipc',
        'aeron:udp?control-mode=response|control=localhost:5555',
        'aeron:udp?endpoint=localhost:8888',
        'aeron:udp?control-mode=manual|endpoint=localhost:0',
        'aeron:udp?control-mode=dynamic|control=localhost:7777',
    ])('tryResolveChannelEndpointPortReturnsOriginalUriIfEndpointDoesNotNeedResolving %s', (channel) => {
        const channelStatusId = 777;
        subscription = newSubscription(channel);
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ERRORED : 0));

        expect(subscription.tryResolveChannelEndpointPort()).toBe(channel);

        // subsequent calls return the same result
        expect(subscription.tryResolveChannelEndpointPort()).toBe(channel);
    });

    it.each([INITIALIZING, ERRORED, CLOSING])(
        'resolvedEndpointReturnsNullIfChannelStatusIsNotActive %s',
        (channelStatus) => {
            const channelStatusId = 555;
            const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
            subscription = newSubscription(channel);
            subscription.channelStatusId(channelStatusId);
            conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? channelStatus : 0));

            allocateAddressCounter('127.0.0.1:19091', channelStatusId, ACTIVE);

            expect(subscription.resolvedEndpoint()).toBeNull();
        },
    );

    it('resolvedEndpointReturnsNullIfChannelStatusIsActiveButThereIsNoActiveBindAddress', () => {
        const channelStatusId = 555;
        const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
        subscription = newSubscription(channel);
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ACTIVE : 0));

        allocateAddressCounter('127.0.0.1:19091', channelStatusId, CLOSING);

        expect(subscription.resolvedEndpoint()).toBeNull();
    });

    it('resolvedEndpointReturnsFirstFoundActiveAddress', () => {
        const channelStatusId = 555;
        const channel = 'aeron:udp?endpoint=localhost:0|interface=192.168.5.0/24|reliable=false';
        subscription = newSubscription(channel);
        subscription.channelStatusId(channelStatusId);
        conductor.channelStatus.mockImplementation((id) => (id === channelStatusId ? ACTIVE : 0));

        allocateAddressCounter('127.0.0.1:5555', channelStatusId, ACTIVE);
        allocateAddressCounter('127.0.0.1:19091', channelStatusId, CLOSING);
        allocateAddressCounter('localhost:12122', channelStatusId, ACTIVE);

        const resolvedEndpoint = subscription.resolvedEndpoint();
        expect(resolvedEndpoint).toBe('127.0.0.1:5555');

        expect(subscription.resolvedEndpoint()).toBe(resolvedEndpoint);
    });

    it('shouldAcceptBrokenChannelUriAtCreationTime', () => {
        const channel = 'broken uri';
        subscription = newSubscription(channel);

        expect(subscription.channel()).toBe(channel);
    });
});
