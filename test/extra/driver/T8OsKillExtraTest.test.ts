import { describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    return {
        ...actual,
        networkInterfaces: () => ({
            lo: [
                {
                    address: '127.0.0.1',
                    netmask: '255.0.0.0',
                    family: 'IPv4',
                    mac: '00:00:00:00:00:00',
                    internal: true,
                    cidr: '127.0.0.1/8',
                },
            ],
            eth9: [
                {
                    address: '10.9.0.2',
                    netmask: '255.255.0.0',
                    family: 'IPv4',
                    mac: '02:00:00:00:00:01',
                    internal: false,
                    cidr: '10.9.0.2/16',
                },
                {
                    address: 'fe80::9',
                    netmask: 'ffff:ffff:ffff:ffff::',
                    family: 'IPv6',
                    mac: '02:00:00:00:00:01',
                    internal: false,
                    cidr: 'fe80::9/64',
                    scopeid: 7,
                },
                {
                    address: '2001:db8::9',
                    netmask: 'ffff:ffff:ffff:ffff::',
                    family: 'IPv6',
                    mac: '02:00:00:00:00:01',
                    internal: false,
                    cidr: '2001:db8::9/64',
                    scopeid: 0,
                },
            ],
        }),
    };
});

const { InetAddress, NetworkInterface, StandardProtocolFamily } = await import('../../../src/driver/jdkNet.js');
const { InterfaceSearchAddress } = await import('../../../src/driver/media/InterfaceSearchAddress.js');
const { NamedInterface } = await import('../../../src/driver/media/NamedInterface.js');

describe('T8OsKillExtraTest', () => {
    it('M30 mapsTheFlagsAndPrefixes', () => {
        // the flags files of the host belong to its own interfaces, not to the interfaces that `os` is mocked to list
        NetworkInterface.flagsDirectory = null;
        const all = NetworkInterface.getNetworkInterfaces();
        expect(all.map((i) => i.getName())).toEqual(['lo', 'eth9']);
        const [lo, eth9] = all;
        expect(lo!.isLoopback()).toBe(true);
        expect(lo!.supportsMulticast()).toBe(false);
        expect(eth9!.isLoopback()).toBe(false);
        expect(eth9!.supportsMulticast()).toBe(true);
        expect(eth9!.getInterfaceAddresses().map((a) => a.getNetworkPrefixLength())).toEqual([16, 64, 64]);
    });
    it('M31 keepsTheInterfaceNameOfAScope', () => {
        const a = InetAddress.getByName('fe80::1%eth9') as InstanceType<
            typeof import('../../../src/driver/jdkNet.js').Inet6Address
        >;
        expect(a.getScopeId()).toBe(7);
        expect(a.getHostAddress()).toBe('fe80:0:0:0:0:0:0:1%eth9');
    });
    it('resolvesASubnetSearchAndANamedInterfaceDeterministically', () => {
        const r = InterfaceSearchAddress.parse('10.9.0.0:77/16').resolve(true, StandardProtocolFamily.INET);
        expect(r.localInterface!.getName()).toBe('eth9');
        expect(r.address.toString()).toBe('/10.9.0.2:77');
        const n = new NamedInterface('eth9', 5).resolve(false, StandardProtocolFamily.INET6);
        expect(n.address.getPort()).toBe(5);
        expect(n.address.getAddress()!.getAddress().length).toBe(16);
    });
    it('F2 ipV6InterfaceAddressesCarryTheInterfaceNameAsScope', () => {
        const eth9 = NetworkInterface.getByName('eth9')!;
        const hostAddresses = eth9.getInterfaceAddresses().map((a) => a.getAddress().getHostAddress());
        expect(hostAddresses).toContain('fe80:0:0:0:0:0:0:9%eth9');
        expect(hostAddresses).toContain('2001:db8:0:0:0:0:0:9');
    });
    it('N3b getByInetAddressFindsTheInterfaceThatHasTheAddress', () => {
        expect(NetworkInterface.getByInetAddress(InetAddress.getByName('10.9.0.2'))!.getName()).toBe('eth9');
        expect(NetworkInterface.getByInetAddress(InetAddress.getByName('127.0.0.1'))!.getName()).toBe('lo');
        expect(NetworkInterface.getByInetAddress(InetAddress.getByName('10.9.0.3'))).toBeNull();
    });
});
