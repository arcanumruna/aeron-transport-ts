// Regression test of issue #14 (port-only, spec D133): the flags of the `NetworkInterface` stand-in are those of
// `/sys/class/net/<name>/flags` on Linux, `isUp` also needs the carrier (IFF_RUNNING emulated), and an interface without
// an address is not listed. `os.networkInterfaces()` is mocked to
// list `lo` and `eth9`; a temporary directory plays `/sys/class/net`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
            ],
        }),
    };
});

const { NetworkInterface } = await import('../../../src/driver/jdkNet.js');

describe('NetworkInterfaceFlagsRegression', () => {
    let directory: string;
    const defaultDirectory = NetworkInterface.flagsDirectory;

    function flags(name: string, content: string): void {
        mkdirSync(join(directory, name));
        writeFileSync(join(directory, name, 'flags'), content);
    }

    function byName(name: string): InstanceType<typeof NetworkInterface> {
        const found = NetworkInterface.getByName(name);
        expect(found, name).not.toBeNull();
        return found as InstanceType<typeof NetworkInterface>;
    }

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'flags-'));
        NetworkInterface.flagsDirectory = directory;
    });

    afterEach(() => {
        NetworkInterface.flagsDirectory = defaultDirectory;
        rmSync(directory, { recursive: true, force: true });
    });

    it('theFlagsOfAnInterfaceAreThoseOfItsFlagsFile', () => {
        flags('lo', '0x9\n'); // IFF_UP | IFF_LOOPBACK, as a Linux sandbox without IFF_MULTICAST on lo
        flags('eth9', '0x1003\n'); // IFF_UP | IFF_BROADCAST | IFF_MULTICAST

        const lo = byName('lo');
        expect([lo.isUp(), lo.isLoopback(), lo.supportsMulticast()]).toEqual([true, true, false]);
        const eth9 = byName('eth9');
        expect([eth9.isUp(), eth9.isLoopback(), eth9.supportsMulticast()]).toEqual([true, false, true]);
    });

    it('theLoopbackInterfaceThatHasTheMulticastFlagSupportsMulticast', () => {
        flags('lo', '0x1009\n');
        flags('eth9', '0x1003\n');

        expect(byName('lo').supportsMulticast()).toBe(true);
    });

    it('anInterfaceThatIsDownIsNotUp Regression', () => {
        flags('lo', '0x9\n');
        flags('eth9', '0x1002\n'); // listed by Node, but IFF_UP is not set

        const eth9 = byName('eth9');
        expect(eth9.isUp()).toBe(false);
        expect(eth9.getInterfaceAddresses()).toHaveLength(1);
    });

    it('anInterfaceWithoutAnAddressIsNotListed Regression', () => {
        flags('lo', '0x9\n');
        flags('eth9', '0x1003\n');
        flags('eth8', '0x1003\n'); // IFF_UP and no address (Node does not list it): the JDK does not list it either

        expect(NetworkInterface.getNetworkInterfaces().map((i) => i.getName())).toEqual(['lo', 'eth9']);
        expect(NetworkInterface.getByName('eth8')).toBeNull();
    });

    it('anInterfaceThatIsUpWithoutCarrierIsNotUp Regression', () => {
        flags('lo', '0x9\n');
        flags('eth9', '0x1003\n'); // IFF_UP, as docker0 without a container: sysfs has no IFF_RUNNING
        writeFileSync(join(directory, 'eth9', 'carrier'), '0\n');

        expect(byName('eth9').isUp()).toBe(false);
    });

    it('anInterfaceThatIsUpWithCarrierIsUp Regression', () => {
        flags('lo', '0x9\n');
        flags('eth9', '0x1003\n');
        writeFileSync(join(directory, 'eth9', 'carrier'), '1\n');

        expect(byName('eth9').isUp()).toBe(true);
    });

    it('theOperstateDecidesWhenTheCarrierCannotBeRead Regression', () => {
        flags('lo', '0x9\n');
        flags('eth9', '0x1003\n');
        writeFileSync(join(directory, 'lo', 'operstate'), 'unknown\n'); // lo has no carrier
        writeFileSync(join(directory, 'eth9', 'operstate'), 'down\n');

        expect(byName('lo').isUp()).toBe(true);
        expect(byName('eth9').isUp()).toBe(false);

        writeFileSync(join(directory, 'eth9', 'operstate'), 'up\n');
        expect(byName('eth9').isUp()).toBe(true);
    });

    it('aFlagsFileThatCannotBeReadFallsBackToTheApproximationOfNodesData', () => {
        flags('lo', 'not hex\n');
        // eth9 has no flags file

        const lo = byName('lo');
        expect([lo.isUp(), lo.isLoopback(), lo.supportsMulticast()]).toEqual([
            true,
            true,
            'darwin' === process.platform,
        ]);
        const eth9 = byName('eth9');
        expect([eth9.isUp(), eth9.isLoopback(), eth9.supportsMulticast()]).toEqual([true, false, true]);
    });

    it('withoutAFlagsDirectoryTheApproximationOfNodesDataIsUsed', () => {
        NetworkInterface.flagsDirectory = null;

        expect(NetworkInterface.getNetworkInterfaces().map((i) => i.getName())).toEqual(['lo', 'eth9']);
        expect(byName('eth9').supportsMulticast()).toBe(true);
    });
});
