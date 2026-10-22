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
// Port of io/aeron/driver/media/NetworkUtilTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { Integer } from '../../../src/agrona/jdk.js';
import { InetAddress, InterfaceAddress, NetworkInterface } from '../../../src/driver/jdkNet.js';
import { NetworkInterfaceShim } from '../../../src/driver/media/NetworkInterfaceShim.js';
import { NetworkUtil } from '../../../src/driver/media/NetworkUtil.js';
import { assertEqualsObject } from '../../support/Assertions.js';

const { filterBySubnet, isMatchWithPrefix, prefixLengthToIpV4Mask } = NetworkUtil;
const getByName = (host: string): InetAddress => InetAddress.getByName(host);

function newNetworkInterface(name: string): NetworkInterface {
    return new NetworkInterface(name, name, [], { loopback: false, up: true, multicast: true });
}

function newInterfaceAddress(inetAddress: InetAddress, maskLength: number): InterfaceAddress {
    return new InterfaceAddress(inetAddress, null, maskLength);
}

function asBytes(i: number): Uint8Array {
    const bs = new Uint8Array(4);
    bs[0] = (i >> 24) & 0xff;
    bs[1] = (i >> 16) & 0xff;
    bs[2] = (i >> 8) & 0xff;
    bs[3] = i & 0xff;

    return bs;
}

class NetworkInterfaceStub implements NetworkInterfaceShim {
    private counter = 0;

    // Map keys are compared by identity, as in Java's IdentityHashMap.
    private readonly addressesByInterface = new Map<NetworkInterface, InterfaceAddress[]>();

    public getNetworkInterfaces(): NetworkInterface[] {
        return [...this.addressesByInterface.keys()];
    }

    public getInterfaceAddresses(ifc: NetworkInterface): InterfaceAddress[] {
        return this.addressesByInterface.get(ifc) as InterfaceAddress[];
    }

    public isLoopback(_ifc: NetworkInterface): boolean {
        return false;
    }

    public add(...ips: string[]): NetworkInterface {
        const ias: InterfaceAddress[] = [];
        for (const ip of ips) {
            const parts = ip.split('/');
            ias.push(newInterfaceAddress(getByName(parts[0] as string), Number(parts[1])));
        }

        const ifc = newNetworkInterface(String(this.counter++));
        this.addressesByInterface.set(ifc, ias);

        return ifc;
    }
}

