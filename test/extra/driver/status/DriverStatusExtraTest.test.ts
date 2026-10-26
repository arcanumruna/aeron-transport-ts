// Extra tests of the T7a classes (spec 8.2): the counter factories against Java's exact type ids, key bytes and labels,
// SystemCounters, the duty cycle trackers, SessionKey, ThreadingMode, StatusUtil, AeronCounters and the allocation
// checks of the per-duty-cycle calls. Each test names the mutation of the port that turns it red.
import { describe, expect, it } from 'vitest';
import { BitUtil } from '../../../../src/agrona/BitUtil.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { Long } from '../../../../src/agrona/jdk.js';
import { StandardCharsets } from '../../../../src/agrona/jdkLang.js';
import { AeronCounters } from '../../../../src/client/AeronCounters.js';
import { ChannelEndpointStatus } from '../../../../src/client/status/ChannelEndpointStatus.js';
import { ConfigurationException } from '../../../../src/client/exceptions/ConfigurationException.js';
import { DutyCycleTracker } from '../../../../src/driver/DutyCycleTracker.js';
import type { DriverManagedResource } from '../../../../src/driver/DriverManagedResource.js';
import { MediaDriverVersion } from '../../../../src/driver/MediaDriverVersion.js';
import { SessionKey } from '../../../../src/driver/SessionKey.js';
import { ClientHeartbeatTimestamp } from '../../../../src/driver/status/ClientHeartbeatTimestamp.js';
import { DutyCycleStallTracker } from '../../../../src/driver/status/DutyCycleStallTracker.js';
import { FlowControlReceivers } from '../../../../src/driver/status/FlowControlReceivers.js';
import { MdcDestinations } from '../../../../src/driver/status/MdcDestinations.js';
import { PerImageIndicator } from '../../../../src/driver/status/PerImageIndicator.js';
import { PublisherLimit } from '../../../../src/driver/status/PublisherLimit.js';
import { PublisherPos } from '../../../../src/driver/status/PublisherPos.js';
import { ReceiveChannelStatus } from '../../../../src/driver/status/ReceiveChannelStatus.js';
import { ReceiveLocalSocketAddress } from '../../../../src/driver/status/ReceiveLocalSocketAddress.js';
import { ReceiverHwm } from '../../../../src/driver/status/ReceiverHwm.js';
import { ReceiverNaksSent } from '../../../../src/driver/status/ReceiverNaksSent.js';
import { ReceiverPos } from '../../../../src/driver/status/ReceiverPos.js';
import { SendChannelStatus } from '../../../../src/driver/status/SendChannelStatus.js';
import { SendLocalSocketAddress } from '../../../../src/driver/status/SendLocalSocketAddress.js';
import { SenderBpe } from '../../../../src/driver/status/SenderBpe.js';
import { SenderLimit } from '../../../../src/driver/status/SenderLimit.js';
import { SenderNaksReceived } from '../../../../src/driver/status/SenderNaksReceived.js';
import { SenderPos } from '../../../../src/driver/status/SenderPos.js';
import { StatusUtil } from '../../../../src/driver/status/StatusUtil.js';
import { StreamCounter } from '../../../../src/driver/status/StreamCounter.js';
import { SubscriberPos } from '../../../../src/driver/status/SubscriberPos.js';
import { SystemCounterDescriptor } from '../../../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../../../src/driver/status/SystemCounters.js';
import { ThreadingMode } from '../../../../src/driver/ThreadingMode.js';
import { expectNoAllocation } from '../../../support/Allocation.js';
import { assertThrowsExactly } from '../../../support/Assertions.js';
import { ARRAY_BACKING, BACKINGS, type Backing } from '../../../support/Backing.js';
import { AERON_COUNTERS, SYSTEM_COUNTERS } from './DriverStatusExpected.js';

const { SIZE_OF_INT, SIZE_OF_LONG, CACHE_LINE_LENGTH } = BitUtil;
const {
    COUNTER_LENGTH,
    KEY_OFFSET,
    MAX_KEY_LENGTH,
    MAX_LABEL_LENGTH,
    METADATA_LENGTH,
    RECORD_ALLOCATED,
    RECORD_RECLAIMED,
    metaDataOffset,
} = CountersReader;

const NULL_VALUE = -1;
const MAX_STREAM_CHANNEL_LENGTH = 92; // MAX_KEY_LENGTH 112 - (16 + 4)
const MAX_STATUS_CHANNEL_LENGTH = 108; // MAX_KEY_LENGTH 112 - 4
const GIT_SHA = '377943bcb8256fa5279fc4e5c6d9f2a076294222';

interface Fixture {
    readonly manager: CountersManager;
    readonly metadata: UnsafeBuffer;
    readonly values: UnsafeBuffer;
    readonly temp: UnsafeBuffer;
}

function newFixture(backing: Backing, counters = 64): Fixture {
    const metadata = new UnsafeBuffer(backing.arrayBuffer(counters * METADATA_LENGTH));
    const values = new UnsafeBuffer(backing.aligned(counters * COUNTER_LENGTH, CACHE_LINE_LENGTH));
    const manager = new CountersManager(metadata, values, StandardCharsets.US_ASCII);
    return { manager, metadata, values, temp: new UnsafeBuffer(new ArrayBuffer(1024)) };
}

function keyOf(f: Fixture, counterId: number): number {
    return metaDataOffset(counterId) + KEY_OFFSET;
}

/** The key bytes after `keyLength` up to the end of the key area are untouched (zero). */
function expectKeyAreaZeroAfter(f: Fixture, counterId: number, keyLength: number): void {
    const key = keyOf(f, counterId);
    for (let i = keyLength; i < MAX_KEY_LENGTH; i++) {
        expect(f.metadata.getByte(key + i), `key byte ${i}`).toBe(0);
    }
}

interface Params {
    readonly clientId: number;
    readonly registrationId: number;
    readonly sessionId: number;
    readonly streamId: number;
}

const PARAMS: readonly Params[] = [
    { clientId: 42, registrationId: 1234567890123, sessionId: -7, streamId: 1001 },
    { clientId: Long.MAX_VALUE, registrationId: Long.MAX_VALUE, sessionId: 2147483647, streamId: -2147483648 },
    { clientId: 0, registrationId: 0, sessionId: 0, streamId: 0 },
];

