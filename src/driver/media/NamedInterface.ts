/*
 * Copyright 2025 Adaptive Financial Consulting Limited.
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
// Port of io/aeron/driver/media/NamedInterface.java @ 1.53.3
import { IllegalArgumentException, IllegalStateException, NumberFormatException } from '../../agrona/jdk.js';
import { Strings } from '../../agrona/Strings.js';
import { InetSocketAddress, NetworkInterface, type ProtocolFamily } from '../jdkNet.js';
import { NetworkUtil } from './NetworkUtil.js';
import { ResolvedInterface } from './ResolvedInterface.js';
import type { UnresolvedInterface } from './UnresolvedInterface.js';

const { getProtocolFamily } = NetworkUtil;

/**
 * Java's `record NamedInterface(String name, int port)`: two read-only fields (the accessors `name()` and `port()` are
 * the fields) and the record's `equals`, `hashCode` and `toString`.
 */
export class NamedInterface implements UnresolvedInterface {
    public static readonly OPENING_CHAR = '{';

    public readonly name: string;
    public readonly port: number = 0;
    public constructor(name: string, port: number) {
        this.name = name;
        this.port = port;
    }

    public resolve(_multicast: boolean, protocolFamily: ProtocolFamily): ResolvedInterface {
        const localInterface = NetworkInterface.getByName(this.name);
        if (null === localInterface) {
            throw new IllegalArgumentException('unknown interface ' + this.name);
        }
        const address = this.resolveToFirstAddressOfFamily(localInterface, protocolFamily);
        return new ResolvedInterface(localInterface, address);
    }

    private resolveToFirstAddressOfFamily(
        localInterface: NetworkInterface,
        protocolFamily: ProtocolFamily,
    ): InetSocketAddress {
        for (const interfaceAddress of localInterface.getInterfaceAddresses()) {
            const address = interfaceAddress.getAddress();
            if (getProtocolFamily(address) === protocolFamily) {
                return new InetSocketAddress(address, this.port);
            }
        }

        throw new IllegalStateException(
            'no ' + protocolFamily + ' addresses found on interface ' + localInterface.getName(),
        );
    }

    public static parse(str: string | null): NamedInterface {
        if (Strings.isEmpty(str) || str.charAt(0) !== NamedInterface.OPENING_CHAR) {
            throw NamedInterface.parseException(str);
        }

        const nameEnd = str.lastIndexOf('}');
        if (nameEnd <= 1) {
            throw NamedInterface.parseException(str);
        }
        const name = str.substring(1, nameEnd);

        let port = 0;
        const trailing = str.length - nameEnd - 1;
        if (trailing > 0) {
            if (trailing === 1 || str.charAt(nameEnd + 1) !== ':') {
                throw NamedInterface.parseException(str);
            }

            try {
                port = NamedInterface.parseUnsignedInt(str, nameEnd + 2, str.length);
            } catch (e) {
                if (e instanceof NumberFormatException) {
                    throw NamedInterface.parseException(str, e);
                }
                throw e;
            }

            if (port > 0xffff) {
                throw NamedInterface.parseException('port out of range: ' + port);
            }
        }

        return new NamedInterface(name, port);
    }

    /**
     * `Integer.parseUnsignedInt(CharSequence, int, int, 10)`: an optional `+` and ASCII digits, at most 2^32 - 1, as an
     * `int` (so 2^31 and above are negative, and pass Java's `port > 0xFFFF` check).
     */
    private static parseUnsignedInt(s: string, beginIndex: number, endIndex: number): number {
        const text = s.substring(beginIndex, endIndex);
        if (text.length === 0) {
            throw new NumberFormatException('For input string: ""');
        }
        if (text.charAt(0) === '-') {
            throw new NumberFormatException('Illegal leading minus sign on unsigned string ' + s + '.');
        }
        if (!/^\+?[0-9]+$/.test(text)) {
            throw new NumberFormatException('Error at index 0 in: "' + text + '"');
        }
        const value = Number(text);
        if (value > 0xffffffff) {
            throw new NumberFormatException('String value ' + s + ' exceeds range of unsigned int.');
        }

        return value | 0;
    }

    private static parseException(str: string | null, cause?: Error): IllegalArgumentException {
        return new IllegalArgumentException(
            "expected format is '{interface_name}' or '{interface_name}:port', but got " +
                (str === null ? 'null' : "'" + str + "'"),
            undefined === cause ? undefined : { cause },
        );
    }

    public equals(other: unknown): boolean {
        return other instanceof NamedInterface && this.name === other.name && this.port === other.port;
    }

    public hashCode(): number {
        let nameHash = 0;
        for (let i = 0; i < this.name.length; i++) {
            nameHash = (31 * nameHash + this.name.charCodeAt(i)) | 0;
        }

        return (31 * nameHash + this.port) | 0;
    }

    public toString(): string {
        return 'NamedInterface[name=' + this.name + ', port=' + this.port + ']';
    }
}