describe('NetworkUtilTest', () => {
    it('shouldNotMatchIfLengthsAreDifferent', () => {
        expect(isMatchWithPrefix(new Uint8Array(0), new Uint8Array(3), 0)).toBe(false);
        expect(isMatchWithPrefix(new Uint8Array(1), new Uint8Array(2), 0)).toBe(false);
        expect(isMatchWithPrefix(new Uint8Array(5), new Uint8Array(5000), 0)).toBe(false);
    });

    it('shouldMatchIfAllBytesMatch', () => {
        const a = Uint8Array.of(0x61, 0x62, 0x63, 0x64);
        const b = Uint8Array.of(0x61, 0x62, 0x63, 0x64);
        expect(isMatchWithPrefix(a, b, 32)).toBe(true);
    });

    it('shouldMatchIfAllBytesWithPrefixMatch', () => {
        const a = Uint8Array.of(0x61, 0x62, 0x63, 0x64);
        const b = Uint8Array.of(0x61, 0x62, 0x63, 0x65);
        expect(isMatchWithPrefix(a, b, 24)).toBe(true);
    });

    it('shouldNotMatchIfNotAllBytesWithPrefixMatch', () => {
        const a = Uint8Array.of(0x61, 0x62, 0x63, 0x64);
        const b = Uint8Array.of(0x61, 0x62, 0x64, 0x64);
        expect(isMatchWithPrefix(a, b, 24)).toBe(false);
    });

    it('shouldMatchIfAllBytesWithPrefixUnalignedMatch', () => {
        expect(
            isMatchWithPrefix(
                asBytes(0b10101010_11111111_00000000_00000000),
                asBytes(0b10101010_11111110_00000000_00000000),
                15,
            ),
        ).toBe(true);
    });

    it('shouldNotMatchIfNotAllBytesWithUnalignedPrefixMatch', () => {
        expect(
            isMatchWithPrefix(
                asBytes(0b10101010_11111111_00000000_00000000),
                asBytes(0b10101010_11111111_10000000_00000000),
                17,
            ),
        ).toBe(false);
    });

    it('shouldFilterBySubnetAndFindOneResult', () => {
        const stub = new NetworkInterfaceStub();

        const ifc1 = stub.add('192.168.0.1/24');
        stub.add('10.0.0.2/8');

        const filteredBySubnet = filterBySubnet(stub, getByName('192.168.0.0'), 24);

        expect(filteredBySubnet.length).toBe(1);
        assertEqualsObject(ifc1, filteredBySubnet[0]);
    });

    it('shouldFilterBySubnetAndFindNoResults', () => {
        const stub = new NetworkInterfaceStub();

        stub.add('192.168.0.1/24');
        stub.add('10.0.0.2/8');

        const filteredBySubnet = filterBySubnet(stub, getByName('192.169.0.0'), 24);

        expect(filteredBySubnet.length).toBe(0);
    });

    it('shouldFilterBySubnetAndFindMultipleResultsOrderedByMatchLength', () => {
        const stub = new NetworkInterfaceStub();

        stub.add('10.0.0.2/8');
        const ifc1 = stub.add('192.0.0.0/8');
        const ifc2 = stub.add('192.168.1.1/24');
        const ifc3 = stub.add('192.168.0.0/16');

        const filteredBySubnet = filterBySubnet(stub, getByName('192.0.0.0'), 8);

        expect(filteredBySubnet.length).toBe(3);
        expect(filteredBySubnet[0]).toBe(ifc2);
        expect(filteredBySubnet[1]).toBe(ifc3);
        expect(filteredBySubnet[2]).toBe(ifc1);
    });

    it('shouldFilterBySubnetAndFindOneIpV6Result', () => {
        const stub = new NetworkInterfaceStub();

        const ifc1 = stub.add('fe80:0:0:0001:0002:0:0:1/80');
        stub.add('fe80:0:0:0002:0003:0:0:1/80');

        const filteredBySubnet = filterBySubnet(stub, getByName('fe80:0:0:0001:0002:0:0:0'), 80);

        expect(filteredBySubnet.length).toBe(1);
        assertEqualsObject(ifc1, filteredBySubnet[0]);
    });

    it('shouldFilterBySubnetAndFindNoIpV6Results', () => {
        const stub = new NetworkInterfaceStub();

        stub.add('fe80:0:0:0001:0:0:0:1/64');
        stub.add('fe80:0:0:0002:0:0:0:1/64');

        const filteredBySubnet = filterBySubnet(stub, getByName('fe80:0:0:0004:0:0:0:0'), 64);

        expect(filteredBySubnet.length).toBe(0);
    });

    it('shouldFilterBySubnetAndFindMultipleIpV6ResultsOrderedByMatchLength', () => {
        const stub = new NetworkInterfaceStub();

        stub.add('ee80:0:0:0001:0:0:0:1/64');
        const ifc1 = stub.add('fe80:0:0:0:0:0:0:1/16');
        const ifc2 = stub.add('fe80:0001:0:0:0:0:0:1/32');
        const ifc3 = stub.add('fe80:0001:abcd:0:0:0:0:1/48');

        const filteredBySubnet = filterBySubnet(stub, getByName('fe80:0:0:0:0:0:0:0'), 16);

        expect(filteredBySubnet.length).toBe(3);
        expect(filteredBySubnet[0]).toBe(ifc3);
        expect(filteredBySubnet[1]).toBe(ifc2);
        expect(filteredBySubnet[2]).toBe(ifc1);
    });

    it.each([
        [0, 0],
        [1, 0x80000000],
        [2, 0xc0000000],
        [3, 0xe0000000],
        [4, 0xf0000000],
        [5, 0xf8000000],
        [6, 0xfc000000],
        [7, 0xfe000000],
        [8, 0xff000000],
        [9, 0xff800000],
        [10, 0xffc00000],
        [11, 0xffe00000],
        [12, 0xfff00000],
        [13, 0xfff80000],
        [14, 0xfffc0000],
        [15, 0xfffe0000],
        [16, 0xffff0000],
        [17, 0xffff8000],
        [18, 0xffffc000],
        [19, 0xffffe000],
        [20, 0xfffff000],
        [21, 0xfffff800],
        [22, 0xfffffc00],
        [23, 0xfffffe00],
        [24, 0xffffff00],
        [25, 0xffffff80],
        [26, 0xffffffc0],
        [27, 0xffffffe0],
        [28, 0xfffffff0],
        [29, 0xfffffff8],
        [30, 0xfffffffc],
        [31, 0xfffffffe],
        [32, 0xffffffff],
    ])('shouldConvertSubnetPrefixIpV4PrefixToMask %d %d', (subnetPrefix, expectedMask) => {
        // Java: the int sum wraps before it is widened to long.
        expect(expectedMask + Integer.MIN_VALUE).toBe((prefixLengthToIpV4Mask(subnetPrefix) + Integer.MIN_VALUE) | 0);
    });
});