const CHANNELS: readonly string[] = [
    'aeron:udp?endpoint=localhost:40123',
    '',
    'c'.repeat(MAX_STREAM_CHANNEL_LENGTH),
    'c'.repeat(MAX_STREAM_CHANNEL_LENGTH + 1),
    'aeron:udp?endpoint=localhost:40123|alias=' + 'z'.repeat(600),
];

type Counter = UnsafeBufferPosition | AtomicCounter;

interface StreamFactory {
    readonly title: string;
    readonly typeId: number;
    readonly labelName: string;
    readonly position: boolean;
    /** The counter owner is the `clientId` argument; otherwise the factory has none and the owner is NULL_VALUE. */
    readonly hasClientId: boolean;
    make(f: Fixture, p: Params, channel: string): Counter;
}

const STREAM_FACTORIES: readonly StreamFactory[] = [
    {
        title: 'PublisherLimit',
        typeId: 1,
        labelName: 'pub-lmt',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            PublisherLimit.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'PublisherPos (concurrent)',
        typeId: 12,
        labelName: 'pub-pos (concurrent)',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            PublisherPos.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c, false),
    },
    {
        title: 'PublisherPos (exclusive)',
        typeId: 12,
        labelName: 'pub-pos (exclusive)',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            PublisherPos.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c, true),
    },
    {
        title: 'SenderPos',
        typeId: 2,
        labelName: 'snd-pos',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            SenderPos.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'SenderLimit',
        typeId: 9,
        labelName: 'snd-lmt',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            SenderLimit.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'SenderBpe',
        typeId: 13,
        labelName: 'snd-bpe',
        position: false,
        hasClientId: true,
        make: (f, p, c) =>
            SenderBpe.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'SenderNaksReceived',
        typeId: 19,
        labelName: 'snd-naks-received',
        position: false,
        hasClientId: true,
        make: (f, p, c) =>
            SenderNaksReceived.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'ReceiverHwm',
        typeId: 3,
        labelName: 'rcv-hwm',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            ReceiverHwm.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'ReceiverPos',
        typeId: 5,
        labelName: 'rcv-pos',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            ReceiverPos.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'ReceiverNaksSent',
        typeId: 20,
        labelName: 'rcv-naks-sent',
        position: false,
        hasClientId: true,
        make: (f, p, c) =>
            ReceiverNaksSent.allocate(f.temp, f.manager, p.clientId, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'SubscriberPos (no join position)',
        typeId: 4,
        labelName: 'sub-pos',
        position: true,
        hasClientId: true,
        make: (f, p, c) =>
            SubscriberPos.allocate(
                f.temp,
                f.manager,
                p.clientId,
                p.registrationId,
                p.sessionId,
                p.streamId,
                c,
                NULL_VALUE,
            ),
    },
    {
        title: 'FlowControlReceivers',
        typeId: 17,
        labelName: 'fc-receivers',
        position: false,
        hasClientId: false,
        make: (f, p, c) =>
            FlowControlReceivers.allocate(f.temp, f.manager, p.registrationId, p.sessionId, p.streamId, c),
    },
    {
        title: 'PerImageIndicator',
        typeId: 10,
        labelName: 'a-per-image-name',
        position: false,
        hasClientId: false,
        make: (f, p, c) =>
            PerImageIndicator.allocate(
                f.temp,
                'a-per-image-name',
                f.manager,
                p.registrationId,
                p.sessionId,
                p.streamId,
                c,
            ),
    },
];

