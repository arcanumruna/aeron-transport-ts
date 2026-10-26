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
// Port of io/aeron/driver/ClientCommandAdapterTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { ManyToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, Long, RuntimeException } from '../../src/agrona/jdk.js';
import { LangUtil } from '../../src/agrona/LangUtil.js';
import { ControlProtocolEvents } from '../../src/client/command/ControlProtocolEvents.js';
import { PublicationMessageFlyweight } from '../../src/client/command/PublicationMessageFlyweight.js';
import { ErrorCode } from '../../src/client/ErrorCode.js';
import { AeronException } from '../../src/client/exceptions/AeronException.js';
import { ControlProtocolException } from '../../src/client/exceptions/ControlProtocolException.js';
import { StorageSpaceException } from '../../src/client/exceptions/StorageSpaceException.js';
import { ClientCommandAdapter } from '../../src/driver/ClientCommandAdapter.js';
import { ClientProxy } from '../../src/driver/ClientProxy.js';
import { IOException } from '../../src/driver/jdkNet.js';
import { type FakeConductor, fakeConductor } from '../support/ClientCommandConductor.js';
import { expectInOrder } from '../support/InOrder.js';
import { calledMembers, mock } from '../support/Mockito.js';

/** `new UncheckedIOException(cause)`: a `RuntimeException` whose message is `cause.toString()`. */
class UncheckedIOException extends RuntimeException {}

/** `new X(cause)`: the message is `cause.toString()` (`Throwable(Throwable)`). */
function withCause<T extends Error>(type: new (message: string, options: ErrorOptions) => T, cause: Error): T {
    return new type(cause.name + ': ' + cause.message, { cause });
}

