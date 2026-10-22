// Not in Aeron: the interaction matrix of the channel URIs (plan T12): parse -> toString -> parse, builder -> string ->
// parse, every parameter name of CommonContext, tags, aliases, IPv6 endpoints, malformed input with the exact
// messages, and the validation errors of the builder.
import { describe, expect, it } from 'vitest';
import {
    IllegalArgumentException,
    IllegalStateException,
    NumberFormatException,
    TimeUnit,
} from '../../../src/agrona/jdk.js';
import { ChannelUri } from '../../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../../src/client/ChannelUriStringBuilder.js';
import { CommonContext } from '../../../src/client/CommonContext.js';
import { assertThrows } from '../../support/Assertions.js';

/** Every `*_PARAM_NAME` of CommonContext, with the value used for it below. */
const PARAM_NAMES: string[] = Object.entries(CommonContext)
    .filter(([name, value]) => name.endsWith('_PARAM_NAME') && typeof value === 'string')
    .map(([, value]) => value as string);

function message(executable: () => unknown, type: new (...args: never[]) => Error = IllegalArgumentException): string {
    return assertThrows(type, executable).message;
}

describe('ChannelUri extra', () => {
    describe('every parameter name', () => {
        it('coversTheWholeCommonContextList', () => {
            expect(PARAM_NAMES.length).toBe(39);
            expect(new Set(PARAM_NAMES).size).toBe(PARAM_NAMES.length);
            expect(PARAM_NAMES).toContain('endpoint');
            expect(PARAM_NAMES).toContain('pub-wnd');
        });

        it.each(PARAM_NAMES)('parseToStringParseKeepsTheParameter %s', (name) => {
            const uriString = 'aeron:udp?' + name + '=v1:2';
            const parsed = ChannelUri.parse(uriString);

            expect(parsed.get(name)).toBe('v1:2');
            expect(parsed.containsKey(name)).toBe(true);
            expect(parsed.toString()).toBe(uriString);
            expect(ChannelUri.parse(parsed.toString()).equals(parsed)).toBe(true);
            expect(parsed.remove(name)).toBe('v1:2');
            expect(parsed.containsKey(name)).toBe(false);
            expect(parsed.toString()).toBe('aeron:udp');
        });

        it('parseToStringParseWithAllParametersAtOnce', () => {
            const uriString = 'aeron:ipc?' + PARAM_NAMES.map((name, i) => name + '=' + i).join('|');
            const parsed = ChannelUri.parse(uriString);

            PARAM_NAMES.forEach((name, i) => expect(parsed.get(name)).toBe(String(i)));
            const again = ChannelUri.parse(parsed.toString());
            expect(again.equals(parsed)).toBe(true);
            expect(again.hashCode()).toBe(parsed.hashCode());
            expect(again.diff(parsed).size).toBe(0);
            expect(parsed.toString().split('|').length).toBe(PARAM_NAMES.length);
        });

        it('lastValueOfARepeatedKeyWins', () => {
            const parsed = ChannelUri.parse('aeron:udp?ttl=1|ttl=2|ttl=3');

            expect(parsed.get('ttl')).toBe('3');
            expect(parsed.toString()).toBe('aeron:udp?ttl=3');
        });

        it('anEmptyValueIsKept', () => {
            const parsed = ChannelUri.parse('aeron:udp?alias=|ttl=1');

            expect(parsed.get('alias')).toBe('');
            expect(parsed.containsKey('alias')).toBe(true);
            expect(ChannelUri.parse('aeron:udp?alias=').toString()).toBe('aeron:udp?alias=');
        });

        it('aValueMayContainEqualsAndColonsAndBrackets', () => {
            const parsed = ChannelUri.parse('aeron:udp?alias=a=b=c:[d]');

            expect(parsed.get('alias')).toBe('a=b=c:[d]');
        });
    });

    describe('prefix, media and accessors', () => {
        it('prefixAndMediaCanBeChanged', () => {
            const uri = ChannelUri.parse('aeron:udp?endpoint=h:1');

            expect(uri.prefix('aeron-spy')).toBe(uri);
            expect(uri.toString()).toBe('aeron-spy:aeron:udp?endpoint=h:1');
            expect(uri.prefix('aeron-spy:')).toBe(uri);
            expect(uri.toString()).toBe('aeron-spy:aeron:udp?endpoint=h:1');
            expect(uri.prefix('')).toBe(uri);
            expect(uri.toString()).toBe('aeron:udp?endpoint=h:1');
            expect(uri.media('ipc')).toBe(uri);
            expect(uri.isIpc()).toBe(true);
            expect(uri.isUdp()).toBe(false);
            expect(message(() => uri.media('tcp'))).toBe('unknown media: tcp');
            expect(uri.media()).toBe('ipc');
        });

        it('aSpyPrefixIsRecognisedAndOthersAreRejected', () => {
            expect(ChannelUri.parse('aeron-spy:aeron:udp').prefix()).toBe('aeron-spy');
            expect(ChannelUri.parse('aeron:udp').prefix()).toBe('');
            expect(message(() => ChannelUri.parse('aeron-spy:udp'))).toBe(
                "Aeron URIs must start with 'aeron:', found: aeron-spy:udp",
            );
            expect(message(() => ChannelUri.parse('aeron-spy:aeron-spy:aeron:udp'))).toBe(
                "Aeron URIs must start with 'aeron:', found: aeron-spy:aeron-spy:aeron:udp",
            );
        });

        it('putGetRemoveAndDefaults', () => {
            const uri = ChannelUri.parse('aeron:ipc');

            expect(uri.put('k', 'v')).toBeNull();
            expect(uri.put('k', 'w')).toBe('v');
            expect(uri.get('k')).toBe('w');
            expect(uri.get('k', 'd')).toBe('w');
            expect(uri.get('missing', 'd')).toBe('d');
            expect(uri.get('missing', null)).toBeNull();
            expect(uri.remove('k')).toBe('w');
            expect(uri.remove('k')).toBeNull();
        });
    });

    describe('tags', () => {
        it.each([
            ['aeron:udp', null, null],
            ['aeron:udp?tags=7', '7', null],
            ['aeron:udp?tags=7,8', '7', '8'],
            ['aeron:udp?tags=7,8,9', '7', '8'],
            ['aeron:udp?tags=,', '', ''],
            ['aeron:udp?tags=', '', null],
            ['aeron:udp?tags=a,,c', 'a', ''],
        ])('channelTagAndEntityTag %s', (uri, channelTag, entityTag) => {
            const parsed = ChannelUri.parse(uri);

            expect(parsed.channelTag()).toBe(channelTag);
            expect(parsed.entityTag()).toBe(entityTag);
        });

        it('tagsAreTakenAtParseTimeAndTheDiffNamesThem', () => {
            const a = ChannelUri.parse('aeron:udp?tags=1,2');
            const b = ChannelUri.parse('aeron:udp?tags=1,2,3');

            expect(a.equals(b)).toBe(false);
            // the parameter difference ('1,2 != 1,2,3') is replaced by the tags difference under the same key
            expect(a.diff(b)).toEqual(new Map([['tags', '[1, 2] != [1, 2, 3]']]));
        });

        it.each([
            ['tag:5', true, 5],
            ['tag:-5', true, -5],
            ['tag:0', true, 0],
            ['tag:9007199254740991', true, 9007199254740991],
            ['5', false, -1],
            ['', false, -1],
            ['tag', false, -1],
            ['TAG:5', false, -1],
            [' tag:5', false, -1],
        ])('isTaggedAndGetTag %s', (value, tagged, tag) => {
            expect(ChannelUri.isTagged(value)).toBe(tagged);
            expect(ChannelUri.getTag(value)).toBe(tag);
        });

        it('getTagOfAnEmptyOrMalformedTagThrows', () => {
            expect(() => ChannelUri.getTag('tag:')).toThrow();
            expect(() => ChannelUri.getTag('tag:abc')).toThrow();
            expect(() => ChannelUri.getTag('tag:9007199254740992')).toThrow(RangeError);
        });
    });

    describe('IPv6 endpoints and aliases', () => {
        it('anIpv6EndpointRoundTrips', () => {
            const uriString = 'aeron:udp?endpoint=[fe80::1%eth0]:40123|interface=[::1]:0';
            const parsed = ChannelUri.parse(uriString);

            expect(parsed.get('endpoint')).toBe('[fe80::1%eth0]:40123');
            expect(parsed.get('interface')).toBe('[::1]:0');
            expect(ChannelUri.parse(parsed.toString()).equals(parsed)).toBe(true);
            expect(new ChannelUriStringBuilder(uriString).endpoint()).toBe('[fe80::1%eth0]:40123');
            expect(ChannelUri.parse(new ChannelUriStringBuilder(uriString).build()).equals(parsed)).toBe(true);
        });

        it('wildcardPortReplacementWorksOnIpv6', () => {
            const uri = ChannelUri.parse('aeron:udp?endpoint=[::1]:0');
            uri.replaceEndpointWildcardPort('[::1]:5555');
            expect(uri.get('endpoint')).toBe('[::1]:5555');
            expect(ChannelUri.replacePortWithWildcard('[::1]:5555')).toBe('[::1]:0');
            expect(ChannelUri.replacePortWithWildcard('host:80')).toBe('host:0');
            expect(ChannelUri.replacePortWithWildcard('host')).toBeNull();
            expect(ChannelUri.replacePortWithWildcard(null)).toBeNull();
        });

        it('replaceEndpointWildcardPortMessages', () => {
            const uri = ChannelUri.parse('aeron:udp?endpoint=h:0');

            expect(message(() => uri.replaceEndpointWildcardPort('h'))).toBe('No port specified on resolvedEndpoint=h');
            expect(message(() => uri.replaceEndpointWildcardPort('h:0'))).toBe(
                'Wildcard port specified on resolvedEndpoint=h:0',
            );
            expect(assertThrows(Error, () => uri.replaceEndpointWildcardPort(null)).message).toBe(
                'resolvedEndpoint is null',
            );
        });

        it('addSessionIdAddsAndReplaces', () => {
            expect(ChannelUri.addSessionId('aeron:ipc', -7)).toBe('aeron:ipc?session-id=-7');
            expect(ChannelUri.addSessionId('aeron:ipc?session-id=1', 2)).toBe('aeron:ipc?session-id=2');
        });

        it('aliasHelpersKeepOtherParameters', () => {
            // the order of the parameters is that of the hash map, so the results are compared as channels
            const same = (actual: string, expected: string): void =>
                expect(ChannelUri.parse(actual).equals(ChannelUri.parse(expected))).toBe(true);

            same(ChannelUri.addAliasIfAbsent('aeron:udp?endpoint=h:1', 'a b'), 'aeron:udp?endpoint=h:1|alias=a b');
            same(
                ChannelUri.transformAlias('aeron:udp?alias=x|ttl=1', (a) => (a ?? '') + 'y'),
                'aeron:udp?alias=xy|ttl=1',
            );
            expect(ChannelUri.transformAlias('aeron:udp?alias=x|ttl=1', () => null)).toBe('aeron:udp?ttl=1');
        });

        it('controlModeResponse', () => {
            expect(ChannelUri.isControlModeResponse('aeron:udp?control-mode=response')).toBe(true);
            expect(ChannelUri.isControlModeResponse('aeron:udp?control-mode=manual')).toBe(false);
            expect(ChannelUri.isControlModeResponse('aeron:udp')).toBe(false);
            expect(ChannelUri.parse('aeron:udp?control-mode=response').hasControlModeResponse()).toBe(true);
        });
    });

    describe('malformed input and the exact messages', () => {
        it.each([
            ['', IllegalArgumentException, "Aeron URIs must start with 'aeron:', found: "],
            ['foo', IllegalArgumentException, "Aeron URIs must start with 'aeron:', found: foo"],
            ['aeron', IllegalArgumentException, "Aeron URIs must start with 'aeron:', found: aeron"],
            ['AERON:udp', IllegalArgumentException, "Aeron URIs must start with 'aeron:', found: AERON:udp"],
            ['aeron:', IllegalArgumentException, 'unknown media: '],
            ['aeron:foo', IllegalArgumentException, 'unknown media: foo'],
            ['aeron:UDP', IllegalArgumentException, 'unknown media: UDP'],
            [
                'aeron:udp:',
                IllegalArgumentException,
                "encountered ':' within media definition at index 9 in aeron:udp:",
            ],
            [
                'aeron:udp|x=1',
                IllegalArgumentException,
                "encountered '|' within media definition at index 9 in aeron:udp|x=1",
            ],
            [
                'aeron:udp=1',
                IllegalArgumentException,
                "encountered '=' within media definition at index 9 in aeron:udp=1",
            ],
            ['aeron:udp?=x', IllegalStateException, 'empty key not allowed at index 10 in aeron:udp?=x'],
            ['aeron:udp?a=1|=2', IllegalStateException, 'empty key not allowed at index 14 in aeron:udp?a=1|=2'],
            ['aeron:udp?a|b=1', IllegalStateException, 'invalid end of key at index 11 in aeron:udp?a|b=1'],
            ['aeron:udp?|', IllegalStateException, 'invalid end of key at index 10 in aeron:udp?|'],
            ['aeron:udp?', IllegalStateException, 'no more input found, state=PARAMS_KEY in aeron:udp?'],
            ['aeron:udp?a', IllegalStateException, 'no more input found, state=PARAMS_KEY in aeron:udp?a'],
            ['aeron:udp?a=1|', IllegalStateException, 'no more input found, state=PARAMS_KEY in aeron:udp?a=1|'],
            ['aeron:udp?a=1|b', IllegalStateException, 'no more input found, state=PARAMS_KEY in aeron:udp?a=1|b'],
        ] as [string, new (...args: never[]) => Error, string][])('parseRejects %j', (uri, type, expected) => {
            expect(assertThrows(type, () => ChannelUri.parse(uri)).constructor).toBe(type);
            expect(message(() => ChannelUri.parse(uri), type)).toBe(expected);
        });

        it('theMaximumLengthIsAcceptedAndOneMoreIsNot', () => {
            const prefix = 'aeron:ipc?alias=';
            const atMax = prefix + 'x'.repeat(ChannelUri.MAX_URI_LENGTH - prefix.length);
            const parsed = ChannelUri.parse(atMax);

            expect(atMax.length).toBe(4095);
            expect(parsed.get('alias')!.length).toBe(4095 - prefix.length);
            expect(parsed.toString()).toBe(atMax);
            expect(() => ChannelUri.parse(atMax + 'x')).toThrow(IllegalArgumentException);
        });

        it('theLengthOfAnOverlongUriIsCountedInUtf16Units', () => {
            const long = 'aeron:ipc?alias=' + '\u00e9'.repeat(5000);
            expect(message(() => ChannelUri.parse(long))).toBe(
                'URI length (' + long.length + ') exceeds max supported length (4095): ' + long.substring(0, 4095),
            );
        });

        it('thePrefixOfASpyUriCountsTowardsTheLength', () => {
            const prefix = 'aeron-spy:aeron:ipc?alias=';
            const atMax = prefix + 'x'.repeat(4095 - prefix.length);
            expect(ChannelUri.parse(atMax).prefix()).toBe('aeron-spy');
            expect(() => ChannelUri.parse(atMax + 'x')).toThrow(IllegalArgumentException);
        });

        it('initialPositionOnAChannelUri', () => {
            const uri = ChannelUri.parse('aeron:ipc');
            uri.initialPosition(17 * 1024 * 1024, -9, 4 * 1024 * 1024);

            expect(uri.get('init-term-id')).toBe('-9');
            expect(uri.get('term-id')).toBe('-5');
            expect(uri.get('term-offset')).toBe('1048576');
            expect(uri.get('term-length')).toBe('4194304');
            expect(message(() => uri.initialPosition(-32, 0, 65536))).toBe('invalid position: -32');
            expect(message(() => uri.initialPosition(33, 0, 65536))).toBe('invalid position: 33');
            expect(message(() => uri.initialPosition(0, 0, 65535))).toBe('invalid term buffer length: 65535');
            expect(() => uri.initialPosition(2 ** 53, 0, 65536)).toThrow(RangeError);
        });

        it('initialPositionWrapsTheTermIdLikeAnInt', () => {
            const uri = ChannelUri.parse('aeron:ipc');
            uri.initialPosition(3 * 65536, 2147483647, 65536);

            expect(uri.get('init-term-id')).toBe('2147483647');
            expect(uri.get('term-id')).toBe('-2147483646');
            expect(uri.get('term-offset')).toBe('0');
        });
    });
});

