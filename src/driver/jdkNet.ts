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
// JDK stand-ins for java.net (spec D20): InetAddress, Inet4Address, Inet6Address, InetSocketAddress, InterfaceAddress,
// NetworkInterface, ProtocolFamily and the exceptions the driver's address code throws and catches.
import { networkInterfaces } from 'node:os';
import { Exception, IllegalArgumentException, Integer } from '../agrona/jdk.js';
import { stringHashCode } from '../agrona/jdkUtil.js';

/** `java.io.IOException`. */
export class IOException extends Exception {}

/** `java.net.SocketException`. */
export class SocketException extends IOException {}

/** `java.net.BindException`: the bind failed, for example because the address is in use or the port range is empty. */
export class BindException extends SocketException {}

/** `java.net.PortUnreachableException`: an ICMP port unreachable on a connected socket. */
export class PortUnreachableException extends SocketException {}

/** `java.net.UnknownHostException`. */
export class UnknownHostException extends IOException {}

/**
 * `java.nio.channels.ClosedChannelException`: a channel was registered with a poller after it had been closed (or before
 * it was opened). Not a `java.net` class; it is here beside the other exceptions of the socket code.
 */
export class ClosedChannelException extends IOException {}

/** `java.net.ProtocolFamily`. */
export interface ProtocolFamily {
    name(): string;
}

/** `java.net.StandardProtocolFamily`: the two constants, compared by identity. `toString()` is the constant name. */
export class StandardProtocolFamily implements ProtocolFamily {
    public static readonly INET = new StandardProtocolFamily('INET');
    public static readonly INET6 = new StandardProtocolFamily('INET6');

    private constructor(private readonly _name: string) {}

    public name(): string {
        return this._name;
    }

    public toString(): string {
        return this._name;
    }
}

const INADDR4SZ = 4;
const INADDR16SZ = 16;
const INT16SZ = 2;

/** `Character.digit(c, radix)` for ASCII, -1 when `c` is not a digit of the radix. */
function digit(c: string, radix: number): number {
    const code = c.charCodeAt(0);
    let value = -1;
    if (code >= 0x30 && code <= 0x39) {
        value = code - 0x30;
    } else if (code >= 0x61 && code <= 0x7a) {
        value = code - 0x61 + 10;
    } else if (code >= 0x41 && code <= 0x5a) {
        value = code - 0x41 + 10;
    }

    return value < radix ? value : -1;
}

/** `sun.net.util.IPAddressUtil.textToNumericFormatV4`: one to four decimal parts, the last filling the rest. */
function textToNumericFormatV4(src: string): Uint8Array | null {
    const res = new Uint8Array(INADDR4SZ);
    let tmpValue = 0;
    let currByte = 0;
    let newOctet = true;
    const len = src.length;
    if (0 === len || len > 15) {
        return null;
    }

    for (let i = 0; i < len; i++) {
        const c = src.charAt(i);
        if ('.' === c) {
            if (newOctet || tmpValue < 0 || tmpValue > 0xff || 3 === currByte) {
                return null;
            }
            res[currByte++] = tmpValue & 0xff;
            tmpValue = 0;
            newOctet = true;
        } else {
            const d = digit(c, 10);
            if (d < 0) {
                return null;
            }
            tmpValue *= 10;
            tmpValue += d;
            newOctet = false;
        }
    }

    if (newOctet || tmpValue < 0 || tmpValue >= Math.pow(2, (4 - currByte) * 8)) {
        return null;
    }

    // Java's switch falls through from the case of the last byte down to case 3.
    if (currByte <= 0) {
        res[0] = Math.floor(tmpValue / 0x1000000) & 0xff;
    }
    if (currByte <= 1) {
        res[1] = Math.floor(tmpValue / 0x10000) & 0xff;
    }
    if (currByte <= 2) {
        res[2] = Math.floor(tmpValue / 0x100) & 0xff;
    }
    res[3] = tmpValue & 0xff;

    return res;
}

/**
 * `sun.net.util.IPAddressUtil.isBsdParsableV4` (JDK 17+): whether a literal that `textToNumericFormatV4` refused is
 * one the BSD `inet_aton` would still accept (hex `0x` or octal parts, one to four parts, the last filling the rest).
 * Such a literal is ambiguous, so `getByName` rejects it instead of looking it up as a host name.
 */