describe('stream counter factories', () => {
    describe.each(BACKINGS)('over a $name counters buffer', (backing) => {
        // Mutation: any of the type ids, the NAME, or the argument order of the factory changed (for example
        // SenderPos.NAME 'snd-pos' -> 'snd-lmt', PublisherLimit's type id 1 -> 2, sessionId and streamId swapped in
        // StreamCounter.allocateCounterId, clientId and registrationId swapped in a factory).
        it.each(STREAM_FACTORIES)('$title: type id, key bytes, label, ids', (factory) => {
            for (const p of PARAMS) {
                for (const channel of CHANNELS) {
                    const f = newFixture(backing);
                    const counter = factory.make(f, p, channel);
                    const id = counter.id();
                    const where = `${factory.title} ${JSON.stringify(p)} channel length ${channel.length}`;

                    expect(id, where).toBe(0);
                    expect(f.manager.getCounterState(id), where).toBe(RECORD_ALLOCATED);
                    expect(f.manager.getCounterTypeId(id), where).toBe(factory.typeId);

                    const key = keyOf(f, id);
                    const keyChannel = channel.substring(0, MAX_STREAM_CHANNEL_LENGTH);
                    expect(f.metadata.getLong(key), where).toBe(p.registrationId);
                    expect(f.metadata.getInt(key + 8), where).toBe(p.sessionId);
                    expect(f.metadata.getInt(key + 12), where).toBe(p.streamId);
                    expect(f.metadata.getInt(key + 16), where).toBe(keyChannel.length);
                    expect(f.metadata.getStringWithoutLengthAscii(key + 20, keyChannel.length), where).toBe(keyChannel);
                    expectKeyAreaZeroAfter(f, id, 20 + keyChannel.length);

                    const label = `${factory.labelName}: ${p.registrationId} ${p.sessionId} ${p.streamId} ${channel}`;
                    expect(f.manager.getCounterLabel(id), where).toBe(label.substring(0, MAX_LABEL_LENGTH));

                    expect(f.manager.getCounterRegistrationId(id), where).toBe(p.registrationId);
                    expect(f.manager.getCounterOwnerId(id), where).toBe(factory.hasClientId ? p.clientId : NULL_VALUE);
                    expect(f.manager.getCounterValue(id), where).toBe(0);

                    // The object is the type Java returns and it wraps this counter's slot
                    expect(counter instanceof UnsafeBufferPosition, where).toBe(factory.position);
                    expect(counter instanceof AtomicCounter, where).toBe(!factory.position);
                    if (counter instanceof UnsafeBufferPosition) {
                        counter.setRelease(77);
                    } else {
                        counter.set(77);
                    }
                    expect(f.manager.getCounterValue(id), where).toBe(77);
                }
            }
        });
    });

    // Mutation: StreamCounter.MAX_CHANNEL_LENGTH computed with CHANNEL_OFFSET instead of CHANNEL_OFFSET + SIZE_OF_INT
    // (the key overruns by 4 bytes: the channel length at 92 -> 96), or the truncation in putStringWithoutLengthAscii
    // removed (a 600 byte channel overruns the 112 byte key).
    it('StreamCounter offsets and the channel truncation at its exact boundary', () => {
        expect(StreamCounter.REGISTRATION_ID_OFFSET).toBe(0);
        expect(StreamCounter.SESSION_ID_OFFSET).toBe(SIZE_OF_LONG);
        expect(StreamCounter.STREAM_ID_OFFSET).toBe(SIZE_OF_LONG + SIZE_OF_INT);
        expect(StreamCounter.CHANNEL_OFFSET).toBe(SIZE_OF_LONG + 2 * SIZE_OF_INT);
        expect(StreamCounter.MAX_CHANNEL_LENGTH).toBe(MAX_STREAM_CHANNEL_LENGTH);

        const f = newFixture(ARRAY_BACKING);
        // Java appends no "..." to a truncated channel in the key or in the label
        const long = 'a'.repeat(91) + 'bc' + 'd'.repeat(10);
        const id = StreamCounter.allocateCounterId(f.temp, 'n', 3, f.manager, 1, 2, 3, 4, long, NULL_VALUE);
        const key = keyOf(f, id);
        expect(f.metadata.getInt(key + 16)).toBe(92);
        expect(f.metadata.getStringWithoutLengthAscii(key + 20, 92)).toBe('a'.repeat(91) + 'b');
        expect(f.manager.getCounterLabel(id)).toBe('n: 2 3 4 ' + long);
    });

    // Mutation: a label cut at MAX_LABEL_LENGTH - 1 or + 1, or the cut removed (the temp buffer then holds 1000+ bytes
    // and the manager rejects the label).
    it('the label is cut at exactly MAX_LABEL_LENGTH bytes', () => {
        const f = newFixture(ARRAY_BACKING);
        const channel = 'q'.repeat(2000);
        const counter = SenderPos.allocate(f.temp, f.manager, 1, 2, 3, 4, channel);
        const label = f.manager.getCounterLabel(counter.id());
        expect(label.length).toBe(MAX_LABEL_LENGTH);
        expect(label).toBe(('snd-pos: 2 3 4 ' + channel).substring(0, MAX_LABEL_LENGTH));
    });

    // Mutation: the join position test `labelLength < MAX_LABEL_LENGTH - 20` -> `<=`, `- 19`, or `- 21`; or the
    // NULL_VALUE test removed (every subscriber label would end in " @-1"); or " @" -> "@".
    describe.each(BACKINGS)('SubscriberPos join position over a $name counters buffer', (backing) => {
        const p = { clientId: 5, registrationId: 11, sessionId: 22, streamId: 33 };
        const prefix = 'sub-pos: 11 22 33 ';

        it.each([
            // [labelLength before the suffix, whether the suffix is appended]
            [MAX_LABEL_LENGTH - 21, true],
            [MAX_LABEL_LENGTH - 20 - 1, true],
            [MAX_LABEL_LENGTH - 20, false],
            [MAX_LABEL_LENGTH - 19, false],
            [MAX_LABEL_LENGTH, false],
        ])('label length %d: join position appended %s', (labelLength, appended) => {
            const f = newFixture(backing);
            const channel = 'k'.repeat(labelLength - prefix.length);
            const counter = SubscriberPos.allocate(
                f.temp,
                f.manager,
                p.clientId,
                p.registrationId,
                p.sessionId,
                p.streamId,
                channel,
                123456789012,
            );

            const label = f.manager.getCounterLabel(counter.id());
            expect(label).toBe(prefix + channel + (appended ? ' @123456789012' : ''));
        });

        it('a join position of 0 is appended, NULL_VALUE is not', () => {
            const f = newFixture(backing);
            const a = SubscriberPos.allocate(f.temp, f.manager, 1, 2, 3, 4, 'ch', 0);
            const b = SubscriberPos.allocate(f.temp, f.manager, 1, 2, 3, 4, 'ch', NULL_VALUE);
            const c = SubscriberPos.allocate(f.temp, f.manager, 1, 2, 3, 4, 'ch', Long.MAX_VALUE);
            expect(f.manager.getCounterLabel(a.id())).toBe('sub-pos: 2 3 4 ch @0');
            expect(f.manager.getCounterLabel(b.id())).toBe('sub-pos: 2 3 4 ch');
            expect(f.manager.getCounterLabel(c.id())).toBe('sub-pos: 2 3 4 ch @9007199254740991');
            expect(f.manager.getCounterTypeId(a.id())).toBe(4);
        });
    });

    // Mutation: SubscriberPos.TYPE... PublisherPos NAME_EXCLUSIVE and NAME_CONCURRENT swapped (the ternary inverted).
    it('PublisherPos picks the label by the exclusive flag', () => {
        const f = newFixture(ARRAY_BACKING);
        const concurrent = PublisherPos.allocate(f.temp, f.manager, 1, 2, 3, 4, 'ch', false);
        const exclusive = PublisherPos.allocate(f.temp, f.manager, 1, 2, 3, 4, 'ch', true);
        expect(f.manager.getCounterLabel(concurrent.id())).toBe('pub-pos (concurrent): 2 3 4 ch');
        expect(f.manager.getCounterLabel(exclusive.id())).toBe('pub-pos (exclusive): 2 3 4 ch');
    });

    // Mutation: a type id constant of a factory class changed.
    it('the type id constants of the factory classes', () => {
        expect(PublisherLimit.PUBLISHER_LIMIT_TYPE_ID).toBe(1);
        expect(SenderPos.SENDER_POSITION_TYPE_ID).toBe(2);
        expect(ReceiverHwm.RECEIVER_HWM_TYPE_ID).toBe(3);
        expect(SubscriberPos.SUBSCRIBER_POSITION_TYPE_ID).toBe(4);
        expect(ReceiverPos.RECEIVER_POS_TYPE_ID).toBe(5);
        expect(SendChannelStatus.SEND_CHANNEL_STATUS_TYPE_ID).toBe(6);
        expect(ReceiveChannelStatus.RECEIVE_CHANNEL_STATUS_TYPE_ID).toBe(7);
        expect(SenderLimit.SENDER_LIMIT_TYPE_ID).toBe(9);
        expect(PerImageIndicator.PER_IMAGE_TYPE_ID).toBe(10);
        expect(PublisherPos.PUBLISHER_POS_TYPE_ID).toBe(12);
        expect(SenderBpe.SENDER_BPE_TYPE_ID).toBe(13);
        expect(FlowControlReceivers.FLOW_CONTROL_RECEIVERS_COUNTER_TYPE_ID).toBe(17);
        expect(MdcDestinations.MDC_DESTINATIONS_COUNTER_TYPE_ID).toBe(18);
        expect(SenderNaksReceived.TYPE_ID).toBe(19);
        expect(ReceiverNaksSent.TYPE_ID).toBe(20);
        expect(SystemCounterDescriptor.SYSTEM_COUNTER_TYPE_ID).toBe(0);
    });
});