describe('ChannelUriStringBuilder extra', () => {
    function fullBuilder(): ChannelUriStringBuilder {
        return new ChannelUriStringBuilder()
            .prefix('aeron-spy')
            .media('udp')
            .endpoint('[::1]:4000')
            .networkInterface('eth0')
            .controlEndpoint('localhost:4001')
            .controlMode('dynamic')
            .tags(3, 4)
            .alias('my alias')
            .congestionControl('cubic')
            .flowControl('tagged,g:5/2,t:1s')
            .reliable(false)
            .ttl(255)
            .mtu(1408)
            .termLength(1 << 20)
            .initialTermId(10)
            .termId(12)
            .termOffset(96)
            .sessionId(-77)
            .groupTag(5)
            .linger(TimeUnit.SECONDS.toNanos(5))
            .sparse(true)
            .eos(false)
            .tether(true)
            .group(true)
            .rejoin(false)
            .spiesSimulateConnection(true)
            .socketSndbufLength(131072)
            .socketRcvbufLength(262144)
            .receiverWindowLength(65536)
            .mediaReceiveTimestampOffset('reserved')
            .channelReceiveTimestampOffset('8')
            .channelSendTimestampOffset('-1')
            .responseEndpoint('localhost:4002')
            .responseCorrelationId(-1)
            .nakDelay(60000)
            .untetheredWindowLimitTimeoutNs(1000000)
            .untetheredLingerTimeoutNs(2000000)
            .untetheredRestingTimeoutNs(3000000000)
            .maxResend(16)
            .streamId(1001)
            .publicationWindowLength(1048576);
    }

    it('theFullBuilderSetsEveryParameterName', () => {
        const parsed = ChannelUri.parse(fullBuilder().validate().build());
        const present = new Set<string>();
        parsed.forEachParameter((key) => present.add(key));

        // control-mode and the response mode share a parameter with a value, nothing is missing
        expect([...present].sort()).toEqual([...PARAM_NAMES].sort());
    });

    it('builderToStringToParseToBuilderIsStable', () => {
        const built = fullBuilder().build();
        const parsed = ChannelUri.parse(built);
        const rebuilt = new ChannelUriStringBuilder(parsed).build();
        const fromString = new ChannelUriStringBuilder(built).build();

        expect(rebuilt).toBe(built);
        expect(fromString).toBe(built);
        expect(ChannelUri.parse(rebuilt).equals(parsed)).toBe(true);
        expect(parsed.toString().split('|').length).toBe(built.split('|').length);
        expect(ChannelUri.parse(parsed.toString()).equals(parsed)).toBe(true);
    });

    it('theFullBuilderOutputExactly', () => {
        expect(fullBuilder().build()).toBe(
            'aeron-spy:aeron:udp?tags=3,4|endpoint=[::1]:4000|interface=eth0|control=localhost:4001|' +
                'control-mode=dynamic|mtu=1408|term-length=1m|init-term-id=10|term-id=12|term-offset=96|' +
                'session-id=-77|ttl=255|reliable=false|linger=5s|alias=my alias|cc=cubic|' +
                'fc=tagged,g:5/2,t:1s|gtag=5|sparse=true|eos=false|tether=true|group=true|rejoin=false|ssc=true|' +
                'so-sndbuf=128k|so-rcvbuf=256k|rcv-wnd=64k|media-rcv-ts-offset=reserved|channel-rcv-ts-offset=8|' +
                'channel-snd-ts-offset=-1|response-endpoint=localhost:4002|response-correlation-id=-1|' +
                'nak-delay=60us|untethered-window-limit-timeout=1ms|untethered-linger-timeout=2ms|' +
                'untethered-resting-timeout=3s|max-resend=16|stream-id=1001|pub-wnd=1m',
        );
    });

    it('clearResetsEveryValue', () => {
        const builder = fullBuilder().isSessionIdTagged(true).clear();

        expect(builder.isSessionIdTagged()).toBe(false);
        expect(builder.prefix()).toBeNull();
        expect(builder.media()).toBeNull();
        expect(builder.sessionId()).toBeNull();
        expect(builder.groupTag()).toBeNull();
        expect(builder.linger()).toBeNull();
        expect(builder.publicationWindowLength()).toBeNull();
        expect(builder.streamId()).toBeNull();
        // nakDelay and the untethered timeouts are not reset by Java's clear(): they stay
        expect(builder.nakDelay()).toBe(60000);
        expect(builder.untetheredLingerTimeoutNs()).toBe(2000000);
    });

    it('taggedSessionIds', () => {
        const builder = new ChannelUriStringBuilder().media('ipc').sessionId('tag:123');

        expect(builder.isSessionIdTagged()).toBe(true);
        expect(builder.build()).toBe('aeron:ipc?session-id=tag:123');
        expect(builder.sessionId('45').build()).toBe('aeron:ipc?session-id=45');
        expect(builder.isSessionIdTagged()).toBe(false);
        expect(builder.taggedSessionId(9).build()).toBe('aeron:ipc?session-id=tag:9');
        expect(builder.sessionId(null).build()).toBe('aeron:ipc');
        expect(message(() => builder.sessionId('x'))).toBe("'session-id' must be a valid integer");
        expect(message(() => builder.sessionId('2147483648'))).toBe("'session-id' must be a valid integer");
        expect(builder.sessionId(ChannelUri.parse('aeron:ipc?session-id=tag:-4')).build()).toBe(
            'aeron:ipc?session-id=tag:-4',
        );
    });

    it.each([
        [null, null, null],
        [5, null, '5'],
        [5, 6, '5,6'],
        [-5, 0, '-5,0'],
    ])('tagsFromLongs %s %s', (channelTag, pubSubTag, expected) => {
        const builder = new ChannelUriStringBuilder().media('ipc').tags(channelTag, pubSubTag);

        expect(builder.tags()).toBe(expected);
        expect(ChannelUri.parse(builder.build()).channelTag()).toBe(null === channelTag ? null : String(channelTag));
    });

    it('aPubSubTagWithoutAChannelTagIsRejected', () => {
        expect(message(() => new ChannelUriStringBuilder().tags(null, 4))).toBe(
            'null == channelTag && null != pubSubTag',
        );
    });

    it('flowControlHelpers', () => {
        const fc = (b: ChannelUriStringBuilder): string | null => b.flowControl();
        expect(fc(new ChannelUriStringBuilder().taggedFlowControl(null, null, null))).toBe('tagged');
        expect(fc(new ChannelUriStringBuilder().taggedFlowControl(7, null, null))).toBe('tagged,g:7');
        expect(fc(new ChannelUriStringBuilder().taggedFlowControl(null, 3, null))).toBe('tagged,g:/3');
        expect(fc(new ChannelUriStringBuilder().taggedFlowControl(7, 3, '5s'))).toBe('tagged,g:7/3,t:5s');
        expect(fc(new ChannelUriStringBuilder().taggedFlowControl(null, null, '5s'))).toBe('tagged,t:5s');
        expect(fc(new ChannelUriStringBuilder().minFlowControl(null, null))).toBe('min');
        expect(fc(new ChannelUriStringBuilder().minFlowControl(2, null))).toBe('min,g:/2');
        expect(fc(new ChannelUriStringBuilder().minFlowControl(2, '1s'))).toBe('min,g:/2,t:1s');
        expect(fc(new ChannelUriStringBuilder().minFlowControl(null, '1s'))).toBe('min,t:1s');
    });

    describe('validation errors', () => {
        it('validate', () => {
            const udp = (): ChannelUriStringBuilder => new ChannelUriStringBuilder().media('udp').endpoint('h:1');

            expect(message(() => new ChannelUriStringBuilder().validate())).toBe('media type is mandatory');
            expect(message(() => new ChannelUriStringBuilder().media('udp').validate())).toBe(
                "either 'endpoint' or 'control' must be specified for UDP.",
            );
            expect(new ChannelUriStringBuilder().media('udp').controlEndpoint('h:1').validate()).toBeDefined();
            expect(new ChannelUriStringBuilder().media('ipc').validate()).toBeDefined();
            for (const builder of [
                udp().initialTermId(1),
                udp().termId(1),
                udp().termOffset(0),
                udp().initialTermId(1).termId(1),
                udp().termId(1).termOffset(0),
            ]) {
                expect(message(() => builder.validate())).toBe(
                    "either all or none of the parameters ['initialTermId', 'termId', 'termOffset'] must be provided",
                );
            }
            expect(message(() => udp().initialTermId(5).termId(4).termOffset(0).validate())).toBe(
                'difference greater than 2^31 - 1: termId=4 - initialTermId=5',
            );
            expect(message(() => udp().initialTermId(-2147483648).termId(2147483647).termOffset(0).validate())).toBe(
                'difference greater than 2^31 - 1: termId=2147483647 - initialTermId=-2147483648',
            );
            expect(message(() => udp().termLength(65536).initialTermId(0).termId(0).termOffset(65568).validate())).toBe(
                'termOffset=65568 > termLength=65536',
            );
            expect(udp().termLength(65536).initialTermId(0).termId(0).termOffset(65536).validate()).toBeDefined();
        });

        it('setters', () => {
            const b = (): ChannelUriStringBuilder => new ChannelUriStringBuilder();

            expect(message(() => b().prefix('foo'))).toBe('invalid prefix: foo');
            expect(b().prefix('').prefix()).toBe('');
            expect(b().prefix(null).prefix()).toBeNull();
            expect(message(() => b().media('tcp'))).toBe('invalid media: tcp');
            expect(message(() => b().controlMode('auto'))).toBe('invalid control mode: auto');
            expect(b().controlMode('response').controlMode()).toBe('response');
            expect(b().controlMode('manual').controlMode()).toBe('manual');
            expect(message(() => b().ttl(256))).toBe('TTL not in range 0-255: 256');
            expect(message(() => b().ttl(-1))).toBe('TTL not in range 0-255: -1');
            expect(b().ttl(0).ttl()).toBe(0);
            expect(message(() => b().mtu(31))).toBe('MTU not in range 32-65504: 31');
            expect(message(() => b().mtu(65505))).toBe('MTU not in range 32-65504: 65505');
            expect(message(() => b().mtu(33))).toBe('MTU not a multiple of FRAME_ALIGNMENT: mtu=33');
            expect(b().mtu(65504).mtu()).toBe(65504);
            expect(b().mtu(32).mtu()).toBe(32);
            expect(message(() => b().termLength(1024), IllegalStateException)).toBe(
                'Term length less than min length of 65536: length=1024',
            );
            expect(message(() => b().termLength(2 ** 31 - 1), IllegalStateException)).toBe(
                'Term length more than max length of 1073741824: length=2147483647',
            );
            expect(message(() => b().termLength(65536 * 3), IllegalStateException)).toBe(
                'Term length not a power of 2: length=196608',
            );
            expect(
                b()
                    .termLength(1 << 30)
                    .termLength(),
            ).toBe(1 << 30);
            expect(message(() => b().termOffset(-32))).toBe('term offset not in range 0-1g: -32');
            expect(message(() => b().termOffset((1 << 30) + 32))).toBe(
                'term offset not in range 0-1g: ' + ((1 << 30) + 32),
            );
            expect(message(() => b().termOffset(33))).toBe('term offset not multiple of FRAME_ALIGNMENT: 33');
            expect(
                b()
                    .termOffset(1 << 30)
                    .termOffset(),
            ).toBe(1 << 30);
            expect(message(() => b().linger(-5))).toBe('`linger` value cannot be negative: -5');
            expect(message(() => b().socketSndbufLength(-1))).toBe('`so-sndbuf` value cannot be negative: -1');
            expect(message(() => b().socketRcvbufLength(-1))).toBe('`so-rcvbuf` value cannot be negative: -1');
            expect(message(() => b().receiverWindowLength(-1))).toBe('`rcv-wnd` value cannot be negative: -1');
            expect(message(() => b().maxResend(-1))).toBe('`max-resend` value cannot be negative: -1');
            expect(message(() => b().publicationWindowLength(-1))).toBe('`pub-wnd` value cannot be negative: -1');
            expect(message(() => b().nakDelay(-1))).toBe('`nak-delay` value cannot be negative: -1');
            expect(message(() => b().untetheredWindowLimitTimeoutNs(-1))).toBe(
                '`untethered-window-limit-timeout` value cannot be negative: -1',
            );
            expect(message(() => b().untetheredLingerTimeoutNs(-1))).toBe(
                '`untethered-linger-timeout` value cannot be negative: -1',
            );
            expect(message(() => b().untetheredRestingTimeoutNs(-1))).toBe(
                '`untethered-resting-timeout` value cannot be negative: -1',
            );
            expect(b().media('ipc').linger(0).socketRcvbufLength(0).build()).toBe('aeron:ipc?linger=0ns|so-rcvbuf=0');
        });

        it('timestampOffsetsAndResponseCorrelationId', () => {
            const b = (): ChannelUriStringBuilder => new ChannelUriStringBuilder();

            expect(message(() => b().mediaReceiveTimestampOffset('x'))).toBe(
                "mediaReceiveTimestampOffset must be a number or the value 'reserved' found: x",
            );
            expect(message(() => b().channelReceiveTimestampOffset('1.5'))).toBe(
                "channelReceiveTimestampOffset must be a number or the value 'reserved' found: 1.5",
            );
            expect(message(() => b().channelSendTimestampOffset('2147483648'))).toBe(
                "channelSendTimestampOffset must be a number or the value 'reserved' found: 2147483648",
            );
            expect(b().channelSendTimestampOffset('-5').channelSendTimestampOffset()).toBe('-5');
            expect(b().mediaReceiveTimestampOffset(null).mediaReceiveTimestampOffset()).toBeNull();
            expect(message(() => b().responseCorrelationId('-2'))).toBe(
                "responseCorrelationId must be a number greater than or equal to -1, or the value 'prototype' found: -2",
            );
            expect(message(() => b().responseCorrelationId('x'))).toBe(
                "responseCorrelationId must be a number greater than or equal to -1, or the value 'prototype' found: x",
            );
            expect(message(() => b().responseCorrelationId('9223372036854775808'))).toBe(
                "responseCorrelationId must be a number greater than or equal to -1, or the value 'prototype' found: 9223372036854775808",
            );
            expect(b().responseCorrelationId('9223372036854775807').responseCorrelationId()).toBe(
                '9223372036854775807',
            );
            expect(b().responseCorrelationId('-1').responseCorrelationId()).toBe('-1');
            expect(b().responseCorrelationId('prototype').responseCorrelationId()).toBe('prototype');
            expect(b().responseCorrelationId(42).responseCorrelationId()).toBe('42');
            expect(b().responseCorrelationId(null).responseCorrelationId()).toBeNull();
        });

        it('copyingFromAChannelUri', () => {
            const b = (): ChannelUriStringBuilder => new ChannelUriStringBuilder();
            const uri = (query: string): ChannelUri => ChannelUri.parse('aeron:udp?' + query);

            expect(message(() => b().ttl(uri('ttl=abc')))).toBe("'ttl' must be a value integer");
            expect(message(() => b().ttl(uri('ttl=300')))).toBe('TTL not in range 0-255: 300');
            expect(message(() => b().initialTermId(uri('init-term-id=x')))).toBe(
                "'initial-term-id' must be a valid integer",
            );
            expect(message(() => b().termId(uri('term-id=x')))).toBe("'term-id' must be a valid integer");
            expect(message(() => b().termOffset(uri('term-offset=x')))).toBe("'term-offset' must be a valid integer");
            expect(message(() => b().groupTag(uri('gtag=x')))).toBe("'gtag' must be a valid long value");
            expect(message(() => b().groupTag(uri('gtag=9223372036854775808')))).toBe(
                "'gtag' must be a valid long value",
            );
            expect(() => b().groupTag(uri('gtag=9007199254740992'))).toThrow(RangeError);
            expect(b().groupTag(uri('gtag=-9007199254740991')).groupTag()).toBe(-9007199254740991);
            expect(message(() => b().maxResend(uri('max-resend=x')))).toBe('max-resend must be a number');
            expect(message(() => b().streamId(uri('stream-id=x')))).toBe('stream-id must be a number');
            expect(message(() => b().mtu(uri('mtu=2g')))).toBe('mtu 2147483648 > 2147483647');
            expect(message(() => b().termLength(uri('term-length=2g')))).toBe(
                'term length more than max length of 1073741824: value=2147483648',
            );
            expect(message(() => b().socketSndbufLength(uri('so-sndbuf=2g')))).toBe(
                'value exceeds maximum permitted: value=2147483648',
            );
            expect(message(() => b().socketRcvbufLength(uri('so-rcvbuf=2g')))).toBe(
                'value exceeds maximum permitted: value=2147483648',
            );
            expect(message(() => b().receiverWindowLength(uri('rcv-wnd=2g')))).toBe(
                'value exceeds maximum permitted: value=2147483648',
            );
            expect(message(() => b().publicationWindowLength(uri('pub-wnd=2g')))).toBe(
                'value exceeds maximum permitted: value=2147483648',
            );
            expect(assertThrows(NumberFormatException, () => b().mtu(uri('mtu=abc')))).toBeInstanceOf(
                IllegalArgumentException,
            );
            expect(message(() => b().prefix(ChannelUri.parse('aeron:udp').prefix('x')))).toBe('invalid prefix: x');
            expect(() => b().controlMode(uri('control-mode=bogus'))).toThrow(IllegalArgumentException);
            expect(() => b().nakDelay(uri('nak-delay=abc'))).toThrow(IllegalArgumentException);
            expect(() => b().nakDelay(uri('nak-delay=-1'))).toThrow(IllegalArgumentException);
            expect(() => b().untetheredWindowLimitTimeout(uri('untethered-window-limit-timeout=1x'))).toThrow(
                IllegalArgumentException,
            );
        });

        it('copyingAnAbsentParameterResetsAndTheResponseCorrelationIdKeepsTheOldValue', () => {
            const empty = ChannelUri.parse('aeron:ipc');
            const builder = new ChannelUriStringBuilder().media('ipc').ttl(5).streamId(9).responseCorrelationId(7);

            builder.ttl(empty).streamId(empty).responseCorrelationId(empty);

            expect(builder.ttl()).toBeNull();
            expect(builder.streamId()).toBeNull();
            expect(builder.responseCorrelationId()).toBe('7');
        });

        it('booleansAreParsedLikeJavaBooleanValueOf', () => {
            const parse = (value: string): boolean | null =>
                new ChannelUriStringBuilder().reliable(ChannelUri.parse('aeron:udp?reliable=' + value)).reliable();

            expect(parse('true')).toBe(true);
            expect(parse('TRUE')).toBe(true);
            expect(parse('True')).toBe(true);
            expect(parse('false')).toBe(false);
            expect(parse('yes')).toBe(false);
            expect(parse('1')).toBe(false);
            expect(parse('')).toBe(false);
        });

        it('initialPositionOnTheBuilder', () => {
            const builder = new ChannelUriStringBuilder()
                .media('ipc')
                .initialPosition(17 * 1024 * 1024, -9, 4 * 1024 * 1024);

            expect(builder.initialTermId()).toBe(-9);
            expect(builder.termId()).toBe(-5);
            expect(builder.termOffset()).toBe(1048576);
            expect(builder.termLength()).toBe(4194304);
            expect(builder.build()).toBe('aeron:ipc?term-length=4m|init-term-id=-9|term-id=-5|term-offset=1048576');
            expect(message(() => builder.initialPosition(-1, 0, 65536))).toBe('invalid position=-1 < 0');
            expect(message(() => builder.initialPosition(1, 0, 65536))).toBe(
                'invalid position=1 does not have frame alignment=32',
            );
            expect(message(() => builder.initialPosition(0, 0, 100))).toBe('invalid term buffer length: 100');
            expect(() => builder.initialPosition(2 ** 53, 0, 65536)).toThrow(RangeError);
        });
    });

    describe('durations and sizes', () => {
        it.each([
            [0, '0ns'],
            [1, '1ns'],
            [999, '999ns'],
            [1000, '1us'],
            [1500, '1500ns'],
            [1000000, '1ms'],
            [1000000000, '1s'],
            [1500000000, '1500ms'],
            [9007199254740991, '9007199254740991ns'],
        ])('lingerNsIsFormatted %d', (ns, text) => {
            const builder = new ChannelUriStringBuilder().media('ipc').linger(ns);

            expect(builder.build()).toBe('aeron:ipc?linger=' + text);
            expect(new ChannelUriStringBuilder().linger(ChannelUri.parse(builder.build())).linger()).toBe(ns);
        });

        it('aLingerAbove2Pow53SaturatesWhenParsed', () => {
            // Java: 987654321123456789L and 19191919191919191L are exact; here parseDuration saturates (spec D5)
            const builder = new ChannelUriStringBuilder().linger(
                ChannelUri.parse('aeron:udp?linger=987654321123456789'),
            );

            expect(builder.linger()).toBe(9007199254740991);
        });

        it.each([
            [1024, '1k'],
            [1025, '1025'],
            [1048576, '1m'],
            [1073741824, '1g'],
            [2147483647, '2147483647'],
        ])('sizesAreFormatted %d', (size, text) => {
            const builder = new ChannelUriStringBuilder().media('ipc').receiverWindowLength(size);

            expect(builder.build()).toBe('aeron:ipc?rcv-wnd=' + text);
            expect(
                new ChannelUriStringBuilder()
                    .receiverWindowLength(ChannelUri.parse(builder.build()))
                    .receiverWindowLength(),
            ).toBe(size);
        });
    });
});
