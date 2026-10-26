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
// Port of io/aeron/driver/media/InterfaceSearchAddress.java @ 1.53.3
import { EOL } from 'node:os';
import { AsciiEncoding } from '../../agrona/AsciiEncoding.js';
import { IllegalArgumentException, IllegalStateException } from '../../agrona/jdk.js';
import { requireNonNull } from '../../agrona/jdkLang.js';
import { Strings } from '../../agrona/Strings.js';
import { InetAddress, InetSocketAddress, type NetworkInterface, type ProtocolFamily } from '../jdkNet.js';
import { NetworkUtil } from './NetworkUtil.js';
import { ResolvedInterface } from './ResolvedInterface.js';
import type { UnresolvedInterface } from './UnresolvedInterface.js';

const { filterBySubnet, findAddressOnInterface } = NetworkUtil;
const lineSeparator = (): string => EOL;

/**
 * Java's `record InterfaceSearchAddress(InetSocketAddress address, int subnetPrefix)`: two read-only fields (the
 * accessors `address()` and `subnetPrefix()` are the fields) and the record's `equals`, `hashCode` and `toString`.
 */
export class InterfaceSearchAddress implements UnresolvedInterface {
    private static readonly WILDCARD = new InterfaceSearchAddress(new InetSocketAddress(0), 0);

    public readonly address: InetSocketAddress;
    public readonly subnetPrefix: number;
    public constructor(address: InetSocketAddress, subnetPrefix: number) {
        this.address = address;
        this.subnetPrefix = subnetPrefix;
        requireNonNull(address, 'address must not be null');
    }

    public resolve(multicast: boolean, _protocolFamily: ProtocolFamily): ResolvedInterface {
        let localInterface: NetworkInterface | null;
        let resolvedAddress: InetSocketAddress;

        if (!multicast && (this.address.getAddress() as InetAddress).isAnyLocalAddress()) {
            localInterface = null;
            resolvedAddress = this.address;
        } else {
            localInterface = this.findInterface();
            resolvedAddress = this.resolveToAddressOfInterface(localInterface);
        }

        return new ResolvedInterface(localInterface, resolvedAddress);
    }

    private resolveToAddressOfInterface(localInterface: NetworkInterface): InetSocketAddress {
        const interfaceAddress = findAddressOnInterface(
            localInterface,
            this.address.getAddress() as InetAddress,
            this.subnetPrefix,
        );

        if (null === interfaceAddress) {
            throw new IllegalStateException(
                'failed to find ' +
                    this.address.getAddress() +
                    '/' +
                    this.subnetPrefix +
                    ' in [' +
                    localInterface.getInterfaceAddresses().join(', ') +
                    ']',
            );
        }

        return new InetSocketAddress(interfaceAddress, this.address.getPort());
    }

    private findInterface(): NetworkInterface {
        const filteredInterfaces = filterBySubnet(this.address.getAddress() as InetAddress, this.subnetPrefix);

        for (const networkInterface of filteredInterfaces) {
            if (networkInterface.isUp() && (networkInterface.supportsMulticast() || networkInterface.isLoopback())) {
                return networkInterface;
            }
        }

        throw new IllegalArgumentException(this.noMatchingInterfacesError(filteredInterfaces));
    }

    private noMatchingInterfacesError(filteredInterfaces: NetworkInterface[]): string {
        let builder =
            'Unable to find multicast or loopback interface matching criteria: ' +
            this.address.getAddress() +
            '/' +
            this.subnetPrefix;

        if (filteredInterfaces.length > 0) {
            builder += lineSeparator() + '  Candidates:';

            for (const ifc of filteredInterfaces) {
                builder +=
                    lineSeparator() +
                    '  - Name: ' +
                    ifc.getDisplayName() +
                    ', addresses: [' +
                    ifc.getInterfaceAddresses().join(', ') +
                    ']' +
                    ', multicast: ' +
                    ifc.supportsMulticast() +
                    ', loopback: ' +
                    ifc.isLoopback() +
                    ', state: ' +
                    (ifc.isUp() ? 'UP' : 'DOWN');
            }
        }

        return builder;
    }

    public static wildcard(): InterfaceSearchAddress {
        return InterfaceSearchAddress.WILDCARD;
    }

    /** @throws UnknownHostException */
    public static parse(addressAndPort: string | null): InterfaceSearchAddress {
        if (Strings.isEmpty(addressAndPort)) {
            throw new IllegalArgumentException('search address string is null or empty');
        }

        let slashIndex = -1;
        let colonIndex = -1;
        let rightAngleBraceIndex = -1;

        for (let i = 0, length = addressAndPort.length; i < length; i++) {
            switch (addressAndPort.charAt(i)) {
                case '/':
                    slashIndex = i;
                    break;

                case ':':
                    colonIndex = i;
                    break;

                case ']':
                    rightAngleBraceIndex = i;
                    break;
            }
        }

        const addressString = InterfaceSearchAddress.getAddress(
            addressAndPort,
            slashIndex,
            colonIndex,
            rightAngleBraceIndex,
        );
        const hostAddress = InetAddress.getByName(addressString);
        const port = InterfaceSearchAddress.getPort(addressAndPort, slashIndex, colonIndex, rightAngleBraceIndex);
        const defaultSubnetPrefix = hostAddress.getAddress().length * 8;
        const subnetPrefix = InterfaceSearchAddress.getSubnet(addressAndPort, slashIndex, defaultSubnetPrefix);

        return new InterfaceSearchAddress(new InetSocketAddress(hostAddress, port), subnetPrefix);
    }

    private static getSubnet(s: string, slashIndex: number, defaultSubnetPrefix: number): number {
        if (slashIndex < 0) {
            return defaultSubnetPrefix;
        } else if (s.length - 1 === slashIndex) {
            throw new IllegalArgumentException('invalid subnet: ' + s);
        }

        const subnetStringBegin = slashIndex + 1;

        return AsciiEncoding.parseIntAscii(s, subnetStringBegin, s.length - subnetStringBegin);
    }

    private static getPort(s: string, slashIndex: number, colonIndex: number, rightAngleBraceIndex: number): number {
        if (colonIndex < 0 || rightAngleBraceIndex > colonIndex) {
            return 0;
        } else if (s.length - 1 === colonIndex) {
            throw new IllegalArgumentException('invalid port: ' + s);
        }

        const portStringBegin = colonIndex + 1;
        const portStringEnd = slashIndex > 0 ? slashIndex : s.length;

        return AsciiEncoding.parseIntAscii(s, portStringBegin, portStringEnd - portStringBegin);
    }

    private static getAddress(s: string, slashIndex: number, colonIndex: number, rightAngleBraceIndex: number): string {
        let addressEnd = s.length;

        if (slashIndex >= 0) {
            addressEnd = slashIndex;
        }

        if (colonIndex >= 0 && colonIndex > rightAngleBraceIndex) {
            addressEnd = colonIndex;
        }

        return s.substring(0, addressEnd);
    }

    public equals(other: unknown): boolean {
        return (
            other instanceof InterfaceSearchAddress &&
            this.address.equals(other.address) &&
            this.subnetPrefix === other.subnetPrefix
        );
    }

    public hashCode(): number {
        return (31 * this.address.hashCode() + this.subnetPrefix) | 0;
    }

    public toString(): string {
        return 'InterfaceSearchAddress[address=' + this.address + ', subnetPrefix=' + this.subnetPrefix + ']';
    }
}