function isBsdParsableV4(src: string): boolean {
    if (0 === src.length || digit(src.charAt(0), 10) < 0) {
        return false;
    }

    const parts = src.split('.');
    if (parts.length > 4) {
        return false;
    }

    for (let p = 0; p < parts.length; p++) {
        const part = parts[p] as string;
        let radix = 10;
        let start = 0;
        if (part.length >= 2 && '0' === part.charAt(0) && ('x' === part.charAt(1) || 'X' === part.charAt(1))) {
            radix = 16;
            start = 2;
        } else if (part.length >= 2 && '0' === part.charAt(0)) {
            radix = 8;
            start = 1;
        }
        if (start >= part.length) {
            return false;
        }

        let value = 0;
        for (let i = start; i < part.length; i++) {
            const d = digit(part.charAt(i), radix);
            if (d < 0) {
                return false;
            }
            value = value * radix + d;
            if (value > 0xffffffff) {
                return false;
            }
        }

        const last = p === parts.length - 1;
        if (last ? value >= Math.pow(2, (5 - parts.length) * 8) : value > 0xff) {
            return false;
        }
    }

    return true;
}

function isIPv4MappedAddress(addr: Uint8Array): boolean {
    if (addr.length < INADDR16SZ) {
        return false;
    }

    for (let i = 0; i < 10; i++) {
        if (0 !== addr[i]) {
            return false;
        }
    }

    return 0xff === addr[10] && 0xff === addr[11];
}

/** `sun.net.util.IPAddressUtil.textToNumericFormatV6`: a scope after `%` is ignored, a mapped IPv4 address is 4 bytes. */
function textToNumericFormatV6(src: string): Uint8Array | null {
    if (src.length < 2) {
        return null;
    }

    const dst = new Uint8Array(INADDR16SZ);
    let srcLength = src.length;
    const pc = src.indexOf('%');
    if (pc === srcLength - 1) {
        return null;
    }
    if (-1 !== pc) {
        srcLength = pc;
    }

    let colonp = -1;
    let i = 0;
    let j = 0;
    if (':' === src.charAt(i)) {
        if (':' !== src.charAt(++i)) {
            return null;
        }
    }

    let curtok = i;
    let sawXdigit = false;
    let val = 0;
    while (i < srcLength) {
        const ch = src.charAt(i++);
        const chval = digit(ch, 16);
        if (-1 !== chval) {
            val <<= 4;
            val |= chval;
            if (val > 0xffff) {
                return null;
            }
            sawXdigit = true;
            continue;
        }

        if (':' === ch) {
            curtok = i;
            if (!sawXdigit) {
                if (-1 !== colonp) {
                    return null;
                }
                colonp = j;
                continue;
            } else if (i === srcLength) {
                return null;
            }
            if (j + INT16SZ > INADDR16SZ) {
                return null;
            }
            dst[j++] = (val >> 8) & 0xff;
            dst[j++] = val & 0xff;
            sawXdigit = false;
            val = 0;
            continue;
        }

        if ('.' === ch && j + INADDR4SZ <= INADDR16SZ) {
            const ia4 = src.substring(curtok, srcLength);
            let dotCount = 0;
            let index = 0;
            while (-1 !== (index = ia4.indexOf('.', index))) {
                dotCount++;
                index++;
            }
            if (3 !== dotCount) {
                return null;
            }
            const v4addr = textToNumericFormatV4(ia4);
            if (null === v4addr) {
                return null;
            }
            for (let k = 0; k < INADDR4SZ; k++) {
                dst[j++] = v4addr[k] as number;
            }
            sawXdigit = false;
            break;
        }

        return null;
    }

    if (sawXdigit) {
        if (j + INT16SZ > INADDR16SZ) {
            return null;
        }
        dst[j++] = (val >> 8) & 0xff;
        dst[j++] = val & 0xff;
    }

    if (-1 !== colonp) {
        const n = j - colonp;
        if (INADDR16SZ === j) {
            return null;
        }
        for (i = 1; i <= n; i++) {
            dst[INADDR16SZ - i] = dst[colonp + n - i] as number;
            dst[colonp + n - i] = 0;
        }
        j = INADDR16SZ;
    }

    if (INADDR16SZ !== j) {
        return null;
    }

    return isIPv4MappedAddress(dst) ? dst.slice(12, 16) : dst;
}

