// Tests that Aeron does not have (spec 8.2): NetworkUtil prefix and subnet matching for IPv4 and IPv6 at the prefix
// lengths 0, 1, 31/32 and 127/128, the interface filter order, and the helpers around them.
import { describe, expect, it } from 'vitest';
import { networkInterfaces } from 'node:os';
import { IllegalArgumentException, IllegalStateException } from '../../../../src/agrona/jdk.js';
import {
    InetAddress,
    InterfaceAddress,
    NetworkInterface,
    StandardProtocolFamily,
} from '../../../../src/driver/jdkNet.js';
import type { NetworkInterfaceShim } from '../../../../src/driver/media/NetworkInterfaceShim.js';
import { NetworkInterfaceShim as Shim } from '../../../../src/driver/media/NetworkInterfaceShim.js';
import { NetworkUtil } from '../../../../src/driver/media/NetworkUtil.js';
import { assertThrowsExactly } from '../../../support/Assertions.js';

const { isMatchWithPrefix } = NetworkUtil;

function v4(a: number, b: number, c: number, d: number): Uint8Array {
    return Uint8Array.of(a, b, c, d);
}

/** A 16 byte address whose bytes are `fill`, with `bytes` set at the given offsets. */
function v6(fill: number, ...changes: [offset: number, value: number][]): Uint8Array {
    const a = new Uint8Array(16).fill(fill);
    for (const [offset, value] of changes) {
        a[offset] = value;
    }

    return a;
}

class FakeShim implements NetworkInterfaceShim {
    private readonly interfaces = new Map<NetworkInterface, { addresses: InterfaceAddress[]; loopback: boolean }>();

    public add(name: string, loopback: boolean, ...ips: [string, number][]): NetworkInterface {
        const ifc = new NetworkInterface(name, name, [], { loopback, up: true, multicast: !loopback });
        this.interfaces.set(ifc, {
            addresses: ips.map(([ip, prefix]) => new InterfaceAddress(InetAddress.getByName(ip), null, prefix)),
            loopback,
        });

        return ifc;
    }

    public getNetworkInterfaces(): NetworkInterface[] {
        return [...this.interfaces.keys()];
    }

    public getInterfaceAddresses(ifc: NetworkInterface): InterfaceAddress[] {
        return (this.interfaces.get(ifc) as { addresses: InterfaceAddress[] }).addresses;
    }

    public isLoopback(ifc: NetworkInterface): boolean {
        return (this.interfaces.get(ifc) as { loopback: boolean }).loopback;
    }
}

