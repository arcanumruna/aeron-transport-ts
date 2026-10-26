// Tests that Aeron does not have (spec 8.2): the parts of UdpChannel that UdpChannelTest leaves out. Each test names
// the mutation of src/driver/media/UdpChannel.ts (or ControlMode.ts) that turns it red.
import { describe, expect, it } from 'vitest';
import {
    IllegalArgumentException,
    Integer,
    LongOverflowError,
    NullPointerException,
    NumberFormatException,
} from '../../../../src/agrona/jdk.js';
import { stringHashCode } from '../../../../src/agrona/jdkUtil.js';
import { getCause, throwableToString } from '../../../../src/agrona/jdkThrowable.js';
import { ChannelUri } from '../../../../src/client/ChannelUri.js';
import { DefaultNameResolver } from '../../../../src/driver/DefaultNameResolver.js';
import { InvalidChannelException } from '../../../../src/driver/exceptions/InvalidChannelException.js';
import { InetAddress, InetSocketAddress, UnknownHostException } from '../../../../src/driver/jdkNet.js';
import { ControlMode } from '../../../../src/driver/media/ControlMode.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import type { NameResolver } from '../../../../src/driver/NameResolver.js';
import { assertEqualsObject, assertThrowsExactly } from '../../../support/Assertions.js';

/** Parses and returns the cause of the `InvalidChannelException` that the parse must throw. */
function causeOfInvalid(channel: string): Error {
    const ex = assertThrowsExactly(InvalidChannelException, () => UdpChannel.parse(channel));
    return getCause(ex) as Error;
}

function suffixOf(channel: UdpChannel, prefix: string): number {
    const form = channel.canonicalForm();
    expect(form.startsWith(prefix)).toBe(true);
    expect(form.substring(prefix.length)).toMatch(/^[0-9]+$/);
    return Number(form.substring(prefix.length));
}

/** Resolves every name to a fixed address, or to nothing, under a chosen `name()`. */
class FixedNameResolver implements NameResolver {
    public constructor(private readonly displayName: string) {}

    public resolve(_name: string, _uriParamName: string, _isReResolution: boolean): InetAddress | null {
        return null;
    }

    public lookup(name: string, _uriParamName: string, _isReLookup: boolean): string {
        return name;
    }

    public name(): string {
        return this.displayName;
    }
}

