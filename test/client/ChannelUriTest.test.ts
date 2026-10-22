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
// Port of io/aeron/ChannelUriTest.java @ 1.53.3
import { describe, expect, it, vi } from 'vitest';
import { IllegalArgumentException, IllegalStateException, NullPointerException } from '../../src/agrona/jdk.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { CommonContext } from '../../src/client/CommonContext.js';
import { assertThrows } from '../support/Assertions.js';

const MAX_URI_LENGTH = ChannelUri.MAX_URI_LENGTH;

/** `Tests.generateStringWithSuffix(prefix, suffix, suffixRepeatCount)`. */
function generateStringWithSuffix(prefix: string, suffix: string, suffixRepeatCount: number): string {
    return prefix + suffix.repeat(suffixRepeatCount);
}

function assertSubstitution(expected: string, originalChannel: string, resolvedEndpoint: string): void {
    const uri = ChannelUri.parse(originalChannel);
    uri.replaceEndpointWildcardPort(resolvedEndpoint);
    expect(uri.toString()).toBe(expected);
}

const equalityValues: [string, string, boolean][] = [
    ['aeron:udp?endpoint=224.10.9.8', 'aeron:udp?endpoint=224.10.9.8', true],
    [
        'aeron:udp?endpoint=224.10.9.8|port=4567|interface=192.168.0.3|ttl=16',
        'aeron:udp?port=4567|endpoint=224.10.9.8|ttl=16|interface=192.168.0.3',
        true,
    ],
    ['aeron:udp?endpoint=224.10.9.8|tags=1,2', 'aeron:udp?tags=1,2|endpoint=224.10.9.8', true],
    ['aeron:udp?endpoint=224.10.9.8', 'aeron-spy:aeron:udp?endpoint=224.10.9.8', false],
    ['aeron:udp?endpoint=224.10.9.8', 'aeron:ipc?endpoint=224.10.9.8', false],
    ['aeron:udp?endpoint=224.10.9.9', 'aeron:udp?endpoint=224.10.8.8', false],
    ['aeron:udp?endpoint=224.10.9.8|ttl=16', 'aeron:ipc?endpoint=224.10.9.8|port=4567', false],
    ['aeron:udp?endpoint=224.10.9.8|tags=2,1', 'aeron:udp?endpoint=224.10.9.8|tags=1,2', false],
];

function assertParseWithParams(uriStr: string, ...params: string[]): void {
    if (params.length % 2 !== 0) {
        throw new IllegalArgumentException();
    }

    const uri = ChannelUri.parse(uriStr);

    for (let i = 0; i < params.length; i += 2) {
        expect(uri.get(params[i]!)).toBe(params[i + 1]);
    }
}

function assertParseWithMediaAndPrefix(uriStr: string, prefix: string, media: string): void {
    const uri = ChannelUri.parse(uriStr);
    expect(uri.scheme()).toBe('aeron');
    expect(uri.prefix()).toBe(prefix);
    expect(uri.media()).toBe(media);
}

function assertParseWithMedia(uriStr: string, media: string): void {
    assertParseWithMediaAndPrefix(uriStr, '', media);
}

function assertInvalid(string: string): void {
    let thrown: unknown;
    try {
        ChannelUri.parse(string);
    } catch (e) {
        thrown = e;
    }

    // fail(IllegalArgumentException.class.getName() + " not thrown") unless one of the two is thrown
    expect(thrown instanceof IllegalArgumentException || thrown instanceof IllegalStateException).toBe(true);
}

