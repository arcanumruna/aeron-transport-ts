// Not in Aeron (its tests of these classes are system tests that need a media driver): io.aeron.status over a real
// CountersManager. Each case names a mutation that turns it red.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { IllegalArgumentException, IllegalStateException } from '../../../../src/agrona/jdk.js';
import { Aeron } from '../../../../src/client/Aeron.js';
import { AeronCounters } from '../../../../src/client/AeronCounters.js';
import { ErrorCode } from '../../../../src/client/ErrorCode.js';
import { PublicationErrorFrameFlyweight } from '../../../../src/client/command/PublicationErrorFrameFlyweight.js';
import { ChannelEndpointStatus } from '../../../../src/client/status/ChannelEndpointStatus.js';
import { HeartbeatTimestamp } from '../../../../src/client/status/HeartbeatTimestamp.js';
import { LocalSocketAddressStatus } from '../../../../src/client/status/LocalSocketAddressStatus.js';
import { PublicationErrorFrame } from '../../../../src/client/status/PublicationErrorFrame.js';
import { ReadableCounter } from '../../../../src/client/status/ReadableCounter.js';
import { InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';

const MAX_SAFE = 2 ** 53 - 1;
const { METADATA_LENGTH, COUNTER_LENGTH, KEY_OFFSET, MAX_KEY_LENGTH, MAX_LABEL_LENGTH } = CountersReader;

function newManager(counters = 16): { manager: CountersManager; metadata: UnsafeBuffer; values: UnsafeBuffer } {
    const metadata = new UnsafeBuffer(new ArrayBuffer(counters * METADATA_LENGTH));
    const values = new UnsafeBuffer(new ArrayBuffer(counters * COUNTER_LENGTH));
    return { manager: new CountersManager(metadata, values), metadata, values };
}

function newTemp(): UnsafeBuffer {
    return new UnsafeBuffer(new ArrayBuffer(4096));
}

describe('StatusExtraTest', () => {
    describe('AeronCounters', () => {
        it('has the type ids of Aeron 1.53.3', () => {
            // mutation: change either id
            expect(AeronCounters.DRIVER_HEARTBEAT_TYPE_ID).toBe(11);
            expect(AeronCounters.DRIVER_LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID).toBe(14);
            expect(HeartbeatTimestamp.HEARTBEAT_TYPE_ID).toBe(11);
            expect(LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID).toBe(14);
        });
    });

    describe('ChannelEndpointStatus', () => {
        it('has the status values and names of Java', () => {
            // mutation: swap ERRORED and ACTIVE, or drop the "unknown id=" text
            expect(ChannelEndpointStatus.INITIALIZING).toBe(0);
            expect(ChannelEndpointStatus.ERRORED).toBe(-1);
            expect(ChannelEndpointStatus.ACTIVE).toBe(1);
            expect(ChannelEndpointStatus.CLOSING).toBe(2);
            expect(ChannelEndpointStatus.NO_ID_ALLOCATED).toBe(Aeron.NULL_VALUE);
            expect(ChannelEndpointStatus.status(0)).toBe('INITIALIZING');
            expect(ChannelEndpointStatus.status(-1)).toBe('ERRORED');
            expect(ChannelEndpointStatus.status(1)).toBe('ACTIVE');
            expect(ChannelEndpointStatus.status(2)).toBe('CLOSING');
            expect(ChannelEndpointStatus.status(3)).toBe('unknown id=3');
            expect(ChannelEndpointStatus.status(MAX_SAFE)).toBe('unknown id=9007199254740991');
        });

        it('MAX_CHANNEL_LENGTH is the key space less the int length', () => {
            // mutation: do not subtract SIZE_OF_INT
            expect(ChannelEndpointStatus.MAX_CHANNEL_LENGTH).toBe(MAX_KEY_LENGTH - 4);
            expect(ChannelEndpointStatus.CHANNEL_OFFSET).toBe(0);
        });

        it.each([0, 1, MAX_SAFE, -1])(
            'allocate stores the channel as the key and in the label, registration id %i',
            (registrationId) => {
                // mutation: key length without the int, label without the trailing space, or the registration id not set
                const { manager, metadata } = newManager();
                const counter = ChannelEndpointStatus.allocate(
                    newTemp(),
                    'snd-channel',
                    99,
                    manager,
                    registrationId,
                    'aeron:udp?endpoint=h:1',
                );

                const id = counter.id();
                expect(manager.getCounterTypeId(id)).toBe(99);
                expect(manager.getCounterLabel(id)).toBe('snd-channel: aeron:udp?endpoint=h:1 ');
                expect(manager.getCounterRegistrationId(id)).toBe(registrationId);
                const key = CountersReader.metaDataOffset(id) + KEY_OFFSET;
                expect(metadata.getInt(key)).toBe(22);
                expect(metadata.getStringWithoutLengthAscii(key + 4, 22)).toBe('aeron:udp?endpoint=h:1');
            },
        );

        it('a channel longer than the key space is cut to MAX_CHANNEL_LENGTH, and a full label has no trailing space', () => {
            // mutation: do not cut the channel, or add the space at MAX_LABEL_LENGTH
            const { manager, metadata } = newManager();
            const channel = 'c'.repeat(MAX_LABEL_LENGTH + 20);

            const counter = ChannelEndpointStatus.allocate(newTemp(), 'n', 1, manager, 5, channel);

            const key = CountersReader.metaDataOffset(counter.id()) + KEY_OFFSET;
            expect(metadata.getInt(key)).toBe(ChannelEndpointStatus.MAX_CHANNEL_LENGTH);
            const label = manager.getCounterLabel(counter.id());
            expect(label.length).toBe(MAX_LABEL_LENGTH);
            expect(label.startsWith('n: cccc')).toBe(true);
            expect(label.endsWith('c')).toBe(true);
        });

        it('a label one character short of the maximum still gets the trailing space', () => {
            // mutation: < MAX_LABEL_LENGTH becomes <= (writes past the label), or the space is dropped
            const { manager } = newManager();
            const channel = 'c'.repeat(MAX_LABEL_LENGTH - 4);
            const counter = ChannelEndpointStatus.allocate(newTemp(), 'n', 1, manager, 5, channel);
            const label = manager.getCounterLabel(counter.id());
            expect(label.length).toBe(MAX_LABEL_LENGTH);
            expect(label.endsWith(' ')).toBe(true);
        });
    });

    describe('HeartbeatTimestamp', () => {
        it.each([0, 1, 42, MAX_SAFE, -1, 2 ** 32])(
            'allocate, find and isActive for registration id %i',
            (registrationId) => {
                // mutation: key the counter by the counter id, not the registration id; or find matches the first heartbeat counter
                const { manager, metadata } = newManager();
                HeartbeatTimestamp.allocate(newTemp(), 'other', HeartbeatTimestamp.HEARTBEAT_TYPE_ID, manager, 7);
                const counter = HeartbeatTimestamp.allocate(
                    newTemp(),
                    'client-heartbeat',
                    HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
                    manager,
                    registrationId === 7 ? 8 : registrationId,
                );
                const id = counter.id();
                const registration = registrationId === 7 ? 8 : registrationId;

                expect(manager.getCounterLabel(id)).toBe('client-heartbeat: id=' + registration);
                expect(metadata.getLong(CountersReader.metaDataOffset(id) + KEY_OFFSET)).toBe(registration);
                expect(
                    HeartbeatTimestamp.findCounterIdByRegistrationId(
                        manager,
                        HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
                        registration,
                    ),
                ).toBe(id);
                expect(
                    HeartbeatTimestamp.isActive(manager, id, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, registration),
                ).toBe(true);
            },
        );

        it('find returns NULL_COUNTER_ID for an unknown registration id or another type', () => {
            // mutation: return 0 instead of NULL_COUNTER_ID, or ignore the type id
            const { manager } = newManager();
            HeartbeatTimestamp.allocate(newTemp(), 'h', HeartbeatTimestamp.HEARTBEAT_TYPE_ID, manager, 5);
            expect(
                HeartbeatTimestamp.findCounterIdByRegistrationId(manager, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, 6),
            ).toBe(CountersReader.NULL_COUNTER_ID);
            expect(HeartbeatTimestamp.findCounterIdByRegistrationId(manager, 12, 5)).toBe(
                CountersReader.NULL_COUNTER_ID,
            );
        });

        it('isActive is false for a freed counter, another registration id and another type', () => {
            // mutation: leave out the state check
            const { manager } = newManager();
            const counter = HeartbeatTimestamp.allocate(
                newTemp(),
                'h',
                HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
                manager,
                5,
            );
            const id = counter.id();
            expect(HeartbeatTimestamp.isActive(manager, id, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, 6)).toBe(false);
            expect(HeartbeatTimestamp.isActive(manager, id, 12, 5)).toBe(false);

            manager.free(id);

            expect(HeartbeatTimestamp.isActive(manager, id, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, 5)).toBe(false);
            expect(
                HeartbeatTimestamp.findCounterIdByRegistrationId(manager, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, 5),
            ).toBe(CountersReader.NULL_COUNTER_ID);
        });

        it('allocateCounterId aligns the label to 4 bytes after the 8 byte key', () => {
            // mutation: pass labelOffset = keyLength + 1
            const { manager } = newManager();
            const id = HeartbeatTimestamp.allocateCounterId(newTemp(), 'x', 3, manager, 1);
            expect(manager.getCounterLabel(id)).toBe('x: id=1');
            expect(HeartbeatTimestamp.REGISTRATION_ID_OFFSET).toBe(0);
        });
    });

    describe('LocalSocketAddressStatus', () => {
        function active(
            manager: CountersManager,
            channelStatusId: number,
            registrationId: number,
            address: string | null,
        ) {
            const counter = LocalSocketAddressStatus.allocate(
                newTemp(),
                manager,
                registrationId,
                channelStatusId,
                'rcv-local-sockaddr',
                LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID,
            );
            if (null !== address) {
                LocalSocketAddressStatus.updateBindAddress(
                    counter,
                    address,
                    new UnsafeBuffer(managerMetadata.get(manager)!),
                );
                counter.set(ChannelEndpointStatus.ACTIVE);
            }
            return counter;
        }

        const managerMetadata = new WeakMap<CountersManager, ArrayBuffer>();
        function newLocal(): CountersManager {
            const metadata = new ArrayBuffer(16 * METADATA_LENGTH);
            const values = new ArrayBuffer(16 * COUNTER_LENGTH);
            const manager = new CountersManager(new UnsafeBuffer(metadata), new UnsafeBuffer(values));
            managerMetadata.set(manager, metadata);
            return manager;
        }

        it('allocate writes the channel status id, a zero address length and the label', () => {
            // mutation: INITIAL_LENGTH of 4, or the registration id not set
            const manager = newLocal();
            const counter = active(manager, 77, 12345, null);
            const id = counter.id();
            expect(LocalSocketAddressStatus.INITIAL_LENGTH).toBe(8);
            expect(manager.getCounterLabel(id)).toBe('rcv-local-sockaddr: 77 ');
            expect(manager.getCounterRegistrationId(id)).toBe(12345);
            const metadata = new UnsafeBuffer(managerMetadata.get(manager)!);
            expect(metadata.getInt(CountersReader.metaDataOffset(id) + KEY_OFFSET)).toBe(77);
            expect(metadata.getInt(CountersReader.metaDataOffset(id) + KEY_OFFSET + 4)).toBe(0);
        });

        it('updateBindAddress, findAddress, findAddresses, findNumberOfAddressesByRegistrationId and isActive agree', () => {
            // mutation: compare the channel status id with the counter id, or return the first address for any channel
            const manager = newLocal();
            active(manager, 10, 500, '127.0.0.1:20121');
            active(manager, 10, 500, '[::1]:20122');
            active(manager, 11, 501, '127.0.0.1:30000');
            active(manager, 12, 502, null);

            expect(LocalSocketAddressStatus.findAddresses(manager, ChannelEndpointStatus.ACTIVE, 10)).toEqual([
                '127.0.0.1:20121',
                '[::1]:20122',
            ]);
            expect(LocalSocketAddressStatus.findAddresses(manager, ChannelEndpointStatus.ACTIVE, 11)).toEqual([
                '127.0.0.1:30000',
            ]);
            expect(LocalSocketAddressStatus.findAddresses(manager, ChannelEndpointStatus.ACTIVE, 12)).toEqual([]);
            expect(LocalSocketAddressStatus.findAddresses(manager, ChannelEndpointStatus.INITIALIZING, 10)).toEqual([]);
            expect(LocalSocketAddressStatus.findAddress(manager, ChannelEndpointStatus.ACTIVE, 10)).toBe(
                '127.0.0.1:20121',
            );
            expect(LocalSocketAddressStatus.findAddress(manager, ChannelEndpointStatus.ACTIVE, 13)).toBeNull();
            expect(LocalSocketAddressStatus.findAddress(manager, ChannelEndpointStatus.CLOSING, 10)).toBeNull();
            expect(LocalSocketAddressStatus.findNumberOfAddressesByRegistrationId(manager, 500)).toBe(2);
            expect(LocalSocketAddressStatus.findNumberOfAddressesByRegistrationId(manager, 501)).toBe(1);
            expect(LocalSocketAddressStatus.findNumberOfAddressesByRegistrationId(manager, 999)).toBe(0);
            expect(LocalSocketAddressStatus.isActive(manager, 10)).toBe(true);
            expect(LocalSocketAddressStatus.isActive(manager, 12)).toBe(false);
            expect(LocalSocketAddressStatus.isActive(manager, 99)).toBe(false);
        });

        it("an address of the longest IPv6 length is accepted, one more throws Java's message", () => {
            // mutation: > becomes >= in the length check
            const manager = newLocal();
            const counter = active(manager, 1, 1, null);
            const metadata = new UnsafeBuffer(managerMetadata.get(manager)!);
            const max = '[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]:65536';
            expect(max.length).toBe(53);
            LocalSocketAddressStatus.updateBindAddress(counter, max, metadata);
            counter.set(ChannelEndpointStatus.ACTIVE);
            expect(LocalSocketAddressStatus.findAddress(manager, ChannelEndpointStatus.ACTIVE, 1)).toBe(max);

            expect(() => LocalSocketAddressStatus.updateBindAddress(counter, max + 'x', metadata)).toThrow(
                IllegalArgumentException,
            );
            expect(() => LocalSocketAddressStatus.updateBindAddress(counter, max + 'x', metadata)).toThrow(
                'bindAddressAndPort value too long: 54 max: 53',
            );
        });

        it('an active counter with a zero address length is not an address', () => {
            // mutation: >= 0 instead of > 0 in the length test
            const manager = newLocal();
            const counter = active(manager, 5, 1, null);
            counter.set(ChannelEndpointStatus.ACTIVE);
            expect(LocalSocketAddressStatus.findAddresses(manager, ChannelEndpointStatus.ACTIVE, 5)).toEqual([]);
            expect(LocalSocketAddressStatus.findAddress(manager, ChannelEndpointStatus.ACTIVE, 5)).toBeNull();
            expect(LocalSocketAddressStatus.isActive(manager, 5)).toBe(true);
        });
    });

    describe('ReadableCounter', () => {
        it.each([0, 1, MAX_SAFE, -1, 2 ** 32, -(2 ** 32)])('reads the value %i with every getter', (value) => {
            // mutation: map the buffer at counterOffset + 8, or a length of SIZE_OF_INT
            const { manager } = newManager();
            const counter = manager.newCounter('c', 5);
            counter.set(value);

            const readable = new ReadableCounter(manager, 1234, counter.id());

            expect(readable.get()).toBe(value);
            expect(readable.getPlain()).toBe(value);
            expect(readable.getWeak()).toBe(value);
            expect(readable.registrationId()).toBe(1234);
            expect(readable.counterId()).toBe(counter.id());
            expect(readable.state()).toBe(CountersReader.RECORD_ALLOCATED);
            expect(readable.label()).toBe('c');
        });

        it.each([0, 1, MAX_SAFE, -1, 2 ** 32])(
            "reads %i from counters on a SharedArrayBuffer with get() (Java's getLongVolatile)",
            (value) => {
                // mutation: read the value buffer with a plain getInt (the high half is lost)
                const metadata = new UnsafeBuffer(new SharedArrayBuffer(16 * METADATA_LENGTH));
                const values = new UnsafeBuffer(new SharedArrayBuffer(16 * COUNTER_LENGTH));
                const manager = new CountersManager(metadata, values);
                const counter = manager.newCounter('shared');
                counter.set(value);

                const readable = new ReadableCounter(manager, 9, counter.id());

                expect(readable.get()).toBe(value);
                expect(readable.getPlain()).toBe(value);
            },
        );

        it('the two argument constructor has the registration id Aeron.NULL_VALUE', () => {
            // mutation: default to 0
            const { manager } = newManager();
            const counter = manager.newCounter('c');
            expect(new ReadableCounter(manager, counter.id()).registrationId()).toBe(Aeron.NULL_VALUE);
        });

        it('sees later updates, and close / isClosed do not touch the counter', () => {
            // mutation: copy the value at construction, or close() resets the value
            const { manager } = newManager();
            const counter = manager.newCounter('c');
            const readable = new ReadableCounter(manager, counter.id());
            expect(readable.isClosed()).toBe(false);

            counter.set(5);
            expect(readable.get()).toBe(5);
            counter.set(MAX_SAFE);
            expect(readable.get()).toBe(MAX_SAFE);

            readable.close();
            expect(readable.isClosed()).toBe(true);
            expect(counter.get()).toBe(MAX_SAFE);
        });

        it.each([
            [5, 0],
            [0, 0],
        ])('an unallocated counter %i throws IllegalStateException with state %i', (id, state) => {
            // mutation: skip the state check, or leave the state out of the message
            const { manager } = newManager();
            if (id === 0) {
                manager.free(manager.allocate('x').valueOf());
            }
            let thrown: unknown;
            try {
                new ReadableCounter(manager, id);
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(IllegalStateException);
            const expectedState = id === 0 ? CountersReader.RECORD_RECLAIMED : state;
            expect((thrown as Error).message).toBe('Counter not allocated: id=' + id + ' state=' + expectedState);
        });

        it('a counter id past the values buffer fails the bounds check', () => {
            // mutation: skip valuesBuffer.boundsCheck
            const { manager } = newManager(2);
            expect(() => new ReadableCounter(manager, 100)).toThrow();
        });
    });

    describe('PublicationErrorFrame', () => {
        function flyweight(): PublicationErrorFrameFlyweight {
            const f = new PublicationErrorFrameFlyweight().wrap(new UnsafeBuffer(new ArrayBuffer(256)), 8);
            f.registrationId(MAX_SAFE)
                .destinationRegistrationId(-1)
                .sessionId(-5)
                .streamId(1001)
                .receiverId(2n ** 32n)
                .groupTag(-BigInt(MAX_SAFE))
                .errorCode(ErrorCode.INVALID_CHANNEL)
                .errorMessage('bad channel')
                .sourceAddress(
                    new InetSocketAddress(InetAddress.getByAddress(null, Uint8Array.of(10, 0, 0, 9)), 40124),
                );
            return f;
        }

        it('set copies every field from the flyweight', () => {
            // mutation: take the session id from the stream id, or the error code ordinal instead of its value
            const frame = new PublicationErrorFrame().set(flyweight());

            expect(frame.registrationId()).toBe(MAX_SAFE);
            expect(frame.destinationRegistrationId()).toBe(-1);
            expect(frame.sessionId()).toBe(-5);
            expect(frame.streamId()).toBe(1001);
            expect(frame.receiverId()).toBe(2n ** 32n);
            expect(frame.groupTag()).toBe(-BigInt(MAX_SAFE));
            expect(frame.errorCode()).toBe(ErrorCode.INVALID_CHANNEL.value());
            expect(frame.errorMessage()).toBe('bad channel');
            expect(frame.sourceAddress()!.getPort()).toBe(40124);
            expect(frame.sourceAddress()!.getAddress()!.getHostAddress()).toBe('10.0.0.9');
        });

        it('set returns the frame, and clone is a copy that a later set does not change', () => {
            // mutation: clone returns this
            const frame = new PublicationErrorFrame();
            expect(frame.set(flyweight())).toBe(frame);

            const copy = frame.clone();
            expect(copy).not.toBe(frame);
            expect(copy.toString()).toBe(frame.toString());

            const other = flyweight();
            other.registrationId(7).streamId(8).errorMessage('other');
            frame.set(other);
            expect(copy.registrationId()).toBe(MAX_SAFE);
            expect(copy.streamId()).toBe(1001);
            expect(copy.errorMessage()).toBe('bad channel');
            expect(frame.errorMessage()).toBe('other');
        });

        it('toString has the Java format', () => {
            // mutation: change the field order or a separator
            const frame = new PublicationErrorFrame().set(flyweight());
            expect(frame.toString()).toBe(
                'PublicationErrorFrame{registrationId=9007199254740991, sessionId=-5, streamId=1001, ' +
                    'receiverId=4294967296, destinationRegistrationId=-1, groupTag=-9007199254740991, errorCode=' +
                    ErrorCode.INVALID_CHANNEL.value() +
                    ', errorMessage=bad channel, sourceAddress=' +
                    String(frame.sourceAddress()) +
                    '}',
            );
        });

        it('a new frame has zero fields and no message or address, like Java', () => {
            // mutation: default the group tag to Aeron.NULL_VALUE
            const frame = new PublicationErrorFrame();
            expect(frame.registrationId()).toBe(0);
            expect(frame.errorMessage()).toBeNull();
            expect(frame.sourceAddress()).toBeNull();
            expect(frame.toString()).toContain('errorMessage=null, sourceAddress=null}');
        });
    });
});
