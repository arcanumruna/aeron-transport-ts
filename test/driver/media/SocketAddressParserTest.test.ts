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
// Port of io/aeron/driver/media/SocketAddressParserTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException, NullPointerException } from '../../../src/agrona/jdk.js';
import { CommonContext } from '../../../src/client/CommonContext.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import type { NameResolver } from '../../../src/driver/NameResolver.js';
import { Inet6Address, InetAddress, type InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { SocketAddressParser } from '../../../src/driver/media/SocketAddressParser.js';
import { assertEqualsObject, assertThrows, assertThrowsExactly } from '../../support/Assertions.js';

const ENDPOINT_PARAM_NAME = CommonContext.ENDPOINT_PARAM_NAME;
const DEFAULT_RESOLVER = DefaultNameResolver.INSTANCE;

const LOOKUP_RESOLVER_NAME = 'StreamX';
const LOOKUP_RESOLVER_HOSTNAME = '192.168.1.20';
const LOOKUP_RESOLVER_PORT = 55;
const LOOKUP_RESOLVER: NameResolver = {
    resolve(name: string, uriParamName: string, isReResolution: boolean): InetAddress | null {
        return DEFAULT_RESOLVER.resolve(name, uriParamName, isReResolution);
    },

    lookup(name: string, _uriParamName: string, _isReLookup: boolean): string {
        if (name === LOOKUP_RESOLVER_NAME) {
            return LOOKUP_RESOLVER_HOSTNAME + ':' + LOOKUP_RESOLVER_PORT;
        }

        return name;
    },

    name(): string {
        return 'LookupResolver';
    },
};

function assertCorrectParse(host: string, port: number): void {
    const address = SocketAddressParser.parse(host + ':' + port, ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER);
    assertEqualsObject(InetAddress.getByName(host), address.getAddress());
    expect(address.getPort()).toBe(port);
}

function assertCorrectParseIpV6(host: string, port: number): void {
    const address = SocketAddressParser.parse('[' + host + ']:' + port, ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER);
    assertEqualsObject(InetAddress.getByName(host), address.getAddress());
    expect(address.getPort()).toBe(port);
}

describe('SocketAddressParserTest', () => {
    it('shouldParseIpV4AddressAndPort', () => {
        assertCorrectParse('192.168.1.20', 55);
    });

    it('shouldParseHostAddressAndPort', () => {
        assertCorrectParse('localhost', 55);
    });

    it('shouldRejectOnInvalidPort', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('192.168.1.20:aa', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnInvalidPort2', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('192.168.1.20::123', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnMissingPort', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('192.168.1.20', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnEmptyPort', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('192.168.1.20:', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnEmptyIpV6Port', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('[::1]:', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnInvalidIpV6', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('[FG07::789:1:0:0:3]:111', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldRejectOnInvalidIpV6Scope', () => {
        assertThrows(IllegalArgumentException, () =>
            SocketAddressParser.parse('[FC07::789:1:0:0:3%^]:111', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER),
        );
    });

    it('shouldParseIpV6', () => {
        assertCorrectParseIpV6('::1', 54321);
        assertCorrectParseIpV6('FC07::789:1:0:0:3', 54321);
        assertCorrectParseIpV6('fc07::789:1:0:0:3', 54321);
    });

    it('shouldParseWithScope', () => {
        const address = SocketAddressParser.parse('[::1%12~_.-34]:1234', ENDPOINT_PARAM_NAME, false, DEFAULT_RESOLVER);
        expect(address.getAddress()).toBeInstanceOf(Inet6Address);
    });

    it('shouldParseAndLookupResolverForName', () => {
        const socketAddress: InetSocketAddress = SocketAddressParser.parse(
            LOOKUP_RESOLVER_NAME,
            ENDPOINT_PARAM_NAME,
            false,
            LOOKUP_RESOLVER,
        );
        assertEqualsObject(InetAddress.getByName(LOOKUP_RESOLVER_HOSTNAME), socketAddress.getAddress());
        expect(socketAddress.getPort()).toBe(LOOKUP_RESOLVER_PORT);
    });

    it('shouldParseAndPassThroughLookupForUnknownName', () => {
        const socketAddress = SocketAddressParser.parse(
            LOOKUP_RESOLVER_HOSTNAME + ':' + LOOKUP_RESOLVER_PORT,
            ENDPOINT_PARAM_NAME,
            false,
            LOOKUP_RESOLVER,
        );
        assertEqualsObject(InetAddress.getByName(LOOKUP_RESOLVER_HOSTNAME), socketAddress.getAddress());
        expect(socketAddress.getPort()).toBe(LOOKUP_RESOLVER_PORT);
    });

    it.each([
        ['127.0.0.1:8080', false],
        ['224.0.0.0:24', true],
        ['224.0.0.255:44444', true],
        ['239.255.255.250:1010', true],
        ['239.1.1.1:1111', true],
        ['233.251.255.255:5555', true],
        ['999.255.255.250:7777', false],
        ['a.b.c.d:7777', false],
        ['192.b.c.d:7777', false],
        ['192.168.0.1:1234', false],
        ['test:1234', false],
        ['[ff02::1]:1234', true],
        ['[Ff05::1:3]:80', true],
        ['[fF9E::108]:5555', true],
        ['[FF01:0:0:0:0:0:0:18C]:5555', true],
        ['[fe80::ce81:b1c:bd2c:69e%utun3]:8080', false],
        ['[fe80::1%lo0]:5555', false],
        ['[ff02:0:0:0:0:2]:7777', true],
    ])('shouldCheckForMulticastAddress %s %s', (hostAndPort, expected) => {
        expect(SocketAddressParser.isMulticastAddress(hostAndPort)).toBe(expected);
    });

    it('shouldThrowNullPointerExceptionIfValueIsNull', () => {
        assertThrowsExactly(NullPointerException, () =>
            SocketAddressParser.isMulticastAddress(null as unknown as string),
        );
    });

    it.each(['', 'a', '1.2.3', '[x]', '[f0:xx]:5'])(
        'shouldThrowIllegalArgumentExceptionIfValueIsInvalid [%s]',
        (hostAndPort) => {
            const exception = assertThrowsExactly(IllegalArgumentException, () =>
                SocketAddressParser.isMulticastAddress(hostAndPort),
            );
            expect(exception.message).toContain(hostAndPort);
        },
    );
});
