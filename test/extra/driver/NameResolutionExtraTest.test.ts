// Tests that Aeron does not have (spec 8.2): the name cache of DefaultNameResolver (spec D7) and the java.net
// stand-ins (spec D20) that it and the address parsers stand on.
import { afterEach, describe, expect, it } from 'vitest';
import { IllegalArgumentException } from '../../../src/agrona/jdk.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import {
    Inet4Address,
    Inet6Address,
    InetAddress,
    InetSocketAddress,
    UnknownHostException,
} from '../../../src/driver/jdkNet.js';
import { SocketAddressParser } from '../../../src/driver/media/SocketAddressParser.js';
import { assertEqualsObject, assertThrowsExactly } from '../../support/Assertions.js';

const resolver = new DefaultNameResolver();

describe('NameResolutionExtraTest', () => {
    afterEach(() => {
        DefaultNameResolver.clearCache();
    });

    describe('the name cache', () => {
        it('returnsNullForANameThatIsNotCached', () => {
            expect(resolver.resolve('not-cached.example', 'endpoint', false)).toBeNull();
        });

        it('returnsTheCachedAddressForAName', () => {
            const address = InetAddress.getByName('203.0.113.5');
            DefaultNameResolver.cache('cached.example', address);

            assertEqualsObject(address, resolver.resolve('cached.example', 'endpoint', false));
            expect((resolver.resolve('Cached.Example', 'control', true) as InetAddress).getHostName()).toBe(
                'Cached.Example',
            );
        });

        it('cachedNameKeepsTheHostNameAsTyped', () => {
            DefaultNameResolver.cache('SomeHost', InetAddress.getByAddress(null, Uint8Array.of(10, 1, 2, 3)));
            try {
                const a = SocketAddressParser.parse('somehost:40123', 'endpoint', false, DefaultNameResolver.INSTANCE);

                expect(a.getHostString()).toBe('somehost');
                expect(a.toString()).toBe('somehost/10.1.2.3:40123');
            } finally {
                DefaultNameResolver.clearCache();
            }
        });

        it('ignoresTheCaseOfTheName', () => {
            DefaultNameResolver.cache('MiXeD.Example', InetAddress.getByName('203.0.113.6'));

            expect((resolver.resolve('mixed.example', 'endpoint', false) as InetAddress).getHostAddress()).toBe(
                '203.0.113.6',
            );
            expect((resolver.resolve('MIXED.EXAMPLE', 'endpoint', false) as InetAddress).getHostAddress()).toBe(
                '203.0.113.6',
            );
        });

        it('replacesAnEarlierAddress', () => {
            DefaultNameResolver.cache('moves.example', InetAddress.getByName('203.0.113.7'));
            DefaultNameResolver.cache('moves.example', InetAddress.getByName('203.0.113.8'));

            expect((resolver.resolve('moves.example', 'endpoint', true) as InetAddress).getHostAddress()).toBe(
                '203.0.113.8',
            );
        });

        it('cachesAnIpV6Address', () => {
            DefaultNameResolver.cache('v6.example', InetAddress.getByName('2001:db8::7'));

            expect(resolver.resolve('v6.example', 'endpoint', false)).toBeInstanceOf(Inet6Address);
        });

        it('forgetsEveryNameWhenCleared', () => {
            DefaultNameResolver.cache('a.example', InetAddress.getByName('203.0.113.1'));
            DefaultNameResolver.cache('b.example', InetAddress.getByName('203.0.113.2'));

            DefaultNameResolver.clearCache();

            expect(resolver.resolve('a.example', 'endpoint', false)).toBeNull();
            expect(resolver.resolve('b.example', 'endpoint', false)).toBeNull();
            expect(InetAddress.nameCache.size).toBe(0);
        });

        it('keepsLocalhostAfterTheCacheIsCleared', () => {
            DefaultNameResolver.clearCache();

            assertEqualsObject(InetAddress.getLoopbackAddress(), resolver.resolve('localhost', 'endpoint', false));
        });

        it('answersIpLiteralsWithoutTheCache', () => {
            expect((resolver.resolve('192.168.5.6', 'endpoint', false) as InetAddress).getHostAddress()).toBe(
                '192.168.5.6',
            );
            expect(resolver.resolve('::1', 'endpoint', false)).toBeInstanceOf(Inet6Address);
            expect(resolver.resolve('[::1]', 'endpoint', false)).toBeInstanceOf(Inet6Address);
        });

        it('returnsNullForAMalformedIpLiteral', () => {
            expect(resolver.resolve('1:2:3', 'endpoint', false)).toBeNull();
            expect(resolver.resolve('[1.2.3.4]', 'endpoint', false)).toBeNull();
            expect(resolver.resolve('[::1', 'endpoint', false)).toBeNull();
            expect(resolver.resolve('999.1.1.1', 'endpoint', false)).toBeNull();
        });

        it('lookupReturnsTheNameAndTheNameIsTheClassName', () => {
            expect(resolver.lookup('host:80', 'endpoint', false)).toBe('host:80');
            expect(resolver.name()).toBe('DefaultNameResolver');
            expect(resolver.roleName()).toBe('DefaultNameResolver');
            expect(resolver.doWork()).toBe(0);
        });
    });

    describe('InetAddress.getByName', () => {
        it('throwsJavasUnknownHostExceptionForAnUncachedName', () => {
            const e = assertThrowsExactly(UnknownHostException, () => InetAddress.getByName('Who.Example'));

            expect(e.message).toBe('Who.Example: Name or service not known');
        });

        it.each([
            ['1:2:3', '1:2:3: invalid IPv6 address'],
            ['[::1', '[::1: invalid IPv6 address'],
            ['::1%', '::1%: invalid IPv6 address'],
            [':', ':: invalid IPv6 address'],
        ])('throwsForAnInvalidIpV6Literal %s', (host, message) => {
            const e = assertThrowsExactly(UnknownHostException, () => InetAddress.getByName(host));

            expect(e.message).toBe(message);
        });

        it('throwsForAnUnknownInterfaceScope', () => {
            const e = assertThrowsExactly(UnknownHostException, () => InetAddress.getByName('fe80::1%no-such-if0'));

            expect(e.message).toBe('no such interface no-such-if0');
        });

        it('keepsANumericScope', () => {
            const address = InetAddress.getByName('fe80::1%7') as Inet6Address;

            expect(address.getScopeId()).toBe(7);
            expect(address.getHostAddress()).toBe('fe80:0:0:0:0:0:0:1%7');
        });

        it('returnsTheLoopbackAddressForNullAndEmpty', () => {
            assertEqualsObject(InetAddress.getLoopbackAddress(), InetAddress.getByName(null));
            assertEqualsObject(InetAddress.getLoopbackAddress(), InetAddress.getByName(''));
        });

        it.each([
            ['1.2.3.4', [1, 2, 3, 4]],
            ['1.2.3', [1, 2, 0, 3]],
            ['1.2', [1, 0, 0, 2]],
            ['16909060', [1, 2, 3, 4]],
            ['255.255.255.255', [255, 255, 255, 255]],
            ['0.0.0.0', [0, 0, 0, 0]],
        ])('parsesTheIpV4Forms %s', (host, expected) => {
            expect([...InetAddress.getByName(host).getAddress()]).toEqual(expected);
        });

        it.each(['256.1.1.1', '1.2.3.4.5', '1..2', '1.2.3.', '4294967296'])('rejectsTheIpV4Form %s', (host) => {
            assertThrowsExactly(UnknownHostException, () => InetAddress.getByName(host));
        });

        it('turnsAnIpV4MappedIpV6AddressIntoAnIpV4Address', () => {
            const address = InetAddress.getByName('::ffff:10.1.2.3');

            expect(address).toBeInstanceOf(Inet4Address);
            expect(address.getHostAddress()).toBe('10.1.2.3');
        });

        it('parsesIpV6WithAnEmbeddedIpV4Tail', () => {
            expect(InetAddress.getByName('64:ff9b::192.0.2.33').getHostAddress()).toBe('64:ff9b:0:0:0:0:c000:221');
        });

        it('answersTheAddressPredicates', () => {
            expect(InetAddress.getByName('0.0.0.0').isAnyLocalAddress()).toBe(true);
            expect(InetAddress.getByName('::').isAnyLocalAddress()).toBe(true);
            expect(InetAddress.getByName('127.1.2.3').isLoopbackAddress()).toBe(true);
            expect(InetAddress.getByName('::1').isLoopbackAddress()).toBe(true);
            expect(InetAddress.getByName('::2').isLoopbackAddress()).toBe(false);
            expect(InetAddress.getByName('239.1.1.1').isMulticastAddress()).toBe(true);
            expect(InetAddress.getByName('223.1.1.1').isMulticastAddress()).toBe(false);
            expect(InetAddress.getByName('ff02::1').isMulticastAddress()).toBe(true);
        });

        it('comparesAddressesByValueAndNotByHostName', () => {
            const a = InetAddress.getByAddress('one', Uint8Array.of(10, 0, 0, 1));
            const b = InetAddress.getByAddress('two', Uint8Array.of(10, 0, 0, 1));

            assertEqualsObject(a, b);
            expect(a.hashCode()).toBe(b.hashCode());
            expect(a.toString()).toBe('one/10.0.0.1');
            expect(InetAddress.getByName('10.0.0.1').toString()).toBe('/10.0.0.1');
        });
    });

    describe('InetSocketAddress', () => {
        it.each([-1, 65536, 1 << 20])('rejectsThePort %d', (port) => {
            const e = assertThrowsExactly(
                IllegalArgumentException,
                () => new InetSocketAddress(InetAddress.getByName('10.0.0.1'), port),
            );

            expect(e.message).toBe('port out of range:' + port);
        });

        it('isTheWildcardAddressForAPortOnly', () => {
            const address = new InetSocketAddress(0);

            expect((address.getAddress() as InetAddress).isAnyLocalAddress()).toBe(true);
            expect(address.toString()).toBe('0.0.0.0/0.0.0.0:0');
        });

        it('printsAnIpV6AddressInBrackets', () => {
            expect(new InetSocketAddress(InetAddress.getByName('::1'), 80).toString()).toBe('/[0:0:0:0:0:0:0:1]:80');
        });

        it('comparesUnresolvedAddressesByNameIgnoringCase', () => {
            const a = InetSocketAddress.createUnresolved('Host.Example', 80);
            const b = InetSocketAddress.createUnresolved('host.example', 80);

            assertEqualsObject(a, b);
            expect(a.hashCode()).toBe(b.hashCode());
            expect(a.equals(InetSocketAddress.createUnresolved('host.example', 81))).toBe(false);
            expect(a.equals(new InetSocketAddress(InetAddress.getByName('10.0.0.1'), 80))).toBe(false);
        });

        it('resolvesALiteralHostNameInTheTwoArgumentConstructor', () => {
            const a = new InetSocketAddress('10.1.2.3', 80);

            expect(a.isUnresolved()).toBe(false);
            expect((a.getAddress() as InetAddress).getHostAddress()).toBe('10.1.2.3');
            expect(a.getPort()).toBe(80);
        });

        it('keepsTheHostNameOfAnUncachedNameUnresolved', () => {
            const a = new InetSocketAddress('uncached.example', 80);

            expect(a.isUnresolved()).toBe(true);
            expect(a.getHostString()).toBe('uncached.example');
            expect(a.getAddress()).toBeNull();
        });

        it('rejectsAPortAboveRangeInTheTwoArgumentConstructor', () => {
            const e = assertThrowsExactly(IllegalArgumentException, () => new InetSocketAddress('10.1.2.3', 65536));

            expect(e.message).toBe('port out of range:65536');
        });
    });

    describe('allocation and memoization', () => {
        it('equalsOfInet4AddressAllocatesNothing', async () => {
            const a = InetAddress.getByName('10.1.2.3');
            const b = InetAddress.getByName('10.1.2.4');
            let hits = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    if (a.equals(b)) {
                        hits++;
                    }
                }
            });
            expect(hits).toBe(0);
        });

        it('equalsOfInet6AddressAllocatesNothing', async () => {
            const a = InetAddress.getByName('2001:db8::1');
            const b = InetAddress.getByName('2001:db8::2');
            let hits = 0;

            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    if (a.equals(b)) {
                        hits++;
                    }
                }
            });
            expect(hits).toBe(0);
        });

        it.each(['10.1.2.3', '2001:db8::1'])('memoizesTheHostAddressOf %s', async (literal) => {
            const a = InetAddress.getByName(literal);
            const first = a.getHostAddress();
            let length = 0;

            expect(a.getHostAddress()).toBe(first);
            await expectNoAllocation((n) => {
                for (let i = 0; i < n; i++) {
                    length += a.getHostAddress().length;
                }
            });
            expect(length).toBeGreaterThan(0);
        });
    });
});
