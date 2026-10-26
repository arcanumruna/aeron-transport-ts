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
// Port of io/aeron/driver/DataPacketDispatcherTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import type { PublicationImage, Receiver } from '../../src/driver/DataPacketDispatcher.js';
import { DataPacketDispatcher, SessionState } from '../../src/driver/DataPacketDispatcher.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import type { DriverConductorProxy } from '../../src/driver/media/SendChannelEndpoint.js';
import { expectInOrder } from '../support/InOrder.js';
import { type Fake, calledMembers, mock } from '../support/Mockito.js';

const { ON_COOL_DOWN, PENDING_SETUP_FRAME } = SessionState;

const CORRELATION_ID_1 = 101;
const CORRELATION_ID_2 = 102;
const STREAM_ID = 1010;
const INITIAL_TERM_ID = 3;
const ACTIVE_TERM_ID = 3;
const SESSION_ID = 1;
const TERM_OFFSET = 0;
const LENGTH = DataHeaderFlyweight.HEADER_LENGTH + 100;
const MTU_LENGTH = 1024;
const TERM_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const SRC_ADDRESS = new InetSocketAddress('localhost', 4510);
const STREAM_SESSION_LIMIT = 10;

/** `mock(PublicationImage.class)`: a hand fake of the placeholder type of `DataPacketDispatcher.ts` (T16 ports the class). */
function mockPublicationImage(): Fake<PublicationImage> {
    return {
        sessionId: vi.fn<PublicationImage['sessionId']>(() => 0),
        streamId: vi.fn<PublicationImage['streamId']>(() => 0),
        correlationId: vi.fn<PublicationImage['correlationId']>(() => 0),
        isEndOfStream: vi.fn<PublicationImage['isEndOfStream']>(() => false),
        activate: vi.fn<PublicationImage['activate']>(),
        deactivate: vi.fn<PublicationImage['deactivate']>(),
        insertPacket: vi.fn<PublicationImage['insertPacket']>(() => 0),
        addDestinationConnectionIfUnknown: vi.fn<PublicationImage['addDestinationConnectionIfUnknown']>(),
        onRttMeasurement: vi.fn<PublicationImage['onRttMeasurement']>(),
    };
}

/** `when(mock.method()).thenReturn(value)` for a method with overloads (a getter and a fluent setter). */
function stub(method: unknown, value: unknown): void {
    (method as Mock<() => unknown>).mockReturnValue(value);
}