describe('channel status and local socket address factories', () => {
    const CHANNEL_FACTORIES = [
        ['SendChannelStatus', 6, 'snd-channel', SendChannelStatus.allocate.bind(SendChannelStatus)],
        ['ReceiveChannelStatus', 7, 'rcv-channel', ReceiveChannelStatus.allocate.bind(ReceiveChannelStatus)],
        ['MdcDestinations', 18, 'mdc-num-dest', MdcDestinations.allocate.bind(MdcDestinations)],
    ] as const;

    describe.each(BACKINGS)('over a $name counters buffer', (backing) => {
        // Mutation: the NAME or type id of one of the three changed; the trailing ' ' of ChannelEndpointStatus.allocate
        // dropped; the channel cut (MAX_CHANNEL_LENGTH 108) off by one; the registration id not set.
        it.each(CHANNEL_FACTORIES)('%s: type id %d, key, label "%s: <channel> "', (title, typeId, name, allocate) => {
            for (const channel of [
                'aeron:udp?endpoint=localhost:40123',
                '',
                'e'.repeat(108),
                'e'.repeat(109),
                'e'.repeat(700),
            ]) {
                const f = newFixture(backing);
                const counter = allocate(f.temp, f.manager, 987654321987, channel);
                const id = counter.id();
                const where = `${title} channel length ${channel.length}`;
                const keyChannel = channel.substring(0, MAX_STATUS_CHANNEL_LENGTH);

                expect(f.manager.getCounterTypeId(id), where).toBe(typeId);
                expect(f.metadata.getInt(keyOf(f, id)), where).toBe(keyChannel.length);
                expect(f.metadata.getStringWithoutLengthAscii(keyOf(f, id) + 4, keyChannel.length), where).toBe(
                    keyChannel,
                );
                expectKeyAreaZeroAfter(f, id, 4 + keyChannel.length);
                const prefix = `${name}: `;
                const expected = (prefix + channel).substring(0, MAX_LABEL_LENGTH);
                // a space is appended while the label is shorter than MAX_LABEL_LENGTH
                expect(f.manager.getCounterLabel(id), where).toBe(
                    expected.length < MAX_LABEL_LENGTH ? expected + ' ' : expected,
                );
                expect(f.manager.getCounterRegistrationId(id), where).toBe(987654321987);
                expect(f.manager.getCounterOwnerId(id), where).toBe(0);
                expect(counter instanceof AtomicCounter, where).toBe(true);
                expect(f.manager.getCounterValue(id), where).toBe(0);
                counter.set(ChannelEndpointStatus.ACTIVE);
                expect(f.manager.getCounterValue(id), where).toBe(1);
            }
        });

        // Mutation: the NAME, the type id (14) or the key layout (channelStatusId at 0, address length 0 at 4) changed.
        it.each([
            [
                'SendLocalSocketAddress',
                'snd-local-sockaddr',
                SendLocalSocketAddress.allocate.bind(SendLocalSocketAddress),
            ],
            [
                'ReceiveLocalSocketAddress',
                'rcv-local-sockaddr',
                ReceiveLocalSocketAddress.allocate.bind(ReceiveLocalSocketAddress),
            ],
        ] as const)('%s: type id 14, key (channel status id, 0), label "%s: <id> "', (_title, name, allocate) => {
            const f = newFixture(backing);
            const counter = allocate(f.temp, f.manager, 555, 123456);
            const id = counter.id();
            expect(f.manager.getCounterTypeId(id)).toBe(14);
            expect(f.metadata.getInt(keyOf(f, id))).toBe(123456);
            expect(f.metadata.getInt(keyOf(f, id) + 4)).toBe(0);
            expectKeyAreaZeroAfter(f, id, 8);
            expect(f.manager.getCounterLabel(id)).toBe(`${name}: 123456 `);
            expect(f.manager.getCounterRegistrationId(id)).toBe(555);
        });

        // Mutation: the NAME 'client-heartbeat' changed, or HEARTBEAT_TYPE_ID (11) replaced.
        it('ClientHeartbeatTimestamp: type id 11, key registration id, label "client-heartbeat: id=<id>"', () => {
            const f = newFixture(backing);
            const counter = ClientHeartbeatTimestamp.allocate(f.temp, f.manager, 424242424242);
            const id = counter.id();
            expect(ClientHeartbeatTimestamp.NAME).toBe('client-heartbeat');
            expect(f.manager.getCounterTypeId(id)).toBe(11);
            expect(f.metadata.getLong(keyOf(f, id))).toBe(424242424242);
            expectKeyAreaZeroAfter(f, id, 8);
            expect(f.manager.getCounterLabel(id)).toBe('client-heartbeat: id=424242424242');
        });
    });
});

