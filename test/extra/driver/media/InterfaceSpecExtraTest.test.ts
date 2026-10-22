// Tests that Aeron does not have (spec 8.2): the `interface=` specifications (NamedInterface, InterfaceSearchAddress and
// UnresolvedInterface), each asserting Java's exception type and message, and their resolution against the host.
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException, IllegalStateException, NumberFormatException } from '../../../../src/agrona/jdk.js';
import { InetAddress, NetworkInterface, StandardProtocolFamily } from '../../../../src/driver/jdkNet.js';
import { InterfaceSearchAddress } from '../../../../src/driver/media/InterfaceSearchAddress.js';
import { NamedInterface } from '../../../../src/driver/media/NamedInterface.js';
import { UnresolvedInterface } from '../../../../src/driver/media/UnresolvedInterface.js';
import { assertThrowsExactly } from '../../../support/Assertions.js';

const FORMAT = "expected format is '{interface_name}' or '{interface_name}:port', but got ";

describe('InterfaceSpecExtraTest', () => {
    describe('NamedInterface.parse', () => {
        it.each([
            [null, FORMAT + 'null'],
            ['', FORMAT + "''"],
            ['eth0', FORMAT + "'eth0'"],
            ['{eth0', FORMAT + "'{eth0'"],
            ['{}', FORMAT + "'{}'"],
            ['{eth0}:', FORMAT + "'{eth0}:'"],
            ['{eth0}0', FORMAT + "'{eth0}0'"],
        ])('throwsWithJavasMessage %s', (value, message) => {
            const e = assertThrowsExactly(IllegalArgumentException, () => NamedInterface.parse(value));

            expect(e.message).toBe(message);
            expect(e.cause).toBeUndefined();
        });

        it.each(['{eth0}:x', '{eth0}:-1', '{eth0}:1 ', '{eth0}:4294967296', '{eth0}:+', '{eth0}: 1', '{eth0}:1:2'])(
            'carriesTheNumberFormatExceptionOfAPortThatIsNotAnUnsignedInt %s',
            (value) => {
                const e = assertThrowsExactly(IllegalArgumentException, () => NamedInterface.parse(value));

                expect(e.message).toBe(FORMAT + "'" + value + "'");
                expect(e.cause).toBeInstanceOf(NumberFormatException);
            },
        );

        it('rejectsAPortAbove65535WithJavasMessage', () => {
            // Java passes the text "port out of range: N" as the string of the format message.
            const e = assertThrowsExactly(IllegalArgumentException, () => NamedInterface.parse('{eth0}:65536'));

            expect(e.message).toBe(FORMAT + "'port out of range: 65536'");
        });

        it('acceptsAPlusSignAndLeadingZerosInThePort', () => {
            expect(NamedInterface.parse('{eth0}:+5').port).toBe(5);
            expect(NamedInterface.parse('{eth0}:000065535').port).toBe(65535);
        });

        it('readsAnUnsignedIntAboveTwoToThe31AsANegativePortAsJavaDoes', () => {
            // Integer.parseUnsignedInt returns an int, so `port > 0xFFFF` is false for 2^31 .. 2^32 - 1.
            expect(NamedInterface.parse('{eth0}:4294967295').port).toBe(-1);
            expect(NamedInterface.parse('{eth0}:2147483648').port).toBe(-2147483648);
        });

        it('usesTheLastClosingBraceAsTheEndOfTheName', () => {
            const parsed = NamedInterface.parse('{a}b}:7');

            expect(parsed.name).toBe('a}b');
            expect(parsed.port).toBe(7);
        });

        it('hasRecordEqualityAndToString', () => {
            expect(new NamedInterface('lo', 5).equals(new NamedInterface('lo', 5))).toBe(true);
            expect(new NamedInterface('lo', 5).equals(new NamedInterface('lo', 6))).toBe(false);
            expect(new NamedInterface('lo', 5).hashCode()).toBe(new NamedInterface('lo', 5).hashCode());
            expect(new NamedInterface('lo', 5).toString()).toBe('NamedInterface[name=lo, port=5]');
        });
    });

    describe('NamedInterface.resolve', () => {
        it('throwsForAnUnknownInterface', () => {
            const e = assertThrowsExactly(IllegalArgumentException, () =>
                new NamedInterface('no-such-if0', 0).resolve(false, StandardProtocolFamily.INET),
            );

            expect(e.message).toBe('unknown interface no-such-if0');
        });

        it('resolvesTheFirstAddressOfTheFamilyOfAnInterfaceOfTheHost', () => {
            const ifc = NetworkInterface.getNetworkInterfaces().find((i) =>
                i.getInterfaceAddresses().some((a) => a.getAddress().getAddress().length === 4),
            );
            if (undefined === ifc) {
                return; // a host without an IPv4 address
            }

            const resolved = new NamedInterface(ifc.getName(), 4321).resolve(false, StandardProtocolFamily.INET);

            expect(resolved.localInterface?.getName()).toBe(ifc.getName());
            expect((resolved.address.getAddress() as InetAddress).getAddress().length).toBe(4);
            expect(resolved.address.getPort()).toBe(4321);
        });

        it('throwsWhenTheInterfaceHasNoAddressOfTheFamily', () => {
            const ifc = NetworkInterface.getNetworkInterfaces().find(
                (i) => !i.getInterfaceAddresses().some((a) => a.getAddress().getAddress().length === 16),
            );
            if (undefined === ifc) {
                return; // every interface of the host has an IPv6 address
            }

            const e = assertThrowsExactly(IllegalStateException, () =>
                new NamedInterface(ifc.getName(), 0).resolve(false, StandardProtocolFamily.INET6),
            );

            expect(e.message).toBe('no INET6 addresses found on interface ' + ifc.getName());
        });
    });

    describe('InterfaceSearchAddress.parse', () => {
        it.each([
            ['10.0.0.1', '10.0.0.1', 0, 32],
            ['10.0.0.1:5000', '10.0.0.1', 5000, 32],
            ['10.0.0.1/8', '10.0.0.1', 0, 8],
            ['10.0.0.1:5000/24', '10.0.0.1', 5000, 24],
            ['10.0.0.1:0/0', '10.0.0.1', 0, 0],
            ['[::1]', '0:0:0:0:0:0:0:1', 0, 128],
            ['[::1]:80', '0:0:0:0:0:0:0:1', 80, 128],
            ['[fe80::1]:80/64', 'fe80:0:0:0:0:0:0:1', 80, 64],
            ['[fe80::1]/10', 'fe80:0:0:0:0:0:0:1', 0, 10],
            ['localhost:65535', '127.0.0.1', 65535, 32],
        ])('parses %s', (value, host, port, prefix) => {
            const parsed = InterfaceSearchAddress.parse(value);

            expect((parsed.address.getAddress() as InetAddress).getHostAddress()).toBe(host);
            expect(parsed.address.getPort()).toBe(port);
            expect(parsed.subnetPrefix).toBe(prefix);
        });

        it.each([
            ['10.0.0.1/', 'invalid subnet: 10.0.0.1/'],
            ['10.0.0.1:', 'invalid port: 10.0.0.1:'],
            [null, 'search address string is null or empty'],
            ['', 'search address string is null or empty'],
        ])('throwsWithJavasMessage %s', (value, message) => {
            const e = assertThrowsExactly(IllegalArgumentException, () => InterfaceSearchAddress.parse(value));

            expect(e.message).toBe(message);
        });

        it('throwsForAPortAbove65535', () => {
            const e = assertThrowsExactly(IllegalArgumentException, () =>
                InterfaceSearchAddress.parse('10.0.0.1:65536'),
            );

            expect(e.message).toBe('port out of range:65536');
        });

        it('throwsUnknownHostExceptionForAnUncachedHostName', () => {
            expect(() => InterfaceSearchAddress.parse('uncached-iface.example')).toThrow(
                'uncached-iface.example: Name or service not known',
            );
        });

        it('hasARecordEqualityAndToString', () => {
            const a = InterfaceSearchAddress.parse('10.0.0.1:5/8');

            expect(a.equals(InterfaceSearchAddress.parse('10.0.0.1:5/8'))).toBe(true);
            expect(a.equals(InterfaceSearchAddress.parse('10.0.0.1:5/9'))).toBe(false);
            expect(a.toString()).toBe('InterfaceSearchAddress[address=/10.0.0.1:5, subnetPrefix=8]');
        });

        it('hasAWildcardOfThePortAndPrefixZero', () => {
            const wildcard = InterfaceSearchAddress.wildcard();

            expect(wildcard).toBe(InterfaceSearchAddress.wildcard());
            expect(wildcard.subnetPrefix).toBe(0);
            expect(wildcard.address.getPort()).toBe(0);
            expect((wildcard.address.getAddress() as InetAddress).isAnyLocalAddress()).toBe(true);
        });
    });

    describe('InterfaceSearchAddress.resolve', () => {
        it('usesNoInterfaceForTheWildcardAddressWhenNotMulticast', () => {
            const resolved = InterfaceSearchAddress.wildcard().resolve(false, StandardProtocolFamily.INET);

            expect(resolved.localInterface).toBeNull();
            expect(resolved.address).toBe(InterfaceSearchAddress.wildcard().address);
        });

        it('listsTheCandidatesWhenNoInterfaceMatches', () => {
            const e = assertThrowsExactly(IllegalArgumentException, () =>
                InterfaceSearchAddress.parse('192.0.2.1/32').resolve(true, StandardProtocolFamily.INET),
            );

            expect(e.message).toBe('Unable to find multicast or loopback interface matching criteria: /192.0.2.1/32');
        });

        it('findsALoopbackInterfaceOfTheHost', () => {
            const lo = NetworkInterface.getNetworkInterfaces().find(
                (i) =>
                    i.isLoopback() && i.getInterfaceAddresses().some((a) => a.getAddress().getAddress().length === 4),
            );
            if (undefined === lo) {
                return; // a host without an IPv4 loopback interface
            }

            const resolved = InterfaceSearchAddress.parse('127.0.0.1:99/8').resolve(false, StandardProtocolFamily.INET);

            expect(resolved.localInterface?.isLoopback()).toBe(true);
            expect(resolved.address.getPort()).toBe(99);
            expect((resolved.address.getAddress() as InetAddress).isLoopbackAddress()).toBe(true);
        });
    });

    describe('UnresolvedInterface.parse', () => {
        it('chooses_NamedInterface_only_for_an_opening_brace', () => {
            expect(UnresolvedInterface.parse('{lo}:5')).toEqual(new NamedInterface('lo', 5));
            expect(UnresolvedInterface.parse('10.1.1.1/8')).toBeInstanceOf(InterfaceSearchAddress);
        });

        it('passesTheErrorsOfTheParsersThrough', () => {
            const e = assertThrowsExactly(IllegalArgumentException, () => UnresolvedInterface.parse('{x'));

            expect(e.message).toBe(FORMAT + "'{x'");
            expect(assertThrowsExactly(IllegalArgumentException, () => UnresolvedInterface.parse('')).message).toBe(
                'interface is null or empty',
            );
        });
    });
});