describe('DataPacketDispatcherTest', () => {
    // JUnit makes a new instance of the test class for each test: the mocks and the dispatcher are made in beforeEach.
    let mockConductorProxy: Fake<DriverConductorProxy>;
    let mockReceiver: Fake<Receiver>;
    let dispatcher: DataPacketDispatcher;
    let mockHeader: DataHeaderFlyweight;
    let mockSetupHeader: SetupFlyweight;
    let mockBuffer: UnsafeBuffer;
    let mockImage: Fake<PublicationImage>;
    let mockChannelEndpoint: ReceiveChannelEndpoint;
    let sendSetupElicitingStatusMessage: Mock<ReceiveChannelEndpoint['sendSetupElicitingStatusMessage']>;

    beforeEach(() => {
        // mock(DriverConductorProxy.class) and mock(Receiver.class): hand fakes of the placeholder types
        mockConductorProxy = {
            reResolveEndpoint: vi.fn<DriverConductorProxy['reResolveEndpoint']>(),
            reResolveControl: vi.fn<DriverConductorProxy['reResolveControl']>(),
            responseSetup: vi.fn<DriverConductorProxy['responseSetup']>(),
            createPublicationImage: vi.fn<DriverConductorProxy['createPublicationImage']>(),
        };
        mockReceiver = {
            addPendingSetupMessage: vi.fn<Receiver['addPendingSetupMessage']>(),
        };
        dispatcher = new DataPacketDispatcher(mockConductorProxy, mockReceiver, STREAM_SESSION_LIMIT);
        mockHeader = mock(DataHeaderFlyweight).mock;
        mockSetupHeader = mock(SetupFlyweight).mock;
        mockBuffer = mock(UnsafeBuffer).mock;
        mockChannelEndpoint = mock(ReceiveChannelEndpoint).mock;
        sendSetupElicitingStatusMessage = mockChannelEndpoint.sendSetupElicitingStatusMessage as Mock<
            ReceiveChannelEndpoint['sendSetupElicitingStatusMessage']
        >;
        mockImage = mockPublicationImage();

        stub(mockHeader.sessionId, SESSION_ID);
        stub(mockHeader.streamId, STREAM_ID);
        stub(mockHeader.termId, ACTIVE_TERM_ID);
        stub(mockHeader.termOffset, TERM_OFFSET);

        mockImage.sessionId.mockReturnValue(SESSION_ID);
        mockImage.streamId.mockReturnValue(STREAM_ID);

        stub(mockSetupHeader.sessionId, SESSION_ID);
        stub(mockSetupHeader.streamId, STREAM_ID);
        stub(mockSetupHeader.activeTermId, ACTIVE_TERM_ID);
        stub(mockSetupHeader.initialTermId, INITIAL_TERM_ID);
        stub(mockSetupHeader.termOffset, TERM_OFFSET);
        stub(mockSetupHeader.mtuLength, MTU_LENGTH);
        stub(mockSetupHeader.termLength, TERM_LENGTH);
        // a Mockito mock answers 0 for the `ttl` and the `flags` that the test does not stub
        stub(mockSetupHeader.ttl, 0);
        stub(mockSetupHeader.flags, 0);
    });

    it('shouldElicitSetupMessageWhenDataArrivesForSubscriptionWithoutImage', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).not.toHaveBeenCalled();
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledTimes(1);
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledWith(0, SRC_ADDRESS, SESSION_ID, STREAM_ID);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledTimes(1);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            0,
            mockChannelEndpoint,
            false,
            SRC_ADDRESS,
        );
    });

    it('shouldOnlyElicitSetupMessageOnceWhenDataArrivesForSubscriptionWithoutImage', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).not.toHaveBeenCalled();
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledTimes(1);
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledWith(0, SRC_ADDRESS, SESSION_ID, STREAM_ID);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledTimes(1);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            0,
            mockChannelEndpoint,
            false,
            SRC_ADDRESS,
        );
    });

    it('shouldElicitSetupMessageAgainWhenDataArrivesForSubscriptionWithoutImageAfterRemovePendingSetup', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.removeSessionInterestByState(SESSION_ID, STREAM_ID, PENDING_SETUP_FRAME);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).not.toHaveBeenCalled();
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledTimes(2);
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledWith(0, SRC_ADDRESS, SESSION_ID, STREAM_ID);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledTimes(2);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            0,
            mockChannelEndpoint,
            false,
            SRC_ADDRESS,
        );
    });

    it('shouldRequestCreateImageUponReceivingSetup', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);

        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledTimes(1);
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            TERM_LENGTH,
            MTU_LENGTH,
            0,
            0,
            SRC_ADDRESS,
            SRC_ADDRESS,
            mockChannelEndpoint,
        );
    });

    it('shouldOnlyRequestCreateImageOnceUponReceivingSetup', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);

        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledTimes(1);
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            TERM_LENGTH,
            MTU_LENGTH,
            0,
            0,
            SRC_ADDRESS,
            SRC_ADDRESS,
            mockChannelEndpoint,
        );
    });

    it('shouldNotRequestCreateImageOnceUponReceivingSetupAfterImageAdded', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);

        expect(calledMembers(mockConductorProxy)).toEqual([]);
    });

    it('shouldSetImageInactiveOnRemoveSubscription', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.removeSubscription(STREAM_ID);

        expect(mockImage.deactivate).toHaveBeenCalledTimes(1);
    });

    it('shouldSetImageInactiveOnRemoveImage', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.removePublicationImage(mockImage);

        expect(mockImage.deactivate).toHaveBeenCalledTimes(1);
    });

    it('shouldIgnoreDataAndSetupAfterImageRemovedButHasNotEndedStream', () => {
        mockImage.isEndOfStream.mockReturnValue(false);

        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.removePublicationImage(mockImage);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).not.toHaveBeenCalled();

        expect(calledMembers(mockConductorProxy)).toEqual([]);
        expect(calledMembers(mockReceiver)).toEqual([]);
    });

    it('shouldIgnoreDataButAllowSetupAfterImageRemovedWhenEndOfStreamReached', () => {
        mockImage.isEndOfStream.mockReturnValue(true);

        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.removePublicationImage(mockImage);

        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        expect(mockImage.insertPacket).not.toHaveBeenCalled();

        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledTimes(1);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledTimes(1);

        // verifyNoMoreInteractions(mockConductorProxy); verifyNoMoreInteractions(mockReceiver)
        expect(calledMembers(mockConductorProxy)).toEqual(['createPublicationImage']);
        expect(calledMembers(mockReceiver)).toEqual(['addPendingSetupMessage']);
    });

    it('shouldNotIgnoreDataAndSetupAfterImageRemovedAndCoolDownRemoved', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.removePublicationImage(mockImage);
        dispatcher.removeSessionInterestByState(SESSION_ID, STREAM_ID, ON_COOL_DOWN);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);
        dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).not.toHaveBeenCalled();

        // inOrder(mockChannelEndpoint, mockReceiver, mockConductorProxy)
        expect(sendSetupElicitingStatusMessage).toHaveBeenCalledWith(0, SRC_ADDRESS, SESSION_ID, STREAM_ID);
        expect(mockReceiver.addPendingSetupMessage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            0,
            mockChannelEndpoint,
            false,
            SRC_ADDRESS,
        );
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledWith(
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            TERM_LENGTH,
            MTU_LENGTH,
            0,
            0,
            SRC_ADDRESS,
            SRC_ADDRESS,
            mockChannelEndpoint,
        );
        expectInOrder(
            [sendSetupElicitingStatusMessage, 0],
            [mockReceiver.addPendingSetupMessage, 0],
            [mockConductorProxy.createPublicationImage, 0],
        );
    });

    it('shouldDispatchDataToCorrectImage', () => {
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage.activate).toHaveBeenCalledTimes(1);
        expect(mockImage.insertPacket).toHaveBeenCalledTimes(1);
        expect(mockImage.insertPacket).toHaveBeenCalledWith(
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            mockBuffer,
            LENGTH,
            0,
            SRC_ADDRESS,
        );
    });

    it('shouldNotRemoveNewPublicationImageFromOldRemovePublicationImageAfterRemoveSubscription', () => {
        const mockImage1 = mockPublicationImage();
        const mockImage2 = mockPublicationImage();

        mockImage1.sessionId.mockReturnValue(SESSION_ID);
        mockImage1.streamId.mockReturnValue(STREAM_ID);
        mockImage1.correlationId.mockReturnValue(CORRELATION_ID_1);

        mockImage2.sessionId.mockReturnValue(SESSION_ID);
        mockImage2.streamId.mockReturnValue(STREAM_ID);
        mockImage2.correlationId.mockReturnValue(CORRELATION_ID_2);

        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage1);
        dispatcher.removeSubscription(STREAM_ID);
        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage2);
        dispatcher.removePublicationImage(mockImage1);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage1.insertPacket).not.toHaveBeenCalled();
        expect(mockImage2.insertPacket).toHaveBeenCalledTimes(1);
        expect(mockImage2.insertPacket).toHaveBeenCalledWith(
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            mockBuffer,
            LENGTH,
            0,
            SRC_ADDRESS,
        );
    });

    it('shouldRemoveSessionSpecificSubscriptionWithoutAny', () => {
        dispatcher.addSubscription(STREAM_ID, SESSION_ID);
        dispatcher.removeSubscription(STREAM_ID, SESSION_ID);
    });

    it('shouldRemoveSessionSpecificSubscriptionAndStillReceiveIntoImage', () => {
        const mockImage = mockPublicationImage();

        mockImage.sessionId.mockReturnValue(SESSION_ID);
        mockImage.streamId.mockReturnValue(STREAM_ID);
        mockImage.correlationId.mockReturnValue(CORRELATION_ID_1);

        dispatcher.addSubscription(STREAM_ID);
        dispatcher.addPublicationImage(mockImage);
        dispatcher.addSubscription(STREAM_ID, SESSION_ID);
        dispatcher.removeSubscription(STREAM_ID, SESSION_ID);
        dispatcher.onDataPacket(mockChannelEndpoint, mockHeader, mockBuffer, LENGTH, SRC_ADDRESS, 0);

        expect(mockImage.insertPacket).toHaveBeenCalledTimes(1);
        expect(mockImage.insertPacket).toHaveBeenCalledWith(
            ACTIVE_TERM_ID,
            TERM_OFFSET,
            mockBuffer,
            LENGTH,
            0,
            SRC_ADDRESS,
        );
    });

    it('shouldPreventNewSessionsOnceStreamSessionLimitIsExceeded', () => {
        const mockImage = mockPublicationImage();

        mockImage.streamId.mockReturnValue(STREAM_ID);
        mockImage.correlationId.mockReturnValue(CORRELATION_ID_1);

        dispatcher.addSubscription(STREAM_ID);

        let sessionId = SESSION_ID;
        for (let i = 0; i < STREAM_SESSION_LIMIT; i++) {
            mockImage.sessionId.mockReturnValue(sessionId);
            stub(mockSetupHeader.sessionId, sessionId);
            sessionId++;

            dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);
            dispatcher.addPublicationImage(mockImage);
        }
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledTimes(10);

        stub(mockSetupHeader.sessionId, sessionId);
        try {
            dispatcher.onSetupMessage(mockChannelEndpoint, mockSetupHeader, SRC_ADDRESS, 0);
        } catch {
            // ignore
        }
        // verifyNoMoreInteractions(mockConductorProxy)
        expect(mockConductorProxy.createPublicationImage).toHaveBeenCalledTimes(10);
        expect(calledMembers(mockConductorProxy)).toEqual(['createPublicationImage']);
    });
});
