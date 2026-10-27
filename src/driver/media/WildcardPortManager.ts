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
// Port of io/aeron/driver/media/WildcardPortManager.java @ 1.53.3
import { IntHashSet } from '../../agrona/collections/IntHashSet.js';
import { IllegalArgumentException, Integer, NumberFormatException } from '../../agrona/jdk.js';
import { BindException, InetSocketAddress } from '../jdkNet.js';
import type { PortManager } from './PortManager.js';
import type { UdpChannel } from './UdpChannel.js';

/**
 * Class for managing wildcard ports for UDP channel transports within a specific range.
 * <p>
 * Does not track per interface, but as a range over all interfaces.
 */
export class WildcardPortManager implements PortManager {
    /**
     * Placeholder to represent an empty port range.
     */
    public static readonly EMPTY_PORT_RANGE: number[] = [0, 0];

    /** @internal package-private in Java */
    public readonly portSet = new IntHashSet();
    /** @internal package-private in Java */
    public readonly highPort: number = 0;
    /** @internal package-private in Java */
    public readonly lowPort: number = 0;
    /** @internal package-private in Java */
    public readonly isOsWildcard: boolean;
    /** @internal package-private in Java */
    public readonly isSender: boolean;
    /** @internal package-private in Java */
    public nextPort: number = 0;

    /**
     * Instantiate a wildcard port manager with the given port range.
     *
     * @param portRange for the port manager
     * @param isSender for this port manager
     */
    public constructor(portRange: number[], isSender: boolean) {
        this.lowPort = portRange[0] as number;
        this.highPort = portRange[1] as number;
        this.isOsWildcard = this.lowPort === this.highPort && 0 === this.lowPort;
        this.nextPort = this.lowPort;
        this.isSender = isSender;
    }

    /**
     * {@inheritDoc}
     */
    public getManagedPort(udpChannel: UdpChannel, bindAddress: InetSocketAddress): InetSocketAddress {
        let address = bindAddress;

        if (bindAddress.getPort() !== 0) {
            this.portSet.add(bindAddress.getPort());
        } else if (!this.isOsWildcard) {
            // do not map if not a subscription and does not have a control address. We want to use an ephemeral port
            // for the control channel on publications.
            if (!this.isSender || udpChannel.hasExplicitControl()) {
                address = new InetSocketAddress(bindAddress.getAddress(), this.allocateOpenPort());
            }
        }

        return address;
    }

    /**
     * {@inheritDoc}
     */
    public freeManagedPort(bindAddress: InetSocketAddress): void {
        if (bindAddress.getPort() !== 0) {
            this.portSet.remove(bindAddress.getPort());
        }
    }

    /**
     * Parse a port range in the format "low high".
     *
     * @param value for the port range in string format.
     * @return port range as low index 0 and high index 1.
     */
    public static parsePortRange(value: string | null): number[] {
        if (null === value || 0 === value.length) {
            return WildcardPortManager.EMPTY_PORT_RANGE;
        }

        // Java: value.split(" +"), which drops trailing empty strings
        const ports = value.split(/ +/);
        while (ports.length > 0 && 0 === (ports[ports.length - 1] as string).length) {
            ports.pop();
        }

        if (ports.length !== 2) {
            throw new IllegalArgumentException('port range "' + value + '" incorrect format');
        }

        const portRange = [0, 0];

        try {
            portRange[0] = Integer.parseUnsignedInt(ports[0] as string);
            portRange[1] = Integer.parseUnsignedInt(ports[1] as string);

            if (portRange[0] > 65535 || portRange[1] > 65535) {
                throw new NumberFormatException(value + ':port must be an integer value between 0 and 65535');
            }

            if (portRange[0] > portRange[1]) {
                throw new NumberFormatException(value + ':low port value must be lower than high port value');
            }
        } catch (ex) {
            if (ex instanceof NumberFormatException) {
                throw new IllegalArgumentException('invalid port value ' + value, { cause: ex });
            }

            throw ex;
        }

        return portRange;
    }

    private findOpenPort(): number {
        for (let i = this.nextPort; i <= this.highPort; i++) {
            if (!this.portSet.contains(i)) {
                return i;
            }
        }

        for (let i = this.lowPort; i < this.nextPort; i++) {
            if (!this.portSet.contains(i)) {
                return i;
            }
        }

        return 0;
    }

    private allocateOpenPort(): number {
        const port = this.findOpenPort();

        if (0 === port) {
            throw new BindException('no available ports in range ' + this.lowPort + ' ' + this.highPort);
        }

        this.nextPort = port + 1;
        if (this.nextPort > this.highPort) {
            this.nextPort = this.lowPort;
        }

        this.portSet.add(port);

        return port;
    }
}