/** `InetAddress.checkNumericZone`: the zone as a number, or -1 when it is not (it is an interface name). */
function checkNumericZone(s: string): number {
    const percent = s.indexOf('%');
    const slen = s.length;
    let zone = 0;
    const multmax = Math.floor(Integer.MAX_VALUE / 10);
    if (-1 === percent) {
        return -1;
    }

    for (let i = percent + 1; i < slen; i++) {
        const c = s.charAt(i);
        if (']' === c) {
            if (i === percent + 1) {
                return -1;
            }
            break;
        }
        const d = digit(c, 10);
        if (d < 0) {
            return -1;
        }
        if (zone > multmax) {
            return -1;
        }
        zone = zone * 10;
        if (zone > Integer.MAX_VALUE - d) {
            return -1;
        }
        zone += d;
    }

    return zone;
}

/**
 * Stand-in for `java.net.InetAddress`. An address is immutable: 4 bytes ({@link Inet4Address}) or 16 bytes
 * ({@link Inet6Address}) and an optional host name that `toString` shows and `equals` ignores.
 * <p>
 * `getByName` answers IP literals and `localhost` itself, and any other host name from {@link InetAddress.nameCache}
 * (spec D7): a name that is not there throws {@link UnknownHostException}, where Java's lookup would have failed.
 */
export abstract class InetAddress {
    /**
     * The host names this process can resolve, filled by `DefaultNameResolver.cache` (the client's `async*` calls do it
     * after `dns.lookup`). The key is the lower-case host name.
     */
    public static readonly nameCache = new Map<string, InetAddress>();

    protected constructor(
        protected readonly address: Uint8Array,
        protected readonly hostName: string | null,
    ) {}

    /** `InetAddress.getByName(String)`. */
    public static getByName(host: string | null): InetAddress {
        if (null === host || 0 === host.length) {
            return InetAddress.getLoopbackAddress();
        }

        if (host.includes('\0')) {
            throw new UnknownHostException('NUL character not allowed in hostname');
        }

        let ipv6Expected = false;
        if ('[' === host.charAt(0)) {
            if (host.length > 2 && ']' === host.charAt(host.length - 1)) {
                host = host.substring(1, host.length - 1);
                ipv6Expected = true;
            } else {
                throw new UnknownHostException(host + ': invalid IPv6 address');
            }
        }

        if (-1 !== digit(host.charAt(0), 16) || ':' === host.charAt(0)) {
            let addr = textToNumericFormatV4(host);
            if (null === addr && isBsdParsableV4(host)) {
                throw new UnknownHostException(host);
            }
            let numericZone = -1;
            let ifname: string | null = null;
            if (null === addr) {
                const pos = host.indexOf('%');
                if (-1 !== pos) {
                    numericZone = checkNumericZone(host);
                    if (-1 === numericZone) {
                        ifname = host.substring(pos + 1);
                    }
                }
                addr = textToNumericFormatV6(host);
                if (null === addr && host.includes(':')) {
                    throw new UnknownHostException(host + ': invalid IPv6 address');
                }
                if (null !== addr && INADDR4SZ === addr.length && (-1 !== numericZone || null !== ifname)) {
                    throw new UnknownHostException(host + ': invalid IPv4-mapped address');
                }
            } else if (ipv6Expected) {
                throw new UnknownHostException('[' + host + ']');
            }

            if (null !== addr) {
                if (INADDR4SZ === addr.length) {
                    return new Inet4Address(null, addr);
                }
                if (null !== ifname) {
                    const nif = NetworkInterface.getByName(ifname);
                    if (null === nif) {
                        throw new UnknownHostException('no such interface ' + ifname);
                    }
                    return new Inet6Address(null, addr, nif.deriveScopeId(), ifname);
                }
                return new Inet6Address(null, addr, -1 === numericZone ? null : numericZone, null);
            }
        } else if (ipv6Expected) {
            throw new UnknownHostException('[' + host + ']');
        }

        const key = host.toLowerCase();
        if ('localhost' === key) {
            return new Inet4Address(host, Uint8Array.of(127, 0, 0, 1));
        }

        const cached = InetAddress.nameCache.get(key);
        if (undefined === cached) {
            throw new UnknownHostException(host + ': Name or service not known');
        }

        return cached.withHostName(host);
    }

    /** `InetAddress.getByAddress(String, byte[])` (the host name may be null). */
    public static getByAddress(host: string | null, addr: Uint8Array): InetAddress {
        if (INADDR4SZ === addr.length) {
            return new Inet4Address(host, addr.slice());
        } else if (INADDR16SZ === addr.length) {
            return isIPv4MappedAddress(addr)
                ? new Inet4Address(host, addr.slice(12, 16))
                : new Inet6Address(host, addr.slice(), null, null);
        }

        throw new UnknownHostException('addr is of illegal length');
    }

