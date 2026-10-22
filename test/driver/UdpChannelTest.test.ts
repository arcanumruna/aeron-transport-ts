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
// Port of io/aeron/driver/UdpChannelTest.java @ 1.53.3
import { vi } from 'vitest';

// The host loopback with `::1` added when the host has none, so the IPv6 tests run on every host.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    return {
        ...actual,
        networkInterfaces: () => {
            const real = actual.networkInterfaces();
            for (const entries of Object.values(real)) {
                if (
                    entries?.some((e) => e.internal && e.address === '127.0.0.1') &&
                    !entries.some((e) => e.address === '::1')
                ) {
                    entries.push({
                        address: '::1',
                        netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
                        family: 'IPv6',
                        mac: '00:00:00:00:00:00',
                        internal: true,
                        cidr: '::1/128',
                        scopeid: 0,
                    });
                }
            }
            return real;
        },
    };
});
import { describe, expect, it } from 'vitest';
import { Object2ObjectHashMap } from '../../src/agrona/collections/Object2ObjectHashMap.js';
import { TimeUnit } from '../../src/agrona/jdk.js';
import { getCause } from '../../src/agrona/jdkThrowable.js';
import { Strings } from '../../src/agrona/Strings.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { ChannelUriStringBuilder } from '../../src/client/ChannelUriStringBuilder.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { DefaultNameResolver } from '../../src/driver/DefaultNameResolver.js';
import { InvalidChannelException } from '../../src/driver/exceptions/InvalidChannelException.js';
import { InetAddress, InetSocketAddress, NetworkInterface, StandardProtocolFamily } from '../../src/driver/jdkNet.js';
import { ControlMode } from '../../src/driver/media/ControlMode.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import type { NameResolver } from '../../src/driver/NameResolver.js';
import { assertEqualsObject, assertIs, assertThrows, assertThrowsExactly } from '../support/Assertions.js';

const { DYNAMIC, MANUAL, RESPONSE } = ControlMode;
const getByName = (host: string): InetAddress => InetAddress.getByName(host);

/** Hamcrest `matchesPattern(regex)`: the whole string matches. */
function matchesPattern(actual: string, pattern: RegExp): void {
    expect(new RegExp('^(?:' + pattern.source + ')$').test(actual)).toBe(true);
}

/** `NetworkInterfaceTypeSafeMatcher`: a non-null interface that supports multicast or is the loopback. */
function supportsMulticastOrIsLoopback(networkInterface: NetworkInterface | null): void {
    expect(networkInterface).toBeInstanceOf(NetworkInterface);
    const ifc = networkInterface as NetworkInterface;
    expect(ifc.supportsMulticast() || ifc.isLoopback()).toBe(true);
}

function isMulticastAddress(actual: InetSocketAddress, addressName: string, port: number): void {
    const inetAddress = getByName(addressName);
    assertIs(actual, new InetSocketAddress(inetAddress, port));
}

function uri(endpointKey: string, endpointValue: string, interfaceKey?: string, interfaceValue?: string): string {
    if (undefined === interfaceKey) {
        return 'aeron:udp?' + endpointKey + '=' + endpointValue;
    }

    return 'aeron:udp?' + endpointKey + '=' + endpointValue + '|' + interfaceKey + '=' + interfaceValue;
}

function invalidMulticastAddresses(): (ChannelUri | null)[] {
    return [
        null,
        ChannelUri.parse('aeron:ipc'),
        ChannelUri.parse('aeron:udp?mtu=4096'),
        ChannelUri.parse('aeron:udp?endpoint=test'),
        ChannelUri.parse('aeron:udp?endpoint=test:a'),
        ChannelUri.parse('aeron:udp?endpoint=[xx:xx:xx:xx]:5656'),
    ];
}

/** The anonymous `NameResolver` of `shouldParseWithNameResolver`. */
class LookupNameResolver implements NameResolver {
    public constructor(
        private readonly endpointName: string,
        private readonly endpointAddress: string,
        private readonly controlName: string | null,
        private readonly controlAddress: string | null,
        private readonly port: number,
    ) {}