describe('UdpChannelExtraTest', () => {
    describe('canonical form', () => {
        // Mutation: in the final `else` branch of parse, `'-' + uniqueCanonicalFormValue++` becomes
        // `'-' + uniqueCanonicalFormValue` (the increment is dropped).
        it('channelWithoutEndpointOrControlGetsANewSuffixEachTime', () => {
            const first = UdpChannel.parse('aeron:udp?control-mode=manual');
            const second = UdpChannel.parse('aeron:udp?control-mode=manual');

            const prefix = 'UDP-0.0.0.0:0-0.0.0.0:0-';
            expect(first.canonicalForm()).not.toBe(second.canonicalForm());
            expect(suffixOf(second, prefix)).toBe(suffixOf(first, prefix) + 1);
            expect(first.equals(second)).toBe(false);
        });

        // Mutation: in the `control` branch of parse, `'-' + uniqueCanonicalFormValue++` becomes
        // `'-' + uniqueCanonicalFormValue`.
        it('channelWithControlOnPortZeroGetsANewSuffixEachTime', () => {
            const first = UdpChannel.parse('aeron:udp?control=127.0.0.1:0|control-mode=dynamic');
            const second = UdpChannel.parse('aeron:udp?control=127.0.0.1:0|control-mode=dynamic');

            const prefix = 'UDP-127.0.0.1:0-0.0.0.0:0-';
            expect(suffixOf(second, prefix)).toBe(suffixOf(first, prefix) + 1);
        });

        // Mutation: in the final `else` branch of parse, `null !== tagIdStr ? '#' + tagIdStr :` becomes
        // `false ? '#' + tagIdStr :` (the tag is no longer used).
        it('channelsWithTheSameTagShareACanonicalFormAndOtherTagsDiffer', () => {
            const first = UdpChannel.parse('aeron:udp?control-mode=manual|tags=1001');
            const second = UdpChannel.parse('aeron:udp?control-mode=manual|tags=1001');
            const other = UdpChannel.parse('aeron:udp?control-mode=manual|tags=1002');

            expect(first.canonicalForm()).toBe('UDP-0.0.0.0:0-0.0.0.0:0#1001');
            expect(second.canonicalForm()).toBe('UDP-0.0.0.0:0-0.0.0.0:0#1001');
            expect(other.canonicalForm()).toBe('UDP-0.0.0.0:0-0.0.0.0:0#1002');
            expect(first.equals(second)).toBe(true);
            expect(first.equals(other)).toBe(false);
        });

        // Mutation: in parse, `!isDestination &&` is removed from `requiresAdditionalSuffix`.
        it('destinationChannelHasNoSuffix', () => {
            const resolver = DefaultNameResolver.INSTANCE;
            const first = UdpChannel.parse('aeron:udp?control-mode=manual', resolver, true);
            const second = UdpChannel.parse('aeron:udp?control-mode=manual', resolver, true);

            expect(first.canonicalForm()).toBe('UDP-0.0.0.0:0-0.0.0.0:0');
            expect(first.equals(second)).toBe(true);
        });

        // Mutation: in parse, `endpointAddress.getPort() === 0` in `requiresAdditionalSuffix` becomes `true`.
        it('channelWithAFixedEndpointPortHasNoSuffix', () => {
            const first = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
            const second = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');

            expect(first.canonicalForm()).toBe('UDP-0.0.0.0:0-127.0.0.1:9999');
            expect(first.equals(second)).toBe(true);
        });

        // Mutation: in parse, `endpointAddress.getPort() === 0` in `requiresAdditionalSuffix` becomes `false`.
        it('channelWithEndpointOnPortZeroGetsANewSuffixEachTime', () => {
            const first = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0');
            const second = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0');

            const prefix = 'UDP-0.0.0.0:0-127.0.0.1:0-';
            expect(suffixOf(second, prefix)).toBe(suffixOf(first, prefix) + 1);
        });
    });

    describe('control mode', () => {
        // Mutation: the `default` of parseControlMode returns `ControlMode.DYNAMIC`.
        it('unknownControlModeValueIsNone', () => {
            expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080|control-mode=bogus').controlMode()).toBe(
                ControlMode.NONE,
            );
            expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080|control-mode=Manual').controlMode()).toBe(
                ControlMode.NONE,
            );
            expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080').controlMode()).toBe(ControlMode.NONE);
        });

        // Mutation: the text of the "URIs for UDP must specify" message ends `control-mode=manual: ` instead of
        // `control-mode=manual/response: `.
        it('unknownControlModeAloneIsRejectedWithJavasMessage', () => {
            const ex = assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.parse('aeron:udp?control-mode=bogus'),
            );
            const cause = getCause(ex) as Error;

            expect(cause).toBeInstanceOf(IllegalArgumentException);
            expect(cause.message).toBe(
                'URIs for UDP must specify an endpoint, control, tags, or control-mode=manual/response: ' +
                    'aeron:udp?control-mode=bogus',
            );
            expect(ex.message).toBe(throwableToString(cause));
        });

        // Mutation: the text of the "explicit control expected" message loses `with dynamic control mode`.
        it('dynamicControlModeWithoutControlHasJavasMessage', () => {
            const cause = causeOfInvalid('aeron:udp?endpoint=localhost:8080|control-mode=dynamic');

            expect(cause).toBeInstanceOf(IllegalArgumentException);
            expect(cause.message).toBe(
                'explicit control expected with dynamic control mode: aeron:udp?endpoint=localhost:8080|control-mode=dynamic',
            );
        });

        // Mutation: ControlMode.isMultiDestination also returns true for RESPONSE.
        it('controlModeFlags', () => {
            const rows: [string, ControlMode, boolean, boolean][] = [
                ['aeron:udp?endpoint=localhost:8080', ControlMode.NONE, false, false],
                ['aeron:udp?control=localhost:8080|control-mode=dynamic', ControlMode.DYNAMIC, true, true],
                ['aeron:udp?control=localhost:8080|control-mode=manual', ControlMode.MANUAL, true, true],
                ['aeron:udp?control=localhost:8080|control-mode=response', ControlMode.RESPONSE, false, false],
            ];

            for (const [uri, mode, multiDestination, groupSemantics] of rows) {
                const channel = UdpChannel.parse(uri);
                expect(channel.controlMode()).toBe(mode);
                expect(channel.isMultiDestination()).toBe(multiDestination);
                expect(channel.hasGroupSemantics()).toBe(groupSemantics);
                expect(channel.isDynamicControlMode()).toBe(ControlMode.DYNAMIC === mode);
                expect(channel.isManualControlMode()).toBe(ControlMode.MANUAL === mode);
                expect(channel.isResponseControlMode()).toBe(ControlMode.RESPONSE === mode);
            }

            expect(
                UdpChannel.parse('aeron:udp?endpoint=224.10.9.9:40124|interface=localhost').hasGroupSemantics(),
            ).toBe(true);
        });

        // Mutation: ControlMode.values() lists RESPONSE before MANUAL.
        it('controlModeEnumHasJavasOrdinalsAndNames', () => {
            expect(ControlMode.values().map((m) => m.name())).toEqual(['NONE', 'DYNAMIC', 'MANUAL', 'RESPONSE']);
            expect(ControlMode.values().map((m) => m.ordinal())).toEqual([0, 1, 2, 3]);
            expect(String(ControlMode.MANUAL)).toBe('MANUAL');
        });
    });

    describe('socket buffer and window lengths', () => {
        // Mutation: `size > Integer.MAX_VALUE` in parseBufferLength becomes `size >= Integer.MAX_VALUE`.
        it('lengthOfIntegerMaxValueIsAccepted', () => {
            const channel = UdpChannel.parse(
                'aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=2147483647|so-rcvbuf=2147483647|rcv-wnd=2147483647',
            );

            expect(channel.socketSndbufLength()).toBe(Integer.MAX_VALUE);
            expect(channel.socketRcvbufLength()).toBe(Integer.MAX_VALUE);
            expect(channel.receiverWindowLength()).toBe(Integer.MAX_VALUE);
        });

        // Mutation: the range check in parseBufferLength is removed (the value is then cut to an int, which is
        // negative).
        it.each([
            ['so-sndbuf', '2147483648'],
            ['so-rcvbuf', '2147483648'],
            ['rcv-wnd', '2147483648'],
            ['so-sndbuf', '2g'],
            ['so-rcvbuf', '4g'],
            ['rcv-wnd', '8589934592'],
        ])('lengthAboveIntegerMaxValueIsRejected %s %s', (param, value) => {
            const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|' + param + '=' + value);

            expect(cause).toBeInstanceOf(IllegalArgumentException);
            expect(cause.message).toBe('Invalid ' + param + ' length: ' + sizeOf(value));
        });

        // Mutation: the `ex instanceof LongOverflowError` test in the catch of parse is removed.
        it('lengthAboveTheLongRangeOfANumberIsAnInvalidChannelNotARangeError', () => {
            const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=9007199254740993');

            expect(cause).toBeInstanceOf(LongOverflowError);
            expect((cause as LongOverflowError).value).toBe(9007199254740993n);
        });

        // Mutation: parseBufferLength passes `paramValue` through `Integer.parseInt` instead of `parseSize`.
        it('lengthSuffixesAndMalformedValues', () => {
            const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=4k|so-rcvbuf=1m|rcv-wnd=0');
            expect(channel.socketSndbufLength()).toBe(4096);
            expect(channel.socketRcvbufLength()).toBe(1048576);
            expect(channel.receiverWindowLength()).toBe(0);

            const negative = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=-1');
            expect(negative).toBeInstanceOf(NumberFormatException);
            expect(negative.message).toBe('so-sndbuf must be positive: -1');

            expect(causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|rcv-wnd=12x')).toBeInstanceOf(
                NumberFormatException,
            );
        });

        // Mutation: socketSndbufLengthOrDefault reads the receive buffer length.
        it('orDefaultAccessorsUseTheirOwnField', () => {
            const set = UdpChannel.parse(
                'aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=4096|so-rcvbuf=8192|rcv-wnd=16384',
            );
            expect(set.socketSndbufLengthOrDefault(7)).toBe(4096);
            expect(set.socketRcvbufLengthOrDefault(7)).toBe(8192);
            expect(set.receiverWindowLengthOrDefault(7)).toBe(16384);

            const unset = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
            expect(unset.socketSndbufLengthOrDefault(7)).toBe(7);
            expect(unset.socketRcvbufLengthOrDefault(8)).toBe(8);
            expect(unset.receiverWindowLengthOrDefault(9)).toBe(9);
        });
    });

    describe('timestamp offsets', () => {
        // Mutation: `0 <= this._channelSendTimestampOffset` becomes `0 < this._channelSendTimestampOffset`, and the
        // same for the receive offset.
        it.each([
            [undefined, -1, false],
            ['reserved', -8, true],
            ['0', 0, true],
            ['8', 8, true],
            ['-1', -1, false],
            ['-7', -7, false],
            ['-8', -8, true],
        ])('timestampOffsetAndEnabledFlag %s', (value, offset, enabled) => {
            const suffix =
                undefined === value ? '' : '|channel-rcv-ts-offset=' + value + '|channel-snd-ts-offset=' + value;
            const channel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999' + suffix);

            expect(channel.channelReceiveTimestampOffset()).toBe(offset);
            expect(channel.channelSendTimestampOffset()).toBe(offset);
            expect(channel.isChannelReceiveTimestampEnabled()).toBe(enabled);
            expect(channel.isChannelSendTimestampEnabled()).toBe(enabled);
        });

        // Mutation: the message of parseTimestampOffset says `or the keyword` instead of `or the 'reserved' keyword`.
        it('invalidTimestampOffsetHasJavasMessageAndCause', () => {
            for (const param of ['channel-rcv-ts-offset', 'channel-snd-ts-offset']) {
                const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|' + param + '=abc');

                expect(cause).toBeInstanceOf(IllegalArgumentException);
                expect(cause.message).toBe("timestamp offset must be a valid integer or the 'reserved' keyword");
                expect(getCause(cause)).toBeInstanceOf(NumberFormatException);
            }
        });
    });

    describe('multicast', () => {
        // Mutation: getMulticastControlAddress adds 2 to the last byte instead of 1.
        it('controlAddressIsTheDataAddressPlusOneAndWrapsTheLastByte', () => {
            const plain = UdpChannel.parse('aeron:udp?endpoint=224.0.1.3:20000|interface=localhost');
            assertEqualsObject(new InetSocketAddress(InetAddress.getByName('224.0.1.4'), 20000), plain.remoteControl());

            // 255 is odd; the byte wraps to 0 as Java's `byte++` does
            const wrapped = UdpChannel.parse('aeron:udp?endpoint=224.0.1.255:20000|interface=localhost');
            assertEqualsObject(
                new InetSocketAddress(InetAddress.getByName('224.0.1.0'), 20000),
                wrapped.remoteControl(),
            );

            const v6 = UdpChannel.parse('aeron:udp?endpoint=[FF01::FD]:20000|interface=localhost');
            assertEqualsObject(new InetSocketAddress(InetAddress.getByName('ff01::fe'), 20000), v6.remoteControl());
        });

        // Mutation: the text of the validateDataAddress message changes.
        it('evenDataAddressHasJavasMessage', () => {
            const cause = causeOfInvalid('aeron:udp?endpoint=224.0.1.2:20000|interface=localhost');

            expect(cause).toBeInstanceOf(IllegalArgumentException);
            expect(cause.message).toBe('multicast data address must be odd');
        });

        // Mutation: parse does not call `hasMulticastTtl(true)`.
        it('multicastTtl', () => {
            const withTtl = UdpChannel.parse('aeron:udp?endpoint=224.0.1.1:20000|interface=localhost|ttl=16');
            expect(withTtl.hasMulticastTtl()).toBe(true);
            expect(withTtl.multicastTtl()).toBe(16);
            expect(withTtl.isMulticast()).toBe(true);

            const without = UdpChannel.parse('aeron:udp?endpoint=224.0.1.1:20000|interface=localhost');
            expect(without.hasMulticastTtl()).toBe(false);

            // the ttl is read for multicast only
            const unicast = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:20000|ttl=16');
            expect(unicast.hasMulticastTtl()).toBe(false);
            expect(unicast.isMulticast()).toBe(false);

            const cause = causeOfInvalid('aeron:udp?endpoint=224.0.1.1:20000|interface=localhost|ttl=abc');
            expect(cause).toBeInstanceOf(NumberFormatException);
        });
    });

    describe('tags', () => {
        // Mutation: parse does not call `hasTagId(true)`.
        it('tagParsing', () => {
            const tagged = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=1001');
            expect(tagged.hasTag()).toBe(true);
            expect(tagged.tag()).toBe(1001);

            const untagged = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
            expect(untagged.hasTag()).toBe(false);

            const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|tags=abc');
            expect(cause).toBeInstanceOf(NumberFormatException);
            expect(cause.message).toBe('For input string: "abc"');
        });

        // Mutation: the text of the group tag message says `does not hold` instead of `does not contain`.
        it('groupTagBoundaries', () => {
            expect(UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999').groupTag()).toBeNull();
            expect(UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|gtag=0').groupTag()).toBe(0);
            expect(UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|gtag=-5').groupTag()).toBe(-5);
            expect(UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|gtag=9007199254740991').groupTag()).toBe(
                9007199254740991,
            );

            for (const bad of ['foo', '', '1.5', '0x10']) {
                const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|gtag=' + bad);
                expect(cause).toBeInstanceOf(IllegalArgumentException);
                expect(cause.message).toBe("'gtag' does not contain a valid long value");
                expect(getCause(cause)).toBeInstanceOf(NumberFormatException);
            }

            // Java accepts 2^53 + 1; a number cannot hold it (spec D5), so the channel is rejected
            const cause = causeOfInvalid('aeron:udp?endpoint=127.0.0.1:9999|gtag=9007199254740993');
            expect(cause).toBeInstanceOf(LongOverflowError);
        });

        // Mutation: parseOptionalDurationNs calls `SystemUtil.parseSize` instead of `parseDuration`.
        it('nakDelayUnits', () => {
            const delay = (value: string) =>
                UdpChannel.parse('aeron:udp?endpoint=localhost:8080|nak-delay=' + value).nakDelayNs();

            expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080').nakDelayNs()).toBeNull();
            expect(delay('100')).toBe(100);
            expect(delay('5ns')).toBe(5);
            expect(delay('27us')).toBe(27_000);
            expect(delay('34ms')).toBe(34_000_000);
            expect(delay('2s')).toBe(2_000_000_000);
            expect(causeOfInvalid('aeron:udp?endpoint=localhost:8080|nak-delay=-1')).toBeInstanceOf(
                NumberFormatException,
            );
            expect(causeOfInvalid('aeron:udp?endpoint=localhost:8080|nak-delay=5x')).toBeInstanceOf(
                NumberFormatException,
            );
        });
    });

    describe('equality and tag matching', () => {
        // Mutation: equals compares the original URI strings instead of the canonical forms.
        it('equalsAndHashCodeUseTheCanonicalForm', () => {
            const a = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');
            const b = UdpChannel.parse('aeron:udp?endpoint=localhost:40124|mtu=1408');
            const c = UdpChannel.parse('aeron:udp?endpoint=localhost:40125');

            expect(a.originalUriString()).not.toBe(b.originalUriString());
            expect(a.equals(b)).toBe(true);
            expect(a.hashCode()).toBe(b.hashCode());
            expect(a.hashCode()).toBe(stringHashCode('UDP-0.0.0.0:0-localhost:40124'));
            expect(a.equals(c)).toBe(false);
            expect(a.equals(a)).toBe(true);
            expect(a.equals(null)).toBe(false);
            expect(a.equals(undefined)).toBe(false);
            expect(a.equals('UDP-0.0.0.0:0-localhost:40124')).toBe(false);
            expect(a.toString()).toBe(a.canonicalForm());
        });

        // Mutation: matchesTag drops `!this._hasTag || ` from its first test.
        it('matchesTagIsFalseWithoutATagOnEitherSide', () => {
            const untagged = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
            const tagZero = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=0');

            expect(untagged.matchesTag(tagZero, null, null)).toBe(false);
            expect(tagZero.matchesTag(untagged, null, null)).toBe(false);
        });

        // Mutation: matchesTag drops `this._tag !== udpChannel.tag()` from its first test.
        it('matchesTagIsFalseForADifferentTag', () => {
            const a = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0|tags=7');
            const b = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=8');

            expect(a.matchesTag(b, null, null)).toBe(false);
        });

        // Mutation: hasMatchingAddress has `false ||` where it has `this.isWildcard() ||`.
        it('wildcardChannelMatchesAnyAddressWithTheSameTag', () => {
            const wildcard = UdpChannel.parse('aeron:udp?endpoint=0.0.0.0:0|tags=7');
            const other = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=7');

            expect(wildcard.matchesTag(other, null, null)).toBe(true);
        });

        // Mutation: the text of the mismatched control-mode message changes.
        it('matchesTagThrowsForAMismatchedControlMode', () => {
            const manual = 'aeron:udp?control=127.0.0.1:9999|control-mode=manual|tags=7';
            const dynamic = 'aeron:udp?control=127.0.0.1:9999|control-mode=dynamic|tags=7';
            const a = UdpChannel.parse(manual);
            const b = UdpChannel.parse(dynamic);

            const ex = assertThrowsExactly(IllegalArgumentException, () => a.matchesTag(b, null, null));
            expect(ex.message).toBe('matching tag=7 has mismatched control-mode: ' + manual + ' <> ' + dynamic);

            // a channel with no control mode matches any control mode
            const none = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=7');
            expect(none.controlMode()).toBe(ControlMode.NONE);
            const manualEndpoint = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|control-mode=manual|tags=7');
            expect(none.matchesTag(manualEndpoint, null, null)).toBe(true);
        });

        // Mutation: hasMatchingAddress ignores the remote port (`this.remoteData().getPort() === ...` becomes `true`).
        it('matchesTagThrowsForAMismatchedEndpointAndAcceptsOverrides', () => {
            const aUri = 'aeron:udp?endpoint=127.0.0.1:9999|tags=7';
            const bUri = 'aeron:udp?endpoint=127.0.0.1:9998|tags=7';
            const a = UdpChannel.parse(aUri);
            const b = UdpChannel.parse(bUri);

            const ex = assertThrowsExactly(IllegalArgumentException, () => a.matchesTag(b, null, null));
            expect(ex.message).toBe('matching tag=7 has mismatched endpoint or control: ' + aUri + ' <> ' + bUri);

            // the override replaces the other channel's remote address
            expect(a.matchesTag(b, null, new InetSocketAddress('127.0.0.1', 9999))).toBe(true);
            // an override of the local address that differs mismatches again
            assertThrowsExactly(IllegalArgumentException, () =>
                a.matchesTag(b, new InetSocketAddress('127.0.0.2', 0), new InetSocketAddress('127.0.0.1', 9999)),
            );
        });

        // Mutation: hasMatchingAddress has `true &&` where it compares the local addresses.
        it('matchesTagThrowsForAMismatchedLocalAddress', () => {
            const a = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|interface=127.0.0.1|tags=7');
            const b = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=7');

            assertThrowsExactly(IllegalArgumentException, () => a.matchesTag(b, null, null));
            expect(a.matchesTag(b, new InetSocketAddress('127.0.0.1', 0), null)).toBe(true);
        });
    });

    describe('name resolution errors', () => {
        // Mutation: the endpoint message uses `nameResolver.constructor.name` instead of `nameResolver.name()`.
        it('unresolvedEndpointNamesTheResolverByName', () => {
            const ex = assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.parse('aeron:udp?endpoint=unknown.example:1234', new FixedNameResolver('CustomName')),
            );
            const cause = getCause(ex) as Error;

            expect(cause).toBeInstanceOf(UnknownHostException);
            expect(cause.message).toBe('unresolved - endpoint=unknown.example:1234, name-resolver=CustomName');
        });

        // Mutation: the control message uses `nameResolver.name()` instead of `nameResolver.constructor.name`.
        it('unresolvedControlNamesTheResolverClass', () => {
            const ex = assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.parse(
                    'aeron:udp?control=unknown.example:1234|control-mode=dynamic',
                    new FixedNameResolver('CustomName'),
                ),
            );
            const cause = getCause(ex) as Error;

            expect(cause).toBeInstanceOf(UnknownHostException);
            expect(cause.message).toBe('unresolved - control=unknown.example:1234, name-resolver=FixedNameResolver');
        });

        // Mutation: validateMedia does not call `requireNonNull`, so a null URI is a TypeError.
        it('nullChannelUriIsAnInvalidChannelWithANullPointerCause', () => {
            const ex = assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.isMulticastDestinationAddress(null as unknown as ChannelUri),
            );
            expect(getCause(ex)).toBeInstanceOf(NullPointerException);

            assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.destinationAddress(null as unknown as ChannelUri, DefaultNameResolver.INSTANCE),
            );
        });

        // Mutation: the text of the validateMedia message changes.
        it('nonUdpMediaHasJavasMessage', () => {
            const cause = causeOfInvalid('aeron:ipc');

            expect(cause).toBeInstanceOf(IllegalArgumentException);
            expect(cause.message).toBe('UdpChannel only supports UDP media: aeron:ipc');
        });
    });

    describe('accessors', () => {
        // Mutation: description() leaves out `, ttl: `.
        it('descriptionAndOriginalUri', () => {
            const uri = 'aeron:udp?interface=127.0.0.1|endpoint=192.168.0.1:20000';
            const channel = UdpChannel.parse(uri);

            expect(channel.description()).toBe('localData: 127.0.0.1:0, remoteData: 192.168.0.1:20000, ttl: 0');
            expect(channel.originalUriString()).toBe(uri);
            expect(channel.channelUri().get('endpoint')).toBe('192.168.0.1:20000');
            expect(channel.hasExplicitEndpoint()).toBe(true);
            expect(channel.hasExplicitControl()).toBe(false);
            expect(channel.localInterface()).toBeNull();
        });

        // Mutation: the `control` branch of parse calls `hasExplicitControl(false)` instead of `hasExplicitControl(true)`.
        it('explicitEndpointAndControlFlags', () => {
            const control = UdpChannel.parse('aeron:udp?control=127.0.0.1:9999|control-mode=dynamic');
            expect(control.hasExplicitControl()).toBe(true);
            expect(control.hasExplicitEndpoint()).toBe(false);

            const manual = UdpChannel.parse('aeron:udp?control-mode=manual');
            expect(manual.hasExplicitControl()).toBe(false);
            expect(manual.hasExplicitEndpoint()).toBe(false);
        });

        // Mutation: destinationAddress returns the address of the `control` parameter.
        it('destinationAddressAndMulticastEndpoint', () => {
            const resolver = DefaultNameResolver.INSTANCE;
            const address = UdpChannel.destinationAddress(
                ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:9999'),
                resolver,
            );
            assertEqualsObject(new InetSocketAddress('127.0.0.1', 9999), address);

            assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.destinationAddress(ChannelUri.parse('aeron:udp?mtu=1408'), resolver),
            );
            assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.destinationAddress(ChannelUri.parse('aeron:ipc'), resolver),
            );

            expect(UdpChannel.isMulticastEndpoint('224.0.1.1:20000')).toBe(true);
            expect(UdpChannel.isMulticastEndpoint('127.0.0.1:20000')).toBe(false);
            assertEqualsObject(
                new InetSocketAddress('127.0.0.1', 9999),
                UdpChannel.resolve('127.0.0.1:9999', 'endpoint', false, resolver),
            );
        });
    });

    // Mutant M2: `ControlMode.RESPONSE !== controlMode` dropped from the "must specify" check.
    it('responseControlModeAloneIsAccepted', () => {
        const channel = UdpChannel.parse('aeron:udp?control-mode=response');

        expect(channel.controlMode()).toBe(ControlMode.RESPONSE);
        expect(channel.canonicalForm()).toMatch(/^UDP-0\.0\.0\.0:0-0\.0\.0\.0:0-[0-9]+$/);
        expect(channel.hasExplicitEndpoint()).toBe(false);
        expect(channel.hasExplicitControl()).toBe(false);
    });

    // Mutant M3: `&& null === tagIdStr` dropped from hasNoDistinguishingCharacteristic.
    it('tagsAloneAreADistinguishingCharacteristic', () => {
        const channel = UdpChannel.parse('aeron:udp?tags=1001');

        expect(channel.controlMode()).toBe(ControlMode.NONE);
        expect(channel.hasTag()).toBe(true);
        expect(channel.tag()).toBe(1001);
        expect(channel.canonicalForm()).toBe('UDP-0.0.0.0:0-0.0.0.0:0#1001');
    });

    // Mutant M4: isWildcard ignores the local port.
    it('channelWithAnyEndpointButALocalPortIsNotAWildcard', () => {
        const aUri = 'aeron:udp?endpoint=0.0.0.0:0|interface=0.0.0.0:5555|tags=7';
        const bUri = 'aeron:udp?endpoint=127.0.0.1:9999|tags=7';
        const a = UdpChannel.parse(aUri);
        const b = UdpChannel.parse(bUri);

        const ex = assertThrowsExactly(IllegalArgumentException, () => a.matchesTag(b, null, null));
        expect(ex.message).toBe('matching tag=7 has mismatched endpoint or control: ' + aUri + ' <> ' + bUri);
    });

    // Mutant M5: isWildcard ignores the local address.
    it('channelWithAnyEndpointButALocalAddressIsNotAWildcard', () => {
        const a = UdpChannel.parse('aeron:udp?endpoint=0.0.0.0:0|interface=127.0.0.1|tags=7');
        const b = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|tags=7');

        assertThrowsExactly(IllegalArgumentException, () => a.matchesTag(b, null, null));
    });

    // Mutant M26: equals drops the class test (Java: getClass() != o.getClass()).
    it('equalsIsFalseForAnotherClassWithTheSameCanonicalForm', () => {
        const a = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');

        expect(a.equals({ _canonicalForm: a.canonicalForm() })).toBe(false);
    });

    // Mutants M29 / M30: isMulticastDestinationAddress / destinationAddress check only for null, not the media.
    it('destinationOfANonUdpUriWithAnEndpointIsRejected', () => {
        const ipcMulticast = ChannelUri.parse('aeron:ipc?endpoint=224.0.1.1:40124');
        const ex = assertThrowsExactly(InvalidChannelException, () =>
            UdpChannel.isMulticastDestinationAddress(ipcMulticast),
        );
        const cause = getCause(ex) as Error;
        expect(cause).toBeInstanceOf(IllegalArgumentException);
        expect(cause.message).toBe('UdpChannel only supports UDP media: aeron:ipc?endpoint=224.0.1.1:40124');

        const ipcUnicast = ChannelUri.parse('aeron:ipc?endpoint=127.0.0.1:9999');
        const ex2 = assertThrowsExactly(InvalidChannelException, () =>
            UdpChannel.destinationAddress(ipcUnicast, DefaultNameResolver.INSTANCE),
        );
        expect(getCause(ex2)).toBeInstanceOf(IllegalArgumentException);
    });
});

/** The size in bytes that `SystemUtil.parseSize` gives the value, as the message prints it. */
function sizeOf(value: string): string {
    const units: Record<string, number> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    const unit = units[value.charAt(value.length - 1)];
    return String(undefined === unit ? Number(value) : Number(value.substring(0, value.length - 1)) * unit);
}
