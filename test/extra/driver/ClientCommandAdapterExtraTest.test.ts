// Extra tests of T17 (port-only, spec 5.3): the commands of `ClientCommandAdapter`. Every command type that the
// adapter supports is encoded with the client's flyweights at a non-zero index, decoded and dispatched with the right
// arguments; a command shorter than its fields, a channel longer than its message, an unknown type, a conductor that
// is not accepting commands and a conductor that throws are answered or left alone as Java does; the responses of the
// `ClientProxy` reach the client through a broadcast buffer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ErrorHandler } from '../../../src/agrona/ErrorHandler.js';
import { Action } from '../../../src/agrona/concurrent/ControlledMessageHandler.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { BroadcastBufferDescriptor } from '../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { BroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { BroadcastTransmitter } from '../../../src/agrona/concurrent/broadcast/BroadcastTransmitter.js';
import { CopyBroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import { ManyToOneRingBuffer } from '../../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { RingBufferDescriptor } from '../../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { RuntimeException } from '../../../src/agrona/jdk.js';
import { ControlProtocolEvents } from '../../../src/client/command/ControlProtocolEvents.js';
import { CorrelatedMessageFlyweight } from '../../../src/client/command/CorrelatedMessageFlyweight.js';
import { DestinationByIdMessageFlyweight } from '../../../src/client/command/DestinationByIdMessageFlyweight.js';
import { DestinationMessageFlyweight } from '../../../src/client/command/DestinationMessageFlyweight.js';
import { ErrorResponseFlyweight } from '../../../src/client/command/ErrorResponseFlyweight.js';
import { PublicationMessageFlyweight } from '../../../src/client/command/PublicationMessageFlyweight.js';
import { RejectImageFlyweight } from '../../../src/client/command/RejectImageFlyweight.js';
import { RemovePublicationFlyweight } from '../../../src/client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../../../src/client/command/RemoveSubscriptionFlyweight.js';
import { SubscriptionMessageFlyweight } from '../../../src/client/command/SubscriptionMessageFlyweight.js';
import { TerminateDriverFlyweight } from '../../../src/client/command/TerminateDriverFlyweight.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { ControlProtocolException } from '../../../src/client/exceptions/ControlProtocolException.js';
import { ClientCommandAdapter } from '../../../src/driver/ClientCommandAdapter.js';
import { ClientProxy } from '../../../src/driver/ClientProxy.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { type AdapterMember, type FakeConductor, fakeConductor } from '../../support/ClientCommandConductor.js';

const INDEX = 40;
const CLIENT_ID = 1_000_001;
const CORRELATION_ID = 777;
const STREAM_ID = 1_003;
const REGISTRATION_ID = 4_242;
const UDP = 'aeron:udp?endpoint=localhost:9999';
const IPC = 'aeron:ipc';
const SPY = 'aeron-spy:aeron:udp?endpoint=localhost:9999';
const TOKEN = [9, 8, 7, 6, 5];

const {
    ADD_DESTINATION,
    ADD_EXCLUSIVE_PUBLICATION,
    ADD_PUBLICATION,
    ADD_RCV_DESTINATION,
    ADD_SUBSCRIPTION,
    CLIENT_CLOSE,
    CLIENT_KEEPALIVE,
    REJECT_IMAGE,
    REMOVE_DESTINATION,
    REMOVE_DESTINATION_BY_ID,
    REMOVE_PUBLICATION,
    REMOVE_RCV_DESTINATION,
    REMOVE_SUBSCRIPTION,
    TERMINATE_DRIVER,
} = ControlProtocolEvents;

/** One command: its type, how to encode it at INDEX and the least length that is a valid message. */
interface Command {
    readonly name: string;
    readonly typeId: number;
    readonly encode: (buffer: UnsafeBuffer) => number;
    readonly minimumValidLength: number;
    /** The conductor member it dispatches to, and the arguments. */
    readonly member: AdapterMember;
    readonly args: unknown[];
}

function publication(typeId: number, channel: string, isExclusive: boolean, member: AdapterMember): Command {
    return {
        name: `${typeId === ADD_PUBLICATION ? 'ADD_PUBLICATION' : 'ADD_EXCLUSIVE_PUBLICATION'} ${channel}`,
        typeId,
        encode: (buffer) => {
            const fw = new PublicationMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.streamId(STREAM_ID).channel(channel);
            return fw.length();
        },
        minimumValidLength: PublicationMessageFlyweight.computeLength(channel.length),
        member,
        args: [channel, STREAM_ID, CORRELATION_ID, CLIENT_ID, isExclusive],
    };
}

function subscription(channel: string, member: AdapterMember): Command {
    return {
        name: `ADD_SUBSCRIPTION ${channel}`,
        typeId: ADD_SUBSCRIPTION,
        encode: (buffer) => {
            const fw = new SubscriptionMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.registrationCorrelationId(REGISTRATION_ID);
            fw.streamId(STREAM_ID).channel(channel);
            return fw.length();
        },
        minimumValidLength: SubscriptionMessageFlyweight.computeLength(channel.length),
        member,
        args: [channel, STREAM_ID, CORRELATION_ID, CLIENT_ID],
    };
}

function destination(name: string, typeId: number, member: AdapterMember): Command {
    return {
        name,
        typeId,
        encode: (buffer) => {
            const fw = new DestinationMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.registrationCorrelationId(REGISTRATION_ID).channel(UDP);
            return fw.length();
        },
        minimumValidLength: DestinationMessageFlyweight.computeLength(UDP.length),
        member,
        args: [REGISTRATION_ID, UDP, CORRELATION_ID],
    };
}

const COMMANDS: readonly Command[] = [
    publication(ADD_PUBLICATION, UDP, false, 'onAddNetworkPublication'),
    publication(ADD_PUBLICATION, IPC, false, 'onAddIpcPublication'),
    publication(ADD_EXCLUSIVE_PUBLICATION, UDP, true, 'onAddNetworkPublication'),
    publication(ADD_EXCLUSIVE_PUBLICATION, IPC, true, 'onAddIpcPublication'),
    {
        name: 'REMOVE_PUBLICATION',
        typeId: REMOVE_PUBLICATION,
        encode: (buffer) => {
            const fw = new RemovePublicationFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.registrationId(REGISTRATION_ID);
            fw.revoke(true);
            return RemovePublicationFlyweight.length();
        },
        // a client older than the flags field sends the 24 bytes of the registration id
        minimumValidLength: RemovePublicationFlyweight.length() - 8,
        member: 'onRemovePublication',
        args: [REGISTRATION_ID, CORRELATION_ID, true],
    },
    subscription(UDP, 'onAddNetworkSubscription'),
    subscription(IPC, 'onAddIpcSubscription'),
    subscription(SPY, 'onAddSpySubscription'),
    {
        name: 'REMOVE_SUBSCRIPTION',
        typeId: REMOVE_SUBSCRIPTION,
        encode: (buffer) => {
            const fw = new RemoveSubscriptionFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.registrationId(REGISTRATION_ID);
            return RemoveSubscriptionFlyweight.length();
        },
        minimumValidLength: RemoveSubscriptionFlyweight.length(),
        member: 'onRemoveSubscription',
        args: [REGISTRATION_ID, CORRELATION_ID],
    },
    destination('ADD_DESTINATION', ADD_DESTINATION, 'onAddSendDestination'),
    destination('REMOVE_DESTINATION', REMOVE_DESTINATION, 'onRemoveSendDestination'),
    destination('ADD_RCV_DESTINATION', ADD_RCV_DESTINATION, 'onAddRcvDestination'),
    destination('REMOVE_RCV_DESTINATION', REMOVE_RCV_DESTINATION, 'onRemoveRcvDestination'),
    {
        name: 'CLIENT_KEEPALIVE',
        typeId: CLIENT_KEEPALIVE,
        encode: (buffer) => {
            const fw = new CorrelatedMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            return CorrelatedMessageFlyweight.LENGTH;
        },
        minimumValidLength: CorrelatedMessageFlyweight.LENGTH,
        member: 'onClientKeepalive',
        args: [CLIENT_ID],
    },
    {
        name: 'CLIENT_CLOSE',
        typeId: CLIENT_CLOSE,
        encode: (buffer) => {
            const fw = new CorrelatedMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            return CorrelatedMessageFlyweight.LENGTH;
        },
        minimumValidLength: CorrelatedMessageFlyweight.LENGTH,
        member: 'onClientClose',
        args: [CLIENT_ID],
    },
    {
        name: 'REJECT_IMAGE',
        typeId: REJECT_IMAGE,
        encode: (buffer) => {
            const fw = new RejectImageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.imageCorrelationId(555).position(123_456).reason('bad image');
            return RejectImageFlyweight.computeLength('bad image');
        },
        minimumValidLength: RejectImageFlyweight.computeLength('bad image'),
        member: 'onRejectImage',
        args: [CORRELATION_ID, 555, 123_456, 'bad image'],
    },
    {
        name: 'REMOVE_DESTINATION_BY_ID',
        typeId: REMOVE_DESTINATION_BY_ID,
        encode: (buffer) => {
            const fw = new DestinationByIdMessageFlyweight().wrap(buffer, INDEX);
            fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
            fw.resourceRegistrationId(REGISTRATION_ID).destinationRegistrationId(REGISTRATION_ID + 1);
            return DestinationByIdMessageFlyweight.MESSAGE_LENGTH;
        },
        minimumValidLength: DestinationByIdMessageFlyweight.MESSAGE_LENGTH,
        member: 'onRemoveSendDestination',
        args: [REGISTRATION_ID, REGISTRATION_ID + 1, CORRELATION_ID],
    },
];

const NON_COMMAND_MEMBERS = new Set<AdapterMember>(['notAcceptingClientCommands']);

function dispatchedMembers(conductor: FakeConductor): string[] {
    return (Object.keys(conductor) as AdapterMember[])
        .filter((name) => !NON_COMMAND_MEMBERS.has(name) && conductor[name].mock.calls.length > 0)
        .sort();
}

describe('ClientCommandAdapter extra', () => {
    let errorHandler: { onError: Mock<ErrorHandler['onError']> };
    let sent: Array<{ correlationId: number; code: ErrorCode; message: string }>;
    let clientProxy: ClientProxy;
    let conductor: FakeConductor;
    let adapter: ClientCommandAdapter;
    let buffer: UnsafeBuffer;

    beforeEach(() => {
        errorHandler = { onError: vi.fn<ErrorHandler['onError']>() };
        sent = [];
        clientProxy = {
            onError: (correlationId: number, code: ErrorCode, message: string) => {
                sent.push({ correlationId, code, message });
            },
        } as unknown as ClientProxy;
        conductor = fakeConductor();
        adapter = new ClientCommandAdapter(errorHandler, new ManyToOneRingBuffer(newRing()), clientProxy, conductor);
        buffer = new UnsafeBuffer(new Uint8Array(1024));
    });

    function newRing(): UnsafeBuffer {
        return new UnsafeBuffer(new ArrayBuffer(1024 + RingBufferDescriptor.TRAILER_LENGTH));
    }

    describe.each(COMMANDS)('$name', (command) => {
        it('is decoded at a non-zero index and dispatched to its conductor member with its arguments', () => {
            const length = command.encode(buffer);

            const action = adapter.onMessage(command.typeId, buffer, INDEX, length);

            expect(action).toBe(Action.CONTINUE);
            expect(dispatchedMembers(conductor)).toEqual([command.member]);
            const mocked = conductor[command.member];
            expect(mocked.mock.calls).toEqual([command.args]);
            expect(sent).toEqual([]);
            expect(errorHandler.onError).not.toHaveBeenCalled();
        });

        it('is an error response, not a crash, at every length below the shortest valid message', () => {
            const length = command.encode(buffer);
            expect(length).toBeGreaterThanOrEqual(command.minimumValidLength);

            for (let shorter = 0; shorter < command.minimumValidLength; shorter++) {
                sent.length = 0;
                errorHandler.onError.mockClear();

                const action = adapter.onMessage(command.typeId, buffer, INDEX, shorter);

                expect(action, `length ${shorter}`).toBe(Action.CONTINUE);
                expect(dispatchedMembers(conductor), `length ${shorter}`).toEqual([]);
                expect(sent.length, `length ${shorter}`).toBe(1);
                expect(sent[0]!.code, `length ${shorter}`).toBe(ErrorCode.MALFORMED_COMMAND);
                expect(errorHandler.onError, `length ${shorter}`).toHaveBeenCalledTimes(1);
                expect(errorHandler.onError.mock.calls[0]![0], `length ${shorter}`).toBeInstanceOf(
                    ControlProtocolException,
                );
            }
        });

        it('is not dispatched and is aborted while the conductor is not accepting client commands', () => {
            const length = command.encode(buffer);
            conductor.notAcceptingClientCommands.mockReturnValue(true);

            const action = adapter.onMessage(command.typeId, buffer, INDEX, length);

            expect(action).toBe(Action.ABORT);
            expect(dispatchedMembers(conductor)).toEqual([]);
            expect(sent).toEqual([]);
            expect(errorHandler.onError).not.toHaveBeenCalled();
        });
    });

    it('TERMINATE_DRIVER passes the token buffer, the offset of the token in it and its length', () => {
        const fw = new TerminateDriverFlyweight().wrap(buffer, INDEX);
        fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
        fw.tokenBuffer(new UnsafeBuffer(new Uint8Array(TOKEN)), 0, TOKEN.length);

        const action = adapter.onMessage(TERMINATE_DRIVER, buffer, INDEX, fw.length());

        expect(action).toBe(Action.CONTINUE);
        expect(conductor.onTerminateDriver).toHaveBeenCalledTimes(1);
        const [tokenBuffer, tokenOffset, tokenLength] = conductor.onTerminateDriver.mock.calls[0] as unknown as [
            UnsafeBuffer,
            number,
            number,
        ];
        expect(tokenBuffer).toBe(buffer);
        expect(tokenLength).toBe(TOKEN.length);
        // Java passes the offset relative to the message; the token is at the index of the message plus that (spec D44)
        expect(tokenOffset).toBe(INDEX + TerminateDriverFlyweight.TOKEN_BUFFER_OFFSET);
        const token: number[] = [];
        for (let i = 0; i < tokenLength; i++) {
            token.push(buffer.getByte(tokenOffset + i));
        }
        expect(token).toEqual(TOKEN);
    });

    it('TERMINATE_DRIVER is an error response at every length below its token, and with a token longer than the message', () => {
        const fw = new TerminateDriverFlyweight().wrap(buffer, INDEX);
        fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
        fw.tokenBuffer(new UnsafeBuffer(new Uint8Array(TOKEN)), 0, TOKEN.length);
        const length = fw.length();

        for (let shorter = 0; shorter < length; shorter++) {
            sent.length = 0;
            adapter.onMessage(TERMINATE_DRIVER, buffer, INDEX, shorter);
            expect(sent.length, `length ${shorter}`).toBe(1);
            expect(sent[0]!.code, `length ${shorter}`).toBe(ErrorCode.MALFORMED_COMMAND);
        }
        expect(conductor.onTerminateDriver).not.toHaveBeenCalled();
    });

    it('a channel longer than the message is an error response at every length of the message up to its end', () => {
        const fw = new PublicationMessageFlyweight().wrap(buffer, INDEX);
        fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
        fw.streamId(STREAM_ID).channel(UDP);
        // the channel length field says more than the message holds, or more than the buffer
        for (const claimed of [UDP.length + 1, 1 << 20, 0x7fffffff]) {
            sent.length = 0;
            buffer.putInt(INDEX + 20, claimed);

            adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, fw.length());

            expect(dispatchedMembers(conductor), `claimed ${claimed}`).toEqual([]);
            expect(sent.length, `claimed ${claimed}`).toBe(1);
            expect(sent[0]!.code, `claimed ${claimed}`).toBe(ErrorCode.MALFORMED_COMMAND);
        }

        // a negative length passes the length check (as in Java) and fails reading the channel: still an error response
        sent.length = 0;
        buffer.putInt(INDEX + 20, -1);
        adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, fw.length());
        expect(dispatchedMembers(conductor)).toEqual([]);
        expect(sent.length).toBe(1);
        expect(sent[0]!.code).toBe(ErrorCode.GENERIC_ERROR);
    });

    it('REMOVE_PUBLICATION of 24 bytes (a client without the flags field) is not a revoke; the flags field is read at 32', () => {
        const fw = new RemovePublicationFlyweight().wrap(buffer, INDEX);
        fw.clientId(CLIENT_ID).correlationId(CORRELATION_ID);
        fw.registrationId(REGISTRATION_ID);
        fw.revoke(true);

        adapter.onMessage(REMOVE_PUBLICATION, buffer, INDEX, RemovePublicationFlyweight.length() - 8);
        adapter.onMessage(REMOVE_PUBLICATION, buffer, INDEX, RemovePublicationFlyweight.length());

        expect(conductor.onRemovePublication.mock.calls).toEqual([
            [REGISTRATION_ID, CORRELATION_ID, false],
            [REGISTRATION_ID, CORRELATION_ID, true],
        ]);
    });

    describe('an unknown command type', () => {
        // 0 and the counter commands (plan decision 8) are unknown too
        it.each([0, 0x09, 0x0a, 0x0f, 0x12, 0x13, 0xff, 0x0f01, 0x7fffffff, -1, -0x80000000])(
            'typeId %i is an UNKNOWN_COMMAND_TYPE_ID error response with correlation id 0, and nothing is dispatched',
            (typeId) => {
                const action = adapter.onMessage(typeId, buffer, 0, 0);

                expect(action).toBe(Action.CONTINUE);
                expect(dispatchedMembers(conductor)).toEqual([]);
                expect(sent).toEqual([
                    {
                        correlationId: 0,
                        code: ErrorCode.UNKNOWN_COMMAND_TYPE_ID,
                        message: 'ERROR - command typeId=' + typeId,
                    },
                ]);
                expect(errorHandler.onError).toHaveBeenCalledTimes(1);
            },
        );
    });

    describe('errors of the conductor', () => {
        function addPublicationCommand(): number {
            return COMMANDS[0]!.encode(buffer);
        }

        it('are reported to the error handler first and then to the client with the correlation id of the command', () => {
            conductor.onAddNetworkPublication.mockImplementation(() => {
                throw new RuntimeException('boom');
            });

            adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, addPublicationCommand());

            expect(errorHandler.onError).toHaveBeenCalledTimes(1);
            expect(sent).toEqual([
                { correlationId: CORRELATION_ID, code: ErrorCode.GENERIC_ERROR, message: 'RuntimeException : boom' },
            ]);
        });

        it('RESOURCE_TEMPORARILY_UNAVAILABLE is sent to the client and not to the error handler', () => {
            conductor.onAddNetworkPublication.mockImplementation(() => {
                throw new ControlProtocolException(ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE, 'busy');
            });

            adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, addPublicationCommand());

            expect(errorHandler.onError).not.toHaveBeenCalled();
            expect(sent).toEqual([
                {
                    correlationId: CORRELATION_ID,
                    code: ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
                    message: 'WARN - busy',
                },
            ]);
        });

        it('a ControlProtocolException keeps its error code', () => {
            conductor.onAddNetworkPublication.mockImplementation(() => {
                throw new ControlProtocolException(ErrorCode.INVALID_CHANNEL, 'bad channel');
            });

            adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, addPublicationCommand());

            expect(errorHandler.onError).toHaveBeenCalledTimes(1);
            expect(sent).toEqual([
                { correlationId: CORRELATION_ID, code: ErrorCode.INVALID_CHANNEL, message: 'ERROR - bad channel' },
            ]);
        });

        it('a value that is not an Error is wrapped', () => {
            conductor.onAddNetworkPublication.mockImplementation(() => {
                throw 'not an error';
            });

            adapter.onMessage(ADD_PUBLICATION, buffer, INDEX, addPublicationCommand());

            expect(errorHandler.onError).toHaveBeenCalledTimes(1);
            expect(sent.length).toBe(1);
            expect(sent[0]!.code).toBe(ErrorCode.GENERIC_ERROR);
            expect(sent[0]!.message).toContain('not an error');
        });
    });

    describe('receive', () => {
        it('reads from the ring COMMAND_DRAIN_LIMIT commands at a time and dispatches each', () => {
            const ring = new ManyToOneRingBuffer(newRing());
            const readingAdapter = new ClientCommandAdapter(errorHandler, ring, clientProxy, conductor);
            const keepalive = COMMANDS.find((c) => c.typeId === CLIENT_KEEPALIVE) as Command;
            const unknown = 932467234;
            const length = keepalive.encode(buffer);
            for (const typeId of [CLIENT_KEEPALIVE, unknown, CLIENT_CLOSE]) {
                expect(ring.write(typeId, buffer, INDEX, length)).toBe(true);
            }

            let total = 0;
            for (let i = 0; i < 3; i++) {
                const n = readingAdapter.receive();
                expect(n).toBe(Configuration.COMMAND_DRAIN_LIMIT);
                total += n;
            }

            expect(total).toBe(3);
            expect(readingAdapter.receive()).toBe(0);
            expect(conductor.onClientKeepalive.mock.calls).toEqual([[CLIENT_ID]]);
            expect(conductor.onClientClose.mock.calls).toEqual([[CLIENT_ID]]);
            expect(sent).toEqual([
                {
                    correlationId: 0,
                    code: ErrorCode.UNKNOWN_COMMAND_TYPE_ID,
                    message: 'ERROR - command typeId=' + unknown,
                },
            ]);
        });

        it('leaves the command in the ring, to be read again, while the conductor is not accepting commands', () => {
            const ring = new ManyToOneRingBuffer(newRing());
            const readingAdapter = new ClientCommandAdapter(errorHandler, ring, clientProxy, conductor);
            const keepalive = COMMANDS.find((c) => c.typeId === CLIENT_KEEPALIVE) as Command;
            ring.write(CLIENT_KEEPALIVE, buffer, INDEX, keepalive.encode(buffer));

            conductor.notAcceptingClientCommands.mockReturnValue(true);
            expect(readingAdapter.receive()).toBe(0);
            expect(conductor.onClientKeepalive).not.toHaveBeenCalled();

            conductor.notAcceptingClientCommands.mockReturnValue(false);
            expect(readingAdapter.receive()).toBe(1);
            expect(conductor.onClientKeepalive.mock.calls).toEqual([[CLIENT_ID]]);
        });
    });

    it('an error response made for a malformed command reaches the client through the broadcast buffer', () => {
        const broadcast = new UnsafeBuffer(new ArrayBuffer(4096 + BroadcastBufferDescriptor.TRAILER_LENGTH));
        const realProxy = new ClientProxy(new BroadcastTransmitter(broadcast));
        const real = new ClientCommandAdapter(errorHandler, new ManyToOneRingBuffer(newRing()), realProxy, conductor);
        const received: Array<{ type: number; correlationId: number; code: ErrorCode; message: string }> = [];
        const copyReceiver = new CopyBroadcastReceiver(new BroadcastReceiver(broadcast));
        const response = new ErrorResponseFlyweight();

        real.onMessage(ADD_SUBSCRIPTION, buffer, INDEX, 12);
        COMMANDS[0]!.encode(buffer);
        conductor.onAddNetworkPublication.mockImplementation(() => {
            throw new RuntimeException('late');
        });
        real.onMessage(ADD_PUBLICATION, buffer, INDEX, COMMANDS[0]!.encode(buffer));

        for (let i = 0; i < 4; i++) {
            copyReceiver.receive({
                onMessage: (type, buf, index) => {
                    response.wrap(buf, index);
                    received.push({
                        type,
                        correlationId: response.offendingCommandCorrelationId(),
                        code: response.errorCode(),
                        message: response.errorMessage(),
                    });
                },
            });
        }

        expect(received).toEqual([
            {
                type: ControlProtocolEvents.ON_ERROR,
                correlationId: 0,
                code: ErrorCode.MALFORMED_COMMAND,
                message: 'ERROR - command=' + ADD_SUBSCRIPTION + ' too short: length=12',
            },
            {
                type: ControlProtocolEvents.ON_ERROR,
                correlationId: CORRELATION_ID,
                code: ErrorCode.GENERIC_ERROR,
                message: 'RuntimeException : late',
            },
        ]);
    });
});