describe('SystemCounters', () => {
    describe.each(BACKINGS)('over a $name counters buffer', (backing) => {
        // Mutation: a descriptor's id or label changed, the registration id not set, the owner id not NULL_VALUE, the
        // key not holding the id, or the type id not 0.
        it('allocates every descriptor with its exact id, label, type id, key and registration id', () => {
            const f = newFixture(backing, 64);
            const systemCounters = new SystemCounters(f.manager);
            const descriptors = SystemCounterDescriptor.values();

            expect(descriptors.length).toBe(SYSTEM_COUNTERS.length);
            for (const [ordinal, [name, id, label]] of SYSTEM_COUNTERS.entries()) {
                const descriptor = descriptors[ordinal] as SystemCounterDescriptor;
                expect(descriptor.name(), name).toBe(name);
                expect(descriptor.toString(), name).toBe(name);
                expect(descriptor.ordinal(), name).toBe(ordinal);
                expect(descriptor.id(), name).toBe(id);
                expect(descriptor.label(), name).toBe(label);
                expect(SystemCounterDescriptor.get(id), name).toBe(descriptor);

                const counter = systemCounters.get(descriptor);
                expect(counter.id(), name).toBe(ordinal);
                expect(f.manager.getCounterTypeId(id), name).toBe(0);
                expect(f.metadata.getInt(keyOf(f, id)), name).toBe(id);
                expectKeyAreaZeroAfter(f, id, 4);
                expect(f.manager.getCounterLabel(id), name).toBe(label);
                expect(f.manager.getCounterRegistrationId(id), name).toBe(id);
                expect(f.manager.getCounterOwnerId(id), name).toBe(NULL_VALUE);
                expect(f.manager.getCounterValue(id), name).toBe(0);
            }

            expect(SystemCounterDescriptor.get(-1)).toBeNull();
            expect(SystemCounterDescriptor.get(SYSTEM_COUNTERS.length)).toBeNull();
        });

        // Mutation: get() indexes by the id instead of the ordinal (equal here, so make ordinal differ: swap two
        // descriptors in values()), or the counters are shared between descriptors (one counter for every descriptor).
        it("get(descriptor) returns that descriptor's own counter", () => {
            const f = newFixture(backing, 64);
            const systemCounters = new SystemCounters(f.manager);
            for (const descriptor of SystemCounterDescriptor.values()) {
                systemCounters.get(descriptor).set(1000 + descriptor.id());
            }
            for (const descriptor of SystemCounterDescriptor.values()) {
                expect(systemCounters.get(descriptor).get(), descriptor.name()).toBe(1000 + descriptor.id());
                expect(f.manager.getCounterValue(descriptor.id()), descriptor.name()).toBe(1000 + descriptor.id());
            }
        });

        // Mutation: close() skips the last counter (closeAll over a slice), or does not close at all.
        it('close frees all of them', () => {
            const f = newFixture(backing, 64);
            const systemCounters = new SystemCounters(f.manager);
            const counters = SystemCounterDescriptor.values().map((d) => systemCounters.get(d));

            systemCounters.close();

            for (const [i, counter] of counters.entries()) {
                expect(counter.isClosed(), `counter ${i} closed`).toBe(true);
                expect(f.manager.getCounterState(i), `counter ${i} reclaimed`).toBe(RECORD_RECLAIMED);
            }
            // Freed slots are reused from the lowest id
            expect(f.manager.allocate('after close')).toBe(0);
        });

        // Mutation: toString of the EnumMap form changed ("=" -> ":" or the braces).
        it('toString is the EnumMap form', () => {
            const f = newFixture(backing, 64);
            const systemCounters = new SystemCounters(f.manager);
            const text = systemCounters.toString();
            expect(text.startsWith('SystemCounters{counterByDescriptorMap={BYTES_SENT=AtomicCounter{')).toBe(true);
            expect(text.endsWith('}}')).toBe(true);
            expect(text.split('}, ').length).toBe(SYSTEM_COUNTERS.length);
            expect(text).toContain(', NATIVE_RESOURCE_AGENT_PROXY_FAILS=AtomicCounter{');
        });
    });

    // Mutation: ERRORS or AERON_VERSION label loses the version suffix, MediaDriverVersion.GIT_SHA changed.
    it('the labels with version information', () => {
        expect(MediaDriverVersion.VERSION).toBe('1.53.3');
        expect([
            MediaDriverVersion.MAJOR_VERSION,
            MediaDriverVersion.MINOR_VERSION,
            MediaDriverVersion.PATCH_VERSION,
        ]).toEqual([1, 53, 3]);
        expect(MediaDriverVersion.GIT_SHA).toBe(GIT_SHA);
        expect(SystemCounterDescriptor.ERRORS.label()).toBe('Errors: version=1.53.3 commit=' + GIT_SHA);
        expect(SystemCounterDescriptor.AERON_VERSION.label()).toBe('Aeron software: version=1.53.3 commit=' + GIT_SHA);
    });

    // Mutation: the ordinal counter of the enum starts at 1 or a constant is added in the middle.
    it('ordinals are the ids', () => {
        for (const d of SystemCounterDescriptor.values()) {
            expect(d.ordinal()).toBe(d.id());
        }
    });
});