    /** `InetAddress.getLoopbackAddress()`: 127.0.0.1. */
    public static getLoopbackAddress(): InetAddress {
        return new Inet4Address('localhost', Uint8Array.of(127, 0, 0, 1));
    }

    /** A copy of the raw address, 4 or 16 bytes, most significant first. */
    public getAddress(): Uint8Array {
        return this.address.slice();
    }

    public abstract getHostAddress(): string;

    /** A copy of this address that holds hostName (what Java's name lookup returns for the name asked for). */
    public abstract withHostName(hostName: string): InetAddress;

    public getHostName(): string {
        return null !== this.hostName ? this.hostName : this.getHostAddress();
    }

    /** The host name held, or null (package-private `holder().getHostName()` in Java). */
    public holderHostName(): string | null {
        return this.hostName;
    }

    public abstract isAnyLocalAddress(): boolean;

    public abstract isLoopbackAddress(): boolean;

    public abstract isMulticastAddress(): boolean;

    public abstract equals(other: unknown): boolean;

    public abstract hashCode(): number;

    public toString(): string {
        return (null !== this.hostName ? this.hostName : '') + '/' + this.getHostAddress();
    }
}

/** Stand-in for `java.net.Inet4Address`. */
export class Inet4Address extends InetAddress {
    public constructor(hostName: string | null, address: Uint8Array) {
        super(address, hostName);
    }

    private hostAddress: string | null = null;

    public getHostAddress(): string {
        if (null === this.hostAddress) {
            this.hostAddress = this.address.join('.');
        }

        return this.hostAddress;
    }

    public withHostName(hostName: string): InetAddress {
        return new Inet4Address(hostName, this.address);
    }

    public isAnyLocalAddress(): boolean {
        return allZero(this.address);
    }

    public isLoopbackAddress(): boolean {
        return 127 === this.address[0];
    }

    public isMulticastAddress(): boolean {
        return 0xe0 === ((this.address[0] as number) & 0xf0);
    }

    public equals(other: unknown): boolean {
        return other instanceof Inet4Address && sameBytes(this.address, other.address);
    }

    public hashCode(): number {
        const a = this.address;
        return (a[3] as number) | ((a[2] as number) << 8) | ((a[1] as number) << 16) | ((a[0] as number) << 24);
    }
}

/** Stand-in for `java.net.Inet6Address`. A scope is a number, and an interface name as well when it was given. */
export class Inet6Address extends InetAddress {
    public constructor(
        hostName: string | null,
        address: Uint8Array,
        private readonly scopeId: number | null,
        private readonly scopeIfName: string | null,
    ) {
        super(address, hostName);
    }

    /** `Inet6Address.getScopeId()`: 0 when there is none. */
    public getScopeId(): number {
        return this.scopeId ?? 0;
    }

    private hostAddress: string | null = null;

    public withHostName(hostName: string): InetAddress {
        return new Inet6Address(hostName, this.address, this.scopeId, this.scopeIfName);
    }

    public getHostAddress(): string {
        if (null !== this.hostAddress) {
            return this.hostAddress;
        }

        const parts: string[] = [];
        for (let i = 0; i < 8; i++) {
            parts.push((((this.address[i << 1] as number) << 8) | (this.address[(i << 1) + 1] as number)).toString(16));
        }

        let s = parts.join(':');
        if (null !== this.scopeIfName) {
            s += '%' + this.scopeIfName;
        } else if (null !== this.scopeId) {
            s += '%' + this.scopeId;
        }

        this.hostAddress = s;
        return s;
    }

    public isAnyLocalAddress(): boolean {
        return allZero(this.address);
    }

    public isLoopbackAddress(): boolean {
        for (let i = 0; i < 15; i++) {
            if (0 !== this.address[i]) {
                return false;
            }
        }

        return 1 === this.address[15];
    }

    public isMulticastAddress(): boolean {
        return 0xff === this.address[0];
    }

    public equals(other: unknown): boolean {
        return other instanceof Inet6Address && sameBytes(this.address, other.address);
    }

    public hashCode(): number {
        let hash = 0;
        let i = 0;
        while (i < INADDR16SZ) {
            let j = 0;
            let component = 0;
            while (j < 4 && i < INADDR16SZ) {
                component = ((component << 8) + (((this.address[i] as number) << 24) >> 24)) | 0;
                j++;
                i++;
            }
            hash = (hash + component) | 0;
        }

        return hash;
    }
}

