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
// Port of io/aeron/ClientConductorTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AgentTerminationException } from '../../src/agrona/concurrent/AgentTerminationException.js';
import { CopyBroadcastReceiver } from '../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { Lock } from '../../src/agrona/concurrent/NoOpLock.js';
import { NoOpIdleStrategy } from '../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { SystemErr, printStackTrace } from '../../src/agrona/jdkThrowable.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { SemanticVersion } from '../../src/agrona/SemanticVersion.js';
import { Aeron } from '../../src/client/Aeron.js';
import { AeronCounters } from '../../src/client/AeronCounters.js';
import type { AvailableImageHandler } from '../../src/client/AvailableImageHandler.js';
import { ClientConductor } from '../../src/client/ClientConductor.js';
import { ClientTimeoutFlyweight } from '../../src/client/command/ClientTimeoutFlyweight.js';
import { ControlProtocolEvents } from '../../src/client/command/ControlProtocolEvents.js';
import { CorrelatedMessageFlyweight } from '../../src/client/command/CorrelatedMessageFlyweight.js';
import { ErrorResponseFlyweight } from '../../src/client/command/ErrorResponseFlyweight.js';
import { OperationSucceededFlyweight } from '../../src/client/command/OperationSucceededFlyweight.js';
import { PublicationBuffersReadyFlyweight } from '../../src/client/command/PublicationBuffersReadyFlyweight.js';
import { SubscriptionReadyFlyweight } from '../../src/client/command/SubscriptionReadyFlyweight.js';
import { DriverProxy } from '../../src/client/DriverProxy.js';
import { ErrorCode } from '../../src/client/ErrorCode.js';
import { AeronException } from '../../src/client/exceptions/AeronException.js';
import { ConductorServiceTimeoutException } from '../../src/client/exceptions/ConductorServiceTimeoutException.js';
import { DriverTimeoutException } from '../../src/client/exceptions/DriverTimeoutException.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import { TimeoutException } from '../../src/client/exceptions/TimeoutException.js';
import { Image } from '../../src/client/Image.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { LogBuffersFactory } from '../../src/client/LogBuffersFactory.js';
import { LogBuffers } from '../../src/client/LogBuffers.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { Publication } from '../../src/client/Publication.js';
import { Subscription } from '../../src/client/Subscription.js';
import type { UnavailableImageHandler } from '../../src/client/UnavailableImageHandler.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';
import { calledMembers, mock } from '../support/Mockito.js';

const { PARTITION_COUNT, TERM_MIN_LENGTH } = LogBufferDescriptor;
const { DRIVER_SYSTEM_COUNTER_TYPE_ID, SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION } = AeronCounters;
const { INVALID_CHANNEL } = ErrorCode;

const TERM_BUFFER_LENGTH = TERM_MIN_LENGTH;

const SESSION_ID_1 = 13;
const SESSION_ID_2 = 15;

const CHANNEL = 'aeron:udp?endpoint=localhost:40124';
const STREAM_ID_1 = 1002;
const STREAM_ID_2 = 1004;
const SEND_BUFFER_CAPACITY = 1024;

const CORRELATION_ID = 2000;
const CORRELATION_ID_2 = 2002;
const CLOSE_CORRELATION_ID = 2001;
const UNKNOWN_CORRELATION_ID = 3000;

const KEEP_ALIVE_INTERVAL = 500 * 1_000_000;
const AWAIT_TIMEOUT = 100;
const INTER_SERVICE_TIMEOUT_MS = 1000;

const SUBSCRIPTION_POSITION_ID = 2;
const SUBSCRIPTION_POSITION_REGISTRATION_ID = 4001;

const SOURCE_INFO = '127.0.0.1:40789';

/**
 * Mockito's `when(mock.method(args)).thenReturn(value)` for a method that answers a `long`: the answer for these
 * arguments, and for any other the one stubbed before (the default of a Mockito mock is 0).
 */
function when(method: unknown, args: unknown[], value: number): void {
    const spy = method as Mock<(...actual: unknown[]) => number>;
    const previous = spy.getMockImplementation();
    spy.mockImplementation((...actual: unknown[]) =>
        actual.length === args.length && actual.every((a, i) => a === args[i]) ? value : (previous?.(...actual) ?? 0),
    );
}

/** Mockito's default answer for a method that returns a `long` or an `int`: 0. */
function answerZero(...methods: unknown[]): void {
    for (const method of methods) {
        (method as Mock<() => number>).mockImplementation(() => 0);
    }
}