describe('DutyCycleTracker and DutyCycleStallTracker', () => {
    const T0 = 2 ** 40 + 12345; // a nanosecond clock is large

    class Recording extends DutyCycleTracker {
        public readonly durations: number[] = [];

        public override reportMeasurement(durationNs: number): void {
            this.durations.push(durationNs);
        }
    }

    // Mutation: measureAndUpdate reports now instead of now - last, or does not store now (the next duration is
    // measured from the old time), or update() reports.
    it('measureAndUpdate reports the time since the last update and stores now', () => {
        const tracker = new Recording();
        tracker.update(T0);
        expect(tracker.durations).toEqual([]);

        tracker.measureAndUpdate(T0 + 1000);
        tracker.measureAndUpdate(T0 + 1000);
        tracker.measureAndUpdate(T0 + 3_000_000_000);
        tracker.measureAndUpdate(T0 + 2_999_999_999); // a clock that steps back reports negative

        expect(tracker.durations).toEqual([1000, 0, 2_999_999_000, -1]);
        expect(tracker.toString()).toBe('DutyCycleTracker{timeOfLastUpdateNs=' + (T0 + 2_999_999_999) + '}');
    });

    // Mutation: the initial time is not 0 (the first duration is then not `now`).
    it('the first measurement is since time 0, as in Java', () => {
        const tracker = new Recording();
        tracker.measureAndUpdate(T0);
        expect(tracker.durations).toEqual([T0]);
        expect(new DutyCycleTracker().toString()).toBe('DutyCycleTracker{timeOfLastUpdateNs=0}');
        new DutyCycleTracker().measureAndUpdate(5); // the base reportMeasurement does nothing
    });

    function newStall(thresholdNs: number): {
        tracker: DutyCycleStallTracker;
        max: AtomicCounter;
        exceeded: AtomicCounter;
        f: Fixture;
    } {
        const f = newFixture(ARRAY_BACKING);
        const max = f.manager.newCounter('max');
        const exceeded = f.manager.newCounter('exceeded');
        return { tracker: new DutyCycleStallTracker(max, exceeded, thresholdNs), max, exceeded, f };
    }

    // Mutation: `durationNs > threshold` -> `>=` (the 1000 case counts) or `> threshold + 1` (the 1001 case does not);
    // proposeMaxRelease -> setRelease (the max falls back to 5).
    it('counts the threshold exceeded only strictly above it, and keeps the maximum', () => {
        const { tracker, max, exceeded } = newStall(1000);
        let now = T0;
        tracker.update(now);

        const step = (d: number): void => {
            now += d;
            tracker.measureAndUpdate(now);
        };

        step(999);
        expect([max.get(), exceeded.get()]).toEqual([999, 0]);
        step(1000);
        expect([max.get(), exceeded.get()]).toEqual([1000, 0]);
        step(1001);
        expect([max.get(), exceeded.get()]).toEqual([1001, 1]);
        step(5);
        expect([max.get(), exceeded.get()]).toEqual([1001, 1]);
        step(2 ** 33);
        expect([max.get(), exceeded.get()]).toEqual([2 ** 33, 2]);
        step(1001);
        expect([max.get(), exceeded.get()]).toEqual([2 ** 33, 3]);
        step(0);
        expect([max.get(), exceeded.get()]).toEqual([2 ** 33, 3]);
    });

    // Mutation: the isClosed() guard removed (a closed counter would be written) or moved after the update of the time.
    it('a closed max counter makes the measurement a no-op but the time is still stored', () => {
        const { tracker, max, exceeded, f } = newStall(10);
        tracker.update(T0);
        tracker.measureAndUpdate(T0 + 50);
        expect([max.get(), exceeded.get()]).toEqual([50, 1]);

        max.close();
        f.manager.setCounterValue(max.id(), 7);
        tracker.measureAndUpdate(T0 + 100);
        expect(exceeded.get()).toBe(1);
        expect(f.manager.getCounterValue(max.id())).toBe(7);

        expect(tracker.toString()).toContain('DutyCycleStallTracker{maxCycleTime=AtomicCounter{');
    });

    // Mutation: the time stored only when the max counter is open (inside the isClosed() guard).
    it('a closed max counter still stores the time of the update', () => {
        const f = newFixture(ARRAY_BACKING);
        const max = f.manager.newCounter('max');
        const durations: number[] = [];
        const tracker = new (class extends DutyCycleStallTracker {
            public override reportMeasurement(durationNs: number): void {
                durations.push(durationNs);
                super.reportMeasurement(durationNs);
            }
        })(max, f.manager.newCounter('exceeded'), 10);
        tracker.update(T0);

        max.close();
        tracker.measureAndUpdate(T0 + 100);
        tracker.measureAndUpdate(T0 + 109);

        expect(durations).toEqual([100, 9]);
    });

    // Mutation: the accessors return the wrong counter, or the constructor stores the arguments swapped.
    it('the accessors and toString', () => {
        const { tracker, max, exceeded } = newStall(77);
        expect(tracker.maxCycleTime()).toBe(max);
        expect(tracker.cycleTimeThresholdExceededCount()).toBe(exceeded);
        expect(tracker.cycleTimeThresholdNs()).toBe(77);
        expect(tracker.toString()).toBe(
            'DutyCycleStallTracker{maxCycleTime=' +
                max.toString() +
                ', cycleTimeThresholdExceededCount=' +
                exceeded.toString() +
                ', cycleTimeThresholdNs=77}',
        );
    });
});

describe('SessionKey', () => {
    // Independent model of Java's int arithmetic
    const int = (x: bigint): bigint => BigInt.asIntN(32, x);
    function javaStringHash(s: string): bigint {
        let h = 0n;
        for (const ch of s) {
            h = int(31n * h + BigInt(ch.charCodeAt(0)));
        }
        return h;
    }
    const javaHash = (sessionId: number, streamId: number, channel: string): number =>
        Number(int(int(int(31n * BigInt(sessionId)) * BigInt(streamId)) * javaStringHash(channel)));

    // Mutation: the two constructors swap their arguments, or the 2-argument one sets sessionId to a non-zero value.
    it('the two constructors', () => {
        const a = new SessionKey(7, 'ch');
        expect([a.sessionId, a.streamId, a.channel]).toEqual([0, 7, 'ch']);
        const b = new SessionKey(5, 7, 'ch');
        expect([b.sessionId, b.streamId, b.channel]).toEqual([5, 7, 'ch']);
        expect(b.toString()).toBe('SessionKey{sessionId=5, streamId=7, channel=ch}');
    });

    // Mutation: equals ignores one of the three fields (each of the three rows below), or compares the channel by
    // length, or accepts null / another type / a subclass instance.
    it('equals compares session id, stream id and channel, and the exact class', () => {
        const key = new SessionKey(1, 2, 'ch');
        expect(key.equals(key)).toBe(true);
        expect(key.equals(new SessionKey(1, 2, 'ch'))).toBe(true);
        expect(key.equals(new SessionKey(9, 2, 'ch'))).toBe(false);
        expect(key.equals(new SessionKey(1, 9, 'ch'))).toBe(false);
        expect(key.equals(new SessionKey(1, 2, 'xx'))).toBe(false);
        expect(key.equals(null)).toBe(false);
        expect(key.equals(undefined)).toBe(false);
        expect(key.equals({ sessionId: 1, streamId: 2, channel: 'ch' })).toBe(false);
        expect(key.equals('ch')).toBe(false);
        class Sub extends SessionKey {}
        expect(key.equals(new Sub(1, 2, 'ch'))).toBe(false);
        expect(new Sub(1, 2, 'ch').equals(key)).toBe(false);

        // sessionId is not final: equality follows it
        const mutable = new SessionKey(2, 'ch');
        expect(mutable.equals(new SessionKey(0, 2, 'ch'))).toBe(true);
        mutable.sessionId = 1;
        expect(mutable.equals(key)).toBe(true);
    });

    // Mutation: `31 * sessionId * streamId * hash` -> `31 * (sessionId + streamId + hash)` or without the 31, or
    // Math.imul replaced by plain `*` (loses the low bits above 2^53).
    it("hashCode is Java's 31 * sessionId * streamId * channel.hashCode() in int arithmetic", () => {
        const rows: [number, number, string][] = [
            [1, 2, 'ch'],
            [0, 5, 'aeron:udp?endpoint=localhost:40123'],
            [-3, 7, ''],
            [123456789, -987654321, 'aeron:ipc'],
            [2147483647, 2147483647, 'aeron:udp?endpoint=224.0.1.1:40456|interface=localhost'],
            [-2147483648, -2147483648, 'z'.repeat(1000)],
        ];
        for (const [sessionId, streamId, channel] of rows) {
            expect(new SessionKey(sessionId, streamId, channel).hashCode(), `${sessionId} ${streamId}`).toBe(
                javaHash(sessionId, streamId, channel),
            );
        }
        // Java's quirk: any zero factor gives 0 (the 2-argument constructor has sessionId 0)
        expect(new SessionKey(1001, 'aeron:ipc').hashCode()).toBe(0);
        expect(new SessionKey(1, 0, 'aeron:ipc').hashCode()).toBe(0);
        expect(new SessionKey(1, 2, 'ch').hashCode()).toBe(new SessionKey(1, 2, 'ch').hashCode());
    });
});