function allZero(address: Uint8Array): boolean {
    for (let i = 0; i < address.length; i++) {
        if (0 !== address[i]) {
            return false;
        }
    }

    return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

function checkPort(port: number): number {
    if (port < 0 || port > 0xffff) {
        throw new IllegalArgumentException('port out of range:' + port);
    }

    return port;
}

/**
 * Stand-in for `java.net.InetSocketAddress`: an address and a port, or (unresolved) a host name and a port.
 */
export class InetSocketAddress {
    private readonly hostname: string | null;
    private readonly addr: InetAddress | null;
    private readonly port: number;

    /**
     * `new InetSocketAddress(port)` is the wildcard address, `new InetSocketAddress(addr, port)` a resolved one (a null
     * `addr` is the wildcard), `new InetSocketAddress(hostname, port)` resolves the name through
     * {@link InetAddress.getByName} and is unresolved, keeping the name, when that throws {@link UnknownHostException}.
     * `unresolvedHost` is for {@link createUnresolved} only (Java has a private constructor).
     */
    public constructor(portOrAddress: number | string | InetAddress | null, port?: number, unresolvedHost?: string) {
        if (typeof portOrAddress === 'string') {
            let addr: InetAddress | null = null;
            let host: string | null = null;
            try {
                addr = InetAddress.getByName(portOrAddress);
            } catch (e) {
                if (!(e instanceof UnknownHostException)) {
                    throw e;
                }
                host = portOrAddress;
            }
            this.port = checkPort(port as number);
            this.addr = addr;
            this.hostname = host;
        } else if (undefined !== unresolvedHost) {
            this.port = checkPort(port as number);
            this.addr = null;
            this.hostname = unresolvedHost;
        } else if (typeof portOrAddress === 'number') {
            this.port = checkPort(portOrAddress);
            this.addr = InetAddress.getByAddress('0.0.0.0', new Uint8Array(4));
            this.hostname = null;
        } else {
            this.port = checkPort(port as number);
            this.addr = portOrAddress ?? InetAddress.getByAddress('0.0.0.0', new Uint8Array(4));
            this.hostname = null;
        }
    }

    /** `InetSocketAddress.createUnresolved(String, int)`. */
    public static createUnresolved(host: string, port: number): InetSocketAddress {
        if (null === host) {
            throw new IllegalArgumentException("hostname can't be null");
        }

        return new InetSocketAddress(null, port, host);
    }

    public getPort(): number {
        return this.port;
    }

    /** The address, or null when this socket address is unresolved. */
    public getAddress(): InetAddress | null {
        return this.addr;
    }

    public getHostName(): string {
        return null !== this.hostname ? this.hostname : (this.addr as InetAddress).getHostName();
    }

    public getHostString(): string {
        if (null !== this.hostname) {
            return this.hostname;
        }

        const addr = this.addr as InetAddress;
        return addr.holderHostName() ?? addr.getHostAddress();
    }

    public isUnresolved(): boolean {
        return null === this.addr;
    }

    public toString(): string {
        let result: string;
        if (null === this.addr) {
            result = this.hostname + '/<unresolved>';
        } else {
            result = this.addr.toString();
            if (this.addr instanceof Inet6Address) {
                const i = result.lastIndexOf('/') + 1;
                result = result.substring(0, i) + '[' + result.substring(i) + ']';
            }
        }

        return result + ':' + this.port;
    }

    public equals(other: unknown): boolean {
        if (!(other instanceof InetSocketAddress) || this.port !== other.port) {
            return false;
        }

        if (null !== this.addr) {
            return this.addr.equals(other.addr);
        }

        return (
            null === other.addr && (this.hostname as string).toLowerCase() === (other.hostname as string).toLowerCase()
        );
    }

    public hashCode(): number {
        if (null !== this.addr) {
            return (this.addr.hashCode() + this.port) | 0;
        }

        return (stringHashCode((this.hostname as string).toLowerCase()) + this.port) | 0;
    }
}

/** Stand-in for `java.net.InterfaceAddress`. */
export class InterfaceAddress {
    public constructor(
        private readonly address: InetAddress,
        private readonly broadcast: InetAddress | null,
        private readonly maskLength: number,
    ) {}

    public getAddress(): InetAddress {
        return this.address;
    }

    public getBroadcast(): InetAddress | null {
        return this.broadcast;
    }

    public getNetworkPrefixLength(): number {
        return this.maskLength;
    }

    public equals(other: unknown): boolean {
        return (
            other instanceof InterfaceAddress &&
            this.address.equals(other.address) &&
            this.maskLength === other.maskLength &&
            (null === this.broadcast ? null === other.broadcast : this.broadcast.equals(other.broadcast))
        );
    }

    public hashCode(): number {
        return (this.address.hashCode() + this.maskLength) | 0;
    }

    public toString(): string {
        return this.address.toString() + '/' + this.maskLength + ' [' + this.broadcast + ']';
    }
}

/** The flags of a {@link NetworkInterface}. */
export interface NetworkInterfaceFlags {
    readonly loopback: boolean;
    readonly up: boolean;
    readonly multicast: boolean;
}

/**
 * Stand-in for `java.net.NetworkInterface`, built from `os.networkInterfaces()` (which lists the interfaces that are up
 * and have an address; `supportsMulticast` is true for every interface that is not internal, as Node reports no flag).
 */
export class NetworkInterface {
    public constructor(
        private readonly name: string,
        private readonly displayName: string,
        private readonly addresses: readonly InterfaceAddress[],
        private readonly flags: NetworkInterfaceFlags,
    ) {}

    /** `NetworkInterface.getNetworkInterfaces()`: an array where Java returns an `Enumeration`. */
    public static getNetworkInterfaces(): NetworkInterface[] {
        const result: NetworkInterface[] = [];
        for (const [name, entries] of Object.entries(networkInterfaces())) {
            if (undefined === entries || 0 === entries.length) {
                continue;
            }

            const list: InterfaceAddress[] = [];
            for (const entry of entries) {
                const slash = entry.cidr?.lastIndexOf('/') ?? -1;
                const prefix = null !== entry.cidr && slash >= 0 ? Number(entry.cidr.substring(slash + 1)) : 0;
                const octets = InetAddress.getByName(entry.address.split('%')[0] as string).getAddress();
                const scoped = 'IPv6' === entry.family && 0 !== entry.scopeid;
                const address =
                    'IPv6' === entry.family
                        ? new Inet6Address(
                              null,
                              octets,
                              scoped ? (entry.scopeid as number) : null,
                              scoped ? name : null,
                          )
                        : InetAddress.getByAddress(null, octets);
                list.push(new InterfaceAddress(address, null, prefix));
            }

            const isInternal = entries[0]?.internal === true;
            result.push(
                new NetworkInterface(name, name, list, { loopback: isInternal, up: true, multicast: !isInternal }),
            );
        }

        return result;
    }

    /** `NetworkInterface.getByName(String)`: null when there is no such interface. */
    public static getByName(name: string): NetworkInterface | null {
        for (const ifc of NetworkInterface.getNetworkInterfaces()) {
            if (ifc.name === name) {
                return ifc;
            }
        }

        return null;
    }

    /** `NetworkInterface.getByInetAddress(InetAddress)`: the interface that has the address, or null. */
    public static getByInetAddress(addr: InetAddress): NetworkInterface | null {
        for (const ifc of NetworkInterface.getNetworkInterfaces()) {
            for (const ia of ifc.addresses) {
                if (ia.getAddress().equals(addr)) {
                    return ifc;
                }
            }
        }

        return null;
    }

    public getName(): string {
        return this.name;
    }

    public getDisplayName(): string {
        return this.displayName;
    }

    public getInterfaceAddresses(): InterfaceAddress[] {
        return this.addresses.slice();
    }

    public isLoopback(): boolean {
        return this.flags.loopback;
    }

    public isUp(): boolean {
        return this.flags.up;
    }

    public supportsMulticast(): boolean {
        return this.flags.multicast;
    }

    /** The scope of the first IPv6 address of the interface (Java derives it from the interface index): 0 if none. */
    public deriveScopeId(): number {
        for (const ia of this.addresses) {
            const address = ia.getAddress();
            if (address instanceof Inet6Address) {
                return address.getScopeId();
            }
        }

        return 0;
    }

    public equals(other: unknown): boolean {
        return (
            other instanceof NetworkInterface &&
            this.name === other.name &&
            this.addresses.length === other.addresses.length &&
            this.addresses.every((a, i) => a.equals(other.addresses[i]))
        );
    }

    public hashCode(): number {
        return stringHashCode(this.name);
    }

    public toString(): string {
        return 'name:' + this.name + ' (' + this.displayName + ')';
    }
}