describe('ClientConductorTest', () => {
    const publicationReady = new PublicationBuffersReadyFlyweight();
    const subscriptionReady = new SubscriptionReadyFlyweight();
    const operationSuccess = new OperationSucceededFlyweight();
    const errorResponse = new ErrorResponseFlyweight();
    const clientTimeout = new ClientTimeoutFlyweight();

    let publicationReadyBuffer: UnsafeBuffer;
    let subscriptionReadyBuffer: UnsafeBuffer;
    let operationSuccessBuffer: UnsafeBuffer;
    let errorMessageBuffer: UnsafeBuffer;
    let clientTimeoutBuffer: UnsafeBuffer;

    let mockToClientReceiver: CopyBroadcastReceiver;
    let counterMetaDataBuffer: UnsafeBuffer;
    let counterValuesBuffer: UnsafeBuffer;

    let timeMs: number;
    let timeNs: number;

    let mockClientErrorHandler: ErrorHandler & { onError: Mock<(throwable: Error) => void> };

    let context: Aeron.Context;
    let conductor: ClientConductor;
    let driverProxy: DriverProxy;
    let mockAvailableImageHandler: AvailableImageHandler & { onAvailableImage: Mock<(image: Image) => void> };
    let mockUnavailableImageHandler: UnavailableImageHandler & { onUnavailableImage: Mock<(image: Image) => void> };
    let mockCloseHandler: Mock<() => void>;
    let logBuffersFactory: LogBuffersFactory & { map: Mock<(logFileName: string) => LogBuffers> };
    let mockClientLock: Lock;
    let mockAeron: Aeron;
    let suppressPrintError: boolean;

    beforeEach(() => {
        publicationReadyBuffer = new UnsafeBuffer(new ArrayBuffer(SEND_BUFFER_CAPACITY));
        subscriptionReadyBuffer = new UnsafeBuffer(new ArrayBuffer(SEND_BUFFER_CAPACITY));
        operationSuccessBuffer = new UnsafeBuffer(new ArrayBuffer(SEND_BUFFER_CAPACITY));
        errorMessageBuffer = new UnsafeBuffer(new ArrayBuffer(SEND_BUFFER_CAPACITY));
        clientTimeoutBuffer = new UnsafeBuffer(new ArrayBuffer(SEND_BUFFER_CAPACITY));

        mockToClientReceiver = mock(CopyBroadcastReceiver).mock;
        // ByteBuffer.allocateDirect(640 * 1024): the meta data in the first 512 KiB, the values in the rest
        const countersMemory = new ArrayBuffer(640 * 1024);
        counterMetaDataBuffer = new UnsafeBuffer(countersMemory, 0, 512 * 1024);
        counterValuesBuffer = new UnsafeBuffer(countersMemory, 512 * 1024, countersMemory.byteLength - 512 * 1024);

        timeMs = 0;
        timeNs = 0;
        const epochClock = { time: (): number => (timeMs += 10) };
        const nanoClock = { nanoTime: (): number => (timeNs += 10_000_000) };

        suppressPrintError = false;
        mockClientErrorHandler = {
            onError: vi.fn((throwable: Error) => {
                if (!suppressPrintError) {
                    printStackTrace(throwable, SystemErr);
                }
            }),
        };

        driverProxy = mock(DriverProxy).mock;
        answerZero(
            driverProxy.addPublication,
            driverProxy.addExclusivePublication,
            driverProxy.removePublication,
            driverProxy.addSubscription,
            driverProxy.removeSubscription,
            driverProxy.addDestination,
            driverProxy.removeDestination,
            driverProxy.addRcvDestination,
            driverProxy.removeRcvDestination,
            driverProxy.rejectImage,
            driverProxy.timeOfLastDriverKeepaliveMs,
        );
        mockAvailableImageHandler = { onAvailableImage: vi.fn() };
        mockUnavailableImageHandler = { onUnavailableImage: vi.fn() };
        mockCloseHandler = vi.fn();
        logBuffersFactory = { map: vi.fn() };
        mockClientLock = {
            lock: vi.fn(),
            lockInterruptibly: vi.fn(),
            tryLock: vi.fn(() => false),
            unlock: vi.fn(),
            newCondition: vi.fn(),
        } as unknown as Lock;
        mockAeron = mock(Aeron).mock;
        answerZero(mockAeron.nextCorrelationId);

        context = new Aeron.Context()
            .clientLock(mockClientLock)
            .epochClock(epochClock)
            .nanoClock(nanoClock)
            .awaitingIdleStrategy(new NoOpIdleStrategy())
            .toClientBuffer(mockToClientReceiver)
            .driverProxy(driverProxy)
            .logBuffersFactory(logBuffersFactory)
            .errorHandler(mockClientErrorHandler)
            .availableImageHandler(mockAvailableImageHandler)
            .unavailableImageHandler(mockUnavailableImageHandler)
            .closeHandler(mockCloseHandler)
            .keepAliveIntervalNs(KEEP_ALIVE_INTERVAL)
            .driverTimeoutMs(AWAIT_TIMEOUT)
            .interServiceTimeoutNs(INTER_SERVICE_TIMEOUT_MS * 1_000_000);

        context.countersMetaDataBuffer(counterMetaDataBuffer);
        context.countersValuesBuffer(counterValuesBuffer);

        (mockClientLock.tryLock as Mock<() => boolean>).mockImplementation(() => true);

        when(driverProxy.addPublication, [CHANNEL, STREAM_ID_1], CORRELATION_ID);
        when(driverProxy.addPublication, [CHANNEL, STREAM_ID_2], CORRELATION_ID_2);
        when(driverProxy.removePublication, [CORRELATION_ID, false], CLOSE_CORRELATION_ID);
        (driverProxy.addSubscription as Mock<() => number>).mockImplementation(() => CORRELATION_ID);
        when(driverProxy.removeSubscription, [CORRELATION_ID], CLOSE_CORRELATION_ID);

        conductor = new ClientConductor(context, mockAeron);

        publicationReady.wrap(publicationReadyBuffer, 0);
        subscriptionReady.wrap(subscriptionReadyBuffer, 0);
        operationSuccess.wrap(operationSuccessBuffer, 0);
        errorResponse.wrap(errorMessageBuffer, 0);
        clientTimeout.wrap(clientTimeoutBuffer, 0);

        publicationReady.correlationId(CORRELATION_ID);
        publicationReady.registrationId(CORRELATION_ID);
        publicationReady.sessionId(SESSION_ID_1);
        publicationReady.streamId(STREAM_ID_1);
        publicationReady.logFileName(SESSION_ID_1 + '-log');

        operationSuccess.correlationId(CLOSE_CORRELATION_ID);

        const termBuffersSession1: UnsafeBuffer[] = new Array<UnsafeBuffer>(PARTITION_COUNT);
        const termBuffersSession2: UnsafeBuffer[] = new Array<UnsafeBuffer>(PARTITION_COUNT);

        for (let i = 0; i < PARTITION_COUNT; i++) {
            termBuffersSession1[i] = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
            termBuffersSession2[i] = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
        }

        const logMetaDataSession1 = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
        const logMetaDataSession2 = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));

        const header1: MutableDirectBuffer = DataHeaderFlyweight.createDefaultHeader(SESSION_ID_1, STREAM_ID_1, 0);
        const header2: MutableDirectBuffer = DataHeaderFlyweight.createDefaultHeader(SESSION_ID_2, STREAM_ID_2, 0);

        LogBufferDescriptor.storeDefaultFrameHeader(logMetaDataSession1, header1);
        LogBufferDescriptor.storeDefaultFrameHeader(logMetaDataSession2, header2);

        const logBuffersSession1 = mock(LogBuffers).mock;
        const logBuffersSession2 = mock(LogBuffers).mock;
        answerZero(logBuffersSession1.incRef, logBuffersSession1.decRef);
        answerZero(logBuffersSession2.incRef, logBuffersSession2.decRef);

        logBuffersFactory.map.mockImplementation((logFileName: string) => {
            if (SESSION_ID_1 + '-log' === logFileName) {
                return logBuffersSession1;
            } else if (SESSION_ID_2 + '-log' === logFileName) {
                return logBuffersSession2;
            }
            return null as unknown as LogBuffers;
        });

        (logBuffersSession1.duplicateTermBuffers as Mock<() => UnsafeBuffer[]>).mockImplementation(
            () => termBuffersSession1,
        );
        (logBuffersSession2.duplicateTermBuffers as Mock<() => UnsafeBuffer[]>).mockImplementation(
            () => termBuffersSession2,
        );

        (logBuffersSession1.metaDataBuffer as Mock<() => UnsafeBuffer>).mockImplementation(() => logMetaDataSession1);
        (logBuffersSession2.metaDataBuffer as Mock<() => UnsafeBuffer>).mockImplementation(() => logMetaDataSession2);
        (logBuffersSession1.termLength as Mock<() => number>).mockImplementation(() => TERM_BUFFER_LENGTH);
        (logBuffersSession2.termLength as Mock<() => number>).mockImplementation(() => TERM_BUFFER_LENGTH);
    });

    // --------------------------------
    // Publication related interactions
    // --------------------------------

    it('addPublicationShouldNotifyMediaDriver', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        conductor.addPublication(CHANNEL, STREAM_ID_1);

        expect(driverProxy.addPublication).toHaveBeenCalledTimes(1);
        expect(driverProxy.addPublication).toHaveBeenCalledWith(CHANNEL, STREAM_ID_1);
    });

    it('addPublicationShouldMapLogFile', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        conductor.addPublication(CHANNEL, STREAM_ID_1);

        expect(logBuffersFactory.map).toHaveBeenCalledTimes(1);
        expect(logBuffersFactory.map).toHaveBeenCalledWith(SESSION_ID_1 + '-log');
    });

    it('addPublicationShouldTimeoutWithoutReadyMessage', () => {
        assertThrows(DriverTimeoutException, () => conductor.addPublication(CHANNEL, STREAM_ID_1));
    });

    it('closingPublicationShouldNotifyMediaDriver', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        const publication = conductor.addPublication(CHANNEL, STREAM_ID_1) as Publication;

        whenReceiveBroadcastOnMessage(
            ControlProtocolEvents.ON_OPERATION_SUCCESS,
            operationSuccessBuffer,
            () => OperationSucceededFlyweight.LENGTH,
        );

        publication.close();

        expect(driverProxy.removePublication).toHaveBeenCalledTimes(1);
        expect(driverProxy.removePublication).toHaveBeenCalledWith(CORRELATION_ID, false);
    });

    it('closingPublicationShouldPurgeCache', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        const firstPublication = conductor.addPublication(CHANNEL, STREAM_ID_1) as Publication;

        whenReceiveBroadcastOnMessage(
            ControlProtocolEvents.ON_OPERATION_SUCCESS,
            operationSuccessBuffer,
            () => OperationSucceededFlyweight.LENGTH,
        );

        firstPublication.close();

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        const secondPublication = conductor.addPublication(CHANNEL, STREAM_ID_1);

        expect(firstPublication).not.toBe(secondPublication);
    });

    it('shouldFailToAddPublicationOnMediaDriverError', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_ERROR, errorMessageBuffer, () => {
            errorResponse.errorCode(INVALID_CHANNEL);
            errorResponse.errorMessage('invalid channel');
            errorResponse.offendingCommandCorrelationId(CORRELATION_ID);
            return errorResponse.length();
        });

        assertThrows(RegistrationException, () => conductor.addPublication(CHANNEL, STREAM_ID_1));
    });

    it('closingPublicationDoesNotRemoveOtherPublications', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () =>
            publicationReady.length(),
        );

        const publication = conductor.addPublication(CHANNEL, STREAM_ID_1) as Publication;

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () => {
            publicationReady.streamId(STREAM_ID_2);
            publicationReady.sessionId(SESSION_ID_2);
            publicationReady.logFileName(SESSION_ID_2 + '-log');
            publicationReady.correlationId(CORRELATION_ID_2);
            publicationReady.registrationId(CORRELATION_ID_2);
            return publicationReady.length();
        });

        conductor.addPublication(CHANNEL, STREAM_ID_2);

        whenReceiveBroadcastOnMessage(
            ControlProtocolEvents.ON_OPERATION_SUCCESS,
            operationSuccessBuffer,
            () => OperationSucceededFlyweight.LENGTH,
        );

        publication.close();

        expect(driverProxy.removePublication).toHaveBeenCalledTimes(1);
        expect(driverProxy.removePublication).toHaveBeenCalledWith(CORRELATION_ID, false);
        expect(driverProxy.removePublication).not.toHaveBeenCalledWith(CORRELATION_ID_2, false);
    });

    it('shouldNotMapBuffersForUnknownCorrelationId', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () => {
            publicationReady.correlationId(UNKNOWN_CORRELATION_ID);
            publicationReady.registrationId(UNKNOWN_CORRELATION_ID);
            return publicationReady.length();
        });

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () => {
            publicationReady.correlationId(CORRELATION_ID);
            return publicationReady.length();
        });

        const publication = conductor.addPublication(CHANNEL, STREAM_ID_1) as Publication;
        conductor.doWork();

        expect(logBuffersFactory.map).toHaveBeenCalledTimes(1);
        expect(publication.registrationId()).toBe(CORRELATION_ID);
    });

    it('addSubscriptionShouldNotifyMediaDriver', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(CORRELATION_ID);
            return SubscriptionReadyFlyweight.LENGTH;
        });

        conductor.addSubscription(CHANNEL, STREAM_ID_1);

        expect(driverProxy.addSubscription).toHaveBeenCalledTimes(1);
        expect(driverProxy.addSubscription).toHaveBeenCalledWith(CHANNEL, STREAM_ID_1);
    });

    it('closingSubscriptionShouldNotifyMediaDriver', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(CORRELATION_ID);
            return SubscriptionReadyFlyweight.LENGTH;
        });

        const subscription = conductor.addSubscription(CHANNEL, STREAM_ID_1);

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_OPERATION_SUCCESS, operationSuccessBuffer, () => {
            operationSuccess.correlationId(CLOSE_CORRELATION_ID);
            return CorrelatedMessageFlyweight.LENGTH;
        });

        subscription.close();

        expect(driverProxy.removeSubscription).toHaveBeenCalledTimes(1);
        expect(driverProxy.removeSubscription).toHaveBeenCalledWith(CORRELATION_ID);
    });

    it('addSubscriptionShouldTimeoutWithoutOperationSuccessful', () => {
        assertThrows(DriverTimeoutException, () => conductor.addSubscription(CHANNEL, STREAM_ID_1));
    });

    it('shouldFailToAddSubscriptionOnMediaDriverError', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_ERROR, errorMessageBuffer, () => {
            errorResponse.errorCode(INVALID_CHANNEL);
            errorResponse.errorMessage('invalid channel');
            errorResponse.offendingCommandCorrelationId(CORRELATION_ID);
            return errorResponse.length();
        });

        assertThrows(RegistrationException, () => conductor.addSubscription(CHANNEL, STREAM_ID_1));
    });

    it('clientNotifiedOfNewImageShouldMapLogFile', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(CORRELATION_ID);
            return SubscriptionReadyFlyweight.LENGTH;
        });

        const subscription = conductor.addSubscription(CHANNEL, STREAM_ID_1);

        conductor.onAvailableImage(
            CORRELATION_ID,
            SESSION_ID_1,
            subscription.registrationId(),
            SUBSCRIPTION_POSITION_ID,
            SESSION_ID_1 + '-log',
            SOURCE_INFO,
        );

        expect(logBuffersFactory.map).toHaveBeenCalledTimes(1);
        expect(logBuffersFactory.map).toHaveBeenCalledWith(SESSION_ID_1 + '-log');
    });

    it('clientNotifiedOfNewAndInactiveImages', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(CORRELATION_ID);
            return SubscriptionReadyFlyweight.LENGTH;
        });

        const subscription = conductor.addSubscription(CHANNEL, STREAM_ID_1);

        conductor.onAvailableImage(
            CORRELATION_ID,
            SESSION_ID_1,
            subscription.registrationId(),
            SUBSCRIPTION_POSITION_ID,
            SESSION_ID_1 + '-log',
            SOURCE_INFO,
        );

        expect(subscription.hasNoImages()).toBe(false);
        expect(subscription.isConnected()).toBe(true);
        expect(mockAvailableImageHandler.onAvailableImage).toHaveBeenCalledTimes(1);
        expect(mockAvailableImageHandler.onAvailableImage).toHaveBeenCalledWith(expect.any(Image));

        conductor.onUnavailableImage(CORRELATION_ID, subscription.registrationId());

        expect(mockUnavailableImageHandler.onUnavailableImage).toHaveBeenCalledTimes(1);
        expect(mockUnavailableImageHandler.onUnavailableImage).toHaveBeenCalledWith(expect.any(Image));
        expect(subscription.hasNoImages()).toBe(true);
        expect(subscription.isConnected()).toBe(false);
    });

    it('shouldIgnoreUnknownNewImage', () => {
        conductor.onAvailableImage(
            CORRELATION_ID_2,
            SESSION_ID_2,
            SUBSCRIPTION_POSITION_REGISTRATION_ID,
            SUBSCRIPTION_POSITION_ID,
            SESSION_ID_2 + '-log',
            SOURCE_INFO,
        );

        expect(logBuffersFactory.map).not.toHaveBeenCalled();
        expect(mockAvailableImageHandler.onAvailableImage).not.toHaveBeenCalled();
    });

    it('shouldIgnoreUnknownInactiveImage', () => {
        conductor.onUnavailableImage(CORRELATION_ID_2, SUBSCRIPTION_POSITION_REGISTRATION_ID);

        expect(logBuffersFactory.map).not.toHaveBeenCalled();
        expect(mockUnavailableImageHandler.onUnavailableImage).not.toHaveBeenCalled();
    });

    it('shouldTimeoutInterServiceIfTooLongBetweenDoWorkCalls', () => {
        suppressPrintError = true;

        conductor.doWork();

        timeNs += INTER_SERVICE_TIMEOUT_MS * 1_000_000 + 1;

        conductor.doWork();

        expect(errorsOfType(ConductorServiceTimeoutException)).toHaveLength(1);
        expect(mockClientErrorHandler.onError).toHaveBeenCalledTimes(1);

        expect(conductor.isTerminating()).toBe(true);
    });

    it('shouldTerminateAndErrorOnClientTimeoutFromDriver', () => {
        suppressPrintError = true;

        conductor.onClientTimeout();
        expect(errorsOfType(TimeoutException)).toHaveLength(1);
        expect(mockClientErrorHandler.onError).toHaveBeenCalledTimes(1);

        let threwException = false;
        try {
            conductor.doWork();
        } catch (ex) {
            if (ex instanceof AgentTerminationException) {
                threwException = true;
            } else {
                throw ex;
            }
        }

        expect(threwException).toBe(true);
        expect(conductor.isTerminating()).toBe(true);

        conductor.onClose();
        expect(mockCloseHandler).toHaveBeenCalledTimes(1);
    });

    it('shouldNotCloseAndErrorOnClientTimeoutForAnotherClientIdFromDriver', () => {
        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_CLIENT_TIMEOUT, clientTimeoutBuffer, () => {
            clientTimeout.clientId(conductor.driverListenerAdapter().clientId() + 1);
            return ClientTimeoutFlyweight.LENGTH;
        });

        conductor.doWork();

        expect(errorsOfType(TimeoutException)).toHaveLength(0);

        expect(conductor.isClosed()).toBe(false);
    });

    it('shouldRemovePendingSubscriptionByRegistrationId', () => {
        const channel = 'aeron:ipc?alias=test';
        const streamId = 42;
        const subscriptionId = -7777777777777;
        when(driverProxy.addSubscription, [channel, streamId], subscriptionId);

        expect(conductor.asyncAddSubscription(channel, streamId)).toBe(subscriptionId);

        expect(conductor.asyncCommandIdSet.contains(subscriptionId)).toBe(true);
        const pendingSubscription = conductor.resourceByRegIdMap.get(
            subscriptionId,
        ) as ClientConductor.PendingSubscription | null;
        expect(pendingSubscription).not.toBeNull();
        expect(pendingSubscription?.subscription).not.toBeNull();
        expect(pendingSubscription?.subscription._isClosed).toBe(false);

        conductor.removeSubscription(subscriptionId);
        expect(conductor.asyncCommandIdSet.contains(subscriptionId)).toBe(false);
        expect(conductor.resourceByRegIdMap.get(subscriptionId)).toBeNull();
        expect(removeSubscriptionCalls(subscriptionId)).toBeLessThanOrEqual(1);
        expect((pendingSubscription as ClientConductor.PendingSubscription).subscription.isClosed()).toBe(true);
    });

    it('shouldRemoveSubscriptionByRegistrationId', () => {
        const channel = 'aeron:ipc?alias=test';
        const streamId = 42;
        const subscriptionId = 472394234579;
        const statusIndicatorId = -444;
        when(driverProxy.addSubscription, [channel, streamId], subscriptionId);
        expect(conductor.asyncAddSubscription(channel, streamId)).toBe(subscriptionId);
        conductor.onNewSubscription(subscriptionId, statusIndicatorId);

        const subscription = conductor.resourceByRegIdMap.get(subscriptionId) as Subscription | null;
        expect(subscription).not.toBeNull();
        expect((subscription as Subscription)._isClosed).toBe(false);

        conductor.removeSubscription(subscriptionId);
        expect(conductor.asyncCommandIdSet.contains(subscriptionId)).toBe(false);
        expect(conductor.resourceByRegIdMap.get(subscriptionId)).toBeNull();
        expect(removeSubscriptionCalls(subscriptionId)).toBeLessThanOrEqual(1);
        expect((subscription as Subscription).isClosed()).toBe(true);
    });

    it('shouldNotifyDriverWhenAsyncSubscriptionByRegistrationId', () => {
        const subscriptionId = 42;
        conductor.asyncCommandIdSet.add(subscriptionId);

        conductor.removeSubscription(subscriptionId);
        expect(conductor.asyncCommandIdSet.contains(subscriptionId)).toBe(false);
        // verify(driverProxy, only()).removeSubscription(subscriptionId)
        expect(calledMembers(driverProxy)).toEqual(['removeSubscription']);
        expect(driverProxy.removeSubscription).toHaveBeenCalledTimes(1);
        expect(driverProxy.removeSubscription).toHaveBeenCalledWith(subscriptionId);
    });

    it('removeSubscriptionByRegistrationIdIsANoOpIfIdIsUnknown', () => {
        const subscriptionId = 666;

        conductor.removeSubscription(subscriptionId);

        expect(conductor.asyncCommandIdSet.contains(subscriptionId)).toBe(false);
        expect(driverProxy.removeSubscription).not.toHaveBeenCalledWith(subscriptionId);
    });

    it('shouldThrowAeronExceptionOnAttemptToRemoveWrongResourceUsingSubscriptionRegistrationId', () => {
        const registrationId = 42;
        conductor.resourceByRegIdMap.put(registrationId, 'test resource');

        const exception = assertThrowsExactly(AeronException, () => conductor.removeSubscription(registrationId));
        expect(exception.message).toBe('ERROR - registration id is not a Subscription: String');
    });

    it.each([
        'aeron:udp?endpoint=localhost:5050',
        'aeron:udp?endpoint=localhost:5050|sparse=true',
        'aeron:udp?endpoint=localhost:8080|sparse=false',
    ])('shouldPreTouchLogBuffersForNewImage %s', (channel) => {
        const streamId = 42;
        const subscriptionId = -472398432;
        context.preTouchMappedMemory(true);

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(subscriptionId);
            return SubscriptionReadyFlyweight.LENGTH;
        });
        when(driverProxy.addSubscription, [channel, streamId], subscriptionId);
        const subscription = conductor.addSubscription(channel, streamId);

        const logFileName = SESSION_ID_1 + '-log';
        conductor.onAvailableImage(
            subscriptionId,
            SESSION_ID_1,
            subscription.registrationId(),
            SUBSCRIPTION_POSITION_ID,
            logFileName,
            SOURCE_INFO,
        );

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).toHaveBeenCalledTimes(1);
    });

    it('shouldNotPreTouchLogBuffersForImageIfDisabled', () => {
        const streamId = 42;
        const channel = 'aeron:ipc?alias=test';
        const subscriptionId = -472398432;
        context.preTouchMappedMemory(false);

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_SUBSCRIPTION_READY, subscriptionReadyBuffer, () => {
            subscriptionReady.correlationId(subscriptionId);
            return SubscriptionReadyFlyweight.LENGTH;
        });
        when(driverProxy.addSubscription, [channel, streamId], subscriptionId);
        const subscription = conductor.addSubscription(channel, streamId);

        const logFileName = SESSION_ID_1 + '-log';
        conductor.onAvailableImage(
            subscriptionId,
            SESSION_ID_1,
            subscription.registrationId(),
            SUBSCRIPTION_POSITION_ID,
            logFileName,
            SOURCE_INFO,
        );

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).not.toHaveBeenCalled();
    });

    it.each([
        'aeron:udp?endpoint=localhost:5050',
        'aeron:udp?endpoint=localhost:5050|sparse=true',
        'aeron:udp?endpoint=localhost:8080|sparse=false',
    ])('shouldPreTouchLogBuffersForNewPublication %s', (channel) => {
        const streamId = -53453894;
        const publicationId = 113;
        const logFileName = SESSION_ID_2 + '-log';
        context.preTouchMappedMemory(true);

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () => {
            publicationReady.correlationId(publicationId);
            publicationReady.registrationId(publicationId);
            publicationReady.logFileName(logFileName);
            return publicationReady.length();
        });
        when(driverProxy.addPublication, [channel, streamId], publicationId);
        const publication = conductor.addPublication(channel, streamId);
        expect(publication).not.toBeNull();

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).toHaveBeenCalledTimes(1);
    });

    it('shouldNotPreTouchLogBuffersForPublicationIfDisabled', () => {
        const streamId = -53453894;
        const channel = 'aeron:ipc?alias=test';
        const publicationId = 113;
        const logFileName = SESSION_ID_2 + '-log';
        context.preTouchMappedMemory(false);

        whenReceiveBroadcastOnMessage(ControlProtocolEvents.ON_PUBLICATION_READY, publicationReadyBuffer, () => {
            publicationReady.correlationId(publicationId);
            publicationReady.registrationId(publicationId);
            publicationReady.logFileName(logFileName);
            return publicationReady.length();
        });
        when(driverProxy.addPublication, [channel, streamId], publicationId);
        const publication = conductor.addPublication(channel, streamId);
        expect(publication).not.toBeNull();

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).not.toHaveBeenCalled();
    });

    it.each([
        'aeron:udp?endpoint=localhost:5050',
        'aeron:udp?endpoint=localhost:5050|sparse=true',
        'aeron:udp?endpoint=localhost:8080|sparse=false',
    ])('shouldPreTouchLogBuffersForNewExclusivePublication %s', (channel) => {
        const streamId = -53453894;
        const publicationId = 113;
        const logFileName = SESSION_ID_2 + '-log';
        context.preTouchMappedMemory(true);

        whenReceiveBroadcastOnMessage(
            ControlProtocolEvents.ON_EXCLUSIVE_PUBLICATION_READY,
            publicationReadyBuffer,
            () => {
                publicationReady.correlationId(publicationId);
                publicationReady.registrationId(publicationId);
                publicationReady.logFileName(logFileName);
                return publicationReady.length();
            },
        );
        when(driverProxy.addExclusivePublication, [channel, streamId], publicationId);
        const publication = conductor.addExclusivePublication(channel, streamId);
        expect(publication).not.toBeNull();

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).toHaveBeenCalledTimes(1);
    });

    it('shouldNotPreTouchLogBuffersForExclusivePublicationIfDisabled', () => {
        const streamId = -53453894;
        const channel = 'aeron:ipc?alias=test';
        const publicationId = 113;
        const logFileName = SESSION_ID_2 + '-log';
        context.preTouchMappedMemory(false);

        whenReceiveBroadcastOnMessage(
            ControlProtocolEvents.ON_EXCLUSIVE_PUBLICATION_READY,
            publicationReadyBuffer,
            () => {
                publicationReady.correlationId(publicationId);
                publicationReady.registrationId(publicationId);
                publicationReady.logFileName(logFileName);
                return publicationReady.length();
            },
        );
        when(driverProxy.addExclusivePublication, [channel, streamId], publicationId);
        const publication = conductor.addExclusivePublication(channel, streamId);
        expect(publication).not.toBeNull();

        const logBuffers = logBuffersFactory.map(logFileName);
        expect(logBuffers).not.toBeNull();
        expect(logBuffers.preTouch).not.toHaveBeenCalled();
    });

    it('shouldUseZeroAsControlProtocolVersionIfCounterNotAvailable', () => {
        expect(conductor.controlProtocolVersion).toBe(0);
    });

    it('shouldGetControlProtocolVersionFromSystemCounter', () => {
        const expectedVersion = SemanticVersion.compose(123, 98, 19);
        const countersManager = new CountersManager(counterMetaDataBuffer, counterValuesBuffer);
        for (let i = 0; i <= SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION; i++) {
            allocateSystemCounter(countersManager, i, '#' + i);
        }
        countersManager.setCounterValue(SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION, expectedVersion);

        const clientConductor = new ClientConductor(context, mockAeron);
        expect(clientConductor.controlProtocolVersion).toBe(expectedVersion);
    });

    it('shouldReturnRandomIdIfMediaDriverDoesNotSupportNextAvailableSessionIdCommand', () => {
        const streamId = 42;

        const sessionId1 = conductor.nextSessionId(streamId);
        const sessionId2 = conductor.nextSessionId(streamId);
        const sessionId3 = conductor.nextSessionId(streamId);

        expect(sessionId2).not.toBe(sessionId1);
        expect(sessionId3).not.toBe(sessionId1);
        expect(sessionId2).not.toBe(sessionId1 + 1);
        expect(sessionId3).not.toBe(sessionId2 + 1);
    });

    // The counters API is not ported (spec D95): there is no Counter, and the conductor has no asyncAddCounter,
    // asyncRemoveCounter or onNewCounter.
    it.skip('asyncRemoveCounterByRegistrationIdIsANoOpIfIdIsUnknown', () => {});

    it.skip('shouldThrowAeronExceptionOnAttemptToRemoveWrongResourceUsingCounterRegistrationId', () => {});

    it.skip('shouldRemoveCounterByRegistrationId', () => {});

    it.skip('shouldRemovePendingCounterByRegistrationId', () => {});

    /** `verify(driverProxy, atMostOnce()).removeSubscription(id)`: the number of calls with this id. */
    function removeSubscriptionCalls(subscriptionId: number): number {
        return (driverProxy.removeSubscription as Mock<(id: number) => number>).mock.calls.filter(
            (args) => args[0] === subscriptionId,
        ).length;
    }

    /** The errors of a type that the client error handler was told of (`verify(handler).onError(any(Type.class))`). */
    function errorsOfType(type: abstract new (...args: never[]) => Error): Error[] {
        return mockClientErrorHandler.onError.mock.calls.map((args) => args[0]).filter((e) => e instanceof type);
    }

    function whenReceiveBroadcastOnMessage(
        msgTypeId: number,
        buffer: MutableDirectBuffer,
        filler: (buffer: MutableDirectBuffer) => number,
    ): void {
        (mockToClientReceiver.receive as Mock<() => number>).mockImplementation(() => {
            const length = filler(buffer);
            conductor.driverListenerAdapter().onMessage(msgTypeId, buffer, 0, length);

            return 1;
        });
    }

    function allocateSystemCounter(countersManager: CountersManager, counterId: number, label: string): void {
        const id = countersManager.allocate(label, DRIVER_SYSTEM_COUNTER_TYPE_ID, (buffer) => {
            buffer.putInt(0, counterId);
        });
        expect(id).toBe(counterId);
        countersManager.setCounterRegistrationId(id, counterId);
        countersManager.setCounterOwnerId(id, Aeron.NULL_VALUE);
    }
});
