// Extra tests of T17 (port-only, spec 5.3): every response of `ClientProxy` is transmitted through a broadcast buffer,
// received with a `CopyBroadcastReceiver` as the client conductor does and decoded with the client's flyweights, which
// read back the fields that were encoded. The message type of each response is the one the client dispatches on.
import { beforeEach, describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BroadcastBufferDescriptor } from '../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { BroadcastTransmitter } from '../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { CopyBroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import type { MutableDirectBuffer } from '../../../src/agrona/MutableDirectBuffer.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { ClientTimeoutFlyweight } from '../../../src/client/command/ClientTimeoutFlyweight.js';
import { ControlProtocolEvents } from '../../../src/client/command/ControlProtocolEvents.js';
import { ErrorResponseFlyweight } from '../../../src/client/command/ErrorResponseFlyweight.js';
import { ImageBuffersReadyFlyweight } from '../../../src/client/command/ImageBuffersReadyFlyweight.js';
import { ImageMessageFlyweight } from '../../../src/client/command/ImageMessageFlyweight.js';
import { OperationSucceededFlyweight } from '../../../src/client/command/OperationSucceededFlyweight.js';
import { PublicationBuffersReadyFlyweight } from '../../../src/client/command/PublicationBuffersReadyFlyweight.js';
import { PublicationErrorFrameFlyweight } from '../../../src/client/command/PublicationErrorFrameFlyweight.js';
import { SubscriptionReadyFlyweight } from '../../../src/client/command/SubscriptionReadyFlyweight.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { ClientProxy } from '../../../src/driver/ClientProxy.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';

const {
    ON_AVAILABLE_IMAGE,
    ON_CLIENT_TIMEOUT,
    ON_ERROR,
    ON_EXCLUSIVE_PUBLICATION_READY,
    ON_OPERATION_SUCCESS,
    ON_PUBLICATION_ERROR,
    ON_PUBLICATION_READY,
    ON_SUBSCRIPTION_READY,
    ON_UNAVAILABLE_IMAGE,
} = ControlProtocolEvents;

const LOG_FILE = 'a/long/log/file/name/1234567890.logbuffer';
const CHANNEL = 'aeron:udp?endpoint=localhost:20121|alias=an-alias';

describe('ClientProxy extra', () => {
    let proxy: ClientProxy;
    let receiver: CopyBroadcastReceiver;

    beforeEach(() => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(8192 + BroadcastBufferDescriptor.TRAILER_LENGTH));
        proxy = new ClientProxy(new BroadcastTransmitter(buffer));
        receiver = new CopyBroadcastReceiver(new BroadcastReceiver(buffer));
    });

    /** Receives the one response that was transmitted and decodes it. */
    function receiveOne<T>(decode: (type: number, buffer: MutableDirectBuffer, index: number, length: number) => T): T {
        const decoded: T[] = [];
        const received = receiver.receive({
            onMessage: (type, buffer, index, length) => {
                decoded.push(decode(type, buffer, index, length));
            },
        });
        expect(received).toBe(1);
        expect(receiver.receive({ onMessage: () => expect.unreachable('one response only') })).toBe(0);
        return decoded[0] as T;
    }

    it.each([
        [ErrorCode.GENERIC_ERROR, 'a generic error', 0],
        [ErrorCode.INVALID_CHANNEL, '', 2 ** 40 + 7],
        [ErrorCode.MALFORMED_COMMAND, 'x'.repeat(1000), 1],
        [ErrorCode.STORAGE_SPACE, 'No space left on device', 123_456_789],
    ])('onError %s round-trips through ErrorResponseFlyweight', (code, message, correlationId) => {
        proxy.onError(correlationId, code, message);

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new ErrorResponseFlyweight().wrap(buffer, index);
            return {
                type,
                correlationId: fw.offendingCommandCorrelationId(),
                code: fw.errorCode(),
                message: fw.errorMessage(),
                length,
                fwLength: fw.length(),
            };
        });

        expect(decoded.type).toBe(ON_ERROR);
        expect(decoded.correlationId).toBe(correlationId);
        expect(decoded.code).toBe(code);
        expect(decoded.message).toBe(message);
        expect(decoded.length).toBe(decoded.fwLength);
    });

    it.each([
        [false, ON_PUBLICATION_READY],
        [true, ON_EXCLUSIVE_PUBLICATION_READY],
    ])('onPublicationReady with isExclusive %s is message type %i and round-trips', (isExclusive, expectedType) => {
        proxy.onPublicationReady(101, 102, 1003, -77, LOG_FILE, 12, 13, isExclusive);

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new PublicationBuffersReadyFlyweight().wrap(buffer, index);
            return {
                type,
                length,
                correlationId: fw.correlationId(),
                registrationId: fw.registrationId(),
                streamId: fw.streamId(),
                sessionId: fw.sessionId(),
                logFileName: fw.logFileName(),
                limit: fw.publicationLimitCounterId(),
                status: fw.channelStatusCounterId(),
                fwLength: fw.length(),
            };
        });

        expect(decoded).toEqual({
            type: expectedType,
            length: decoded.fwLength,
            correlationId: 101,
            registrationId: 102,
            streamId: 1003,
            sessionId: -77,
            logFileName: LOG_FILE,
            limit: 12,
            status: 13,
            fwLength: decoded.fwLength,
        });
    });

    it('onSubscriptionReady round-trips through SubscriptionReadyFlyweight', () => {
        proxy.onSubscriptionReady(2 ** 33 + 5, 99);

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new SubscriptionReadyFlyweight().wrap(buffer, index);
            return { type, length, correlationId: fw.correlationId(), status: fw.channelStatusCounterId() };
        });

        expect(decoded).toEqual({
            type: ON_SUBSCRIPTION_READY,
            length: SubscriptionReadyFlyweight.LENGTH,
            correlationId: 2 ** 33 + 5,
            status: 99,
        });
    });

    it('operationSucceeded round-trips through OperationSucceededFlyweight', () => {
        proxy.operationSucceeded(-(2 ** 40) - 3);

        const decoded = receiveOne((type, buffer, index, length) => ({
            type,
            length,
            correlationId: new OperationSucceededFlyweight().wrap(buffer, index).correlationId(),
        }));

        expect(decoded).toEqual({
            type: ON_OPERATION_SUCCESS,
            length: OperationSucceededFlyweight.LENGTH,
            correlationId: -(2 ** 40) - 3,
        });
    });

    it('onAvailableImage round-trips through ImageBuffersReadyFlyweight', () => {
        proxy.onAvailableImage(7, 1003, -5, 8, 9, LOG_FILE, '127.0.0.1:40123');

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new ImageBuffersReadyFlyweight().wrap(buffer, index);
            return {
                type,
                length,
                fwLength: fw.length(),
                correlationId: fw.correlationId(),
                streamId: fw.streamId(),
                sessionId: fw.sessionId(),
                subscriptionRegistrationId: fw.subscriptionRegistrationId(),
                positionId: fw.subscriberPositionId(),
                logFileName: fw.logFileName(),
                sourceIdentity: fw.sourceIdentity(),
            };
        });

        expect(decoded).toEqual({
            type: ON_AVAILABLE_IMAGE,
            length: decoded.fwLength,
            fwLength: decoded.fwLength,
            correlationId: 7,
            streamId: 1003,
            sessionId: -5,
            subscriptionRegistrationId: 8,
            positionId: 9,
            logFileName: LOG_FILE,
            sourceIdentity: '127.0.0.1:40123',
        });
    });

    it('onUnavailableImage round-trips through ImageMessageFlyweight', () => {
        proxy.onUnavailableImage(10, 11, 1003, CHANNEL);

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new ImageMessageFlyweight().wrap(buffer, index);
            // `length()` is valid after the channel is read
            const channel = fw.channel();
            return {
                type,
                length,
                fwLength: fw.length(),
                correlationId: fw.correlationId(),
                subscriptionRegistrationId: fw.subscriptionRegistrationId(),
                streamId: fw.streamId(),
                channel,
            };
        });

        expect(decoded).toEqual({
            type: ON_UNAVAILABLE_IMAGE,
            length: decoded.fwLength,
            fwLength: decoded.fwLength,
            correlationId: 10,
            subscriptionRegistrationId: 11,
            streamId: 1003,
            channel: CHANNEL,
        });
    });

    it('onClientTimeout round-trips through ClientTimeoutFlyweight', () => {
        proxy.onClientTimeout(2 ** 45 + 1);

        const decoded = receiveOne((type, buffer, index, length) => ({
            type,
            length,
            clientId: new ClientTimeoutFlyweight().wrap(buffer, index).clientId(),
        }));

        expect(decoded).toEqual({
            type: ON_CLIENT_TIMEOUT,
            length: ClientTimeoutFlyweight.LENGTH,
            clientId: 2 ** 45 + 1,
        });
    });

    it.each([
        ['IPv4 with a group tag', new InetSocketAddress('127.0.0.1', 40123), 77n],
        ['IPv4 without a group tag', new InetSocketAddress('10.1.2.3', 65535), null],
        ['IPv6 with a group tag', new InetSocketAddress('::1', 1), 2n ** 40n + 5n],
        ['IPv6 without a group tag', new InetSocketAddress('fe80::1234:5678', 40000), null],
    ])('onPublicationErrorFrame %s round-trips through PublicationErrorFrameFlyweight', (_name, address, groupTag) => {
        proxy.onPublicationErrorFrame(
            1,
            2,
            -3,
            4,
            2n ** 50n + 9n,
            groupTag,
            address,
            ErrorCode.GENERIC_ERROR.value(),
            'peer said no',
        );

        const decoded = receiveOne((type, buffer, index, length) => {
            const fw = new PublicationErrorFrameFlyweight().wrap(buffer, index);
            return {
                type,
                length,
                fwLength: fw.length(),
                registrationId: fw.registrationId(),
                destinationRegistrationId: fw.destinationRegistrationId(),
                sessionId: fw.sessionId(),
                streamId: fw.streamId(),
                receiverId: fw.receiverId(),
                groupTag: fw.groupTag(),
                address: fw.sourceAddress(),
                errorCode: fw.errorCode(),
                errorMessage: fw.errorMessage(),
            };
        });

        expect(decoded.type).toBe(ON_PUBLICATION_ERROR);
        expect(decoded.length).toBe(decoded.fwLength);
        expect([
            decoded.registrationId,
            decoded.destinationRegistrationId,
            decoded.sessionId,
            decoded.streamId,
        ]).toEqual([1, 2, -3, 4]);
        expect(decoded.receiverId).toBe(2n ** 50n + 9n);
        // a missing group tag is Aeron.NULL_VALUE
        expect(decoded.groupTag).toBe(null === groupTag ? BigInt(Aeron.NULL_VALUE) : groupTag);
        expect(decoded.address.getPort()).toBe(address.getPort());
        expect(decoded.address.getAddress()?.equals(address.getAddress())).toBe(true);
        expect(decoded.errorCode).toBe(ErrorCode.GENERIC_ERROR);
        expect(decoded.errorMessage).toBe('peer said no');
    });

    it('the responses of one proxy reuse one buffer and arrive in order', () => {
        proxy.operationSucceeded(1);
        proxy.onClientTimeout(2);
        proxy.onSubscriptionReady(3, 4);

        const types: number[] = [];
        for (let i = 0; i < 5; i++) {
            receiver.receive({ onMessage: (type) => types.push(type) });
        }

        expect(types).toEqual([ON_OPERATION_SUCCESS, ON_CLIENT_TIMEOUT, ON_SUBSCRIPTION_READY]);
    });

    it('toString is Java', () => {
        expect(proxy.toString()).toBe('ClientProxy{}');
    });
});
