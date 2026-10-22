// Not in Aeron: the kill tests of the T6 review (survivors of the mutation run, and the 64 bit receiver id).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import { CncFileDescriptor } from '../../../../src/client/CncFileDescriptor.js';
import { PublicationErrorFrameFlyweight } from '../../../../src/client/command/PublicationErrorFrameFlyweight.js';
import { RejectImageFlyweight } from '../../../../src/client/command/RejectImageFlyweight.js';
import { ErrorCode } from '../../../../src/client/ErrorCode.js';
import { ChannelEndpointStatus } from '../../../../src/client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../../../src/client/status/LocalSocketAddressStatus.js';
import { PublicationErrorFrame } from '../../../../src/client/status/PublicationErrorFrame.js';
import { ReadableCounter } from '../../../../src/client/status/ReadableCounter.js';
import { InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';

const { METADATA_LENGTH, COUNTER_LENGTH, MAX_LABEL_LENGTH } = CountersReader;

function newManager(): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(16 * METADATA_LENGTH)),
        new UnsafeBuffer(new ArrayBuffer(16 * COUNTER_LENGTH)),
    );
}

describe('T6ReviewKillExtraTest', () => {
    // F1 (blocker): a receiver id is a random 64-bit value (ReceiveChannelEndpointThreadLocals: UUID msb ^ lsb, then
    // ++), and the group tag is any long. The driver copies both from the ERR frame (ErrorFlyweight, bigint in D5) into
    // this flyweight (ClientProxy.onPublicationErrorFrame), and the client reads them back (PublicationErrorFrame.set).
    it('publicationErrorFrameCarriesARandom64BitReceiverIdAndGroupTagAdversarialRegression', () => {
        const ab = new ArrayBuffer(256);
        const dv = new DataView(ab);
        const flyweight = new PublicationErrorFrameFlyweight().wrap(new UnsafeBuffer(ab), 0);
        flyweight
            .registrationId(7)
            .destinationRegistrationId(-1)
            .sessionId(1)
            .streamId(2)
            .errorCode(ErrorCode.GENERIC_ERROR)
            .errorMessage('x')
            .sourceAddress(new InetSocketAddress(InetAddress.getByAddress(null, Uint8Array.of(10, 0, 0, 1)), 4000));
        // what a Java or C driver writes for receiverId / groupTag
        dv.setBigInt64(24, -0x7edcba9876543211n, true);
        dv.setBigInt64(32, 0x123456789abcdef0n, true);

        // the client conductor's onError path: PublicationErrorFrame.set(flyweight) must not throw
        const frame = new PublicationErrorFrame();
        expect(() => frame.set(flyweight)).not.toThrow();
        expect(frame.receiverId()).toBe(-0x7edcba9876543211n);
        expect(frame.groupTag()).toBe(0x123456789abcdef0n);
    });

    // M17 survivor: findNumberOfAddressesByRegistrationId must only count local socket address counters.
    it('findNumberOfAddressesByRegistrationIdIgnoresOtherTypesWithTheSameRegistrationIdRegression', () => {
        const manager = newManager();
        const temp = new UnsafeBuffer(new ArrayBuffer(4096));
        LocalSocketAddressStatus.allocate(temp, manager, 42, 1, 'rcv-local-sockaddr', 14);
        const other = ChannelEndpointStatus.allocate(temp, 'rcv-channel', 7, manager, 42, 'aeron:udp?endpoint=x:1');
        expect(manager.getCounterRegistrationId(other.id())).toBe(42);
        expect(LocalSocketAddressStatus.findNumberOfAddressesByRegistrationId(manager, 42)).toBe(1);
    });

    // M18 survivor: the channel in the label is cut to what is left of MAX_LABEL_LENGTH, so a temp buffer of one
    // metadata record (Aeron's conductor temp buffer size) is never written past.
    it('channelEndpointStatusLabelNeverWritesPastMaxLabelLengthInTheTempBufferRegression', () => {
        const manager = newManager();
        const temp = new UnsafeBuffer(new ArrayBuffer(METADATA_LENGTH));
        const channel = 'aeron:udp?endpoint=' + 'h'.repeat(900);
        const counter = ChannelEndpointStatus.allocate(temp, 'n'.repeat(100), 6, manager, 1, channel);
        expect(manager.getCounterLabel(counter.id()).length).toBe(MAX_LABEL_LENGTH);
    });

    // M19 survivor: state() reads the record state, so a freed counter is not RECORD_ALLOCATED.
    it('readableCounterStateFollowsTheRecordAfterFreeRegression', () => {
        const manager = newManager();
        const id = manager.allocate('c');
        const counter = new ReadableCounter(manager, 5, id);
        expect(counter.state()).toBe(CountersReader.RECORD_ALLOCATED);
        manager.free(id);
        expect(counter.state()).toBe(CountersReader.RECORD_RECLAIMED);
    });

    // M10 survivor (ordering, not observable on one thread): signalCncReady publishes the version with Java's
    // putIntVolatile, the release that orders the plain fillMetaData stores before it.
    it('signalCncReadyUsesPutIntVolatileAsJavaRegression', () => {
        const source = readFileSync(new URL('../../../../src/client/CncFileDescriptor.ts', import.meta.url), 'utf8');
        const body = source.slice(source.indexOf('public static signalCncReady'));
        expect(body.slice(0, body.indexOf('}'))).toMatch(
            /cncMetaDataBuffer\.putIntVolatile\(\s*CncFileDescriptor\.CNC_VERSION_FIELD_OFFSET/,
        );
    });

    // F5: Java computes MINIMUM_SIZE + reasonBufferLength() in int arithmetic, so a
    // reason length near Integer.MAX_VALUE wraps negative and passes validateLength.
    it('rejectImageValidateLengthWrapsAsJavaIntArithmeticRegression', () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(64));
        const flyweight = new RejectImageFlyweight().wrap(buffer, 0);
        buffer.putInt(32, 0x7ffffff0);
        // Java: 36 + 0x7ffffff0 overflows to a negative int, so `36 < negative` is false: no exception
        expect(() => flyweight.validateLength(0x10, 36)).not.toThrow();
    });

    // F5 (nit): Java's isCncFileLengthSufficient sums ints and wraps.
    it('isCncFileLengthSufficientWrapsAsJavaIntArithmeticRegression', () => {
        const metaData = new UnsafeBuffer(new ArrayBuffer(128));
        metaData.putInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET, 0x7fffffff);
        metaData.putInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET, 0x7fffffff);
        // Java: 128 + 2 * 0x7fffffff wraps to 126
        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, 126)).toBe(true);
    });
});
