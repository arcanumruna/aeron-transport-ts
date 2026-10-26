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
// Port of io/aeron/driver/media/NetworkUtil.java @ 1.53.3
import { IllegalArgumentException, IllegalStateException } from '../../agrona/jdk.js';
import {
    Inet4Address,
    Inet6Address,
    type InetAddress,
    type InterfaceAddress,
    NetworkInterface,
    type ProtocolFamily,
    StandardProtocolFamily,
} from '../jdkNet.js';
import { NetworkInterfaceShim } from './NetworkInterfaceShim.js';

/**
 * Collection of network specific utility functions.
 */
export class NetworkUtil {
    private constructor() {}

    /**
     * Search for a list of network interfaces that match the specified address and subnet prefix.
     * The results will be ordered by the length of the subnet prefix
     * ({@link InterfaceAddress.getNetworkPrefixLength}). If no results match, then the collection
     * will be empty.
     * <p>
     * Java's two overloads are one function told apart by the type of the first argument: the shim (package-private in
     * Java, for tests) comes first, then the address and the prefix.
     *
     * @param address      to search for on the {@link NetworkInterface}s.
     * @param subnetPrefix to limit the search.
     * @return {@link NetworkInterface}s that match the supplied criteria, ordered by the length
     * of the subnet prefix. Empty if none match.
     * @throws SocketException if an error occurs
     */
    public static filterBySubnet(address: InetAddress, subnetPrefix: number): NetworkInterface[];
    public static filterBySubnet(
        shim: NetworkInterfaceShim,
        address: InetAddress,
        subnetPrefix: number,
    ): NetworkInterface[];
    public static filterBySubnet(
        first: InetAddress | NetworkInterfaceShim,
        second: InetAddress | number,
        third?: number,
    ): NetworkInterface[] {
        if (typeof second === 'number') {
            return NetworkUtil.filterBySubnet(NetworkInterfaceShim.DEFAULT, first as InetAddress, second);
        }

        const shim = first as NetworkInterfaceShim;
        const address = second;
        const subnetPrefix = third as number;
        const filterResults: FilterResult[] = [];
        const queryAddress = address.getAddress();

        const interfaces = shim.getNetworkInterfaces();
        for (const networkInterface of interfaces) {
            const interfaceAddress = NetworkUtil.findAddressOnInterface(
                shim,
                networkInterface,
                queryAddress,
                subnetPrefix,
            );

            if (null !== interfaceAddress) {
                filterResults.push(
                    new FilterResult(interfaceAddress, networkInterface, shim.isLoopback(networkInterface)),
                );
            }
        }

        filterResults.sort((a, b) => a.compareTo(b));

        const size = filterResults.length;
        const results: NetworkInterface[] = new Array<NetworkInterface>(size);
        for (let i = 0; i < size; i++) {
            results[i] = (filterResults[i] as FilterResult).networkInterface;
        }

        return results;
    }

    /**
     * Format an address and port pair, so they can be used in a URI endpoint.
     *
     * @param address part of the endpoint.
     * @param port    part of the endpoint.
     * @return The formatted string for an address, IPv4 or IPv6, and port separated by a ':'.
     */
    public static formatAddressAndPort(address: InetAddress, port: number): string {
        if (address instanceof Inet6Address) {
            return '[' + address.getHostAddress() + ']:' + port;
        } else {
            return address.getHostAddress() + ':' + port;
        }
    }

    /**
     * Get the {@link ProtocolFamily} to which the address belongs.
     *
     * @param address to get the {@link ProtocolFamily} for.
     * @return the {@link ProtocolFamily} to which the address belongs.
     */
    public static getProtocolFamily(address: InetAddress): ProtocolFamily {
        if (address instanceof Inet4Address) {
            return StandardProtocolFamily.INET;
        } else if (address instanceof Inet6Address) {
            return StandardProtocolFamily.INET6;
        } else {
            throw new IllegalStateException('Unknown ProtocolFamily');
        }
    }

    /**
     * Scans through to the local interfaces and returns the first bound InetAddress that matches the locally
     * defined address and network mask. Useful for determining a return path network address for machines with
     * a simple network topology. May not give the ideal result when a machine has multiple interfaces that match
     * an outgoing network address.
     *
     * @param address used to scan for a matching local address
     * @return first matching address bound to a local interface or null if none match.
     * @throws SocketException if an underlying SocketException is thrown, e.g. when getting the network interfaces.
     */
    public static findFirstMatchingLocalAddress(address: InetAddress): InetAddress | null {
        const networkInterfaces = NetworkInterface.getNetworkInterfaces();
        for (const networkInterface of networkInterfaces) {
            for (const interfaceAddress of networkInterface.getInterfaceAddresses()) {
                if (
                    NetworkUtil.isMatchWithPrefix(
                        address.getAddress(),
                        interfaceAddress.getAddress().getAddress(),
                        interfaceAddress.getNetworkPrefixLength(),
                    )
                ) {
                    return interfaceAddress.getAddress();
                }
            }
        }

        return null;
    }