describe('NetworkUtilExtraTest', () => {
    describe('IPv4 prefix matching', () => {
        it('matchesEverythingAtPrefixLengthZero', () => {
            expect(isMatchWithPrefix(v4(0, 0, 0, 0), v4(255, 255, 255, 255), 0)).toBe(true);
            expect(isMatchWithPrefix(v4(10, 0, 0, 1), v4(192, 168, 0, 1), 0)).toBe(true);
        });

        it('comparesOnlyTheTopBitAtPrefixLengthOne', () => {
            expect(isMatchWithPrefix(v4(0x80, 0, 0, 0), v4(0xff, 0xff, 0xff, 0xff), 1)).toBe(true);
            expect(isMatchWithPrefix(v4(0x7f, 0xff, 0xff, 0xff), v4(0x00, 0, 0, 0), 1)).toBe(true);
            expect(isMatchWithPrefix(v4(0x80, 0, 0, 0), v4(0x7f, 0xff, 0xff, 0xff), 1)).toBe(false);
        });

        it('ignoresOnlyTheLastBitAtPrefixLength31', () => {
            expect(isMatchWithPrefix(v4(10, 0, 0, 2), v4(10, 0, 0, 3), 31)).toBe(true);
            expect(isMatchWithPrefix(v4(10, 0, 0, 1), v4(10, 0, 0, 2), 31)).toBe(false);
            expect(isMatchWithPrefix(v4(255, 255, 255, 254), v4(255, 255, 255, 255), 31)).toBe(true);
        });

        it('comparesEveryBitAtPrefixLength32', () => {
            expect(isMatchWithPrefix(v4(10, 0, 0, 2), v4(10, 0, 0, 2), 32)).toBe(true);
            expect(isMatchWithPrefix(v4(10, 0, 0, 2), v4(10, 0, 0, 3), 32)).toBe(false);
            expect(isMatchWithPrefix(v4(0x80, 0, 0, 0), v4(0, 0, 0, 0), 32)).toBe(false);
            expect(isMatchWithPrefix(v4(255, 255, 255, 255), v4(255, 255, 255, 255), 32)).toBe(true);
        });

        it.each([8, 16, 24])('matchesTheNetworkAddressOfAnInterfaceAtPrefixLength %d', (prefix) => {
            const network = v4(192, 168, 1, 0);
            expect(isMatchWithPrefix(v4(192, 168, 1, 77), network, prefix)).toBe(true);
            expect(isMatchWithPrefix(v4(193, 168, 1, 77), network, prefix)).toBe(false);
        });

        it('isNotMatchedAcrossAddressFamilies', () => {
            expect(isMatchWithPrefix(v4(0, 0, 0, 1), v6(0), 0)).toBe(false);
        });

        it.each([3, 5, 15, 17])('throwsForAnAddressThatIsNotFourOrSixteenBytes %d', (length) => {
            const e = assertThrowsExactly(IllegalArgumentException, () =>
                isMatchWithPrefix(new Uint8Array(length), new Uint8Array(length), 8),
            );

            expect(e.message).toBe('how many bytes does an IP address have again?');
        });
    });

    describe('IPv6 prefix matching', () => {
        it('matchesEverythingAtPrefixLengthZero', () => {
            expect(isMatchWithPrefix(v6(0), v6(0xff), 0)).toBe(true);
        });

        it('comparesOnlyTheTopBitAtPrefixLengthOne', () => {
            expect(isMatchWithPrefix(v6(0, [0, 0x80]), v6(0xff), 1)).toBe(true);
            expect(isMatchWithPrefix(v6(0, [0, 0x7f]), v6(0xff), 1)).toBe(false);
            expect(isMatchWithPrefix(v6(0xff, [0, 0x7f]), v6(0), 1)).toBe(true);
        });

        it.each([63, 64, 65])('splitsTheTwoWordsAtPrefixLength %d', (prefix) => {
            const a = v6(0, [7, 1]);
            const b = v6(0);
            // Bit 63 (the last of the upper word) differs.
            expect(isMatchWithPrefix(a, b, prefix)).toBe(prefix <= 63);

            const c = v6(0, [8, 0x80]);
            // Bit 64 (the first of the lower word) differs.
            expect(isMatchWithPrefix(c, b, prefix)).toBe(prefix <= 64);
        });

        it('ignoresOnlyTheLastBitAtPrefixLength127', () => {
            expect(isMatchWithPrefix(v6(0, [15, 0]), v6(0, [15, 1]), 127)).toBe(true);
            expect(isMatchWithPrefix(v6(0, [15, 1]), v6(0, [15, 2]), 127)).toBe(false);
            expect(isMatchWithPrefix(v6(0xff, [15, 0xfe]), v6(0xff), 127)).toBe(true);
        });

        it('comparesEveryBitAtPrefixLength128', () => {
            expect(isMatchWithPrefix(v6(0, [15, 0]), v6(0, [15, 1]), 128)).toBe(false);
            expect(isMatchWithPrefix(v6(0x5a), v6(0x5a), 128)).toBe(true);
            expect(isMatchWithPrefix(v6(0, [0, 0x80]), v6(0), 128)).toBe(false);
        });

        it('matchesALinkLocalPrefixAtLength10', () => {
            const fe80 = InetAddress.getByName('fe80::1').getAddress();
            const febf = InetAddress.getByName('febf:ffff::9').getAddress();
            const fec0 = InetAddress.getByName('fec0::1').getAddress();

            expect(isMatchWithPrefix(fe80, febf, 10)).toBe(true);
            expect(isMatchWithPrefix(fe80, fec0, 10)).toBe(false);
        });
    });

    describe('IPv4 mask', () => {
        it('isZeroAtPrefixLengthZeroAndAllOnesAtThirtyTwo', () => {
            expect(NetworkUtil.prefixLengthToIpV4Mask(0)).toBe(0);
            expect(NetworkUtil.prefixLengthToIpV4Mask(32)).toBe(-1);
            expect(NetworkUtil.prefixLengthToIpV4Mask(1)).toBe(-2147483648);
            expect(NetworkUtil.prefixLengthToIpV4Mask(31)).toBe(-2);
        });
    });

    describe('toLong', () => {
        it('readsTheBigEndianWordsAsSignedLongs', () => {
            const bytes = Uint8Array.of(0x80, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

            expect(NetworkUtil.toLong(bytes, 0)).toBe(-9223372036854775807n);
            expect(NetworkUtil.toLong(bytes, 8)).toBe(-1n);
        });
    });

    describe('filterBySubnet', () => {
        it('listsNonLoopbackInterfacesBeforeLoopbackOnesAndLongerPrefixesFirst', () => {
            const shim = new FakeShim();
            const lo = shim.add('lo', true, ['127.0.0.1', 8]);
            const wide = shim.add('wide', false, ['10.1.2.3', 8]);
            const narrow = shim.add('narrow', false, ['10.1.2.4', 24]);
            shim.add('other', false, ['192.168.0.1', 24]);

            const result = NetworkUtil.filterBySubnet(shim, InetAddress.getByName('10.0.0.0'), 8);

            expect(result).toEqual([narrow, wide]);
            expect(NetworkUtil.filterBySubnet(shim, InetAddress.getByName('127.0.0.0'), 8)).toEqual([lo]);
        });

        it('putsALoopbackInterfaceAfterNonLoopbackOnesThatMatch', () => {
            const shim = new FakeShim();
            const lo = shim.add('lo', true, ['10.9.9.9', 32]);
            const eth = shim.add('eth', false, ['10.1.1.1', 8]);

            expect(NetworkUtil.filterBySubnet(shim, InetAddress.getByName('10.0.0.0'), 8)).toEqual([eth, lo]);
        });

        it('findsTheFirstMatchingAddressOfAnInterfaceWithSeveral', () => {
            const shim = new FakeShim();
            const ifc = shim.add('eth', false, ['fe80::1', 64], ['10.1.1.1', 24], ['10.2.2.2', 24]);

            const found = NetworkUtil.findAddressOnInterface(shim, ifc, Uint8Array.of(10, 0, 0, 0), 8);

            expect((found as InterfaceAddress).getAddress().getHostAddress()).toBe('10.1.1.1');
            expect(NetworkUtil.findAddressOnInterface(shim, ifc, Uint8Array.of(11, 0, 0, 0), 8)).toBeNull();
        });

        it('doesNotMatchAnIpV6QueryAgainstAnIpV4Interface', () => {
            const shim = new FakeShim();
            shim.add('eth', false, ['10.1.1.1', 24]);

            expect(NetworkUtil.filterBySubnet(shim, InetAddress.getByName('::'), 0)).toEqual([]);
        });

        it('returnsEveryInterfaceAtPrefixLengthZero', () => {
            const shim = new FakeShim();
            const a = shim.add('a', false, ['10.1.1.1', 8]);
            const b = shim.add('b', false, ['172.16.1.1', 24]);

            const result = NetworkUtil.filterBySubnet(shim, InetAddress.getByName('0.0.0.0'), 0);

            expect(result).toEqual([b, a]);
        });
    });

    describe('the default shim', () => {
        it('listsTheInterfacesOfTheHost', () => {
            const interfaces = Shim.DEFAULT.getNetworkInterfaces();
            // Node lists the interfaces that are up with an address; the others are listed from the flags files (spec D131)
            const listedByNode = new Set(Object.keys(networkInterfaces()));

            for (const ifc of interfaces) {
                expect(ifc.getName().length).toBeGreaterThan(0);
                if (listedByNode.has(ifc.getName())) {
                    expect(Shim.DEFAULT.getInterfaceAddresses(ifc).length).toBeGreaterThan(0);
                }
                expect(Shim.DEFAULT.isLoopback(ifc)).toBe(ifc.isLoopback());
            }
        });
    });

    describe('helpers', () => {
        it('formatsAnIpV4AddressAndPort', () => {
            expect(NetworkUtil.formatAddressAndPort(InetAddress.getByName('10.0.0.1'), 40123)).toBe('10.0.0.1:40123');
        });

        it('formatsAnIpV6AddressAndPortInBrackets', () => {
            expect(NetworkUtil.formatAddressAndPort(InetAddress.getByName('::1'), 40123)).toBe(
                '[0:0:0:0:0:0:0:1]:40123',
            );
        });

        it('findsTheProtocolFamilyOfAnAddress', () => {
            expect(NetworkUtil.getProtocolFamily(InetAddress.getByName('10.0.0.1'))).toBe(StandardProtocolFamily.INET);
            expect(NetworkUtil.getProtocolFamily(InetAddress.getByName('fe80::1'))).toBe(StandardProtocolFamily.INET6);
            expect(String(StandardProtocolFamily.INET6)).toBe('INET6');
        });

        it('throwsForAnAddressOfNoFamily', () => {
            const e = assertThrowsExactly(IllegalStateException, () =>
                NetworkUtil.getProtocolFamily({} as InetAddress),
            );

            expect(e.message).toBe('Unknown ProtocolFamily');
        });
    });
});
