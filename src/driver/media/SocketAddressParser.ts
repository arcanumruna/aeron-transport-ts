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
// Port of io/aeron/driver/media/SocketAddressParser.java @ 1.53.3
import { AsciiEncoding } from '../../agrona/AsciiEncoding.js';
import { IllegalArgumentException, NullPointerException } from '../../agrona/jdk.js';
import { Strings } from '../../agrona/Strings.js';
import { InetSocketAddress } from '../jdkNet.js';
import type { NameResolver } from '../NameResolver.js';

type IpV4State = 'HOST' | 'PORT';

type IpV6State = 'START_ADDR' | 'HOST' | 'SCOPE' | 'END_ADDR' | 'PORT';

class ParseResult {
    public constructor(
        public readonly host: string,
        public readonly port: number,
    ) {}
}

export class SocketAddressParser {
    private constructor() {}

    /**
     * Parse socket addresses from a {@link String}.
     * <p>
     * Supports hostname:port, ipV4Address:port, [ipV6Address]:port, and name.
     *
     * @param value          to be parsed for the socket address.
     * @param uriParamName   for the parse.
     * @param isReResolution for the parse.
     * @param nameResolver   to be used for resolving hostnames.
     * @return An {@link InetSocketAddress} for the parsed input.
     */
    public static parse(
        value: string,
        uriParamName: string,
        isReResolution: boolean,
        nameResolver: NameResolver,
    ): InetSocketAddress {
        if (Strings.isEmpty(value)) {
            throw new NullPointerException('input string must not be null or empty');
        }

        const nameAndPort = nameResolver.lookup(value, uriParamName, isReResolution);
        let result = SocketAddressParser.tryParseIpV4(nameAndPort);
        if (null === result) {
            result = SocketAddressParser.tryParseIpV6(nameAndPort);
        }
        if (null === result) {
            throw new IllegalArgumentException('invalid format: ' + nameAndPort);
        }

        const inetAddress = nameResolver.resolve(result.host, uriParamName, isReResolution);
        return null === inetAddress
            ? InetSocketAddress.createUnresolved(result.host, result.port)
            : new InetSocketAddress(inetAddress, result.port);
    }

    public static isMulticastAddress(hostAndPort: string): boolean {
        let result = SocketAddressParser.tryParseIpV4(hostAndPort);
        if (null !== result) {
            const host = result.host;
            for (let i = 0, dotIndex = 0, end = host.length - 1; i <= end; i++) {
                const c = host.charAt(i);
                if ('.' === c || end === i) {
                    const length = end === i ? i - dotIndex : i - 1 - dotIndex;
                    if (length <= 0 || length > 3) {
                        return false;
                    }
                    if (0 === dotIndex) {
                        const firstByte = AsciiEncoding.parseIntAscii(host, 0, i);
                        // IPv4 multicast addresses are defined by the most-significant bit pattern of 1110
                        if (firstByte > 0xff || 0xe0 !== (firstByte & 0xf0)) {
                            return false;
                        }
                    }
                    dotIndex = i;
                } else if (c < '0' || c > '9') {
                    return false;
                }
            }
            return true;
        } else {
            result = SocketAddressParser.tryParseIpV6(hostAndPort);
            if (null !== result) {
                const firstByte = result.host.substring(0, 2);
                return 'ff' === firstByte.toLowerCase();
            }
            throw new IllegalArgumentException('invalid format: ' + hostAndPort);
        }
    }

    private static tryParseIpV4(str: string): ParseResult | null {
        if (null === str) {
            throw new NullPointerException('Cannot invoke "String.length()" because "str" is null');
        }

        let state: IpV4State = 'HOST';
        let separatorIndex = -1;
        const length = str.length;

        for (let i = 0; i < length; i++) {
            const c = str.charAt(i);
            switch (state) {
                case 'HOST':
                    if (':' === c) {
                        separatorIndex = i;
                        state = 'PORT';
                    }
                    break;

                case 'PORT':
                    if (c < '0' || '9' < c) {
                        return null;
                    }
                    break;
            }
        }

        if (-1 !== separatorIndex && 1 < length - separatorIndex) {
            const hostname = str.substring(0, separatorIndex);
            const portIndex = separatorIndex + 1;
            const port = AsciiEncoding.parseIntAscii(str, portIndex, length - portIndex);
            return new ParseResult(hostname, port);
        }

        throw new IllegalArgumentException('address:port is required for ipv4: ' + str);
    }

    private static tryParseIpV6(str: string): ParseResult | null {
        let state: IpV6State = 'START_ADDR';
        let portIndex = -1;
        let scopeIndex = -1;
        const length = str.length;

        for (let i = 0; i < length; i++) {
            const c = str.charAt(i);

            switch (state) {
                case 'START_ADDR':
                    if ('[' === c) {
                        state = 'HOST';
                    } else {
                        return null;
                    }
                    break;

                case 'HOST':
                    if (']' === c) {
                        state = 'END_ADDR';
                    } else if ('%' === c) {
                        scopeIndex = i;
                        state = 'SCOPE';
                    } else if (':' !== c && (c < 'a' || 'f' < c) && (c < 'A' || 'F' < c) && (c < '0' || '9' < c)) {
                        return null;
                    }
                    break;

                case 'SCOPE':
                    if (']' === c) {
                        state = 'END_ADDR';
                    } else if (
                        '_' !== c &&
                        '.' !== c &&
                        '~' !== c &&
                        '-' !== c &&
                        (c < 'a' || 'z' < c) &&
                        (c < 'A' || 'Z' < c) &&
                        (c < '0' || '9' < c)
                    ) {
                        return null;
                    }
                    break;

                case 'END_ADDR':
                    if (':' === c) {
                        portIndex = i;
                        state = 'PORT';
                    } else {
                        return null;
                    }
                    break;

                case 'PORT':
                    if (c < '0' || '9' < c) {
                        return null;
                    }
                    break;
            }
        }

        if (-1 !== portIndex && 1 < length - portIndex) {
            const hostname = str.substring(1, scopeIndex !== -1 ? scopeIndex : portIndex - 1);
            portIndex++;
            const port = AsciiEncoding.parseIntAscii(str, portIndex, length - portIndex);
            return new ParseResult(hostname, port);
        }

        throw new IllegalArgumentException('[address]:port is required for ipv6: ' + str);
    }
}