    public resolve(name: string, uriParamName: string, isReResolution: boolean): InetAddress | null {
        return DefaultNameResolver.INSTANCE.resolve(name, uriParamName, isReResolution);
    }

    public lookup(name: string, _uriParamName: string, _isReLookup: boolean): string {
        if (this.endpointName === name) {
            return this.endpointAddress + ':' + this.port;
        } else if (this.controlName === name) {
            return this.controlAddress + ':' + this.port;
        }

        return name;
    }

    public name(): string {
        return this.constructor.name;
    }
}

describe('UdpChannelTest', () => {
    it('shouldHandleExplicitLocalAddressAndPortFormat', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?interface=localhost:40123|endpoint=localhost:40124');

        assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 40123));
        assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 40123));
        assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
    });

    it('shouldHandleExplicitLocalControlAddressAndPortFormatIPv4', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?control=localhost:40124|control-mode=dynamic');

        assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 40124));
        assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 40124));
        assertIs(udpChannel.remoteData(), new InetSocketAddress('0.0.0.0', 0));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('0.0.0.0', 0));
    });

    it('shouldHandleExplicitLocalControlAddressAndPortFormatIPv6', () => {
        // assumeTrue(System.getProperty("java.net.preferIPv4Stack") == null): there is no such property, always true.
        const udpChannel = UdpChannel.parse('aeron:udp?control=[fe80::5246:5dff:fe73:df06]:40124|control-mode=dynamic');

        assertIs(udpChannel.localData(), new InetSocketAddress('fe80::5246:5dff:fe73:df06', 40124));
        assertIs(udpChannel.localControl(), new InetSocketAddress('fe80::5246:5dff:fe73:df06', 40124));
        assertIs(udpChannel.remoteData(), new InetSocketAddress('::', 0));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('::', 0));
    });

    it('shouldNotAllowDynamicControlModeWithoutExplicitControl', () => {
        try {
            UdpChannel.parse('aeron:udp?control-mode=dynamic');
            expect.fail('InvalidChannelException expected');
        } catch (ex) {
            if (!(ex instanceof InvalidChannelException)) {
                throw ex;
            }

            const cause = getCause(ex);
            expect(cause).not.toBeNull();
            expect((cause as Error).message).toContain('explicit control expected with dynamic control mode');
        }
    });

    it.each([['endpoint', 'interface']])(
        'shouldHandleExplicitLocalAddressAndPortFormatWithAeronUri %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, 'localhost:40124', interfaceKey, 'localhost:40123'));

            assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 40123));
            assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 40123));
            assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
            assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
        },
    );

    it('shouldHandleImpliedLocalAddressAndPortFormat', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');

        assertIs(udpChannel.localData(), new InetSocketAddress('0.0.0.0', 0));
        assertIs(udpChannel.localControl(), new InetSocketAddress('0.0.0.0', 0));
        assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
    });

    it.each([['endpoint', 'interface']])(
        'shouldHandleImpliedLocalAddressAndPortFormatWithAeronUri %s',
        (endpointKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, 'localhost:40124'));

            assertIs(udpChannel.localData(), new InetSocketAddress('0.0.0.0', 0));
            assertIs(udpChannel.localControl(), new InetSocketAddress('0.0.0.0', 0));
            assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
            assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
        },
    );

    it('shouldThrowExceptionForIncorrectScheme', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('unknownudp://localhost:40124'));
    });

    it('shouldThrowExceptionForMissingAddressWithAeronUri', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('aeron:udp'));
    });

    it('shouldThrowExceptionOnEvenMulticastAddress', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('aeron:udp?endpoint=224.10.9.8'));
    });

    it('shouldParseValidMulticastAddress', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?interface=localhost|endpoint=224.10.9.9:40124');

        assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 0));
        isMulticastAddress(udpChannel.remoteControl(), '224.10.9.10', 40124);
        assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 0));
        isMulticastAddress(udpChannel.remoteData(), '224.10.9.9', 40124);
        assertEqualsObject(NetworkInterface.getByInetAddress(getByName('localhost')), udpChannel.localInterface());
    });

    it.each([['endpoint', 'interface']])(
        'shouldParseValidMulticastAddressWithAeronUri %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, '224.10.9.9:40124', interfaceKey, 'localhost'));

            assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 0));
            isMulticastAddress(udpChannel.remoteControl(), '224.10.9.10', 40124);
            assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 0));
            isMulticastAddress(udpChannel.remoteData(), '224.10.9.9', 40124);
            assertEqualsObject(NetworkInterface.getByInetAddress(getByName('localhost')), udpChannel.localInterface());
        },
    );

    it('shouldHandleImpliedLocalPortFormat', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?interface=localhost|endpoint=localhost:40124');

        assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 0));
        assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 0));
        assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
    });

    it.each([['endpoint', 'interface']])(
        'shouldHandleImpliedLocalPortFormatWithAeronUri %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, 'localhost:40124', interfaceKey, 'localhost'));

            assertIs(udpChannel.localData(), new InetSocketAddress('localhost', 0));
            assertIs(udpChannel.localControl(), new InetSocketAddress('localhost', 0));
            assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
            assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
        },
    );

    it.each([['endpoint', 'interface']])(
        'shouldHandleIPv4AnyAddressAsInterfaceAddressForUnicast %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, 'localhost:40124', interfaceKey, '0.0.0.0'));

            assertIs(udpChannel.localData(), new InetSocketAddress('0.0.0.0', 0));
            assertIs(udpChannel.localControl(), new InetSocketAddress('0.0.0.0', 0));
            assertIs(udpChannel.remoteData(), new InetSocketAddress('localhost', 40124));
            assertIs(udpChannel.remoteControl(), new InetSocketAddress('localhost', 40124));
        },
    );

    it.each([['endpoint', 'interface']])(
        'shouldHandleIPv6AnyAddressAsInterfaceAddressForUnicast %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, '[::1]:40124', interfaceKey, '[::]'));

            assertIs(udpChannel.localData(), new InetSocketAddress('::', 0));
            assertIs(udpChannel.localControl(), new InetSocketAddress('::', 0));
            assertIs(udpChannel.remoteData(), new InetSocketAddress('::1', 40124));
            assertIs(udpChannel.remoteControl(), new InetSocketAddress('::1', 40124));
        },
    );

    it('shouldHandleLocalhostLookup', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');

        assertIs(udpChannel.remoteData(), new InetSocketAddress('127.0.0.1', 40124));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('127.0.0.1', 40124));
    });

    it.each(['endpoint'])('shouldHandleLocalhostLookupWithAeronUri %s', (endpointKey) => {
        const udpChannel = UdpChannel.parse(uri(endpointKey, 'localhost:40124'));

        assertIs(udpChannel.remoteData(), new InetSocketAddress('127.0.0.1', 40124));
        assertIs(udpChannel.remoteControl(), new InetSocketAddress('127.0.0.1', 40124));
    });

    it('shouldHandleBeingUsedAsMapKey', () => {
        const udpChannel1 = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');
        const udpChannel2 = UdpChannel.parse('aeron:udp?endpoint=localhost:40124');

        const map = new Object2ObjectHashMap<UdpChannel, number>();

        map.put(udpChannel1, 1);
        expect(map.get(udpChannel2)).toBe(1);
    });

    it('shouldThrowExceptionWhenNoPortSpecified', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('aeron:udp?endpoint=localhost'));
    });

    it('shouldHandleCanonicalFormForUnicastCorrectly', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:20000');
        const udpChannelLocal = UdpChannel.parse('aeron:udp?interface=127.0.0.1|endpoint=192.168.0.1:20000');
        const udpChannelLocalPort = UdpChannel.parse('aeron:udp?interface=127.0.0.1:40455|endpoint=192.168.0.1:20000');
        const udpChannelLocalhost = UdpChannel.parse('aeron:udp?interface=localhost|endpoint=localhost:20000');

        expect(udpChannel.canonicalForm()).toBe('UDP-0.0.0.0:0-192.168.0.1:20000');
        expect(udpChannelLocal.canonicalForm()).toBe('UDP-127.0.0.1:0-192.168.0.1:20000');
        expect(udpChannelLocalPort.canonicalForm()).toBe('UDP-127.0.0.1:40455-192.168.0.1:20000');
        expect(udpChannelLocalhost.canonicalForm()).toBe('UDP-127.0.0.1:0-localhost:20000');
    });

    it.each([['endpoint', 'interface']])(
        'shouldHandleIpV6CanonicalFormForUnicastCorrectly %s %s',
        (endpointKey, interfaceKey) => {
            // assumeTrue(System.getProperty("java.net.preferIPv4Stack") == null): there is no such property, always true.
            const udpChannelLocal = UdpChannel.parse(uri(endpointKey, '192.168.0.1:20000', interfaceKey, '[::1]'));
            const udpChannelLocalPort = UdpChannel.parse(
                uri(endpointKey, '[fe80::5246:5dff:fe73:df06]:20000', interfaceKey, '127.0.0.1:40455'),
            );

            expect(udpChannelLocal.canonicalForm()).toBe(
                'UDP-' + udpChannelLocal.localData().getHostString() + ':0-192.168.0.1:20000',
            );
            expect(udpChannelLocalPort.canonicalForm()).toBe('UDP-127.0.0.1:40455-[fe80::5246:5dff:fe73:df06]:20000');
        },
    );

    it.each([['endpoint', 'interface']])(
        'shouldHandleCanonicalFormForUnicastCorrectlyWithAeronUri %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, '192.168.0.1:20000'));
            const udpChannelLocal = UdpChannel.parse(uri(endpointKey, '192.168.0.1:20000', interfaceKey, '127.0.0.1'));
            const udpChannelLocalPort = UdpChannel.parse(
                uri(endpointKey, '192.168.0.1:20000', interfaceKey, '127.0.0.1:40455'),
            );
            const udpChannelLocalhost = UdpChannel.parse(
                uri(endpointKey, 'localhost:20000', interfaceKey, 'localhost'),
            );

            expect(udpChannel.canonicalForm()).toBe('UDP-0.0.0.0:0-192.168.0.1:20000');
            expect(udpChannelLocal.canonicalForm()).toBe('UDP-127.0.0.1:0-192.168.0.1:20000');
            expect(udpChannelLocalPort.canonicalForm()).toBe('UDP-127.0.0.1:40455-192.168.0.1:20000');
            expect(udpChannelLocalhost.canonicalForm()).toBe('UDP-127.0.0.1:0-localhost:20000');
        },
    );

    it('shouldGetProtocolFamilyForIpV4', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:12345|interface=127.0.0.1');
        expect(udpChannel.protocolFamily()).toBe(StandardProtocolFamily.INET);
    });

    it('shouldGetProtocolFamilyForIpV6', () => {
        // assumeTrue(System.getProperty("java.net.preferIPv4Stack") == null): there is no such property, always true.
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=[::1]:12345|interface=[::1]');
        expect(udpChannel.protocolFamily()).toBe(StandardProtocolFamily.INET6);
    });

    it('shouldGetProtocolFamilyForIpV4WithoutLocalSpecified', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:12345');
        expect(udpChannel.protocolFamily()).toBe(StandardProtocolFamily.INET);
    });

    it('shouldGetProtocolFamilyForIpV6WithoutLocalSpecified', () => {
        // assumeTrue(System.getProperty("java.net.preferIPv4Stack") == null): there is no such property, always true.
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=[::1]:12345');
        expect(udpChannel.protocolFamily()).toBe(StandardProtocolFamily.INET6);
    });

    it('shouldHandleCanonicalFormWithNsLookup', () => {
        const udpChannelExampleCom = UdpChannel.parse('aeron:udp?endpoint=localhost:20000');
        expect(udpChannelExampleCom.canonicalForm()).toBe('UDP-0.0.0.0:0-localhost:20000');
    });

    it('shouldHandleCanonicalFormForMulticastWithLocalPort', () => {
        const udpChannelLocalPort = UdpChannel.parse('aeron:udp?interface=127.0.0.1:40455|endpoint=224.0.1.1:20000');
        expect(udpChannelLocalPort.canonicalForm()).toBe('UDP-127.0.0.1:40455-224.0.1.1:20000');

        const udpChannelSubnetLocalPort = UdpChannel.parse(
            'aeron:udp?interface=127.0.0.0:40455/29|endpoint=224.0.1.1:20000',
        );
        matchesPattern(udpChannelSubnetLocalPort.canonicalForm(), /UDP-127\.0\.0\.[1-7]:40455-224\.0\.1\.1:20000/);
    });

    it('shouldHandleCanonicalFormForMulticastCorrectly', () => {
        const udpChannel = UdpChannel.parse('aeron:udp?interface=localhost|endpoint=224.0.1.1:20000');
        const udpChannelLocal = UdpChannel.parse('aeron:udp?interface=127.0.0.1|endpoint=224.0.1.1:20000');
        const udpChannelAllSystems = UdpChannel.parse('aeron:udp?interface=localhost|endpoint=224.0.1.1:20000');
        const udpChannelDefault = UdpChannel.parse('aeron:udp?endpoint=224.0.1.1:20000');

        const udpChannelSubnet = UdpChannel.parse('aeron:udp?interface=localhost/29|endpoint=224.0.1.1:20000');
        const udpChannelSubnetLocal = UdpChannel.parse('aeron:udp?interface=127.0.0.0/29|endpoint=224.0.1.1:20000');

        expect(udpChannel.canonicalForm()).toBe('UDP-127.0.0.1:0-224.0.1.1:20000');
        expect(udpChannelLocal.canonicalForm()).toBe('UDP-127.0.0.1:0-224.0.1.1:20000');

        const canonicalFormPattern = /UDP-127\.0\.0\.[1-7]:0-224\.0\.1\.1:20000/;
        matchesPattern(udpChannelAllSystems.canonicalForm(), canonicalFormPattern);
        matchesPattern(udpChannelSubnet.canonicalForm(), canonicalFormPattern);
        matchesPattern(udpChannelSubnetLocal.canonicalForm(), canonicalFormPattern);

        supportsMulticastOrIsLoopback(udpChannelDefault.localInterface());
    });

    it.each([['endpoint', 'interface']])(
        'shouldHandleCanonicalFormForMulticastCorrectlyWithAeronUri %s %s',
        (endpointKey, interfaceKey) => {
            const udpChannel = UdpChannel.parse(uri(endpointKey, '224.0.1.1:20000', interfaceKey, 'localhost'));
            const udpChannelLocal = UdpChannel.parse(uri(endpointKey, '224.0.1.1:20000', interfaceKey, '127.0.0.1'));
            const udpChannelAllSystems = UdpChannel.parse(
                uri(endpointKey, '224.0.0.1:20000', interfaceKey, '127.0.0.1'),
            );
            const udpChannelDefault = UdpChannel.parse(uri(endpointKey, '224.0.1.1:20000'));
            const udpChannelSubnet = UdpChannel.parse(
                uri(endpointKey, '224.0.1.1:20000', interfaceKey, 'localhost/24'),
            );
            const udpChannelSubnetLocal = UdpChannel.parse(
                uri(endpointKey, '224.0.1.1:20000', interfaceKey, '127.0.0.0/24'),
            );

            expect(udpChannel.canonicalForm()).toBe('UDP-127.0.0.1:0-224.0.1.1:20000');
            expect(udpChannelLocal.canonicalForm()).toBe('UDP-127.0.0.1:0-224.0.1.1:20000');
            expect(udpChannelAllSystems.canonicalForm()).toBe('UDP-127.0.0.1:0-224.0.0.1:20000');

            const canonicalFormPattern = /UDP-127\.0\.0\.[1-7]:0-224\.0\.1\.1:20000/;
            matchesPattern(udpChannelSubnet.canonicalForm(), canonicalFormPattern);
            matchesPattern(udpChannelSubnetLocal.canonicalForm(), canonicalFormPattern);
            supportsMulticastOrIsLoopback(udpChannelDefault.localInterface());
        },
    );

    it.each([['endpoint', 'interface']])(
        'shouldHandleIpV6CanonicalFormForMulticastCorrectly %s %s',
        (endpointKey, interfaceKey) => {
            // assumeTrue(System.getProperty("java.net.preferIPv4Stack") == null): there is no such property, always true.
            const udpChannel = UdpChannel.parse(uri(endpointKey, '[FF01::FD]:20000', interfaceKey, 'localhost'));
            const udpChannelLocal = UdpChannel.parse(
                uri(endpointKey, '224.0.1.1:20000', interfaceKey, '[::1]:54321/64'),
            );

            expect(udpChannel.canonicalForm()).toBe(
                'UDP-127.0.0.1:0-' + udpChannel.remoteData().getHostString() + ':20000',
            );
            expect(udpChannelLocal.canonicalForm()).toBe(
                'UDP-' + udpChannelLocal.localData().getHostString() + ':54321-224.0.1.1:20000',
            );
        },
    );

    it('shouldUseTagsInCanonicalFormForMdsUris', () => {
        expect(UdpChannel.parse('aeron:udp?control-mode=manual|tags=1001').canonicalForm()).toBe(
            'UDP-0.0.0.0:0-0.0.0.0:0#1001',
        );
    });

    it('shouldParseResponseControlMode', () => {
        const channel = UdpChannel.parse('aeron:udp?control-mode=response|control=127.0.0.1:10001');
        expect(channel.canonicalForm()).toBe('UDP-127.0.0.1:10001-0.0.0.0:0');
        expect(channel.isResponseControlMode()).toBe(true);
    });

    it('shouldUseTagsInCanonicalFormForWildcardPorts', () => {
        expect(
            UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|control=127.0.0.1:0|tags=1001').canonicalForm(),
        ).toBe('UDP-127.0.0.1:0-127.0.0.1:9999#1001');
        expect(UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:0|tags=1001').canonicalForm()).toBe(
            'UDP-0.0.0.0:0-127.0.0.1:0#1001',
        );
    });

    it('shouldParseSocketRcvAndSndBufSizes', () => {
        const udpChannelWithBufferSizes = UdpChannel.parse(
            'aeron:udp?endpoint=127.0.0.1:9999|so-sndbuf=4096|so-rcvbuf=8192',
        );
        expect(udpChannelWithBufferSizes.socketSndbufLength()).toBe(4096);
        expect(udpChannelWithBufferSizes.socketRcvbufLength()).toBe(8192);

        const udpChannelWithoutBufferSizes = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999');
        expect(udpChannelWithoutBufferSizes.socketRcvbufLength()).toBe(0);
        expect(udpChannelWithoutBufferSizes.socketSndbufLength()).toBe(0);
    });

    it('shouldParseReceiverWindow', () => {
        const udpChannelWithBufferSizes = UdpChannel.parse('aeron:udp?endpoint=127.0.0.1:9999|rcv-wnd=8192');
        expect(udpChannelWithBufferSizes.receiverWindowLength()).toBe(8192);
    });

    it('shouldParseChannelSendAndReceiveTimestampOffsets', () => {
        const channel = UdpChannel.parse(
            'aeron:udp?endpoint=localhost:0|channel-rcv-ts-offset=reserved|channel-snd-ts-offset=8',
        );

        expect(channel.channelReceiveTimestampOffset()).toBe(UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET);
        expect(channel.channelSendTimestampOffset()).toBe(8);
    });

    // An empty CSV field is null in JUnit's @CsvSource.
    it.each<[string, string, string | null, string | null, string]>([
        ['NAME_ENDPOINT', '192.168.1.1', null, null, 'UDP-127.0.0.1:0-NAME_ENDPOINT'],
        ['localhost:41024', '127.0.0.1', null, null, 'UDP-127.0.0.1:0-localhost:41024'],
        [
            '[fe80::5246:5dff:fe73:df06]:20000',
            '[fe80::5246:5dff:fe73:df06]',
            null,
            null,
            'UDP-127.0.0.1:0-[fe80::5246:5dff:fe73:df06]:20000',
        ],
        ['NAME_ENDPOINT', '224.0.1.1', null, null, 'UDP-127.0.0.1:0-224.0.1.1:40124'],
        ['NAME_ENDPOINT', '192.168.1.1', 'NAME_CONTROL', '192.168.1.2', 'UDP-NAME_CONTROL-NAME_ENDPOINT'],
        ['NAME_ENDPOINT', '224.0.1.1', 'NAME_CONTROL', '127.0.0.1', 'UDP-127.0.0.1:0-224.0.1.1:40124'],
        ['192.168.1.1:40124', '192.168.1.1', 'NAME_CONTROL', '192.168.1.2', 'UDP-NAME_CONTROL-192.168.1.1:40124'],
        [
            '192.168.1.1:40124',
            '192.168.1.1',
            '192.168.1.2:40192',
            '192.168.1.2',
            'UDP-192.168.1.2:40192-192.168.1.1:40124',
        ],
    ])(
        'shouldParseWithNameResolver %s %s %s %s %s',
        (endpointName, endpointAddress, controlName, controlAddress, canonicalForm) => {
            const port = 40124;

            const resolver = new LookupNameResolver(endpointName, endpointAddress, controlName, controlAddress, port);

            const uriBuilder = new ChannelUriStringBuilder().media('udp').networkInterface('localhost');

            if (!Strings.isEmpty(endpointName)) {
                uriBuilder.endpoint(endpointName);
            }

            if (!Strings.isEmpty(controlName)) {
                uriBuilder.controlEndpoint(controlName);
            }

            const udpChannel = UdpChannel.parse(uriBuilder.build(), resolver);

            expect(udpChannel.canonicalForm()).toBe(canonicalForm);
        },
    );

    it('reservedValueOffsetIsCorrect', () => {
        expect(DataHeaderFlyweight.RESERVED_VALUE_OFFSET).toBe(
            DataHeaderFlyweight.HEADER_LENGTH + UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET,
        );
    });

    it('invalidGroupTagThrowsException', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('aeron:udp?endpoint=localhost:8080|gtag=foo'));
    });

    it('validGroupTagAvailable', () => {
        const channel = UdpChannel.parse('aeron:udp?endpoint=localhost:8080|gtag=1234');
        expect(channel.groupTag()).toBe(1234);
    });

    it('shouldSpecifyControlIfDynamicControlModeSpecified', () => {
        assertThrows(InvalidChannelException, () => UdpChannel.parse('aeron:udp?control-mode=dynamic'));
    });

    it('shouldParseControlMode', () => {
        expect(UdpChannel.parse('aeron:udp?control=localhost:8080|control-mode=dynamic').controlMode()).toBe(DYNAMIC);
        expect(UdpChannel.parse('aeron:udp?control=localhost:8080|control-mode=manual').controlMode()).toBe(MANUAL);
        expect(UdpChannel.parse('aeron:udp?control=localhost:8080|control-mode=response').controlMode()).toBe(RESPONSE);
    });

    it('shouldParseNakDelay', () => {
        expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080|nak-delay=34ms').nakDelayNs()).toBe(
            TimeUnit.MILLISECONDS.toNanos(34),
        );
        expect(UdpChannel.parse('aeron:udp?endpoint=localhost:8080|nak-delay=27us').nakDelayNs()).toBe(
            TimeUnit.MICROSECONDS.toNanos(27),
        );
    });

    it.each(invalidMulticastAddresses().map((u) => [u]))(
        'isMulticastDestinationAddressThrowsInvalidChannelExceptionIfInvalid %s',
        (channelUri) => {
            assertThrowsExactly(InvalidChannelException, () =>
                UdpChannel.isMulticastDestinationAddress(channelUri as ChannelUri),
            );
        },
    );

    it.each<[string, boolean]>([
        ['aeron:udp?mtu=8192|endpoint=192.168.0.1:5656', false],
        ['aeron:udp?mtu=8192|endpoint=224.0.0.1:5656', true],
        ['aeron:udp?endpoint=239.255.255.250:1010', true],
        ['aeron:udp?endpoint=[FF01:0:0:0:0:0:0:18C]:5555', true],
        ['aeron:udp?endpoint=[ff02::1]:1234', true],
        ['aeron:udp?endpoint=[fe80::ce81:b1c:bd2c:69e%utun3]:8080', false],
    ])('shouldDetectMulticastAddress %s %s', (channelUri, expected) => {
        expect(UdpChannel.isMulticastDestinationAddress(ChannelUri.parse(channelUri))).toBe(expected);
    });
});