describe('ClientCommandAdapterTest', () => {
    // JUnit makes a new instance of the test class for each test: the mocks and the adapter are made in beforeEach.
    let errorHandler: { onError: Mock<ErrorHandler['onError']> };
    let clientProxy: ClientProxy;
    let onError: Mock<ClientProxy['onError']>;
    let driverConductor: FakeConductor;
    let clientCommandAdapter: ClientCommandAdapter;
    let buffer: UnsafeBuffer;
    let publicationMsgFlyweight: PublicationMessageFlyweight;

    beforeEach(() => {
        errorHandler = { onError: vi.fn<ErrorHandler['onError']>() };
        const toDriverCommands = mock(ManyToOneRingBuffer).mock;
        clientProxy = mock(ClientProxy).mock;
        onError = clientProxy.onError as unknown as Mock<ClientProxy['onError']>;
        driverConductor = fakeConductor();
        clientCommandAdapter = new ClientCommandAdapter(errorHandler, toDriverCommands, clientProxy, driverConductor);
        buffer = new UnsafeBuffer(new Uint8Array(1024));
        publicationMsgFlyweight = new PublicationMessageFlyweight();
    });

    it('shouldThrowControlProtocolExceptionIfUnknownCommand', () => {
        const msgTypeId = 932467234;
        const expectedErrorCode = ErrorCode.UNKNOWN_COMMAND_TYPE_ID;
        const expectedErrorMessage = 'ERROR - command typeId=' + msgTypeId;

        clientCommandAdapter.onMessage(msgTypeId, buffer, 0, 5);

        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(0, expectedErrorCode, expectedErrorMessage);
        expectInOrder([errorHandler.onError, 0], [onError, 0]);
        // inOrder.verifyNoMoreInteractions()
        expect(calledMembers(clientProxy)).toEqual(['onError']);

        const exception = errorHandler.onError.mock.calls[0]![0] as ControlProtocolException;
        expect(exception).toBeInstanceOf(ControlProtocolException);
        expect(exception.errorCode()).toBe(expectedErrorCode);
        expect(exception.category()).toBe(AeronException.Category.ERROR);
        expect(exception.message).toBe(expectedErrorMessage);
    });

    it('shouldHandleGenericException', () => {
        const clientId = Long.MIN_VALUE + 63847263784238;
        const correlationId = 4213;
        const streamId = -19;
        const channel = 'aeron:udp?alias=test|endpoint=localhost:8080';
        const exception = withCause(IllegalArgumentException, new IOException('dummy error'));
        const expectedErrorCode = ErrorCode.GENERIC_ERROR;
        // exception.getClass().getName() + " : " + exception.getMessage(), with the simple class name (spec D10)
        const expectedErrorMessage = exception.name + ' : ' + exception.message;
        driverConductor.onAddNetworkPublication.mockImplementation(() => {
            throw exception;
        });
        publicationMsgFlyweight.wrap(buffer, 0).clientId(clientId).correlationId(correlationId);
        publicationMsgFlyweight.streamId(streamId).channel(channel);

        clientCommandAdapter.onMessage(
            ControlProtocolEvents.ADD_PUBLICATION,
            buffer,
            0,
            publicationMsgFlyweight.length(),
        );

        expect(driverConductor.onAddNetworkPublication).toHaveBeenCalledTimes(1);
        expect(driverConductor.onAddNetworkPublication).toHaveBeenCalledWith(
            channel,
            streamId,
            correlationId,
            clientId,
            false,
        );
        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
        expect(errorHandler.onError).toHaveBeenCalledWith(exception);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(correlationId, expectedErrorCode, expectedErrorMessage);
        expectInOrder([driverConductor.onAddNetworkPublication, 0], [errorHandler.onError, 0], [onError, 0]);
        expect(calledMembers(clientProxy)).toEqual(['onError']);
    });

    it('shouldHandleStorageSpaceException', () => {
        const clientId = 109;
        const correlationId = 42;
        const streamId = 100;
        const channel = 'aeron:ipc';
        const exception = new StorageSpaceException('storage error');
        const expectedErrorCode = ErrorCode.STORAGE_SPACE;
        const expectedErrorMessage = exception.message;
        driverConductor.onAddIpcPublication.mockImplementation(() => {
            throw exception;
        });
        publicationMsgFlyweight.wrap(buffer, 0).clientId(clientId).correlationId(correlationId);
        publicationMsgFlyweight.streamId(streamId).channel(channel);

        clientCommandAdapter.onMessage(
            ControlProtocolEvents.ADD_PUBLICATION,
            buffer,
            0,
            publicationMsgFlyweight.length(),
        );

        expect(driverConductor.onAddIpcPublication).toHaveBeenCalledTimes(1);
        expect(driverConductor.onAddIpcPublication).toHaveBeenCalledWith(
            channel,
            streamId,
            correlationId,
            clientId,
            false,
        );
        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
        expect(errorHandler.onError).toHaveBeenCalledWith(exception);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(correlationId, expectedErrorCode, expectedErrorMessage);
        expectInOrder([driverConductor.onAddIpcPublication, 0], [errorHandler.onError, 0], [onError, 0]);
        expect(calledMembers(clientProxy)).toEqual(['onError']);
    });

    it.each([
        ['IOException', new IOException('No space left on device')],
        ['UncheckedIOException', withCause(UncheckedIOException, new IOException('No space left on device')) as Error],
        ['RuntimeException', withCause(RuntimeException, new IOException('No space left on device')) as Error],
    ])('shouldHandleNoSpaceLeftOnTheDeviceIOException %s', (_name, exception) => {
        const clientId = 109;
        const correlationId = 42;
        const streamId = 100;
        const channel = 'aeron:ipc';
        const expectedErrorCode = ErrorCode.STORAGE_SPACE;
        const expectedErrorMessage = exception.message;
        driverConductor.onAddIpcPublication.mockImplementation(() => {
            LangUtil.rethrowUnchecked(exception);
        });
        publicationMsgFlyweight.wrap(buffer, 0).clientId(clientId).correlationId(correlationId);
        publicationMsgFlyweight.streamId(streamId).channel(channel);

        clientCommandAdapter.onMessage(
            ControlProtocolEvents.ADD_PUBLICATION,
            buffer,
            0,
            publicationMsgFlyweight.length(),
        );

        expect(driverConductor.onAddIpcPublication).toHaveBeenCalledTimes(1);
        expect(driverConductor.onAddIpcPublication).toHaveBeenCalledWith(
            channel,
            streamId,
            correlationId,
            clientId,
            false,
        );
        expect(errorHandler.onError).toHaveBeenCalledTimes(1);
        expect(errorHandler.onError).toHaveBeenCalledWith(exception);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(correlationId, expectedErrorCode, expectedErrorMessage);
        expectInOrder([driverConductor.onAddIpcPublication, 0], [errorHandler.onError, 0], [onError, 0]);
        expect(calledMembers(clientProxy)).toEqual(['onError']);
    });
});