describe('ChannelUri', () => {
    it('shouldParseSimpleDefaultUri', () => {
        assertParseWithMedia('aeron:udp', 'udp');
        assertParseWithMedia('aeron:ipc', 'ipc');
        assertParseWithMediaAndPrefix('aeron-spy:aeron:ipc', 'aeron-spy', 'ipc');
    });

    it('shouldRejectUriWithoutAeronPrefix', () => {
        assertInvalid(':udp');
        assertInvalid('aeron');
        assertInvalid('aron:');
        assertInvalid('eeron:');
    });

    it('shouldRejectWithOutOfPlaceColon', () => {
        assertInvalid('aeron:udp:');
    });

    it('shouldRejectWithInvalidMedia', () => {
        assertInvalid('aeron:ipcsdfgfdhfgf');
    });

    it('shouldRejectWithMissingQuerySeparatorWhenFollowedWithParams', () => {
        assertInvalid('aeron:ipc|sparse=true');
    });

    it('shouldRejectWithInvalidParams', () => {
        assertInvalid('aeron:udp?endpoint=localhost:4652|-~@{]|=??#s!£$%====');
    });

    it.each([MAX_URI_LENGTH + 1, 10000])('shouldRejectUriIfLengthExceedsMaxAllowed %d', (length) => {
        const uri = generateStringWithSuffix('aeron:ipc?alias=', 'x', length);
        const exception = assertThrows(IllegalArgumentException, () => ChannelUri.parse(uri));
        expect(exception.message).toBe(
            'URI length (' +
                uri.length +
                ') exceeds max supported length (' +
                MAX_URI_LENGTH +
                '): ' +
                uri.substring(0, MAX_URI_LENGTH),
        );
    });

    it('shouldParseWithMultipleParameters', () => {
        assertParseWithParams(
            'aeron:udp?endpoint=224.10.9.8|port=4567|interface=192.168.0.3|ttl=16',
            'endpoint',
            '224.10.9.8',
            'port',
            '4567',
            'interface',
            '192.168.0.3',
            'ttl',
            '16',
        );
    });

    it('shouldAllowReturnDefaultIfParamNotSpecified', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=224.10.9.8');
        expect(uri.get('interface')).toBeNull();
        expect(uri.get('interface', '192.168.0.0')).toBe('192.168.0.0');
    });

    it('shouldRoundTripToString', () => {
        const uriString = 'aeron:udp?endpoint=224.10.9.8:777';
        const uri = ChannelUri.parse(uriString);

        const result = uri.toString();
        expect(result).toBe(uriString);
    });

    it('shouldRoundTripToStringBuilder', () => {
        const builder = new ChannelUriStringBuilder().media('udp').endpoint('224.10.9.8:777');
        const uriString = builder.build();
        const uri = ChannelUri.parse(uriString);

        expect(uri.toString()).toBe(uriString);
    });

    it('shouldRoundTripToStringBuilderWithPrefix', () => {
        const builder = new ChannelUriStringBuilder()
            .prefix(ChannelUri.SPY_QUALIFIER)
            .media('udp')
            .endpoint('224.10.9.8:777');
        const uriString = builder.build();
        const uri = ChannelUri.parse(uriString);

        expect(uri.toString()).toBe(uriString);
    });

    it('equalsReturnsTrueWhenTheSameInstance', () => {
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=224.10.9.8|port=4567|interface=192.168.0.3|ttl=16');

        expect(channelUri.equals(channelUri)).toBe(true);
    });

    it('equalsReturnsFalseIfComparedWithNull', () => {
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=224.10.9.8|port=4567|interface=192.168.0.3|ttl=16');

        expect(channelUri.equals(null)).toBe(false);
    });

    it('equalsReturnsFalseIfComparedAnotherClass', () => {
        const channelUri = ChannelUri.parse('aeron:udp?endpoint=224.10.9.8|port=4567|interface=192.168.0.3|ttl=16');

        expect(channelUri.equals(123)).toBe(false);
    });

    it.each(equalityValues)('equality %s %s %s', (uri1, uri2, expected) => {
        const parsedUri1 = ChannelUri.parse(uri1);
        const parsedUri2 = ChannelUri.parse(uri2);

        expect(parsedUri1.equals(parsedUri2)).toBe(expected);
    });

    it.each(equalityValues)('hashCode %s %s %s', (uri1, uri2, expected) => {
        const parsedUri1 = ChannelUri.parse(uri1);
        const parsedUri2 = ChannelUri.parse(uri2);

        if (expected) {
            expect(parsedUri1.hashCode()).toBe(parsedUri2.hashCode());
        } else {
            expect(parsedUri1.hashCode()).not.toBe(parsedUri2.hashCode());
        }
    });

    it.each([
        ['aeron:udp?endpoint=poison|interface=iface|mtu=4444', 'dest1', 'aeron:udp?endpoint=dest1|interface=iface'],
        ['aeron:ipc', 'dest2', 'aeron:ipc?endpoint=dest2'],
        ['aeron:udp', 'localhost', 'aeron:udp?endpoint=localhost'],
        ['aeron:ipc?interface=here', 'there', 'aeron:ipc?endpoint=there|interface=here'],
        ['aeron-spy:aeron:udp?eol=true|interface=none', 'abc', 'aeron:udp?endpoint=abc|interface=none'],
        [
            'aeron:udp?interface=eth0|term-length=64k|ttl=0|endpoint=some',
            'vm1',
            'aeron:udp?endpoint=vm1|interface=eth0',
        ],
    ])('createDestinationUriTest %s %s %s', (channel, endpoint, expected) => {
        const destinationUri = ChannelUri.createDestinationUri(channel, endpoint);
        expect(destinationUri).toBe(expected);
    });

    it('shouldSubstituteEndpoint', () => {
        assertSubstitution('aeron:udp?endpoint=localhost:12345', 'aeron:udp?endpoint=localhost:0', 'localhost:12345');
        assertSubstitution(
            'aeron:udp?endpoint=localhost:12345',
            'aeron:udp?endpoint=localhost:12345',
            'localhost:54321',
        );
        assertSubstitution('aeron:udp?endpoint=localhost:12345', 'aeron:udp?endpoint=localhost:0', '127.0.0.1:12345');
        assertSubstitution('aeron:udp?endpoint=127.0.0.1:12345', 'aeron:udp', '127.0.0.1:12345');
    });

    it('shouldThrowIfResolvedEndpointInvalid', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:0');
        assertThrows(IllegalArgumentException, () => uri.replaceEndpointWildcardPort('localhost:0'));
        assertThrows(IllegalArgumentException, () => uri.replaceEndpointWildcardPort('localhost'));
        assertThrows(NullPointerException, () => uri.replaceEndpointWildcardPort(null));
    });

    it('shouldIterateOverParameters', () => {
        const uri = ChannelUri.parse('aeron:udp?endpoint=myhost:0|ttl=1|mtu=8k|term-length=64M|alias=text|x=42');
        const parameterConsumer = vi.fn<(key: string, value: string) => void>();

        uri.forEachParameter(parameterConsumer);

        expect(parameterConsumer).toHaveBeenCalledWith('endpoint', 'myhost:0');
        expect(parameterConsumer).toHaveBeenCalledWith('ttl', '1');
        expect(parameterConsumer).toHaveBeenCalledWith('mtu', '8k');
        expect(parameterConsumer).toHaveBeenCalledWith('term-length', '64M');
        expect(parameterConsumer).toHaveBeenCalledWith('alias', 'text');
        expect(parameterConsumer).toHaveBeenCalledWith('x', '42');
        expect(parameterConsumer).toHaveBeenCalledTimes(6);
    });

    it('shouldNotCallConsumerIfNoParameters', () => {
        const uri = ChannelUri.parse('aeron:ipc');
        const parameterConsumer = vi.fn<(key: string, value: string) => void>();

        uri.forEachParameter(parameterConsumer);

        expect(parameterConsumer).not.toHaveBeenCalled();
    });

    it.each([[null], ['']])('shouldReturnOriginalUriWhenAliasIsEmpty %s', (alias) => {
        const uri = 'aeron:udp';
        expect(ChannelUri.addAliasIfAbsent(uri, alias)).toBe(uri);
    });

    it('shouldReturnOriginalUriWhenAliasIsAlreadyDefined', () => {
        const uri = 'aeron:udp?alias=xyz|term-length=64k';
        const alias = 'new alias';
        expect(ChannelUri.addAliasIfAbsent(uri, alias)).toBe(uri);
    });

    it.each(['aeron:udp?term-length=64k|ssc=false|mtu=8k', 'aeron:ipc', 'aeron:udp?custom=alias'])(
        'shouldReturnNewUriWithAnAliasAdded %s',
        (uri) => {
            const alias = 'my alias';
            const channelUri = ChannelUri.parse(uri);
            channelUri.put(CommonContext.ALIAS_PARAM_NAME, alias);

            const result = ChannelUri.addAliasIfAbsent(uri, alias);
            expect(result).not.toBeNull();
            expect(channelUri.equals(ChannelUri.parse(result))).toBe(true);
        },
    );

    it('shouldTransformAlias', () => {
        expect(ChannelUri.transformAlias('aeron:ipc', (alias) => alias)).toBe('aeron:ipc');
        expect(ChannelUri.transformAlias('aeron:ipc?alias=foo', (alias) => alias)).toBe('aeron:ipc?alias=foo');
        expect(ChannelUri.transformAlias('aeron:ipc?alias=foo', () => null)).toBe('aeron:ipc');
        expect(ChannelUri.transformAlias('aeron:ipc?alias=foo', () => '')).toBe('aeron:ipc');
        const fun = (alias: string | null): string => (null === alias ? 'default' : alias + 'bar');
        expect(ChannelUri.transformAlias('aeron:ipc', fun)).toBe('aeron:ipc?alias=default');
        expect(ChannelUri.transformAlias('aeron:ipc?alias=foo', fun)).toBe('aeron:ipc?alias=foobar');
    });
});