describe('ThreadingMode and DriverManagedResource', () => {
    // Mutation: a constant renamed, reordered or removed.
    it("ThreadingMode constants in Java's ordinal order", () => {
        expect(ThreadingMode.values().map((m) => [m.name(), m.ordinal(), m.toString()])).toEqual([
            ['INVOKER', 0, 'INVOKER'],
            ['SHARED', 1, 'SHARED'],
            ['SHARED_NETWORK', 2, 'SHARED_NETWORK'],
            ['DEDICATED', 3, 'DEDICATED'],
        ]);
        expect(ThreadingMode.values()[0]).toBe(ThreadingMode.INVOKER);
        expect(ThreadingMode.values()).not.toBe(ThreadingMode.values());
    });

    // Compile-time: the interface has the three Java methods (a missing or renamed one fails `npm run typecheck`).
    it('DriverManagedResource has close, onTimeEvent and hasReachedEndOfLife', () => {
        const calls: string[] = [];
        const resource: DriverManagedResource = {
            close: () => calls.push('close'),
            onTimeEvent: (timeNs, timeMs) => calls.push(`onTimeEvent ${timeNs} ${timeMs}`),
            hasReachedEndOfLife: () => true,
        };
        resource.close();
        resource.onTimeEvent(1, 2, {});
        expect(resource.hasReachedEndOfLife()).toBe(true);
        expect(calls).toEqual(['close', 'onTimeEvent 1 2']);
    });
});

describe('StatusUtil', () => {
    describe.each(BACKINGS)('over a $name counters buffer', (backing) => {
        // Mutation: the label or id test of controllableIdleStrategy dropped (it would match another counter), or the
        // indicator made over the wrong counter id.
        it('controllableIdleStrategy finds the system counter by id and label, or returns null', () => {
            const empty = newFixture(backing, 64);
            expect(StatusUtil.controllableIdleStrategy(empty.manager)).toBeNull();

            // 22 counters that are not the system counters: the counter at position 22 has another label
            const other = newFixture(backing, 64);
            for (let i = 0; i < 23; i++) {
                other.manager.allocate('not a system counter ' + i);
            }
            expect(StatusUtil.controllableIdleStrategy(other.manager)).toBeNull();

            const f = newFixture(backing, 64);
            const systemCounters = new SystemCounters(f.manager);
            const indicator = StatusUtil.controllableIdleStrategy(f.manager);
            expect(indicator).not.toBeNull();
            systemCounters.get(SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY).set(3);
            expect(indicator?.getVolatile()).toBe(3);
            indicator?.setVolatile(9);
            expect(f.manager.getCounterValue(22)).toBe(9);
        });

        // Mutation: the type id test compares with the receive type for send (or the reverse), `startsWith` reversed
        // (stored.startsWith(channel)), or the last match not winning.
        it('sendChannelStatus and receiveChannelStatus: type, prefix match, last match wins, null', () => {
            const f = newFixture(backing, 64);
            expect(StatusUtil.sendChannelStatus(f.manager, 'aeron:udp?endpoint=a:1')).toBeNull();
            expect(StatusUtil.receiveChannelStatus(f.manager, 'aeron:udp?endpoint=a:1')).toBeNull();

            const send1 = SendChannelStatus.allocate(f.temp, f.manager, 1, 'aeron:udp?endpoint=a:1');
            const receive1 = ReceiveChannelStatus.allocate(f.temp, f.manager, 2, 'aeron:udp?endpoint=b:2');
            const send2 = SendChannelStatus.allocate(f.temp, f.manager, 3, 'aeron:udp?endpoint=a:12');
            send1.set(ChannelEndpointStatus.ACTIVE);
            receive1.set(ChannelEndpointStatus.CLOSING);
            send2.set(ChannelEndpointStatus.ERRORED);

            // The stored channel must be a prefix of the one asked for
            expect(StatusUtil.sendChannelStatus(f.manager, 'aeron:udp?endpoint=a:1|ttl=3')?.getVolatile()).toBe(
                ChannelEndpointStatus.ACTIVE,
            );
            // both stored channels are prefixes of this one: the later counter wins
            expect(StatusUtil.sendChannelStatus(f.manager, 'aeron:udp?endpoint=a:123')?.getVolatile()).toBe(
                ChannelEndpointStatus.ERRORED,
            );
            expect(StatusUtil.sendChannelStatus(f.manager, 'aeron:udp?endpoint=a:')).toBeNull();
            expect(StatusUtil.sendChannelStatus(f.manager, 'aeron:udp?endpoint=b:2')).toBeNull();
            expect(StatusUtil.receiveChannelStatus(f.manager, 'aeron:udp?endpoint=b:2')?.getVolatile()).toBe(
                ChannelEndpointStatus.CLOSING,
            );
            expect(StatusUtil.receiveChannelStatus(f.manager, 'aeron:udp?endpoint=a:1')).toBeNull();
        });
    });
});