    /**
     * Java's two package-private overloads are one function told apart by the type of the first argument:
     * `(networkInterface, address, subnetPrefix)` returns the {@link InetAddress} or null, and
     * `(shim, networkInterface, queryAddress, prefixLength)` returns the {@link InterfaceAddress} or null.
     */
    public static findAddressOnInterface(
        networkInterface: NetworkInterface,
        address: InetAddress,
        subnetPrefix: number,
    ): InetAddress | null;
    public static findAddressOnInterface(
        shim: NetworkInterfaceShim,
        networkInterface: NetworkInterface,
        queryAddress: Uint8Array,
        prefixLength: number,
    ): InterfaceAddress | null;
    public static findAddressOnInterface(
        first: NetworkInterface | NetworkInterfaceShim,
        second: InetAddress | NetworkInterface,
        third: number | Uint8Array,
        fourth?: number,
    ): InetAddress | InterfaceAddress | null {
        if (first instanceof NetworkInterface) {
            const interfaceAddress = NetworkUtil.findAddressOnInterface(
                NetworkInterfaceShim.DEFAULT,
                first,
                (second as InetAddress).getAddress(),
                third as number,
            );

            return null === interfaceAddress ? null : interfaceAddress.getAddress();
        }

        const shim = first;
        const networkInterface = second as NetworkInterface;
        const queryAddress = third as Uint8Array;
        const prefixLength = fourth as number;
        for (const interfaceAddress of shim.getInterfaceAddresses(networkInterface)) {
            if (null !== interfaceAddress) {
                const address = interfaceAddress.getAddress();
                if (null !== address) {
                    if (NetworkUtil.isMatchWithPrefix(address.getAddress(), queryAddress, prefixLength)) {
                        return interfaceAddress;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Matches to network address with the specified prefix length.  Only works with 4 and 16 byte addresses.
     *
     * @param candidate address to be matched
     * @param expected address to match against (could be a network address - with 0s at the end)
     * @param prefixLength the number of bit required to match.
     * @return true if the leading prefixLength number of bits of the two addresses match.
     */
    public static isMatchWithPrefix(candidate: Uint8Array, expected: Uint8Array, prefixLength: number): boolean {
        if (candidate.length !== expected.length) {
            return false;
        }

        if (candidate.length === 4) {
            const mask = NetworkUtil.prefixLengthToIpV4Mask(prefixLength);

            return (NetworkUtil.toInt(candidate) & mask) === (NetworkUtil.toInt(expected) & mask);
        } else if (candidate.length === 16) {
            // The 64-bit masks and words are bigints: control plane, and a Java long is wider than a number (spec D5).
            const upperMask = NetworkUtil.prefixLengthToIpV6Mask(Math.min(prefixLength, 64));
            const lowerMask = NetworkUtil.prefixLengthToIpV6Mask(Math.max(prefixLength - 64, 0));

            return (
                (upperMask & NetworkUtil.toLong(candidate, 0)) === (upperMask & NetworkUtil.toLong(expected, 0)) &&
                (lowerMask & NetworkUtil.toLong(candidate, 8)) === (lowerMask & NetworkUtil.toLong(expected, 8))
            );
        }

        throw new IllegalArgumentException('how many bytes does an IP address have again?');
    }

    public static prefixLengthToIpV4Mask(subnetPrefix: number): number {
        // `1 << n` takes n modulo 32 as in Java; `| 0` wraps -(1 << 31) as the int negation does.
        return 0 === subnetPrefix ? 0 : -(1 << (32 - subnetPrefix)) | 0;
    }

    private static prefixLengthToIpV6Mask(subnetPrefix: number): bigint {
        // `1L << n` takes n modulo 64 as in Java.
        return 0 === subnetPrefix ? 0n : BigInt.asIntN(64, -(1n << (BigInt(64 - subnetPrefix) & 63n)));
    }

    private static toInt(b: Uint8Array): number {
        return (
            (((b[3] as number) & 0xff) +
                (((b[2] as number) & 0xff) << 8) +
                (((b[1] as number) & 0xff) << 16) +
                (((b[0] as number) << 24) >> 0)) |
            0
        );
    }

    /** The `long` is a `bigint` here (a Java `long` is wider than a `number`, spec D5). */
    public static toLong(b: Uint8Array, offset: number): bigint {
        let result = 0n;
        for (let i = 0; i < 8; i++) {
            result = (result << 8n) | BigInt((b[offset + i] as number) & 0xff);
        }

        return BigInt.asIntN(64, result);
    }
}

class FilterResult {
    private readonly interfaceAddress: InterfaceAddress;
    public readonly networkInterface: NetworkInterface;
    private readonly isLoopback: boolean;
    public constructor(interfaceAddress: InterfaceAddress, networkInterface: NetworkInterface, isLoopback: boolean) {
        this.interfaceAddress = interfaceAddress;
        this.networkInterface = networkInterface;
        this.isLoopback = isLoopback;
    }

    public compareTo(other: FilterResult): number {
        if (this.isLoopback === other.isLoopback) {
            return -compareInt(
                this.interfaceAddress.getNetworkPrefixLength(),
                other.interfaceAddress.getNetworkPrefixLength(),
            );
        } else {
            return compareBoolean(this.isLoopback, other.isLoopback);
        }
    }

    public equals(o: unknown): boolean {
        return o instanceof FilterResult && this.compareTo(o) === 0;
    }

    public hashCode(): number {
        return (
            (31 * (31 * (31 + this.interfaceAddress.hashCode()) + this.networkInterface.hashCode()) +
                (this.isLoopback ? 1231 : 1237)) |
            0
        );
    }
}

/** `Integer.compare`. */
function compareInt(x: number, y: number): number {
    return x < y ? -1 : x === y ? 0 : 1;
}

/** `Boolean.compare`: false is less than true. */
function compareBoolean(x: boolean, y: boolean): number {
    return x === y ? 0 : x ? 1 : -1;
}
