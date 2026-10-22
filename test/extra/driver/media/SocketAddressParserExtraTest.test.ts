// Tests that Aeron does not have (spec 8.2): SocketAddressParser over IPv4, IPv6, bracketed IPv6, cached and uncached
// host names, the port bounds and malformed input, each asserting Java's exception type and message.
import { afterEach, describe, expect, it } from 'vitest';
import { AsciiNumberFormatException } from '../../../../src/agrona/AsciiNumberFormatException.js';
import { IllegalArgumentException, NullPointerException } from '../../../../src/agrona/jdk.js';
import { DefaultNameResolver } from '../../../../src/driver/DefaultNameResolver.js';
import { Inet4Address, Inet6Address, InetAddress } from '../../../../src/driver/jdkNet.js';
import { SocketAddressParser } from '../../../../src/driver/media/SocketAddressParser.js';
import { assertEqualsObject, assertThrowsExactly } from '../../../support/Assertions.js';

const RESOLVER = DefaultNameResolver.INSTANCE;

function parse(value: string) {
    return SocketAddressParser.parse(value, 'endpoint', false, RESOLVER);
}

describe('SocketAddressParserExtraTest', () => {
    afterEach(() => {
        DefaultNameResolver.clearCache();
    });

    it.each([0, 1, 40123, 65535])('parsesAnIpV4AddressWithPort %d', (port) => {
        const address = parse('10.1.2.3:' + port);

        expect(address.isUnresolved()).toBe(false);
        expect(address.getAddress()).toBeInstanceOf(Inet4Address);
        assertEqualsObject(InetAddress.getByAddress(null, Uint8Array.of(10, 1, 2, 3)), address.getAddress());
        expect(address.getPort()).toBe(port);
    });

    it.each([0, 1, 40123, 65535])('parsesABracketedIpV6AddressWithPort %d', (port) => {
        const address = parse('[2001:db8::1]:' + port);

        expect(address.getAddress()).toBeInstanceOf(Inet6Address);
        expect((address.getAddress() as InetAddress).getHostAddress()).toBe('2001:db8:0:0:0:0:0:1');
        expect(address.getPort()).toBe(port);
    });

    it('parsesTheLoopbackIpV6AddressOnTheAeronDefaultPort', () => {
        const address = parse('[::1]:40123');

        expect((address.getAddress() as InetAddress).isLoopbackAddress()).toBe(true);
        expect((address.getAddress() as InetAddress).getAddress().length).toBe(16);
        expect(address.getPort()).toBe(40123);
    });

    it('dropsTheScopeOfAnIpV6Address', () => {
        // The parser passes the host without its scope to the resolver, so a name that is not an interface is fine.
        const address = parse('[fe80::1%not-an-interface]:80');

        expect((address.getAddress() as InetAddress).getHostAddress()).toBe('fe80:0:0:0:0:0:0:1');
    });

    it('parsesAnIpV6AddressWithEveryHexDigitCase', () => {
        assertEqualsObject(parse('[ABCD:ef01::2]:5').getAddress(), parse('[abcd:EF01::2]:5').getAddress());
    });

    it('acceptsLeadingZerosInThePort', () => {
        expect(parse('127.0.0.1:00080').getPort()).toBe(80);
        expect(parse('[::1]:0065535').getPort()).toBe(65535);
    });

    it('resolvesACachedHostName', () => {
        DefaultNameResolver.cache('Rune-Host.example', InetAddress.getByName('192.168.7.9'));

        const address = parse('rune-host.example:7000');

        expect(address.isUnresolved()).toBe(false);
        assertEqualsObject(InetAddress.getByName('192.168.7.9'), address.getAddress());
        expect(address.getPort()).toBe(7000);
    });

    it('returnsAnUnresolvedAddressForAnUncachedHostName', () => {
        const address = parse('uncached-host.example:7001');

        expect(address.isUnresolved()).toBe(true);
        expect(address.getAddress()).toBeNull();
        expect(address.getHostString()).toBe('uncached-host.example');
        expect(address.getPort()).toBe(7001);
        expect(address.toString()).toBe('uncached-host.example/<unresolved>:7001');
    });

    it('resolvesAHostNameAfterItIsCachedAndNotAfterTheCacheIsCleared', () => {
        expect(parse('later.example:1').isUnresolved()).toBe(true);

        DefaultNameResolver.cache('later.example', InetAddress.getByName('10.9.8.7'));
        expect(parse('later.example:1').isUnresolved()).toBe(false);

        DefaultNameResolver.clearCache();
        expect(parse('later.example:1').isUnresolved()).toBe(true);
    });

    it('resolvesLocalhostWithoutTheCache', () => {
        const address = parse('LocalHost:9');

        assertEqualsObject(InetAddress.getLoopbackAddress(), address.getAddress());
    });

    it('returnsAnUnresolvedAddressForAnIpV6LiteralThatIsNotAnAddress', () => {
        // The grammar accepts it, the resolver does not (Java's UnknownHostException, caught, gives null).
        const address = parse('[1:2:3]:80');

        expect(address.isUnresolved()).toBe(true);
        expect(address.getHostString()).toBe('1:2:3');
    });

    it('resolvesAnEmptyHostToTheLoopbackAddress', () => {
        // Java's InetAddress.getByName("") is the loopback address.
        const address = parse(':80');

        assertEqualsObject(InetAddress.getLoopbackAddress(), address.getAddress());
        expect(address.getPort()).toBe(80);
    });

    it.each([65536, 99999])('rejectsAPortAboveTheMaximum %d', (port) => {
        const e = assertThrowsExactly(IllegalArgumentException, () => parse('10.0.0.1:' + port));

        expect(e.message).toBe('port out of range:' + port);
    });

    it('rejectsAnIpV6PortAboveTheMaximum', () => {
        const e = assertThrowsExactly(IllegalArgumentException, () => parse('[::1]:65536'));

        expect(e.message).toBe('port out of range:65536');
    });

    it('rejectsAPortAboveTheMaximumOfAnUnresolvedHost', () => {
        const e = assertThrowsExactly(IllegalArgumentException, () => parse('no-such-host.example:70000'));

        expect(e.message).toBe('port out of range:70000');
    });

    it.each(['4294967296', '99999999999'])('rejectsAPortThatOverflowsAnInt %s', (port) => {
        const e = assertThrowsExactly(AsciiNumberFormatException, () => parse('10.0.0.1:' + port));

        expect(e).toBeInstanceOf(IllegalArgumentException);
        expect(e.message).toBe('int overflow parsing: ' + port);
    });

    it.each([
        ['host', 'address:port is required for ipv4: host'],
        ['host:', 'address:port is required for ipv4: host:'],
        ['10.0.0.1', 'address:port is required for ipv4: 10.0.0.1'],
        ['[::1]', '[address]:port is required for ipv6: [::1]'],
        ['[::1]:', '[address]:port is required for ipv6: [::1]:'],
        ['[::1:80', '[address]:port is required for ipv6: [::1:80'],
    ])('rejectsInputWithoutAPort %s', (value, message) => {
        const e = assertThrowsExactly(IllegalArgumentException, () => parse(value));

        expect(e.message).toBe(message);
    });

    it.each([
        ['10.0.0.1:80x', 'invalid format: 10.0.0.1:80x'],
        ['10.0.0.1::80', 'invalid format: 10.0.0.1::80'],
        ['10.0.0.1:-80', 'invalid format: 10.0.0.1:-80'],
        ['[::1]x:80', 'invalid format: [::1]x:80'],
        ['[::1%a b]:80', 'invalid format: [::1%a b]:80'],
        ['::1:80', 'invalid format: ::1:80'],
        ['[::1]:8x', 'invalid format: [::1]:8x'],
    ])('rejectsMalformedInput %s', (value, message) => {
        const e = assertThrowsExactly(IllegalArgumentException, () => parse(value));

        expect(e.message).toBe(message);
    });

    it.each([null, ''])('rejectsANullOrEmptyValue [%s]', (value) => {
        const e = assertThrowsExactly(NullPointerException, () => parse(value as string));

        expect(e.message).toBe('input string must not be null or empty');
    });

    it('usesTheLookupBeforeTheGrammar', () => {
        const resolver = {
            resolve: (name: string) => InetAddress.getByName(name),
            lookup: () => '172.16.0.4:6000',
            name: () => 'lookup',
        };

        const address = SocketAddressParser.parse('anything', 'endpoint', true, resolver);

        expect((address.getAddress() as InetAddress).getHostAddress()).toBe('172.16.0.4');
        expect(address.getPort()).toBe(6000);
    });

    it.each([
        ['224.0.0.0:0', true],
        ['239.255.255.255:65535', true],
        ['223.255.255.255:1', false],
        ['240.0.0.0:1', false],
        ['[FF00::]:1', true],
        ['[feff::1]:1', false],
    ])('checksMulticastAtTheBounds %s', (hostAndPort, expected) => {
        expect(SocketAddressParser.isMulticastAddress(hostAndPort)).toBe(expected);
    });

    it('parsesABracketedHostWithoutColonsAsAnIpV4Host', () => {
        // The ipv4 grammar is tried first and accepts "[zz]:80" (a host of "[zz]"), which no resolver knows.
        const address = parse('[zz]:80');

        expect(address.isUnresolved()).toBe(true);
        expect(address.getHostString()).toBe('[zz]');
        expect(SocketAddressParser.isMulticastAddress('[a]:5')).toBe(false);
    });

    it.each([
        ['10.0.0.1', 'address:port is required for ipv4: 10.0.0.1'],
        ['[::1]x:80', 'invalid format: [::1]x:80'],
    ])('failsIsMulticastAddressWithJavasMessage %s', (value, message) => {
        const e = assertThrowsExactly(IllegalArgumentException, () => SocketAddressParser.isMulticastAddress(value));

        expect(e.message).toBe(message);
    });
});