describe('AeronCounters', () => {
    // Mutation: any constant changed (a typo in a value, a constant moved), or one missing.
    it("every type id and system counter id is Java's literal value", () => {
        const ours = Object.getOwnPropertyNames(AeronCounters).filter(
            (n) =>
                /^[A-Z0-9_]+$/.test(n) && typeof (AeronCounters as unknown as Record<string, unknown>)[n] === 'number',
        );
        expect(ours.length).toBe(AERON_COUNTERS.length);
        for (const [name, value] of AERON_COUNTERS) {
            expect((AeronCounters as unknown as Record<string, unknown>)[name], name).toBe(value);
        }
        expect(new Set(AERON_COUNTERS.map(([name]) => name)).size).toBe(AERON_COUNTERS.length);
    });

    // Mutation: a few well known values off by one.
    it('well known type ids', () => {
        expect(AeronCounters.DRIVER_SYSTEM_COUNTER_TYPE_ID).toBe(0);
        expect(AeronCounters.DRIVER_PUBLISHER_LIMIT_TYPE_ID).toBe(1);
        expect(AeronCounters.DRIVER_HEARTBEAT_TYPE_ID).toBe(11);
        expect(AeronCounters.DRIVER_LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID).toBe(14);
        expect(AeronCounters.ARCHIVE_RECORDING_POSITION_TYPE_ID).toBe(100);
        expect(AeronCounters.SYSTEM_COUNTER_ID_BYTES_SENT).toBe(0);
        expect(AeronCounters.SYSTEM_COUNTER_ID_NATIVE_RESOURCE_AGENT_PROXY_FAILS).toBe(45);
        expect(AeronCounters.SEQUENCER_SNAPSHOT_SERVICE_DESCRIBE_ERROR_COUNT_TYPE_ID).toBe(570);
    });

    // Mutation: the message text of validateCounterTypeId changed, or the comparison inverted.
    it("validateCounterTypeId passes on a match and throws Java's message on a mismatch", () => {
        const f = newFixture(ARRAY_BACKING);
        const id = f.manager.allocate('x', 77);
        AeronCounters.validateCounterTypeId(f.manager, id, 77);

        const e = assertThrowsExactly(ConfigurationException, () =>
            AeronCounters.validateCounterTypeId(f.manager, id, 78),
        );
        // AeronException prefixes the message with its category
        expect(e.message).toBe(`ERROR - The type for counterId=${id}, typeId=77 does not match the expected=78`);
    });

    // Mutation: appendVersionInfo without the separating space, or formatVersionInfo with another separator.
    it('appendVersionInfo writes a space then "version=<v> commit=<sha>" at the offset', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(128));
        const length = AeronCounters.appendVersionInfo(
            buffer,
            3,
            MediaDriverVersion.VERSION,
            MediaDriverVersion.GIT_SHA,
        );
        const text = ' version=1.53.3 commit=' + GIT_SHA;
        expect(length).toBe(text.length);
        expect(buffer.getStringWithoutLengthAscii(3, length)).toBe(text);
        expect(buffer.getByte(2)).toBe(0);
        expect(buffer.getByte(3 + length)).toBe(0);
    });

    // Mutation: setReferenceId writes at counterOffset instead of + REFERENCE_ID_OFFSET, or does not validate.
    it('setReferenceId writes the reference id slot of the counter only', () => {
        const f = newFixture(ARRAY_BACKING);
        const a = f.manager.allocate('a');
        const b = f.manager.allocate('b');
        AeronCounters.setReferenceId(f.metadata, f.values, b, 5_000_000_000_001);
        expect(f.manager.getCounterReferenceId(b)).toBe(5_000_000_000_001);
        expect(f.manager.getCounterReferenceId(a)).toBe(0);
        expect(f.manager.getCounterValue(b)).toBe(0);
    });
});

describe('allocation on the duty cycle', () => {
    const BIG = 2 ** 40;

    // The clock values are above 2^31, so V8 may box them in a heap number whenever one crosses a call that is not
    // inlined (known issue #19); the bound below is the smallest that passes, and is recorded in the report.
    // Mutation: measureAndUpdate allocates (a closure, an array or an object built per call).
    it('DutyCycleTracker.measureAndUpdate at clock values near 2^40', async () => {
        const tracker = new DutyCycleTracker();
        await expectNoAllocation((n) => {
            let now = BIG;
            for (let i = 0; i < n; i++) {
                now += 1000;
                tracker.measureAndUpdate(now);
            }
        });
    });

    // The clock values are above 2^31, so the counter writes box them in heap numbers when the call is not inlined
    // (issue #19). Whether V8 inlines it depends on the type feedback the earlier tests of the file left: run alone,
    // the loop boxes about a number per call (4 minor collections), after the other tests none, which made the test
    // flaky under parallel load (issue #33). So the bound is the one heap number per iteration of the setRelease test
    // below, whatever the feedback.
    // Mutation: reportMeasurement allocates more than that, e.g. a template string or an array per call.
    it('DutyCycleStallTracker.measureAndUpdate near 2^40, with the max and the threshold counters moving', async () => {
        const f = newFixture(ARRAY_BACKING);
        const tracker = new DutyCycleStallTracker(f.manager.newCounter('max'), f.manager.newCounter('exceeded'), 1500);
        await expectNoAllocation(
            (n) => {
                let now = BIG;
                for (let i = 0; i < n; i++) {
                    now += 1000 + (i & 1023);
                    tracker.measureAndUpdate(now);
                }
            },
            undefined,
            1,
        );
        expect(tracker.cycleTimeThresholdExceededCount().get()).toBeGreaterThan(0);
    });

    // Mutation: SystemCounters.get allocates (for example an object-keyed Map lookup that boxes or an Array.find).
    it('SystemCounters get + AtomicCounter.increment', async () => {
        const f = newFixture(ARRAY_BACKING);
        const systemCounters = new SystemCounters(f.manager);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                systemCounters.get(SystemCounterDescriptor.BYTES_SENT).increment();
                systemCounters.get(SystemCounterDescriptor.HEARTBEATS_SENT).incrementRelease();
            }
        });
        expect(systemCounters.get(SystemCounterDescriptor.BYTES_SENT).get()).toBeGreaterThan(0);
    });

    // Mutation: setRelease allocates (a closure or an object per call): the small-value loop then fails too.
    it('SystemCounters counter setRelease with values below 2^31', async () => {
        const f = newFixture(ARRAY_BACKING);
        const counter = new SystemCounters(f.manager).get(SystemCounterDescriptor.BYTES_SENT);
        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                counter.setRelease(i & 0x3fffffff);
            }
        });
    });

    // Known issue #19: a value above 2^31 is a double, and V8 boxes it in a heap number when it crosses a call that is
    // not inlined. The long write path (putLongRelease) takes it as a parameter, so one heap number per call is the
    // floor; the bound is 1 heap number per iteration, the smallest that passes (0 does not).
    // Mutation: setRelease allocates more than the one box (a second heap number, a closure or an object per call).
    it('SystemCounters counter setRelease with values near 2^40 (at most one heap number, issue #19)', async () => {
        const f = newFixture(ARRAY_BACKING);
        const counter = new SystemCounters(f.manager).get(SystemCounterDescriptor.BYTES_SENT);
        await expectNoAllocation(
            (n) => {
                let value = BIG;
                for (let i = 0; i < n; i++) {
                    value += 1000;
                    counter.setRelease(value);
                }
            },
            undefined,
            1,
        );
        expect(counter.get()).toBeGreaterThan(BIG);
    });
});
